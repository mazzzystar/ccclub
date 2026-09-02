[中文](./assets/README_CN.md) | [日本語](./assets/README_JA.md) | [한국어](./assets/README_KO.md) | [Deutsch](./assets/README_DE.md) | [Français](./assets/README_FR.md) | [Español](./assets/README_ES.md)

# ccclub.dev

Claude Code and Codex leaderboard among friends. Track coding agent token usage, costs, active status, and agent mix across Claude Code, Codex, OpenCode, Amp, Grok, Pi, and Cursor.

<img src="assets/demo.png" alt="ccclub" width="80%" />

## Get Started

```bash
npx ccclub init
```

It asks your name, gives you a 6-letter code. Send it to friends:

```bash
npx ccclub join YHAW6P
```

Done. ccclub automatically detects supported coding agent logs on your machine and keeps usage synced. No config, no signup, no account.

Once a friend joins, check the leaderboard:

```bash
ccclub
```

## What gets uploaded

ccclub reads local usage logs that supported coding agents already write, bundles them into 30-minute summaries (agent source + token counts + cost), and uploads those numbers. **No prompts, no code, no file paths, no project names** — just counters. Run `ccclub show-data` to audit exactly what gets sent.

Supported sources:

| Agent | Default location |
|-------|------------------|
| Claude Code | `~/.config/claude/projects`, `~/.claude/projects` |
| Codex | `~/.codex/sessions` |
| OpenCode | `~/.local/share/opencode` |
| Amp | `~/.local/share/amp/threads` |
| Pi | `~/.pi/agent/sessions` |
| Grok | `~/.grok/sessions/**/updates.jsonl` |
| Cursor | Cursor's dashboard API — **opt-in**: `ccclub sources enable cursor` |

If you use the default locations, there is nothing to configure. Custom locations are supported with `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `OPENCODE_DATA_DIR`, `AMP_DATA_DIR`, `PI_AGENT_DIR`, and `GROK_HOME`.

### Cursor is opt-in

Cursor keeps no local token or cost logs, so it is the one source ccclub cannot read from disk. Collecting it means calling Cursor's own dashboard API (`api2.cursor.sh`) with the access token Cursor already stored in your macOS Keychain — so ccclub leaves it off until you ask:

```bash
ccclub sources enable cursor   # prints what it does, then turns it on
ccclub sources                 # see what is collected
ccclub sources disable cursor
```

Your Cursor token is never uploaded to ccclub; it only authenticates you to Cursor. The refresh token is never read, `CURSOR_ACCESS_TOKEN` overrides the Keychain lookup, and what syncs is the same aggregated block summary as every other source. If you never enable it, ccclub never reads the Cursor Keychain item and never contacts Cursor.

The leaderboard deliberately tracks **coding agents only** — usage from personal-assistant tools (e.g. OpenClaw) is excluded server-side so it can never inflate anyone's rank.

## Commands

Everyday use — these four are all you need:

```bash
ccclub init                        # One-time setup, creates a group
ccclub join <CODE>                 # Join a friend's group
ccclub sync                        # Manual sync; auto-sync also runs after setup
ccclub                             # Show the leaderboard
```

More options:

```bash
ccclub -d 1                        # Time window: 1 / 7 / 30 / all
ccclub --no-cache                  # Exclude cache tokens from count
ccclub --all                       # Show all members, including those with no activity today
ccclub --global                    # Everyone who opted in
ccclub -g YHAW6P                   # Specific group
ccclub --json                      # Raw JSON output — pipe to jq, feed to agents
```

If you want more, it's there:

```bash
ccclub create                      # Make another group
ccclub profile                     # See your profile
ccclub profile --name "new name"   # Change display name
ccclub profile --avatar "URL"      # Custom avatar
ccclub profile --public            # Show up on global board
ccclub profile --private           # Hide from global (default)
ccclub show-data                   # See exactly what gets uploaded
ccclub sources                     # Which agents are collected
ccclub sources enable cursor       # Turn on the opt-in Cursor source
ccclub statusline on|off           # Claude Code statusline toggle
```

## Claude Code Statusline

Setup also enables a statusline inside Claude Code — current model and reasoning effort, 5-hour/7-day usage limits (plus the model-scoped weekly cap when your plan has one), and today's rank:

```
 Fable 5 xhigh | 5h: 15% / 7d: 43% / Fable: 8% | #11/67 $19.0
```

It is only enabled when **no other statusline is configured**: if you use [cc-costline](https://github.com/Ventuss-OvO/cc-costline) (a richer statusline that already shows your ccclub rank) or any custom command, ccclub never touches it. Toggle anytime:

```bash
ccclub statusline off              # Remove (and never auto-enable again)
ccclub statusline on               # Bring it back
```

Rendering reads only local caches kept fresh by the auto-sync hooks — no network calls, ~30 ms.

Thanks to my friend [Ventuss](https://github.com/Ventuss-OvO) — we borrowed a lot of the statusline code from [cc-costline](https://github.com/Ventuss-OvO/cc-costline). ❤️

## Web Dashboard

Every group gets a live page:

```
https://ccclub.dev/g/YHAW6P
```

Period switcher (today / 7d / 30d / all time), avatars, active status, agent mix, auto-refresh every 5 minutes. There's also a global page at `/g/global` for public users.

## Privacy

Uploads **only** this:

```json
{
  "blockStart": "2025-02-13T00:00:00Z",
  "blockEnd": "2025-02-13T00:30:00Z",
  "source": "claude",
  "inputTokens": 48210,
  "outputTokens": 12050,
  "cacheCreationTokens": 0,
  "cacheReadTokens": 31200,
  "reasoningTokens": 0,
  "totalTokens": 91460,
  "costUSD": 0.2184,
  "models": ["claude-sonnet-4-5-20250929"],
  "entryCount": 23
}
```

You are **private by default** — visible only in groups you've joined. Global leaderboard is opt-in (`ccclub profile --public`).

## Architecture

```
packages/
  shared/     Types, constants + model pricing
  cli/        ccclub — Commander.js CLI
  worker/     Cloudflare Worker — Hono API + KV + dashboard
```

Auto-sync: `ccclub init` installs Claude Code `SessionEnd` + `Stop` hooks and a lightweight background sync that keeps Codex, OpenCode, Amp, Grok, and Pi fresh (throttled to once per 5 minutes). The background sync reads `~/.ccclub/config.json`, so an opt-in source you enable is picked up there too. Those entrypoints are never re-pinned backward — a newer pin beats an older CLI — so to force this version back in, run `ccclub hook` (heartbeat: `rm ~/Library/LaunchAgents/dev.ccclub.sync.plist && ccclub sync`).

Model pricing: costs are computed locally against a compact price table derived from [LiteLLM](https://github.com/BerriAI/litellm) — the same upstream ccusage uses. The Worker refreshes it daily and serves it at `/api/pricing`; the CLI keeps a 24-hour local cache (`~/.ccclub/pricing.json`) with a bundled snapshot as offline fallback. New models are priced correctly within a day, with no CLI update required.

Scan cache: sync only re-reads log files whose mtime/size changed (`~/.ccclub/scan-cache/`), so steady-state syncs take milliseconds regardless of history size.

For agents and scripts: `ccclub --json` prints the raw leaderboard JSON, and [ccclub.dev/llms.txt](https://ccclub.dev/llms.txt) documents the public HTTP API.

## Development

```bash
pnpm install
pnpm build
pnpm dev:worker                    # localhost:8787

# In another terminal
CCCLUB_API_URL=http://localhost:8787 ccclub init
```

## License

MIT
