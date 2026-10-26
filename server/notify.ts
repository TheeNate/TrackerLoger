export type ChannelStatus =
  | "sent"
  | "failed"
  | "not_configured"
  | "skipped"
  | "invalid_number";

export type Channel = "email" | "sms";

export interface DeliveryResult {
  email: ChannelStatus;
  sms: ChannelStatus;
  smsError?: string;
}

export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY);

export const smsConfigured = () =>
  Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      (process.env.TWILIO_FROM_NUMBER ||
        process.env.TWILIO_MESSAGING_SERVICE_SID),
  );

export const notificationStatus = () => ({
  email: emailConfigured(),
  sms: smsConfigured(),
});

export function normalizePhone(
  raw: string | null | undefined,
  countryCode = "1",
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");

  if (trimmed.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (trimmed.startsWith("00")) {
    const internationalDigits = digits.slice(2);
    return internationalDigits.length >= 8 && internationalDigits.length <= 15
      ? `+${internationalDigits}`
      : null;
  }
  if (countryCode === "1") {
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    return null;
  }
  return digits.length >= 8 && digits.length + countryCode.length <= 15
    ? `+${countryCode}${digits}`
    : null;
}

export function buildSignatureSms(options: {
  requester: string;
  summary: string;
  url: string;
}): string {
  return `Rope Access Logbook: ${options.requester} asked you to sign off ${options.summary}. Review and sign: ${options.url}`;
}

export function parseChannels(input: unknown): Channel[] {
  if (!Array.isArray(input)) return ["email", "sms"];
  const channels = input.filter(
    (channel): channel is Channel => channel === "email" || channel === "sms",
  );
  return channels.length ? Array.from(new Set(channels)) : ["email", "sms"];
}

export async function sendSms(
  to: string | null | undefined,
  body: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: ChannelStatus; error?: string; id?: string }> {
  if (!smsConfigured()) return { status: "not_configured" };
  const phone = normalizePhone(to);
  if (!phone) return { status: "invalid_number" };

  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const params = new URLSearchParams({ To: phone, Body: body });
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
    params.set("MessagingServiceSid", process.env.TWILIO_MESSAGING_SERVICE_SID);
  } else {
    params.set("From", process.env.TWILIO_FROM_NUMBER!);
  }

  try {
    const response = await fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${accountSid}:${process.env.TWILIO_AUTH_TOKEN}`,
          ).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      },
    );
    const data = (await response.json().catch(() => ({}))) as {
      message?: string;
      sid?: string;
    };
    if (!response.ok) {
      return {
        status: "failed",
        error: data.message || `HTTP ${response.status}`,
      };
    }
    return { status: "sent", id: data.sid };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function deliverSignatureRequest(options: {
  channels: Channel[];
  phone: string | null | undefined;
  smsBody: string;
  sendEmail: () => Promise<boolean>;
  fetchImpl?: typeof fetch;
}): Promise<DeliveryResult> {
  const emailPromise: Promise<ChannelStatus> = !options.channels.includes("email")
    ? Promise.resolve<ChannelStatus>("skipped")
    : !emailConfigured()
      ? Promise.resolve<ChannelStatus>("not_configured")
      : options
          .sendEmail()
          .then((sent): ChannelStatus => (sent ? "sent" : "failed"))
          .catch((): ChannelStatus => "failed");
  const smsPromise: Promise<{ status: ChannelStatus; error?: string }> =
    !options.channels.includes("sms")
      ? Promise.resolve({ status: "skipped" as ChannelStatus })
      : sendSms(options.phone, options.smsBody, options.fetchImpl);
  const [email, smsDelivery] = await Promise.all([emailPromise, smsPromise]);

  return {
    email,
    sms: smsDelivery.status,
    ...(smsDelivery.error ? { smsError: smsDelivery.error } : {}),
  };
}
