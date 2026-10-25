import { describe, it, expect } from "vitest";
import { parseEdition } from "../shared/edition";
import { ropeHoursCsv } from "../client/src/lib/ropeCsv";

describe("parseEdition", () => {
  it("is the full tracker unless APP_EDITION is rope", () => {
    expect(parseEdition(undefined)).toBe("full");
    expect(parseEdition("")).toBe("full");
    expect(parseEdition("ndt")).toBe("full");
    expect(parseEdition("rope")).toBe("rope");
    expect(parseEdition(" Rope ")).toBe("rope");
  });
});

describe("ropeHoursCsv", () => {
  const row = (over: Record<string, unknown>) =>
    ({
      id: 1, userId: 1, startDate: new Date("2026-10-02T00:00:00Z"), endDate: new Date("2026-10-03T00:00:00Z"),
      location: "Bridge, pier 4", skills: "Ascent, Descent", hours: 16, employer: "Acme", workDetails: 'Said "hi"',
      maxHeight: null, verified: false, verifiedBy: null, verifiedAt: null, ...over,
    }) as any;

  it("writes calendar days, quotes commas and quotes, oldest first", () => {
    const csv = ropeHoursCsv([
      row({ id: 2, startDate: new Date("2026-10-10T00:00:00Z"), verified: true, verifiedBy: "Sam Lead" }),
      row({}),
    ]);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toMatch(/^Start date,End date,Hours/);
    expect(lines[1]).toBe('2026-10-02,2026-10-03,16,"Bridge, pier 4",Acme,"Said ""hi""","Ascent, Descent",,No,,');
    expect(lines[2]).toMatch(/^2026-10-10,.*,Yes,Sam Lead,$/);
  });
});
