import { EDITION_BRAND, parseEdition } from "@shared/edition";

export const EDITION = parseEdition(process.env.APP_EDITION);
export const ROPE_ONLY = EDITION === "rope";
export const BRAND = EDITION_BRAND[EDITION];
