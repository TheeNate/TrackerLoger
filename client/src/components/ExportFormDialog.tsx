import { useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import type { Entry } from "@shared/schema";

type FormId = "mistras_ojt_v1" | "curtiss_wright_wer_v1";

// Methods each form actually has a column for. Used only for the
// "N entries will be skipped" preview; the server is the source of truth.
const SUPPORTED_METHODS: Record<FormId, Set<string>> = {
  mistras_ojt_v1: new Set(["ET", "RFT", "MT", "PT", "RT", "UT_THK", "UTSW", "PAUT", "LSI"]),
  curtiss_wright_wer_v1: new Set(["MT", "PT", "UT_THK", "VT_1", "VT_2", "VT_3", "VWE"]),
};

const FORM_LABELS: Record<FormId, string> = {
  mistras_ojt_v1: "MISTRAS — Experience Hours (OJT)",
  curtiss_wright_wer_v1: "Curtiss-Wright — Work Experience Record",
};

interface ExportFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedEntries: Entry[];
}

export function ExportFormDialog({
  open, onOpenChange, selectedEntries,
}: ExportFormDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [formId, setFormId] = useState<FormId>("mistras_ojt_v1");
  const [employeeName, setEmployeeName] = useState(user?.name ?? "");
  const [employeeNumber, setEmployeeNumber] = useState(user?.employeeNumber ?? "");
  const [jobNumber, setJobNumber] = useState("");
  const [downloading, setDownloading] = useState(false);

  const unmappedCount = useMemo(() => {
    const supported = SUPPORTED_METHODS[formId];
    return selectedEntries.filter((e) => !supported.has(e.method)).length;
  }, [formId, selectedEntries]);

  async function handleDownload() {
    setDownloading(true);
    try {
      const header_overrides: Record<string, string> = {};
      if (formId === "mistras_ojt_v1") {
        if (employeeName) header_overrides.employee_name = employeeName;
        if (employeeName) header_overrides.employee_signature = employeeName;
        if (employeeNumber) header_overrides.employee_number = employeeNumber;
      } else {
        if (employeeName) header_overrides.name = employeeName;
        if (jobNumber) header_overrides.job_number = jobNumber;
      }

      const res = await fetch("/api/export-form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          form_id: formId,
          entry_ids: selectedEntries.map((e) => e.id),
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
          <DialogTitle>Export to vendor form</DialogTitle>
          <DialogDescription>
            {selectedEntries.length} entr{selectedEntries.length === 1 ? "y" : "ies"} selected.
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
              {(["mistras_ojt_v1", "curtiss_wright_wer_v1"] as FormId[]).map((id) => (
                <div key={id} className="flex items-center space-x-2">
                  <RadioGroupItem value={id} id={id} />
                  <Label htmlFor={id} className="font-normal">{FORM_LABELS[id]}</Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {unmappedCount > 0 && (
            <p className="text-sm text-amber-700 bg-amber-50 p-2 rounded">
              {unmappedCount} of your selected entries use methods this form
              doesn&apos;t support and will be skipped.
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="employee-name">
              {formId === "mistras_ojt_v1" ? "Employee name" : "Name"}
            </Label>
            <Input
              id="employee-name"
              value={employeeName}
              onChange={(e) => setEmployeeName(e.target.value)}
            />
          </div>

          {formId === "mistras_ojt_v1" ? (
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

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={downloading}>
            Cancel
          </Button>
          <Button onClick={handleDownload} disabled={downloading || selectedEntries.length === 0}>
            {downloading ? "Generating…" : "Download"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
