// One codebase, two products. APP_EDITION=rope builds the rope-access
// logbook (SPRAT / IRATA hours only, no OJT / NDT); anything else is the
// full OJT + rope tracker. The server reads it at runtime, the client at
// build time (vite.config.ts defines __APP_EDITION__ from the same variable).
export type AppEdition = "full" | "rope";

export const parseEdition = (value: string | undefined | null): AppEdition =>
  value?.trim().toLowerCase() === "rope" ? "rope" : "full";

export const EDITION_BRAND: Record<AppEdition, { name: string; shortName: string; description: string }> = {
  full: {
    name: "OJT Hours Tracker",
    shortName: "OJT Tracker",
    description: "Log and verify NDT on-the-job training and rope-access hours from the field, even offline.",
  },
  rope: {
    name: "Rope Access Logbook",
    shortName: "Rope Logbook",
    description: "Log SPRAT and IRATA rope access hours, get them signed by your supervisor, and track progress to your next level.",
  },
};
