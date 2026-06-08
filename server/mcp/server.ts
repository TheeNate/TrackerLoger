// MCP server module — exposes OJT Tracker tools to Claude (or any
// MCP-compatible client) over Streamable HTTP at /mcp.
//
// Auth is handled upstream by the requireAuthOrToken middleware in
// server/routes.ts; this module just receives a userId and builds a
// fresh McpServer + StreamableHTTPServerTransport per request.

import type { Request, Response } from "express";
import { randomBytes, randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { storage } from "../storage";
import { db } from "../db";
import {
  entries as entriesTable,
  ropeHours as ropeHoursTable,
  users as usersTable,
  insertEntrySchema,
  insertRopeHoursSchema,
  insertSupervisorSchema,
  supervisorQualificationSchema,
  canonicalizeSupervisorWrite,
  NDTMethods,
  type Entry,
  type RopeHours,
} from "@shared/schema";
import {
  getBaseUrl,
  sendBatchVerificationRequest,
  sendRopeHoursVerificationRequest,
  sendVerificationRequest,
  sendInviteEmail,
} from "../email";
import { hash } from "bcrypt";
import { ObjectStorageService } from "../replit_integrations/object_storage/objectStorage";
import { fillForm } from "../forms/filler";
import { isFormId, registry } from "../forms/registry";
import {
  EmptyExportError,
  FormCapacityError,
  NothingToExportError,
} from "../forms/types";

// In-memory one-shot store for generated PDFs returned by export_form.
// Claude (or the user) downloads them via GET /api/mcp-exports/:id.
type ExportRecord = {
  bytes: Buffer;
  filename: string;
  expiresAt: number;
};
const EXPORT_TTL_MS = 15 * 60 * 1000;
const exportStore = new Map<string, ExportRecord>();

function gcExports() {
  const now = Date.now();
  for (const [id, rec] of Array.from(exportStore.entries())) {
    if (rec.expiresAt < now) exportStore.delete(id);
  }
}

export function takeExport(id: string): ExportRecord | undefined {
  gcExports();
  const rec = exportStore.get(id);
  if (!rec) return undefined;
  exportStore.delete(id);
  return rec;
}

function stashExport(bytes: Buffer, filename: string): string {
  gcExports();
  const id = randomUUID();
  exportStore.set(id, { bytes, filename, expiresAt: Date.now() + EXPORT_TTL_MS });
  return id;
}

const VALID_METHODS = Object.keys(NDTMethods) as Array<keyof typeof NDTMethods>;

// Shared object storage for cert/document uploads (base64 over MCP).
const objectStorageService = new ObjectStorageService();
const ALLOWED_DOC_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
]);
const MAX_DOC_BYTES = 15 * 1024 * 1024;

const genTempPassword = () => randomBytes(9).toString("base64url").slice(0, 12);

function sanitizeUserRow(u: typeof usersTable.$inferSelect) {
  const { password: _p, resetToken: _r, resetTokenExpiry: _e, ...safe } = u;
  return safe;
}

// Decode a base64 file payload and upload it to object storage, returning the
// stored key + original name. Throws on bad type / size.
async function uploadDocBase64(
  folder: string,
  file: { filename: string; contentBase64: string; mimeType: string },
) {
  if (!ALLOWED_DOC_MIMES.has(file.mimeType)) {
    throw new Error("unsupported mimeType (use PDF, JPG, PNG, WEBP, or HEIC)");
  }
  const buffer = Buffer.from(file.contentBase64, "base64");
  if (buffer.length === 0) throw new Error("empty file content");
  if (buffer.length > MAX_DOC_BYTES) throw new Error("file too large (max 15MB)");
  const safe = file.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const documentKey = await objectStorageService.uploadBuffer(
    `${folder}/${randomUUID()}-${safe}`,
    buffer,
    file.mimeType,
  );
  return { documentKey, documentName: file.filename };
}

// Reusable zod shape for certification create tools.
const certFileSchema = z
  .object({
    filename: z.string().min(1),
    contentBase64: z.string().min(1),
    mimeType: z.string().min(1),
  })
  .describe("Optional certificate file to attach (base64-encoded PDF or image)");

const certInputShape = {
  name: z.string().min(1).max(200).describe("e.g. 'ASNT NDT Level II'"),
  issuingBody: z.string().max(200).optional().describe("ASNT / IRATA / SPRAT / employer"),
  method: z.string().max(100).optional().describe("discipline, e.g. UT"),
  level: z.string().max(100).optional().describe("e.g. Level II"),
  certNumber: z.string().max(200).optional(),
  issueDate: z.string().optional().describe("ISO date"),
  expiryDate: z.string().optional().describe("ISO date"),
  file: certFileSchema.optional(),
};

// Build a certification insert record for `ownerId`, uploading the file if given.
async function buildCertRecord(
  ownerId: number,
  input: {
    name: string;
    issuingBody?: string;
    method?: string;
    level?: string;
    certNumber?: string;
    issueDate?: string;
    expiryDate?: string;
    file?: { filename: string; contentBase64: string; mimeType: string };
  },
) {
  let documentKey: string | null = null;
  let documentName: string | null = null;
  if (input.file) {
    const up = await uploadDocBase64(`certifications/${ownerId}`, input.file);
    documentKey = up.documentKey;
    documentName = up.documentName;
  }
  return {
    userId: ownerId,
    name: input.name.trim(),
    method: input.method?.trim() || null,
    level: input.level?.trim() || null,
    issuingBody: input.issuingBody?.trim() || null,
    certNumber: input.certNumber?.trim() || null,
    issueDate: input.issueDate ? new Date(input.issueDate) : null,
    expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
    documentKey,
    documentName,
  };
}

function ndtTotalsFromEntries(entries: Entry[]) {
  const byMethod = new Map<string, { totalHours: number; verifiedHours: number; count: number }>();
  for (const e of entries) {
    const m = byMethod.get(e.method) ?? { totalHours: 0, verifiedHours: 0, count: 0 };
    m.totalHours += e.hours;
    if (e.verified) m.verifiedHours += e.hours;
    m.count += 1;
    byMethod.set(e.method, m);
  }
  return Array.from(byMethod.entries())
    .map(([method, v]) => ({
      method,
      totalHours: Math.round(v.totalHours * 10) / 10,
      verifiedHours: Math.round(v.verifiedHours * 10) / 10,
      count: v.count,
    }))
    .sort((a, b) => b.totalHours - a.totalHours);
}

function ropeTotalsFromRows(rows: RopeHours[]) {
  let total = 0;
  let verified = 0;
  for (const r of rows) {
    total += r.hours;
    if (r.verified) verified += r.hours;
  }
  return {
    totalHours: Math.round(total * 10) / 10,
    verifiedHours: Math.round(verified * 10) / 10,
    count: rows.length,
  };
}

function ok(text: string, structured?: unknown) {
  return {
    content: [{ type: "text" as const, text }],
    ...(structured !== undefined ? { structuredContent: structured as Record<string, unknown> } : {}),
  };
}

function err(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

function buildServer(userId: number): McpServer {
  const server = new McpServer(
    { name: "ojt-tracker", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  // -------- whoami --------
  server.tool(
    "whoami",
    "Return the authenticated user's name, email, and employee number so the assistant can confirm whose data it's about to touch.",
    {},
    async () => {
      const user = await storage.getUser(userId);
      if (!user) return err("user not found");
      const { password: _p, resetToken: _r, resetTokenExpiry: _e, ...safe } = user;
      return ok(
        `Signed in as ${safe.name ?? "(no name)"} <${safe.email}> (employee ${safe.employeeNumber ?? "n/a"}).`,
        safe,
      );
    },
  );

  // -------- OJT entries --------
  server.tool(
    "list_entries",
    "List all OJT (On-the-Job Training) entries for the authenticated user, newest first.",
    {
      method: z.enum(VALID_METHODS as [string, ...string[]]).optional()
        .describe("Optional NDT method filter (ET, RFT, MT, PT, RT, UT_THK, UTSW, PMI, LSI, PAUT, VT_1, VT_2, VT_3, VWE, UT)"),
      verified: z.boolean().optional().describe("If set, only return entries with this verified state"),
    },
    async ({ method, verified }) => {
      const all = await storage.getEntries(userId);
      const filtered = all.filter((e) => {
        if (method && e.method !== method) return false;
        if (verified !== undefined && Boolean(e.verified) !== verified) return false;
        return true;
      });
      return ok(`${filtered.length} entries.`, { entries: filtered });
    },
  );

  server.tool(
    "get_entry_totals",
    "Sum OJT hours grouped by NDT method, returning total hours and verified hours per method.",
    {},
    async () => {
      const all = await storage.getEntries(userId);
      const totals = ndtTotalsFromEntries(all);
      const summary = totals.map((t) => `${t.method}: ${t.totalHours}h (${t.verifiedHours}h verified)`).join(", ");
      return ok(summary || "No entries yet.", { totals });
    },
  );

  server.tool(
    "create_entry",
    "Log a new OJT training entry. Date must be ISO-8601 (e.g. '2025-05-19' or full ISO timestamp).",
    {
      date: z.string().describe("ISO date or datetime"),
      location: z.string().min(1).max(500),
      method: z.enum(VALID_METHODS as [string, ...string[]]),
      hours: z.number().positive().max(24),
    },
    async (input) => {
      const parsed = insertEntrySchema.parse({
        userId,
        date: new Date(input.date),
        location: input.location,
        method: input.method,
        hours: input.hours,
      });
      const created = await storage.createEntry(parsed);
      return ok(
        `Logged ${created.hours}h of ${created.method} at ${created.location} on ${created.date.toISOString().slice(0, 10)} (id ${created.id}).`,
        { entry: created },
      );
    },
  );

  server.tool(
    "update_entry",
    "Update fields on an existing OJT entry owned by the user.",
    {
      id: z.number().int().positive(),
      date: z.string().optional(),
      location: z.string().min(1).max(500).optional(),
      method: z.enum(VALID_METHODS as [string, ...string[]]).optional(),
      hours: z.number().positive().max(24).optional(),
    },
    async ({ id, ...rest }) => {
      const existing = await storage.getEntry(id);
      if (!existing) return err("entry not found");
      if (existing.userId !== userId) return err("entry does not belong to you");
      const updates: Partial<{ date: Date; location: string; method: string; hours: number }> = {};
      if (rest.date) updates.date = new Date(rest.date);
      if (rest.location !== undefined) updates.location = rest.location;
      if (rest.method !== undefined) updates.method = rest.method;
      if (rest.hours !== undefined) updates.hours = rest.hours;
      const updated = await storage.updateEntry(id, updates as never);
      return ok(`Updated entry ${id}.`, { entry: updated });
    },
  );

  server.tool(
    "delete_entry",
    "Delete an OJT entry owned by the user.",
    { id: z.number().int().positive() },
    async ({ id }) => {
      const existing = await storage.getEntry(id);
      if (!existing) return err("entry not found");
      if (existing.userId !== userId) return err("entry does not belong to you");
      await storage.deleteEntry(id);
      return ok(`Deleted entry ${id}.`);
    },
  );

  // -------- Rope hours --------
  server.tool(
    "list_rope_hours",
    "List all rope-access hour entries for the user, newest first.",
    {},
    async () => {
      const rows = await storage.getRopeHours(userId);
      return ok(`${rows.length} rope-hour entries.`, { ropeHours: rows });
    },
  );

  server.tool(
    "get_rope_hour_totals",
    "Aggregate rope-access totals: total hours and verified hours.",
    {},
    async () => {
      const rows = await storage.getRopeHours(userId);
      const totals = ropeTotalsFromRows(rows);
      return ok(`${totals.totalHours}h total, ${totals.verifiedHours}h verified across ${totals.count} entries.`, totals);
    },
  );

  server.tool(
    "create_rope_hour",
    "Log a new rope-access hour entry. startDate and endDate are ISO dates; hours can exceed 24 (multi-day chunks).",
    {
      startDate: z.string(),
      endDate: z.string(),
      location: z.string().min(1).max(500),
      skills: z.string().min(1).max(2000),
      hours: z.number().positive(),
      employer: z.string().optional(),
      workDetails: z.string().optional(),
      maxHeight: z.string().optional(),
    },
    async (input) => {
      const parsed = insertRopeHoursSchema.parse({
        userId,
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
        location: input.location,
        skills: input.skills,
        hours: input.hours,
        employer: input.employer,
        workDetails: input.workDetails,
        maxHeight: input.maxHeight,
      });
      const created = await storage.createRopeHour(parsed);
      return ok(
        `Logged ${created.hours}h of rope work at ${created.location} (id ${created.id}).`,
        { ropeHour: created },
      );
    },
  );

  server.tool(
    "update_rope_hour",
    "Update fields on an existing rope-hour entry owned by the user.",
    {
      id: z.number().int().positive(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      location: z.string().min(1).max(500).optional(),
      skills: z.string().min(1).max(2000).optional(),
      hours: z.number().positive().optional(),
      employer: z.string().optional(),
      workDetails: z.string().optional(),
      maxHeight: z.string().optional(),
    },
    async ({ id, ...rest }) => {
      const existing = await storage.getRopeHour(id);
      if (!existing) return err("rope-hour not found");
      if (existing.userId !== userId) return err("rope-hour does not belong to you");
      const updates: Record<string, unknown> = { ...rest };
      if (rest.startDate) updates.startDate = new Date(rest.startDate);
      if (rest.endDate) updates.endDate = new Date(rest.endDate);
      const updated = await storage.updateRopeHour(id, updates as never);
      return ok(`Updated rope-hour ${id}.`, { ropeHour: updated });
    },
  );

  server.tool(
    "delete_rope_hour",
    "Delete a rope-hour entry owned by the user.",
    { id: z.number().int().positive() },
    async ({ id }) => {
      const existing = await storage.getRopeHour(id);
      if (!existing) return err("rope-hour not found");
      if (existing.userId !== userId) return err("rope-hour does not belong to you");
      await storage.deleteRopeHour(id);
      return ok(`Deleted rope-hour ${id}.`);
    },
  );

  // -------- Supervisors --------
  server.tool(
    "list_supervisors",
    "List all supervisors saved for verification email targets.",
    {},
    async () => {
      const sups = await storage.getSupervisors(userId);
      return ok(`${sups.length} supervisors.`, { supervisors: sups });
    },
  );

  server.tool(
    "create_supervisor",
    "Add a supervisor that can be used to verify OJT entries or rope hours.",
    {
      name: z.string().min(1),
      email: z.string().email(),
      phone: z.string().min(1),
      certificationLevel: z.string().optional(),
      company: z.string().optional(),
      spratNumber: z.string().optional(),
      irataNumber: z.string().optional(),
      ndtMethod: z.string().optional(),
      qualifications: z.array(supervisorQualificationSchema).optional()
        .describe("List of method+level qualifications, e.g. [{ method: 'UT', level: 'Level III' }]"),
    },
    async (input) => {
      const parsed = canonicalizeSupervisorWrite(
        insertSupervisorSchema.parse({ ...input, userId }),
      );
      const created = await storage.createSupervisor(parsed);
      return ok(`Added supervisor ${created.name} <${created.email}> (id ${created.id}).`, { supervisor: created });
    },
  );

  server.tool(
    "update_supervisor",
    "Update fields on an existing supervisor owned by the user.",
    {
      id: z.number().int().positive(),
      name: z.string().min(1).optional(),
      email: z.string().email().optional(),
      phone: z.string().min(1).optional(),
      certificationLevel: z.string().optional(),
      company: z.string().optional(),
      spratNumber: z.string().optional(),
      irataNumber: z.string().optional(),
      ndtMethod: z.string().optional(),
      qualifications: z.array(supervisorQualificationSchema).optional()
        .describe("List of method+level qualifications, e.g. [{ method: 'UT', level: 'Level III' }]"),
    },
    async ({ id, ...rest }) => {
      const existing = await storage.getSupervisor(id);
      if (!existing) return err("supervisor not found");
      if (existing.userId !== userId) return err("supervisor does not belong to you");
      const updates: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined) updates[k] = v;
      }
      const canonical = canonicalizeSupervisorWrite(updates as never);
      const updated = await storage.updateSupervisor(id, canonical as never);
      return ok(`Updated supervisor ${id}.`, { supervisor: updated });
    },
  );

  server.tool(
    "delete_supervisor",
    "Delete a supervisor record.",
    { id: z.number().int().positive() },
    async ({ id }) => {
      const existing = await storage.getSupervisor(id);
      if (!existing) return err("supervisor not found");
      if (existing.userId !== userId) return err("supervisor does not belong to you");
      await storage.deleteSupervisor(id);
      return ok(`Deleted supervisor ${id}.`);
    },
  );

  // -------- Verification requests --------
  server.tool(
    "request_verification",
    "Send a verification email to a supervisor for one or more unverified OJT entries. Pass exactly one entryId for a single-entry request, or 2+ entryIds for a batched email.",
    {
      entryIds: z.array(z.number().int().positive()).min(1),
      supervisorId: z.number().int().positive(),
    },
    async ({ entryIds, supervisorId }) => {
      const supervisor = await storage.getSupervisor(supervisorId);
      if (!supervisor || supervisor.userId !== userId) return err("supervisor not found");
      const user = await storage.getUser(userId);
      if (!user) return err("user not found");

      const resolved: Entry[] = [];
      for (const id of entryIds) {
        const e = await storage.getEntry(id);
        if (!e) return err(`entry ${id} not found`);
        if (e.userId !== userId) return err(`entry ${id} does not belong to you`);
        if (e.verified) return err(`entry ${id} is already verified`);
        resolved.push(e);
      }

      const baseUrl = getBaseUrl();
      if (resolved.length === 1) {
        const entry = resolved[0];
        const verificationToken = randomUUID();
        const [updated] = await db
          .update(entriesTable)
          .set({ verificationToken })
          .where(eq(entriesTable.id, entry.id))
          .returning();
        await sendVerificationRequest(supervisor, user, updated);
        return ok(
          `Single-entry verification email queued to ${supervisor.email}.`,
          { url: `${baseUrl}/verify/${verificationToken}`, mode: "single" },
        );
      }

      const batchToken = randomUUID();
      await Promise.all(
        resolved.map((entry) =>
          db.update(entriesTable).set({ verificationToken: batchToken }).where(eq(entriesTable.id, entry.id)),
        ),
      );
      await sendBatchVerificationRequest(supervisor, user, resolved, batchToken);
      return ok(
        `Batch verification email queued to ${supervisor.email} for ${resolved.length} entries.`,
        { url: `${baseUrl}/batch-verify/${batchToken}`, mode: "batch", batchToken },
      );
    },
  );

  server.tool(
    "request_rope_verification",
    "Send a verification email to a supervisor for a single rope-hours entry.",
    {
      ropeHourId: z.number().int().positive(),
      supervisorId: z.number().int().positive(),
    },
    async ({ ropeHourId, supervisorId }) => {
      const supervisor = await storage.getSupervisor(supervisorId);
      if (!supervisor || supervisor.userId !== userId) return err("supervisor not found");
      const user = await storage.getUser(userId);
      if (!user) return err("user not found");
      const rh = await storage.getRopeHour(ropeHourId);
      if (!rh) return err("rope-hour not found");
      if (rh.userId !== userId) return err("rope-hour does not belong to you");
      if (rh.verified) return err("rope-hour already verified");

      const verificationToken = randomUUID();
      const [updated] = await db
        .update(ropeHoursTable)
        .set({ verificationToken })
        .where(eq(ropeHoursTable.id, rh.id))
        .returning();
      await sendRopeHoursVerificationRequest(supervisor, user, updated);
      return ok(
        `Rope-hours verification email queued to ${supervisor.email}.`,
        { url: `${getBaseUrl()}/verify/${verificationToken}` },
      );
    },
  );

  // -------- PDF form export --------
  server.tool(
    "export_form",
    "Fill a vendor PDF form (mistras_ojt_v1, curtiss_wright_wer_v1, sprat_log_v1, irata_log_v1) with the given entry/rope-hour ids and return a one-time download URL. URL is valid for 15 minutes and can be opened in a browser.",
    {
      formId: z.enum(["mistras_ojt_v1", "curtiss_wright_wer_v1", "sprat_log_v1", "irata_log_v1"]),
      entryIds: z.array(z.number().int().positive()).min(1),
      headerOverrides: z.record(z.string()).optional(),
    },
    async ({ formId, entryIds, headerOverrides }) => {
      if (!isFormId(formId)) return err("unknown formId");
      const entryDef = registry[formId];
      const profile = await storage.getUser(userId);
      if (!profile) return err("user not found");
      const requested = new Set(entryIds);

      let fieldValues: Record<string, string>;
      let earliestMs: number, latestMs: number;
      try {
        if (entryDef.kind === "ojt") {
          const all = await storage.getEntries(userId);
          const selected = all.filter((e) => requested.has(e.id));
          if (selected.length !== requested.size) return err("one or more entryIds not found or not yours");
          fieldValues = entryDef.adapter({ entries: selected, profile, headerOverrides });
          const dates = selected.map((e) => e.date.getTime()).sort();
          earliestMs = dates[0];
          latestMs = dates[dates.length - 1];
        } else {
          const all = await storage.getRopeHours(userId);
          const selected = all.filter((r) => requested.has(r.id));
          if (selected.length !== requested.size) return err("one or more entryIds not found or not yours");
          const sups = await storage.getSupervisors(userId);
          fieldValues = entryDef.adapter({ ropeHours: selected, profile, supervisors: sups, headerOverrides });
          const dates = selected.map((r) => r.startDate.getTime()).sort();
          earliestMs = dates[0];
          latestMs = dates[dates.length - 1];
        }
      } catch (e) {
        if (e instanceof FormCapacityError) return err(`form capacity exceeded: max ${e.max} ${e.unit}, got ${e.got}`);
        if (e instanceof EmptyExportError) return err("no entries to export");
        if (e instanceof NothingToExportError) return err("selected entries use methods this form doesn't support");
        return err(`adapter failed: ${e instanceof Error ? e.message : "unknown"}`);
      }

      let bytes: Uint8Array;
      try {
        bytes = await fillForm(entryDef.blankPath, fieldValues);
      } catch (e) {
        return err(`form fill failed: ${e instanceof Error ? e.message : "unknown"}`);
      }

      const earliest = new Date(earliestMs).toISOString().slice(0, 10);
      const latest = new Date(latestMs).toISOString().slice(0, 10);
      const filename = `${formId}_${earliest}_to_${latest}.pdf`;
      const exportId = stashExport(Buffer.from(bytes), filename);
      const url = `${getBaseUrl()}/api/mcp-exports/${exportId}`;
      return ok(
        `PDF generated (${bytes.length} bytes). Download once within 15 minutes: ${url}`,
        { url, filename, byteSize: bytes.length, expiresInSec: Math.floor(EXPORT_TTL_MS / 1000) },
      );
    },
  );

  // -------- Certifications (own profile) --------
  server.tool(
    "list_certifications",
    "List the authenticated user's certifications (name, issuing body, level, dates, whether a file is attached).",
    {},
    async () => {
      const certs = await storage.getCertifications(userId);
      return ok(`${certs.length} certifications.`, { certifications: certs });
    },
  );

  server.tool(
    "create_certification",
    "Add a certification to your profile. Optionally attach the certificate file as a base64-encoded PDF or image.",
    certInputShape,
    async (input) => {
      try {
        const rec = await buildCertRecord(userId, input);
        const created = await storage.createCertification(rec);
        return ok(
          `Added certification "${created.name}" (id ${created.id})${created.documentKey ? " with file" : ""}.`,
          { certification: created },
        );
      } catch (e) {
        return err(e instanceof Error ? e.message : "could not create certification");
      }
    },
  );

  server.tool(
    "delete_certification",
    "Delete one of your certifications.",
    { id: z.number().int().positive() },
    async ({ id }) => {
      const existing = await storage.getCertification(id);
      if (!existing) return err("certification not found");
      if (existing.userId !== userId) return err("certification does not belong to you");
      await storage.deleteCertification(id);
      return ok(`Deleted certification ${id}.`);
    },
  );

  // -------- Admin (only when the token belongs to an admin) --------
  const ensureAdmin = async () => {
    const me = await storage.getUser(userId);
    return me?.isAdmin ? me : null;
  };

  server.tool(
    "admin_list_users",
    "[Admin] List all users in the system (id, name, email, employee number, admin flag).",
    {},
    async () => {
      if (!(await ensureAdmin())) return err("admin only");
      const all = await db.select().from(usersTable);
      return ok(`${all.length} users.`, { users: all.map(sanitizeUserRow) });
    },
  );

  server.tool(
    "admin_get_user",
    "[Admin] Get one user's full record: profile, hour totals, and their entries, rope hours, and certifications.",
    { userId: z.number().int().positive() },
    async ({ userId: targetId }) => {
      if (!(await ensureAdmin())) return err("admin only");
      const target = await storage.getUser(targetId);
      if (!target) return err("user not found");
      const [entries, rope, certs] = await Promise.all([
        storage.getEntries(targetId),
        storage.getRopeHours(targetId),
        storage.getCertifications(targetId),
      ]);
      return ok(
        `${target.name ?? target.email}: ${entries.length} OJT entries, ${rope.length} rope records, ${certs.length} certs.`,
        {
          user: sanitizeUserRow(target),
          ojtTotals: ndtTotalsFromEntries(entries),
          ropeTotals: ropeTotalsFromRows(rope),
          entries,
          ropeHours: rope,
          certifications: certs,
        },
      );
    },
  );

  server.tool(
    "admin_create_user",
    "[Admin] Create a new non-admin user with a generated temporary password. Set sendInvite=true to email them their login immediately. Always returns the temp password so you can share it manually.",
    {
      email: z.string().email().max(255),
      name: z.string().max(200).optional(),
      employeeNumber: z.string().max(100).optional(),
      sendInvite: z.boolean().optional().describe("Email the user their login now"),
    },
    async ({ email, name, employeeNumber, sendInvite }) => {
      if (!(await ensureAdmin())) return err("admin only");
      const normalized = email.trim().toLowerCase();
      const existing = await storage.getUserByEmail(normalized);
      if (existing) return err("a user with that email already exists");

      const tempPassword = genTempPassword();
      const hashed = await hash(tempPassword, 10);
      const [created] = await db
        .insert(usersTable)
        .values({
          email: normalized,
          password: hashed,
          name: name ?? null,
          employeeNumber: employeeNumber ?? null,
          isAdmin: false,
        })
        .returning();

      let invited = false;
      if (sendInvite) invited = await sendInviteEmail(normalized, tempPassword, created.name);
      return ok(
        `Created ${normalized} (id ${created.id}). Temp password: ${tempPassword}.${
          sendInvite ? (invited ? " Invite emailed." : " Invite email failed — share manually.") : ""
        }`,
        { user: sanitizeUserRow(created), tempPassword, invited },
      );
    },
  );

  server.tool(
    "admin_invite_user",
    "[Admin] Set a fresh temporary password for a user and email them their login details. Returns the temp password.",
    { userId: z.number().int().positive() },
    async ({ userId: targetId }) => {
      if (!(await ensureAdmin())) return err("admin only");
      const target = await storage.getUser(targetId);
      if (!target) return err("user not found");
      const tempPassword = genTempPassword();
      const hashed = await hash(tempPassword, 10);
      await db.update(usersTable).set({ password: hashed }).where(eq(usersTable.id, targetId));
      const sent = await sendInviteEmail(target.email, tempPassword, target.name);
      return ok(
        `Invite for ${target.email}: ${sent ? "emailed" : "email failed — share manually"}. Temp password: ${tempPassword}.`,
        { tempPassword, sent },
      );
    },
  );

  server.tool(
    "admin_set_admin",
    "[Admin] Grant or revoke admin access for a user. You can't revoke your own admin access.",
    {
      userId: z.number().int().positive(),
      isAdmin: z.boolean(),
    },
    async ({ userId: targetId, isAdmin }) => {
      if (!(await ensureAdmin())) return err("admin only");
      if (!isAdmin && targetId === userId) return err("you can't remove your own admin access");
      const target = await storage.getUser(targetId);
      if (!target) return err("user not found");
      const [updated] = await db
        .update(usersTable)
        .set({ isAdmin })
        .where(eq(usersTable.id, targetId))
        .returning();
      return ok(`${updated.email} is now ${isAdmin ? "an admin" : "a standard user"}.`, {
        user: sanitizeUserRow(updated),
      });
    },
  );

  server.tool(
    "admin_add_certification",
    "[Admin] Add a certification to another user's profile, optionally attaching the certificate file as base64.",
    { userId: z.number().int().positive(), ...certInputShape },
    async ({ userId: targetId, ...input }) => {
      if (!(await ensureAdmin())) return err("admin only");
      const target = await storage.getUser(targetId);
      if (!target) return err("user not found");
      try {
        const rec = await buildCertRecord(targetId, input);
        const created = await storage.createCertification(rec);
        return ok(
          `Added "${created.name}" to ${target.email} (cert id ${created.id}).`,
          { certification: created },
        );
      } catch (e) {
        return err(e instanceof Error ? e.message : "could not create certification");
      }
    },
  );

  server.tool(
    "admin_delete_certification",
    "[Admin] Delete any user's certification by id.",
    { id: z.number().int().positive() },
    async ({ id }) => {
      if (!(await ensureAdmin())) return err("admin only");
      const existing = await storage.getCertification(id);
      if (!existing) return err("certification not found");
      await storage.deleteCertification(id);
      return ok(`Deleted certification ${id}.`);
    },
  );

  return server;
}

// Express handler for /mcp — handles POST initialize and JSON-RPC requests.
// Uses stateless mode (new transport per request) for simplicity.
export async function handleMcpRequest(
  req: Request & { userId?: number },
  res: Response,
): Promise<void> {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }

  try {
    const server = buildServer(userId);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error("MCP handler error:", e);
    if (!res.headersSent) {
      res.status(500).json({ error: "mcp_internal_error" });
    }
  }
}

// Helper exported for tests
export function _generateTokenForTests() {
  return randomBytes(24).toString("hex");
}
