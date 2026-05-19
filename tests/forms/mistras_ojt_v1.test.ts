import { describe, it, expect } from "vitest";
import type { Entry, User } from "@shared/schema";
import { mistrasAdapter } from "../../server/forms/adapters/mistras_ojt_v1";

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
