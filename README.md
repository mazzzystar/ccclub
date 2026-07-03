[中文](./assets/README_CN.md) | [日本語](./assets/README_JA.md) | [한국어](./assets/README_KO.md) | [Deutsch](./assets/README_DE.md) | [Français](./assets/README_FR.md) | [Español](./assets/README_ES.md)

# ccclub.dev

Claude Code and Codex leaderboard among friends. Track coding agent token usage, costs, active status, and agent mix across Claude Code, Codex, OpenCode, Amp, and pi-agent.

<img src="assets/demo.png" alt="ccclub" width="80%" />

## Get Started

```bash
npx ccclub init
```

It asks your name, gives you a 6-letter code. Send it to friends:

```bash
npx ccclub join YHAW6P
```

Done. ccclub creates a lightweight local identity, automatically detects supported coding agent logs on your machine, and keeps usage synced. No password, no hosted login flow.

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
| pi-agent | `~/.pi/agent/sessions` |

If you use the default locations, there is nothing to configure. Custom locations are supported with `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `OPENCODE_DATA_DIR`, `AMP_DATA_DIR`, and `PI_AGENT_DIR`.

## Commands

Common commands:

```bash
ccclub init                        # One-time setup, creates a group
ccclub join <CODE>                 # Join a friend's group
ccclub sync                        # Manual sync; auto-sync also runs after setup
ccclub sync --force                # Re-scan and upload all local usage logs
ccclub                             # Show the leaderboard
```

Leaderboard options:

```bash
ccclub -d 1                        # Time window: 1 / 7 / 30 / all
ccclub --no-cache                  # Exclude cache tokens from count
ccclub --all                       # Show all members, including those with no activity today
ccclub --global                    # Everyone who opted in
ccclub -g YHAW6P                   # Specific group
```

Multi-device and account merge:

```bash
ccclub device link                 # Generate a 24-hour one-time code for another terminal
ccclub link ABCD2345               # Run on a fresh terminal to join the same user
ccclub merge-code                  # Generate a 24-hour one-time code for an existing account
ccclub merge WXYZ6789              # Run on the account that should be merged into the code owner
```

Profile and groups:

```bash
ccclub create                      # Make another group
ccclub leave [CODE]                # Leave one of your groups
ccclub profile                     # See your profile
ccclub profile --name "new name"   # Change display name
ccclub profile --avatar "URL"      # Custom avatar
ccclub profile --public            # Show up on global board
ccclub profile --private           # Hide from global (default)
ccclub profile --plan max100       # Set plan: pro / max100 / max200 / api / none
ccclub profile --url "https://..." # Link your display name
ccclub show-data                   # See exactly what gets uploaded
ccclub hook                        # Reinstall Claude Code auto-sync hooks if needed
```

## Web Dashboard

Every group gets a live page:

```
https://ccclub.dev/g/YHAW6P
```

Period switcher (today / yesterday / 7d / 30d / all time), avatars, active status, agent mix, activity chart, auto-refresh every 5 minutes. There's also a global page at `/g/global` for public users.

## Multiple Computers

There are two different flows:

**Fresh terminal, same ccclub user**

Run this on a terminal that is already initialized:

```bash
ccclub device link
```

Then run the printed command on the fresh terminal:

```bash
ccclub link ABCD2345
```

The code is one-time use and valid for 24 hours. New installs get their own local `deviceId`, so each computer writes to its own usage bucket. Older installs without `deviceId` keep using the legacy sync path; existing data is preserved.

**Two terminals that were already initialized as separate users**

Run this on the account whose name/avatar/profile should stay visible:

```bash
ccclub merge-code
```

Then run the printed command on the account you want to fold in:

```bash
ccclub merge WXYZ6789
```

The merge code is also one-time use and valid for 24 hours. Existing usage is not moved, deleted, or rewritten. The worker stores a lightweight alias and merges usage at read time, so the leaderboard, activity chart, dashboard metadata, and OG image show one row with the kept account's profile.

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
  "entryCount": 23,
  "chatCount": 8
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

Auto-sync: `ccclub init`, `ccclub join`, and `ccclub link` install Claude Code `SessionEnd` + `Stop` hooks and a lightweight background sync that keeps Codex, OpenCode, Amp, and pi-agent fresh (throttled to once per 5 minutes).

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
