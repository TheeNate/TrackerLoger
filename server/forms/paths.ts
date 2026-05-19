import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// In dev (tsx), this file lives at server/forms/paths.ts.
// In prod, esbuild bundles server/index.ts to dist/index.js — the bundled file
// loses its individual location. We copy server/forms/{blanks,schemas} into
// dist/forms/ at build time (see package.json build script) and resolve
// relative to dist/.
const isProd = process.env.NODE_ENV === "production";

const FORMS_ROOT = isProd
  ? path.resolve(__dirname, "..", "forms") // dist/index.js → dist/forms/
  : __dirname;                              // server/forms/paths.ts → server/forms/

export const BLANKS_DIR = path.join(FORMS_ROOT, "blanks");
export const SCHEMAS_DIR = path.join(FORMS_ROOT, "schemas");
