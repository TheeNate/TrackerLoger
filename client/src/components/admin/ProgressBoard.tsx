import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { trackLabel, type ProgressBoard as Board } from "@shared/certProgress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Trophy, Activity } from "lucide-react";
import { TrackProgressRow } from "./TrackProgressRow";

const TOP_N = 10;
const QUIET_DAYS = 14;
const CHIP_TRACKS = 5;
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });

function daysAgo(iso: string | null) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function lastLoggedLabel(days: number | null) {
  if (days === null) return "Never";
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

const hoursSummary = (h: { ojtHours: number; ropeHours: number }) =>
  [h.ojtHours && `${fmt(h.ojtHours)} h OJT`, h.ropeHours && `${fmt(h.ropeHours)} h rope`].filter(Boolean).join(" · ");

// The technicians closest to their next certification, and a roster showing
// who is (and isn't) keeping their log up. `endpoint` is the site-wide board
// (/api/admin/progress) or one organization's (/api/organizations/:id/progress).
export function ProgressBoard({
  endpoint,
  onSelectUser,
}: {
  endpoint: string;
  onSelectUser?: (id: number) => void;
}) {
  const [track, setTrack] = useState<string>("ALL");
  const { data, isLoading } = useQuery<Board>({
    queryKey: [endpoint],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  // Filter chips for the busiest tracks; the rest go in a "More" select.
  const { chips, more } = useMemo(() => {
    const present = Array.from(new Set((data?.rows ?? []).map((r) => r.track)));
    present.sort((a, b) => (data?.trackHours[b] ?? 0) - (data?.trackHours[a] ?? 0) || a.localeCompare(b));
    return { chips: present.slice(0, CHIP_TRACKS), more: present.slice(CHIP_TRACKS) };
  }, [data]);

  if (isLoading || !data) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const rows = data.rows.filter((r) => track === "ALL" || r.track === track).slice(0, TOP_N);
  const qualifiedCount = data.rows.filter((r) => r.qualified).length;
  const quiet = data.activity.filter((a) => {
    const d = daysAgo(a.lastLoggedAt);
    return d === null || d >= QUIET_DAYS;
  }).length;
  const nameButton = (id: number, label: string, className = "") =>
    onSelectUser ? (
      <button type="button" onClick={() => onSelectUser(id)} className={`text-left hover:text-primary ${className}`}>
        {label}
      </button>
    ) : (
      <span className={className}>{label}</span>
    );

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="grid grid-cols-3 gap-2 md:gap-3">
        <Stat label="Ready for next cert" value={qualifiedCount} tone={qualifiedCount ? "primary" : undefined} />
        <Stat label="Logging" value={data.activity.length - quiet} />
        <Stat label={`Quiet ${QUIET_DAYS}+ days`} value={quiet} tone={quiet ? "warn" : undefined} />
      </div>

      <section className="rounded-xl md:rounded-lg border border-border bg-card p-4 md:p-6 shadow-sm">
        <div className="mb-4 space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Trophy className="h-5 w-5 text-primary" />
            Top {TOP_N} toward next certification
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {["ALL", ...chips].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTrack(t)}
                className={`h-9 rounded-full border px-3 text-xs font-medium transition-colors ${
                  track === t
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                {t === "ALL" ? "All" : trackLabel(t)}
              </button>
            ))}
            {more.length > 0 && (
              <Select value={more.includes(track) ? track : ""} onValueChange={setTrack}>
                <SelectTrigger
                  className={`h-9 w-auto rounded-full px-3 text-xs ${more.includes(track) ? "border-primary text-primary" : ""}`}
                >
                  <SelectValue placeholder="More…" />
                </SelectTrigger>
                <SelectContent>
                  {more.map((t) => (
                    <SelectItem key={t} value={t}>
                      {trackLabel(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No verified progress yet. Hours count once a supervisor signs them.
          </p>
        ) : (
          <ol className="divide-y divide-border">
            {rows.map((r, i) => (
              <li key={`${r.userId}-${r.track}-${r.scope?.orgId ?? 0}`} className="flex gap-3 py-3">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    r.qualified ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="truncate font-medium text-foreground">
                    {nameButton(r.userId, r.name)}
                    {r.employeeNumber && <span className="ml-2 text-xs font-normal text-muted-foreground">#{r.employeeNumber}</span>}
                  </div>
                  <TrackProgressRow p={r} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="rounded-xl md:rounded-lg border border-border bg-card p-4 md:p-6 shadow-sm">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
          <Activity className="h-5 w-5 text-primary" />
          Who's logging
        </h2>
        {data.activity.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No technicians yet.</p>
        ) : (
          <>
            {/* Phones: one card per technician instead of a wide table. */}
            <ul className="divide-y divide-border md:hidden">
              {data.activity.map((a) => {
                const d = daysAgo(a.lastLoggedAt);
                const isQuiet = d === null || d >= QUIET_DAYS;
                return (
                  <li key={a.userId} className="py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      {nameButton(a.userId, a.name, "min-w-0 truncate font-medium text-foreground")}
                      <LastLogged days={d} quiet={isQuiet} />
                    </div>
                    <div className="mt-1 flex justify-between gap-2 text-xs text-muted-foreground">
                      <span>Last 30 days: {hoursSummary(a.last30) || "nothing"}</span>
                      {a.pendingSignatures > 0 && <span className="shrink-0">{a.pendingSignatures} unsigned</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
            <table className="hidden w-full text-sm md:table">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-2 font-medium">Technician</th>
                  <th className="px-2 py-2 font-medium">Last logged</th>
                  <th className="px-2 py-2 font-medium">Last 30 days</th>
                  <th className="px-2 py-2 text-right font-medium">Unsigned</th>
                  <th className="py-2 pl-2 font-medium">Verified totals</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.activity.map((a) => {
                  const d = daysAgo(a.lastLoggedAt);
                  return (
                    <tr key={a.userId}>
                      <td className="py-2 pr-2">{nameButton(a.userId, a.name, "font-medium text-foreground")}</td>
                      <td className="whitespace-nowrap px-2 py-2">
                        <LastLogged days={d} quiet={d === null || d >= QUIET_DAYS} />
                      </td>
                      <td className="px-2 py-2 text-foreground">
                        {hoursSummary(a.last30) || <span className="text-muted-foreground">Nothing</span>}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-foreground">{a.pendingSignatures || "—"}</td>
                      <td className="py-2 pl-2 text-muted-foreground">{hoursSummary(a.totals) || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </section>
    </div>
  );
}

function LastLogged({ days, quiet }: { days: number | null; quiet: boolean }) {
  return (
    <span
      className={`shrink-0 text-xs ${
        quiet ? "rounded bg-amber-50 px-1.5 py-0.5 text-amber-800 dark:bg-amber-950 dark:text-amber-300" : "text-muted-foreground"
      }`}
    >
      {lastLoggedLabel(days)}
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "primary" | "warn" }) {
  const color = tone === "primary" ? "text-primary" : tone === "warn" ? "text-amber-600" : "text-foreground";
  return (
    <div className="rounded-xl md:rounded-lg border border-border bg-card px-3 py-3 md:px-4 shadow-sm">
      <div className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="text-xs leading-tight text-muted-foreground">{label}</div>
    </div>
  );
}
