import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deliverSignatureRequest,
  normalizePhone,
  parseChannels,
} from "../server/notify";

const notificationEnv = [
  "RESEND_API_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
  "TWILIO_MESSAGING_SERVICE_SID",
] as const;

const originalEnv = Object.fromEntries(
  notificationEnv.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of notificationEnv) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  vi.restoreAllMocks();
});

describe("normalizePhone", () => {
  it("normalizes US and international phone numbers", () => {
    expect(normalizePhone("(415) 555-0132")).toBe("+14155550132");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("00442079460958")).toBe("+442079460958");
  });

  it("rejects phone numbers outside supported lengths", () => {
    expect(normalizePhone("555")).toBeNull();
    expect(normalizePhone("1234567890123456")).toBeNull();
  });
});

describe("parseChannels", () => {
  it("defaults to both channels and filters duplicate/invalid values", () => {
    expect(parseChannels(undefined)).toEqual(["email", "sms"]);
    expect(parseChannels(["sms", "email", "sms", "fax"])).toEqual([
      "sms",
      "email",
    ]);
  });

  it("defaults to both channels when the provided list is empty", () => {
    expect(parseChannels([])).toEqual(["email", "sms"]);
    expect(parseChannels(["fax"])).toEqual(["email", "sms"]);
  });
});

describe("deliverSignatureRequest", () => {
  it("returns not_configured without requiring provider keys", async () => {
    for (const key of notificationEnv) delete process.env[key];
    const sendEmail = vi.fn(async () => true);

    await expect(
      deliverSignatureRequest({
        channels: ["email", "sms"],
        phone: "+14155550132",
        smsBody: "Review: https://example.com/verify/abc",
        sendEmail,
      }),
    ).resolves.toEqual({ email: "not_configured", sms: "not_configured" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("marks unselected channels skipped", async () => {
    for (const key of notificationEnv) delete process.env[key];
    await expect(
      deliverSignatureRequest({
        channels: ["email"],
        phone: "+14155550132",
        smsBody: "Review",
        sendEmail: vi.fn(),
      }),
    ).resolves.toEqual({ email: "not_configured", sms: "skipped" });
  });

  it("reports Twilio failures without throwing", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC-test";
    process.env.TWILIO_AUTH_TOKEN = "test-token";
    process.env.TWILIO_FROM_NUMBER = "+14155550100";
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ message: "Twilio unavailable" }), {
        status: 503,
      }),
    );

    const result = await deliverSignatureRequest({
      channels: ["sms"],
      phone: "+14155550132",
      smsBody: "Review",
      sendEmail: vi.fn(),
      fetchImpl: fetchMock,
    });
    expect(result.sms).toBe("failed");
    expect(result.smsError).toBe("Twilio unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
