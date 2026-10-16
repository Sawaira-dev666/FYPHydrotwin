import { defineConfig } from "vite";

// The backend only allows CORS from http://localhost:3000 and
// http://127.0.0.1:3000, so the frontend MUST run on port 3000.
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
  },
});
