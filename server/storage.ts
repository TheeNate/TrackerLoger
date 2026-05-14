import { 
  users, entries, supervisors, ropeHours, userCryptoIdentities,
  type User, type InsertUser, 
  type Entry, type InsertEntry,
  type Supervisor, type InsertSupervisor,
  type RopeHours, type InsertRopeHours,
  type UserCryptoIdentity, type InsertUserCryptoIdentity
} from "@shared/schema";

import { db } from "./db";
import { eq, and, desc, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

export interface IStorage {
  // User methods
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Entry methods
  getEntries(userId: number): Promise<Entry[]>;
  getEntry(id: number): Promise<Entry | undefined>;
  getEntryByVerificationToken(token: string): Promise<Entry | undefined>;
  getEntriesByBatchToken(token: string): Promise<Entry[]>;
  createEntry(entry: InsertEntry): Promise<Entry>;
  createImportedEntry(
    entry: InsertEntry,
    sourceDocumentKey: string,
    sourceDocumentName: string,
  ): Promise<Entry>;
  bulkCreateImportedEntries(
    entries: InsertEntry[],
    sourceDocumentKey: string,
    sourceDocumentName: string,
  ): Promise<Entry[]>;
  updateEntry(id: number, updates: Partial<InsertEntry>): Promise<Entry>;
  verifyEntry(id: number, verifiedBy: string): Promise<Entry>;
  deleteEntry(id: number): Promise<void>;
  deleteImportedEntriesBySourceDocumentKey(
    userId: number,
    sourceDocumentKey: string,
  ): Promise<number>;
  countEntriesBySourceDocumentKey(sourceDocumentKey: string): Promise<number>;

  // Rope Hours methods
  getRopeHours(userId: number): Promise<RopeHours[]>;
  getRopeHour(id: number): Promise<RopeHours | undefined>;
  getRopeHourByVerificationToken(token: string): Promise<RopeHours | undefined>;
  createRopeHour(ropeHour: InsertRopeHours): Promise<RopeHours>;
  createImportedRopeHour(
    ropeHour: InsertRopeHours,
    sourceDocumentKey: string,
    sourceDocumentName: string,
  ): Promise<RopeHours>;
  bulkCreateImportedRopeHours(
    ropeHours: InsertRopeHours[],
    sourceDocumentKey: string,
    sourceDocumentName: string,
  ): Promise<RopeHours[]>;
  updateRopeHour(id: number, updates: Partial<InsertRopeHours>): Promise<RopeHours>;
  verifyRopeHour(id: number, verifiedBy: string): Promise<RopeHours>;
  deleteRopeHour(id: number): Promise<void>;
  deleteImportedRopeHoursBySourceDocumentKey(
    userId: number,
    sourceDocumentKey: string,
  ): Promise<number>;
  countRopeHoursBySourceDocumentKey(sourceDocumentKey: string): Promise<number>;

  // Supervisor methods
  getSupervisors(userId: number): Promise<Supervisor[]>;
  getSupervisor(id: number): Promise<Supervisor | undefined>;
  createSupervisor(supervisor: InsertSupervisor): Promise<Supervisor>;
  updateSupervisor(id: number, updates: Partial<InsertSupervisor>): Promise<Supervisor>;
  deleteSupervisor(id: number): Promise<void>;
  
  // Crypto Identity methods
  getUserCryptoIdentity(userId: number): Promise<UserCryptoIdentity | undefined>;
  createUserCryptoIdentity(cryptoIdentity: InsertUserCryptoIdentity): Promise<UserCryptoIdentity>;
}

export class DatabaseStorage implements IStorage {
  // User methods
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [newUser] = await db.insert(users).values(user).returning();
    return newUser;
  }

  // Entry methods
  async getEntries(userId: number): Promise<Entry[]> {
    return await db
      .select()
      .from(entries)
      .where(eq(entries.userId, userId))
      .orderBy(desc(entries.date));
  }

  async getEntry(id: number): Promise<Entry | undefined> {
    const [entry] = await db.select().from(entries).where(eq(entries.id, id));
    return entry;
  }

  async getEntryByVerificationToken(token: string): Promise<Entry | undefined> {
    const [entry] = await db
      .select()
      .from(entries)
      .where(eq(entries.verificationToken, token));
    return entry;
  }

  async getEntriesByBatchToken(token: string): Promise<Entry[]> {
    return await db
      .select()
      .from(entries)
      .where(eq(entries.verificationToken, token));
  }

  async createEntry(entry: InsertEntry): Promise<Entry> {
    const verificationToken = uuidv4();
    const [newEntry] = await db
      .insert(entries)
      .values({ ...entry, verificationToken })
      .returning();
    return newEntry;
  }

  async createImportedEntry(
    entry: InsertEntry,
    sourceDocumentKey: string,
    sourceDocumentName: string,
  ): Promise<Entry> {
    const [created] = await this.bulkCreateImportedEntries(
      [entry],
      sourceDocumentKey,
      sourceDocumentName,
    );
    return created;
  }

  async bulkCreateImportedEntries(
    items: InsertEntry[],
    sourceDocumentKey: string,
    sourceDocumentName: string,
  ): Promise<Entry[]> {
    if (items.length === 0) return [];
    const now = new Date();
    return await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(entries)
        .values(
          items.map((entry) => ({
            ...entry,
            verified: true,
            verifiedBy: "Imported from signed log",
            verifiedAt: now,
            importedAt: now,
            sourceDocumentKey,
            sourceDocumentName,
          })),
        )
        .returning();
      return inserted;
    });
  }

  async updateEntry(id: number, updates: Partial<InsertEntry>): Promise<Entry> {
    const [updated] = await db
      .update(entries)
      .set(updates)
      .where(eq(entries.id, id))
      .returning();
    return updated;
  }

  async verifyEntry(id: number, verifiedBy: string): Promise<Entry> {
    const [entry] = await db
      .update(entries)
      .set({ 
        verified: true, 
        verifiedBy, 
        verifiedAt: new Date() 
      })
      .where(eq(entries.id, id))
      .returning();
    return entry;
  }

  async deleteEntry(id: number): Promise<void> {
    await db.delete(entries).where(eq(entries.id, id));
  }

  async deleteImportedEntriesBySourceDocumentKey(
    userId: number,
    sourceDocumentKey: string,
  ): Promise<number> {
    const deleted = await db
      .delete(entries)
      .where(
        and(
          eq(entries.userId, userId),
          eq(entries.sourceDocumentKey, sourceDocumentKey),
          sql`${entries.importedAt} is not null`,
        ),
      )
      .returning({ id: entries.id });
    return deleted.length;
  }

  async countEntriesBySourceDocumentKey(
    sourceDocumentKey: string,
  ): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(entries)
      .where(eq(entries.sourceDocumentKey, sourceDocumentKey));
    return row?.count ?? 0;
  }

  // Rope Hours methods
  async getRopeHours(userId: number): Promise<RopeHours[]> {
    return await db
      .select()
      .from(ropeHours)
      .where(eq(ropeHours.userId, userId))
      .orderBy(desc(ropeHours.startDate));
  }

  async getRopeHour(id: number): Promise<RopeHours | undefined> {
    const [ropeHour] = await db.select().from(ropeHours).where(eq(ropeHours.id, id));
    return ropeHour;
  }

  async getRopeHourByVerificationToken(token: string): Promise<RopeHours | undefined> {
    const [ropeHour] = await db
      .select()
      .from(ropeHours)
      .where(eq(ropeHours.verificationToken, token));
    return ropeHour;
  }

  async createRopeHour(ropeHour: InsertRopeHours): Promise<RopeHours> {
    const verificationToken = uuidv4();
    const [newRopeHour] = await db
      .insert(ropeHours)
      .values({ ...ropeHour, verificationToken })
      .returning();
    return newRopeHour;
  }

  async createImportedRopeHour(
    ropeHour: InsertRopeHours,
    sourceDocumentKey: string,
    sourceDocumentName: string,
  ): Promise<RopeHours> {
    const [created] = await this.bulkCreateImportedRopeHours(
      [ropeHour],
      sourceDocumentKey,
      sourceDocumentName,
    );
    return created;
  }

  async bulkCreateImportedRopeHours(
    items: InsertRopeHours[],
    sourceDocumentKey: string,
    sourceDocumentName: string,
  ): Promise<RopeHours[]> {
    if (items.length === 0) return [];
    const now = new Date();
    return await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(ropeHours)
        .values(
          items.map((ropeHour) => ({
            ...ropeHour,
            verified: true,
            verifiedBy: "Imported from signed log",
            verifiedAt: now,
            importedAt: now,
            sourceDocumentKey,
            sourceDocumentName,
          })),
        )
        .returning();
      return inserted;
    });
  }

  async updateRopeHour(id: number, updates: Partial<InsertRopeHours>): Promise<RopeHours> {
    const [updated] = await db
      .update(ropeHours)
      .set(updates)
      .where(eq(ropeHours.id, id))
      .returning();
    return updated;
  }

  async verifyRopeHour(id: number, verifiedBy: string): Promise<RopeHours> {
    const [ropeHour] = await db
      .update(ropeHours)
      .set({ 
        verified: true, 
        verifiedBy, 
        verifiedAt: new Date() 
      })
      .where(eq(ropeHours.id, id))
      .returning();
    return ropeHour;
  }

  async deleteRopeHour(id: number): Promise<void> {
    await db.delete(ropeHours).where(eq(ropeHours.id, id));
  }

  async deleteImportedRopeHoursBySourceDocumentKey(
    userId: number,
    sourceDocumentKey: string,
  ): Promise<number> {
    const deleted = await db
      .delete(ropeHours)
      .where(
        and(
          eq(ropeHours.userId, userId),
          eq(ropeHours.sourceDocumentKey, sourceDocumentKey),
          sql`${ropeHours.importedAt} is not null`,
        ),
      )
      .returning({ id: ropeHours.id });
    return deleted.length;
  }

  async countRopeHoursBySourceDocumentKey(
    sourceDocumentKey: string,
  ): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(ropeHours)
      .where(eq(ropeHours.sourceDocumentKey, sourceDocumentKey));
    return row?.count ?? 0;
  }

  // Supervisor methods
  async getSupervisors(userId: number): Promise<Supervisor[]> {
    return await db
      .select()
      .from(supervisors)
      .where(eq(supervisors.userId, userId));
  }

  async getSupervisor(id: number): Promise<Supervisor | undefined> {
    const [supervisor] = await db
      .select()
      .from(supervisors)
      .where(eq(supervisors.id, id));
    return supervisor;
  }

  async createSupervisor(supervisor: InsertSupervisor): Promise<Supervisor> {
    const [newSupervisor] = await db
      .insert(supervisors)
      .values(supervisor)
      .returning();
    return newSupervisor;
  }

  async updateSupervisor(id: number, updates: Partial<InsertSupervisor>): Promise<Supervisor> {
    const [updated] = await db
      .update(supervisors)
      .set(updates)
      .where(eq(supervisors.id, id))
      .returning();
    return updated;
  }

  async deleteSupervisor(id: number): Promise<void> {
    await db.delete(supervisors).where(eq(supervisors.id, id));
  }

  // Crypto Identity methods
  async getUserCryptoIdentity(userId: number): Promise<UserCryptoIdentity | undefined> {
    const [cryptoIdentity] = await db
      .select()
      .from(userCryptoIdentities)
      .where(eq(userCryptoIdentities.userId, userId));
    return cryptoIdentity;
  }

  async createUserCryptoIdentity(cryptoIdentity: InsertUserCryptoIdentity): Promise<UserCryptoIdentity> {
    const [newCryptoIdentity] = await db
      .insert(userCryptoIdentities)
      .values(cryptoIdentity)
      .returning();
    return newCryptoIdentity;
  }
}

export const storage = new DatabaseStorage();
