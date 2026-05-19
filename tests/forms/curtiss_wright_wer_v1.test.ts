import { describe, it, expect } from "vitest";
import type { Entry, User } from "@shared/schema";
import { cwAdapter } from "../../server/forms/adapters/curtiss_wright_wer_v1";

function makeProfile(overrides: Partial<User> = {}): User {
  return {
    id: 1, email: "tech@example.com", password: null,
    name: "Jane Tech", employeeNumber: "EMP-001", isAdmin: false,
    resetToken: null, resetTokenExpiry: null,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  } as User;
}

function makeEntry(overrides: Partial<Entry>): Entry {
  return {
    id: 1, userId: 1,
    date: new Date("2026-05-04T00:00:00Z"), // Monday UTC
    location: "Plant A", method: "MT", hours: 4,
    verified: false, verifiedBy: null, verificationToken: null, verifiedAt: null,
    createdAt: new Date("2026-05-04T00:00:00Z"),
    technicianSignature: null, supervisorSignature: null, dataHash: null,
    integritySignature: null, verificationRequestedAt: null, auditTrail: null,
    supervisorIpAddress: null, supervisorBrowserInfo: null, employeeIdUsed: null,
    sourceDocumentKey: null, sourceDocumentName: null, importedAt: null,
    ...overrides,
  } as Entry;
}

describe("cwAdapter — week bucketing", () => {
  it("buckets Sunday and Saturday in the same Sun-Sat week", () => {
    // 2026-05-03 is Sunday UTC; 2026-05-09 is Saturday UTC — same week ending 5/9.
    const out = cwAdapter({
      entries: [
        makeEntry({ id: 1, date: new Date("2026-05-03T00:00:00Z"), method: "MT", hours: 2 }),
        makeEntry({ id: 2, date: new Date("2026-05-09T00:00:00Z"), method: "PT", hours: 3 }),
      ],
      profile: makeProfile(),
    });
    expect(out.week1_ending).toBe("05/09/2026");
    expect(out.week1_sunday_MT).toBe("2");
    expect(out.week1_saturday_PT).toBe("3");
    expect(out.week2_ending).toBeUndefined();
  });

  it("fills two weeks in chronological order", () => {
    const out = cwAdapter({
      entries: [
        makeEntry({ id: 1, date: new Date("2026-05-04T00:00:00Z"), method: "MT", hours: 2 }), // Mon, week of 5/3
        makeEntry({ id: 2, date: new Date("2026-05-11T00:00:00Z"), method: "PT", hours: 3 }), // Mon, week of 5/10
      ],
      profile: makeProfile(),
    });
    expect(out.week1_ending).toBe("05/09/2026");
    expect(out.week2_ending).toBe("05/16/2026");
    expect(out.week1_monday_MT).toBe("2");
    expect(out.week2_monday_PT).toBe("3");
  });

  it("aliases UT_THK to UTT column", () => {
    const out = cwAdapter({
      entries: [makeEntry({ method: "UT_THK", hours: 2 })],
      profile: makeProfile(),
    });
    expect(out.week1_monday_UTT).toBe("2");
    expect(out.week1_monday_UT_THK).toBeUndefined();
  });

  it("sums multiple same-day same-method entries into one cell", () => {
    const out = cwAdapter({
      entries: [
        makeEntry({ id: 1, date: new Date("2026-05-04T00:00:00Z"), method: "MT", hours: 2 }),
        makeEntry({ id: 2, date: new Date("2026-05-04T00:00:00Z"), method: "MT", hours: 1.5 }),
      ],
      profile: makeProfile(),
    });
    expect(out.week1_monday_MT).toBe("3.5");
    expect(out.week1_monday_TOTAL).toBe("3.5");
    expect(out.week1_total_MT).toBe("3.5");
  });

  it("populates per-week TOTAL row", () => {
    const out = cwAdapter({
      entries: [
        makeEntry({ id: 1, date: new Date("2026-05-04T00:00:00Z"), method: "MT", hours: 2 }),
        makeEntry({ id: 2, date: new Date("2026-05-05T00:00:00Z"), method: "PT", hours: 3 }),
      ],
      profile: makeProfile(),
    });
    expect(out.week1_monday_TOTAL).toBe("2");
    expect(out.week1_tuesday_TOTAL).toBe("3");
    expect(out.week1_total_MT).toBe("2");
    expect(out.week1_total_PT).toBe("3");
    expect(out.week1_total_TOTAL).toBe("5");
  });

  it("fills the name header from profile", () => {
    const out = cwAdapter({
      entries: [makeEntry({})],
      profile: makeProfile({ name: "CW Tech" }),
    });
    expect(out.name).toBe("CW Tech");
    expect(out.job_number).toBe("");
  });

  it("applies headerOverrides on top of profile + computed week endings", () => {
    const out = cwAdapter({
      entries: [makeEntry({})],
      profile: makeProfile(),
      headerOverrides: { job_number: "JOB-99", name: "Override Tech" },
    });
    expect(out.name).toBe("Override Tech");
    expect(out.job_number).toBe("JOB-99");
  });
});
