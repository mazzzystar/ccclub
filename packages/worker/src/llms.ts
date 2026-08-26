import { Hono } from "hono";
import type { Env } from "./types.js";

// Agent-facing discovery document (llms.txt convention): what ccclub is,
// how to install the CLI, and which HTTP endpoints are public. Keep this in
// sync with the CLI's --json output and the routes in routes/.
const LLMS_TXT = `# ccclub

> Claude Code and Codex leaderboard among friends. The ccclub CLI reads local
> coding-agent usage logs (Claude Code, Codex, OpenCode, Amp, Grok, Pi),
> aggregates them into anonymous 30-minute token/cost summaries, and uploads
> only those counters to group leaderboards. No prompts, no code, no file
> paths ever leave the machine. Cursor is supported too, but opt-in: it keeps
> no local usage logs, so \`ccclub sources enable cursor\` is required before
> ccclub reads the Cursor token from the macOS Keychain and fetches usage
> from Cursor's dashboard API (the token itself is never uploaded).
> Non-coding assistant usage is excluded from rankings server-side.

## CLI

- Install and create a group: \`npx ccclub init\`
- Join a friend's group: \`npx ccclub join <CODE>\`
- Leaderboard (human): \`ccclub\` — time windows via \`-d 1|7|30|all\`
- Leaderboard (machine-readable): \`ccclub --json\` — raw JSON on stdout,
  suitable for jq, scripts, and agents. Shape: { period, groups: [RankResponse] }
- Claude Code statusline (model · 5h/7d limits · rank): \`ccclub statusline on|off\`
- Audit what gets uploaded: \`ccclub show-data\`
- List collected agents, and turn opt-in ones on/off:
  \`ccclub sources\` · \`ccclub sources enable cursor\` · \`ccclub sources disable cursor\`

## Public HTTP API (no auth required)

- GET https://ccclub.dev/api/rank/{groupCode}?period=daily&tz=480
  - period: daily | yesterday | weekly | monthly | all-time
  - tz: local UTC offset in minutes (e.g. 480 for UTC+8, -300 for UTC-5)
  - Returns JSON: { group: { name, code, memberCount }, period, start, end,
    rankings: [{ rank, userId, displayName, totalTokens, nonCacheTokens, inputTokens,
    outputTokens, costUSD, models, agents, agentBreakdown, chatCount, ... }] }
  - Use groupCode "global" for the public opt-in leaderboard.
- GET https://ccclub.dev/api/pricing
  - Model pricing table (USD per million tokens) used for cost calculation,
    refreshed daily from LiteLLM. Supports ETag / If-None-Match revalidation.

## Web

- Group dashboard (HTML, live): https://ccclub.dev/g/{groupCode}
- Invite page: https://ccclub.dev/invite/{groupCode}

## Source

- GitHub: https://github.com/mazzzystar/ccclub (MIT)
`;

const app = new Hono<{ Bindings: Env }>();

app.get("/llms.txt", (c) => {
  c.header("Cache-Control", "public, max-age=3600");
  return c.text(LLMS_TXT);
});

export { app as llmsRoute };
