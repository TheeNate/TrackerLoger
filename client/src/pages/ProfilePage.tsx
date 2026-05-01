import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ProfileHeader } from "@/components/ProfileHeader";
import { NewEntryForm } from "@/components/NewEntryForm";
import { OJTTable } from "@/components/OJTTable";
import { SupervisorVerifyModal } from "@/components/SupervisorVerifyModal";
import { EmailSentModal } from "@/components/EmailSentModal";
import { EditEntryDialog } from "@/components/EditEntryDialog";
import { ImportLogDialog } from "@/components/ImportLogDialog";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import { Entry, User } from "@shared/schema";

export default function ProfilePage() {
  const { toast } = useToast();
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [isVerifyModalOpen, setIsVerifyModalOpen] = useState(false);
  const [isEmailSentModalOpen, setIsEmailSentModalOpen] = useState(false);
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<number>>(new Set());
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);

  const { data: user, isLoading: isLoadingUser } = useQuery<User>({
    queryKey: ["/api/user"]
  });

  const { data: entries = [], isLoading: isLoadingEntries } = useQuery<Entry[]>({
    queryKey: ["/api/entries"],
    enabled: !!user
  });

  const verifiedEntries = entries.filter((entry: Entry) => entry.verified);

  const handleVerifyRequest = (entry: Entry) => {
    setSelectedEntry(entry);
    setIsVerifyModalOpen(true);
  };

  const handleVerificationSuccess = () => {
    setIsVerifyModalOpen(false);
    setIsBatchModalOpen(false);
    setSelectedEntryIds(new Set());
    setIsEmailSentModalOpen(true);
    queryClient.invalidateQueries({ queryKey: ["/api/entries"] });
  };

  const handleToggleSelect = useCallback((id: number) => {
    setSelectedEntryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  if (isLoadingUser) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const now = new Date();
  const dateString = now.toLocaleDateString();

  const selectedEntries = entries.filter((e) => selectedEntryIds.has(e.id));

  return (
    <div className="min-h-screen bg-neutral-100">
      <ProfileHeader user={user} verifiedEntries={verifiedEntries} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-end mb-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsImportDialogOpen(true)}
          >
            <Upload className="h-4 w-4 mr-2" />
            Import from signed log
          </Button>
        </div>

        <NewEntryForm />

        <OJTTable
          entries={entries}
          onVerifyRequest={handleVerifyRequest}
          selectedEntryIds={selectedEntryIds}
          onToggleSelect={handleToggleSelect}
          onBatchVerifyRequest={() => setIsBatchModalOpen(true)}
          onEditEntry={setEditingEntry}
        />

        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="text-sm text-neutral-500 mb-6">
            <p>The above is true and accurate to the best of my knowledge.</p>
          </div>

          <div className="flex flex-col sm:flex-row sm:justify-between items-start sm:items-center space-y-4 sm:space-y-0">
            <div>
              <span className="text-sm text-neutral-700 block mb-1">Digital Signature:</span>
              <span className="font-medium text-neutral-900">{user.name || user.email}</span>
            </div>

            <div>
              <span className="text-sm text-neutral-700 block mb-1">Date:</span>
              <span className="font-medium text-neutral-900">{dateString}</span>
            </div>
          </div>
        </div>
      </main>

      <SupervisorVerifyModal
        isOpen={isVerifyModalOpen}
        onClose={() => setIsVerifyModalOpen(false)}
        onSuccess={handleVerificationSuccess}
        entry={selectedEntry}
      />

      <SupervisorVerifyModal
        isOpen={isBatchModalOpen}
        onClose={() => setIsBatchModalOpen(false)}
        onSuccess={handleVerificationSuccess}
        entries={selectedEntries}
      />

      <EmailSentModal
        isOpen={isEmailSentModalOpen}
        onClose={() => setIsEmailSentModalOpen(false)}
      />

      <EditEntryDialog
        entry={editingEntry}
        open={!!editingEntry}
        onClose={() => setEditingEntry(null)}
      />

      <ImportLogDialog
        open={isImportDialogOpen}
        onClose={() => setIsImportDialogOpen(false)}
        type="ojt"
      />
    </div>
  );
}
