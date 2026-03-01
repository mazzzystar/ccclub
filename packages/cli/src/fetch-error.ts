import chalk from "chalk";

/**
 * Extract a user-friendly message from a fetch error.
 * Node.js native fetch wraps SSL/network errors as TypeError("fetch failed")
 * with the real error in .cause — this unwraps it and adds troubleshooting hints.
 */
export function formatFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);

  // Walk the cause chain to find the root error
  const causes: string[] = [err.message];
  let current: unknown = (err as { cause?: unknown }).cause;
  while (current instanceof Error) {
    causes.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }

  const detail = causes.join(": ");
  const lower = detail.toLowerCase();

  // Detect SSL/TLS errors
  const isSSL =
    lower.includes("ssl") ||
    lower.includes("tls") ||
    lower.includes("cert") ||
    lower.includes("packet length too long") ||
    lower.includes("protocol version") ||
    lower.includes("err_ssl") ||
    lower.includes("unable to verify") ||
    lower.includes("self.signed") ||
    lower.includes("certificate");

  if (isSSL) {
    const rootCause = causes.length > 1 ? causes[causes.length - 1] : detail;
    return [
      rootCause,
      "",
      chalk.dim("  This looks like a TLS/SSL issue. Try:"),
      chalk.dim("  1. Update Node.js to the latest LTS (v20.x+ or v22.x)"),
      chalk.dim("  2. Check if a corporate proxy/firewall is intercepting HTTPS"),
      chalk.dim("  3. Run with NODE_DEBUG=fetch for more details"),
    ].join("\n");
  }

  // For other fetch errors, show the root cause instead of just "fetch failed"
  return causes.length > 1 ? causes[causes.length - 1] : detail;
}
