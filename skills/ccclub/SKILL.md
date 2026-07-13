---
name: ccclub
description: Check the user's coding-agent leaderboard — token usage, cost, and rank among friends across Claude Code, Codex, OpenCode, Amp, and pi-agent. Use when the user asks how many tokens they burned, what their AI spend is, where they rank in their group, or wants to set up / join a ccclub leaderboard.
---

# ccclub — coding-agent leaderboard among friends

ccclub reads local coding-agent usage logs, aggregates them into anonymous
30-minute token/cost summaries (no prompts, no code, no file paths), and
uploads only those counters to a group leaderboard the user shares with
friends.

## Check rank and spend (most common request)

Run:

```bash
ccclub --json
```

Output shape:

```json
{
  "period": "daily",
  "groups": [{
    "group": { "name": "...", "code": "ABC123", "memberCount": 67 },
    "start": "...", "end": "...",
    "rankings": [{
      "rank": 11, "displayName": "...", "costUSD": 19.02,
      "totalTokens": 47100000, "models": ["..."], "agents": ["claude"],
      "chatCount": 27
    }]
  }]
}
```

Time windows: `ccclub --json -d 1` (yesterday), `-d 7`, `-d 30`, `-d all`.
The user's own row: match `displayName` against their name, or compare all
rows. Costs are USD. `groups` contains one entry per group the user joined.

If `ccclub` is not on PATH, the user hasn't set it up — see Setup below.
If it prints "Not initialized", run setup too.

## Setup (first time)

- Create a group: `npx ccclub init` (interactive: asks display name once)
- Join a friend's group: `npx ccclub join <6-LETTER-CODE>`
- Both install background sync automatically; nothing else to configure.

## Other commands

- `ccclub statusline on|off` — Claude Code statusline (model · 5h/7d limits · rank)
- `ccclub show-data` — audit exactly what gets uploaded (privacy check)
- `ccclub sync` — force an immediate sync

The leaderboard counts coding agents only; personal-assistant usage (e.g.
OpenClaw) is excluded from rankings server-side.
- Group dashboard (shareable URL): `https://ccclub.dev/g/<CODE>`

## HTTP fallback (no CLI needed, read-only)

```
GET https://ccclub.dev/api/rank/{groupCode}?period=daily&tz={utcOffsetMinutes}
```

periods: daily | yesterday | weekly | monthly | all-time. Full API notes:
https://ccclub.dev/llms.txt
