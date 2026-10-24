// Certification progress tracking and "now qualifies" alerts. The rules and
// the math live in shared/certProgress.ts; this file loads records, stores the
// NDT requirements (site default + per-organization), records milestones and
// notifies admins (in-app + email).
//
// Whose requirements apply: SPRAT / IRATA are fixed. For NDT, a technician is
// measured against each active organization they belong to: that org's own
// requirements if it has set them, otherwise the site default. Someone in no
// org (or only in orgs on the default) is measured against the default once.
//
// Who is told: site admins hear about everyone. Org admins hear about their
// active members: rope levels, NDT levels under their org's requirements, and
// NDT levels under the default when their org hasn't set its own.
//
// Progress is re-checked for a technician whenever something that counts
// changes (a verification, an import, a cert edit) and for everyone on a
// timer, because time-at-level requirements come due with no new records.

import { and, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import { db } from "./db";
import {
  appSettings,
  certifications,
  certMilestones,
  entries,
  notifications,
  organizationMembers,
  organizations,
  ropeHours,
  users,
  type Notification,
} from "@shared/schema";
import {
  DEFAULT_NDT_REQUIREMENTS,
  FIXED_TRACK_RULES,
  NDT_REQUIREMENTS_KEY,
  allTrackProgress,
  buildTrackRules,
  levelLabel,
  milestoneTrackKey,
  ndtRequirementsSchema,
  orgRequirementsKey,
  type ActivityRow,
  type NdtRequirements,
  type ProgressBoard,
  type ProgressInputs,
  type ProgressScope,
  type RequirementProgress,
  type RequirementsResponse,
  type TrackProgress,
  type TrackRules,
} from "@shared/certProgress";
import { sendCertEligibleEmail } from "./email";

// ---- NDT requirements (admin-editable) ----

const parseRequirements = (value: unknown): NdtRequirements | null => {
  const parsed = ndtRequirementsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export async function getRequirements(orgId: number | null): Promise<RequirementsResponse> {
  const keys = orgId ? [orgRequirementsKey(orgId), NDT_REQUIREMENTS_KEY] : [NDT_REQUIREMENTS_KEY];
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, keys));
  const value = (key: string) => parseRequirements(rows.find((r) => r.key === key)?.value);
  const siteDefault = value(NDT_REQUIREMENTS_KEY) ?? DEFAULT_NDT_REQUIREMENTS;
  if (!orgId) return { requirements: siteDefault, custom: true };
  const own = value(orgRequirementsKey(orgId));
  return own ? { requirements: own, custom: true } : { requirements: siteDefault, custom: false };
}

export async function saveRequirements(orgId: number | null, value: NdtRequirements, updatedBy: number) {
  const key = orgId ? orgRequirementsKey(orgId) : NDT_REQUIREMENTS_KEY;
  await db
    .insert(appSettings)
    .values({ key, value, updatedBy, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy, updatedAt: new Date() } });
  return value;
}

// An org goes back to using the site default.
export async function clearOrgRequirements(orgId: number) {
  await db.delete(appSettings).where(eq(appSettings.key, orgRequirementsKey(orgId)));
}

// ---- Loading records ----

type UserRow = { id: number; name: string | null; email: string; employeeNumber: string | null; isAdmin: boolean | null };

async function loadInputs(userIds?: number[]) {
  const byUser = <T extends { userId: number }>(rows: T[]) => {
    const m = new Map<number, T[]>();
    for (const r of rows) m.set(r.userId, [...(m.get(r.userId) ?? []), r]);
    return m;
  };
  const scope = <C extends typeof entries.userId | typeof ropeHours.userId | typeof certifications.userId>(col: C) =>
    userIds ? inArray(col, userIds) : undefined;
  if (userIds && userIds.length === 0) userIds = [-1];
  const [userRows, entryRows, ropeRows, certRows, memberRows, orgRows, settingRows] = await Promise.all([
    db
      .select({ id: users.id, name: users.name, email: users.email, employeeNumber: users.employeeNumber, isAdmin: users.isAdmin })
      .from(users)
      .where(userIds ? inArray(users.id, userIds) : undefined),
    db.select().from(entries).where(scope(entries.userId)),
    db.select().from(ropeHours).where(scope(ropeHours.userId)),
    db.select().from(certifications).where(scope(certifications.userId)),
    // All active memberships (small): needed both for scopes and for finding
    // org admins to notify.
    db.select().from(organizationMembers).where(eq(organizationMembers.status, "active")),
    db.select({ id: organizations.id, name: organizations.name }).from(organizations),
    db.select().from(appSettings).where(like(appSettings.key, `${NDT_REQUIREMENTS_KEY}%`)),
  ]);

  const siteDefault = parseRequirements(settingRows.find((r) => r.key === NDT_REQUIREMENTS_KEY)?.value) ?? DEFAULT_NDT_REQUIREMENTS;
  const orgRequirements = new Map<number, NdtRequirements>();
  for (const o of orgRows) {
    const own = parseRequirements(settingRows.find((r) => r.key === orgRequirementsKey(o.id))?.value);
    if (own) orgRequirements.set(o.id, own);
  }
  const orgsOfUser = new Map<number, number[]>();
  const orgAdmins = new Map<number, number[]>();
  for (const m of memberRows) {
    orgsOfUser.set(m.userId, [...(orgsOfUser.get(m.userId) ?? []), m.organizationId]);
    if (m.role === "admin") orgAdmins.set(m.organizationId, [...(orgAdmins.get(m.organizationId) ?? []), m.userId]);
  }

  return {
    users: userRows as UserRow[],
    entries: byUser(entryRows),
    ropeHours: byUser(ropeRows),
    certs: byUser(certRows),
    siteDefault,
    orgRequirements,
    orgNames: new Map(orgRows.map((o) => [o.id, o.name])),
    orgsOfUser,
    orgAdmins,
  };
}

type Loaded = Awaited<ReturnType<typeof loadInputs>>;

const inputsFor = (data: Loaded, userId: number): ProgressInputs => ({
  certs: data.certs.get(userId) ?? [],
  entries: data.entries.get(userId) ?? [],
  ropeHours: data.ropeHours.get(userId) ?? [],
});

const displayName = (u: { name: string | null; email: string }) => u.name?.trim() || u.email;

const ROPE_RULES = [FIXED_TRACK_RULES.SPRAT, FIXED_TRACK_RULES.IRATA];
const ndtRules = (reqs: NdtRequirements): TrackRules[] => buildTrackRules(reqs).filter((r) => r.source.kind === "ojt");

// The NDT requirement sets a user is measured against. `onlyOrg` narrows to
// one organization's view (its own requirements, or the default it uses).
function scopesFor(data: Loaded, userId: number, onlyOrg?: number) {
  const orgIds = onlyOrg ? [onlyOrg] : data.orgsOfUser.get(userId) ?? [];
  const scopes: { scope: ProgressScope; requirements: NdtRequirements }[] = [];
  let usesDefault = orgIds.length === 0;
  for (const orgId of orgIds) {
    const own = data.orgRequirements.get(orgId);
    if (own) scopes.push({ scope: { orgId, orgName: data.orgNames.get(orgId) ?? "Organization" }, requirements: own });
    else usesDefault = true;
  }
  if (usesDefault) scopes.unshift({ scope: null, requirements: data.siteDefault });
  return scopes;
}

function progressFor(data: Loaded, userId: number, now: Date, onlyOrg?: number): TrackProgress[] {
  const inputs = inputsFor(data, userId);
  const out = allTrackProgress(ROPE_RULES, inputs, now);
  for (const { scope, requirements } of scopesFor(data, userId, onlyOrg)) {
    out.push(...allTrackProgress(ndtRules(requirements), inputs, now, scope));
  }
  return out;
}

// ---- Admin board ----

const DAY_MS = 86_400_000;

function activityFor(data: Loaded, u: UserRow, now: Date): ActivityRow {
  const cutoff = now.getTime() - 30 * DAY_MS;
  const last30 = { ojtHours: 0, ropeHours: 0 };
  const totals = { ojtHours: 0, ropeHours: 0 };
  let lastLogged = 0;
  let pendingSignatures = 0;
  for (const e of data.entries.get(u.id) ?? []) {
    if (new Date(e.date).getTime() >= cutoff) last30.ojtHours += e.hours;
    if (e.verified) totals.ojtHours += e.hours;
    else pendingSignatures++;
    lastLogged = Math.max(lastLogged, new Date(e.createdAt ?? e.date).getTime());
  }
  for (const r of data.ropeHours.get(u.id) ?? []) {
    if (new Date(r.startDate).getTime() >= cutoff) last30.ropeHours += r.hours;
    if (r.verified) totals.ropeHours += r.hours;
    else pendingSignatures++;
    lastLogged = Math.max(lastLogged, new Date(r.createdAt ?? r.startDate).getTime());
  }
  return {
    userId: u.id,
    name: displayName(u),
    email: u.email,
    employeeNumber: u.employeeNumber,
    lastLoggedAt: lastLogged ? new Date(lastLogged).toISOString() : null,
    last30,
    pendingSignatures,
    totals,
  };
}

// Everyone (site admins), or one organization's active members (org admins).
export async function buildProgressBoard(opts: { orgId?: number } = {}, now: Date = new Date()): Promise<ProgressBoard> {
  let memberIds: number[] | undefined;
  if (opts.orgId) {
    const members = await db
      .select({ userId: organizationMembers.userId })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, opts.orgId), eq(organizationMembers.status, "active")));
    memberIds = members.map((m) => m.userId);
  }
  const data = await loadInputs(memberIds);
  const rows: ProgressBoard["rows"] = [];
  const activity: ActivityRow[] = [];
  const trackHours: Record<string, number> = {};
  for (const u of data.users) {
    const hasRecords = data.entries.has(u.id) || data.ropeHours.has(u.id);
    // Accounts with nothing logged are office users, not technicians.
    if ((u.isAdmin || opts.orgId) && !hasRecords && !data.certs.has(u.id)) continue;
    activity.push(activityFor(data, u, now));
    for (const e of data.entries.get(u.id) ?? []) {
      if (e.verified) trackHours[`NDT:${e.method}`] = (trackHours[`NDT:${e.method}`] ?? 0) + e.hours;
    }
    for (const r of data.ropeHours.get(u.id) ?? []) {
      if (!r.verified) continue;
      for (const t of ROPE_RULES) trackHours[t.track] = (trackHours[t.track] ?? 0) + r.hours;
    }
    for (const p of progressFor(data, u.id, now, opts.orgId)) {
      if (p.nextLevel === null || p.blocked) continue;
      if (!p.qualified && p.percent <= 0) continue;
      rows.push({ ...p, userId: u.id, name: displayName(u), email: u.email, employeeNumber: u.employeeNumber });
    }
  }
  rows.sort((a, b) => Number(b.qualified) - Number(a.qualified) || b.percent - a.percent || a.name.localeCompare(b.name));
  activity.sort((a, b) => (b.lastLoggedAt ?? "").localeCompare(a.lastLoggedAt ?? "") || a.name.localeCompare(b.name));
  return { rows, activity, trackHours };
}

export async function userProgress(userId: number, now: Date = new Date(), onlyOrg?: number): Promise<TrackProgress[]> {
  const data = await loadInputs([userId]);
  return progressFor(data, userId, now, onlyOrg);
}

// ---- Milestones + notifications ----

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
export const requirementLine = (r: RequirementProgress) => `${r.label}: ${fmt(r.current)} / ${fmt(r.target)} ${r.unit}`;

// Organizations whose admins should hear about this milestone.
function orgsToNotify(data: Loaded, userId: number, p: TrackProgress): number[] {
  if (p.scope) return [p.scope.orgId];
  const orgIds = data.orgsOfUser.get(userId) ?? [];
  if (p.track.startsWith("NDT:")) return orgIds.filter((o) => !data.orgRequirements.has(o));
  return orgIds;
}

async function notifyAdmins(data: Loaded, technician: UserRow, p: TrackProgress) {
  const orgAdminIds = orgsToNotify(data, technician.id, p).flatMap((o) => data.orgAdmins.get(o) ?? []);
  const recipients = await db
    .select({ id: users.id, email: users.email, isAdmin: users.isAdmin })
    .from(users)
    .where(orgAdminIds.length ? or(eq(users.isAdmin, true), inArray(users.id, orgAdminIds)) : eq(users.isAdmin, true));
  if (!recipients.length) return;
  const certification = `${p.trackLabel} ${levelLabel(p.nextLevel!)}${p.scope ? ` (${p.scope.orgName})` : ""}`;
  const name = displayName(technician);
  const lines = p.requirements.map(requirementLine);
  const linkFor = (r: { isAdmin: boolean | null }) => (r.isAdmin ? "/admin" : "/organizations");
  await db.insert(notifications).values(
    recipients.map((r) => ({
      userId: r.id,
      kind: "cert_eligible",
      title: `${name} qualifies for ${certification}`,
      body: lines.join(" · "),
      link: linkFor(r),
      subjectUserId: technician.id,
    })),
  );
  // Email is best-effort: without RESEND_API_KEY sendEmail just returns false.
  await Promise.all(
    recipients.map((r) =>
      sendCertEligibleEmail(r.email, { technician: name, certification, requirements: lines, link: linkFor(r) }),
    ),
  );
}

// Record (once) every level a user has newly become eligible for and alert
// the admins. Returns the progress entries that triggered an alert.
async function recordMilestones(data: Loaded, u: UserRow, now: Date) {
  const fired: TrackProgress[] = [];
  for (const p of progressFor(data, u.id, now)) {
    if (!p.qualified || p.nextLevel === null) continue;
    const inserted = await db
      .insert(certMilestones)
      .values({ userId: u.id, track: milestoneTrackKey(p), level: p.nextLevel, reachedAt: now })
      .onConflictDoNothing()
      .returning({ id: certMilestones.id });
    if (!inserted.length) continue;
    await notifyAdmins(data, u, p);
    fired.push(p);
  }
  return fired;
}

export async function checkProgress(userIds?: number[], now: Date = new Date()) {
  const data = await loadInputs(userIds);
  const fired: { userId: number; progress: TrackProgress }[] = [];
  for (const u of data.users) {
    for (const p of await recordMilestones(data, u, now)) fired.push({ userId: u.id, progress: p });
  }
  return fired;
}

// Fire-and-forget re-check after a write; never fails the request.
export function queueProgressCheck(userId: number | null | undefined) {
  if (!userId) return;
  checkProgress([userId]).catch((err) => console.error("Progress check failed:", err));
}

let sweepTimer: NodeJS.Timeout | null = null;
export function startProgressSweep(intervalMs = 6 * 60 * 60 * 1000) {
  if (sweepTimer || process.env.VITEST) return;
  const run = () => checkProgress().catch((err) => console.error("Progress sweep failed:", err));
  setTimeout(run, 15_000).unref();
  sweepTimer = setInterval(run, intervalMs);
  sweepTimer.unref();
}

export async function listNotifications(userId: number, limit = 30): Promise<{ items: Notification[]; unread: number }> {
  const [items, [{ count }]] = await Promise.all([
    db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(limit),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
  ]);
  return { items, unread: count };
}

export async function markNotificationsRead(userId: number, id?: number) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), id ? eq(notifications.id, id) : undefined));
}
