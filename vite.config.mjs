import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig(({ mode }) => ({
  root: fileURLToPath(new URL("./frontend/", import.meta.url)),
  publicDir: false,
  plugins: [react()],
  define: { __PREVIEW__: JSON.stringify(mode === "preview") },
  build: {
    outDir: fileURLToPath(new URL("./dist/", import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
  },
  test: {
    root: projectRoot,
    environment: "jsdom",
    globals: true,
    include: ["tests/react/**/*.{test,spec}.{js,jsx,mjs}"],
    setupFiles: ["tests/react-setup.mjs"],
    clearMocks: true,
    restoreMocks: true,
  },
}));
