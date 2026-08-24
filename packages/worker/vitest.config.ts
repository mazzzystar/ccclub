import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      // The OG renderer imports wasm and font binaries that only wrangler can
      // bundle. Tests stub them so page modules stay importable under node.
      {
        find: /^.*\.(wasm|ttf)$/,
        replacement: fileURLToPath(new URL("./src/binary-asset-stub.ts", import.meta.url)),
      },
    ],
  },
});
