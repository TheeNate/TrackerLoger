import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, Upload, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { NDTMethods } from "@shared/schema";

type ImportType = "ojt" | "rope";

interface OJTRow {
  date: string;
  location: string;
  method: string;
  hours: string;
}

interface RopeRow {
  startDate: string;
  endDate: string;
  location: string;
  skills: string;
  hours: string;
}

interface ExtractResponse {
  sourceDocumentKey: string;
  sourceDocumentName: string;
  rows: any[];
  extractionError: string | null;
}

interface ImportLogDialogProps {
  open: boolean;
  onClose: () => void;
  type: ImportType;
}

const METHOD_OPTIONS = Object.keys(NDTMethods);

const emptyOJTRow = (): OJTRow => ({
  date: "",
  location: "",
  method: "ET",
  hours: "",
});

const emptyRopeRow = (): RopeRow => ({
  startDate: "",
  endDate: "",
  location: "",
  skills: "",
  hours: "",
});

export function ImportLogDialog({ open, onClose, type }: ImportLogDialogProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [stage, setStage] = useState<"pick" | "review">("pick");
  const [isExtracting, setIsExtracting] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [sourceDocumentKey, setSourceDocumentKey] = useState<string | null>(
    null,
  );
  const [sourceDocumentName, setSourceDocumentName] = useState<string>("");
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [ojtRows, setOJTRows] = useState<OJTRow[]>([]);
  const [ropeRows, setRopeRows] = useState<RopeRow[]>([]);

  const reset = () => {
    setStage("pick");
    setIsExtracting(false);
    setIsCommitting(false);
    setSourceDocumentKey(null);
    setSourceDocumentName("");
    setExtractionError(null);
    setOJTRows([]);
    setRopeRows([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClose = () => {
    if (isExtracting || isCommitting) return;
    reset();
    onClose();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsExtracting(true);
    setExtractionError(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("type", type);

    try {
      const res = await fetch("/api/imports/extract", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to process the document");
      }
      const data: ExtractResponse = await res.json();
      setSourceDocumentKey(data.sourceDocumentKey);
      setSourceDocumentName(data.sourceDocumentName);
      setExtractionError(data.extractionError);

      if (type === "ojt") {
        const rows: OJTRow[] = (data.rows || []).map((r: any) => ({
          date:
            typeof r.date === "string" ? r.date.slice(0, 10) : "",
          location: r.location ?? "",
          method: METHOD_OPTIONS.includes(r.method) ? r.method : "ET",
          hours:
            typeof r.hours === "number" ? r.hours.toString() : "",
        }));
        setOJTRows(rows.length > 0 ? rows : [emptyOJTRow()]);
      } else {
        const rows: RopeRow[] = (data.rows || []).map((r: any) => ({
          startDate:
            typeof r.startDate === "string" ? r.startDate.slice(0, 10) : "",
          endDate:
            typeof r.endDate === "string" ? r.endDate.slice(0, 10) : "",
          location: r.location ?? "",
          skills: r.skills ?? "",
          hours:
            typeof r.hours === "number" ? r.hours.toString() : "",
        }));
        setRopeRows(rows.length > 0 ? rows : [emptyRopeRow()]);
      }
      setStage("review");
    } catch (err: any) {
      toast({
        title: "Upload failed",
        description: err?.message || "Could not process the document",
        variant: "destructive",
      });
    } finally {
      setIsExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const updateOJTRow = (idx: number, patch: Partial<OJTRow>) => {
    setOJTRows((rows) =>
      rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    );
  };

  const updateRopeRow = (idx: number, patch: Partial<RopeRow>) => {
    setRopeRows((rows) =>
      rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    );
  };

  const removeOJTRow = (idx: number) => {
    setOJTRows((rows) => rows.filter((_, i) => i !== idx));
  };

  const removeRopeRow = (idx: number) => {
    setRopeRows((rows) => rows.filter((_, i) => i !== idx));
  };

  const validateAndBuildPayload = ():
    | { ok: true; rows: any[] }
    | { ok: false; error: string } => {
    if (type === "ojt") {
      if (ojtRows.length === 0) {
        return { ok: false, error: "Add at least one entry to import" };
      }
      const built: any[] = [];
      for (let i = 0; i < ojtRows.length; i++) {
        const r = ojtRows[i];
        if (!r.date) return { ok: false, error: `Row ${i + 1}: date required` };
        if (!r.location.trim())
          return { ok: false, error: `Row ${i + 1}: location required` };
        if (!METHOD_OPTIONS.includes(r.method))
          return { ok: false, error: `Row ${i + 1}: invalid method` };
        const hrs = parseFloat(r.hours);
        if (!Number.isFinite(hrs) || hrs <= 0 || hrs > 24)
          return {
            ok: false,
            error: `Row ${i + 1}: hours must be between 0 and 24`,
          };
        built.push({
          date: r.date,
          location: r.location.trim(),
          method: r.method,
          hours: hrs,
        });
      }
      return { ok: true, rows: built };
    } else {
      if (ropeRows.length === 0) {
        return { ok: false, error: "Add at least one entry to import" };
      }
      const built: any[] = [];
      for (let i = 0; i < ropeRows.length; i++) {
        const r = ropeRows[i];
        if (!r.startDate)
          return { ok: false, error: `Row ${i + 1}: start date required` };
        if (!r.endDate)
          return { ok: false, error: `Row ${i + 1}: end date required` };
        if (new Date(r.endDate) < new Date(r.startDate))
          return {
            ok: false,
            error: `Row ${i + 1}: end date must be on or after start date`,
          };
        if (!r.location.trim())
          return { ok: false, error: `Row ${i + 1}: location required` };
        if (!r.skills.trim())
          return { ok: false, error: `Row ${i + 1}: skills required` };
        const hrs = parseFloat(r.hours);
        if (!Number.isFinite(hrs) || hrs <= 0 || hrs > 24)
          return {
            ok: false,
            error: `Row ${i + 1}: hours must be between 0 and 24`,
          };
        built.push({
          startDate: r.startDate,
          endDate: r.endDate,
          location: r.location.trim(),
          skills: r.skills.trim(),
          hours: hrs,
        });
      }
      return { ok: true, rows: built };
    }
  };

  const handleConfirm = async () => {
    if (!sourceDocumentKey) return;
    const payload = validateAndBuildPayload();
    if (!payload.ok) {
      toast({
        title: "Cannot import",
        description: payload.error,
        variant: "destructive",
      });
      return;
    }
    setIsCommitting(true);
    try {
      const res = await fetch("/api/imports/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          type,
          sourceDocumentKey,
          sourceDocumentName,
          rows: payload.rows,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to import entries");
      }
      const result = await res.json();
      toast({
        title: "Imported",
        description: `${result.created?.length ?? payload.rows.length} ${
          type === "ojt" ? "OJT entries" : "rope hour entries"
        } imported from your signed log.`,
      });
      queryClient.invalidateQueries({
        queryKey: [type === "ojt" ? "/api/entries" : "/api/rope-hours"],
      });
      reset();
      onClose();
    } catch (err: any) {
      toast({
        title: "Import failed",
        description: err?.message || "Could not import entries",
        variant: "destructive",
      });
    } finally {
      setIsCommitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : handleClose())}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Import {type === "ojt" ? "OJT" : "rope"} hours from a signed log
          </DialogTitle>
          <DialogDescription>
            Upload a photo or PDF of your signed log book. We'll read it
            automatically — you can review and edit before importing.
          </DialogDescription>
        </DialogHeader>

        {stage === "pick" && (
          <div className="py-4 space-y-4">
            <div className="border-2 border-dashed border-neutral-300 rounded-lg p-8 text-center">
              <Upload className="h-10 w-10 mx-auto mb-3 text-neutral-400" />
              <p className="text-sm text-neutral-600 mb-4">
                PDF, JPG, PNG, or WEBP. Max 15 MB.
              </p>
              <Input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/jpeg,image/jpg,image/png,image/webp,image/heic"
                onChange={handleFileSelected}
                disabled={isExtracting}
                className="max-w-sm mx-auto"
              />
              {isExtracting && (
                <div className="flex items-center justify-center gap-2 mt-4 text-sm text-neutral-600">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Reading your document with AI…
                </div>
              )}
            </div>
          </div>
        )}

        {stage === "review" && (
          <div className="py-4 space-y-4">
            <div className="flex items-center gap-2 text-sm text-neutral-700">
              <FileText className="h-4 w-4" />
              <span className="truncate">{sourceDocumentName}</span>
              <Badge variant="secondary">Imported document</Badge>
            </div>

            {extractionError && (
              <Alert>
                <AlertDescription>
                  We couldn't read this document automatically. You can still
                  add the entries manually below.
                </AlertDescription>
              </Alert>
            )}

            {!extractionError &&
              ((type === "ojt" && ojtRows.length === 1 && !ojtRows[0].date) ||
                (type === "rope" &&
                  ropeRows.length === 1 &&
                  !ropeRows[0].startDate)) && (
                <Alert>
                  <AlertDescription>
                    No entries were detected. Add them manually below.
                  </AlertDescription>
                </Alert>
              )}

            {type === "ojt" ? (
              <div className="space-y-3">
                <div className="grid grid-cols-12 gap-2 text-xs font-medium text-neutral-600 px-1">
                  <div className="col-span-3">Date</div>
                  <div className="col-span-4">Location</div>
                  <div className="col-span-2">Method</div>
                  <div className="col-span-2">Hours</div>
                  <div className="col-span-1"></div>
                </div>
                {ojtRows.map((row, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-12 gap-2 items-center"
                  >
                    <Input
                      type="date"
                      className="col-span-3"
                      value={row.date}
                      onChange={(e) =>
                        updateOJTRow(idx, { date: e.target.value })
                      }
                    />
                    <Input
                      className="col-span-4"
                      placeholder="Location"
                      value={row.location}
                      onChange={(e) =>
                        updateOJTRow(idx, { location: e.target.value })
                      }
                    />
                    <Select
                      value={row.method}
                      onValueChange={(v) => updateOJTRow(idx, { method: v })}
                    >
                      <SelectTrigger className="col-span-2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {METHOD_OPTIONS.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      max="24"
                      className="col-span-2"
                      placeholder="Hrs"
                      value={row.hours}
                      onChange={(e) =>
                        updateOJTRow(idx, { hours: e.target.value })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="col-span-1"
                      onClick={() => removeOJTRow(idx)}
                      aria-label="Remove row"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setOJTRows((r) => [...r, emptyOJTRow()])}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add row
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {ropeRows.map((row, idx) => (
                  <div
                    key={idx}
                    className="border rounded-md p-3 space-y-2 relative"
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute top-2 right-2"
                      onClick={() => removeRopeRow(idx)}
                      aria-label="Remove row"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">Start date</Label>
                        <Input
                          type="date"
                          value={row.startDate}
                          onChange={(e) =>
                            updateRopeRow(idx, { startDate: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <Label className="text-xs">End date</Label>
                        <Input
                          type="date"
                          value={row.endDate}
                          onChange={(e) =>
                            updateRopeRow(idx, { endDate: e.target.value })
                          }
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">Location</Label>
                        <Input
                          placeholder="Location"
                          value={row.location}
                          onChange={(e) =>
                            updateRopeRow(idx, { location: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Hours</Label>
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          max="24"
                          value={row.hours}
                          onChange={(e) =>
                            updateRopeRow(idx, { hours: e.target.value })
                          }
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Skills</Label>
                      <Input
                        placeholder="Skills used"
                        value={row.skills}
                        onChange={(e) =>
                          updateRopeRow(idx, { skills: e.target.value })
                        }
                      />
                    </div>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRopeRows((r) => [...r, emptyRopeRow()])}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add row
                </Button>
              </div>
            )}

            <p className="text-xs text-neutral-500">
              Imported entries are saved as already-verified and linked to your
              uploaded log. They will be shown without a digital signature and
              cannot be sent for verification.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isExtracting || isCommitting}
          >
            Cancel
          </Button>
          {stage === "review" && (
            <Button onClick={handleConfirm} disabled={isCommitting}>
              {isCommitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Importing…
                </>
              ) : (
                "Import entries"
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
