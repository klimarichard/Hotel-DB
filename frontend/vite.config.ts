import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { readFileSync } from "fs";

// Bake the package version into the bundle so the app can show "vX.Y.Z" without
// a runtime call. Read from disk (not a JSON import) to avoid module-assert quirks.
const pkgVersion = JSON.parse(
  readFileSync(resolve(__dirname, "package.json"), "utf-8")
).version as string;

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    port: 3000,
    proxy: {
      // Proxy API calls to local Firebase emulator during development
      "/api": {
        target: "http://127.0.0.1:5002/hotel-hr-app-75581/europe-west3/api",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
