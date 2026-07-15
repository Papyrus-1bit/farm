import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import sirv from "sirv";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "vite-html-entry",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const url = req.url?.split("?")[0] || "";
          if (url === "/sim" || url === "/sim/") {
            req.url = "/index.sim.html";
          } else if (url === "/" || url === "/index.html") {
            req.url = "/index.vite.html";
          }
          next();
        });
      },
    },
    {
      name: "serve-root-assets",
      configureServer(server) {
        const rootStatic = sirv(".", {
          dev: true,
          etag: true,
          ignores: ["node_modules", ".git", "src", "dist"],
        });
        server.middlewares.use((req, res, next) => {
          const url = req.url || "";
          if (/^\/(data|scenarios|vendor|assets|citygen|sprites|scenario-gen|drive|roadmind|app)\.js/.test(url) ||
              /^\/(data|scenarios|vendor|assets)\//.test(url)) {
            return rootStatic(req, res, next);
          }
          next();
        });
      },
    },
  ],
  base: "./",
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  build: {
    outDir: "dist",
    copyPublicDir: false,
    rollupOptions: {
      input: resolve(__dirname, "index.vite.html"),
    },
  },
});
