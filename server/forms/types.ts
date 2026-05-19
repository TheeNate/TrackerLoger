import type { Entry, RopeHours, Supervisor, User } from "@shared/schema";

export type FormId =
  | "mistras_ojt_v1"
  | "curtiss_wright_wer_v1"
  | "sprat_log_v1"
  | "irata_log_v1";

export type FieldValues = Record<string, string>;

export type AdapterInput = {
  entries: Entry[];
  profile: User;
  headerOverrides?: Record<string, string>;
};

export type Adapter = (input: AdapterInput) => FieldValues;

export type RopeAdapterInput = {
  ropeHours: RopeHours[];
  profile: User;
  supervisors: Supervisor[];
  headerOverrides?: Record<string, string>;
};

export type RopeAdapter = (input: RopeAdapterInput) => FieldValues;

export class FormCapacityError extends Error {
  constructor(
    public readonly max: number,
    public readonly got: number,
    public readonly unit: "rows" | "weeks",
  ) {
    super(`Form capacity exceeded: max ${max} ${unit}, got ${got}`);
    this.name = "FormCapacityError";
    Object.setPrototypeOf(this, FormCapacityError.prototype);
  }
}

export class EmptyExportError extends Error {
  constructor() {
    super("No entries to export");
    this.name = "EmptyExportError";
    Object.setPrototypeOf(this, EmptyExportError.prototype);
  }
}

export class NothingToExportError extends Error {
  constructor() {
    super("All selected entries use methods this form doesn't support");
    this.name = "NothingToExportError";
    Object.setPrototypeOf(this, NothingToExportError.prototype);
  }
}
