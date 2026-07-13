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
