import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { pool } from "./db";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE entries
        ADD COLUMN IF NOT EXISTS technician_signature TEXT,
        ADD COLUMN IF NOT EXISTS supervisor_signature TEXT,
        ADD COLUMN IF NOT EXISTS data_hash TEXT,
        ADD COLUMN IF NOT EXISTS integrity_signature TEXT,
        ADD COLUMN IF NOT EXISTS verification_requested_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS audit_trail JSON,
        ADD COLUMN IF NOT EXISTS supervisor_ip_address TEXT,
        ADD COLUMN IF NOT EXISTS supervisor_browser_info TEXT,
        ADD COLUMN IF NOT EXISTS employee_id_used TEXT;
    `);
    await client.query(`
      ALTER TABLE rope_hours
        ADD COLUMN IF NOT EXISTS technician_signature TEXT,
        ADD COLUMN IF NOT EXISTS supervisor_signature TEXT,
        ADD COLUMN IF NOT EXISTS data_hash TEXT,
        ADD COLUMN IF NOT EXISTS integrity_signature TEXT,
        ADD COLUMN IF NOT EXISTS verification_requested_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS audit_trail JSON,
        ADD COLUMN IF NOT EXISTS supervisor_ip_address TEXT,
        ADD COLUMN IF NOT EXISTS supervisor_browser_info TEXT,
        ADD COLUMN IF NOT EXISTS employee_id_used TEXT;
    `);
    await client.query(`
      ALTER TABLE supervisors
        ADD COLUMN IF NOT EXISTS sprat_number TEXT,
        ADD COLUMN IF NOT EXISTS irata_number TEXT,
        ADD COLUMN IF NOT EXISTS ndt_method TEXT,
        ALTER COLUMN certification_level DROP NOT NULL,
        ALTER COLUMN company DROP NOT NULL;
    `);
    log("Database migrations applied successfully");
  } catch (err) {
    log(`Migration error: ${err}`);
    throw err;
  } finally {
    client.release();
  }
}

(async () => {
  await runMigrations();
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on port 5000
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = 5000;
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
