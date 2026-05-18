import { Hono } from "hono";
import type { Env } from "./types.js";

const app = new Hono<{ Bindings: Env }>();

export const GUIDE_MARKDOWN = `# ccclub — Claude Code Leaderboard Among Friends

> See how your friends are doing with Claude Code. Share a link, check the leaderboard. No signup, no config.

Website: https://ccclub.dev
GitHub: https://github.com/mazzzystar/ccclub
Discord: https://discord.gg/6QbGWJUVHq

---

## Quick Start

\`\`\`bash
# 1. Initialize (creates your group + installs auto-sync)
npx ccclub init

# 2. Share the invite link with friends
#    (printed after init — looks like https://ccclub.dev/invite/YHAW6P)

# 3. See the leaderboard
ccclub
\`\`\`

---

## Installation

\`\`\`bash
npx ccclub init
\`\`\`

This single command:
- Asks for your display name (auto-detects from git config)
- Creates your group with a 6-letter invite code
- Installs a Claude Code hook for automatic usage sync
- Globally installs \`ccclub\` so you can run it without \`npx\`

---

## Inviting Friends

After init, you get an invite link like:

    https://ccclub.dev/invite/YHAW6P

Share this link via iMessage, Slack, Discord, etc. The link shows:
- Your group name and member count
- A one-command join instruction
- A rich preview card when shared in messaging apps

Friends join by running:
\`\`\`bash
npx ccclub join YHAW6P
\`\`\`

---

## Viewing the Leaderboard

### CLI
\`\`\`bash
ccclub                  # Today's leaderboard (default)
ccclub -d 1             # Yesterday
ccclub -d 7             # Last 7 days
ccclub -d 30            # Last 30 days
ccclub -d all           # All time
ccclub --global         # Global public leaderboard
ccclub --cache          # Include cache tokens in count
ccclub --all            # Show all members including inactive
ccclub -g XYZABC        # Show a specific group
\`\`\`

### Web Dashboard
Every group has a live web dashboard at:

    https://ccclub.dev/g/YHAW6P

Features:
- Real-time leaderboard with cost, tokens, chats, $/chat
- Monthly ROI calculation (for users with subscription plans)
- Activity chart showing usage patterns over time
- Active member indicators
- Period selector (Today, Yesterday, 7d, 30d, All Time)

### Global Leaderboard
Public users appear on the global leaderboard:

    https://ccclub.dev/g/global

---

## All Commands

| Command | Description |
|---------|-------------|
| \`ccclub init\` | Create a group and get started (first-time setup) |
| \`ccclub join <CODE>\` | Join a group with a 6-letter invite code |
| \`ccclub\` | Show today's leaderboard |
| \`ccclub -d 1\\|7\\|30\\|all\` | Time window (yesterday / 7d / 30d / all time) |
| \`ccclub --global\` | Global public leaderboard |
| \`ccclub --cache\` | Include cache tokens in total |
| \`ccclub --all\` | Show all members including inactive ones |
| \`ccclub create\` | Create an additional group |
| \`ccclub leave [CODE]\` | Leave a group |
| \`ccclub sync\` | Manual sync (auto-syncs on session end) |
| \`ccclub sync --force\` | Force full re-sync of all data |
| \`ccclub profile\` | View your profile |
| \`ccclub profile --name <name>\` | Change display name |
| \`ccclub profile --avatar <url>\` | Set avatar URL |
| \`ccclub profile --public\` | Show in global ranking |
| \`ccclub profile --private\` | Hide from global ranking |
| \`ccclub profile --plan pro\\|max100\\|max200\\|api\` | Set subscription plan (for ROI calculation) |
| \`ccclub profile --url <url>\` | Link your name to a URL |
| \`ccclub show-data\` | Preview exactly what gets uploaded |

---

## Profile & Plans

Set your subscription plan to see Monthly ROI in the leaderboard:

\`\`\`bash
ccclub profile --plan max200    # Max plan ($200/mo)
ccclub profile --plan max100    # Max plan ($100/mo)
ccclub profile --plan pro       # Pro plan ($20/mo)
ccclub profile --plan api       # API user (free tier)
\`\`\`

ROI shows how much value you're getting: \`$200/1610%\` means you've used $3,220 worth of Claude on a $200 plan.

Other profile options:
\`\`\`bash
ccclub profile --public         # Appear on global leaderboard
ccclub profile --url https://github.com/you
ccclub profile --avatar https://example.com/photo.jpg
\`\`\`

---

## Privacy

ccclub reads **only** token counts, cost estimates, model names, and number of calls from \`~/.claude/projects/\` — the local usage logs that Claude Code already writes.

**Never uploaded:**
- Prompts or responses
- Code or file contents
- File paths or project names
- Conversation data

Run \`ccclub show-data\` to see exactly what gets uploaded.

---

## How Syncing Works

- **Automatic**: A Claude Code hook runs \`ccclub sync\` at the end of every session
- **Manual**: Run \`ccclub sync\` anytime
- **Force**: Run \`ccclub sync --force\` to re-upload all historical data
- Usage data is aggregated into 30-minute blocks before upload

---

## Multiple Groups

You can be in multiple groups simultaneously:

\`\`\`bash
ccclub create              # Create another group
ccclub join XYZABC         # Join a friend's group
ccclub -g XYZABC           # View a specific group
ccclub leave XYZABC        # Leave a group
\`\`\`

Running \`ccclub\` shows all your groups at once.

---

## Web Features

| URL | Description |
|-----|-------------|
| \`ccclub.dev\` | Landing page |
| \`ccclub.dev/g/<CODE>\` | Group dashboard (live leaderboard + activity chart) |
| \`ccclub.dev/g/global\` | Global public leaderboard |
| \`ccclub.dev/invite/<CODE>\` | Invite page (share this link to invite friends) |

---

## FAQ

**Q: Does ccclub read my code or prompts?**
A: No. It only reads usage metadata (token counts, costs, model names) from Claude Code's local logs.

**Q: Do I need to create an account?**
A: No. Just run \`npx ccclub init\`. No email, no password, no signup.

**Q: How does auto-sync work?**
A: ccclub installs a Claude Code hook that runs \`ccclub sync --silent\` when your session ends. You can also sync manually.

**Q: Can I be in multiple groups?**
A: Yes. Run \`ccclub create\` for a new group or \`ccclub join <CODE>\` to join another.

**Q: What is Monthly ROI?**
A: If you set your plan (\`ccclub profile --plan max200\`), the leaderboard shows how much Claude usage you got relative to your subscription cost. 1610% means you used 16.1x what you paid.

**Q: How do I appear on the global leaderboard?**
A: Run \`ccclub profile --public\`. Your usage will appear at ccclub.dev/g/global.

**Q: Can I remove my data?**
A: Leave all groups with \`ccclub leave\` and delete \`~/.ccclub/\`. Your data will expire from the server.

---

MIT License · https://github.com/mazzzystar/ccclub
`;

export const LLMS_TXT = `# ccclub

> Claude Code leaderboard among friends

## Docs

- [Full Guide](https://ccclub.dev/llms-full.txt): Complete documentation for ccclub CLI and web dashboard
- [Landing Page](https://ccclub.dev/): Product overview and quick start
- [Global Leaderboard](https://ccclub.dev/g/global): Live public leaderboard
- [GitHub](https://github.com/mazzzystar/ccclub): Source code and README

## API

- GET /api/health: Health check
- POST /api/init: Create user and group
- POST /api/join: Join a group
- POST /api/sync: Upload usage data
- POST /api/profile: Update user profile
- GET /api/profile: Get user profile
- POST /api/group/create: Create additional group
- POST /api/leave: Leave a group
- GET /api/rank/:code: Get group rankings
- GET /api/rank/global: Get global rankings
- GET /api/activity/:code: Get activity chart data

## Web Pages

- /: Landing page
- /g/:code: Group dashboard (live leaderboard + activity chart)
- /g/global: Global public leaderboard
- /invite/:code: Invite page with OG social cards
`;

app.get("/llms.txt", (c) => {
  return c.text(LLMS_TXT, 200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" });
});

app.get("/llms-full.txt", (c) => {
  return c.text(GUIDE_MARKDOWN, 200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" });
});

export { app as guideRoute };
