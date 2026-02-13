[中文](./README_CN.md) | [日本語](./README_JA.md) | [한국어](./README_KO.md) | [Deutsch](./README_DE.md) | [Français](./README_FR.md) | [Español](./README_ES.md)

# ccclub.dev

Know how much Claude Code your friends are burning through.

<img src="assets/demo.png" alt="ccclub rank" width="80%" />

## Get Started

```bash
npx ccclub init
```

It asks your name, gives you a 6-letter code. Send it to friends:

```bash
npx ccclub join R4NK7D
```

Done. Usage syncs in the background every hour. No config, no signup, no account.

Once a friend joins, check the leaderboard:

```bash
ccclub rank
```

## What Happens

```
~/.claude/projects/*.jsonl → aggregate into 5h blocks → upload → view together
```

CCClub reads the JSONL logs Claude Code already writes locally, bundles them into 5-hour summaries (token counts + cost), and uploads those numbers. **No prompts, no code, no file paths, no project names** — just counters. Run `ccclub show-data` to audit exactly what gets sent.

## Commands

Everyday use — these four are all you need:

```bash
ccclub init                        # One-time setup, creates a group
ccclub join <CODE>                 # Join a friend's group
ccclub sync                        # Manual sync (also runs hourly automatically)
ccclub rank                        # See usage for today
```

More time periods:

```bash
ccclub rank -p weekly              # This week
ccclub rank -p monthly             # This month
ccclub rank -p all-time            # All time
ccclub rank --global               # Everyone who opted in
ccclub rank -g R4NK7D              # Specific group
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
  "blockEnd": "2025-02-13T05:00:00Z",
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
  cli/        npx ccclub — Commander.js CLI
  worker/     Cloudflare Worker — Hono API + KV + dashboard
```

Heartbeat: macOS LaunchAgent runs `ccclub sync --silent` every hour.

## Development

```bash
pnpm install
pnpm build
pnpm dev:worker                    # localhost:8787

# In another terminal
CCCLUB_API_URL=http://localhost:8787 npx ccclub init
```

## License

MIT
