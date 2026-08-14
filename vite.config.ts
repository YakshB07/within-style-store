// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import fs from "fs";
import { resolve } from "path";

// Try to load local dev TLS certs from ./certs (mkcert output).
const certDir = resolve(process.cwd(), "certs");
let devHttps: boolean | { key: Buffer; cert: Buffer } = false;
try {
  const keyPath = resolve(certDir, "localhost-key.pem");
  const certPath = resolve(certDir, "localhost.pem");
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    devHttps = { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  }
} catch (e) {
  devHttps = false;
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Serve on localhost (trustworthy origin) to avoid needing HTTPS in dev.
  vite: {
    server: {
      // Bind to the IPv4 loopback to avoid IPv6-only binding issues
      host: "127.0.0.1",
      port: 8081,
      // Allow Vite to fall back to another available port if 8081 is taken.
      strictPort: false,
      https: devHttps
    }
  }
});
