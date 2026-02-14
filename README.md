[中文](./assets/README_CN.md) | [日本語](./assets/README_JA.md) | [한국어](./assets/README_KO.md) | [Deutsch](./assets/README_DE.md) | [Français](./assets/README_FR.md) | [Español](./assets/README_ES.md)

# ccclub.dev

Know how much Claude Code your friends are burning through.

<img src="assets/demo.png" alt="ccclub" width="80%" />

## Get Started

```bash
npm i -g ccclub && ccclub init
```

It asks your name, gives you a 6-letter code. Send it to friends:

```bash
npm i -g ccclub && ccclub join R4NK7D
```

Done. Usage syncs automatically via Claude Code hook (installed during `npm i -g`). No config, no signup, no account.

Once a friend joins, check the leaderboard:

```bash
ccclub
```

## What Happens

```
~/.claude/projects/*.jsonl → aggregate into 1h blocks → upload → view together
```

CCClub reads the JSONL logs Claude Code already writes locally, bundles them into 1-hour summaries (token counts + cost), and uploads those numbers. **No prompts, no code, no file paths, no project names** — just counters. Run `ccclub show-data` to audit exactly what gets sent.

## Commands

Everyday use — these four are all you need:

```bash
ccclub init                        # One-time setup, creates a group
ccclub join <CODE>                 # Join a friend's group
ccclub sync                        # Manual sync (also runs on session end)
ccclub                             # See usage for today
```

More time periods:

```bash
ccclub -p weekly                   # This week
ccclub -p monthly                  # This month
ccclub -p all-time                 # All time
ccclub --cache                     # Include cache tokens in count
ccclub --global                    # Everyone who opted in
ccclub -g R4NK7D                   # Specific group
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
https://ccclub.dev/g/R4NK7D
```

Period switcher (daily / weekly / monthly / all-time), avatars, auto-refresh every 5 minutes. There's also a global page at `/g/global` for public users.

## Privacy

Uploads **only** this:

```json
{
  "blockStart": "2025-02-13T00:00:00Z",
  "blockEnd": "2025-02-13T01:00:00Z",
  "inputTokens": 48210,
  "outputTokens": 12050,
  "cacheCreationTokens": 0,
  "cacheReadTokens": 31200,
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

Auto-sync: Claude Code `SessionEnd` + `Stop` hooks run `ccclub sync --silent` (throttled to once per 5 minutes).

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
