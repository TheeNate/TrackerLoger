import { z } from "zod";
import { NDTMethods } from "@shared/schema";

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

// Supervisor form validation schema
export const supervisorFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(1, "Phone is required"),
  certificationLevel: z.enum(["Level I", "Level II", "Level III"]),
  company: z.string().min(1, "Company is required"),
});

export type SupervisorFormValues = z.infer<typeof supervisorFormSchema>;

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
