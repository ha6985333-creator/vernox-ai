import { defineConfig } from "vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import type { Connect } from "vite";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

const htmlRewrite: () => import("vite").Plugin = () => ({
  name: "html-rewrite",
  configureServer(server) {
    server.middlewares.use((req, _res, next: Connect.NextFunction) => {
      const url = req.url?.split("?")[0] ?? "";
      if (url === "/login") req.url = "/login.html";
      else if (url === "/demo") req.url = "/demo.html";
      else if (url === "/admin" || url === "/admin/") req.url = "/admin/index.html";
      else if (url === "/portal" || url === "/portal/") req.url = "/portal/index.html";
      next();
    });
  },
});

export default defineConfig({
  base: basePath,
  plugins: [
    htmlRewrite(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, "index.html"),
        login: path.resolve(import.meta.dirname, "login.html"),
        demo: path.resolve(import.meta.dirname, "demo.html"),
        admin: path.resolve(import.meta.dirname, "admin/index.html"),
        portal: path.resolve(import.meta.dirname, "portal/index.html"),
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
