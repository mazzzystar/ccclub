// 5-hour block window in milliseconds
export const BLOCK_DURATION_HOURS = 5;
export const BLOCK_DURATION_MS = BLOCK_DURATION_HOURS * 60 * 60 * 1000;

// Worker URL (override with CCCLUB_API_URL env var)
export const DEFAULT_API_URL = "https://ccclub.dev";

// Claude projects directory
export const CLAUDE_PROJECTS_DIR = ".claude/projects";

// CCClub config directory
export const CCCLUB_CONFIG_DIR = ".ccclub";

// Invite code length
export const INVITE_CODE_LENGTH = 6;

// Pricing per million tokens (source: LiteLLM / Anthropic pricing)
export const MODEL_PRICING: Record<string, { input: number; output: number; cacheCreation: number; cacheRead: number }> = {
  // Opus 4.5+ (reduced pricing)
  "claude-opus-4-6": { input: 5, output: 25, cacheCreation: 6.25, cacheRead: 0.5 },
  "claude-opus-4-5-20251101": { input: 5, output: 25, cacheCreation: 6.25, cacheRead: 0.5 },
  // Opus 4.1 (original pricing)
  "claude-opus-4-1-20250805": { input: 15, output: 75, cacheCreation: 18.75, cacheRead: 1.5 },
  // Sonnet
  "claude-sonnet-4-5-20250929": { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.3 },
  "claude-sonnet-4-20250514": { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.3 },
  "claude-3-5-sonnet-20241022": { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.3 },
  // Haiku
  "claude-haiku-4-5-20251001": { input: 1, output: 5, cacheCreation: 1.25, cacheRead: 0.1 },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4, cacheCreation: 1, cacheRead: 0.08 },
};

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number,
): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING["claude-sonnet-4-5-20250929"];
  return (
    (inputTokens * pricing.input +
      outputTokens * pricing.output +
      cacheCreationTokens * pricing.cacheCreation +
      cacheReadTokens * pricing.cacheRead) /
    1_000_000
  );
}
