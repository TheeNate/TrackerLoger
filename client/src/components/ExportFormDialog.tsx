import { useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/hooks/use-auth";
import { ExportFormFooter, FormPicker, useFormPdfExport } from "@/components/ExportFormParts";
import type { Entry } from "@shared/schema";

type FormId = "lendt_ojt_v1" | "curtiss_wright_wer_v1";

// Methods each form actually has a column for. Used only for the
// "N entries will be skipped" preview; the server is the source of truth.
const SUPPORTED_METHODS: Record<FormId, Set<string>> = {
  // Plain "VT" is a legacy value the form puts in its VT-2 column.
  lendt_ojt_v1: new Set(["MT", "PT", "UT", "VT_1", "VT_2", "VT_3", "VT", "VWE"]),
  curtiss_wright_wer_v1: new Set(["MT", "PT", "UT_THK", "VT_1", "VT_2", "VT_3", "VWE"]),
};

const FORM_LABELS: Record<FormId, string> = {
  lendt_ojt_v1: "Lê NDT — Experience Hours (OJT)",
  curtiss_wright_wer_v1: "Curtiss-Wright — Work Experience Record",
};

interface ExportFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedEntries: Entry[];
  /** Offer a "verified entries only" switch (on by default) — used when the
   *  dialog is handed the whole log instead of a hand-picked selection. */
  offerVerifiedOnly?: boolean;
}

export function ExportFormDialog({
  open, onOpenChange, selectedEntries: givenEntries, offerVerifiedOnly,
}: ExportFormDialogProps) {
  const { user } = useAuth();
  const [verifiedOnly, setVerifiedOnly] = useState(true);
  const unverifiedCount = givenEntries.filter((e) => !e.verified).length;
  const selectedEntries =
    offerVerifiedOnly && verifiedOnly ? givenEntries.filter((e) => e.verified) : givenEntries;

  const [formId, setFormId] = useState<FormId>("lendt_ojt_v1");
  const [employeeName, setEmployeeName] = useState(user?.name ?? "");
  const [employeeNumber, setEmployeeNumber] = useState(user?.employeeNumber ?? "");
  const [jobNumber, setJobNumber] = useState("");
  const { busy, shareable, run } = useFormPdfExport("OJT hours", () => onOpenChange(false));

  const unmappedCount = useMemo(() => {
    const supported = SUPPORTED_METHODS[formId];
    return selectedEntries.filter((e) => !supported.has(e.method)).length;
  }, [formId, selectedEntries]);

  // Lê NDT fits 16 rows per page; longer exports paginate automatically.
  // (Curtiss-Wright groups by week, so a row-based page count wouldn't apply.)
  const lendtPageCount =
    formId === "lendt_ojt_v1" ? Math.ceil(selectedEntries.length / 16) : 1;

  function exportPdf(mode: "download" | "share") {
    const header_overrides: Record<string, string> = {};
    if (formId === "lendt_ojt_v1") {
      if (employeeName) header_overrides.employee_name = employeeName;
      if (employeeName) header_overrides.employee_signature = employeeName;
      if (employeeNumber) header_overrides.employee_number = employeeNumber;
    } else {
      if (employeeName) header_overrides.name = employeeName;
      if (jobNumber) header_overrides.job_number = jobNumber;
    }
    run(mode, {
      form_id: formId,
      entry_ids: selectedEntries.map((e) => e.id),
      header_overrides,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Export to vendor form</DialogTitle>
          <DialogDescription>
            {selectedEntries.length} entr{selectedEntries.length === 1 ? "y" : "ies"}{" "}
            {offerVerifiedOnly ? "to export" : "selected"}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {offerVerifiedOnly && unverifiedCount > 0 && (
            <label className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm">
              <Checkbox
                checked={verifiedOnly}
                onCheckedChange={(v) => setVerifiedOnly(v === true)}
                className="h-5 w-5"
              />
              <span>
                Verified entries only
                <span className="block text-xs text-muted-foreground">
                  {unverifiedCount} unverified {unverifiedCount === 1 ? "entry" : "entries"}{" "}
                  {verifiedOnly ? "left out" : "included"}
                </span>
              </span>
            </label>
          )}

          <div>
            <Label className="text-sm font-medium">Form</Label>
            <div className="mt-2">
              <FormPicker
                value={formId}
                onChange={setFormId}
                options={(["lendt_ojt_v1", "curtiss_wright_wer_v1"] as FormId[]).map((id) => ({
                  id,
                  label: FORM_LABELS[id],
                }))}
              />
            </div>
          </div>

          {unmappedCount > 0 && (
            <p className="text-sm text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40 p-2 rounded">
              {unmappedCount} of your selected entries use methods this form
              doesn&apos;t support and will be skipped.
            </p>
          )}

          {lendtPageCount > 1 && (
            <p className="text-sm text-muted-foreground bg-muted p-2 rounded">
              {selectedEntries.length} rows will be split across {lendtPageCount} pages
              (16 per page).
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="employee-name">
              {formId === "lendt_ojt_v1" ? "Employee name" : "Name"}
            </Label>
            <Input
              id="employee-name"
              value={employeeName}
              onChange={(e) => setEmployeeName(e.target.value)}
            />
          </div>

          {formId === "lendt_ojt_v1" ? (
            <div className="space-y-2">
              <Label htmlFor="employee-number">Employee number</Label>
              <Input
                id="employee-number"
                value={employeeNumber}
                onChange={(e) => setEmployeeNumber(e.target.value)}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="job-number">Job number</Label>
              <Input
                id="job-number"
                value={jobNumber}
                onChange={(e) => setJobNumber(e.target.value)}
              />
            </div>
          )}
        </div>

        <ExportFormFooter
          busy={busy}
          shareable={shareable}
          disabled={selectedEntries.length === 0}
          onCancel={() => onOpenChange(false)}
          onDownload={() => exportPdf("download")}
          onShare={() => exportPdf("share")}
        />
      </DialogContent>
    </Dialog>
  );
}
