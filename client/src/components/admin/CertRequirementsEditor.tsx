import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, getQueryFn, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FIXED_TRACK_RULES,
  MAX_NDT_LEVEL,
  NDT_METHOD_KEYS,
  levelLabel,
  type LevelRequirement,
  type NdtRequirements,
  type RequirementsResponse,
} from "@shared/certProgress";
import { ndtMethodLabel, type NDTMethod } from "@shared/schema";
import { ChevronDown, ChevronRight, Loader2, Lock, Plus, X } from "lucide-react";

type SaveResult = RequirementsResponse & { newlyEligible: number };

function describeLevels(levels: LevelRequirement[] | undefined) {
  if (!levels?.length) return "Not tracked";
  return levels
    .map((l) => `${levelLabel(l.level).replace("Level ", "")}: ${l.hours.toLocaleString()} h${l.monthsAtPreviousLevel ? ` + ${l.monthsAtPreviousLevel} mo` : ""}`)
    .join(" · ");
}

const sortLevels = (levels: LevelRequirement[]) => [...levels].sort((a, b) => a.level - b.level);

// NDT OJT requirements per method, editable: the site default (no orgId) or
// one organization's own (orgId). SPRAT / IRATA rules are shown read-only.
export function CertRequirementsEditor({ orgId }: { orgId?: number }) {
  const { toast } = useToast();
  const endpoint = orgId ? `/api/organizations/${orgId}/cert-requirements` : "/api/admin/cert-requirements";
  const { data } = useQuery<RequirementsResponse>({
    queryKey: [endpoint],
    queryFn: getQueryFn({ on401: "throw" }),
  });
  const [draft, setDraft] = useState<NdtRequirements | null>(null);
  const [open, setOpen] = useState<NDTMethod | null>(null);
  useEffect(() => {
    if (data) setDraft(structuredClone(data.requirements));
  }, [data]);

  const onSaved = ({ newlyEligible }: SaveResult, title: string) => {
    queryClient.invalidateQueries({ queryKey: [endpoint] });
    queryClient.invalidateQueries({ queryKey: [orgId ? `/api/organizations/${orgId}/progress` : "/api/admin/progress"] });
    queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    toast({
      title,
      description: newlyEligible ? `${newlyEligible} technician level(s) newly qualified, admins notified.` : undefined,
    });
  };
  const onError = (e: Error) => toast({ title: "Could not save", description: e.message, variant: "destructive" });

  const save = useMutation({
    mutationFn: async (value: NdtRequirements) => (await apiRequest("PUT", endpoint, value)).json() as Promise<SaveResult>,
    onSuccess: (r) => onSaved(r, "Requirements saved"),
    onError,
  });
  const reset = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", endpoint)).json() as Promise<SaveResult>,
    onSuccess: (r) => onSaved(r, "Using the site default"),
    onError,
  });

  if (!draft || !data) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const update = (method: NDTMethod, fn: (levels: LevelRequirement[]) => LevelRequirement[]) =>
    setDraft((d) => ({ ...d!, [method]: sortLevels(fn(structuredClone(d![method] ?? []))) }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.requirements);
  const busy = save.isPending || reset.isPending;

  return (
    <div className="space-y-4 md:space-y-6">
      <section className="rounded-xl md:rounded-lg border border-border bg-card p-4 md:p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground">NDT OJT hours</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {orgId
            ? data.custom
              ? "Your organization's own requirements from its written practice."
              : "Your organization is using the site default. Edit and save to set your own."
            : "Site default for technicians whose organization hasn't set its own. The starting numbers are placeholders, not anyone's written practice."}{" "}
          Only supervisor-verified hours count. Saving re-checks everyone and notifies admins of anyone who now qualifies.
        </p>

        <ul className="divide-y divide-border rounded-md border border-border">
          {NDT_METHOD_KEYS.map((method) => {
            const levels = draft[method] ?? [];
            const isOpen = open === method;
            const unused = Array.from({ length: MAX_NDT_LEVEL }, (_, i) => i + 1).filter(
              (n) => !levels.some((l) => l.level === n),
            );
            return (
              <li key={method}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : method)}
                  className="flex min-h-12 w-full items-center gap-2 px-3 py-2 text-left"
                  aria-expanded={isOpen}
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="w-16 shrink-0 font-medium text-foreground">{ndtMethodLabel(method)}</span>
                  <span className={`min-w-0 flex-1 text-xs ${levels.length ? "text-muted-foreground" : "italic text-muted-foreground/70"}`}>
                    {describeLevels(levels)}
                  </span>
                </button>
                {isOpen && (
                  <div className="space-y-2 px-3 pb-3">
                    {levels.length > 0 && (
                      <div className="grid grid-cols-[4rem_1fr_1fr_2.5rem] gap-2 text-xs text-muted-foreground">
                        <span>Level</span>
                        <span>OJT hours</span>
                        <span>Months at prev.</span>
                        <span />
                      </div>
                    )}
                    {levels.map((l, i) => (
                      <div key={l.level} className="grid grid-cols-[4rem_1fr_1fr_2.5rem] items-center gap-2">
                        <Select
                          value={String(l.level)}
                          onValueChange={(v) => update(method, (ls) => ((ls[i].level = Number(v)), ls))}
                        >
                          <SelectTrigger className="h-10 px-2">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[l.level, ...unused].sort().map((n) => (
                              <SelectItem key={n} value={String(n)}>
                                {levelLabel(n).replace("Level ", "")}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          type="number"
                          min={0}
                          inputMode="decimal"
                          aria-label={`${levelLabel(l.level)} OJT hours`}
                          className="h-10 px-2"
                          value={l.hours}
                          onChange={(e) => update(method, (ls) => ((ls[i].hours = Math.max(0, Number(e.target.value) || 0)), ls))}
                        />
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          aria-label={`Months at the previous level before ${levelLabel(l.level)}`}
                          className="h-10 px-2"
                          value={l.monthsAtPreviousLevel}
                          onChange={(e) =>
                            update(method, (ls) => ((ls[i].monthsAtPreviousLevel = Math.max(0, Math.floor(Number(e.target.value) || 0))), ls))
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-10 w-10"
                          aria-label={`Remove ${levelLabel(l.level)}`}
                          onClick={() => update(method, (ls) => ls.filter((_, j) => j !== i))}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    {unused.length > 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-10"
                        onClick={() =>
                          update(method, (ls) => [...ls, { level: unused[0], hours: 0, monthsAtPreviousLevel: 0 }])
                        }
                      >
                        <Plus className="mr-1 h-4 w-4" />
                        {levels.length ? "Add level" : "Track this method"}
                      </Button>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Months at prev. = time a technician must hold the level below first (0 = hours only). The starting
                      level comes from their {ndtMethodLabel(method)} certificate on file.
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {orgId && data.custom && (
            <Button variant="ghost" className="h-11 sm:h-10" disabled={busy} onClick={() => reset.mutate()}>
              Use site default
            </Button>
          )}
          <Button
            variant="outline"
            className="h-11 sm:h-10"
            disabled={!dirty || busy}
            onClick={() => setDraft(structuredClone(data.requirements))}
          >
            Discard changes
          </Button>
          <Button className="h-11 sm:h-10" disabled={!dirty || busy} onClick={() => save.mutate(draft)}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save requirements
          </Button>
        </div>
      </section>

      <section className="rounded-xl md:rounded-lg border border-border bg-card p-4 md:p-6 shadow-sm">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Lock className="h-4 w-4 text-muted-foreground" />
          SPRAT &amp; IRATA
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Set by the certifying bodies. Progress starts from the technician's current certificate, so add it on their
          profile with its level and issue date.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {Object.values(FIXED_TRACK_RULES).map((rules) => (
            <div key={rules.track} className="rounded-md border border-border p-3">
              <h3 className="mb-1 font-medium text-foreground">{rules.track}</h3>
              <ul className="space-y-1 text-sm text-foreground">
                {rules.levels.map((l) => (
                  <li key={l.level}>
                    <span className="font-medium">{levelLabel(l.level)}:</span> {l.hours.toLocaleString()} h +{" "}
                    {l.monthsAtPreviousLevel} months at {levelLabel(l.level - 1)}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                {rules.countFrom === "sinceCert"
                  ? "Hours count from the current certificate's issue date."
                  : "All logged career hours count."}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
