// 30-minute block window in milliseconds
export const BLOCK_DURATION_MIN = 30;
export const BLOCK_DURATION_MS = BLOCK_DURATION_MIN * 60 * 1000;

// Worker URL (override with CCCLUB_API_URL env var)
export const DEFAULT_API_URL = "https://ccclub.dev";

// Claude projects directory
export const CLAUDE_PROJECTS_DIR = ".claude/projects";
export const CLAUDE_CONFIG_PROJECTS_DIR = ".config/claude/projects";
export const CLAUDE_CONFIG_DIR_ENV = "CLAUDE_CONFIG_DIR";

// Other coding agent data locations
export const CODEX_HOME_ENV = "CODEX_HOME";
export const OPENCODE_DATA_DIR_ENV = "OPENCODE_DATA_DIR";
export const AMP_DATA_DIR_ENV = "AMP_DATA_DIR";
export const PI_AGENT_DIR_ENV = "PI_AGENT_DIR";

export const DEFAULT_CODEX_DIR = ".codex";
export const DEFAULT_OPENCODE_DIR = ".local/share/opencode";
export const DEFAULT_AMP_DIR = ".local/share/amp";
export const DEFAULT_PI_AGENT_SESSIONS_DIR = ".pi/agent/sessions";

// CCClub config directory
export const CCCLUB_CONFIG_DIR = ".ccclub";

// Invite code length
export const INVITE_CODE_LENGTH = 6;

// Subscription plan types and monthly prices (USD)
export type PlanType = "pro" | "max100" | "max200" | "api";

export const PLAN_PRICES: Record<PlanType, number> = {
  pro: 20,
  max100: 100,
  max200: 200,
  api: 0,
};

export const PLAN_LABELS: Record<PlanType, string> = {
  pro: "Pro $20",
  max100: "Max $100",
  max200: "Max $200",
  api: "API",
};

// Pricing per million tokens. These are standard processing rates; cache creation
// is only charged by providers that expose a separate cache-write price.
type ModelPricing = { input: number; output: number; cacheCreation: number; cacheRead: number };

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Claude models. We track API-equivalent value, matching ccusage's calculated mode.
  "claude-opus-4-7": { input: 5, output: 25, cacheCreation: 6.25, cacheRead: 0.5 },
  "claude-opus-4-6": { input: 5, output: 25, cacheCreation: 6.25, cacheRead: 0.5 },
  "claude-opus-4-5": { input: 5, output: 25, cacheCreation: 6.25, cacheRead: 0.5 },
  "claude-opus-4-5-20251101": { input: 5, output: 25, cacheCreation: 6.25, cacheRead: 0.5 },
  "claude-opus-4-1-20250805": { input: 15, output: 75, cacheCreation: 18.75, cacheRead: 1.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.3 },
  "claude-sonnet-4-5": { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.3 },
  "claude-sonnet-4-5-20250929": { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.3 },
  "claude-sonnet-4-20250514": { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.3 },
  "claude-3-5-sonnet-20241022": { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.3 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5, cacheCreation: 1.25, cacheRead: 0.1 },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4, cacheCreation: 1, cacheRead: 0.08 },
  // OpenAI GPT/Codex family.
  "gpt-5.5": { input: 5, output: 30, cacheCreation: 0, cacheRead: 0.5 },
  "gpt-5.4": { input: 2.5, output: 15, cacheCreation: 0, cacheRead: 0.25 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5, cacheCreation: 0, cacheRead: 0.075 },
  "gpt-5.4-nano": { input: 0.2, output: 1.25, cacheCreation: 0, cacheRead: 0.02 },
  "gpt-5.3-codex": { input: 1.75, output: 14, cacheCreation: 0, cacheRead: 0.175 },
  "gpt-5.2-codex": { input: 1.75, output: 14, cacheCreation: 0, cacheRead: 0.175 },
  "gpt-5.1-codex": { input: 1.25, output: 10, cacheCreation: 0, cacheRead: 0.125 },
  "gpt-5.1-codex-max": { input: 1.25, output: 10, cacheCreation: 0, cacheRead: 0.125 },
  "gpt-5.1-codex-mini": { input: 0.25, output: 2, cacheCreation: 0, cacheRead: 0.025 },
  "gpt-5-codex": { input: 1.25, output: 10, cacheCreation: 0, cacheRead: 0.125 },
  "codex-mini-latest": { input: 1.5, output: 6, cacheCreation: 0, cacheRead: 0.375 },
  "codex-auto-review": { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
  "gpt-5": { input: 1.25, output: 10, cacheCreation: 0, cacheRead: 0.125 },
  "gpt-5-mini": { input: 0.25, output: 2, cacheCreation: 0, cacheRead: 0.025 },
  "gpt-5-nano": { input: 0.05, output: 0.4, cacheCreation: 0, cacheRead: 0.005 },
};

// Fallback pricing by model family — used when exact model ID is unknown.
// Keeps cost estimates reasonable for new models without code changes.
const FAMILY_FALLBACK: Record<string, ModelPricing> = {
  opus:   MODEL_PRICING["claude-opus-4-6"],
  sonnet: MODEL_PRICING["claude-sonnet-4-5-20250929"],
  haiku:  MODEL_PRICING["claude-haiku-4-5-20251001"],
  "gpt-5.5": MODEL_PRICING["gpt-5.5"],
  "gpt-5.4-mini": MODEL_PRICING["gpt-5.4-mini"],
  "gpt-5.4-nano": MODEL_PRICING["gpt-5.4-nano"],
  "gpt-5.4": MODEL_PRICING["gpt-5.4"],
  "gpt-5.3-codex": MODEL_PRICING["gpt-5.3-codex"],
  "gpt-5.2-codex": MODEL_PRICING["gpt-5.2-codex"],
  "gpt-5.1-codex-mini": MODEL_PRICING["gpt-5.1-codex-mini"],
  "gpt-5.1-codex-max": MODEL_PRICING["gpt-5.1-codex-max"],
  "gpt-5.1-codex": MODEL_PRICING["gpt-5.1-codex"],
  "gpt-5-codex": MODEL_PRICING["gpt-5-codex"],
  "codex-mini-latest": MODEL_PRICING["codex-mini-latest"],
  "codex-auto-review": MODEL_PRICING["codex-auto-review"],
  "gpt-5-nano": MODEL_PRICING["gpt-5-nano"],
  "gpt-5-mini": MODEL_PRICING["gpt-5-mini"],
  "gpt-5": MODEL_PRICING["gpt-5"],
  gpt: MODEL_PRICING["gpt-5"],
  o3: MODEL_PRICING["gpt-5"],
  o4: MODEL_PRICING["gpt-5"],
  gemini: { input: 1.25, output: 10, cacheCreation: 0, cacheRead: 0.125 },
  deepseek: { input: 0.27, output: 1.1, cacheCreation: 0, cacheRead: 0.07 },
};

function getPricing(model: string): ModelPricing {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  const lower = model.toLowerCase();
  for (const family of Object.keys(FAMILY_FALLBACK)) {
    if (lower.includes(family)) return FAMILY_FALLBACK[family];
  }
  return FAMILY_FALLBACK.sonnet;
}

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number,
  reasoningTokens = 0,
): number {
  const pricing = getPricing(model);
  return (
    (inputTokens * pricing.input +
      (outputTokens + reasoningTokens) * pricing.output +
      cacheCreationTokens * pricing.cacheCreation +
      cacheReadTokens * pricing.cacheRead) /
    1_000_000
  );
}
