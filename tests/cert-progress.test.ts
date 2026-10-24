import { describe, it, expect } from "vitest";
import {
  addMonths,
  buildTrackRules,
  certMatchesTrack,
  currentCertOnTrack,
  DEFAULT_NDT_REQUIREMENTS,
  FIXED_TRACK_RULES,
  milestoneTrackKey,
  ndtRequirementsSchema,
  parseCertLevel,
  trackProgress,
  type NdtRequirements,
  type ProgressInputs,
  type TrackRules,
} from "../shared/certProgress";

const SPRAT = FIXED_TRACK_RULES.SPRAT;
const IRATA = FIXED_TRACK_RULES.IRATA;
const ndt = (method: string, reqs: NdtRequirements = DEFAULT_NDT_REQUIREMENTS): TrackRules =>
  buildTrackRules(reqs).find((r) => r.track === `NDT:${method}`)!;
const NOW = new Date("2026-10-24T12:00:00Z");
const d = (s: string) => new Date(`${s}T00:00:00Z`);

const empty: ProgressInputs = { certs: [], entries: [], ropeHours: [] };
const rope = (start: string, hours: number, verified = true) => ({ startDate: d(start), hours, verified });
const ojt = (method: string, hours: number, verified = true) => ({ method, date: d("2026-09-01"), hours, verified });

describe("parseCertLevel", () => {
  it("reads roman and arabic levels", () => {
    expect(parseCertLevel("Level I")).toBe(1);
    expect(parseCertLevel("Level II")).toBe(2);
    expect(parseCertLevel("level 3")).toBe(3);
    expect(parseCertLevel("L2")).toBe(2);
    expect(parseCertLevel("III")).toBe(3);
    expect(parseCertLevel("2")).toBe(2);
    expect(parseCertLevel("SPRAT Level III Technician")).toBe(3);
  });
  it("returns null when there's no level", () => {
    expect(parseCertLevel("Rope Access")).toBeNull();
    expect(parseCertLevel("")).toBeNull();
    expect(parseCertLevel(null)).toBeNull();
  });
});

describe("certMatchesTrack / currentCertOnTrack", () => {
  it("matches rope issuing bodies", () => {
    expect(certMatchesTrack({ name: "Rope tech", issuingBody: "SPRAT" }, SPRAT)).toBe(true);
    expect(certMatchesTrack({ name: "IRATA L1" }, IRATA)).toBe(true);
    expect(certMatchesTrack({ name: "IRATA L1" }, SPRAT)).toBe(false);
  });
  it("matches NDT methods however the cert spells them", () => {
    expect(certMatchesTrack({ name: "Thickness", method: "UT Thk.", issuingBody: "Employer" }, ndt("UT_THK"))).toBe(true);
    expect(certMatchesTrack({ name: "Thickness", method: "UT_THK", issuingBody: "ASNT" }, ndt("UT_THK"))).toBe(true);
    expect(certMatchesTrack({ name: "Thickness", method: "UT Thk.", issuingBody: "Employer" }, ndt("UT"))).toBe(false);
    expect(certMatchesTrack({ name: "Visual", method: "VT-2", issuingBody: "Employer" }, ndt("VT_2"))).toBe(true);
    expect(certMatchesTrack({ name: "Visual", method: "VT", issuingBody: "Employer" }, ndt("VT_3"))).toBe(true);
    expect(certMatchesTrack({ name: "ASNT MT Level II", issuingBody: "ASNT" }, ndt("MT"))).toBe(true);
    expect(certMatchesTrack({ name: "ASNT MT Level II", issuingBody: "ASNT" }, ndt("PT"))).toBe(false);
    expect(certMatchesTrack({ name: "First aid" }, ndt("MT"))).toBe(false);
  });
  it("never counts a rope cert toward an NDT method", () => {
    expect(certMatchesTrack({ name: "SPRAT Level 1", method: "Rope Access", issuingBody: "SPRAT" }, ndt("RT"))).toBe(false);
  });
  it("picks the highest level held", () => {
    const held = currentCertOnTrack(
      [
        { name: "SPRAT", issuingBody: "SPRAT", level: "Level I", issueDate: d("2024-01-01") },
        { name: "SPRAT", issuingBody: "SPRAT", level: "Level II", issueDate: d("2025-03-01") },
      ],
      SPRAT,
    );
    expect(held).toEqual({ level: 2, issueDate: d("2025-03-01") });
  });
});

describe("addMonths", () => {
  it("clamps to the end of shorter months", () => {
    expect(addMonths(d("2026-03-31"), 6)).toEqual(d("2026-09-30"));
    expect(addMonths(d("2026-01-15"), 12)).toEqual(d("2027-01-15"));
  });
});

describe("SPRAT", () => {
  const l1 = { name: "SPRAT", issuingBody: "SPRAT", level: "Level I", issueDate: d("2026-01-01") };

  it("needs a Level I cert before anything is tracked", () => {
    const p = trackProgress(SPRAT, { ...empty, ropeHours: [rope("2026-05-01", 600)] }, NOW);
    expect(p.blocked).toBeTruthy();
    expect(p.qualified).toBe(false);
  });

  it("qualifies for Level II at 500 verified hours and 6 months at Level I", () => {
    const p = trackProgress(SPRAT, { ...empty, certs: [l1], ropeHours: [rope("2026-02-01", 300), rope("2026-05-01", 200)] }, NOW);
    expect(p.nextLevel).toBe(2);
    expect(p.qualified).toBe(true);
    expect(p.percent).toBe(1);
  });

  it("does not count unverified hours, but reports them as pending", () => {
    const p = trackProgress(SPRAT, { ...empty, certs: [l1], ropeHours: [rope("2026-02-01", 400), rope("2026-05-01", 200, false)] }, NOW);
    const hours = p.requirements.find((r) => r.key === "hours")!;
    expect(hours).toMatchObject({ current: 400, pending: 200, target: 500, met: false });
    expect(p.qualified).toBe(false);
  });

  it("waits out the 6 months even with enough hours", () => {
    const recent = { ...l1, issueDate: d("2026-07-01") };
    const p = trackProgress(SPRAT, { ...empty, certs: [recent], ropeHours: [rope("2026-07-10", 520)] }, NOW);
    const months = p.requirements.find((r) => r.key === "months")!;
    expect(months.met).toBe(false);
    expect(months.note).toContain("2027-01-01");
    expect(p.qualified).toBe(false);
  });

  it("flags a missing issue date instead of guessing", () => {
    const p = trackProgress(SPRAT, { ...empty, certs: [{ ...l1, issueDate: null }], ropeHours: [rope("2026-02-01", 600)] }, NOW);
    expect(p.requirements.find((r) => r.key === "months")!.note).toMatch(/issue date/i);
    expect(p.qualified).toBe(false);
  });

  it("counts all career hours toward Level III (1000)", () => {
    const l2 = { name: "SPRAT", issuingBody: "SPRAT", level: "Level II", issueDate: d("2026-01-01") };
    const p = trackProgress(SPRAT, { ...empty, certs: [l2], ropeHours: [rope("2025-01-01", 600), rope("2026-02-01", 400)] }, NOW);
    expect(p.nextLevel).toBe(3);
    expect(p.qualified).toBe(true);
  });

  it("has nothing further at Level III", () => {
    const l3 = { name: "SPRAT", issuingBody: "SPRAT", level: "Level III", issueDate: d("2026-01-01") };
    expect(trackProgress(SPRAT, { ...empty, certs: [l3] }, NOW).nextLevel).toBeNull();
  });
});

describe("IRATA", () => {
  const l1 = { name: "IRATA", issuingBody: "IRATA", level: "Level 1", issueDate: d("2025-09-01") };

  it("needs 1000 hours logged since the current cert and 12 months at level", () => {
    const p = trackProgress(IRATA, { ...empty, certs: [l1], ropeHours: [rope("2025-01-01", 500), rope("2025-10-01", 900)] }, NOW);
    const hours = p.requirements.find((r) => r.key === "hours")!;
    expect(hours.current).toBe(900); // the 500 before the cert don't count
    expect(p.requirements.find((r) => r.key === "months")!.met).toBe(true);
    expect(p.qualified).toBe(false);
  });

  it("qualifies once both are met", () => {
    const p = trackProgress(IRATA, { ...empty, certs: [l1], ropeHours: [rope("2025-10-01", 1000)] }, NOW);
    expect(p.qualified).toBe(true);
  });
});

describe("NDT tracks", () => {
  it("tracks toward Level I with no cert, counting only that method's verified hours", () => {
    const p = trackProgress(ndt("MT"), { ...empty, entries: [ojt("MT", 60), ojt("MT", 20, false), ojt("PT", 500)] }, NOW);
    expect(p.currentLevel).toBe(0);
    expect(p.nextLevel).toBe(1);
    expect(p.requirements).toHaveLength(1); // placeholder default has no time-at-level
    expect(p.requirements[0]).toMatchObject({ key: "hours", current: 60, pending: 20, target: 100 });
    expect(p.percent).toBeCloseTo(0.6);
  });

  it("starts from the cert held", () => {
    const cert = { name: "MT", method: "MT", level: "Level I", issuingBody: "Employer", issueDate: d("2026-01-01") };
    const p = trackProgress(ndt("MT"), { ...empty, certs: [cert], entries: [ojt("MT", 310)] }, NOW);
    expect(p.currentLevel).toBe(1);
    expect(p.nextLevel).toBe(2);
    expect(p.qualified).toBe(true);
  });

  it("uses admin-edited requirements, including any number of levels and time at level", () => {
    const edited: NdtRequirements = {
      UT: [
        { level: 1, hours: 40, monthsAtPreviousLevel: 0 },
        { level: 2, hours: 120, monthsAtPreviousLevel: 3 },
        { level: 3, hours: 800, monthsAtPreviousLevel: 24 },
      ],
    };
    expect(trackProgress(ndt("UT", edited), { ...empty, entries: [ojt("UT", 45)] }, NOW).qualified).toBe(true);
    const cert = { name: "UT", method: "UT", level: "Level I", issueDate: d("2026-09-01") };
    const p = trackProgress(ndt("UT", edited), { ...empty, certs: [cert], entries: [ojt("UT", 200)] }, NOW);
    expect(p.requirements.map((r) => r.met)).toEqual([true, false]);
    expect(p.qualified).toBe(false);
  });

  it("leaves out methods with no levels", () => {
    const rules = buildTrackRules({ MT: [{ level: 1, hours: 10, monthsAtPreviousLevel: 0 }], PT: [] });
    expect(rules.map((r) => r.track)).toEqual(["SPRAT", "IRATA", "NDT:MT"]);
  });

  it("keys milestones per organization", () => {
    expect(milestoneTrackKey({ track: "NDT:MT", scope: null })).toBe("NDT:MT");
    expect(milestoneTrackKey({ track: "NDT:MT", scope: { orgId: 7, orgName: "Acme" } })).toBe("NDT:MT@org:7");
  });

  it("validates the requirements payload", () => {
    expect(ndtRequirementsSchema.safeParse(DEFAULT_NDT_REQUIREMENTS).success).toBe(true);
    expect(ndtRequirementsSchema.safeParse({ MT: [{ level: 1, hours: -5, monthsAtPreviousLevel: 0 }] }).success).toBe(false);
    expect(ndtRequirementsSchema.safeParse({ NOPE: [] }).success).toBe(false);
    const dup = [
      { level: 1, hours: 10, monthsAtPreviousLevel: 0 },
      { level: 1, hours: 20, monthsAtPreviousLevel: 0 },
    ];
    expect(ndtRequirementsSchema.safeParse({ MT: dup }).success).toBe(false);
  });
});
