import { describe, it, expect } from "vitest";
import type { Entry, User } from "@shared/schema";
import { mistrasAdapter } from "../../server/forms/adapters/mistras_ojt_v1";
import { FormCapacityError, EmptyExportError, NothingToExportError } from "../../server/forms/types";
import path from "path";
import { PDFDocument } from "pdf-lib";
import { fillForm } from "../../server/forms/filler";

function makeProfile(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    email: "tech@example.com",
    password: null,
    name: "Jane Tech",
    employeeNumber: "EMP-001",
    isAdmin: false,
    resetToken: null,
    resetTokenExpiry: null,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  } as User;
}

function makeEntry(overrides: Partial<Entry>): Entry {
  return {
    id: 1, userId: 1,
    date: new Date("2026-05-04T00:00:00Z"),
    location: "Plant A",
    method: "MT",
    hours: 4,
    verified: false, verifiedBy: null, verificationToken: null, verifiedAt: null,
    createdAt: new Date("2026-05-04T00:00:00Z"),
    technicianSignature: null, supervisorSignature: null, dataHash: null,
    integritySignature: null, verificationRequestedAt: null, auditTrail: null,
    supervisorIpAddress: null, supervisorBrowserInfo: null, employeeIdUsed: null,
    sourceDocumentKey: null, sourceDocumentName: null, importedAt: null,
    ...overrides,
  } as Entry;
}

describe("mistrasAdapter — core mapping", () => {
  it("fills header from profile", () => {
    const out = mistrasAdapter({
      entries: [makeEntry({})],
      profile: makeProfile(),
    });
    expect(out.employee_name).toBe("Jane Tech");
    expect(out.employee_number).toBe("EMP-001");
    expect(out.employee_signature).toBe("Jane Tech");
    expect(out.signature_date).toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}$/);
  });

  it("writes a row for each entry with date M/d/yyyy and method cell", () => {
    const out = mistrasAdapter({
      entries: [
        makeEntry({ id: 1, date: new Date("2026-05-04T00:00:00Z"), method: "MT", hours: 4, location: "Plant A" }),
        makeEntry({ id: 2, date: new Date("2026-05-05T00:00:00Z"), method: "PT", hours: 2, location: "Plant B" }),
      ],
      profile: makeProfile(),
    });
    expect(out.row_1_date).toBe("5/4/2026");
    expect(out.row_1_location).toBe("Plant A");
    expect(out.row_1_MT).toBe("4");
    expect(out.row_2_date).toBe("5/5/2026");
    expect(out.row_2_PT).toBe("2");
  });

  it("aliases UT_THK to UT_thk column", () => {
    const out = mistrasAdapter({
      entries: [makeEntry({ method: "UT_THK", hours: 3 })],
      profile: makeProfile(),
    });
    expect(out.row_1_UT_thk).toBe("3");
    expect(out.row_1_UT_THK).toBeUndefined();
  });

  it("populates row supervisor from verifiedBy", () => {
    const out = mistrasAdapter({
      entries: [makeEntry({ verifiedBy: "Supervisor Sam" })],
      profile: makeProfile(),
    });
    expect(out.row_1_supervisor).toBe("Supervisor Sam");
  });

  it("applies headerOverrides on top of profile defaults", () => {
    const out = mistrasAdapter({
      entries: [makeEntry({})],
      profile: makeProfile(),
      headerOverrides: { employee_signature: "J. Tech (signed)" },
    });
    expect(out.employee_signature).toBe("J. Tech (signed)");
    expect(out.employee_name).toBe("Jane Tech"); // unchanged
  });
});

describe("mistrasAdapter — bounds and unmapped methods", () => {
  it("throws EmptyExportError on zero entries", () => {
    expect(() => mistrasAdapter({ entries: [], profile: makeProfile() }))
      .toThrow(EmptyExportError);
  });

  it("throws FormCapacityError on more than 16 entries", () => {
    const entries = Array.from({ length: 17 }, (_, i) =>
      makeEntry({ id: i + 1, date: new Date(`2026-05-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`) }));
    expect(() => mistrasAdapter({ entries, profile: makeProfile() }))
      .toThrowError(expect.objectContaining({
        name: "FormCapacityError",
        max: 16,
        got: 17,
        unit: "rows",
      }));
  });

  it("throws NothingToExportError when every entry is unmapped", () => {
    expect(() => mistrasAdapter({
      entries: [
        makeEntry({ method: "PMI" }),
        makeEntry({ method: "VT_1" }),
        makeEntry({ method: "UT" }),
      ],
      profile: makeProfile(),
    })).toThrow(NothingToExportError);
  });

  it("keeps the row (date+location+supervisor) when method is unmapped", () => {
    const out = mistrasAdapter({
      entries: [
        makeEntry({ id: 1, method: "MT", hours: 2 }),
        makeEntry({ id: 2, method: "PMI", hours: 3, location: "Plant Z" }),
      ],
      profile: makeProfile(),
    });
    expect(out.row_2_date).toBeDefined();
    expect(out.row_2_location).toBe("Plant Z");
    expect(out.row_2_PMI).toBeUndefined();
    expect(out.total_PMI).toBeUndefined();
  });

  it("sums hours by column across rows for totals", () => {
    const out = mistrasAdapter({
      entries: [
        makeEntry({ id: 1, method: "MT", hours: 2 }),
        makeEntry({ id: 2, method: "MT", hours: 3 }),
        makeEntry({ id: 3, method: "PT", hours: 1.5 }),
      ],
      profile: makeProfile(),
    });
    expect(out.total_MT).toBe("5");
    expect(out.total_PT).toBe("1.5");
  });
});

const MISTRAS_BLANK = path.resolve(
  __dirname, "..", "..", "server", "forms", "blanks", "MISTRAS_OJT_Fillable.pdf",
);

describe("mistrasAdapter — round-trip through filler", () => {
  it("every field the adapter writes reads back identical from the filled PDF", async () => {
    const profile = makeProfile({ name: "Round Trip", employeeNumber: "RT-007" });
    const entries = [
      makeEntry({ id: 1, date: new Date("2026-05-04T00:00:00Z"), method: "MT",      hours: 4,   location: "Site A", verifiedBy: "Sup A" }),
      makeEntry({ id: 2, date: new Date("2026-05-05T00:00:00Z"), method: "UT_THK",  hours: 2.5, location: "Site B", verifiedBy: "Sup B" }),
      makeEntry({ id: 3, date: new Date("2026-05-06T00:00:00Z"), method: "PMI",     hours: 1,   location: "Site C" }),
      makeEntry({ id: 4, date: new Date("2026-05-07T00:00:00Z"), method: "PAUT",    hours: 3,   location: "Site D" }),
    ];

    const expected = mistrasAdapter({ entries, profile });
    const bytes = await fillForm(MISTRAS_BLANK, expected);

    const reopened = await PDFDocument.load(bytes);
    const form = reopened.getForm();

    for (const [name, value] of Object.entries(expected)) {
      // pdf-lib getText() returns undefined for empty fields; treat as ""
      const actual = form.getTextField(name).getText() ?? "";
      expect(actual, `field ${name}`).toBe(value);
    }
  });
});
