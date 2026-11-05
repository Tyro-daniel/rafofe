import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev-time proxy means the frontend can call same-origin "/api/..." paths
// instead of hardcoding http://localhost:4000 everywhere — this is what
// lets the exact same src/api/client.js code work unmodified in production
// behind Nginx (see nginx.conf, which proxies /api/ the same way).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET || "http://localhost:4000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  build: {
    // Splits vendor code from app code so browsers can cache React/Router
    // separately from app logic that changes on every deploy — meaningful
    // load-time win once this grows past the MVP page set.
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
        },
      },
    },
  },
});
