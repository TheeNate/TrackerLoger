import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { EDITION_BRAND, parseEdition } from "./shared/edition";

// See shared/edition.ts: APP_EDITION=rope builds the rope-only logbook.
const edition = parseEdition(process.env.APP_EDITION);
const brand = EDITION_BRAND[edition];

export default defineConfig({
  define: {
    __APP_EDITION__: JSON.stringify(edition),
  },
  plugins: [
    react(),
    {
      name: "app-edition-html",
      transformIndexHtml: (html) =>
        html
          .replace(/<title>[^<]*<\/title>/, `<title>${brand.name}</title>`)
          .replace(/(<meta name="description" content=")[^"]*/, `$1${brand.description}`)
          .replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*/, `$1${brand.shortName}`),
    },
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
});
