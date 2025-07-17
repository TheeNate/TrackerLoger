import { pgTable, text, serial, timestamp, integer, real, boolean, uuid } from "drizzle-orm/pg-core";
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
});

export const insertRopeHoursSchema = createInsertSchema(ropeHours).pick({
  userId: true,
  startDate: true,
  endDate: true,
  location: true,
  skills: true,
  hours: true,
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
