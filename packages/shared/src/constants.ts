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

// Pricing per million tokens (source: Anthropic pricing page)
type ModelPricing = { input: number; output: number; cacheCreation: number; cacheRead: number };

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Opus 4.5+
  "claude-opus-4-6": { input: 5, output: 25, cacheCreation: 6.25, cacheRead: 0.5 },
  "claude-opus-4-5-20251101": { input: 5, output: 25, cacheCreation: 6.25, cacheRead: 0.5 },
  // Opus 4.0–4.1
  "claude-opus-4-1-20250805": { input: 15, output: 75, cacheCreation: 18.75, cacheRead: 1.5 },
  // Sonnet
  "claude-sonnet-4-5-20250929": { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.3 },
  "claude-sonnet-4-20250514": { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.3 },
  "claude-3-5-sonnet-20241022": { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.3 },
  // Haiku
  "claude-haiku-4-5-20251001": { input: 1, output: 5, cacheCreation: 1.25, cacheRead: 0.1 },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4, cacheCreation: 1, cacheRead: 0.08 },
  // OpenAI GPT family fallbacks. Many agent logs provide exact costs; these are best-effort
  // estimates for sources that only expose tokens.
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
