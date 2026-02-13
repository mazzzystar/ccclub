import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  splitting: false,
  // Bundle @ccclub/shared INTO the output (it's a workspace dep, not on npm)
  noExternal: ["@ccclub/shared"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
