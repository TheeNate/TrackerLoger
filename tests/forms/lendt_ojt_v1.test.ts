import { describe, it, expect } from "vitest";
import type { Entry, User } from "@shared/schema";
import { lendtAdapter } from "../../server/forms/adapters/lendt_ojt_v1";
import path from "path";
import { promises as fs } from "fs";
import { EmptyExportError, NothingToExportError } from "../../server/forms/types";
import { PDFDocument } from "pdf-lib";
import { fillForm, fillFormPages } from "../../server/forms/filler";

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

describe("lendtAdapter — core mapping", () => {
  it("fills header from profile", () => {
    const [out] = lendtAdapter({
      entries: [makeEntry({})],
      profile: makeProfile(),
    });
    expect(out.employee_name).toBe("Jane Tech");
    expect(out.employee_number).toBe("EMP-001");
    expect(out.employee_signature).toBe("Jane Tech");
    expect(out.signature_date).toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}$/);
  });

  it("writes a row for each entry with date M/d/yyyy and method cell", () => {
    const [out] = lendtAdapter({
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

  it("sorts rows by date regardless of input order", () => {
    const [out] = lendtAdapter({
      entries: [
        makeEntry({ id: 1, date: new Date("2026-05-09T00:00:00Z"), location: "Later" }),
        makeEntry({ id: 2, date: new Date("2026-05-02T00:00:00Z"), location: "Earlier" }),
      ],
      profile: makeProfile(),
    });
    expect(out.row_1_location).toBe("Earlier");
    expect(out.row_2_location).toBe("Later");
  });

  it.each(["MT", "PT", "UT", "VT_1", "VT_2", "VT_3", "VWE"])("has its own column for %s", (method) => {
    const [out] = lendtAdapter({
      entries: [makeEntry({ method, hours: 3 })],
      profile: makeProfile(),
    });
    expect(out[`row_1_${method}`]).toBe("3");
    expect(out[`total_${method}`]).toBe("3");
  });

  it("puts legacy plain VT rows in the VT_2 column", () => {
    const [out] = lendtAdapter({
      entries: [makeEntry({ method: "VT", hours: 2 })],
      profile: makeProfile(),
    });
    expect(out.row_1_VT_2).toBe("2");
    expect(out.row_1_VT).toBeUndefined();
  });

  it("keeps VWE separate from the VT levels", () => {
    const [out] = lendtAdapter({
      entries: [
        makeEntry({ id: 1, date: new Date("2026-05-04T00:00:00Z"), method: "VWE", hours: 5 }),
        makeEntry({ id: 2, date: new Date("2026-05-05T00:00:00Z"), method: "VT_2", hours: 2 }),
      ],
      profile: makeProfile(),
    });
    expect(out.row_1_VWE).toBe("5");
    expect(out.row_1_VT_2).toBeUndefined();
    expect(out.row_2_VT_2).toBe("2");
    expect(out.row_2_VWE).toBeUndefined();
  });

  it("populates row supervisor from verifiedBy", () => {
    const [out] = lendtAdapter({
      entries: [makeEntry({ verifiedBy: "Supervisor Sam" })],
      profile: makeProfile(),
    });
    expect(out.row_1_supervisor).toBe("Supervisor Sam");
  });

  it("applies headerOverrides on top of profile defaults", () => {
    const [out] = lendtAdapter({
      entries: [makeEntry({})],
      profile: makeProfile(),
      headerOverrides: { employee_signature: "J. Tech (signed)" },
    });
    expect(out.employee_signature).toBe("J. Tech (signed)");
    expect(out.employee_name).toBe("Jane Tech"); // unchanged
  });
});

describe("lendtAdapter — bounds and unmapped methods", () => {
  it("throws EmptyExportError on zero entries", () => {
    expect(() => lendtAdapter({ entries: [], profile: makeProfile() }))
      .toThrow(EmptyExportError);
  });

  it("paginates more than 16 entries across multiple pages (16 + remainder)", () => {
    const entries = Array.from({ length: 40 }, (_, i) =>
      makeEntry({ id: i + 1, method: "MT", date: new Date(`2026-05-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`) }));
    const pages = lendtAdapter({ entries, profile: makeProfile() });
    expect(pages).toHaveLength(3); // 16 + 16 + 8
    // Each page restarts row numbering at 1 and repeats the header.
    expect(pages[0].row_16_date).toBeDefined();
    expect(pages[0].row_1_date).toBeDefined();
    expect(pages[2].row_8_date).toBeDefined();
    expect(pages[2].row_9_date).toBeUndefined();
    expect(pages[2].employee_name).toBe("Jane Tech");
  });

  it("throws NothingToExportError when every entry uses a method the form lacks", () => {
    expect(() => lendtAdapter({
      entries: [
        makeEntry({ id: 1, method: "ET" }),
        makeEntry({ id: 2, method: "UT_THK" }),
        makeEntry({ id: 3, method: "RT" }),
      ],
      profile: makeProfile(),
    })).toThrow(NothingToExportError);
  });

  it("keeps the row (date+location+supervisor) when method is unmapped", () => {
    const [out] = lendtAdapter({
      entries: [
        makeEntry({ id: 1, method: "MT", hours: 2 }),
        makeEntry({ id: 2, method: "RT", hours: 3, location: "Plant Z" }),
      ],
      profile: makeProfile(),
    });
    expect(out.row_2_date).toBeDefined();
    expect(out.row_2_location).toBe("Plant Z");
    expect(out.row_2_RT).toBeUndefined();
    expect(out.total_RT).toBeUndefined();
  });

  it("sums hours by column across rows for totals", () => {
    const [out] = lendtAdapter({
      entries: [
        makeEntry({ id: 1, method: "MT", hours: 2 }),
        makeEntry({ id: 2, method: "MT", hours: 3 }),
        makeEntry({ id: 3, method: "VT_1", hours: 1.5 }),
        makeEntry({ id: 4, method: "VT_1", hours: 2 }),
      ],
      profile: makeProfile(),
    });
    expect(out.total_MT).toBe("5");
    expect(out.total_VT_1).toBe("3.5");
  });
});

const LENDT_BLANK = path.resolve(
  __dirname, "..", "..", "server", "forms", "blanks", "LeNDT_OJT_Fillable.pdf",
);

describe("lendtAdapter — round-trip through filler", () => {
  it("the blank carries exactly the MT, PT, UT, VT-1/2/3 and VWE method columns", async () => {
    const doc = await PDFDocument.load(await fs.readFile(LENDT_BLANK));
    const names = doc.getForm().getFields().map((f) => f.getName());
    const totals = names.filter((n) => n.startsWith("total_")).sort();
    expect(totals).toEqual(
      ["MT", "PT", "UT", "VT_1", "VT_2", "VT_3", "VWE"].map((c) => `total_${c}`).sort(),
    );
  });

  it("every field the adapter writes reads back identical from the filled PDF", async () => {
    const profile = makeProfile({ name: "Round Trip", employeeNumber: "RT-007" });
    const entries = [
      makeEntry({ id: 1, date: new Date("2026-05-04T00:00:00Z"), method: "MT",   hours: 4,   location: "Site A", verifiedBy: "Sup A" }),
      makeEntry({ id: 2, date: new Date("2026-05-05T00:00:00Z"), method: "UT",   hours: 2.5, location: "Site B", verifiedBy: "Sup B" }),
      makeEntry({ id: 3, date: new Date("2026-05-06T00:00:00Z"), method: "VWE",  hours: 1,   location: "Site C" }),
      makeEntry({ id: 4, date: new Date("2026-05-07T00:00:00Z"), method: "VT_3", hours: 3,   location: "Site D" }),
      makeEntry({ id: 5, date: new Date("2026-05-08T00:00:00Z"), method: "VT",   hours: 6,   location: "Site E" }),
      makeEntry({ id: 6, date: new Date("2026-05-09T00:00:00Z"), method: "RT",   hours: 2,   location: "Site F" }),
    ];

    const [expected] = lendtAdapter({ entries, profile });
    const bytes = await fillForm(LENDT_BLANK, expected);

    const reopened = await PDFDocument.load(bytes);
    const form = reopened.getForm();

    for (const [name, value] of Object.entries(expected)) {
      // pdf-lib getText() returns undefined for empty fields; treat as ""
      const actual = form.getTextField(name).getText() ?? "";
      expect(actual, `field ${name}`).toBe(value);
    }
  });

  it("renders a 40-row export as 3 editable pages with per-page values intact", async () => {
    const profile = makeProfile({ name: "Multi Page", employeeNumber: "MP-1" });
    const entries = Array.from({ length: 40 }, (_, i) =>
      makeEntry({
        id: i + 1, method: "VWE", hours: 1,
        location: `Site ${i + 1}`,
        // Strictly increasing dates so sort order matches insertion order.
        date: new Date(Date.UTC(2026, 0, 1 + i)),
      }));

    const pages = lendtAdapter({ entries, profile });
    expect(pages).toHaveLength(3);

    const bytes = await fillFormPages(LENDT_BLANK, pages);
    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getPageCount()).toBe(3);

    const form = reopened.getForm();
    // Fields are renamed per page (<name>__pg<N>) and stay editable.
    expect(form.getTextField("row_1_location__pg0").getText()).toBe("Site 1");
    expect(form.getTextField("row_16_location__pg1").getText()).toBe("Site 32");
    expect(form.getTextField("row_8_location__pg2").getText()).toBe("Site 40");
    expect(form.getTextField("employee_name__pg2").getText()).toBe("Multi Page");
  });
});
