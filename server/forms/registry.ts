import path from "path";
import { mistrasAdapter } from "./adapters/mistras_ojt_v1";
import { cwAdapter } from "./adapters/curtiss_wright_wer_v1";
import { BLANKS_DIR, SCHEMAS_DIR } from "./paths";
import type { Adapter, FormId } from "./types";

export type RegistryEntry = {
  blankPath: string;
  schemaPath: string;
  adapter: Adapter;
};

export const registry: Record<FormId, RegistryEntry> = {
  mistras_ojt_v1: {
    blankPath: path.join(BLANKS_DIR, "MISTRAS_OJT_Fillable.pdf"),
    schemaPath: path.join(SCHEMAS_DIR, "mistras_ojt_v1.schema.json"),
    adapter: mistrasAdapter,
  },
  curtiss_wright_wer_v1: {
    blankPath: path.join(BLANKS_DIR, "CurtissWright_WorkExperience_Fillable.pdf"),
    schemaPath: path.join(SCHEMAS_DIR, "curtiss_wright_wer_v1.schema.json"),
    adapter: cwAdapter,
  },
};

export function isFormId(value: unknown): value is FormId {
  return value === "mistras_ojt_v1" || value === "curtiss_wright_wer_v1";
}
