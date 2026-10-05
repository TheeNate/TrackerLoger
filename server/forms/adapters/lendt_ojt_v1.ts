import type { Adapter, FieldValues } from "../types";
import { chunk, EmptyExportError, NothingToExportError } from "../types";

// Method columns on the Lê NDT form, in print order. The blank is generated
// from this list (scripts/gen-lendt-blank.ts), so the PDF field names are
// row_<N>_<column> / total_<column>.
export const LENDT_COLUMNS = ["MT", "PT", "UT", "VT_1", "VT_2", "VT_3", "VWE"] as const;

export type LendtColumn = (typeof LENDT_COLUMNS)[number];

export const LENDT_MAX_ROWS = 16;

// Per-form method map: identity for every column. Methods absent here have no
// column on this form and their hours are skipped (date+location still occupy
// the row).
const METHOD_MAP: Record<string, LendtColumn> = {
  ...(Object.fromEntries(LENDT_COLUMNS.map((c) => [c, c])) as Record<LendtColumn, LendtColumn>),
  // Legacy: a short-lived change collapsed the three VT levels into a plain
  // "VT" and rewrote existing rows. Those rows were all VT_2, so they go in
  // the VT-2 column (same rule as the Curtiss-Wright form).
  VT: "VT_2",
};

/**
 * Format a Date as M/d/yyyy using UTC components. Entry dates are stored as
 * UTC midnight; using local-time formatting would shift them by the server's
 * UTC offset (e.g. UTC-7 would render May 4 as May 3).
 */
function formatUtcDate(d: Date): string {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

export const lendtAdapter: Adapter = ({ entries, profile, headerOverrides }) => {
  if (entries.length === 0) throw new EmptyExportError();

  const sorted = [...entries].sort((a, b) => a.date.getTime() - b.date.getTime());

  const today = formatUtcDate(new Date());
  const header: FieldValues = {
    employee_name: profile.name ?? "",
    employee_number: profile.employeeNumber ?? "",
    employee_signature: profile.name ?? "",
    signature_date: today,
  };
  Object.assign(header, headerOverrides ?? {});

  // One page per chunk of LENDT_MAX_ROWS entries; no overall row cap. Totals
  // are per-page (each page sums its own rows), and the header repeats on each
  // page.
  let anyMethodCellWritten = false;
  const pages: FieldValues[] = chunk(sorted, LENDT_MAX_ROWS).map((pageEntries) => {
    const out: FieldValues = {};
    const totals: Record<string, number> = {};

    pageEntries.forEach((entry, i) => {
      const rowNum = i + 1;
      out[`row_${rowNum}_date`] = formatUtcDate(entry.date);
      out[`row_${rowNum}_location`] = entry.location;
      out[`row_${rowNum}_supervisor`] = entry.verifiedBy ?? "";

      const mappedCol = METHOD_MAP[entry.method];
      if (mappedCol) {
        out[`row_${rowNum}_${mappedCol}`] = String(entry.hours);
        totals[mappedCol] = (totals[mappedCol] ?? 0) + entry.hours;
        anyMethodCellWritten = true;
      }
    });

    for (const [col, sum] of Object.entries(totals)) {
      if (sum > 0) out[`total_${col}`] = String(sum);
    }

    Object.assign(out, header);
    return out;
  });

  if (!anyMethodCellWritten) throw new NothingToExportError();

  return pages;
};
