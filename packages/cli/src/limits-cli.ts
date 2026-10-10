// Entry point for the detached limits refresh that `ccclub-statusline` starts
// when its session is ahead of the usage cache (see statusline-refresh.ts).
// One keychain read and one request to Anthropic; no log scan, no upload, and
// nothing sent to ccclub's server — which is the whole reason it is separate
// from `ccclub sync`, and its own bundle so it starts without commander/chalk.
import { LIMITS_MIN_AGE_MS } from "./statusline-refresh.js";
import { recordLimitsOutcome, refreshUsageLimits } from "./usage-limits.js";

// Nobody is waiting on this process, so the request gets longer than a sync
// gives it: on a machine busy enough to need the patience, 8s is not a lot.
const REQUEST_TIMEOUT_MS = 15_000;

try {
  // The cache check doubles as the guard against two sessions starting this
  // in the same instant: the second finds the first one's answer and stops.
  const result = await refreshUsageLimits({ maxAgeMs: LIMITS_MIN_AGE_MS, timeoutMs: REQUEST_TIMEOUT_MS });
  await recordLimitsOutcome(result);
} catch {
  // Both calls swallow their own failures; this process has no one to tell.
}
