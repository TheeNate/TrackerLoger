import express, { type Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { randomBytes, randomUUID } from "crypto";
import session from "express-session";
import PgStore from "connect-pg-simple";
import { add } from "date-fns";
import { pool } from "./db";
import { db } from "./db";
import { users, entries, supervisors, type User } from "@shared/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { getBaseUrl, sendEmail, sendVerificationConfirmation, sendVerificationRequest } from "./email";
import { insertEntrySchema, insertSupervisorSchema, insertUserSchema } from "@shared/schema";
import { z } from "zod";
import { compare, hash } from 'bcrypt';

// Extend express-session types
declare module "express-session" {
  interface SessionData {
    userId?: number;
    magicLinkToken?: string;
    magicLinkEmail?: string;
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup session
  const PgSession = PgStore(session);
  const isProduction = process.env.NODE_ENV === "production";
  
  // Get domain for proper cookie setting
  const domain = process.env.REPLIT_DOMAINS ? 
    process.env.REPLIT_DOMAINS.split(',')[0].replace(/^https?:\/\//, '') : 
    undefined;
    
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
        secure: isProduction,
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        domain: isProduction ? domain : undefined,
        httpOnly: true
      },
      proxy: isProduction, // trust the reverse proxy when in production
    })
  );
  
  // Log session configuration
  console.log(`Session configured with domain: ${domain || 'localhost'}, secure: ${isProduction}`);
  
  // Set up CORS
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept');
    next();
  });

  // Authentication middleware
  const requireAuth = (req: Request, res: Response, next: Function) => {
    console.log(`Authentication check: session ID ${req.session.id}, user ID: ${req.session.userId || 'not set'}`);
    
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
        return res.status(403).json({ message: "Access denied: Admin privileges required" });
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
        employeeNumber 
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
        return res.status(400).json({ message: "Email and password are required" });
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
      console.log(`Login successful for user ${user.id}, setting session ID: ${req.session.id}`);
      
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
        return res.json({ message: "If your email exists in our system, you will receive a password reset link" });
      }
      
      // Generate reset token and set expiry (1 hour from now)
      const resetToken = randomUUID();
      const resetTokenExpiry = add(new Date(), { hours: 1 });
      
      // Save token to user record
      await db
        .update(users)
        .set({ 
          resetToken, 
          resetTokenExpiry 
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
        html
      );
      
      // Log reset token for debugging
      console.log(`Password reset requested for ${user.email}. Reset URL: ${resetUrl}`);
      
      if (!emailSent) {
        console.log("Failed to send password reset email, but token is valid");
      }
      
      res.json({ message: "If your email exists in our system, you will receive a password reset link" });
    } catch (error) {
      console.error("Password reset request error:", error);
      res.status(500).json({ message: "Error processing password reset request" });
    }
  });
  
  // Validate reset token and set new password
  app.post("/api/auth/reset-password/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const { password } = req.body;
      
      if (!token || !password) {
        return res.status(400).json({ message: "Token and password are required" });
      }
      
      // Find user by token and check if token is still valid
      const [user] = await db
        .select()
        .from(users)
        .where(
          and(
            eq(users.resetToken, token),
            isNotNull(users.resetTokenExpiry)
          )
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
          resetTokenExpiry: null 
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
          employeeNumber: employeeNumber || user.employeeNumber 
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
        const entriesData = req.body.map(entry => ({
          ...entry,
          userId
        }));
        
        const createdEntries = [];
        for (const entryData of entriesData) {
          // Ensure date is parsed properly
          const parsedData = insertEntrySchema.parse({
            ...entryData,
            date: new Date(entryData.date)
          });
          const newEntry = await storage.createEntry(parsedData);
          createdEntries.push(newEntry);
        }
        
        res.status(201).json(createdEntries);
      } else {
        const entryData = {
          ...req.body,
          userId
        };
        
        // Ensure date is parsed properly
        const parsedData = insertEntrySchema.parse({
          ...entryData,
          date: new Date(entryData.date)
        });
        const newEntry = await storage.createEntry(parsedData);
        
        res.status(201).json(newEntry);
      }
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid entry data", 
          errors: error.errors 
        });
      }
      res.status(500).json({ message: "Error creating entry" });
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
        userId: req.session.userId!
      };
      
      const parsedData = insertSupervisorSchema.parse(supervisorData);
      const newSupervisor = await storage.createSupervisor(parsedData);
      
      res.status(201).json(newSupervisor);
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid supervisor data", 
          errors: error.errors 
        });
      }
      res.status(500).json({ message: "Error creating supervisor" });
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
        return res.status(403).json({ message: "Unauthorized: Entry does not belong to you" });
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
        return res.status(403).json({ message: "Unauthorized: Supervisor does not belong to you" });
      }
      
      // Generate verification token
      const verificationToken = randomUUID();
      
      // Update entry with verification token
      await db
        .update(entries)
        .set({ verificationToken })
        .where(eq(entries.id, entry.id));
      
      // Get user data
      const user = await storage.getUser(userId);
      
      // Create verification URL
      const baseUrl = getBaseUrl();
      const verificationUrl = `${baseUrl}/verify/${verificationToken}`;
      
      // Log verification URL for debugging
      console.log("-------------------------------------------------");
      console.log("VERIFICATION LINK (For testing since email is not working):");
      console.log(verificationUrl);
      console.log("-------------------------------------------------\n");
      
      // Send verification email using SendGrid
      const emailSent = await sendVerificationRequest(supervisor, user!, entry);
      
      if (!emailSent) {
        console.log("Email delivery failed, but verification URL is available in logs above");
      }
      
      res.json({ 
        message: "Verification request sent", 
        supervisor,
        verificationUrl 
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error sending verification request" });
    }
  });

  app.get("/api/verify/:token", async (req, res) => {
    try {
      const { token } = req.params;
      
      // Get entry by verification token
      const entry = await storage.getEntryByVerificationToken(token);
      if (!entry) {
        return res.status(404).json({ message: "Invalid verification token" });
      }
      
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
      
      res.json({ entry, user, supervisors });
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
      
      // Get entry by verification token
      const entry = await storage.getEntryByVerificationToken(token);
      if (!entry) {
        return res.status(404).json({ message: "Invalid verification token" });
      }
      
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
      
      res.json({ message: "Entry verified successfully", entry: verifiedEntry });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error verifying entry" });
    }
  });

  // Admin routes
  app.get("/api/admin/users", requireAdmin, async (req, res) => {
    try {
      const allUsers = await db.select().from(users);
      // Remove sensitive information
      const sanitizedUsers = allUsers.map(user => {
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
        return res.status(400).json({ message: "Cannot delete your own account" });
      }
      
      // Delete user's entries first (cascade delete not automatic)
      await db.delete(entries).where(eq(entries.userId, userId));
      
      // Delete user's supervisors
      await db.delete(supervisors).where(eq(supervisors.userId, userId));
      
      // Delete user
      const deletedUser = await db.delete(users).where(eq(users.id, userId)).returning();
      
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
      const deletedEntry = await db.delete(entries).where(eq(entries.id, entryId)).returning();
      
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
        console.log("Admin user created with email: admin@ojt.tracker and password: admin123");
      }
    } catch (error) {
      console.error("Error setting up admin:", error);
    }
  };
  
  // Call setup admin function
  await setupAdmin();

  const httpServer = createServer(app);

  return httpServer;
}