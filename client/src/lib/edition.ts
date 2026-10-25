import { EDITION_BRAND, parseEdition } from "@shared/edition";

declare const __APP_EDITION__: string;

export const EDITION = parseEdition(typeof __APP_EDITION__ === "string" ? __APP_EDITION__ : undefined);
/** The rope-access logbook: no OJT / NDT pages, rope hours are home. */
export const ROPE_ONLY = EDITION === "rope";
export const BRAND = EDITION_BRAND[EDITION];
/** Where a signed-in technician lands. */
export const HOME_PATH = ROPE_ONLY ? "/rope-hours" : "/profile";
