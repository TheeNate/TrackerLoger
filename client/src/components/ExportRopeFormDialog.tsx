import { useState } from "react";
import {
  Dialog, DialogContent, DialogDescription,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ExportFormFooter, FormPicker, useFormPdfExport } from "@/components/ExportFormParts";
import type { RopeHours } from "@shared/schema";

type FormId = "sprat_log_v1" | "irata_log_v1";

const FORM_LABELS: Record<FormId, string> = {
  sprat_log_v1: "SPRAT — Rope Access Experience Log",
  irata_log_v1: "IRATA — Work Experience",
};

// Rows that fit on one page of each form. Exports longer than this paginate
// onto additional pages automatically — there is no hard cap.
const ROWS_PER_PAGE: Record<FormId, number> = {
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
  const [formId, setFormId] = useState<FormId>("sprat_log_v1");
  const [runningTotal, setRunningTotal] = useState("");
  const [totalHoursSinceCert, setTotalHoursSinceCert] = useState("");
  const [runningTotalHours, setRunningTotalHours] = useState("");
  const { busy, shareable, run } = useFormPdfExport("Rope access hours", () => onOpenChange(false));

  const pageCount = Math.ceil(selectedRopeHours.length / ROWS_PER_PAGE[formId]);

  function exportPdf(mode: "download" | "share") {
    const header_overrides: Record<string, string> = {};
    if (formId === "sprat_log_v1") {
      if (runningTotal) header_overrides.running_total = runningTotal;
      if (totalHoursSinceCert) header_overrides.total_hours_since_cert = totalHoursSinceCert;
    } else {
      if (runningTotalHours) header_overrides.running_total_hours = runningTotalHours;
    }
    run(mode, {
      form_id: formId,
      entry_ids: selectedRopeHours.map((r) => r.id),
      header_overrides,
    });
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
            <div className="mt-2">
              <FormPicker
                value={formId}
                onChange={setFormId}
                options={(["sprat_log_v1", "irata_log_v1"] as FormId[]).map((id) => ({
                  id,
                  label: FORM_LABELS[id],
                }))}
              />
            </div>
          </div>

          {pageCount > 1 && (
            <p className="text-sm text-muted-foreground bg-muted p-2 rounded">
              {selectedRopeHours.length} rows will be split across {pageCount} pages
              ({ROWS_PER_PAGE[formId]} per page).
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

        <ExportFormFooter
          busy={busy}
          shareable={shareable}
          disabled={selectedRopeHours.length === 0}
          onCancel={() => onOpenChange(false)}
          onDownload={() => exportPdf("download")}
          onShare={() => exportPdf("share")}
        />
      </DialogContent>
    </Dialog>
  );
}
