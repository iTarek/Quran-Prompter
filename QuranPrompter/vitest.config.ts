import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose: that one hashes the 72 MB model and
// refuses to run without it, and a unit test needs neither the model nor the
// service-worker plugin. The site's UI is DOM, so the tests run in happy-dom.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "happy-dom",
  },
});
