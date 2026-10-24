import { z } from "zod";
import { NDTMethods, ndtMethodLabel, type NDTMethod } from "./schema";

// Certification progress: how far each technician is from their next
// certification level, per track. SPRAT and IRATA rules are fixed by those
// bodies. NDT requirements (one track per method) are set by each employer's
// written practice, so they're editable: a site-wide default under
// NDT_REQUIREMENTS_KEY, and optionally a per-organization override under
// orgRequirementsKey(orgId). Both live in app_settings.
//
// Only verified records count toward a requirement (same rule as exports).
// Unverified records are reported as `pending` so admins can see what's
// waiting on a signature.

export const ROPE_TRACKS = ["SPRAT", "IRATA"] as const;
export type RopeTrack = (typeof ROPE_TRACKS)[number];

// Track ids: "SPRAT", "IRATA", or "NDT:<method>" (e.g. "NDT:UT_THK").
export const ndtTrackId = (method: NDTMethod) => `NDT:${method}`;
export const NDT_METHOD_KEYS = Object.keys(NDTMethods) as NDTMethod[];

export function trackLabel(track: string): string {
  if (track.startsWith("NDT:")) return ndtMethodLabel(track.slice(4));
  return track;
}

// What it takes to be eligible for `level`.
export type LevelRequirement = {
  level: number;
  hours: number;
  monthsAtPreviousLevel: number;
};

export type TrackRules = {
  track: string;
  source: { kind: "rope" } | { kind: "ojt"; method: NDTMethod };
  // "all": every verified record counts. "sinceCert": only records starting on
  // or after the current certificate's issue date (IRATA logs hours per level).
  countFrom: "all" | "sinceCert";
  // Rope access Level 1 is a training course with no logged-hours
  // prerequisite, so without a cert there's nothing to track toward.
  requiresStartingCert: boolean;
  levels: LevelRequirement[];
};

export const FIXED_TRACK_RULES: Record<RopeTrack, TrackRules> = {
  SPRAT: {
    track: "SPRAT",
    source: { kind: "rope" },
    countFrom: "all",
    requiresStartingCert: true,
    levels: [
      { level: 2, hours: 500, monthsAtPreviousLevel: 6 },
      { level: 3, hours: 1000, monthsAtPreviousLevel: 6 },
    ],
  },
  IRATA: {
    track: "IRATA",
    source: { kind: "rope" },
    countFrom: "sinceCert",
    requiresStartingCert: true,
    levels: [
      { level: 2, hours: 1000, monthsAtPreviousLevel: 12 },
      { level: 3, hours: 1000, monthsAtPreviousLevel: 12 },
    ],
  },
};

// ---- NDT requirements (admin-editable) ----

export const NDT_REQUIREMENTS_KEY = "ndt_ojt_requirements";
export const orgRequirementsKey = (orgId: number) => `${NDT_REQUIREMENTS_KEY}:org:${orgId}`;
export const MAX_NDT_LEVEL = 3;

const levelRequirementSchema = z.object({
  level: z.number().int().min(1).max(MAX_NDT_LEVEL),
  hours: z.number().min(0).max(100_000),
  monthsAtPreviousLevel: z.number().int().min(0).max(240),
});

// Per method, the levels that method tracks. A method that's missing or has
// no levels isn't tracked.
export const ndtRequirementsSchema = z
  .record(z.enum(NDT_METHOD_KEYS as [NDTMethod, ...NDTMethod[]]), z.array(levelRequirementSchema).max(MAX_NDT_LEVEL))
  .superRefine((reqs, ctx) => {
    for (const [method, levels] of Object.entries(reqs)) {
      if (new Set(levels!.map((l) => l.level)).size !== levels!.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [method], message: "Each level can only appear once" });
      }
    }
  });

export type NdtRequirements = z.infer<typeof ndtRequirementsSchema>;

// Placeholder numbers, not anyone's written practice; admins replace them on
// Admin → Requirements (site default) or on an organization's page.
export const DEFAULT_NDT_REQUIREMENTS: NdtRequirements = Object.fromEntries(
  NDT_METHOD_KEYS.map((m) => [
    m,
    [
      { level: 1, hours: 100, monthsAtPreviousLevel: 0 },
      { level: 2, hours: 300, monthsAtPreviousLevel: 0 },
    ],
  ]),
);

export function buildTrackRules(ndt: NdtRequirements = DEFAULT_NDT_REQUIREMENTS): TrackRules[] {
  const ndtRules = NDT_METHOD_KEYS.filter((m) => ndt[m]?.length).map(
    (method): TrackRules => ({
      track: ndtTrackId(method),
      source: { kind: "ojt", method },
      countFrom: "all",
      requiresStartingCert: false,
      levels: [...ndt[method]!].sort((a, b) => a.level - b.level),
    }),
  );
  return [FIXED_TRACK_RULES.SPRAT, FIXED_TRACK_RULES.IRATA, ...ndtRules];
}

// ---- Matching certifications to tracks ----

type CertLike = {
  name: string;
  method?: string | null;
  level?: string | null;
  issuingBody?: string | null;
  issueDate?: Date | string | null;
};

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3 };

// "Level II", "Level 3", "L2", "III", "2" → 2. Null if no level is readable.
export function parseCertLevel(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = text.trim().toLowerCase();
  const m = t.match(/(?:level|lvl|\bl)\s*-?\s*(iii|ii|i|[1-3])\b/) ?? t.match(/^(iii|ii|i|[1-3])$/);
  if (!m) return null;
  return ROMAN[m[1]] ?? Number(m[1]);
}

// "UT Thk." / "UT_THK" / "ut-thk" → "UTTHK"; "VT-2" → "VT2".
const normalizeMethod = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

// Spellings a certificate might use for a method. A plain "VT" cert covers
// every VT category.
function methodAliases(method: NDTMethod): string[] {
  const aliases = [normalizeMethod(method), normalizeMethod(ndtMethodLabel(method))];
  if (/^VT_\d$/.test(method)) aliases.push("VT");
  return aliases;
}

const ropeBody = (cert: CertLike) => {
  const body = `${cert.issuingBody ?? ""} ${cert.name}`.toLowerCase();
  return body.includes("sprat") ? "SPRAT" : body.includes("irata") ? "IRATA" : null;
};

export function certMatchesTrack(cert: CertLike, rules: TrackRules): boolean {
  const body = ropeBody(cert);
  if (rules.source.kind === "rope") return body === rules.track;
  // NDT certs come from ASNT or the employer (any name), never the rope bodies.
  if (body) return false;
  const aliases = methodAliases(rules.source.method);
  if (cert.method?.trim()) return aliases.includes(normalizeMethod(cert.method));
  return cert.name.split(/[\s,/()]+/).some((word) => word && aliases.includes(normalizeMethod(word)));
}

// Highest level held on a track, and when that certificate was issued.
export function currentCertOnTrack(
  certs: CertLike[],
  rules: TrackRules,
): { level: number; issueDate: Date | null } | null {
  let best: { level: number; issueDate: Date | null } | null = null;
  for (const c of certs) {
    if (!certMatchesTrack(c, rules)) continue;
    const level = parseCertLevel(c.level) ?? parseCertLevel(c.name);
    if (!level) continue;
    const issueDate = c.issueDate ? new Date(c.issueDate) : null;
    if (!best || level > best.level || (level === best.level && issueDate && (!best.issueDate || issueDate > best.issueDate))) {
      best = { level, issueDate };
    }
  }
  return best;
}

// ---- Progress ----

export type ProgressInputs = {
  certs: CertLike[];
  entries: { method: string; date: Date | string; hours: number; verified?: boolean | null }[];
  ropeHours: { startDate: Date | string; hours: number; verified?: boolean | null }[];
};

// Whose requirements a progress row was measured against. Null = the
// site-wide default (and always for SPRAT / IRATA, which are fixed).
export type ProgressScope = { orgId: number; orgName: string } | null;

export type RequirementProgress = {
  key: "hours" | "months";
  label: string;
  unit: string;
  current: number;
  pending: number;
  target: number;
  met: boolean;
  note?: string;
};

export type TrackProgress = {
  track: string;
  trackLabel: string;
  scope: ProgressScope;
  currentLevel: number; // 0 = none yet
  nextLevel: number | null; // null = at the top level
  requirements: RequirementProgress[];
  percent: number; // 0..1, mean of each requirement's capped completion
  qualified: boolean;
  blocked?: string; // why nothing can be tracked yet
};

// Calendar months, so "6 months" from Mar 31 lands on Sep 30.
export function addMonths(d: Date, months: number): Date {
  const out = new Date(d);
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, lastDay));
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function hoursOf(rules: TrackRules, inputs: ProgressInputs, since: Date | null) {
  let verified = 0;
  let pending = 0;
  const inScope = (d: Date | string) => !since || new Date(d) >= since;
  const add = (hours: number, isVerified: boolean | null | undefined) => {
    if (isVerified) verified += hours;
    else pending += hours;
  };
  if (rules.source.kind === "rope") {
    for (const r of inputs.ropeHours) if (inScope(r.startDate)) add(r.hours, r.verified);
  } else {
    const { method } = rules.source;
    for (const e of inputs.entries) if (e.method === method && inScope(e.date)) add(e.hours, e.verified);
  }
  return { verified, pending };
}

export const levelLabel = (n: number) => `Level ${["0", "I", "II", "III"][n] ?? n}`;

export function trackProgress(
  rules: TrackRules,
  inputs: ProgressInputs,
  now: Date = new Date(),
  scope: ProgressScope = null,
): TrackProgress {
  const held = currentCertOnTrack(inputs.certs, rules);
  const currentLevel = held?.level ?? 0;
  const base = { track: rules.track, trackLabel: trackLabel(rules.track), scope, currentLevel };
  const next = rules.levels.find((l) => l.level > currentLevel);
  if (!next) return { ...base, nextLevel: null, requirements: [], percent: 1, qualified: false };
  if (rules.requiresStartingCert && !held) {
    return {
      ...base,
      nextLevel: null,
      requirements: [],
      percent: 0,
      qualified: false,
      blocked: `No ${base.trackLabel} certificate on file`,
    };
  }

  const since = rules.countFrom === "sinceCert" ? held?.issueDate ?? null : null;
  const requirements: RequirementProgress[] = [];
  if (next.hours > 0) {
    const { verified, pending } = hoursOf(rules, inputs, since);
    requirements.push({
      key: "hours",
      label: rules.source.kind === "rope" ? "Rope hours" : "OJT hours",
      unit: "h",
      current: round1(verified),
      pending: round1(pending),
      target: next.hours,
      met: verified >= next.hours,
    });
  }

  if (next.monthsAtPreviousLevel > 0 && currentLevel > 0) {
    const req: RequirementProgress = {
      key: "months",
      label: `Time at ${levelLabel(currentLevel)}`,
      unit: "mo",
      current: 0,
      pending: 0,
      target: next.monthsAtPreviousLevel,
      met: false,
    };
    if (!held?.issueDate) {
      req.note = "Certificate issue date missing";
    } else {
      const due = addMonths(held.issueDate, next.monthsAtPreviousLevel);
      req.met = now >= due;
      const span = due.getTime() - held.issueDate.getTime();
      const elapsed = Math.max(0, now.getTime() - held.issueDate.getTime());
      req.current = req.met ? next.monthsAtPreviousLevel : round1((elapsed / span) * next.monthsAtPreviousLevel);
      if (!req.met) req.note = `Eligible ${due.toISOString().slice(0, 10)}`;
    }
    requirements.push(req);
  }

  const ratios = requirements.map((r) => (r.met ? 1 : Math.min(r.current / r.target, 1)));
  const percent = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0;
  return {
    ...base,
    nextLevel: next.level,
    requirements,
    percent,
    qualified: requirements.length > 0 && requirements.every((r) => r.met),
  };
}

export function allTrackProgress(
  rules: TrackRules[],
  inputs: ProgressInputs,
  now: Date = new Date(),
  scope: ProgressScope = null,
): TrackProgress[] {
  return rules.map((r) => trackProgress(r, inputs, now, scope));
}

// Milestones are stored per scope, so an org's own requirements alert once
// under that org even if the site default already fired.
export const milestoneTrackKey = (p: Pick<TrackProgress, "track" | "scope">) =>
  p.scope ? `${p.track}@org:${p.scope.orgId}` : p.track;

// ---- API shapes ----

export type ProgressBoardRow = TrackProgress & {
  userId: number;
  name: string;
  email: string;
  employeeNumber: string | null;
};

export type ActivityRow = {
  userId: number;
  name: string;
  email: string;
  employeeNumber: string | null;
  lastLoggedAt: string | null; // when they last added a record (ISO)
  last30: { ojtHours: number; ropeHours: number };
  pendingSignatures: number; // records not yet verified
  totals: { ojtHours: number; ropeHours: number }; // verified
};

export type ProgressBoard = {
  rows: ProgressBoardRow[]; // every user × track with a next level, best first
  activity: ActivityRow[];
  // Verified hours per track across the board's technicians, so the UI can
  // put the busiest methods first in its filter.
  trackHours: Record<string, number>;
};

export type RequirementsResponse = {
  requirements: NdtRequirements;
  custom: boolean; // false = an org using the site default
};
