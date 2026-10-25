import type { RopeHours } from "@shared/schema";

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
// Calendar dates are stored as UTC midnight (shared/dates.ts), so the UTC
// ISO day is the day that was picked.
const isoDay = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

// The whole rope log as a spreadsheet, for an evaluator or the tech's own
// records. Dates are calendar days (YYYY-MM-DD).
export function ropeHoursCsv(rows: RopeHours[]): string {
  const header = [
    "Start date", "End date", "Hours", "Location", "Employer", "Work details",
    "Skills / access", "Max height", "Signed", "Signed by", "Signed on",
  ];
  const sorted = [...rows].sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
  const lines = sorted.map((r) => [
    isoDay(r.startDate), isoDay(r.endDate), r.hours, r.location, r.employer, r.workDetails,
    r.skills, r.maxHeight, r.verified ? "Yes" : "No", r.verified ? r.verifiedBy : "",
    r.verifiedAt ? new Date(r.verifiedAt).toLocaleDateString("en-CA") : "",
  ]);
  return [header, ...lines].map((l) => l.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function downloadRopeHoursCsv(rows: RopeHours[], name = "rope-hours") {
  const blob = new Blob(["﻿" + ropeHoursCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
