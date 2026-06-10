import { describe, it, expect } from "vitest";
import path from "path";
import { PDFDocument } from "pdf-lib";
import type { Entry, User } from "@shared/schema";
import { cwAdapter } from "../../server/forms/adapters/curtiss_wright_wer_v1";
import { EmptyExportError, NothingToExportError } from "../../server/forms/types";
import { fillForm, fillFormPages } from "../../server/forms/filler";

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
    const [out] = cwAdapter({
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
    const [out] = cwAdapter({
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
    const [out] = cwAdapter({
      entries: [makeEntry({ method: "UT_THK", hours: 2 })],
      profile: makeProfile(),
    });
    expect(out.week1_monday_UTT).toBe("2");
    expect(out.week1_monday_UT_THK).toBeUndefined();
  });

  it("sums multiple same-day same-method entries into one cell", () => {
    const [out] = cwAdapter({
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
    const [out] = cwAdapter({
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
    const [out] = cwAdapter({
      entries: [makeEntry({})],
      profile: makeProfile({ name: "CW Tech" }),
    });
    expect(out.name).toBe("CW Tech");
    expect(out.job_number).toBe("");
  });

  it("applies headerOverrides on top of profile + computed week endings", () => {
    const [out] = cwAdapter({
      entries: [makeEntry({})],
      profile: makeProfile(),
      headerOverrides: { job_number: "JOB-99", name: "Override Tech" },
    });
    expect(out.name).toBe("Override Tech");
    expect(out.job_number).toBe("JOB-99");
  });
});

describe("cwAdapter — bounds and unmapped methods", () => {
  it("throws EmptyExportError on zero entries", () => {
    expect(() => cwAdapter({ entries: [], profile: makeProfile() }))
      .toThrow(EmptyExportError);
  });

  it("paginates a third calendar week onto a second page (2 weeks per page)", () => {
    const entries = [
      makeEntry({ id: 1, date: new Date("2026-05-04T00:00:00Z"), method: "MT", hours: 1 }),  // week 1
      makeEntry({ id: 2, date: new Date("2026-05-11T00:00:00Z"), method: "MT", hours: 1 }),  // week 2
      makeEntry({ id: 3, date: new Date("2026-05-18T00:00:00Z"), method: "MT", hours: 1 }),  // week 3
    ];
    const pages = cwAdapter({ entries, profile: makeProfile() });
    expect(pages).toHaveLength(2);
    expect(pages[0].week1_ending).toBe("05/09/2026");
    expect(pages[0].week2_ending).toBe("05/16/2026");
    // Week 3 spills onto page 2's week1 block; page 2 has no week2.
    expect(pages[1].week1_ending).toBe("05/23/2026");
    expect(pages[1].week2_ending).toBeUndefined();
    expect(pages[1].name).toBe("Jane Tech"); // header repeats per page
  });

  it("throws NothingToExportError when every entry uses an unsupported method", () => {
    expect(() => cwAdapter({
      entries: [
        makeEntry({ method: "ET" }),
        makeEntry({ method: "PMI" }),
        makeEntry({ method: "UT" }),
      ],
      profile: makeProfile(),
    })).toThrow(NothingToExportError);
  });

  it("skips unmapped methods silently when at least one mapped entry exists", () => {
    const [out] = cwAdapter({
      entries: [
        makeEntry({ id: 1, method: "MT",  hours: 2 }),
        makeEntry({ id: 2, method: "PMI", hours: 5 }), // unmapped — should be ignored
      ],
      profile: makeProfile(),
    });
    expect(out.week1_monday_MT).toBe("2");
    expect(out.week1_total_MT).toBe("2");
    expect(out.week1_total_TOTAL).toBe("2"); // PMI hours not included
  });

  it("leaves week2 fields entirely absent when only one week of entries", () => {
    const [out] = cwAdapter({
      entries: [makeEntry({ id: 1, method: "MT", hours: 2 })],
      profile: makeProfile(),
    });
    expect(out.week2_ending).toBeUndefined();
    expect(out.week2_monday_MT).toBeUndefined();
    expect(out.week2_total_TOTAL).toBeUndefined();
  });
});

const CW_BLANK = path.resolve(
  __dirname, "..", "..", "server", "forms", "blanks", "CurtissWright_WorkExperience_Fillable.pdf",
);

describe("cwAdapter — round-trip through filler", () => {
  it("every field the adapter writes reads back identical from the filled PDF", async () => {
    const profile = makeProfile({ name: "Round Trip" });
    const entries = [
      // Week ending 5/9 (UTC dates — Monday=5/4, Tuesday=5/5, Wednesday=5/6)
      makeEntry({ id: 1, date: new Date("2026-05-04T00:00:00Z"), method: "MT",     hours: 2 }),
      makeEntry({ id: 2, date: new Date("2026-05-05T00:00:00Z"), method: "UT_THK", hours: 3 }),  // → UTT
      makeEntry({ id: 3, date: new Date("2026-05-06T00:00:00Z"), method: "VT_2",   hours: 1 }),
      // Week ending 5/16
      makeEntry({ id: 4, date: new Date("2026-05-11T00:00:00Z"), method: "PT",     hours: 4 }),
      makeEntry({ id: 5, date: new Date("2026-05-13T00:00:00Z"), method: "VWE",    hours: 2 }),
    ];

    const [expected] = cwAdapter({ entries, profile, headerOverrides: { job_number: "JOB-42" } });
    const bytes = await fillForm(CW_BLANK, expected);

    const reopened = await PDFDocument.load(bytes);
    const form = reopened.getForm();

    for (const [name, value] of Object.entries(expected)) {
      const got = form.getTextField(name).getText() ?? "";
      expect(got, `field ${name}`).toBe(value);
    }
  });

  it("renders five calendar weeks as 3 editable pages (2 + 2 + 1)", async () => {
    // One mapped entry per week for 5 consecutive Mondays.
    const entries = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ id: i + 1, method: "MT", hours: 1, date: new Date(Date.UTC(2026, 4, 4 + i * 7)) }));

    const pages = cwAdapter({ entries, profile: makeProfile() });
    expect(pages).toHaveLength(3);

    const bytes = await fillFormPages(CW_BLANK, pages);
    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getPageCount()).toBe(3);

    const form = reopened.getForm();
    expect(form.getTextField("week1_ending__pg0").getText()).toBe("05/09/2026");
    expect(form.getTextField("week2_ending__pg1").getText()).toBe("05/30/2026");
    expect(form.getTextField("week1_ending__pg2").getText()).toBe("06/06/2026");
  });
});
