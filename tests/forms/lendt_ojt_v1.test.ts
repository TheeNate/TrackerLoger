import { describe, it, expect } from "vitest";
import type { Entry, User } from "@shared/schema";
import { lendtAdapter, lendtColumnsFor } from "../../server/forms/adapters/lendt_ojt_v1";
import { buildLendtBlank } from "../../server/forms/lendt_blank";
import { registry } from "../../server/forms/registry";
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

  it.each([
    "ET", "RFT", "MT", "PT", "RT", "UT", "UT_THK", "UTSW", "PMI", "LSI", "PAUT",
    "VT_1", "VT_2", "VT_3", "VWE",
  ])("has its own column for %s", (method) => {
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
    expect(out.total_VWE).toBe("5");
    expect(out.total_VT_2).toBe("2");
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

  it("throws NothingToExportError when every entry is unmapped", () => {
    expect(() => lendtAdapter({
      entries: [makeEntry({ method: "NOT_A_METHOD" })],
      profile: makeProfile(),
    })).toThrow(NothingToExportError);
  });

  it("keeps the row (date+location+supervisor) when method is unmapped", () => {
    const [out] = lendtAdapter({
      entries: [
        makeEntry({ id: 1, method: "MT", hours: 2 }),
        makeEntry({ id: 2, method: "NOT_A_METHOD", hours: 3, location: "Plant Z" }),
      ],
      profile: makeProfile(),
    });
    expect(out.row_2_date).toBeDefined();
    expect(out.row_2_location).toBe("Plant Z");
    expect(out.row_2_NOT_A_METHOD).toBeUndefined();
    expect(out.total_NOT_A_METHOD).toBeUndefined();
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

describe("lendtColumnsFor — only methods with hours get a column", () => {
  it("returns just the methods present, in the form's fixed print order", () => {
    const columns = lendtColumnsFor([
      makeEntry({ id: 1, method: "VWE" }),
      makeEntry({ id: 2, method: "RT" }),
      makeEntry({ id: 3, method: "MT" }),
      makeEntry({ id: 4, method: "RT" }),
    ]);
    expect(columns).toEqual(["MT", "RT", "VWE"]);
  });

  it("gives each VT level its own column", () => {
    const columns = lendtColumnsFor([
      makeEntry({ id: 1, method: "VT_3" }),
      makeEntry({ id: 2, method: "VT_1" }),
      makeEntry({ id: 3, method: "VT_2" }),
    ]);
    expect(columns).toEqual(["VT_1", "VT_2", "VT_3"]);
  });

  it("counts legacy plain VT rows as VT_2", () => {
    expect(lendtColumnsFor([makeEntry({ method: "VT" })])).toEqual(["VT_2"]);
  });

  it("ignores methods the form has no column for", () => {
    expect(lendtColumnsFor([
      makeEntry({ id: 1, method: "NOT_A_METHOD" }),
      makeEntry({ id: 2, method: "PT" }),
    ])).toEqual(["PT"]);
  });
});

async function fieldNames(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getForm().getFields().map((f) => f.getName());
}

describe("buildLendtBlank — columns drawn per export", () => {
  it("creates row and total fields only for the requested columns", async () => {
    const names = await fieldNames(await buildLendtBlank(["MT", "RT", "VWE"]));

    for (const col of ["MT", "RT", "VWE"]) {
      expect(names).toContain(`row_1_${col}`);
      expect(names).toContain(`row_16_${col}`);
      expect(names).toContain(`total_${col}`);
    }
    for (const col of ["ET", "PT", "VT_1", "VT_2", "VT_3", "PMI"]) {
      expect(names).not.toContain(`row_1_${col}`);
      expect(names).not.toContain(`total_${col}`);
    }
    // header + signature (4) + 16 rows x (date, location, supervisor, 3 methods) + 3 totals
    expect(names).toHaveLength(4 + 16 * 6 + 3);
  });

  it("always keeps the header, row and signature fields", async () => {
    const names = await fieldNames(await buildLendtBlank(["PT"]));
    expect(names).toEqual(expect.arrayContaining([
      "employee_name", "employee_number", "employee_signature", "signature_date",
      "row_1_date", "row_1_location", "row_1_supervisor", "row_16_date",
    ]));
  });

  it("is a single landscape page", async () => {
    const doc = await PDFDocument.load(await buildLendtBlank(["PT"]));
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeGreaterThan(height);
  });
});

describe("Lê NDT export — round-trip through registry blank and filler", () => {
  const def = registry.lendt_ojt_v1;
  if (!("buildBlank" in def)) throw new Error("lendt_ojt_v1 must build its blank per export");

  it("every field the adapter writes reads back identical from the filled PDF", async () => {
    const profile = makeProfile({ name: "Round Trip", employeeNumber: "RT-007" });
    const entries = [
      makeEntry({ id: 1, date: new Date("2026-05-04T00:00:00Z"), method: "MT",      hours: 4,   location: "Site A", verifiedBy: "Sup A" }),
      makeEntry({ id: 2, date: new Date("2026-05-05T00:00:00Z"), method: "UT_THK",  hours: 2.5, location: "Site B", verifiedBy: "Sup B" }),
      makeEntry({ id: 3, date: new Date("2026-05-06T00:00:00Z"), method: "VWE",     hours: 1,   location: "Site C" }),
      makeEntry({ id: 4, date: new Date("2026-05-07T00:00:00Z"), method: "VT_2",    hours: 3,   location: "Site D" }),
      makeEntry({ id: 5, date: new Date("2026-05-08T00:00:00Z"), method: "VT",      hours: 6,   location: "Site E" }),
    ];

    const [expected] = lendtAdapter({ entries, profile });
    const bytes = await fillForm(await def.buildBlank(entries), expected);

    const reopened = await PDFDocument.load(bytes);
    const form = reopened.getForm();

    for (const [name, value] of Object.entries(expected)) {
      // pdf-lib getText() returns undefined for empty fields; treat as ""
      const actual = form.getTextField(name).getText() ?? "";
      expect(actual, `field ${name}`).toBe(value);
    }
    // No column for a method nobody logged.
    expect(form.getFieldMaybe("row_1_ET")).toBeUndefined();
  });

  it("uses one column set for every page of a long export", async () => {
    const profile = makeProfile({ name: "Multi Page", employeeNumber: "MP-1" });
    // 40 VWE rows, then a single RT row that lands on the last page.
    const entries = Array.from({ length: 41 }, (_, i) =>
      makeEntry({
        id: i + 1, method: i === 40 ? "RT" : "VWE", hours: 1,
        location: `Site ${i + 1}`,
        // Strictly increasing dates so sort order matches insertion order.
        date: new Date(Date.UTC(2026, 0, 1 + i)),
      }));

    const pages = lendtAdapter({ entries, profile });
    expect(pages).toHaveLength(3);

    const bytes = await fillFormPages(await def.buildBlank(entries), pages);
    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getPageCount()).toBe(3);

    const form = reopened.getForm();
    // Fields are renamed per page (<name>__pg<N>) and stay editable.
    expect(form.getTextField("row_1_location__pg0").getText()).toBe("Site 1");
    expect(form.getTextField("row_16_location__pg1").getText()).toBe("Site 32");
    expect(form.getTextField("row_9_RT__pg2").getText()).toBe("1");
    expect(form.getTextField("employee_name__pg2").getText()).toBe("Multi Page");
    // Page 1 has no RT hours but still carries the RT column.
    expect(form.getFieldMaybe("row_1_RT__pg0")).toBeDefined();
  });
});
