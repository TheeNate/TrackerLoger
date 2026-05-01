import OpenAI from "openai";
import { NDTMethods, type NDTMethod } from "@shared/schema";

const VALID_METHODS = Object.keys(NDTMethods) as NDTMethod[];

export interface ExtractedOJTRow {
  date: string; // ISO YYYY-MM-DD
  location: string;
  method: NDTMethod;
  hours: number;
}

export interface ExtractedRopeRow {
  startDate: string; // ISO YYYY-MM-DD
  endDate: string; // ISO YYYY-MM-DD
  location: string;
  skills: string;
  hours: number;
}

export type ImportType = "ojt" | "rope";

const OJT_INSTRUCTIONS = `You are extracting On-the-Job Training (OJT) hours from a signed
NDT (Non-Destructive Testing) log book page. Return STRICT JSON only.

Schema:
{
  "rows": [
    {
      "date": "YYYY-MM-DD",
      "location": "string (worksite/job location)",
      "method": "one of: ${VALID_METHODS.join(", ")}",
      "hours": number (decimal, e.g. 4 or 4.5)
    }
  ]
}

NDT method abbreviations you may see: ET (Eddy Current), RFT (Remote Field), MT
(Magnetic Particle), PT (Penetrant), RT (Radiographic), UT_THK (Ultrasonic
Thickness), UTSW (Ultrasonic Shear Wave), PMI (Positive Material Identification),
LSI (Leak Seal Integrity / Internal). Map any equivalents to one of the listed
codes. If a row has hours split across multiple methods, return ONE row per
method. Skip rows without a clear method or hours value. If you cannot read the
document, return {"rows": []}.`;

const ROPE_INSTRUCTIONS = `You are extracting Rope Access training hours from a
signed log book page. Return STRICT JSON only.

Schema:
{
  "rows": [
    {
      "startDate": "YYYY-MM-DD",
      "endDate": "YYYY-MM-DD (same as startDate if single-day)",
      "location": "string (worksite/job location)",
      "skills": "string (techniques used: rigging, rescue, ascending, etc.)",
      "hours": number
    }
  ]
}

Skip rows without clear dates, location, or hours. If you cannot read the
document, return {"rows": []}.`;

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!apiKey || !baseURL) {
    throw new Error(
      "OpenAI integration not configured. AI_INTEGRATIONS_OPENAI_API_KEY and " +
        "AI_INTEGRATIONS_OPENAI_BASE_URL env vars must be set.",
    );
  }
  return new OpenAI({ apiKey, baseURL });
}

function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

function isPdfMime(mime: string): boolean {
  return mime === "application/pdf" || mime === "application/x-pdf";
}

async function callVisionExtraction(
  buffer: Buffer,
  contentType: string,
  instructions: string,
): Promise<unknown> {
  const openai = getOpenAIClient();
  const dataUrl = `data:${contentType};base64,${buffer.toString("base64")}`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.4",
    response_format: { type: "json_object" },
    max_completion_tokens: 8192,
    messages: [
      {
        role: "system",
        content:
          "You are a precise data extraction assistant. Output ONLY valid JSON " +
          "matching the requested schema. Never include commentary.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: instructions },
          {
            type: "image_url",
            image_url: { url: dataUrl, detail: "high" },
          },
        ],
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    return { rows: [] };
  }
  try {
    return JSON.parse(content);
  } catch {
    return { rows: [] };
  }
}

function isValidDateString(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
}

function sanitizeOJTRows(parsed: unknown): ExtractedOJTRow[] {
  const obj = parsed as { rows?: unknown };
  if (!obj || !Array.isArray(obj.rows)) return [];
  const out: ExtractedOJTRow[] = [];
  for (const raw of obj.rows) {
    const r = raw as Partial<ExtractedOJTRow>;
    if (
      !isValidDateString(r.date) ||
      typeof r.location !== "string" ||
      typeof r.method !== "string" ||
      !VALID_METHODS.includes(r.method as NDTMethod) ||
      typeof r.hours !== "number" ||
      !Number.isFinite(r.hours) ||
      r.hours <= 0
    ) {
      continue;
    }
    out.push({
      date: r.date,
      location: r.location.trim(),
      method: r.method as NDTMethod,
      hours: Math.round(r.hours * 10) / 10,
    });
  }
  return out;
}

function sanitizeRopeRows(parsed: unknown): ExtractedRopeRow[] {
  const obj = parsed as { rows?: unknown };
  if (!obj || !Array.isArray(obj.rows)) return [];
  const out: ExtractedRopeRow[] = [];
  for (const raw of obj.rows) {
    const r = raw as Partial<ExtractedRopeRow>;
    if (
      !isValidDateString(r.startDate) ||
      !isValidDateString(r.endDate) ||
      typeof r.location !== "string" ||
      typeof r.skills !== "string" ||
      typeof r.hours !== "number" ||
      !Number.isFinite(r.hours) ||
      r.hours <= 0
    ) {
      continue;
    }
    out.push({
      startDate: r.startDate,
      endDate: r.endDate,
      location: r.location.trim(),
      skills: r.skills.trim(),
      hours: Math.round(r.hours * 10) / 10,
    });
  }
  return out;
}

export async function extractOJTRows(
  buffer: Buffer,
  contentType: string,
): Promise<ExtractedOJTRow[]> {
  if (!isImageMime(contentType) && !isPdfMime(contentType)) {
    throw new Error(
      "Unsupported file type. Please upload a PDF or image (JPG, PNG, WEBP).",
    );
  }
  // The vision API supports image inputs natively. PDFs need to be sent the
  // same way; OpenAI accepts PDFs as image_url data URLs in recent models.
  const parsed = await callVisionExtraction(
    buffer,
    contentType,
    OJT_INSTRUCTIONS,
  );
  return sanitizeOJTRows(parsed);
}

export async function extractRopeRows(
  buffer: Buffer,
  contentType: string,
): Promise<ExtractedRopeRow[]> {
  if (!isImageMime(contentType) && !isPdfMime(contentType)) {
    throw new Error(
      "Unsupported file type. Please upload a PDF or image (JPG, PNG, WEBP).",
    );
  }
  const parsed = await callVisionExtraction(
    buffer,
    contentType,
    ROPE_INSTRUCTIONS,
  );
  return sanitizeRopeRows(parsed);
}
