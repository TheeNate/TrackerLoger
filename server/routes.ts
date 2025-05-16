import express, { type Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { randomBytes } from "crypto";
import session from "express-session";
import PgStore from "connect-pg-simple";
import { pool } from "./db";
import { db } from "./db";
import { users, entries, supervisors, type User } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getBaseUrl, sendVerificationConfirmation } from "./email";
import { sendMagicLinkEmail, sendVerificationEmail } from "./mailsender";
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
        secure: process.env.NODE_ENV === "production",
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      },
    })
  );

  // Authentication middleware
  const requireAuth = (req: Request, res: Response, next: Function) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    next();
  };

  // Authentication routes
  // Register new user
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { email, password, name, employeeNumber } = req.body;
      
      // Validate input
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }
      
      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "Email already registered" });
      }
      
      // Hash password
      const hashedPassword = await hash(password, 10);
      
      // Create user
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
      
      // Send user data (excluding password)
      const { password: _, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
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

  // Verification process routes
  app.post("/api/verify-request/:entryId", requireAuth, async (req, res) => {
    try {
      const entryId = parseInt(req.params.entryId);
      if (isNaN(entryId)) {
        return res.status(400).json({ message: "Invalid entry ID" });
      }
      
      const entry = await storage.getEntry(entryId);
      if (!entry) {
        return res.status(404).json({ message: "Entry not found" });
      }
      
      if (entry.userId !== req.session.userId) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      if (entry.verified) {
        return res.status(400).json({ message: "Entry already verified" });
      }
      
      // Get supervisor data
      const { supervisorId } = req.body;
      
      let supervisor;
      if (supervisorId) {
        supervisor = await storage.getSupervisor(supervisorId);
        if (!supervisor) {
          return res.status(404).json({ message: "Supervisor not found" });
        }
      } else {
        // Create new supervisor
        const supervisorData = {
          ...req.body,
          userId: req.session.userId!
        };
        
        const parsedData = insertSupervisorSchema.parse(supervisorData);
        supervisor = await storage.createSupervisor(parsedData);
      }
      
      // Get user
      const user = await storage.getUser(req.session.userId!);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Get verification URL
      const baseUrl = req.protocol + '://' + req.get('host');
      const verificationUrl = `${baseUrl}/verify/${entry.verificationToken}`;
      
      // Log the verification link clearly in the console
      console.log("\n-------------------------------------------------");
      console.log("VERIFICATION LINK (For testing since email is not working):");
      console.log(verificationUrl);
      console.log("-------------------------------------------------\n");
      
      // Send email using mailsender service
      const emailSent = await sendVerificationEmail(
        supervisor.email,
        user.name || 'User',
        user.employeeNumber || '',
        {
          date: entry.date,
          location: entry.location,
          method: entry.method,
          hours: entry.hours
        },
        verificationUrl
      );
      
      if (!emailSent) {
        console.log("Email delivery failed, but verification URL is available in logs above");
      }
      
      res.json({ 
        message: "Verification request sent", 
        supervisor,
        entry,
        note: "Check server logs for direct verification link"
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error sending verification request" });
    }
  });

  // Public verification endpoint (no auth required)
  app.get("/api/verify/:token", async (req, res) => {
    try {
      const { token } = req.params;
      
      const entry = await storage.getEntryByVerificationToken(token);
      if (!entry) {
        return res.status(404).json({ message: "Entry not found or already verified" });
      }
      
      if (entry.verified) {
        return res.status(400).json({ message: "Entry already verified" });
      }
      
      // Get user for the response
      const user = await storage.getUser(entry.userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.json({
        entry,
        user: {
          name: user.name,
          employeeNumber: user.employeeNumber
        }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error fetching verification details" });
    }
  });

  app.post("/api/verify/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const { verifierName } = req.body;
      
      if (!verifierName) {
        return res.status(400).json({ message: "Verifier name is required" });
      }
      
      const entry = await storage.getEntryByVerificationToken(token);
      if (!entry) {
        return res.status(404).json({ message: "Entry not found or already verified" });
      }
      
      if (entry.verified) {
        return res.status(400).json({ message: "Entry already verified" });
      }
      
      // Verify the entry
      const verifiedEntry = await storage.verifyEntry(entry.id, verifierName);
      
      // Get user to send confirmation email
      const user = await storage.getUser(entry.userId);
      if (user) {
        await sendVerificationConfirmation(user, verifiedEntry, verifierName);
      }
      
      res.json({ 
        message: "Entry verified successfully",
        entry: verifiedEntry
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error verifying entry" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
