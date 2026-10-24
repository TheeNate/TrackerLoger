import { levelLabel, type RequirementProgress, type TrackProgress } from "@shared/certProgress";
import { Progress } from "@/components/ui/progress";
import { Award, Check } from "lucide-react";

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });

export function targetLabel(p: TrackProgress) {
  if (p.nextLevel === null) return p.currentLevel ? `${p.trackLabel} ${levelLabel(p.currentLevel)} (top level)` : p.trackLabel;
  return `${p.trackLabel} ${levelLabel(p.nextLevel)}`;
}

function RequirementChip({ r }: { r: RequirementProgress }) {
  return (
    <span
      className={`inline-flex flex-wrap items-center gap-1 rounded-xl border px-2 py-0.5 text-xs ${
        r.met
          ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300"
          : "border-border bg-muted text-foreground"
      }`}
      title={r.note}
    >
      {r.met && <Check className="h-3 w-3" />}
      <span className="font-medium">{r.label}</span>
      <span className="tabular-nums">
        {fmt(r.current)} / {fmt(r.target)} {r.unit}
      </span>
      {r.pending > 0 && <span className="text-amber-700 dark:text-amber-400 tabular-nums">+{fmt(r.pending)} unsigned</span>}
      {!r.met && r.note && <span className="text-muted-foreground">· {r.note}</span>}
    </span>
  );
}

// One technician's progress on one track: target level, bar, requirements.
export function TrackProgressRow({ p, compact = false }: { p: TrackProgress; compact?: boolean }) {
  const pct = Math.round(p.percent * 100);
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-start justify-between gap-2 text-sm">
        <span className="min-w-0 text-muted-foreground">
          {p.currentLevel ? `${levelLabel(p.currentLevel)} → ` : "Working toward "}
          <span className="font-medium text-foreground">{targetLabel(p)}</span>
          {p.scope && <span className="text-xs"> · {p.scope.orgName}</span>}
        </span>
        {p.qualified ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
            <Award className="h-3 w-3" />
            Qualified
          </span>
        ) : (
          <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">{pct}%</span>
        )}
      </div>
      <Progress value={pct} className={`bg-muted ${compact ? "h-1.5" : "h-2"}`} />
      {!compact && (
        <div className="flex flex-wrap gap-1.5">
          {p.requirements.map((r) => (
            <RequirementChip key={r.key} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}
