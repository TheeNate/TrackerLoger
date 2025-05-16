import { Entry, User, Supervisor } from '@shared/schema';
import sgMail from '@sendgrid/mail';

// Configure SendGrid
if (!process.env.SENDGRID_API_KEY) {
  console.warn('SENDGRID_API_KEY not found, emails will not be sent');
} else {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  console.log('SendGrid API key configured');
}

// Default sender email
const DEFAULT_FROM_EMAIL = 'noreply@ojtlogger.app';

// Get base URL for links
export const getBaseUrl = () => {
  const domain = process.env.REPLIT_DOMAINS ? 
    process.env.REPLIT_DOMAINS.split(',')[0] : 
    'localhost:5000';
  
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
  return `${protocol}://${domain}`;
};

// Send magic link email
export const sendMagicLink = async (
  email: string, 
  token: string
): Promise<string> => {
  const baseUrl = getBaseUrl();
  const loginUrl = `${baseUrl}/login?token=${token}`;
  
  if (!process.env.SENDGRID_API_KEY) {
    console.log('Magic link URL (for dev testing):', loginUrl);
    return loginUrl;
  }
  
  const msg = {
    from: process.env.EMAIL_FROM || DEFAULT_FROM_EMAIL,
    to: email,
    subject: 'Login to OJT Hours Tracker',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Login to OJT Hours Tracker</h2>
        <p>Click the link below to log in to your account:</p>
        <p>
          <a 
            href="${loginUrl}" 
            style="display: inline-block; padding: 10px 20px; background-color: #0062ff; color: white; text-decoration: none; border-radius: 4px;"
          >
            Login to your account
          </a>
        </p>
        <p>Or copy and paste this URL into your browser:</p>
        <p>${loginUrl}</p>
        <p>This link will expire in 15 minutes.</p>
      </div>
    `,
  };
  
  try {
    await sgMail.send(msg);
    return loginUrl;
  } catch (error: any) {
    console.error('Error sending magic link email:', error);
    if (error.response) {
      console.error(error.response.body);
    }
    // Print URL for development fallback
    console.log('Magic link URL (fallback):', loginUrl);
    return loginUrl;
  }
};

// Send verification request email
export const sendVerificationRequest = async (
  supervisor: Supervisor,
  user: User,
  entry: Entry
): Promise<string> => {
  const baseUrl = getBaseUrl();
  const verifyUrl = `${baseUrl}/verify/${entry.verificationToken}`;
  
  // Format the method for display
  let displayMethod = entry.method;
  if (displayMethod === 'UT_THK') {
    displayMethod = 'UT Thk.';
  }
  
  if (!process.env.SENDGRID_API_KEY) {
    console.log('Verification URL (for dev testing):', verifyUrl);
    return verifyUrl;
  }
  
  const msg = {
    from: process.env.EMAIL_FROM || DEFAULT_FROM_EMAIL,
    to: supervisor.email,
    subject: `Verification Request for OJT Hours from ${user.name}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>OJT Hours Verification Request</h2>
        <p>${user.name} (Employee #: ${user.employeeNumber}) has requested your verification for the following OJT hours:</p>
        
        <div style="background-color: #f4f4f4; padding: 15px; border-radius: 4px; margin: 20px 0;">
          <p><strong>Date:</strong> ${new Date(entry.date).toLocaleDateString()}</p>
          <p><strong>Location:</strong> ${entry.location}</p>
          <p><strong>Method:</strong> ${displayMethod}</p>
          <p><strong>Hours:</strong> ${entry.hours}</p>
        </div>
        
        <p>Please click the button below to verify these hours:</p>
        <p>
          <a 
            href="${verifyUrl}" 
            style="display: inline-block; padding: 10px 20px; background-color: #42be65; color: white; text-decoration: none; border-radius: 4px;"
          >
            Verify Hours
          </a>
        </p>
        <p>Or copy and paste this URL into your browser:</p>
        <p>${verifyUrl}</p>
      </div>
    `,
  };
  
  try {
    await sgMail.send(msg);
    return verifyUrl;
  } catch (error: any) {
    console.error('Error sending verification request email:', error);
    if (error.response) {
      console.error(error.response.body);
    }
    // Print URL for development fallback
    console.log('Verification URL (fallback):', verifyUrl);
    return verifyUrl;
  }
};

// Notify user that their hours were verified
export const sendVerificationConfirmation = async (
  user: User,
  entry: Entry,
  supervisorName: string
): Promise<void> => {
  // Format the method for display
  let displayMethod = entry.method;
  if (displayMethod === 'UT_THK') {
    displayMethod = 'UT Thk.';
  }
  
  if (!process.env.SENDGRID_API_KEY) {
    console.log('Hours verified for user:', user.email);
    return;
  }
  
  const msg = {
    from: process.env.EMAIL_FROM || DEFAULT_FROM_EMAIL,
    to: user.email,
    subject: 'OJT Hours Verified',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Your OJT Hours Have Been Verified</h2>
        <p>Great news! ${supervisorName} has verified your OJT hours.</p>
        
        <div style="background-color: #f4f4f4; padding: 15px; border-radius: 4px; margin: 20px 0;">
          <p><strong>Date:</strong> ${new Date(entry.date).toLocaleDateString()}</p>
          <p><strong>Location:</strong> ${entry.location}</p>
          <p><strong>Method:</strong> ${displayMethod}</p>
          <p><strong>Hours:</strong> ${entry.hours}</p>
        </div>
        
        <p>These hours have been added to your verified OJT log.</p>
      </div>
    `,
  };
  
  try {
    await sgMail.send(msg);
  } catch (error: any) {
    console.error('Error sending verification confirmation email:', error);
    if (error.response) {
      console.error(error.response.body);
    }
  }
};
