import { useMemo, useRef, useState } from "react";
import { Check, Download, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  canShareFiles,
  downloadBlob,
  filenameFromResponse,
  shareFile,
} from "@/lib/shareFile";

// Shared pieces of the vendor-form export dialogs (OJT and rope): a list of
// big tappable form rows, and a footer that downloads the server-filled PDF
// or hands it to the phone's share sheet.

export function FormPicker<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (id: T) => void;
  options: { id: T; label: string; summary?: string }[];
}) {
  return (
    <div className="space-y-2" role="radiogroup" aria-label="Form">
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.id)}
            className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
              active ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
            }`}
          >
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                active ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
              }`}
            >
              {active && <Check className="h-3 w-3" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-foreground">{o.label}</span>
              {o.summary && (
                <span className="block text-xs text-muted-foreground">{o.summary}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

type ExportRequest = {
  form_id: string;
  entry_ids: number[];
  header_overrides: Record<string, string>;
};

// Fetches the filled PDF from /api/export-form and downloads or shares it.
// navigator.share() needs a fresh tap; if the fetch took long enough for the
// browser to drop it, the PDF is kept and the next Share tap sends it at once.
export function useFormPdfExport(title: string, onDone: () => void) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<"download" | "share" | null>(null);
  const shareable = useMemo(() => canShareFiles(), []);
  const ready = useRef<{ key: string; blob: Blob; fileName: string } | null>(null);

  async function fetchPdf(req: ExportRequest) {
    const key = JSON.stringify(req);
    if (ready.current?.key === key) return ready.current;
    const res = await fetch("/api/export-form", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: key,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({
        title: "Export failed",
        description: (body as { message?: string }).message ?? `HTTP ${res.status}`,
        variant: "destructive",
      });
      return null;
    }
    const pdf = {
      key,
      blob: await res.blob(),
      fileName: filenameFromResponse(res, `${req.form_id}.pdf`),
    };
    ready.current = pdf;
    return pdf;
  }

  async function run(mode: "download" | "share", req: ExportRequest) {
    setBusy(mode);
    try {
      const pdf = await fetchPdf(req);
      if (!pdf) return;
      if (mode === "download") {
        downloadBlob(pdf.blob, pdf.fileName);
      } else {
        try {
          await shareFile(pdf.blob, pdf.fileName, title);
        } catch (error: any) {
          // AbortError = the user closed the share sheet; not a failure.
          if (error?.name === "AbortError") return;
          if (error?.name === "NotAllowedError") {
            toast({ title: "PDF ready", description: "Tap Share hours again to send it." });
            return;
          }
          throw error;
        }
      }
      ready.current = null;
      onDone();
    } catch (error) {
      console.error(error);
      toast({
        title: mode === "share" ? "Couldn't share" : "Export failed",
        description: mode === "share" ? "Try Download PDF instead." : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  return { busy, shareable, run };
}

export function ExportFormFooter({
  busy,
  shareable,
  disabled,
  onCancel,
  onDownload,
  onShare,
}: {
  busy: "download" | "share" | null;
  shareable: boolean;
  disabled: boolean;
  onCancel: () => void;
  onDownload: () => void;
  onShare: () => void;
}) {
  return (
    <DialogFooter className="mt-2 flex-col gap-2 sm:flex-row">
      <Button
        variant="outline"
        className="hidden sm:inline-flex"
        onClick={onCancel}
        disabled={!!busy}
      >
        Cancel
      </Button>
      {shareable && (
        <Button
          type="button"
          variant="outline"
          className="h-12 sm:h-10"
          disabled={disabled || !!busy}
          onClick={onShare}
        >
          <Share2 className="mr-2 h-4 w-4" />
          {busy === "share" ? "Preparing…" : "Share hours"}
        </Button>
      )}
      <Button
        type="button"
        className="h-12 sm:h-10"
        disabled={disabled || !!busy}
        onClick={onDownload}
      >
        <Download className="mr-2 h-4 w-4" />
        {busy === "download" ? "Generating…" : "Download PDF"}
      </Button>
    </DialogFooter>
  );
}
