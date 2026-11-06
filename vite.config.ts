import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { allowedHosts: true, proxy: { "/api": "http://127.0.0.1:5001" } },
  build: {
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: { manualChunks: { analysis: ["@babel/parser", "json5"] } },
    },
  },
});
