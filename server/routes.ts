import express, {
  type Express,
  Request,
  Response,
  NextFunction,
} from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { randomBytes, randomUUID } from "crypto";
import session from "express-session";
import PgStore from "connect-pg-simple";
import { add } from "date-fns";
import { pool } from "./db";
import { db } from "./db";
import { users, entries, supervisors, ropeHours, type User } from "@shared/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import {
  getBaseUrl,
  sendEmail,
  sendVerificationConfirmation,
  sendVerificationRequest,
  sendRopeHoursVerificationRequest,
  sendBatchVerificationRequest,
} from "./email";
import {
  insertEntrySchema,
  insertSupervisorSchema,
  insertUserSchema,
  insertRopeHoursSchema,
  NDTMethods,
} from "@shared/schema";
import { z } from "zod";
import { compare, hash } from "bcrypt";
import { createTechnicianCryptoIdentity } from "./crypto";
import multer from "multer";
import { randomUUID as cryptoRandomUUID } from "crypto";
import {
  ObjectStorageService,
  ObjectNotFoundError,
} from "./replit_integrations/object_storage/objectStorage";
import { extractOJTRows, extractRopeRows } from "./extraction";

// Extend express-session types
declare module "express-session" {
  interface SessionData {
    userId?: number;
    magicLinkToken?: string;
    magicLinkEmail?: string;
  }
}

// In server/routes.ts, replace the session configuration with this:

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup session
  const PgSession = PgStore(session);
  const isProduction = process.env.NODE_ENV === "production";

  // Detect if we're running on the custom domain
  const isCustomDomain = process.env.REPLIT_DOMAINS?.includes('trackerloger.online') || false;

  app.use(
    session({
      store: new PgSession({
        pool,
        tableName: "session",
        createTableIfMissing: true,
      }),
      secret: process.env.SESSION_SECRET || "dev-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        // Use secure cookies for HTTPS domains (your custom domain)
        secure: isCustomDomain || isProduction,
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        domain: undefined, // No domain restriction
        httpOnly: true,
      },
      proxy: true, // trust the reverse proxy
    }),
  );

  // Enhanced logging
  console.log(`Session configured:
    - Custom domain detected: ${isCustomDomain}
    - Secure cookies: ${isCustomDomain || isProduction}
    - Production mode: ${isProduction}
    - Available domains: ${process.env.REPLIT_DOMAINS || 'none'}
  `);

  // Secure CORS setup with proper origin allowlist
  app.use((req, res, next) => {
    const origin = req.headers.origin || "";
    const host = req.headers.host || "";

    console.log(`Request from host: ${host}, origin: ${origin}`);

    // Create allowlist of trusted origins
    const allowedOrigins: string[] = [];
    
    // Add production domain
    if (process.env.REPLIT_DOMAINS) {
      const domains = process.env.REPLIT_DOMAINS.split(',');
      domains.forEach(domain => {
        allowedOrigins.push(`https://${domain.trim()}`);
        // Also allow HTTP for development on Replit preview URLs
        if (domain.includes('replit.dev') || domain.includes('repl.co')) {
          allowedOrigins.push(`http://${domain.trim()}`);
        }
      });
    }
    
    // Add localhost for development (both localhost and 127.0.0.1 for Replit)
    allowedOrigins.push('http://localhost:5000');
    allowedOrigins.push('https://localhost:5000');
    allowedOrigins.push('http://127.0.0.1:5000');
    allowedOrigins.push('https://127.0.0.1:5000');
    
    // Check if origin is in allowlist
    const isAllowedOrigin = allowedOrigins.includes(origin) || 
                           (process.env.NODE_ENV === 'development' && origin.startsWith('http://localhost:'));

    if (isAllowedOrigin) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Access-Control-Allow-Credentials", "true");
    } else {
      // Log rejected origins for debugging
      console.warn(`CORS: Rejected origin ${origin}. Allowed origins: ${allowedOrigins.join(', ')}`);
    }
    
    res.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS");
    res.header(
      "Access-Control-Allow-Headers", 
      "X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept, Authorization"
    );
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    
    next();
  });

  // Shared object storage service (used for imported source-document
  // upload, download, and cleanup on delete).
  const objectStorageService = new ObjectStorageService();

  // Authentication middleware
  const requireAuth = (req: Request, res: Response, next: Function) => {
    console.log(
      `Authentication check: session ID ${req.session.id}, user ID: ${req.session.userId || "not set"}`,
    );

    if (!req.session.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    next();
  };

  // Admin middleware
  const requireAdmin = async (req: Request, res: Response, next: Function) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const user = await storage.getUser(req.session.userId);
      if (!user || !user.isAdmin) {
        return res
          .status(403)
          .json({ message: "Access denied: Admin privileges required" });
      }
      next();
    } catch (error) {
      console.error("Error checking admin status:", error);
      return res.status(500).json({ message: "Error checking admin status" });
    }
  };

  // Authentication routes
  // Register new user
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { email, password, name, employeeNumber } = req.body;

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "Email already registered" });
      }

      // Hash password
      const hashedPassword = await hash(password, 10);

      // Create new user
      const userData = insertUserSchema.parse({
        email,
        password: hashedPassword,
        name,
        employeeNumber,
      });

      const user = await storage.createUser(userData);

      // Log user in
      req.session.userId = user.id;

      // Send user data (excluding password)
      const { password: _, ...userWithoutPassword } = user;
      res.status(201).json(userWithoutPassword);
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "Error during registration" });
    }
  });

  // Login with email/password
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;

      // Validate input
      if (!email || !password) {
        return res
          .status(400)
          .json({ message: "Email and password are required" });
      }

      // Get user
      const user = await storage.getUserByEmail(email);
      if (!user || !user.password) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Verify password
      const passwordMatches = await compare(password, user.password);
      if (!passwordMatches) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Login successful
      req.session.userId = user.id;
      console.log(
        `Login successful for user ${user.id}, setting session ID: ${req.session.id}`,
      );

      // Save session explicitly before responding
      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
          return res.status(500).json({ message: "Error saving session" });
        }

        // Send user data (excluding password) after session is saved
        const { password: _, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Error during login" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Error logging out" });
      }
      res.json({ message: "Logged out successfully" });
    });
  });

  // Password reset request
  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      // Find user by email
      const user = await storage.getUserByEmail(email);

      // Even if user not found, return success to prevent email enumeration
      if (!user) {
        return res.json({
          message:
            "If your email exists in our system, you will receive a password reset link",
        });
      }

      // Generate reset token and set expiry (1 hour from now)
      const resetToken = randomUUID();
      const resetTokenExpiry = add(new Date(), { hours: 1 });

      // Save token to user record
      await db
        .update(users)
        .set({
          resetToken,
          resetTokenExpiry,
        })
        .where(eq(users.id, user.id));

      // Create reset URL
      const baseUrl = getBaseUrl();
      const resetUrl = `${baseUrl}/reset-password/${resetToken}`;

      // Create email HTML
      const html = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>OJT Hours Tracker - Password Reset</h2>
          <p>You recently requested to reset your password. Click the button below to reset it:</p>
          
          <p>
            <a 
              href="${resetUrl}" 
              style="display: inline-block; padding: 10px 20px; background-color: #42be65; color: white; text-decoration: none; border-radius: 4px;"
            >
              Reset Password
            </a>
          </p>
          <p>Or copy and paste this URL into your browser:</p>
          <p>${resetUrl}</p>
          
          <p>This link will expire in 1 hour. If you did not request a password reset, you can safely ignore this email.</p>
        </div>
      `;

      // Send email
      const emailSent = await sendEmail(
        user.email,
        "Reset your OJT Hours Tracker password",
        html,
      );

      // Log reset token for debugging
      console.log(
        `Password reset requested for ${user.email}. Reset URL: ${resetUrl}`,
      );

      if (!emailSent) {
        console.log("Failed to send password reset email, but token is valid");
      }

      res.json({
        message:
          "If your email exists in our system, you will receive a password reset link",
      });
    } catch (error) {
      console.error("Password reset request error:", error);
      res
        .status(500)
        .json({ message: "Error processing password reset request" });
    }
  });

  // Validate reset token and set new password
  app.post("/api/auth/reset-password/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const { password } = req.body;

      if (!token || !password) {
        return res
          .status(400)
          .json({ message: "Token and password are required" });
      }

      // Find user by token and check if token is still valid
      const [user] = await db
        .select()
        .from(users)
        .where(
          and(eq(users.resetToken, token), isNotNull(users.resetTokenExpiry)),
        );

      if (!user || new Date(user.resetTokenExpiry!) < new Date()) {
        return res.status(400).json({ message: "Invalid or expired token" });
      }

      // Hash new password
      const hashedPassword = await hash(password, 10);

      // Update user with new password and clear reset token
      await db
        .update(users)
        .set({
          password: hashedPassword,
          resetToken: null,
          resetTokenExpiry: null,
        })
        .where(eq(users.id, user.id));

      res.json({ message: "Password reset successful" });
    } catch (error) {
      console.error("Password reset error:", error);
      res.status(500).json({ message: "Error resetting password" });
    }
  });

  // User routes
  app.get("/api/user", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Send user data without password
      const { password, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error fetching user" });
    }
  });

  app.patch("/api/user", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Update name and employeeNumber if provided
      const updateSchema = z.object({
        name: z.string().optional(),
        employeeNumber: z.string().optional(),
      });

      const { name, employeeNumber } = updateSchema.parse(req.body);

      // Update user in database
      const updatedUser = await db
        .update(users)
        .set({
          name: name || user.name,
          employeeNumber: employeeNumber || user.employeeNumber,
        })
        .where(eq(users.id, user.id))
        .returning();

      // Send user data without password
      const { password, ...userWithoutPassword } = updatedUser[0];
      res.json(userWithoutPassword);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error updating user" });
    }
  });

  // Entry routes
  app.get("/api/entries", requireAuth, async (req, res) => {
    try {
      const entries = await storage.getEntries(req.session.userId!);
      res.json(entries);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error fetching entries" });
    }
  });

  app.post("/api/entries", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;

      // Handle single entry or array of entries
      if (Array.isArray(req.body)) {
        const entriesData = req.body.map((entry) => ({
          ...entry,
          userId,
        }));

        const createdEntries = [];
        for (const entryData of entriesData) {
          // Ensure date is parsed properly
          const parsedData = insertEntrySchema.parse({
            ...entryData,
            date: new Date(entryData.date),
          });
          const newEntry = await storage.createEntry(parsedData);
          createdEntries.push(newEntry);
        }

        res.status(201).json(createdEntries);
      } else {
        const entryData = {
          ...req.body,
          userId,
        };

        // Ensure date is parsed properly
        const parsedData = insertEntrySchema.parse({
          ...entryData,
          date: new Date(entryData.date),
        });
        const newEntry = await storage.createEntry(parsedData);

        res.status(201).json(newEntry);
      }
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid entry data",
          errors: error.errors,
        });
      }
      res.status(500).json({ message: "Error creating entry" });
    }
  });

  app.patch("/api/entries/:id", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const id = parseInt(req.params.id);

      const existing = await storage.getEntry(id);
      if (!existing) return res.status(404).json({ message: "Entry not found" });
      if (existing.userId !== userId) {
        return res.status(403).json({ message: "Unauthorized: Entry does not belong to you" });
      }
      if (existing.verified) {
        return res.status(400).json({ message: "Cannot edit a verified entry" });
      }
      if (existing.verificationRequestedAt) {
        return res.status(400).json({
          message: "Cannot edit an entry that has been sent for verification",
        });
      }

      const updateSchema = insertEntrySchema.omit({ userId: true }).partial();
      const body = { ...req.body };
      if (body.date) body.date = new Date(body.date);
      const parsedData = updateSchema.parse(body);

      const updated = await storage.updateEntry(id, parsedData);
      res.json(updated);
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid entry data", errors: error.errors });
      }
      res.status(500).json({ message: "Error updating entry" });
    }
  });

  // Delete an OJT entry. Only the owner can delete their own entries.
  // For imported entries, when no other entry or rope-hour record references
  // the same source document, the underlying object-storage file is deleted
  // as well.
  app.delete("/api/entries/:id", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const id = parseInt(req.params.id);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ message: "Invalid entry id" });
      }

      const existing = await storage.getEntry(id);
      if (!existing) {
        return res.status(404).json({ message: "Entry not found" });
      }
      if (existing.userId !== userId) {
        return res
          .status(403)
          .json({ message: "Unauthorized: Entry does not belong to you" });
      }

      const sourceKey = existing.sourceDocumentKey;
      await storage.deleteEntry(id);

      if (sourceKey) {
        const remainingEntries =
          await storage.countEntriesBySourceDocumentKey(sourceKey);
        const remainingRopeHours =
          await storage.countRopeHoursBySourceDocumentKey(sourceKey);
        if (remainingEntries === 0 && remainingRopeHours === 0) {
          try {
            await objectStorageService.deleteObjectEntity(sourceKey);
          } catch (err) {
            console.error(
              "Failed to delete orphaned source document",
              sourceKey,
              err,
            );
          }
        }
      }

      res.json({ message: "Entry removed" });
    } catch (error) {
      console.error("Error deleting entry:", error);
      res.status(500).json({ message: "Error deleting entry" });
    }
  });

  // Supervisor routes
  app.get("/api/supervisors", requireAuth, async (req, res) => {
    try {
      const supervisors = await storage.getSupervisors(req.session.userId!);
      res.json(supervisors);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error fetching supervisors" });
    }
  });

  app.post("/api/supervisors", requireAuth, async (req, res) => {
    try {
      const supervisorData = {
        ...req.body,
        userId: req.session.userId!,
      };

      const parsedData = insertSupervisorSchema.parse(supervisorData);
      const newSupervisor = await storage.createSupervisor(parsedData);

      res.status(201).json(newSupervisor);
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid supervisor data",
          errors: error.errors,
        });
      }
      res.status(500).json({ message: "Error creating supervisor" });
    }
  });

  app.patch("/api/supervisors/:id", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const id = parseInt(req.params.id);

      const existing = await storage.getSupervisor(id);
      if (!existing) return res.status(404).json({ message: "Signer not found" });
      if (existing.userId !== userId) return res.status(403).json({ message: "Unauthorized" });

      const updateSchema = insertSupervisorSchema.omit({ userId: true }).partial();
      const parsedData = updateSchema.parse(req.body);

      const updated = await storage.updateSupervisor(id, parsedData);
      res.json(updated);
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid signer data", errors: error.errors });
      }
      res.status(500).json({ message: "Error updating signer" });
    }
  });

  app.delete("/api/supervisors/:id", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const id = parseInt(req.params.id);

      const existing = await storage.getSupervisor(id);
      if (!existing) return res.status(404).json({ message: "Signer not found" });
      if (existing.userId !== userId) return res.status(403).json({ message: "Unauthorized" });

      await storage.deleteSupervisor(id);
      res.json({ message: "Signer deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error deleting signer" });
    }
  });

  // Rope Hours routes
  app.get("/api/rope-hours", requireAuth, async (req, res) => {
    try {
      const ropeHours = await storage.getRopeHours(req.session.userId!);
      res.json(ropeHours);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error fetching rope hours" });
    }
  });

  app.post("/api/rope-hours", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const ropeHourData = {
        ...req.body,
        userId,
      };

      // Ensure dates are parsed properly
      const parsedData = insertRopeHoursSchema.parse({
        ...ropeHourData,
        startDate: new Date(ropeHourData.startDate),
        endDate: new Date(ropeHourData.endDate),
      });
      const newRopeHour = await storage.createRopeHour(parsedData);

      res.status(201).json(newRopeHour);
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid rope hour data",
          errors: error.errors,
        });
      }
      res.status(500).json({ message: "Error creating rope hour" });
    }
  });

  app.patch("/api/rope-hours/:id", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const id = parseInt(req.params.id);

      const existing = await storage.getRopeHour(id);
      if (!existing) return res.status(404).json({ message: "Rope hour entry not found" });
      if (existing.userId !== userId) {
        return res.status(403).json({ message: "Unauthorized: Entry does not belong to you" });
      }
      if (existing.verified) {
        return res.status(400).json({ message: "Cannot edit a verified entry" });
      }
      if (existing.verificationRequestedAt) {
        return res.status(400).json({
          message: "Cannot edit an entry that has been sent for verification",
        });
      }

      const updateSchema = insertRopeHoursSchema.omit({ userId: true }).partial();
      const body = { ...req.body };
      if (body.startDate) body.startDate = new Date(body.startDate);
      if (body.endDate) body.endDate = new Date(body.endDate);
      const parsedData = updateSchema.parse(body);

      const updated = await storage.updateRopeHour(id, parsedData);
      res.json(updated);
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid rope hour data", errors: error.errors });
      }
      res.status(500).json({ message: "Error updating rope hour" });
    }
  });

  // Delete a rope-hours record. Owner-only. For imported records, the
  // underlying source document is removed when no other record references
  // it.
  app.delete("/api/rope-hours/:id", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const id = parseInt(req.params.id);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ message: "Invalid rope hour id" });
      }

      const existing = await storage.getRopeHour(id);
      if (!existing) {
        return res.status(404).json({ message: "Rope hour not found" });
      }
      if (existing.userId !== userId) {
        return res
          .status(403)
          .json({ message: "Unauthorized: Entry does not belong to you" });
      }

      const sourceKey = existing.sourceDocumentKey;
      await storage.deleteRopeHour(id);

      if (sourceKey) {
        const remainingEntries =
          await storage.countEntriesBySourceDocumentKey(sourceKey);
        const remainingRopeHours =
          await storage.countRopeHoursBySourceDocumentKey(sourceKey);
        if (remainingEntries === 0 && remainingRopeHours === 0) {
          try {
            await objectStorageService.deleteObjectEntity(sourceKey);
          } catch (err) {
            console.error(
              "Failed to delete orphaned source document",
              sourceKey,
              err,
            );
          }
        }
      }

      res.json({ message: "Rope hour removed" });
    } catch (error) {
      console.error("Error deleting rope hour:", error);
      res.status(500).json({ message: "Error deleting rope hour" });
    }
  });

  // Bulk-remove every imported entry (OJT and rope hours) that came from the
  // same signed-log upload. Owner-only, imported-only. The underlying object
  // is deleted once the last reference goes away.
  app.delete("/api/imports", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const sourceDocumentKey = req.query.sourceDocumentKey;
      if (
        typeof sourceDocumentKey !== "string" ||
        !sourceDocumentKey.startsWith("/objects/imports/")
      ) {
        return res
          .status(400)
          .json({ message: "Invalid sourceDocumentKey" });
      }

      const deletedEntries =
        await storage.deleteImportedEntriesBySourceDocumentKey(
          userId,
          sourceDocumentKey,
        );
      const deletedRopeHours =
        await storage.deleteImportedRopeHoursBySourceDocumentKey(
          userId,
          sourceDocumentKey,
        );

      if (deletedEntries === 0 && deletedRopeHours === 0) {
        return res.status(404).json({
          message: "No imported entries found for that signed log",
        });
      }

      const remainingEntries =
        await storage.countEntriesBySourceDocumentKey(sourceDocumentKey);
      const remainingRopeHours =
        await storage.countRopeHoursBySourceDocumentKey(sourceDocumentKey);
      if (remainingEntries === 0 && remainingRopeHours === 0) {
        try {
          await objectStorageService.deleteObjectEntity(sourceDocumentKey);
        } catch (err) {
          console.error(
            "Failed to delete orphaned source document",
            sourceDocumentKey,
            err,
          );
        }
      }

      res.json({
        message: "Imported entries removed",
        deletedEntries,
        deletedRopeHours,
      });
    } catch (error) {
      console.error("Error bulk-deleting imported entries:", error);
      res.status(500).json({ message: "Error removing imported entries" });
    }
  });

  // Verification routes for rope hours
  app.post("/api/verify-request-rope/:ropeHourId", requireAuth, async (req, res) => {
    try {
      const { ropeHourId } = req.params;
      const userId = req.session.userId!;

      // Get rope hour
      const ropeHour = await storage.getRopeHour(parseInt(ropeHourId));
      if (!ropeHour) {
        return res.status(404).json({ message: "Rope hour not found" });
      }

      // Check if rope hour belongs to user
      if (ropeHour.userId !== userId) {
        return res
          .status(403)
          .json({ message: "Unauthorized: Rope hour does not belong to you" });
      }

      // Check if rope hour is already verified
      if (ropeHour.verified) {
        return res.status(400).json({ message: "Rope hour already verified" });
      }

      // Get supervisor
      const { supervisorId } = req.body;
      if (!supervisorId) {
        return res.status(400).json({ message: "Supervisor ID is required" });
      }

      const supervisor = await storage.getSupervisor(parseInt(supervisorId));
      if (!supervisor) {
        return res.status(404).json({ message: "Supervisor not found" });
      }

      // Check if supervisor belongs to user
      if (supervisor.userId !== userId) {
        return res
          .status(403)
          .json({ message: "Unauthorized: Supervisor does not belong to you" });
      }

      // Generate verification token
      const verificationToken = randomUUID();

      // Update rope hour with verification token
      const [updatedRopeHour] = await db
        .update(ropeHours)
        .set({ verificationToken })
        .where(eq(ropeHours.id, ropeHour.id))
        .returning();

      // Get user data
      const user = await storage.getUser(userId);

      // Create verification URL
      const baseUrl = getBaseUrl();
      const verificationUrl = `${baseUrl}/verify/${verificationToken}`;

      // Log verification URL for debugging
      console.log("-------------------------------------------------");
      console.log(
        "VERIFICATION LINK (For testing):",
      );
      console.log(verificationUrl);
      console.log("-------------------------------------------------\n");

      // Send verification email using Resend with the updated rope hour
      const emailSent = await sendRopeHoursVerificationRequest(supervisor, user!, updatedRopeHour);

      if (!emailSent) {
        console.log(
          "Email delivery failed, but verification URL is available in logs above",
        );
      }

      res.json({ message: "Verification request sent" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error sending verification request" });
    }
  });

  // Verification routes
  app.post("/api/verify-request/:entryId", requireAuth, async (req, res) => {
    try {
      const { entryId } = req.params;
      const userId = req.session.userId!;

      // Get entry
      const entry = await storage.getEntry(parseInt(entryId));
      if (!entry) {
        return res.status(404).json({ message: "Entry not found" });
      }

      // Check if entry belongs to user
      if (entry.userId !== userId) {
        return res
          .status(403)
          .json({ message: "Unauthorized: Entry does not belong to you" });
      }

      // Check if entry is already verified
      if (entry.verified) {
        return res.status(400).json({ message: "Entry already verified" });
      }

      // Get supervisor
      const { supervisorId } = req.body;
      if (!supervisorId) {
        return res.status(400).json({ message: "Supervisor ID is required" });
      }

      const supervisor = await storage.getSupervisor(parseInt(supervisorId));
      if (!supervisor) {
        return res.status(404).json({ message: "Supervisor not found" });
      }

      // Check if supervisor belongs to user
      if (supervisor.userId !== userId) {
        return res
          .status(403)
          .json({ message: "Unauthorized: Supervisor does not belong to you" });
      }

      // Generate verification token
      const verificationToken = randomUUID();

      // Update entry with verification token
      const [updatedEntry] = await db
        .update(entries)
        .set({ verificationToken })
        .where(eq(entries.id, entry.id))
        .returning();

      // Get user data
      const user = await storage.getUser(userId);

      // Create verification URL
      const baseUrl = getBaseUrl();
      const verificationUrl = `${baseUrl}/verify/${verificationToken}`;

      // Log verification URL for debugging
      console.log("-------------------------------------------------");
      console.log(
        "VERIFICATION LINK (For testing since email is not working):",
      );
      console.log(verificationUrl);
      console.log("-------------------------------------------------\n");

      // Send verification email using Resend with the updated entry
      const emailSent = await sendVerificationRequest(supervisor, user!, updatedEntry);

      if (!emailSent) {
        console.log(
          "Email delivery failed, but verification URL is available in logs above",
        );
      }

      res.json({
        message: "Verification request sent",
        supervisor,
        verificationUrl,
        entry: updatedEntry,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error sending verification request" });
    }
  });

  // API route for getting verification data
  app.get("/api/verify/:token", async (req, res) => {
    try {
      const { token } = req.params;

      // Try to get entry by verification token first
      const entry = await storage.getEntryByVerificationToken(token);
      if (entry) {
        // Check if entry is already verified
        if (entry.verified) {
          return res.status(400).json({ message: "Entry already verified" });
        }

        // Get user and supervisors
        const user = await storage.getUser(entry.userId);
        const supervisors = await storage.getSupervisors(entry.userId);

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        return res.json({ entry, user, supervisors, type: "entry" });
      }

      // Try to get rope hour by verification token
      const ropeHour = await storage.getRopeHourByVerificationToken(token);
      if (ropeHour) {
        // Check if rope hour is already verified
        if (ropeHour.verified) {
          return res.status(400).json({ message: "Rope hour already verified" });
        }

        // Get user and supervisors
        const user = await storage.getUser(ropeHour.userId);
        const supervisors = await storage.getSupervisors(ropeHour.userId);

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        return res.json({ ropeHour, user, supervisors, type: "rope_hour" });
      }

      // If neither found, return error
      return res.status(404).json({ message: "Invalid verification token" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error processing verification" });
    }
  });



  app.post("/api/verify/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const { supervisorName } = req.body;

      if (!supervisorName) {
        return res.status(400).json({ message: "Supervisor name is required" });
      }

      // Try to get entry by verification token first
      const entry = await storage.getEntryByVerificationToken(token);
      if (entry) {
        // Check if entry is already verified
        if (entry.verified) {
          return res.status(400).json({ message: "Entry already verified" });
        }

        // Verify entry
        const verifiedEntry = await storage.verifyEntry(entry.id, supervisorName);

        // Send confirmation email to user
        const user = await storage.getUser(entry.userId);
        if (user) {
          await sendVerificationConfirmation(user, verifiedEntry, supervisorName);
        }

        return res.json({
          message: "Entry verified successfully",
          entry: verifiedEntry,
        });
      }

      // Try to get rope hour by verification token
      const ropeHour = await storage.getRopeHourByVerificationToken(token);
      if (ropeHour) {
        // Check if rope hour is already verified
        if (ropeHour.verified) {
          return res.status(400).json({ message: "Rope hour already verified" });
        }

        // Verify rope hour
        const verifiedRopeHour = await storage.verifyRopeHour(ropeHour.id, supervisorName);

        // Send confirmation email to user
        const user = await storage.getUser(ropeHour.userId);
        if (user) {
          await sendVerificationConfirmation(user, verifiedRopeHour, supervisorName);
        }

        return res.json({
          message: "Rope hour verified successfully",
          ropeHour: verifiedRopeHour,
        });
      }

      // If neither found, return error
      return res.status(404).json({ message: "Invalid verification token" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error verifying entry" });
    }
  });

  // Batch verification request — one email, one link, multiple entries
  app.post("/api/batch-verify-request", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { entryIds, supervisorId } = req.body;

      if (!Array.isArray(entryIds) || entryIds.length < 2) {
        return res.status(400).json({ message: "At least 2 entry IDs are required for a batch request" });
      }
      if (!supervisorId) {
        return res.status(400).json({ message: "Supervisor ID is required" });
      }

      const supervisor = await storage.getSupervisor(parseInt(supervisorId));
      if (!supervisor || supervisor.userId !== userId) {
        return res.status(404).json({ message: "Supervisor not found" });
      }

      // Validate every entry belongs to the user and is unverified
      const resolvedEntries: any[] = [];
      for (const id of entryIds) {
        const entry = await storage.getEntry(parseInt(id));
        if (!entry) return res.status(404).json({ message: `Entry ${id} not found` });
        if (entry.userId !== userId) return res.status(403).json({ message: `Entry ${id} does not belong to you` });
        if (entry.verified) return res.status(400).json({ message: `Entry ${id} is already verified` });
        resolvedEntries.push(entry);
      }

      // Generate one shared batch token
      const batchToken = randomUUID();

      // Stamp every entry with the same token
      await Promise.all(
        resolvedEntries.map((entry) =>
          db.update(entries).set({ verificationToken: batchToken }).where(eq(entries.id, entry.id))
        )
      );

      const user = await storage.getUser(userId);
      const baseUrl = getBaseUrl();
      const verificationUrl = `${baseUrl}/batch-verify/${batchToken}`;

      console.log("-------------------------------------------------");
      console.log("BATCH VERIFICATION LINK (For testing):");
      console.log(verificationUrl);
      console.log("-------------------------------------------------\n");

      await sendBatchVerificationRequest(supervisor, user!, resolvedEntries, batchToken);

      return res.json({ message: "Batch verification request sent", verificationUrl, batchToken });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error sending batch verification request" });
    }
  });

  // GET — return all entries for a batch token (supervisor-facing)
  app.get("/api/batch-verify/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const batchEntries = await storage.getEntriesByBatchToken(token);

      if (!batchEntries.length) {
        return res.status(404).json({ message: "Invalid batch verification token" });
      }

      const allVerified = batchEntries.every((e) => e.verified);
      if (allVerified) {
        return res.status(400).json({ message: "All entries in this batch are already verified" });
      }

      const user = await storage.getUser(batchEntries[0].userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      return res.json({ entries: batchEntries, user, type: "batch" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error fetching batch verification data" });
    }
  });

  // POST — supervisor signs off on all entries in the batch
  app.post("/api/batch-verify/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const { supervisorName } = req.body;

      if (!supervisorName) {
        return res.status(400).json({ message: "Supervisor name is required" });
      }

      const batchEntries = await storage.getEntriesByBatchToken(token);
      if (!batchEntries.length) {
        return res.status(404).json({ message: "Invalid batch verification token" });
      }

      const unverified = batchEntries.filter((e) => !e.verified);
      if (!unverified.length) {
        return res.status(400).json({ message: "All entries in this batch are already verified" });
      }

      const verifiedEntries = await Promise.all(
        unverified.map((entry) => storage.verifyEntry(entry.id, supervisorName))
      );

      // Send one confirmation email to the technician
      const user = await storage.getUser(batchEntries[0].userId);
      if (user) {
        for (const entry of verifiedEntries) {
          await sendVerificationConfirmation(user, entry, supervisorName);
        }
      }

      return res.json({ message: "All entries verified successfully", entries: verifiedEntries });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error verifying batch entries" });
    }
  });

  // Admin routes
  app.get("/api/admin/users", requireAdmin, async (req, res) => {
    try {
      const allUsers = await db.select().from(users);
      // Remove sensitive information
      const sanitizedUsers = allUsers.map((user) => {
        const { password, resetToken, resetTokenExpiry, ...safeUser } = user;
        return safeUser;
      });
      res.json(sanitizedUsers);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Error fetching users" });
    }
  });

  app.get("/api/admin/entries", requireAdmin, async (req, res) => {
    try {
      const allEntries = await db.select().from(entries);
      res.json(allEntries);
    } catch (error) {
      console.error("Error fetching entries:", error);
      res.status(500).json({ message: "Error fetching entries" });
    }
  });

  app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);

      // Check if trying to delete self
      if (userId === req.session.userId) {
        return res
          .status(400)
          .json({ message: "Cannot delete your own account" });
      }

      // Delete user's entries first (cascade delete not automatic)
      await db.delete(entries).where(eq(entries.userId, userId));

      // Delete user's supervisors
      await db.delete(supervisors).where(eq(supervisors.userId, userId));

      // Delete user
      const deletedUser = await db
        .delete(users)
        .where(eq(users.id, userId))
        .returning();

      if (deletedUser.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({ message: "User deleted successfully" });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Error deleting user" });
    }
  });

  app.delete("/api/admin/entries/:id", requireAdmin, async (req, res) => {
    try {
      const entryId = parseInt(req.params.id);

      // Delete entry
      const deletedEntry = await db
        .delete(entries)
        .where(eq(entries.id, entryId))
        .returning();

      if (deletedEntry.length === 0) {
        return res.status(404).json({ message: "Entry not found" });
      }

      res.json({ message: "Entry deleted successfully" });
    } catch (error) {
      console.error("Error deleting entry:", error);
      res.status(500).json({ message: "Error deleting entry" });
    }
  });

  // Create an admin user if none exists
  // This is mainly for development purposes
  const setupAdmin = async () => {
    try {
      // Check if any admin exists
      const [existingAdmin] = await db
        .select()
        .from(users)
        .where(eq(users.isAdmin, true));

      if (!existingAdmin) {
        // Create admin user
        const adminPassword = await hash("admin123", 10);
        await db.insert(users).values({
          email: "admin@ojt.tracker",
          password: adminPassword,
          name: "System Administrator",
          isAdmin: true,
        });
        console.log(
          "Admin user created with email: admin@ojt.tracker and password: admin123",
        );
      }
    } catch (error) {
      console.error("Error setting up admin:", error);
    }
  };

  // Crypto Identity endpoint
  app.post("/api/crypto/identity", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      
      // Check if user already has a crypto identity
      const existingIdentity = await storage.getUserCryptoIdentity(userId);
      if (existingIdentity) {
        return res.status(400).json({ 
          message: "User already has a crypto identity" 
        });
      }

      // Validate request data
      const identitySchema = z.object({
        personalInfo: z.object({
          fullName: z.string().min(2, "Full name required"),
          dateOfBirth: z.string().min(1, "Date of birth required"), 
          phoneNumber: z.string().min(10, "Phone number required"),
        }),
        employeeIds: z.array(z.object({
          employeeId: z.string().min(1, "Employee ID required"),
          company: z.string().min(1, "Company required"),
        })).min(1, "At least one employee ID required"),
      });

      const { personalInfo, employeeIds } = identitySchema.parse(req.body);

      // Create crypto identity using the crypto function
      const cryptoIdentityData = createTechnicianCryptoIdentity(
        userId,
        personalInfo,
        employeeIds.map(emp => emp.employeeId) // Extract just the employeeId strings
      );

      // Save to database
      const newCryptoIdentity = await storage.createUserCryptoIdentity({
        userId: cryptoIdentityData.userId,
        publicKey: cryptoIdentityData.publicKey,
        encryptedPrivateKey: cryptoIdentityData.encryptedPrivateKey,
        personalInfo: cryptoIdentityData.personalInfo,
        employeeIds: cryptoIdentityData.employeeIds,
      });

      // Return success (don't expose private key)
      res.status(201).json({
        message: "Crypto identity created successfully",
        publicKey: newCryptoIdentity.publicKey,
        personalInfo: newCryptoIdentity.personalInfo,
        employeeIds: newCryptoIdentity.employeeIds,
      });
    } catch (error) {
      console.error("Crypto identity creation error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid identity data",
          errors: error.errors,
        });
      }
      res.status(500).json({ message: "Error creating crypto identity" });
    }
  });

  // ----- Import from signed log routes -----
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  });

  const ALLOWED_IMPORT_MIMES = new Set([
    "application/pdf",
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/heic",
  ]);

  // Upload a signed-log file, run AI extraction, return parsed rows + key.
  app.post(
    "/api/imports/extract",
    requireAuth,
    upload.single("file"),
    async (req, res) => {
      try {
        const userId = req.session.userId!;
        const file = req.file;
        const type = (req.body?.type ?? "").toString();

        if (!file) {
          return res.status(400).json({ message: "No file uploaded" });
        }
        if (type !== "ojt" && type !== "rope") {
          return res
            .status(400)
            .json({ message: "Invalid type, must be 'ojt' or 'rope'" });
        }
        if (!ALLOWED_IMPORT_MIMES.has(file.mimetype)) {
          return res.status(400).json({
            message:
              "Unsupported file type. Please upload a PDF or image (JPG, PNG, WEBP).",
          });
        }

        // Save to object storage under imports/<userId>/<uuid>-<safeName>
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
        const objectId = cryptoRandomUUID();
        const relativePath = `imports/${userId}/${objectId}-${safeName}`;
        const sourceDocumentKey = await objectStorageService.uploadBuffer(
          relativePath,
          file.buffer,
          file.mimetype,
        );

        // Run AI extraction
        let rows: unknown[] = [];
        let extractionError: string | null = null;
        try {
          if (type === "ojt") {
            rows = await extractOJTRows(file.buffer, file.mimetype, file.originalname);
          } else {
            rows = await extractRopeRows(file.buffer, file.mimetype, file.originalname);
          }
        } catch (err) {
          console.error("Extraction error:", err);
          extractionError =
            err instanceof Error
              ? err.message
              : "Failed to read the document with AI";
        }

        return res.json({
          sourceDocumentKey,
          sourceDocumentName: file.originalname,
          rows,
          extractionError,
        });
      } catch (error) {
        console.error("Import extract error:", error);
        return res
          .status(500)
          .json({ message: "Error processing uploaded log" });
      }
    },
  );

  // Validation schemas for the commit endpoint
  const validMethods = Object.keys(NDTMethods) as Array<
    keyof typeof NDTMethods
  >;
  const ojtCommitRowSchema = z.object({
    date: z.coerce.date(),
    location: z.string().min(1).max(500),
    method: z.enum(validMethods as [string, ...string[]]),
    hours: z.number().positive().max(24),
  });
  const ropeCommitRowSchema = z.object({
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    location: z.string().min(1).max(500),
    skills: z.string().min(1).max(2000),
    hours: z.number().positive().max(24),
  });
  const commitBodySchema = z.object({
    type: z.enum(["ojt", "rope"]),
    sourceDocumentKey: z.string().regex(/^\/objects\/imports\//),
    sourceDocumentName: z.string().min(1).max(500),
    rows: z.array(z.unknown()).min(1).max(200),
  });

  // Commit reviewed rows from an extracted log as imported entries.
  app.post("/api/imports/commit", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const body = commitBodySchema.parse(req.body);

      // Verify the user actually uploaded that source document.
      if (!body.sourceDocumentKey.startsWith(`/objects/imports/${userId}/`)) {
        return res
          .status(403)
          .json({ message: "Source document does not belong to you" });
      }

      // Confirm the object exists before committing.
      try {
        await objectStorageService.getObjectEntityFile(body.sourceDocumentKey);
      } catch {
        return res
          .status(400)
          .json({ message: "Source document not found in storage" });
      }

      if (body.type === "ojt") {
        // Validate every row up front so a bad row aborts the whole import
        // before any DB writes happen.
        const validated = body.rows.map((raw) => ojtCommitRowSchema.parse(raw));
        const toInsert = validated.map((row) => ({
          userId,
          date: row.date,
          location: row.location,
          method: row.method,
          hours: row.hours,
        }));
        const created = await storage.bulkCreateImportedEntries(
          toInsert,
          body.sourceDocumentKey,
          body.sourceDocumentName,
        );
        return res.status(201).json({ created });
      } else {
        const validated = body.rows.map((raw) => ropeCommitRowSchema.parse(raw));
        for (const row of validated) {
          if (row.endDate < row.startDate) {
            return res.status(400).json({
              message: "End date must be on or after start date",
            });
          }
        }
        const toInsert = validated.map((row) => ({
          userId,
          startDate: row.startDate,
          endDate: row.endDate,
          location: row.location,
          skills: row.skills,
          hours: row.hours,
        }));
        const created = await storage.bulkCreateImportedRopeHours(
          toInsert,
          body.sourceDocumentKey,
          body.sourceDocumentName,
        );
        return res.status(201).json({ created });
      }
    } catch (error) {
      console.error("Import commit error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid import data",
          errors: error.errors,
        });
      }
      return res.status(500).json({ message: "Error committing import" });
    }
  });

  // Get a short-lived signed URL for an imported source document, scoped
  // by ownership (logged-in user) or by a valid verification token from a
  // sibling entry/rope hour pointing to the same source.
  app.get("/api/source-document", async (req, res) => {
    try {
      const recordType = (req.query.type ?? "").toString();
      const recordId = parseInt((req.query.id ?? "").toString(), 10);
      const token = (req.query.token ?? "").toString();

      if (recordType !== "entry" && recordType !== "rope") {
        return res.status(400).json({ message: "Invalid type" });
      }
      if (!Number.isFinite(recordId)) {
        return res.status(400).json({ message: "Invalid id" });
      }

      const sessionUserId = req.session.userId;

      let sourceKey: string | null = null;
      let sourceName: string | null = null;
      let allowed = false;

      let recordOwnerId: number | null = null;

      if (recordType === "entry") {
        const entry = await storage.getEntry(recordId);
        if (!entry || !entry.sourceDocumentKey) {
          return res
            .status(404)
            .json({ message: "Source document not found" });
        }
        sourceKey = entry.sourceDocumentKey;
        sourceName = entry.sourceDocumentName;
        recordOwnerId = entry.userId;
        if (sessionUserId && entry.userId === sessionUserId) {
          allowed = true;
        } else if (token && entry.verificationToken === token) {
          allowed = true;
        }
      } else {
        const ropeHour = await storage.getRopeHour(recordId);
        if (!ropeHour || !ropeHour.sourceDocumentKey) {
          return res
            .status(404)
            .json({ message: "Source document not found" });
        }
        sourceKey = ropeHour.sourceDocumentKey;
        sourceName = ropeHour.sourceDocumentName;
        recordOwnerId = ropeHour.userId;
        if (sessionUserId && ropeHour.userId === sessionUserId) {
          allowed = true;
        } else if (token && ropeHour.verificationToken === token) {
          allowed = true;
        }
      }

      // Sibling-token access: a supervisor verifying a batch should be able
      // to view any imported source document referenced by another record in
      // the same batch (same verification token, same owning user).
      if (!allowed && token && sourceKey && recordOwnerId !== null) {
        const tokenEntry =
          await storage.getEntryByVerificationToken(token);
        if (
          tokenEntry &&
          tokenEntry.userId === recordOwnerId &&
          tokenEntry.sourceDocumentKey === sourceKey
        ) {
          allowed = true;
        }
        if (!allowed) {
          const tokenRope =
            await storage.getRopeHourByVerificationToken(token);
          if (
            tokenRope &&
            tokenRope.userId === recordOwnerId &&
            tokenRope.sourceDocumentKey === sourceKey
          ) {
            allowed = true;
          }
        }
      }

      if (!allowed || !sourceKey) {
        return res.status(403).json({ message: "Access denied" });
      }

      const url = await objectStorageService.getSignedDownloadURL(
        sourceKey,
        600,
      );
      return res.json({ url, name: sourceName });
    } catch (error) {
      console.error("Source document error:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ message: "Source document not found" });
      }
      return res
        .status(500)
        .json({ message: "Error fetching source document" });
    }
  });

  // Call setup admin function
  await setupAdmin();

  const httpServer = createServer(app);

  return httpServer;
}
