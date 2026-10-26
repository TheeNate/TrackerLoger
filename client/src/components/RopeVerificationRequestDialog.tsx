import { useEffect, useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { RopeHours, Supervisor } from "@shared/schema";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChannelPicker, type NotificationChannel } from "./ChannelPicker";
import {
  SignatureLinkSent,
  type SignatureDelivery,
  type SignatureSupervisor,
} from "./SignatureLinkSent";

interface RopeVerificationRequestDialogProps {
  entry: RopeHours | null;
  supervisor: Supervisor | null;
  onClose: () => void;
  onSuccess: () => void;
}

interface RequestResult {
  verificationUrl: string;
  smsBody: string;
  delivery: SignatureDelivery;
  supervisor: SignatureSupervisor;
}

export function RopeVerificationRequestDialog({
  entry,
  supervisor,
  onClose,
  onSuccess,
}: RopeVerificationRequestDialogProps) {
  const { toast } = useToast();
  const [channels, setChannels] = useState<NotificationChannel[]>([
    "email",
    "sms",
  ]);
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<RequestResult | null>(null);
  const availableChannels = channels.filter((channel) =>
    channel === "email"
      ? Boolean(supervisor?.email?.trim())
      : Boolean(supervisor?.phone?.trim()),
  );

  useEffect(() => {
    if (entry && supervisor) {
      setChannels(["email", "sms"]);
      setResult(null);
    }
  }, [entry?.id, supervisor?.id]);

  const handleSend = async () => {
    if (!entry || !supervisor || availableChannels.length === 0) return;
    setIsSending(true);
    try {
      const response = await apiRequest(
        "POST",
        `/api/verify-request-rope/${entry.id}`,
        { supervisorId: supervisor.id, channels: availableChannels },
      );
      const data = await response.json();
      setResult({
        verificationUrl: data.verificationUrl,
        smsBody: data.smsBody,
        delivery: data.delivery,
        supervisor: data.supervisor ?? supervisor,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/rope-hours"] });
      toast({
        title: "Verification link ready",
        description: "Share the link with your supervisor to request sign-off.",
      });
    } catch (error) {
      toast({
        title: "Could not create verification request",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleDone = () => {
    onSuccess();
    onClose();
  };

  return (
    <Dialog
      open={!!entry && !!supervisor}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent className="sm:max-w-lg">
        {result ? (
          <SignatureLinkSent
            verificationUrl={result.verificationUrl}
            smsBody={result.smsBody}
            delivery={result.delivery}
            supervisor={result.supervisor}
            onDone={handleDone}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Request verification</DialogTitle>
              <DialogDescription>
                Choose how to send the sign-off link to {supervisor?.name}.
              </DialogDescription>
            </DialogHeader>
            <ChannelPicker
              email={supervisor?.email}
              phone={supervisor?.phone}
              channels={channels}
              onChange={setChannels}
            />
            <DialogFooter>
              <Button
                variant="outline"
                onClick={onClose}
                disabled={isSending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSend}
                disabled={isSending || availableChannels.length === 0}
              >
                {isSending ? "Creating link…" : "Create verification link"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
