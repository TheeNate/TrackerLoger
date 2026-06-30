import { z } from "zod";
import {
  NDTMethods,
  supervisorQualificationSchema,
  type Supervisor,
  type SupervisorQualification,
  type Organization,
  type OrganizationMember,
} from "@shared/schema";

// A user's membership in an org, as returned by GET /api/organizations.
export type UserOrgMembership = {
  organization: Organization;
  membership: OrganizationMember;
};

// A member of an org, as returned by GET /api/organizations/:id/members.
export type OrgMemberEntry = {
  membership: OrganizationMember;
  user: { id: number; name: string | null; email: string };
};

// Entry form validation schema
export const entryFormSchema = z.object({
  date: z.date(),
  location: z.string().min(1, "Location is required"),
  method: z.enum([
    NDTMethods.ET, 
    NDTMethods.RFT, 
    NDTMethods.MT, 
    NDTMethods.PT, 
    NDTMethods.RT, 
    NDTMethods.UT_THK,
    NDTMethods.UTSW,
    NDTMethods.PMI,
    NDTMethods.LSI
  ]),
  hours: z.number().min(0.1, "Hours must be greater than 0"),
});

export type EntryFormValues = z.infer<typeof entryFormSchema>;

// Signer / Supervisor form validation schema
export const supervisorFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(1, "Phone number is required"),
  spratNumber: z.string().optional(),
  irataNumber: z.string().optional(),
  company: z.string().optional(),
  // null = personal signer; a number shares it with that organization.
  organizationId: z.number().int().nullable().optional(),
  qualifications: z.array(supervisorQualificationSchema),
});

export type SupervisorFormValues = z.infer<typeof supervisorFormSchema>;

// Build the qualifications list for a saved signer, falling back to the
// legacy single ndtMethod/certificationLevel fields when present.
export function signerToQualifications(signer: Supervisor): SupervisorQualification[] {
  if (Array.isArray(signer.qualifications) && signer.qualifications.length > 0) {
    return signer.qualifications;
  }
  if (signer.ndtMethod && signer.certificationLevel) {
    return [
      {
        method: signer.ndtMethod,
        level: signer.certificationLevel,
      } as SupervisorQualification,
    ];
  }
  return [];
}

// Authentication form validation schemas
export const loginFormSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export type LoginFormValues = z.infer<typeof loginFormSchema>;

export const registerFormSchema = loginFormSchema.extend({
  name: z.string().min(2, "Name must be at least 2 characters"),
  employeeNumber: z.string().optional(),
});

export type RegisterFormValues = z.infer<typeof registerFormSchema>;

// Verification form validation schema
export const verificationFormSchema = z.object({
  verifierName: z.string().min(1, "Name is required"),
});

export type VerificationFormValues = z.infer<typeof verificationFormSchema>;

// Method hours with totals interface
export interface MethodHours {
  ET: number;
  RFT: number;
  MT: number;
  PT: number;
  RT: number;
  UT_THK: number;
  UTSW: number;
  PMI: number;
  LSI: number;
}
