import { fileURLToPath } from "node:url";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const studioRoot = fileURLToPath(new URL(".", import.meta.url));
const frontendRoot = fileURLToPath(new URL("./src/", import.meta.url));
const builtAssetDir = path.resolve(studioRoot, "..", "..", "dist-node", "apps", "studio-web", "frontend");

export default defineConfig({
  root: frontendRoot,
  plugins: [react()],
  build: {
    outDir: builtAssetDir,
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@mantine/")) {
            return "mantine";
          }
          if (id.includes("node_modules/")) {
            return "vendor";
          }
          return undefined;
        },
      },
    },
  },
  resolve: {
    alias: {
      "@studio": frontendRoot,
    },
  },
  server: {
    fs: {
      allow: [studioRoot],
    },
  },
});
