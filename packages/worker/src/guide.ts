import { Hono } from "hono";
import type { Env } from "./types.js";
import { svgEsc, renderToPng } from "./og-utils.js";

const app = new Hono<{ Bindings: Env }>();

export const GUIDE_MARKDOWN = `# ccclub — Coding Agent Leaderboard Among Friends

> See how your friends are doing across Claude Code, Codex, OpenCode, Amp, and pi-agent. Share a link, check the leaderboard. No signup, no config.

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
- Installs automatic usage sync for supported coding agents
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
- Real-time leaderboard with cost, tokens, turns, $/turn
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

ROI shows how much value you're getting: \`$200/1610%\` means you've used $3,220 worth of tracked agent usage on a $200 plan.

Other profile options:
\`\`\`bash
ccclub profile --public         # Appear on global leaderboard
ccclub profile --url https://github.com/you
ccclub profile --avatar https://example.com/photo.jpg
\`\`\`

---

## Privacy

ccclub reads **only** token counts, cost estimates, model names, and number of calls from local usage logs written by Claude Code, Codex, OpenCode, Amp, and pi-agent.

**Never uploaded:**
- Prompts or responses
- Code or file contents
- File paths or project names
- Conversation data

Run \`ccclub show-data\` to see exactly what gets uploaded.

---

## How Syncing Works

- **Automatic**: A Claude Code hook runs \`ccclub sync\` at session end; background sync keeps other supported agents fresh
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
A: No. It only reads usage metadata (token counts, costs, model names) from supported coding agent logs.

**Q: Do I need to create an account?**
A: No. Just run \`npx ccclub init\`. No email, no password, no signup.

**Q: How does auto-sync work?**
A: ccclub installs a Claude Code hook for session-end sync and a lightweight background sync for other supported agents. You can also sync manually.

**Q: Can I be in multiple groups?**
A: Yes. Run \`ccclub create\` for a new group or \`ccclub join <CODE>\` to join another.

**Q: What is Monthly ROI?**
A: If you set your plan (\`ccclub profile --plan max200\`), the leaderboard shows tracked usage cost relative to your subscription cost. 1610% means you used 16.1x what you paid.

**Q: How do I appear on the global leaderboard?**
A: Run \`ccclub profile --public\`. Your usage will appear at ccclub.dev/g/global.

**Q: Can I remove my data?**
A: Leave all groups with \`ccclub leave\` and delete \`~/.ccclub/\`. Your data will expire from the server.

---

MIT License · https://github.com/mazzzystar/ccclub
`;

export const LLMS_TXT = `# ccclub

> Coding agent leaderboard among friends

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

// ── Landing page OG image (static terminal leaderboard) ──────

app.get("/og.png", async (c) => {
  const svg = buildLandingOgSvg();
  const png = await renderToPng(svg);
  return c.body(png, 200, {
    "Content-Type": "image/png",
    "Cache-Control": "public, max-age=86400",
  });
});

function buildLandingOgSvg(): string {
  const W = 1200;
  const H = 630;
  const F = 'font-family="Inter, sans-serif"';
  const FM = 'font-family="Courier New, monospace"';

  const rows = [
    { rank: "1", name: "Tiger", cost: "$110.57", tokens: "339K", roi: "", chats: "17", perChat: "$6.50", color: "#d4a03e", active: true },
    { rank: "2", name: "mazzystar", cost: "$101.88", tokens: "206K", roi: "$200/1610%", chats: "66", perChat: "$1.54", color: "#5aad7d", active: true },
    { rank: "3", name: "Darkrayon", cost: "$96.08", tokens: "219K", roi: "$200/3560%", chats: "26", perChat: "$3.70", color: "#e8e4de", active: false },
    { rank: "4", name: "BryantChen", cost: "$53.38", tokens: "284K", roi: "", chats: "39", perChat: "$1.37", color: "#e8e4de", active: false },
    { rank: "5", name: "Owen", cost: "$42.87", tokens: "232K", roi: "", chats: "31", perChat: "$1.38", color: "#e8e4de", active: false },
    { rank: "6", name: "ventuss", cost: "$42.54", tokens: "188K", roi: "$200/1987%", chats: "48", perChat: "$0.89", color: "#e8e4de", active: true },
    { rank: "7", name: "junyu", cost: "$21.19", tokens: "81K", roi: "$200/558%", chats: "18", perChat: "$1.18", color: "#6b6560", active: false },
  ];

  // Terminal window
  const TX = 60, TY = 40, TW = W - 120, TH = H - 80;
  const BAR_H = 36;

  // Table layout
  const TABLE_Y = TY + BAR_H + 90;
  const ROW_H = 36;
  const cols = [TX + 30, TX + 60, TX + 240, TX + 420, TX + 530, TX + 700, TX + 790, TX + 900];
  const headers = ["#", "Name", "Cost", "Tokens", "ROI", "Turns", "$/Turn"];

  let headerSvg = "";
  headers.forEach((h, i) => {
    const anchor = i === 0 ? "middle" : i >= 5 ? "end" : "start";
    headerSvg += `<text x="${cols[i]}" y="${TABLE_Y - 8}" text-anchor="${anchor}" fill="#5a5550" font-size="11" font-weight="500" ${F} letter-spacing="0.5">${h}</text>`;
  });

  let rowsSvg = "";
  rows.forEach((r, i) => {
    const y = TABLE_Y + i * ROW_H + 20;
    const nameColor = r.color;
    const activeTag = r.active ? `<tspan fill="#5aad7d" font-size="10"> (active)</tspan>` : "";
    const roiText = r.roi ? `<tspan fill="#5aad7d">${svgEsc(r.roi)}</tspan>` : `<tspan fill="#5a5550">—</tspan>`;

    rowsSvg += `
      <text x="${cols[0]}" y="${y}" text-anchor="middle" fill="${r.rank === "2" ? "#5aad7d" : r.rank === "1" ? "#d4a03e" : "#6b6560"}" font-size="14" font-weight="600" ${F}>${r.rank === "2" ? "→" + r.rank : r.rank}</text>
      <text x="${cols[1]}" y="${y}" fill="${nameColor}" font-size="14" font-weight="${r.rank <= "2" ? "600" : "400"}" ${F}>${svgEsc(r.name)}${activeTag}</text>
      <text x="${cols[2]}" y="${y}" fill="${nameColor}" font-size="14" ${F}>${r.cost}</text>
      <text x="${cols[3]}" y="${y}" fill="#8a8480" font-size="14" ${F}>${r.tokens}</text>
      <text x="${cols[4]}" y="${y}" fill="#5a5550" font-size="13" ${F}>${roiText}</text>
      <text x="${cols[5]}" y="${y}" text-anchor="end" fill="#6b6560" font-size="14" ${F}>${r.chats}</text>
      <text x="${cols[6]}" y="${y}" text-anchor="end" fill="#8a8480" font-size="14" ${F}>${r.perChat}</text>`;
  });

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#201e1c"/>
      <stop offset="100%" stop-color="#161412"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- Terminal window -->
  <rect x="${TX}" y="${TY}" width="${TW}" height="${TH}" rx="10" fill="#13110f" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>

  <!-- Terminal bar -->
  <circle cx="${TX + 20}" cy="${TY + BAR_H / 2}" r="5" fill="#e05555"/>
  <circle cx="${TX + 38}" cy="${TY + BAR_H / 2}" r="5" fill="#d4a03e"/>
  <circle cx="${TX + 56}" cy="${TY + BAR_H / 2}" r="5" fill="#5aad7d"/>
  <line x1="${TX}" y1="${TY + BAR_H}" x2="${TX + TW}" y2="${TY + BAR_H}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>

  <!-- Prompt -->
  <text x="${TX + 24}" y="${TY + BAR_H + 28}" fill="#5aad7d" font-size="14" ${FM}>$</text>
  <text x="${TX + 40}" y="${TY + BAR_H + 28}" fill="#e8e4de" font-size="14" ${FM}>ccclub</text>

  <!-- Group header -->
  <text x="${TX + 24}" y="${TY + BAR_H + 52}" fill="#d4935e" font-size="15" font-weight="600" ${F}>mazzystar's club</text>
  <text x="${TX + 24}" y="${TY + BAR_H + 72}" fill="#5a5550" font-size="12" ${F}>TODAY · 44 members</text>
  <text x="${TX + 160}" y="${TY + BAR_H + 72}" fill="#5aad7d" font-size="12" ${F}>3 active</text>

  <!-- Table header -->
  ${headerSvg}

  <!-- Table rows -->
  ${rowsSvg}

  <!-- Footer -->
  <text x="${TX + 24}" y="${TY + TH - 16}" fill="#5a5550" font-size="12" ${F}>Dashboard: </text>
  <text x="${TX + 104}" y="${TY + TH - 16}" fill="#5aad7d" font-size="12" ${F}>https://ccclub.dev/g/YHAW6P</text>
</svg>`;
}

app.get("/llms.txt", (c) => {
  return c.text(LLMS_TXT, 200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" });
});

app.get("/llms-full.txt", (c) => {
  return c.text(GUIDE_MARKDOWN, 200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" });
});

export { app as guideRoute };
