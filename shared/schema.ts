import { pgTable, text, serial, timestamp, integer, real, boolean, uuid, json } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// User model with password auth
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password"),
  name: text("name"),
  employeeNumber: text("employee_number"),
  isAdmin: boolean("is_admin").default(false),
  resetToken: text("reset_token"),
  resetTokenExpiry: timestamp("reset_token_expiry"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  password: true,
  name: true,
  employeeNumber: true,
});

// OJT Log Entry model
export const entries = pgTable("entries", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  date: timestamp("date").notNull(),
  location: text("location").notNull(),
  method: text("method").notNull(), // ET, RFT, MT, PT, RT, UT_THK, UTSW, PMI, LSI
  hours: real("hours").notNull(),
  verified: boolean("verified").default(false),
  verifiedBy: text("verified_by"),
  verificationToken: uuid("verification_token").unique(),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").defaultNow(),
  // Digital signature fields
  technicianSignature: text("technician_signature"), // Technician's digital signature
  supervisorSignature: text("supervisor_signature"), // Supervisor's digital signature
  dataHash: text("data_hash"), // Hash of all entry data
  integritySignature: text("integrity_signature"), // Server-generated integrity signature
  verificationRequestedAt: timestamp("verification_requested_at"), // When verification was requested
  auditTrail: json("audit_trail"), // Complete audit trail as JSON
  supervisorIpAddress: text("supervisor_ip_address"), // Supervisor's IP address during verification
  supervisorBrowserInfo: text("supervisor_browser_info"), // Supervisor's browser info
  employeeIdUsed: text("employee_id_used"), // Which employee ID was used for this entry
});

export const insertEntrySchema = createInsertSchema(entries).pick({
  userId: true,
  date: true,
  location: true,
  method: true,
  hours: true,
});

// Supervisor model
export const supervisors = pgTable("supervisors", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  certificationLevel: text("certification_level").notNull(),
  company: text("company").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSupervisorSchema = createInsertSchema(supervisors).pick({
  userId: true,
  name: true,
  email: true,
  phone: true,
  certificationLevel: true,
  company: true,
});

// Rope Hours model
export const ropeHours = pgTable("rope_hours", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  location: text("location").notNull(),
  skills: text("skills").notNull(), // Text input for skills used
  hours: real("hours").notNull(),
  verified: boolean("verified").default(false),
  verifiedBy: text("verified_by"),
  verificationToken: uuid("verification_token").unique(),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").defaultNow(),
  // Digital signature fields
  technicianSignature: text("technician_signature"), // Technician's digital signature
  supervisorSignature: text("supervisor_signature"), // Supervisor's digital signature
  dataHash: text("data_hash"), // Hash of all entry data
  integritySignature: text("integrity_signature"), // Server-generated integrity signature
  verificationRequestedAt: timestamp("verification_requested_at"), // When verification was requested
  auditTrail: json("audit_trail"), // Complete audit trail as JSON
  supervisorIpAddress: text("supervisor_ip_address"), // Supervisor's IP address during verification
  supervisorBrowserInfo: text("supervisor_browser_info"), // Supervisor's browser info
  employeeIdUsed: text("employee_id_used"), // Which employee ID was used for this entry
});

export const insertRopeHoursSchema = createInsertSchema(ropeHours).pick({
  userId: true,
  startDate: true,
  endDate: true,
  location: true,
  skills: true,
  hours: true,
});

// User Crypto Identities - for technicians
export const userCryptoIdentities = pgTable("user_crypto_identities", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  publicKey: text("public_key").notNull(), // RSA public key (safe to store)
  encryptedPrivateKey: text("encrypted_private_key").notNull(), // RSA private key encrypted with server secret
  personalInfo: json("personal_info").notNull(), // {fullName, dateOfBirth, phoneNumber}
  employeeIds: text("employee_ids").array().notNull().default(sql`'{}'::text[]`), // Array of employee IDs
  isEmailVerified: boolean("is_email_verified").default(false),
  emailVerificationToken: text("email_verification_token"),
  emailVerificationExpiry: timestamp("email_verification_expiry"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserCryptoIdentitySchema = createInsertSchema(userCryptoIdentities).pick({
  userId: true,
  publicKey: true,
  encryptedPrivateKey: true,
  personalInfo: true,
  employeeIds: true,
});

// Supervisor Crypto Identities - for supervisors
export const supervisorCryptoIdentities = pgTable("supervisor_crypto_identities", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(), // Unique identifier for supervisors
  publicKey: text("public_key").notNull(), // RSA public key (safe to store)
  encryptedPrivateKey: text("encrypted_private_key").notNull(), // RSA private key encrypted with server secret
  professionalInfo: json("professional_info").notNull(), // {fullName, dateOfBirth, phoneNumber, certifications, company}
  isEmailVerified: boolean("is_email_verified").default(false),
  emailVerificationToken: text("email_verification_token"),
  emailVerificationExpiry: timestamp("email_verification_expiry"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSupervisorCryptoIdentitySchema = createInsertSchema(supervisorCryptoIdentities).pick({
  email: true,
  publicKey: true,
  encryptedPrivateKey: true,
  professionalInfo: true,
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Entry = typeof entries.$inferSelect;
export type InsertEntry = z.infer<typeof insertEntrySchema>;

export type Supervisor = typeof supervisors.$inferSelect;
export type InsertSupervisor = z.infer<typeof insertSupervisorSchema>;

export type RopeHours = typeof ropeHours.$inferSelect;
export type InsertRopeHours = z.infer<typeof insertRopeHoursSchema>;

export type UserCryptoIdentity = typeof userCryptoIdentities.$inferSelect;
export type InsertUserCryptoIdentity = z.infer<typeof insertUserCryptoIdentitySchema>;

export type SupervisorCryptoIdentity = typeof supervisorCryptoIdentities.$inferSelect;
export type InsertSupervisorCryptoIdentity = z.infer<typeof insertSupervisorCryptoIdentitySchema>;

// Enum of NDT methods
export const NDTMethods = {
  ET: "ET",
  RFT: "RFT",
  MT: "MT",
  PT: "PT",
  RT: "RT",
  UT_THK: "UT_THK",
  UTSW: "UTSW",
  PMI: "PMI",
  LSI: "LSI",
} as const;

export type NDTMethod = keyof typeof NDTMethods;
