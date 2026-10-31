import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ["react", "react-dom", "react-router"] },
  server: { fs: { allow: [".."] }, host: "127.0.0.1", port: 19442, strictPort: true, proxy: Object.fromEntries(["/auth", "/v1", "/mcp", "/healthz", "/openapi.json"].map(path => [path, { target: "http://127.0.0.1:19444", changeOrigin: false, configure(proxy) { proxy.on("proxyReq", (outgoing, request) => { if (request.headers.origin === `http://${request.headers.host}`) outgoing.setHeader("Origin", "http://127.0.0.1:19442"); }); } }])) },
  test: { projects: [
    { extends: true, test: { name: "node", environment: "node", include: ["tests/**/*.test.ts"] } },
    { extends: true, test: { name: "dom", environment: "jsdom", include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.tsx"] } },
  ] },
});
