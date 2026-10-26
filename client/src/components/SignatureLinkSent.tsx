import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Copy, ExternalLink, Share2 } from "lucide-react";
import type { NotificationChannel } from "@/components/ChannelPicker";

export type SignatureDelivery = {
  email: "sent" | "failed" | "not_configured" | "skipped" | "invalid_number";
  sms: "sent" | "failed" | "not_configured" | "skipped" | "invalid_number";
  smsError?: string;
};

export type SignatureSupervisor = {
  name: string;
  email?: string | null;
  phone?: string | null;
};

interface SignatureLinkSentProps {
  verificationUrl: string;
  smsBody: string;
  supervisor: SignatureSupervisor;
  delivery: SignatureDelivery;
  entryCount?: number;
  onDone: () => void;
}

export function smsHref(phone: string | null | undefined, body: string) {
  const to = (phone ?? "").replace(/[^\d+]/g, "");
  return `sms:${to}?&body=${encodeURIComponent(body)}`;
}

export function mailtoHref(email: string, subject: string, body: string) {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function SignatureLinkSent({
  verificationUrl,
  smsBody,
  supervisor,
  delivery,
  entryCount,
  onDone,
}: SignatureLinkSentProps) {
  const [copied, setCopied] = useState(false);
  const requestedStatus = {
    email: delivery.email,
    sms: delivery.sms,
  };
  const failedToSend = (channel: NotificationChannel) =>
    requestedStatus[channel] !== "sent" &&
    requestedStatus[channel] !== "skipped";
  const firstName = supervisor.name.trim().split(/\s+/)[0] || "there";
  const emailBody = `Hi ${firstName},\n\n${smsBody}\n\nThanks!`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(verificationUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const share = async () => {
    if (!navigator.share) return;
    try {
      await navigator.share({
        title: "Sign off my hours",
        text: smsBody,
      });
    } catch {
      // Share sheets can be dismissed without completing a share.
    }
  };

  const statusText = (channel: NotificationChannel) => {
    const status = requestedStatus[channel];
    const label = channel === "email" ? "Email" : "Text";
    if (status === "skipped") return null;
    if (status === "sent") return `${label} sent`;
    if (status === "not_configured")
      return `${label}: tap below to send it from your phone`;
    if (status === "invalid_number")
      return "Text: phone number doesn't look valid";
    return `${label} delivery failed. You can share the link directly below.`;
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="font-medium">
          {entryCount && entryCount > 1
            ? `Sign-off link ready for ${entryCount} entries`
            : "Sign-off link ready"}
        </p>
        <p className="text-sm text-muted-foreground">
          Share the link with {supervisor.name}. You can send it from your own
          phone if automatic delivery is unavailable.
        </p>
      </div>

      <div className="space-y-1 text-sm" aria-live="polite">
        {(["email", "sms"] as const).map((channel) => {
          const text = statusText(channel);
          if (!text) return null;
          const sent = requestedStatus[channel] === "sent";
          return (
            <p
              key={channel}
              className={sent ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}
            >
              {sent ? "✓ " : ""}{text}
            </p>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        {failedToSend("email") && supervisor.email && (
          <Button asChild variant="outline">
            <a
              href={mailtoHref(
                supervisor.email,
                "Please sign off my logged hours",
                emailBody,
              )}
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Email from my phone
            </a>
          </Button>
        )}
        {failedToSend("sms") && supervisor.phone && (
          <Button asChild variant="outline">
            <a href={smsHref(supervisor.phone, smsBody)}>
              <ExternalLink className="mr-2 h-4 w-4" />
              Text from my phone
            </a>
          </Button>
        )}
        {typeof navigator !== "undefined" && !!navigator.share && (
          <Button type="button" variant="outline" onClick={share}>
            <Share2 className="mr-2 h-4 w-4" />
            Share link…
          </Button>
        )}
        <Button type="button" variant="outline" onClick={copyLink}>
          {copied ? (
            <Check className="mr-2 h-4 w-4" />
          ) : (
            <Copy className="mr-2 h-4 w-4" />
          )}
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>

      <div className="rounded-md bg-muted p-3">
        <p className="mb-1 text-xs font-medium text-muted-foreground">
          Verification link
        </p>
        <Input
          value={verificationUrl}
          readOnly
          aria-label="Verification link"
          className="break-all bg-background"
        />
      </div>

      <div className="flex justify-end">
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}
