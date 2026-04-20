import { Entry, RopeHours, User, Supervisor } from '@shared/schema';
import { Resend } from 'resend';

// Configure Resend
let resend: Resend | null = null;
if (!process.env.RESEND_API_KEY) {
  console.warn('RESEND_API_KEY not found, emails will not be sent');
} else {
  resend = new Resend(process.env.RESEND_API_KEY);
  console.log('Resend API key configured');
}

// Default sender email using verified domain
const DEFAULT_FROM_EMAIL = 'noreply@n8ai.io';

// Custom domain — all verification/reset links use this
const CUSTOM_DOMAIN = 'ojt.n8ai.io';

// Get base URL for links — always uses the custom domain in production
export const getBaseUrl = () => {
  if (process.env.NODE_ENV === 'production') {
    return `https://${CUSTOM_DOMAIN}`;
  }
  return 'http://localhost:5000';
};

// Send email with Resend
export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  try {
    if (!resend) {
      console.error('RESEND_API_KEY not set');
      return false;
    }

    const { data, error } = await resend.emails.send({
      from: `OJT Hours Tracker <${DEFAULT_FROM_EMAIL}>`,
      to: [to],
      subject,
      html,
      text: html.replace(/<[^>]*>/g, '')
    });

    if (error) {
      console.error('Error sending email via Resend:', error);
      return false;
    }

    console.log('Email sent successfully via Resend:', data?.id);
    return true;
  } catch (error: any) {
    console.error('Error sending email via Resend:', error.message);
    return false;
  }
}

// Send verification request email for OJT entries
export async function sendVerificationRequest(
  supervisor: Supervisor,
  user: User,
  entry: Entry
): Promise<boolean> {
  const verificationUrl = `${getBaseUrl()}/verify/${entry.verificationToken}`;

  console.log("\n-------------------------------------------------");
  console.log("VERIFICATION LINK (For testing):");
  console.log(verificationUrl);
  console.log("-------------------------------------------------\n");

  let displayMethod = entry.method;
  if (displayMethod === 'UT_THK') {
    displayMethod = 'UT Thk.';
  }

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>OJT Hours Verification Request</h2>
      <p>${user.name || user.email} ${user.employeeNumber ? `(Employee #: ${user.employeeNumber})` : ''} has requested your verification for the following OJT hours:</p>
      
      <div style="background-color: #f4f4f4; padding: 15px; border-radius: 4px; margin: 20px 0;">
        <p><strong>Date:</strong> ${new Date(entry.date).toLocaleDateString()}</p>
        <p><strong>Location:</strong> ${entry.location}</p>
        <p><strong>Method:</strong> ${displayMethod}</p>
        <p><strong>Hours:</strong> ${entry.hours}</p>
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
    supervisor.email,
    `Verification Request for OJT Hours from ${user.name || user.email}`,
    html
  );
}

// Send verification request email for Rope Hours entries
export async function sendRopeHoursVerificationRequest(
  supervisor: Supervisor,
  user: User,
  ropeHour: RopeHours
): Promise<boolean> {
  const verificationUrl = `${getBaseUrl()}/verify/${ropeHour.verificationToken}`;

  console.log("\n-------------------------------------------------");
  console.log("ROPE HOURS VERIFICATION LINK (For testing):");
  console.log(verificationUrl);
  console.log("-------------------------------------------------\n");

  const startDate = new Date(ropeHour.startDate).toLocaleDateString();
  const endDate = new Date(ropeHour.endDate).toLocaleDateString();

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Rope Access Hours Verification Request</h2>
      <p>${user.name || user.email} ${user.employeeNumber ? `(Employee #: ${user.employeeNumber})` : ''} has requested your verification for the following rope access hours:</p>
      
      <div style="background-color: #f4f4f4; padding: 15px; border-radius: 4px; margin: 20px 0;">
        <p><strong>Start Date:</strong> ${startDate}</p>
        <p><strong>End Date:</strong> ${endDate}</p>
        <p><strong>Location:</strong> ${ropeHour.location}</p>
        <p><strong>Skills Used:</strong> ${ropeHour.skills}</p>
        <p><strong>Hours:</strong> ${ropeHour.hours}</p>
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
    supervisor.email,
    `Verification Request for Rope Access Hours from ${user.name || user.email}`,
    html
  );
}

// Send verification confirmation email to user (OJT entries)
export async function sendVerificationConfirmation(
  user: User,
  entry: Entry,
  supervisorName: string
): Promise<boolean> {
  let displayMethod = entry.method;
  if (displayMethod === 'UT_THK') {
    displayMethod = 'UT Thk.';
  }

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>OJT Hours Verified</h2>
      <p>Good news! Your OJT hours have been verified by ${supervisorName}:</p>
      
      <div style="background-color: #f4f4f4; padding: 15px; border-radius: 4px; margin: 20px 0;">
        <p><strong>Date:</strong> ${new Date(entry.date).toLocaleDateString()}</p>
        <p><strong>Location:</strong> ${entry.location}</p>
        <p><strong>Method:</strong> ${displayMethod}</p>
        <p><strong>Hours:</strong> ${entry.hours}</p>
        <p><strong>Verified By:</strong> ${supervisorName}</p>
      </div>
      
      <p>These hours have been added to your verified OJT log. You can view and export your log from your profile page.</p>
    </div>
  `;

  return await sendEmail(
    user.email,
    'OJT Hours Verified',
    html
  );
}
