import type { RopeAdapter, FieldValues } from "../types";
import { EmptyExportError, FormCapacityError } from "../types";
import type { Supervisor } from "@shared/schema";

const MAX_ROWS = 7;

function formatUtcDate(d: Date): string {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

function formatDateRange(start: Date, end: Date): string {
  const s = formatUtcDate(start);
  const e = formatUtcDate(end);
  return s === e ? s : `${s} - ${e}`;
}

function findSupervisor(supervisors: Supervisor[], name: string | null): Supervisor | undefined {
  if (!name) return undefined;
  return supervisors.find((s) => s.name === name);
}

export const irataAdapter: RopeAdapter = ({ ropeHours, profile: _profile, supervisors, headerOverrides }) => {
  if (ropeHours.length === 0) throw new EmptyExportError();
  if (ropeHours.length > MAX_ROWS) {
    throw new FormCapacityError(MAX_ROWS, ropeHours.length, "rows");
  }

  const out: FieldValues = {};
  const sorted = [...ropeHours].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  sorted.forEach((rope, i) => {
    const rowNum = i + 1;
    out[`row_${rowNum}_date`] = formatDateRange(rope.startDate, rope.endDate);
    out[`row_${rowNum}_employer`] = rope.employer ?? "";
    out[`row_${rowNum}_task_details`] = rope.workDetails ?? rope.skills;
    out[`row_${rowNum}_location`] = rope.location;
    out[`row_${rowNum}_hours_worked`] = String(rope.hours);
    out[`row_${rowNum}_max_height`] = rope.maxHeight ?? "";

    const sup = findSupervisor(supervisors, rope.verifiedBy);
    out[`row_${rowNum}_supervisor`] =
      sup && sup.irataNumber
        ? `${rope.verifiedBy} #${sup.irataNumber}`
        : rope.verifiedBy ?? "";
  });

  // IRATA has no hours_this_page or running_total fields. Only running_total_hours.
  Object.assign(out, headerOverrides ?? {});

  return out;
};
