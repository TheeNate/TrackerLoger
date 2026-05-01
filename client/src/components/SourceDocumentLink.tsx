import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface SourceDocumentLinkProps {
  recordType: "entry" | "rope";
  recordId: number;
  /**
   * Optional verification token. When provided, the supervisor verification
   * page can use it to access the source document without being logged in.
   */
  verificationToken?: string;
  className?: string;
}

export function SourceDocumentLink({
  recordType,
  recordId,
  verificationToken,
  className,
}: SourceDocumentLinkProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const handleClick = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        type: recordType,
        id: recordId.toString(),
      });
      if (verificationToken) {
        params.set("token", verificationToken);
      }
      const res = await fetch(`/api/source-document?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Could not open the signed log");
      }
      const data: { url: string; name: string | null } = await res.json();
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      toast({
        title: "Could not open log",
        description: err?.message || "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isLoading}
      className={
        className ??
        "inline-flex items-center gap-1 text-xs text-blue-600 hover:underline disabled:opacity-50"
      }
    >
      {isLoading ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <ExternalLink className="h-3 w-3" />
      )}
      View signed log
    </button>
  );
}
