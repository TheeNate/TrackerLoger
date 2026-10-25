import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import type { TrackProgress } from "@shared/certProgress";
import { TrackProgressRow } from "@/components/admin/TrackProgressRow";
import { Trophy } from "lucide-react";
import { ROPE_ONLY } from "@/lib/edition";

const ROPE_TRACKS = new Set(["SPRAT", "IRATA"]);

// The technician's own SPRAT / IRATA progress toward their next level
// (shared/certProgress.ts). A track needs a starting cert, so with none on
// file this is just a nudge to add one.
export function RopeProgressCard({ className = "" }: { className?: string }) {
  const { data = [], isLoading } = useQuery<TrackProgress[]>({
    queryKey: ["/api/progress"],
    queryFn: getQueryFn({ on401: "throw" }),
  });
  if (isLoading) return null;
  const tracks = data.filter((p) => ROPE_TRACKS.has(p.track) && !p.blocked);

  return (
    <section className={`rounded-xl md:rounded-lg border border-border bg-card p-4 md:p-6 shadow-sm ${className}`}>
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-foreground">
        <Trophy className="h-5 w-5 text-primary" />
        Progress to next level
      </h2>
      {tracks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Add your SPRAT or IRATA certificate {ROPE_ONLY ? "under Certifications below" : "on the OJT Hours page"}, with its
          level and issue date, to see how many
          signed hours and months you still need. SPRAT: 500 h and 6 months at Level 1 for Level 2. IRATA: 1,000 h
          and 12 months at each level.
        </p>
      ) : (
        <div className="space-y-4">
          {tracks.map((p) => (
            <TrackProgressRow key={p.track} p={p} />
          ))}
          <p className="text-xs text-muted-foreground">Only hours your supervisor has signed count.</p>
        </div>
      )}
    </section>
  );
}
