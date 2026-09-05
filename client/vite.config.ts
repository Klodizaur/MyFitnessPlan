import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Localhost only by default. The desktop app sets MYFITNESSPLAN_LAN=1 when
    // the tray's "Share on Local Network" is on, which is the only thing that
    // puts the dev server on the network — a plain `npm run dev` is unchanged.
    host: process.env.MYFITNESSPLAN_LAN === "1" ? true : "localhost",
    proxy: {
      // Forward the server's routes to the backend during `npm run dev`, so the
      // client's relative URLs resolve to the API/asset server on port 3000.
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: true },
      "/thumbnails": { target: "http://127.0.0.1:3000", changeOrigin: true },
      "/videos": { target: "http://127.0.0.1:3000", changeOrigin: true },
      "/plan-backgrounds": { target: "http://127.0.0.1:3000", changeOrigin: true },
    },
  },
});
