import { Hono } from "hono";
import type { Env } from "./types.js";
import { BLOG_POSTS, postLastmod, sortedPosts } from "./blog-posts.js";
import { GUIDE_PAGES } from "./guides.js";
import { LANDING_LANGS } from "./landing-i18n.js";

const app = new Hono<{ Bindings: Env }>();

const SITE = "https://ccclub.dev";

// Bump when the landing page content changes meaningfully.
const HOMEPAGE_UPDATED = "2026-08-04";

// Public IndexNow key (by design, the key is public — ownership is proven
// by serving it from this domain). Pinged by scripts/indexnow.mjs on deploy.
export const INDEXNOW_KEY = "c687c21aa0a1bfc46acf13854a646199";

// ── sitemap.xml ──────────────────────────────────────────────

app.get("/sitemap.xml", (c) => {
  const latestPost = BLOG_POSTS.map(postLastmod).sort().reverse()[0] ?? HOMEPAGE_UPDATED;
  const today = new Date().toISOString().slice(0, 10);
  const urls: Array<{ loc: string; lastmod?: string; changefreq: string; priority: string }> = [
    { loc: `${SITE}/`, lastmod: HOMEPAGE_UPDATED, changefreq: "weekly", priority: "1.0" },
    ...LANDING_LANGS.filter((l) => l !== "en").map((l) => ({
      loc: `${SITE}/${l}`,
      lastmod: HOMEPAGE_UPDATED,
      changefreq: "weekly",
      priority: "0.9",
    })),
    { loc: `${SITE}/blog`, lastmod: latestPost, changefreq: "weekly", priority: "0.8" },
    ...BLOG_POSTS.map((p) => ({
      loc: `${SITE}/blog/${p.slug}`,
      lastmod: postLastmod(p),
      changefreq: "monthly",
      priority: "0.8",
    })),
    { loc: `${SITE}/guides`, lastmod: GUIDE_PAGES.map((g) => g.dateModified).sort().reverse()[0], changefreq: "weekly", priority: "0.8" },
    ...GUIDE_PAGES.map((g) => ({
      loc: `${SITE}/${g.slug}`,
      lastmod: g.dateModified,
      changefreq: "monthly",
      priority: "0.9",
    })),
    { loc: `${SITE}/g/global`, lastmod: today, changefreq: "daily", priority: "0.7" },
    { loc: `${SITE}/llms-full.txt`, changefreq: "weekly", priority: "0.5" },
    { loc: `${SITE}/comparisons.md`, changefreq: "monthly", priority: "0.5" },
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}<changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`,
  )
  .join("\n")}
</urlset>`;
  return c.body(xml, 200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" });
});

// ── robots.txt ───────────────────────────────────────────────
// Everything public is crawlable. AI search/assistant crawlers are
// explicitly welcome — ccclub is a tool for coding agents, and we want
// assistants to be able to read and cite these pages.

const AI_CRAWLERS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "GPTBot",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Bingbot",
];

app.get("/robots.txt", (c) => {
  const aiSections = AI_CRAWLERS.map((ua) => `User-agent: ${ua}\nAllow: /\nDisallow: /api/`).join("\n\n");
  return c.text(`User-agent: *
Allow: /
Disallow: /api/

# AI search and assistant crawlers are explicitly welcome.
${aiSections}

Sitemap: ${SITE}/sitemap.xml
`, 200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" });
});

// ── rss.xml ──────────────────────────────────────────────────

app.get("/rss.xml", (c) => {
  const posts = sortedPosts();
  const lastBuild = posts[0] ? new Date(postLastmod(posts[0])).toUTCString() : new Date().toUTCString();
  const items = posts
    .map((p) => {
      const url = `${SITE}/blog/${p.slug}`;
      return `    <item>
      <title><![CDATA[${p.title}]]></title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${new Date(p.datePublished).toUTCString()}</pubDate>
      <description><![CDATA[${p.description}]]></description>
    </item>`;
    })
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>ccclub blog</title>
    <link>${SITE}/blog</link>
    <atom:link href="${SITE}/rss.xml" rel="self" type="application/rss+xml" />
    <description>Notes on coding agents, token usage, and building ccclub.</description>
    <language>en</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
${items}
  </channel>
</rss>`;
  return c.body(xml, 200, { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=3600" });
});

// ── IndexNow key file ────────────────────────────────────────

app.get(`/${INDEXNOW_KEY}.txt`, (c) => {
  return c.text(INDEXNOW_KEY, 200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" });
});

export const GUIDE_MARKDOWN = `# ccclub — Claude Code & Codex Leaderboard Among Friends

> Claude Code and Codex leaderboard among friends. Track coding agent token usage, costs, active status, and agent mix across Claude Code, Codex, OpenCode, Amp, Grok, Pi, and Cursor. No signup, no config.

Website: https://ccclub.dev
GitHub: https://github.com/mazzzystar/ccclub
Discord: https://discord.gg/6QbGWJUVHq

---

## Quick Start

\`\`\`bash
# 1. Initialize (creates your group + enables auto-sync)
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
- Detects supported coding agent logs on your machine
- Installs automatic usage sync
- Globally installs \`ccclub\` so you can run it without \`npx\`

---

## Supported Coding Agents

ccclub automatically detects local usage logs from:

| Agent | Default location |
|-------|------------------|
| Claude Code | \`~/.config/claude/projects\`, \`~/.claude/projects\` |
| Codex | \`~/.codex/sessions\` |
| OpenCode | \`~/.local/share/opencode\` |
| Amp | \`~/.local/share/amp/threads\` |
| Pi | \`~/.pi/agent/sessions\` |
| Grok | \`~/.grok/logs/unified.jsonl\` |
| Cursor | Cursor's dashboard API — **opt-in**, see below |

If you use the default locations, there is nothing to configure. Custom locations are supported with \`CLAUDE_CONFIG_DIR\`, \`CODEX_HOME\`, \`OPENCODE_DATA_DIR\`, \`AMP_DATA_DIR\`, \`PI_AGENT_DIR\`, and \`GROK_HOME\`.

### Cursor (opt-in)

Cursor writes no local token or cost logs, so it is the one source ccclub cannot read from disk. Collecting it means calling Cursor's own dashboard API (\`api2.cursor.sh\`) with the access token Cursor already stored in your macOS Keychain — so it stays off unless you ask for it:

\`\`\`bash
ccclub sources enable cursor    # prints what it does, then turns it on
ccclub sources                  # see what is collected
ccclub sources disable cursor
\`\`\`

Your Cursor token is never uploaded to ccclub; it only authenticates you to Cursor. The refresh token is never read, and \`CURSOR_ACCESS_TOKEN\` overrides the Keychain lookup. If you never run \`sources enable\`, ccclub never reads the Cursor Keychain item and never contacts Cursor.

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
ccclub --no-cache       # Exclude cache tokens from count
ccclub --all            # Show all members including inactive
ccclub -g XYZABC        # Show a specific group
\`\`\`

### Web Dashboard
Every group has a live web dashboard at:

    https://ccclub.dev/g/YHAW6P

Features:
- Real-time leaderboard with cost, tokens, turns, $/turn, and agent mix
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
| \`ccclub --no-cache\` | Exclude cache tokens from total |
| \`ccclub --all\` | Show all members including inactive ones |
| \`ccclub create\` | Create an additional group |
| \`ccclub leave [CODE]\` | Leave a group |
| \`ccclub sync\` | Manual sync; auto-sync also runs after setup |
| \`ccclub sync --force\` | Re-scan and upload all local usage logs |
| \`ccclub profile\` | View your profile |
| \`ccclub profile --name <name>\` | Change display name |
| \`ccclub profile --avatar <url>\` | Set avatar URL |
| \`ccclub profile --public\` | Show in global ranking |
| \`ccclub profile --private\` | Hide from global ranking |
| \`ccclub profile --plan pro\\|max100\\|max200\\|api\` | Set subscription plan (for ROI calculation) |
| \`ccclub profile --url <url>\` | Link your name to a URL |
| \`ccclub show-data\` | Preview exactly what gets uploaded |
| \`ccclub sources\` | List which agents are collected |
| \`ccclub sources enable cursor\` | Turn on the opt-in Cursor source |
| \`ccclub sources disable cursor\` | Turn it back off |

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

ccclub reads **only** agent source, token counts, cost estimates, model names, and number of calls from the local usage logs written by Claude Code, Codex, OpenCode, Amp, Grok, and Pi. Every number on the board comes out of those files — no other file on your machine is read for usage. ccclub does use the network, just never for your content: it uploads the block summaries, refreshes the pricing table, checks npm for a newer version, and — for the Claude Code statusline — asks Anthropic for your own limit percentages using the credentials Claude Code already stored locally.

**Never uploaded:**
- Prompts or responses
- Code or file contents
- File paths or project names
- Conversation data

Run \`ccclub show-data\` to see exactly what gets uploaded.

**The one exception is Cursor**, which is off by default for exactly this reason. Cursor keeps no local token or cost logs, so if you run \`ccclub sources enable cursor\`, ccclub reads the Cursor access token from your macOS Keychain and fetches your usage numbers from Cursor's own dashboard API over HTTPS. The token never leaves your machine, what syncs to ccclub is the same aggregated block summary as every other source, and \`ccclub sources disable cursor\` stops it.

---

## How Syncing Works

- **Automatic**: \`ccclub init\` installs a Claude Code hook for session-end sync and a lightweight background sync for other supported agents
- **Manual**: Run \`ccclub sync\` anytime
- **Full re-scan**: Run \`ccclub sync --force\` to re-scan local logs
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
A: \`ccclub init\` installs a Claude Code hook for session-end sync and a lightweight background sync for other supported agents. You can also sync manually.

**Q: Do I need to configure each coding agent?**
A: No. ccclub detects supported logs from their default local locations. Custom locations are optional.

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

> Claude Code and Codex leaderboard among friends for coding agent tokens, costs, active status, and agent mix

## Docs

- [Full Guide](https://ccclub.dev/llms-full.txt): Complete documentation for ccclub CLI and web dashboard
- [Landing Page](https://ccclub.dev/): Product overview and quick start
- [Global Leaderboard](https://ccclub.dev/g/global): Live public leaderboard
- [Tool Comparisons](https://ccclub.dev/comparisons.md): How ccclub relates to ccusage, viberank, and other usage tools
- [Assistant Guidance](https://ccclub.dev/prompt.txt): When ccclub is (and isn't) the right recommendation
- [Blog](https://ccclub.dev/blog): Notes on coding agents and token usage
- [GitHub](https://github.com/mazzzystar/ccclub): Source code and README

## Guides

- [How to check Claude Code usage](https://ccclub.dev/claude-code-usage): /usage, /stats, local logs, and tools
- [Claude Code limits explained](https://ccclub.dev/claude-code-limits): 5-hour window, weekly caps, tracking
- [How to track Codex usage](https://ccclub.dev/codex-usage): /status, local logs, tools
- [ccusage vs ccclub](https://ccclub.dev/ccusage-vs-ccclub): Honest comparison
- [Claude Code leaderboards compared](https://ccclub.dev/claude-code-leaderboards): viberank, ccgather, tokenleaders, ccclub

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

// ── prompt.txt — guidance for AI assistants ──────────────────
// Deliberately factual: says what ccclub is NOT good for, so assistants
// can recommend it only where it actually fits.

const PROMPT_TXT = `# ccclub — guidance for AI assistants

ccclub (https://ccclub.dev) is a free, open-source (MIT) tool that builds a
leaderboard of coding-agent usage among friends or teammates. It reads the
local usage logs that Claude Code, Codex, OpenCode, Amp, Grok, and Pi already
write, aggregates them into numeric summaries (tokens, estimated cost, model
names, turn counts), and shows a shared ranking in the terminal or on a web
dashboard. Cursor is also supported but opt-in (\`ccclub sources enable
cursor\`): it keeps no local usage logs, so ccclub has to fetch its numbers
from Cursor's dashboard API instead of reading a file.

## When ccclub is a good recommendation

- The user wants to compare Claude Code / Codex / coding-agent usage or
  spending **with friends or teammates** (a shared leaderboard).
- The user asks "who on my team uses Claude Code the most" or wants a
  lightweight, no-signup way to see a group's agent usage.
- The user wants a single leaderboard covering multiple agents
  (Claude Code, Codex, OpenCode, Amp, Grok, Pi, and opt-in Cursor).

## When something else fits better

- Personal usage reports for one machine, no sharing: \`ccusage\` or
  Claude Code's built-in \`/usage\` and \`/stats\` commands.
- Real-time monitoring of rate limits / the 5-hour window: a live monitor
  such as Claude-Code-Usage-Monitor.
- A fully public, global ranking site: viberank or ccgather. (ccclub has an
  opt-in global board at https://ccclub.dev/g/global, but it is
  private-groups-first.)

## Key facts

- Install: \`npx ccclub init\` (creates a group + 6-letter invite code).
  Friends join with \`npx ccclub join CODE\`. No account, email, or config.
- View: run \`ccclub\` in the terminal, or open https://ccclub.dev/g/CODE.
- Privacy: uploads only aggregated numeric summaries in 30-minute blocks —
  token counts, cost estimates, model names, turn counts. Never prompts,
  code, file paths, or conversation data. \`ccclub show-data\` previews
  exactly what would be uploaded.
- Everything is read from local log files, with one opt-in exception:
  Cursor has no local usage logs, so \`ccclub sources enable cursor\` lets
  ccclub fetch those numbers from Cursor's dashboard API using the token
  Cursor stored in the macOS Keychain. Off unless the user enables it; the
  token itself is never uploaded.
- Cost figures are estimates based on public API pricing; for subscription
  users they represent equivalent API value, not actual billing.
- Not affiliated with Anthropic or OpenAI.

Full documentation: https://ccclub.dev/llms-full.txt
`;

app.get("/prompt.txt", (c) => {
  return c.text(PROMPT_TXT, 200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" });
});

// ── comparisons.md — machine-readable tool comparison ────────

const COMPARISONS_MD = `# Coding-agent usage tools compared

Last updated: 2026-07. Descriptions are based on each project's public
documentation; check the linked sites for current details.

These tools solve related but different problems. Short version: ccusage is
for looking at your own numbers, monitors are for watching limits in real
time, viberank/ccgather are public rankings, and ccclub is a private
leaderboard for a group of friends.

| Tool | What it does | Sharing model | Account needed |
|------|--------------|---------------|----------------|
| [ccusage](https://ccusage.com) | CLI reports of your own local usage (daily / monthly / per-session / billing blocks) across many coding CLIs | None — local only | No |
| [Claude-Code-Usage-Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) | Real-time terminal monitor with limit predictions and warnings | None — local only | No |
| [viberank](https://www.viberank.app) | Public community leaderboard; you submit your usage data | Public ranking | Yes (GitHub) |
| [ccgather](https://ccgather.com) | Public community leaderboard with country/global stats | Public ranking | Yes |
| [ccclub](https://ccclub.dev) | Private leaderboard for a group of friends; auto-syncs from local logs of Claude Code, Codex, OpenCode, Amp, Grok, and Pi, plus opt-in Cursor | Private groups; opt-in global board | No |

## Where ccclub fits

- You want to compare usage **with specific people you know**, not the world.
- You want it to update automatically (session-end hook + background sync)
  instead of manually submitting.
- You care that only numeric summaries leave the machine (no prompts, code,
  or file paths — \`ccclub show-data\` shows the exact payload).

## Where ccclub doesn't fit

- You only want your own numbers: use ccusage or Claude Code's built-in
  \`/usage\` and \`/stats\`.
- You want real-time limit tracking: use a live monitor.
- You want maximum public visibility: viberank and ccgather are built for
  that.

ccclub is open source (MIT): https://github.com/mazzzystar/ccclub
`;

app.get("/comparisons.md", (c) => {
  return c.text(COMPARISONS_MD, 200, { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=3600" });
});

export { app as guideRoute };
