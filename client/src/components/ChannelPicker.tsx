import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";

export type NotificationChannel = "email" | "sms";

interface ChannelPickerProps {
  email?: string | null;
  phone?: string | null;
  channels: NotificationChannel[];
  onChange: (channels: NotificationChannel[]) => void;
}

export function ChannelPicker({
  email,
  phone,
  channels,
  onChange,
}: ChannelPickerProps) {
  const { data: status } = useQuery<{ email: boolean; sms: boolean }>({
    queryKey: ["/api/notifications/status"],
  });

  const toggle = (channel: NotificationChannel) => {
    onChange(
      channels.includes(channel)
        ? channels.filter((item) => item !== channel)
        : [...channels, channel],
    );
  };

  const choices: {
    channel: NotificationChannel;
    label: string;
    contact?: string | null;
    configured?: boolean;
  }[] = [
    { channel: "email", label: "Email", contact: email, configured: status?.email },
    { channel: "sms", label: "Text", contact: phone, configured: status?.sms },
  ];

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Send by</legend>
      <div className="flex flex-wrap gap-2">
        {choices.map(({ channel, label, contact, configured }) => {
          const hasContact = Boolean(contact?.trim());
          const selected = channels.includes(channel);
          return (
            <Button
              key={channel}
              type="button"
              size="sm"
              variant={selected ? "default" : "outline"}
              aria-pressed={selected}
              disabled={!hasContact}
              onClick={() => toggle(channel)}
            >
              {label}
              {!hasContact
                ? " · none on file"
                : configured === false
                  ? " · sends from your phone"
                  : ""}
            </Button>
          );
        })}
      </div>
    </fieldset>
  );
}
