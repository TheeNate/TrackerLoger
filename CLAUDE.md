# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

OJT Hours Tracker: a full-stack TypeScript web app for logging On-the-Job Training hours (NDT / rope access), getting them verified by supervisors over email, and exporting them as filled vendor PDF forms. Built to run on Replit.

## Commands

```bash
npm run dev        # dev server (tsx, NODE_ENV=development) — serves API + client on port 5000
npm run build      # vite build client + esbuild bundle server → dist/, copies form blanks/schemas
npm run start      # run production build (dist/index.js)
npm run check      # tsc type-check (noEmit)
npm run db:push    # drizzle-kit push — sync shared/schema.ts to the database

npx vitest run                              # run all tests
npx vitest run tests/forms/sprat_log_v1.test.ts   # single test file
npx vitest run -t "substring of test name"  # single test by name
```

Tests live in `tests/` (not co-located); `tsconfig.json` excludes `**/*.test.ts` from the type-check.

## Architecture

Three TypeScript roots, unified by path aliases (`@/` → `client/src`, `@shared` → `shared`, `@assets` → `attached_assets`):

- **`client/`** — React 18 + Vite SPA. Wouter routing (`client/src/App.tsx`), TanStack Query for server state, React Hook Form + Zod, shadcn/ui (Radix) in `client/src/components/ui`. Pages in `client/src/pages`.
- **`server/`** — Express. `index.ts` boots everything; `routes.ts` (~1800 lines) registers all `/api/*` routes and the session/auth middleware.
- **`shared/schema.ts`** — single source of truth: Drizzle table definitions, `drizzle-zod` insert schemas, exported row/insert types, and the `NDTMethods` enum. Both client and server import from here.

**Single port.** Everything serves on port 5000. In dev, Vite runs as Express middleware (`server/vite.ts`); in prod, Express serves the static build. The catch-all Vite/static route is registered last so it doesn't shadow API routes.

**Database.** Neon serverless Postgres over WebSockets (`server/db.ts`) + Drizzle ORM. Note there are **two** ways schema reaches the DB and you usually need both: `npm run db:push` for local dev, AND an idempotent `runMigrations()` (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) that runs on every server boot in `server/index.ts`. There is no runtime migrations folder — when you add a column to `shared/schema.ts`, also add it to `runMigrations()` so production picks it up.

**Auth.** Session-based: `express-session` + `connect-pg-simple` (Postgres `session` table), bcrypt password hashing. `requireAuth` and `requireAdmin` middleware gate routes; `req.session.userId` identifies the user.

## Domain model & core flows

Two parallel record types, each owned by a user and following the same lifecycle:
- **`entries`** — OJT/NDT hours (date, location, `method`, hours). Methods are the `NDTMethods` enum (ET, RFT, MT, PT, RT, UT_THK, UTSW, PMI, LSI, plus vendor-form additions like PAUT, VT_1..3, VWE, UT).
- **`ropeHours`** — rope-access work (start/end date, location, skills, hours).

Both tables carry the same three feature dimensions:
1. **Verification** — supervisor confirms hours via an emailed unique-token link. Single (`/api/verify-request/:entryId`) and batch (`/api/batch-verify-request`) flows. Email via Resend / nodemailer (`server/email.ts`, `server/mailsender.ts`); falls back to surfacing direct links when email isn't configured.
2. **Cryptographic integrity** (`server/crypto.ts`) — per-identity RSA keypairs (private key encrypted at rest with the server secret), data hashing, integrity signatures, and an audit trail stored on each record. Identities live in `userCryptoIdentities` / `supervisorCryptoIdentities`.
3. **Import provenance** — `sourceDocumentKey` / `sourceDocumentName` / `importedAt` link a record back to the uploaded log it was extracted from.

### PDF form export (`server/forms/`)

Exports verified hours into fillable vendor PDFs. The **registry** (`registry.ts`) maps each `FormId` to a blank AcroForm PDF, a JSON schema, and an **adapter**. An adapter (`adapters/*.ts`) is a pure function turning selected entries/ropeHours + user profile into `{ fieldName: value }`; `filler.ts` writes those into the blank with pdf-lib (sets `NeedAppearances`, keeps fields editable). Forms are either `kind: "ojt"` (consume `entries`) or `kind: "rope"` (consume `ropeHours` + supervisors). Entry point: `POST /api/export-form`. Adapters throw typed errors (`FormCapacityError`, `EmptyExportError`, `NothingToExportError`) that the route maps to 422 codes. To add a form: drop the blank in `forms/blanks/`, a schema in `forms/schemas/`, write an adapter, and register it. The build copies `blanks/` and `schemas/` into `dist/forms/`; `forms/paths.ts` resolves these dirs differently in dev vs prod.

### Log import (`server/extraction.ts`)

Two-step upload→review→commit. `POST /api/imports/extract` saves the file to object storage and returns extracted rows for the user to review; `POST /api/imports/commit` re-validates each row with Zod and bulk-inserts with source provenance. Extraction tries a **deterministic path first** for Sprat logbook exports (`.xlsx` via `xlsx`, and Sprat PDFs parsed by text layout — no AI, fully reproducible), and only falls back to **AI extraction** (OpenAI via Replit integration) for images and non-Sprat PDFs. Keep Sprat imports on the deterministic path.

### Replit integrations (`server/replit_integrations/`)

Object storage (used for uploaded import documents under `imports/<userId>/<uuid>`), plus image/chat/audio/batch helpers. Object storage backs `sourceDocumentKey` and the short-lived signed-URL endpoint `/api/source-document`.

### Offline / PWA (`client/src/lib/offline/`)

TanStack Query state is persisted to IndexedDB and a service worker is registered (`vite-plugin-pwa`). Mutations made offline are queued in an outbox and replayed on reconnect (`resumePausedMutations`). Bump the persist `buster` in `App.tsx` if cached query shapes change incompatibly.

## Environment variables

- `DATABASE_URL` — **required** (Neon Postgres connection string).
- `SESSION_SECRET` / `CRYPTO_SECRET` — session encryption and crypto-key wrapping (crypto ops throw without one).
- `RESEND_API_KEY` — transactional email; without it, verification falls back to direct links.
- `AI_INTEGRATIONS_OPENAI_API_KEY` + `AI_INTEGRATIONS_OPENAI_BASE_URL` — AI extraction fallback (Replit-provided).

## Conventions

- ES modules throughout (`"type": "module"`); `.ts` extensions allowed in imports (bundler resolution).
- Validate API input with Zod at the route boundary; for imports, validate the whole batch before any DB write so a bad row aborts the import.
- `replit.md` holds an older product/architecture writeup and changelog; useful background but `shared/schema.ts` and the routes are authoritative.
