import type { Entry } from "@shared/schema";
import type { Adapter, FieldValues } from "../types";
import { EmptyExportError, FormCapacityError, NothingToExportError } from "../types";

const METHOD_MAP: Record<string, string> = {
  MT: "MT", PT: "PT",
  UT_THK: "UTT",
  VT_1: "VT_1", VT_2: "VT_2", VT_3: "VT_3",
  VWE: "VWE",
};

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
type Day = typeof DAYS[number];

const MAX_WEEKS = 2;

// UTC-aware helpers: entry dates are stored as UTC midnight.
// Do NOT use date-fns startOfWeek/endOfWeek/getDay — they are timezone-dependent.

function utcDayName(d: Date): Day {
  return DAYS[d.getUTCDay()];
}

function utcStartOfSunWeek(d: Date): Date {
  // Return a new Date representing the most recent Sunday (UTC) on or before d.
  const result = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  result.setUTCDate(result.getUTCDate() - result.getUTCDay());
  return result;
}

function utcEndOfSatWeek(d: Date): Date {
  const start = utcStartOfSunWeek(d);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return end;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatUtcDateSlash(d: Date): string {
  return `${pad2(d.getUTCMonth() + 1)}/${pad2(d.getUTCDate())}/${d.getUTCFullYear()}`;
}

function weekKey(d: Date): string {
  const s = utcStartOfSunWeek(d);
  return `${s.getUTCFullYear()}-${pad2(s.getUTCMonth() + 1)}-${pad2(s.getUTCDate())}`;
}

export const cwAdapter: Adapter = ({ entries, profile, headerOverrides }) => {
  if (entries.length === 0) throw new EmptyExportError();

  // Bucket entries by Sun-Sat UTC week.
  const buckets = new Map<string, Entry[]>();
  for (const entry of entries) {
    const k = weekKey(entry.date);
    const list = buckets.get(k) ?? [];
    list.push(entry);
    buckets.set(k, list);
  }

  const sortedKeys = Array.from(buckets.keys()).sort();
  if (sortedKeys.length > MAX_WEEKS) {
    throw new FormCapacityError(MAX_WEEKS, sortedKeys.length, "weeks");
  }

  const out: FieldValues = {};
  let anyMethodCellWritten = false;

  sortedKeys.forEach((key, idx) => {
    const weekId = idx === 0 ? "week1" : "week2";
    const weekEntries = buckets.get(key)!;
    out[`${weekId}_ending`] = formatUtcDateSlash(utcEndOfSatWeek(weekEntries[0].date));

    // Sum hours by (day, mappedMethod).
    const cellSums = new Map<string, number>(); // key: `${day}|${method}`
    const dayTotals: Record<Day, number> = {
      sunday: 0, monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0, saturday: 0,
    };
    const weekColumnTotals: Record<string, number> = {};
    let weekGrandTotal = 0;

    for (const entry of weekEntries) {
      const mappedCol = METHOD_MAP[entry.method];
      if (!mappedCol) continue;
      const day = utcDayName(entry.date);
      const cellKey = `${day}|${mappedCol}`;
      cellSums.set(cellKey, (cellSums.get(cellKey) ?? 0) + entry.hours);
      dayTotals[day] += entry.hours;
      weekColumnTotals[mappedCol] = (weekColumnTotals[mappedCol] ?? 0) + entry.hours;
      weekGrandTotal += entry.hours;
      anyMethodCellWritten = true;
    }

    for (const [cellKey, sum] of Array.from(cellSums)) {
      const [day, method] = cellKey.split("|");
      if (sum > 0) out[`${weekId}_${day}_${method}`] = String(sum);
    }
    for (const day of DAYS) {
      if (dayTotals[day] > 0) out[`${weekId}_${day}_TOTAL`] = String(dayTotals[day]);
    }
    for (const [method, sum] of Object.entries(weekColumnTotals)) {
      if (sum > 0) out[`${weekId}_total_${method}`] = String(sum);
    }
    if (weekGrandTotal > 0) out[`${weekId}_total_TOTAL`] = String(weekGrandTotal);
  });

  if (!anyMethodCellWritten) throw new NothingToExportError();

  // Header — profile defaults, then headerOverrides.
  const headerDefaults: FieldValues = {
    name: profile.name ?? "",
    job_number: "",
  };
  Object.assign(out, headerDefaults, headerOverrides ?? {});

  return out;
};
