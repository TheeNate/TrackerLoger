import { useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import type { RopeHours } from "@shared/schema";

type FormId = "sprat_log_v1" | "irata_log_v1";

const FORM_LABELS: Record<FormId, string> = {
  sprat_log_v1: "SPRAT — Rope Access Experience Log",
  irata_log_v1: "IRATA — Work Experience",
};

const ROW_LIMITS: Record<FormId, number> = {
  sprat_log_v1: 6,
  irata_log_v1: 7,
};

interface ExportRopeFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedRopeHours: RopeHours[];
}

export function ExportRopeFormDialog({
  open, onOpenChange, selectedRopeHours,
}: ExportRopeFormDialogProps) {
  const { toast } = useToast();
  const [formId, setFormId] = useState<FormId>("sprat_log_v1");
  const [runningTotal, setRunningTotal] = useState("");
  const [totalHoursSinceCert, setTotalHoursSinceCert] = useState("");
  const [runningTotalHours, setRunningTotalHours] = useState("");
  const [downloading, setDownloading] = useState(false);

  const overCapacity = selectedRopeHours.length > ROW_LIMITS[formId];

  async function handleDownload() {
    setDownloading(true);
    try {
      const header_overrides: Record<string, string> = {};
      if (formId === "sprat_log_v1") {
        if (runningTotal) header_overrides.running_total = runningTotal;
        if (totalHoursSinceCert) header_overrides.total_hours_since_cert = totalHoursSinceCert;
      } else {
        if (runningTotalHours) header_overrides.running_total_hours = runningTotalHours;
      }

      const res = await fetch("/api/export-form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          form_id: formId,
          entry_ids: selectedRopeHours.map((r) => r.id),
          header_overrides,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({
          title: "Export failed",
          description: (body as { message?: string }).message ?? `HTTP ${res.status}`,
          variant: "destructive",
        });
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const dispo = res.headers.get("Content-Disposition") ?? "";
      const match = dispo.match(/filename="([^"]+)"/);
      a.download = match?.[1] ?? `${formId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onOpenChange(false);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Export rope hours to form</DialogTitle>
          <DialogDescription>
            {selectedRopeHours.length} rope hour{selectedRopeHours.length === 1 ? "" : "s"} selected.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label className="text-sm font-medium">Form</Label>
            <RadioGroup
              value={formId}
              onValueChange={(v) => setFormId(v as FormId)}
              className="mt-2"
            >
              {(["sprat_log_v1", "irata_log_v1"] as FormId[]).map((id) => (
                <div key={id} className="flex items-center space-x-2">
                  <RadioGroupItem value={id} id={id} />
                  <Label htmlFor={id} className="font-normal">{FORM_LABELS[id]}</Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {overCapacity && (
            <p className="text-sm text-amber-700 bg-amber-50 p-2 rounded">
              {selectedRopeHours.length} rows selected, but this form fits {ROW_LIMITS[formId]}.
              You&apos;ll get a capacity error — deselect some entries before downloading.
            </p>
          )}

          {formId === "sprat_log_v1" ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="running-total">Running total (optional)</Label>
                <Input id="running-total" value={runningTotal} onChange={(e) => setRunningTotal(e.target.value)} placeholder="e.g. 1200" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="hours-since-cert">Total hours since previous certification (optional)</Label>
                <Input id="hours-since-cert" value={totalHoursSinceCert} onChange={(e) => setTotalHoursSinceCert(e.target.value)} placeholder="e.g. 250" />
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="running-total-hours">Running total hours (optional)</Label>
              <Input id="running-total-hours" value={runningTotalHours} onChange={(e) => setRunningTotalHours(e.target.value)} placeholder="e.g. 1200" />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={downloading}>
            Cancel
          </Button>
          <Button onClick={handleDownload} disabled={downloading || selectedRopeHours.length === 0}>
            {downloading ? "Generating…" : "Download"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
