import { pgTable, text, serial, timestamp, integer, real, boolean, uuid, json } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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
  // Added 2026-05-19 for vendor-form support
  PAUT: "PAUT",
  VT_1: "VT_1",
  VT_2: "VT_2",
  VT_3: "VT_3",
  VWE: "VWE",
  UT: "UT",
} as const;

export type NDTMethod = keyof typeof NDTMethods;

// Certification levels a signer can hold
export const CERTIFICATION_LEVELS = ["Level I", "Level II", "Level III"] as const;

// A single method+level qualification a signer holds (e.g. UT Level III)
export const supervisorQualificationSchema = z.object({
  method: z.enum(Object.keys(NDTMethods) as [string, ...string[]]),
  level: z.enum(CERTIFICATION_LEVELS),
});

export type SupervisorQualification = z.infer<typeof supervisorQualificationSchema>;

// Keep the legacy single ndtMethod/certificationLevel columns in sync with the
// qualifications list so older readers (emails, PDF adapters) keep working.
// Only touches legacy fields when `qualifications` is present in the write;
// an empty array clears them. Partial writes without qualifications are left
// untouched.
export function canonicalizeSupervisorWrite<
  T extends {
    qualifications?: SupervisorQualification[] | null;
    ndtMethod?: string | null;
    certificationLevel?: string | null;
  },
>(data: T): T {
  if (data.qualifications === undefined) return data;
  const first = data.qualifications?.[0];
  return {
    ...data,
    ndtMethod: first?.method ?? null,
    certificationLevel: first?.level ?? null,
  };
}

// What a user has chosen to expose on their public share profile. Arrays are
// explicit allowlists: ojtMethods lists which NDT methods to show, certIds lists
// which certifications to show. includeRope toggles the rope-access summary.
export type ShareSettings = {
  ojtMethods: string[];
  includeRope: boolean;
  certIds: number[];
};

export const shareSettingsSchema = z.object({
  ojtMethods: z.array(z.string()).max(50).default([]),
  includeRope: z.boolean().default(false),
  certIds: z.array(z.number().int()).max(200).default([]),
});

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
  // Public share profile: an unguessable token gates a read-only summary page.
  // Null token = sharing disabled. shareSettings controls what's exposed.
  shareToken: text("share_token").unique(),
  shareTokenCreatedAt: timestamp("share_token_created_at"),
  shareSettings: json("share_settings").$type<ShareSettings>(),
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
  // Not unique: a batch verification request stamps one shared token across
  // multiple entries so the supervisor can sign off on them with one link.
  verificationToken: uuid("verification_token"),
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
  // Imported from signed log fields
  sourceDocumentKey: text("source_document_key"), // Object storage path like "/objects/imports/<userId>/<uuid>"
  sourceDocumentName: text("source_document_name"), // Original uploaded filename
  importedAt: timestamp("imported_at"), // When this entry was imported from a signed log
});

export const insertEntrySchema = createInsertSchema(entries).pick({
  userId: true,
  date: true,
  location: true,
  method: true,
  hours: true,
});

// Supervisor / Signer model
export const supervisors = pgTable("supervisors", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  certificationLevel: text("certification_level"),
  company: text("company"),
  spratNumber: text("sprat_number"),
  irataNumber: text("irata_number"),
  ndtMethod: text("ndt_method"),
  // A signer can hold multiple method+level qualifications (e.g. UT III, PT II).
  // Legacy ndtMethod/certificationLevel are kept for backward compatibility.
  qualifications: json("qualifications").$type<SupervisorQualification[]>(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSupervisorSchema = createInsertSchema(supervisors)
  .pick({
    userId: true,
    name: true,
    email: true,
    phone: true,
    certificationLevel: true,
    company: true,
    spratNumber: true,
    irataNumber: true,
    ndtMethod: true,
  })
  .extend({
    qualifications: z.array(supervisorQualificationSchema).optional(),
  });

// Certification / qualification a technician holds (ASNT, IRATA, SPRAT,
// employer cards, etc.). One row per credential; the uploaded certificate file
// lives in object storage under certifications/<userId>/... and is referenced
// by documentKey (same storage pattern as imported signed logs).
export const certifications = pgTable("certifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: text("name").notNull(), // e.g. "ASNT NDT Level II"
  method: text("method"), // discipline, e.g. "UT", "Rope Access" (free text)
  level: text("level"), // e.g. "Level II", "Level 3" (free text)
  issuingBody: text("issuing_body"), // ASNT / IRATA / SPRAT / employer name
  certNumber: text("cert_number"), // credential / certificate number
  issueDate: timestamp("issue_date"),
  expiryDate: timestamp("expiry_date"),
  documentKey: text("document_key"), // "/objects/certifications/<userId>/<uuid>-<name>"
  documentName: text("document_name"), // original uploaded filename
  createdAt: timestamp("created_at").defaultNow(),
});

// Common issuing bodies. The form still accepts free text via "Other".
export const CERT_ISSUING_BODIES = [
  "ASNT",
  "IRATA",
  "SPRAT",
  "API",
  "AWS",
  "Employer",
  "Other",
] as const;

// Validated shape for creating/updating a certification. Dates arrive as
// strings from the client so they're coerced; userId is taken from the session,
// never the request body.
export const certificationWriteSchema = z.object({
  name: z.string().min(1).max(200),
  method: z.string().max(100).nullish(),
  level: z.string().max(100).nullish(),
  issuingBody: z.string().max(200).nullish(),
  certNumber: z.string().max(200).nullish(),
  issueDate: z.coerce.date().nullish(),
  expiryDate: z.coerce.date().nullish(),
  documentKey: z
    .string()
    .max(500)
    .regex(/^\/objects\/certifications\//)
    .nullish(),
  documentName: z.string().max(500).nullish(),
});

export type CertificationWrite = z.infer<typeof certificationWriteSchema>;
export type Certification = typeof certifications.$inferSelect;
export type InsertCertification = typeof certifications.$inferInsert;

// Rope Hours model
export const ropeHours = pgTable("rope_hours", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  location: text("location").notNull(),
  skills: text("skills").notNull(), // Text input for skills used
  hours: real("hours").notNull(),
  employer: text("employer"),
  workDetails: text("work_details"),
  maxHeight: text("max_height"),
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
  // Imported from signed log fields
  sourceDocumentKey: text("source_document_key"),
  sourceDocumentName: text("source_document_name"),
  importedAt: timestamp("imported_at"),
});

export const insertRopeHoursSchema = createInsertSchema(ropeHours).pick({
  userId: true,
  startDate: true,
  endDate: true,
  location: true,
  skills: true,
  hours: true,
  employer: true,
  workDetails: true,
  maxHeight: true,
});

// API Tokens for external integrations (e.g. Claude MCP)
export const apiTokens = pgTable("api_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  tokenPrefix: text("token_prefix").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  lastUsedAt: timestamp("last_used_at"),
});

export const insertApiTokenSchema = createInsertSchema(apiTokens).pick({
  userId: true,
  name: true,
  tokenHash: true,
  tokenPrefix: true,
});

export type ApiToken = typeof apiTokens.$inferSelect;
export type InsertApiToken = z.infer<typeof insertApiTokenSchema>;

// ---------------- OAuth 2.0 (for MCP clients like claude.ai web / Cowork) ----
// Public clients registered via Dynamic Client Registration (RFC 7591).
// No client_secret — MCP clients use Authorization Code + PKCE.
export const oauthClients = pgTable("oauth_clients", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  clientName: text("client_name").notNull(),
  redirectUris: text("redirect_uris").array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp("created_at").defaultNow(),
});

// Short-lived authorization codes (single-use, ~5min TTL). Stores the PKCE
// code_challenge so the token endpoint can verify the code_verifier.
export const oauthAuthorizationCodes = pgTable("oauth_authorization_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  clientId: text("client_id").notNull(),
  userId: integer("user_id").notNull().references(() => users.id),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  codeChallengeMethod: text("code_challenge_method").notNull(),
  scope: text("scope"),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Access + refresh tokens. Hashed at rest (sha256 of the raw token).
export const oauthAccessTokens = pgTable("oauth_access_tokens", {
  id: serial("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  tokenPrefix: text("token_prefix").notNull(),
  refreshTokenHash: text("refresh_token_hash"),
  refreshTokenPrefix: text("refresh_token_prefix"),
  clientId: text("client_id").notNull(),
  userId: integer("user_id").notNull().references(() => users.id),
  scope: text("scope"),
  expiresAt: timestamp("expires_at").notNull(),
  refreshExpiresAt: timestamp("refresh_expires_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow(),
  lastUsedAt: timestamp("last_used_at"),
});

export type OauthClient = typeof oauthClients.$inferSelect;
export type OauthAuthorizationCode = typeof oauthAuthorizationCodes.$inferSelect;
export type OauthAccessToken = typeof oauthAccessTokens.$inferSelect;

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
