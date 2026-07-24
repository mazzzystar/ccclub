declare const __VERSION__: string;

export function getCurrentVersion(): string {
  if (typeof __VERSION__ !== "undefined") return __VERSION__;
  return process.env.npm_package_version ?? "0.0.0-dev";
}
