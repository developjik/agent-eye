import { defineConfig } from "vitest/config";

export default defineConfig({
  // Some sandboxes have no /etc/hosts, so "localhost" does not resolve.
  // The fixture server and the tests both use a literal loopback address.
  server: { host: "127.0.0.1" },
  test: {
    api: { host: "127.0.0.1" },
    include: ["test/**/*.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // Every e2e file drives a real Chromium; run files one at a time.
    fileParallelism: false,
  },
});
