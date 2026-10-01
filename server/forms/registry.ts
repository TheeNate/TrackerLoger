import path from "path";
import type { Entry } from "@shared/schema";
import { lendtAdapter, lendtColumnsFor } from "./adapters/lendt_ojt_v1";
import { buildLendtBlank } from "./lendt_blank";
import { cwAdapter } from "./adapters/curtiss_wright_wer_v1";
import { spratAdapter } from "./adapters/sprat_log_v1";
import { irataAdapter } from "./adapters/irata_log_v1";
import { BLANKS_DIR, SCHEMAS_DIR } from "./paths";
import type { Adapter, FormId, RopeAdapter } from "./types";

// An OJT form's blank is either a fixed AcroForm on disk (blankPath) or drawn
// per export from the selected entries (buildBlank) when its layout depends
// on them.
export type RegistryEntry =
  | { kind: "ojt";  blankPath: string; schemaPath: string; adapter: Adapter }
  | { kind: "ojt";  buildBlank: (entries: Entry[]) => Promise<Uint8Array>; schemaPath: string; adapter: Adapter }
  | { kind: "rope"; blankPath: string; schemaPath: string; adapter: RopeAdapter };

export const registry: Record<FormId, RegistryEntry> = {
  lendt_ojt_v1: {
    kind: "ojt",
    buildBlank: (entries) => buildLendtBlank(lendtColumnsFor(entries)),
    schemaPath: path.join(SCHEMAS_DIR, "lendt_ojt_v1.schema.json"),
    adapter: lendtAdapter,
  },
  curtiss_wright_wer_v1: {
    kind: "ojt",
    blankPath: path.join(BLANKS_DIR, "CurtissWright_WorkExperience_Fillable.pdf"),
    schemaPath: path.join(SCHEMAS_DIR, "curtiss_wright_wer_v1.schema.json"),
    adapter: cwAdapter,
  },
  sprat_log_v1: {
    kind: "rope",
    blankPath: path.join(BLANKS_DIR, "SPRAT_RopeAccessLog_Fillable.pdf"),
    schemaPath: path.join(SCHEMAS_DIR, "sprat_log_v1.schema.json"),
    adapter: spratAdapter,
  },
  irata_log_v1: {
    kind: "rope",
    blankPath: path.join(BLANKS_DIR, "IRATA_WorkExperience_Fillable.pdf"),
    schemaPath: path.join(SCHEMAS_DIR, "irata_log_v1.schema.json"),
    adapter: irataAdapter,
  },
};

export function isFormId(value: unknown): value is FormId {
  return (
    value === "lendt_ojt_v1" ||
    value === "curtiss_wright_wer_v1" ||
    value === "sprat_log_v1" ||
    value === "irata_log_v1"
  );
}
