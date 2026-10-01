import { promises as fs } from "fs";
import path from "path";
import type { Entry, User } from "../shared/schema";
import { fillFormPages } from "../server/forms/filler";
import { registry } from "../server/forms/registry";

const OUT_DIR = path.resolve("tmp", "samples");

function profile(): User {
  return {
    id: 1, email: "sample@example.com", password: null,
    name: "Sample Technician", employeeNumber: "EMP-2026",
    isAdmin: false, resetToken: null, resetTokenExpiry: null,
    createdAt: new Date("2025-01-01T00:00:00Z"),
  } as User;
}

function entry(id: number, date: string, method: string, hours: number, location: string, verifiedBy: string | null = null): Entry {
  return {
    id, userId: 1,
    date: new Date(date), location, method, hours,
    verified: verifiedBy !== null, verifiedBy, verificationToken: null, verifiedAt: null,
    createdAt: new Date(date),
    technicianSignature: null, supervisorSignature: null, dataHash: null,
    integritySignature: null, verificationRequestedAt: null, auditTrail: null,
    supervisorIpAddress: null, supervisorBrowserInfo: null, employeeIdUsed: null,
    sourceDocumentKey: null, sourceDocumentName: null, importedAt: null,
  } as Entry;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  // Lê NDT samples — the form only draws columns for methods with hours, so
  // render a few mixes: three methods, the VT levels, and every method.
  const lendt = registry.lendt_ojt_v1;
  if (!("buildBlank" in lendt)) throw new Error("lendt_ojt_v1 should build its blank");
  const allMethods = ["ET", "RFT", "MT", "PT", "RT", "UT", "UT_THK", "UTSW", "PMI", "LSI", "PAUT", "VT_1", "VT_2", "VT_3", "VWE"];
  const lendtSamples: Record<string, Entry[]> = {
    lendt_3col: [
      entry(1, "2026-04-06T00:00:00Z", "MT",  4,   "Refinery 1", "John Lead"),
      entry(2, "2026-04-07T00:00:00Z", "RT",  5,   "Pipeline A", "John Lead"),
      entry(3, "2026-04-08T00:00:00Z", "VWE", 6,   "Fab Shop"),
      entry(4, "2026-04-09T00:00:00Z", "RT",  7.5, "Pipeline A"),
    ],
    lendt_vt_levels: [
      entry(1, "2026-04-06T00:00:00Z", "VT_1", 4, "Plant C", "John Lead"),
      entry(2, "2026-04-07T00:00:00Z", "VT_2", 3, "Plant C", "John Lead"),
      entry(3, "2026-04-08T00:00:00Z", "VT_3", 2, "Plant C"),
    ],
    lendt_all: allMethods.map((m, i) =>
      entry(i + 1, new Date(Date.UTC(2026, 3, 6 + i)).toISOString(), m, 1.5 + i, "Refinery 1", i % 2 ? "John Lead" : null)),
  };
  for (const [name, entries] of Object.entries(lendtSamples)) {
    const pages = lendt.adapter({ entries, profile: profile() });
    const bytes = await fillFormPages(await lendt.buildBlank(entries), pages);
    await fs.writeFile(path.join(OUT_DIR, `${name}_sample.pdf`), bytes);
    console.log("Wrote", path.join(OUT_DIR, `${name}_sample.pdf`));
  }

  // CW sample — two weeks of entries (UTC dates).
  const cwEntries: Entry[] = [
    // Week ending 4/11 (UTC: Mon 4/6, Tue 4/7, Wed 4/8, Fri 4/10)
    entry(1, "2026-04-06T00:00:00Z", "MT",     4, "Vendor Site"),
    entry(2, "2026-04-07T00:00:00Z", "PT",     3, "Vendor Site"),
    entry(3, "2026-04-08T00:00:00Z", "UT_THK", 6, "Vendor Site"),
    entry(4, "2026-04-10T00:00:00Z", "VT_2",   2, "Vendor Site"),
    // Week ending 4/18 (UTC: Mon 4/13, Tue 4/14, Thu 4/16)
    entry(5, "2026-04-13T00:00:00Z", "MT",     5, "Vendor Site"),
    entry(6, "2026-04-14T00:00:00Z", "VT_3",   3, "Vendor Site"),
    entry(7, "2026-04-16T00:00:00Z", "VWE",    4, "Vendor Site"),
  ];
  const cwValues = registry.curtiss_wright_wer_v1.adapter({
    entries: cwEntries,
    profile: profile(),
    headerOverrides: { job_number: "JOB-2026-04" },
  });
  const cw = registry.curtiss_wright_wer_v1;
  if (!("blankPath" in cw)) throw new Error("curtiss_wright_wer_v1 should have a fixed blank");
  const cwBytes = await fillFormPages(cw.blankPath, cwValues);
  await fs.writeFile(path.join(OUT_DIR, "curtiss_wright_sample.pdf"), cwBytes);
  console.log("Wrote", path.join(OUT_DIR, "curtiss_wright_sample.pdf"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
