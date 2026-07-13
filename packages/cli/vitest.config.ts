import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Tests exercise the live shared source instead of a possibly stale
      // dist build; tsc still resolves the same specifier to dist types.
      "@ccclub/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)),
    },
  },
});
