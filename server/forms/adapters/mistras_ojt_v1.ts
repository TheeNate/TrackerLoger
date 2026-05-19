import { format } from "date-fns";
import type { Adapter, FieldValues } from "../types";

// Per-form method map. Identity for everything that has the same name on the
// MISTRAS form; UT_THK is renamed to UT_thk. Methods absent here have no
// MISTRAS column and their hours are skipped (date+location still occupy the
// row).
const METHOD_MAP: Record<string, string> = {
  ET: "ET", RFT: "RFT", MT: "MT", PT: "PT", RT: "RT",
  UT_THK: "UT_thk",
  UTSW: "UTSW", PAUT: "PAUT", LSI: "LSI",
};

/**
 * Format a Date as M/d/yyyy using UTC components. Entry dates are stored as
 * UTC midnight; using local-time formatting would shift them by the server's
 * UTC offset (e.g. UTC-7 would render May 4 as May 3).
 */
function formatUtcDate(d: Date): string {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

export const mistrasAdapter: Adapter = ({ entries, profile, headerOverrides }) => {
  const out: FieldValues = {};

  // Sort entries by date ascending. Defensive — caller is expected to do this.
  const sorted = [...entries].sort((a, b) => a.date.getTime() - b.date.getTime());

  // Per-column totals
  const totals: Record<string, number> = {};

  sorted.forEach((entry, i) => {
    const rowNum = i + 1;
    out[`row_${rowNum}_date`] = formatUtcDate(entry.date);
    out[`row_${rowNum}_location`] = entry.location;
    out[`row_${rowNum}_supervisor`] = entry.verifiedBy ?? "";

    const mappedCol = METHOD_MAP[entry.method];
    if (mappedCol) {
      out[`row_${rowNum}_${mappedCol}`] = String(entry.hours);
      totals[mappedCol] = (totals[mappedCol] ?? 0) + entry.hours;
    }
  });

  for (const [col, sum] of Object.entries(totals)) {
    if (sum > 0) out[`total_${col}`] = String(sum);
  }

  // Header — profile defaults, then headerOverrides
  const today = format(new Date(), "M/d/yyyy");
  const headerDefaults: FieldValues = {
    employee_name: profile.name ?? "",
    employee_number: profile.employeeNumber ?? "",
    employee_signature: profile.name ?? "",
    signature_date: today,
  };
  Object.assign(out, headerDefaults, headerOverrides ?? {});

  return out;
};
