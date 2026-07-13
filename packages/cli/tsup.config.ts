import { defineConfig } from "tsup";
import pkg from "./package.json";

export default defineConfig({
  // statusline-cli is a separate light binary: Claude Code runs it on every
  // turn, so it must start without loading commander/chalk/ora.
  entry: ["src/index.ts", "src/statusline-cli.ts"],
  format: ["esm"],
  target: "node20",
  dts: true,
  clean: true,
  splitting: false,
  // Bundle @ccclub/shared INTO the output (it's a workspace dep, not on npm)
  noExternal: ["@ccclub/shared"],
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
  banner: {
    js: "#!/usr/bin/env node",
  },
});
