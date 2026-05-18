[中文](./assets/README_CN.md) | [日本語](./assets/README_JA.md) | [한국어](./assets/README_KO.md) | [Deutsch](./assets/README_DE.md) | [Français](./assets/README_FR.md) | [Español](./assets/README_ES.md)

# ccclub.dev

Coding agent leaderboard among friends.

<img src="assets/demo.png" alt="ccclub" width="80%" />

## Get Started

```bash
npx ccclub init
```

It asks your name, gives you a 6-letter code. Send it to friends:

```bash
npx ccclub join YHAW6P
```

Done. Usage syncs automatically from supported coding agents. No config, no signup, no account.

Once a friend joins, check the leaderboard:

```bash
ccclub
```

## What gets uploaded

ccclub reads local usage logs that supported coding agents already write, bundles them into 30-minute summaries (token counts + cost), and uploads those numbers. **No prompts, no code, no file paths, no project names** — just counters. Run `ccclub show-data` to audit exactly what gets sent.

Supported sources:

| Agent | Default location |
|-------|------------------|
| Claude Code | `~/.config/claude/projects`, `~/.claude/projects` |
| Codex | `~/.codex/sessions` |
| OpenCode | `~/.local/share/opencode` |
| Amp | `~/.local/share/amp/threads` |
| pi-agent | `~/.pi/agent/sessions` |

Custom locations are supported with `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `OPENCODE_DATA_DIR`, `AMP_DATA_DIR`, and `PI_AGENT_DIR`.

## Commands

Everyday use — these four are all you need:

```bash
ccclub init                        # One-time setup, creates a group
ccclub join <CODE>                 # Join a friend's group
ccclub sync                        # Manual sync (auto-sync also runs in background)
ccclub                             # Show the leaderboard
```

More options:

```bash
ccclub -d 1                        # Time window: 1 / 7 / 30 / all
ccclub --cache                     # Include cache tokens in count
ccclub --all                       # Show all members, including those with no activity today
ccclub --global                    # Everyone who opted in
ccclub -g YHAW6P                   # Specific group
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
```

## Web Dashboard

Every group gets a live page:

```
https://ccclub.dev/g/YHAW6P
```

Period switcher (today / 7d / 30d / all time), avatars, auto-refresh every 5 minutes. There's also a global page at `/g/global` for public users.

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
  shared/     Types + constants
  cli/        ccclub — Commander.js CLI
  worker/     Cloudflare Worker — Hono API + KV + dashboard
```

Auto-sync: Claude Code `SessionEnd` + `Stop` hooks run `ccclub sync --silent`, and a lightweight background sync keeps other supported agents fresh (throttled to once per 5 minutes).

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
