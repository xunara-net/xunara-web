import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// The dev server proxies the control plane's protocol and API paths, so the
// console runs against a local xunarad exactly the way it runs behind the
// deployment's reverse proxy: same origin, session cookie included.
const controlPlane = process.env.XUNARA_CONTROL_URL ?? "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      ["/api", "/key", "/ts2021", "/derp", "/health", "/version", "/.well-known"].map(
        (path) => [path, { target: controlPlane, changeOrigin: false }],
      ),
    ),
  },
});
