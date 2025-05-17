import axios from "axios";
import { getBaseUrl } from "./email";

// Update the API URL to use MailerSend
const MAILSENDER_API_URL = "https://api.mailersend.com/v1/email";

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<boolean> {
  try {
    if (!process.env.MAILSENDER_API_KEY) {
      console.error("MAILSENDER_API_KEY is not set");
      return false;
    }

    const response = await axios.post(
      MAILSENDER_API_URL,
      {
        from: {
          email: "noreply@trackerloger.online",
          name: "OJT Hours Tracker",
        },
        to: [
          {
            email: to,
            name: "Recipient",
          },
        ],
        subject: subject,
        html: html,
        text: html.replace(/<[^>]*>/g, ""), // Simple HTML to text conversion
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.MAILSENDER_API_KEY}`,
        },
      },
    );

    console.log("Email sent successfully via MailerSend");
    return true;
  } catch (error) {
    console.error(
      "Error sending email via MailerSend:",
      error.response?.data || error.message,
    );
    return false;
  }
}

export async function sendMagicLinkEmail(
  email: string,
  token: string,
): Promise<string> {
  const baseUrl = getBaseUrl();
  const loginUrl = `${baseUrl}/login?token=${token}`;

  const emailSent = await sendEmail(
    email,
    "Your OJT Hours Tracker Login Link",
    `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>OJT Hours Tracker - Magic Link</h2>
      <p>Click the button below to log in to your account:</p>
      <p>
        <a 
          href="${loginUrl}" 
          style="display: inline-block; padding: 10px 20px; background-color: #1a73e8; color: white; text-decoration: none; border-radius: 4px;"
        >
          Log In
        </a>
      </p>
      <p>Or copy and paste this URL into your browser:</p>
      <p>${loginUrl}</p>
      <p>This link will expire in 24 hours.</p>
    </div>
  `,
  );

  if (!emailSent) {
    console.log("Magic link URL (fallback):", loginUrl);
  }

  return loginUrl;
}

export async function sendVerificationEmail(
  to: string,
  userName: string,
  employeeNumber: string | null | undefined,
  entryDetails: {
    date: Date;
    location: string;
    method: string;
    hours: number;
  },
  verificationUrl: string,
): Promise<boolean> {
  // Format method for display
  let displayMethod = entryDetails.method;
  if (displayMethod === "UT_THK") {
    displayMethod = "UT Thk.";
  }

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>OJT Hours Verification Request</h2>
      <p>${userName} ${employeeNumber ? `(Employee #: ${employeeNumber})` : ""} has requested your verification for the following OJT hours:</p>

      <div style="background-color: #f4f4f4; padding: 15px; border-radius: 4px; margin: 20px 0;">
        <p><strong>Date:</strong> ${new Date(entryDetails.date).toLocaleDateString()}</p>
        <p><strong>Location:</strong> ${entryDetails.location}</p>
        <p><strong>Method:</strong> ${displayMethod}</p>
        <p><strong>Hours:</strong> ${entryDetails.hours}</p>
      </div>

      <p>Please click the button below to verify these hours:</p>
      <p>
        <a 
          href="${verificationUrl}" 
          style="display: inline-block; padding: 10px 20px; background-color: #42be65; color: white; text-decoration: none; border-radius: 4px;"
        >
          Verify Hours
        </a>
      </p>
      <p>Or copy and paste this URL into your browser:</p>
      <p>${verificationUrl}</p>
    </div>
  `;

  return await sendEmail(
    to,
    `Verification Request for OJT Hours from ${userName}`,
    html,
  );
}
