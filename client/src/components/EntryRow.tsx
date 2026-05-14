import { Entry } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Pencil, FileText, Trash2 } from "lucide-react";
import { SourceDocumentLink } from "@/components/SourceDocumentLink";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface EntryRowProps {
  entry: Entry;
  onVerifyRequest: (entry: Entry) => void;
  isSelected?: boolean;
  onToggleSelect?: (id: number) => void;
  onEdit?: (entry: Entry) => void;
}

export function EntryRow({ entry, onVerifyRequest, isSelected, onToggleSelect, onEdit }: EntryRowProps) {
  const isImported = !!entry.importedAt;
  const { toast } = useToast();

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/entries/${entry.id}`);
    },
    onSuccess: () => {
      toast({
        title: "Entry removed",
        description: "The imported entry has been deleted.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/entries"] });
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Please try again.";
      toast({
        title: "Could not remove entry",
        description: message,
        variant: "destructive",
      });
    },
  });

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString();
  };

  const cellTextClass = isImported ? "text-neutral-500" : "text-neutral-900";

  const createHourCell = (method: string) => {
    if (entry.method === method) {
      return (
        <td className={`px-4 py-3 whitespace-nowrap text-sm ${cellTextClass}`}>
          {entry.hours.toFixed(1)}
        </td>
      );
    }
    return <td className={`px-4 py-3 whitespace-nowrap text-sm ${cellTextClass}`}></td>;
  };

  const rowClass = isImported
    ? "bg-neutral-50 text-neutral-500"
    : entry.verified
    ? "bg-green-50"
    : isSelected
    ? "bg-blue-50"
    : "";

  return (
    <tr className={rowClass}>
      <td className="px-3 py-3 whitespace-nowrap">
        {!entry.verified && !isImported && onToggleSelect && (
          <Checkbox
            checked={isSelected ?? false}
            onCheckedChange={() => onToggleSelect(entry.id)}
            aria-label="Select entry"
          />
        )}
      </td>
      <td className={`px-4 py-3 whitespace-nowrap text-sm ${cellTextClass}`}>
        {formatDate(entry.date)}
      </td>
      <td className={`px-4 py-3 whitespace-nowrap text-sm ${cellTextClass}`}>
        {entry.location}
      </td>
      {createHourCell("ET")}
      {createHourCell("RFT")}
      {createHourCell("MT")}
      {createHourCell("PT")}
      {createHourCell("RT")}
      {createHourCell("UT_THK")}
      {createHourCell("UTSW")}
      {createHourCell("PMI")}
      {createHourCell("LSI")}
      <td className="px-4 py-3 whitespace-nowrap text-sm">
        {isImported ? (
          <div className="flex items-center gap-2 flex-wrap">
            <FileText className="h-3.5 w-3.5 text-neutral-500" />
            <span className="text-neutral-600">Imported from signed log</span>
            <SourceDocumentLink recordType="entry" recordId={entry.id} />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                  aria-label="Remove imported entry"
                  title="Remove imported entry"
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Remove
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove this imported entry?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will delete the imported OJT entry from{" "}
                    {formatDate(entry.date)} at {entry.location}. If no other
                    entries reference the uploaded log, the original file will
                    also be removed from storage. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteMutation.mutate()}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    Remove
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : entry.verified ? (
          <div className="flex items-center">
            <svg className="mr-1.5 h-2 w-2 text-green-500" fill="currentColor" viewBox="0 0 8 8">
              <circle cx="4" cy="4" r="3" />
            </svg>
            <span className="text-green-700">Verified by {entry.verifiedBy}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {onEdit && !entry.verificationRequestedAt && (
              <Button
                onClick={() => onEdit(entry)}
                size="sm"
                variant="ghost"
                className="text-xs px-2"
                aria-label="Edit entry"
                title="Edit entry"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              onClick={() => onVerifyRequest(entry)}
              size="sm"
              variant="outline"
              className="text-xs"
            >
              Request Verification
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}
