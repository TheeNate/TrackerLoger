import { Entry, User, Supervisor } from '@shared/schema';
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
const DEFAULT_FROM_EMAIL = 'noreply@trackerloger.online';

// Get base URL for links
export const getBaseUrl = () => {
  const domain = process.env.REPLIT_DOMAINS ? 
    process.env.REPLIT_DOMAINS.split(',')[0] : 
    'localhost:5000';
  
  // Always use HTTPS for verification links
  return `https://${domain}`;
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
      text: html.replace(/<[^>]*>/g, '') // Simple HTML to text conversion
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

// Send verification request email
export async function sendVerificationRequest(
  supervisor: Supervisor, 
  user: User,
  entry: Entry
): Promise<boolean> {
  // Ensure we always use HTTPS for verification links
  const domain = process.env.REPLIT_DOMAINS ? 
    process.env.REPLIT_DOMAINS.split(',')[0] : 
    'localhost:5000';
  
  // Always force HTTPS for verification links
  const verificationUrl = `https://${domain}/verify/${entry.verificationToken}`;
  
  // Display verification URL in logs for testing/debugging
  console.log("\n-------------------------------------------------");
  console.log("VERIFICATION LINK (For testing):");
  console.log(verificationUrl);
  console.log("-------------------------------------------------\n");
  
  // Format method for display
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
  
  const emailSent = await sendEmail(
    supervisor.email,
    `Verification Request for OJT Hours from ${user.name || user.email}`,
    html
  );
  
  return emailSent;
}

// Send verification confirmation email to user
export async function sendVerificationConfirmation(
  user: User,
  entry: Entry,
  supervisorName: string
): Promise<boolean> {
  // Format method for display
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