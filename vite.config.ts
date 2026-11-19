import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The client lives in /client. In dev, Vite proxies socket + API traffic to the
// Node game server on :3000 so you get hot reload and multiplayer at once.
export default defineConfig({
  root: "client",
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/socket.io": { target: "http://localhost:3000", ws: true },
      "/api": "http://localhost:3000",
    },
  },
  build: { outDir: "../dist", emptyOutDir: true },
  test: { root: ".", include: ["shared/**/*.test.ts", "server/**/*.test.ts"] },
} as any);
