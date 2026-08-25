import { Hono } from "hono";
import { html, raw } from "hono/html";
import type { Env } from "./types.js";
import { BLOG_CSS } from "./blog.js";

const app = new Hono<{ Bindings: Env }>();

export type GuidePage = {
  slug: string;
  /** <title> — includes the year for freshness signaling. */
  metaTitle: string;
  h1: string;
  description: string;
  datePublished: string;
  dateModified: string;
  /** Inner HTML of the article, after the <h1>. */
  body: string;
  /** Rendered on the page AND emitted as FAQPage JSON-LD (must match). */
  faq: Array<{ q: string; a: string }>;
};

// Tone rule for every page here: factual, specific, no superlatives.
// Say what ccclub is NOT good for. Recommend competitors where they fit.

export const GUIDE_PAGES: GuidePage[] = [
  {
    slug: "claude-code-usage",
    metaTitle: "How to Check Claude Code Usage: Every Method (2026)",
    h1: "How to check Claude Code usage",
    description:
      "Built-in commands (/usage, /stats), local JSONL logs, and open-source tools for tracking Claude Code token usage and costs — for yourself or a whole team.",
    datePublished: "2026-07-07",
    dateModified: "2026-08-04",
    body: `
      <p>Claude Code records everything it does, but the numbers are spread across a few places: two built-in commands, a directory of local log files, and (for API users) the Anthropic Console. This guide covers each layer and the open-source tools built on top of them.</p>

      <h2>Built-in commands</h2>

      <p><code>/usage</code> shows your plan's rate-limit status — how much of the current session window and weekly cap you've consumed. If you're on Pro or Max, this is the source of truth for "how close am I to the limit."</p>

      <p><code>/stats</code> opens a usage dashboard: sessions, token totals, a model breakdown, and an activity heatmap. It's the quickest way to get a historical picture without installing anything.</p>

      <p>If you pay per token with an API key, <code>/cost</code> reports what the current session has spent, and the <a href="https://console.anthropic.com" rel="noopener">Anthropic Console</a> has account-level cost history.</p>

      <h2>The local logs everything else builds on</h2>

      <p>Claude Code writes JSONL session logs under <code>~/.claude/projects/</code> (or <code>~/.config/claude/projects/</code>). Each entry includes the model, input/output/cache token counts, and timestamps. No third-party service is involved — every tool below works by reading these files.</p>

      <h2>CLI reports: ccusage</h2>

      <p><a href="https://ccusage.com" rel="noopener">ccusage</a> is the most widely used reporting tool. It reads your local logs and prints daily, monthly, per-session, or 5-hour-block tables, with cost estimated at public API pricing:</p>

      <pre><code>npx ccusage            # daily report
npx ccusage monthly    # monthly totals
npx ccusage blocks     # 5-hour billing windows</code></pre>

      <p>It's local-only: nothing is uploaded anywhere. If all you want is your own numbers, ccusage plus the built-in commands is a complete setup.</p>

      <h2>Real-time limit monitoring</h2>

      <p>For a live view while you work — burn rate, predicted time until you hit the session limit — <a href="https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor" rel="noopener">Claude Code Usage Monitor</a> runs a terminal dashboard with predictions and warnings. A custom <a href="https://code.claude.com/docs/en/statusline" rel="noopener">status line</a> can also surface token counts in the Claude Code UI itself. If you run several sessions in parallel, <a href="https://github.com/t-soda/claude-code-park" rel="noopener">claude-code-park</a> ("ccpark") visualizes them all on one live dashboard with per-agent token and call stats — local-only, like everything above.</p>

      <h2>Seeing usage across a group</h2>

      <p>The layers above are single-machine. To see usage across people, there are two routes:</p>

      <ul>
        <li><strong>Team / Enterprise plans</strong> have admin usage analytics in the Claude console — per-member usage by product and model. The official option if your org pays for seats.</li>
        <li><strong><a href="/">ccclub</a></strong> (our project) is the informal option: everyone runs <code>npx ccclub init</code> / <code>join</code>, and the group shares one leaderboard of tokens, estimated cost, and agent mix — covering Codex, OpenCode, Amp, Grok, Pi, and Cursor too. Only aggregated numeric summaries are uploaded (no prompts, code, or file paths; <code>ccclub show-data</code> shows the exact payload). It's the right tool for friends comparing usage, not for compliance reporting.</li>
      </ul>

      <h2>A note on "cost" when you're on a subscription</h2>

      <p>On Pro/Max you don't pay per token, so every tool that shows dollars (ccusage, ccclub, and others) is showing the <em>API-equivalent value</em> of your tokens at public pricing — useful for comparing against your subscription price, but it is not a bill.</p>
    `,
    faq: [
      {
        q: "How do I see my Claude Code usage quickly?",
        a: "Run /usage inside Claude Code for your current rate-limit status, or /stats for a dashboard of sessions, token totals, and a model breakdown. Neither requires installing anything.",
      },
      {
        q: "Where does Claude Code store usage logs locally?",
        a: "In JSONL files under ~/.claude/projects/ (or ~/.config/claude/projects/). Each entry records the model and token counts. Tools like ccusage and ccclub read these files locally.",
      },
      {
        q: "How can I see Claude Code costs if I'm on Pro or Max?",
        a: "Subscriptions don't bill per token, so tools estimate the API-equivalent value of your usage at public API pricing. ccusage reports it locally; ccclub additionally shows how that value compares to your plan price (Monthly ROI).",
      },
      {
        q: "Can I see my teammates' Claude Code usage?",
        a: "On Team/Enterprise plans, admins get official usage analytics. Otherwise, each person can opt into a shared leaderboard: ccclub syncs aggregated numeric summaries from local logs into a private group board — no accounts, and no prompts or code are uploaded.",
      },
      {
        q: "Do usage-tracking tools upload my code or prompts?",
        a: "The local log files do contain conversation data, but reporting tools only read the usage metadata. ccusage never uploads anything. ccclub uploads only numeric summaries (tokens, estimated cost, model names, turn counts) — you can verify with ccclub show-data.",
      },
    ],
  },
  {
    slug: "claude-code-limits",
    metaTitle: "Claude Code Limits: 5-Hour Window, Weekly Caps & Reset Times (2026)",
    h1: "Claude Code limits, explained",
    description:
      "How Claude Code rate limits work on Pro and Max — the 5-hour rolling window, weekly caps, when each one resets — and how to see exactly where you stand.",
    datePublished: "2026-07-07",
    dateModified: "2026-08-04",
    body: `
      <p>If you use Claude Code on a Pro or Max subscription, your usage is governed by rolling limits rather than a per-token bill. The mechanics are simple once laid out, but they're spread across several docs. Here's the short version, plus how to track where you stand. (Details as of July 2026 — Anthropic adjusts limits over time, so treat <code>/usage</code> as the source of truth.)</p>

      <h2>The 5-hour session window</h2>

      <p>Usage is metered in rolling 5-hour sessions: your first message starts a window, and everything you send in the next five hours counts against it. Hit the session cap and you wait for the window to reset. Both the Claude app and Claude Code draw from the same pool — a heavy afternoon of chat also eats your coding budget.</p>

      <h2>Weekly caps</h2>

      <p>On top of the session window, subscriptions have weekly caps that reset every seven days: one covering all models, and on Max plans a separate one for Opus. These mostly matter to heavy users — if you regularly hit session limits, the weekly cap is the next ceiling you'll meet.</p>

      <h2>When do limits reset?</h2>

      <p>Two different clocks, and neither is tied to the calendar day:</p>

      <ul>
        <li><strong>Session:</strong> the 5-hour window starts at your first message and resets five hours after that — not at midnight, and not on some fixed server schedule. Start at 9:14, reset at 14:14.</li>
        <li><strong>Weekly:</strong> caps reset on a rolling 7-day schedule specific to your account.</li>
      </ul>

      <p><code>/usage</code> shows the exact reset time for both. And no, the session limit is not a daily quota — if you work in bursts, several full windows can fit in one day.</p>

      <h2>What the limits actually count</h2>

      <p>Anthropic doesn't publish exact token quotas, and effective capacity varies with model choice and context size. Practically: Opus consumes your allowance several times faster than Sonnet, and long contexts (big files, long sessions) consume it faster than short ones.</p>

      <h2>How to see where you stand</h2>

      <ul>
        <li><code>/usage</code> in Claude Code — live session and weekly percentages. The authoritative number.</li>
        <li>A <a href="https://code.claude.com/docs/en/statusline" rel="noopener">custom status line</a> can show rate-limit state persistently while you work.</li>
        <li><a href="https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor" rel="noopener">Claude Code Usage Monitor</a> predicts when you'll hit the limit at your current burn rate.</li>
        <li><code>npx ccusage blocks</code> groups your local usage into the same 5-hour windows the limit uses, so you can see your historical pattern.</li>
      </ul>

      <h2>Stretching a limited budget</h2>

      <ul>
        <li><strong>Match the model to the task.</strong> Mechanical edits and simple questions don't need Opus. Model choice is the single biggest lever.</li>
        <li><strong>Keep contexts small.</strong> Start new sessions for new tasks and use <code>/compact</code> — resending a huge conversation with every turn is what drains windows fastest.</li>
        <li><strong>Batch related questions</strong> instead of many small turns; each turn re-sends context.</li>
        <li><strong>API key as overflow.</strong> If you hit a wall mid-task, switching to pay-per-token API billing for the remainder is often cheaper than a plan upgrade you rarely need.</li>
        <li><strong>Extra usage.</strong> Some plans can opt into extra usage that bills overflow at standard API rates once a cap is hit — see <code>/extra-usage</code> in Claude Code or your plan settings.</li>
      </ul>

      <h2>Tracking usage over time</h2>

      <p>Limits are about the next five hours; habits show up over weeks. <code>/stats</code> gives you a personal dashboard, <a href="https://ccusage.com" rel="noopener">ccusage</a> gives you local reports, and if you're curious how your usage compares with friends, <a href="/">ccclub</a> (our project) puts a group on one leaderboard from the same local logs — see <a href="/claude-code-usage">all the ways to check usage</a>.</p>
    `,
    faq: [
      {
        q: "How does the Claude Code 5-hour limit work?",
        a: "Your first message starts a rolling 5-hour session window, and usage within that window counts against a session cap. When you hit it, you wait for the window to reset. Claude app usage and Claude Code usage share the same pool.",
      },
      {
        q: "When does the Claude Code limit reset?",
        a: "The 5-hour session window resets five hours after the first message that started it — not at midnight or on a fixed server time. Weekly caps reset on your account's own 7-day schedule. /usage shows the exact reset time for both.",
      },
      {
        q: "Is the Claude Code session limit daily?",
        a: "No — it's a rolling 5-hour window, not a daily quota. Several full windows can fit in one day if you work in bursts. The longer-horizon ceilings are the weekly caps, which reset every seven days.",
      },
      {
        q: "How many tokens do you get per 5-hour window?",
        a: "Anthropic doesn't publish fixed token quotas, and effective capacity shifts with model choice and context size — Opus drains the allowance several times faster than Sonnet. The percentages in /usage are the only authoritative measure.",
      },
      {
        q: "How do I check how close I am to my Claude Code limit?",
        a: "Run /usage inside Claude Code — it shows live session and weekly usage. For continuous visibility, use a custom status line or a real-time monitor like Claude Code Usage Monitor.",
      },
      {
        q: "Can I keep working after hitting a limit?",
        a: "Three options: wait for the window to reset (/usage shows when), switch the task to a pay-per-token API key, or use extra usage if your plan offers it (billed at API rates — see /extra-usage). ccusage blocks helps you see the historical pattern so you can plan around resets.",
      },
      {
        q: "Why am I hitting Claude Code limits faster than before?",
        a: "Effective capacity depends on model and context size: Opus drains the allowance several times faster than Sonnet, and long conversations resend context every turn. Anthropic has also adjusted limit levels over time — /usage reflects the current policy.",
      },
      {
        q: "Do Claude Code weekly limits exist on every plan?",
        a: "Pro and Max subscriptions have weekly caps in addition to the 5-hour window; Max plans also have a separate Opus cap. API-key (pay-per-token) usage has rate limits but no subscription-style weekly cap.",
      },
      {
        q: "What's the best way to use less of my limit without working less?",
        a: "Use smaller models for mechanical tasks, keep sessions short and contexts compact (/compact helps), and batch related questions. Model choice and context size dominate everything else.",
      },
    ],
  },
  {
    slug: "codex-usage",
    metaTitle: "Codex Usage: How to Check Limits, Logs and Costs (2026)",
    h1: "How to track Codex usage",
    description:
      "Check Codex usage with /status, find the local session logs in ~/.codex/sessions/, and see the tools that report Codex token usage — including alongside Claude Code.",
    datePublished: "2026-07-07",
    dateModified: "2026-08-04",
    body: `
      <p>OpenAI's Codex CLI gets less usage-tooling attention than Claude Code, but the same layers exist: a built-in status command, local session logs, and open-source tools that read them. (Details as of July 2026.)</p>

      <h2>Built-in: /status</h2>

      <p>Inside Codex, <code>/status</code> shows your account, model, and current rate-limit state — the equivalent of Claude Code's <code>/usage</code>. If you use Codex through a ChatGPT plan, limits are metered in rolling windows plus a weekly allowance, and heavy use can be topped up with pay-as-you-go credits.</p>

      <h2>Local session logs</h2>

      <p>Codex writes JSONL session files under <code>~/.codex/sessions/</code>, including per-turn token counts and the model used. As with Claude Code's <code>~/.claude/projects/</code>, these local files are what usage tools parse — nothing needs a network call.</p>

      <h2>Reports across time: ccusage</h2>

      <p><a href="https://ccusage.com" rel="noopener">ccusage</a> supports Codex alongside Claude Code and other coding CLIs — daily/monthly/per-session tables with costs estimated at public API pricing. Local-only, no uploads.</p>

      <h2>Codex and Claude Code on one board</h2>

      <p>Many developers now run both agents and want one picture of usage — or want to compare with friends who use a different agent. <a href="/">ccclub</a> (our project) reads local logs from Codex, Claude Code, OpenCode, Amp, Grok, Pi, and Cursor, and puts a group on a single leaderboard with each member's agent mix. Set up with <code>npx ccclub init</code>; only numeric summaries are uploaded (no prompts, code, or file paths). If you only want your own numbers, stick with ccusage — see the <a href="/ccusage-vs-ccclub">comparison</a>.</p>

      <h2>A note on Codex "cost"</h2>

      <p>Like Claude subscriptions, ChatGPT plans don't bill per token — dollar figures from usage tools are API-equivalent estimates, useful for comparing across time or against a plan price, not an invoice.</p>
    `,
    faq: [
      {
        q: "How do I check my Codex usage?",
        a: "Run /status inside the Codex CLI for your current rate-limit state. For historical reports, tools like ccusage parse the local session logs in ~/.codex/sessions/.",
      },
      {
        q: "Where does Codex CLI store its logs?",
        a: "JSONL session files under ~/.codex/sessions/, with per-turn token counts and model names. Usage tools read these local files directly.",
      },
      {
        q: "Can I track Codex and Claude Code usage together?",
        a: "Yes. ccusage reports both locally, and ccclub shows both (plus OpenCode, Amp, Grok, Pi, and Cursor) on one shared leaderboard, with each person's agent mix.",
      },
      {
        q: "Does Codex have usage limits on ChatGPT plans?",
        a: "Yes — usage is metered in rolling windows with a weekly allowance that varies by plan, and can be extended with pay-as-you-go credits. /status shows where you stand.",
      },
    ],
  },
  {
    slug: "ccusage-vs-ccclub",
    metaTitle: "ccusage vs ccclub: Which Should You Use? (2026)",
    h1: "ccusage vs ccclub",
    description:
      "ccusage reports your own local usage; ccclub puts a group of friends on one leaderboard. An honest comparison — including when you shouldn't use ccclub.",
    datePublished: "2026-07-07",
    dateModified: "2026-07-07",
    body: `
      <p>Short answer: they solve different problems, and plenty of people use both. <a href="https://ccusage.com" rel="noopener">ccusage</a> answers "what did <em>I</em> use?"; <a href="/">ccclub</a> answers "how does our <em>group</em> compare?". Disclosure up front: ccclub is our project — we'll try to be even-handed anyway.</p>

      <h2>What each tool does</h2>

      <p><strong>ccusage</strong> is a reporting CLI. It reads local coding-agent logs and prints tables — daily, monthly, per-session, or 5-hour billing blocks — with cost estimated at API pricing. It supports a long list of coding CLIs, runs entirely offline, and uploads nothing. It has become the de-facto standard for personal usage reports.</p>

      <p><strong>ccclub</strong> is a shared leaderboard. Everyone in a group runs <code>npx ccclub init</code> or <code>join CODE</code>; after that, usage syncs automatically (a session-end hook for Claude Code, background sync for Codex, OpenCode, Amp, Grok, Pi, and Cursor) and the group sees one ranking — in the terminal via <code>ccclub</code> or on a live web dashboard. It uploads aggregated numeric summaries only: token counts, estimated cost, model names, turn counts, in 30-minute blocks. No prompts, code, or file paths; <code>ccclub show-data</code> prints the exact payload.</p>

      <h2>Side by side</h2>

      <div class="table-scroll">
      <table>
        <thead><tr><th></th><th>ccusage</th><th>ccclub</th></tr></thead>
        <tbody>
          <tr><td>Core question</td><td>What did I use?</td><td>How does our group compare?</td></tr>
          <tr><td>Data leaves your machine</td><td>Never</td><td>Numeric summaries only</td></tr>
          <tr><td>Account required</td><td>No</td><td>No (6-letter invite code)</td></tr>
          <tr><td>Report granularity</td><td>Daily / monthly / session / 5-hour blocks</td><td>Today / yesterday / 7d / 30d / all-time</td></tr>
          <tr><td>Web dashboard</td><td>No (terminal tables)</td><td>Yes, live per group</td></tr>
          <tr><td>Auto-sync</td><td>n/a (run on demand)</td><td>Yes (hook + background)</td></tr>
          <tr><td>Agent coverage</td><td>Very broad (15+ CLIs)</td><td>Claude Code, Codex, OpenCode, Amp, Grok, Pi, Cursor</td></tr>
          <tr><td>License</td><td>MIT</td><td>MIT</td></tr>
        </tbody>
      </table>
      </div>

      <h2>Pick ccusage if…</h2>
      <ul>
        <li>You want reports for yourself and nobody else needs to see them.</li>
        <li>You need coverage for an agent ccclub doesn't support yet.</li>
        <li>You want fine-grained analysis (per-project, per-session, billing blocks).</li>
      </ul>

      <h2>Pick ccclub if…</h2>
      <ul>
        <li>You and friends or teammates want one leaderboard that stays current without anyone manually running reports.</li>
        <li>You want a shareable live dashboard (each group gets <code>ccclub.dev/g/CODE</code>).</li>
        <li>You're curious how your usage ranks more broadly — there's an opt-in <a href="/g/global">global board</a>.</li>
      </ul>

      <h2>Or use both</h2>

      <p>They read the same local logs and don't conflict. A common setup: ccusage for detailed personal analysis, ccclub for the group scoreboard. If you're deciding among leaderboard tools specifically, see the <a href="/claude-code-leaderboards">leaderboard comparison</a>.</p>
    `,
    faq: [
      {
        q: "Is ccclub a replacement for ccusage?",
        a: "No. ccusage is a local reporting tool for your own usage; ccclub is a shared leaderboard for a group. They read the same local logs and many people use both.",
      },
      {
        q: "Does ccclub upload more data than ccusage?",
        a: "ccusage uploads nothing. ccclub uploads aggregated numeric summaries (tokens, estimated cost, model names, turn counts in 30-minute blocks) so the group board can update — never prompts, code, or file paths. Run ccclub show-data to see the exact payload.",
      },
      {
        q: "Which supports more coding agents?",
        a: "ccusage covers more CLIs overall. ccclub currently supports Claude Code, Codex, OpenCode, Amp, Grok, Pi, and Cursor — the ones it can sync into a shared leaderboard.",
      },
      {
        q: "Can I use ccclub just for myself?",
        a: "Yes — a group of one works, and the all-time view makes it a simple personal history. But if you never want a shared board, ccusage alone is the simpler tool.",
      },
    ],
  },
  {
    slug: "claude-code-leaderboards",
    metaTitle: "Claude Code Leaderboards Compared: viberank, ccgather, ccclub (2026)",
    h1: "Claude Code leaderboards, compared",
    description:
      "viberank, ccgather, tokenleaders, and ccclub take different approaches to ranking coding-agent usage. What each does, and how to pick. (We build ccclub.)",
    datePublished: "2026-07-07",
    dateModified: "2026-08-04",
    body: `
      <p>Ranking Claude Code usage has become a small genre of its own. The tools differ mainly on two axes: <strong>who sees the board</strong> (the public, or just your group) and <strong>how data gets there</strong> (manual submission, or automatic sync). Disclosure: <a href="/">ccclub</a> is our project; descriptions of the others are based on their public docs as of July 2026.</p>

      <h2>The options</h2>

      <p><strong><a href="https://www.viberank.app" rel="noopener">viberank</a></strong> — a public community leaderboard. You sign in with GitHub and submit your usage (generated via ccusage); rankings by cost and tokens. Good if you want your numbers visible in a global community.</p>

      <p><strong><a href="https://ccgather.com" rel="noopener">ccgather</a></strong> — an open-source public leaderboard and community. You sync usage with its CLI (<code>npx ccgather</code>) and get global and country-level rankings, levels and badges, an activity heatmap, and an AI-translated community feed. The most community-oriented of the group.</p>

      <p><strong><a href="https://tokenleaders.fun" rel="noopener">tokenleaders</a></strong> — a lightweight public Claude usage ranking; simple and fun rather than feature-heavy.</p>

      <p>Other public boards in the same vein: <a href="https://clawd.gg" rel="noopener">clawd.gg</a> (ranks prompts, tokens, and lines of code) and <a href="https://ccleaderboard.com" rel="noopener">CCLeaderboard</a> (CLI submission, daily and all-time rankings).</p>

      <p><strong>ccclub</strong> — private-first. You create a group with <code>npx ccclub init</code>, friends join with a 6-letter code, and the board updates automatically from local logs (Claude Code session-end hook; background sync for Codex, OpenCode, Amp, Grok, Pi, Cursor). No accounts. Each group gets a live web dashboard, and there's an opt-in <a href="/g/global">global board</a> if you do want a public ranking. Only numeric summaries are uploaded — no prompts, code, or file paths.</p>

      <h2>Side by side</h2>

      <div class="table-scroll">
      <table>
        <thead><tr><th></th><th>viberank</th><th>ccgather</th><th>tokenleaders</th><th>ccclub</th></tr></thead>
        <tbody>
          <tr><td>Audience</td><td>Public</td><td>Public</td><td>Public</td><td>Private group (opt-in global)</td></tr>
          <tr><td>Account</td><td>GitHub</td><td>Sign-up</td><td>Varies</td><td>None</td></tr>
          <tr><td>Data flow</td><td>Manual submission</td><td>Submission/sync</td><td>Submission</td><td>Automatic sync</td></tr>
          <tr><td>Agents beyond Claude Code</td><td>Some</td><td>Claude-focused</td><td>Claude-focused</td><td>Codex, OpenCode, Amp, Grok, Pi, Cursor</td></tr>
          <tr><td>Web dashboard per group</td><td>—</td><td>—</td><td>—</td><td>Yes</td></tr>
        </tbody>
      </table>
      </div>

      <h2>How to choose</h2>

      <ul>
        <li><strong>Want the world to see your rank?</strong> viberank or ccgather — that's exactly what they're for.</li>
        <li><strong>Want a board for people you actually know?</strong> ccclub — private groups with auto-sync were the design goal.</li>
        <li><strong>Don't want a leaderboard at all?</strong> You may just want usage reports — see <a href="/claude-code-usage">how to check Claude Code usage</a> or <a href="https://ccusage.com" rel="noopener">ccusage</a>.</li>
      </ul>

      <p>A fair caveat that applies to all of these, ours included: token count measures activity, not productivity. Leaderboards are for curiosity and fun — treat them that way.</p>
    `,
    faq: [
      {
        q: "What's the difference between viberank and ccclub?",
        a: "viberank is a public community leaderboard you submit usage to (GitHub sign-in, data via ccusage). ccclub is private-first: a group of friends with an invite code, automatic sync from local logs, no accounts, plus an opt-in global board.",
      },
      {
        q: "Do these leaderboards see my code or prompts?",
        a: "They rank usage metadata, not content. ccclub uploads only numeric summaries (tokens, estimated cost, model names, turn counts) — verifiable with ccclub show-data. For other tools, check their docs for what a submission includes.",
      },
      {
        q: "Which leaderboard supports agents other than Claude Code?",
        a: "ccclub tracks Claude Code, Codex, OpenCode, Amp, Grok, Pi, and Cursor on one board and shows each member's agent mix. Most other leaderboards are Claude-focused.",
      },
      {
        q: "Is a token leaderboard a good measure of productivity?",
        a: "No — it measures activity and spend, not output quality. These tools (ccclub included) are best treated as curiosity and friendly competition, not performance metrics.",
      },
    ],
  },
];

export function getGuide(slug: string): GuidePage | undefined {
  return GUIDE_PAGES.find((g) => g.slug === slug);
}

// ── Routes ───────────────────────────────────────────────────

app.get("/guides", (c) => c.html(guidesIndexHTML()));

for (const page of GUIDE_PAGES) {
  app.get(`/${page.slug}`, (c) => c.html(guideHTML(page)));
}

// ── Rendering ────────────────────────────────────────────────

const GUIDE_EXTRA_CSS = `
    .breadcrumb { color: var(--faint); font-size: 13px; padding-top: 32px; }
    .breadcrumb a { color: var(--muted); }
    .faq h2 { margin-top: 48px; }
    .faq h3 { font-size: 16px; font-weight: 600; color: var(--title); margin: 24px 0 8px; }
    .updated { color: var(--faint); font-size: 13px; margin-top: 40px; }
`;

function headCommon(opts: { title: string; description: string; canonical: string }) {
  return html`
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${opts.title}</title>
  <meta name="description" content="${opts.description}" />
  <meta name="theme-color" content="#1a1816" />
  <link rel="canonical" href="${opts.canonical}" />
  <link rel="alternate" type="application/rss+xml" title="ccclub blog" href="https://ccclub.dev/rss.xml" />
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏆</text></svg>" />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="${opts.canonical}" />
  <meta property="og:site_name" content="ccclub" />
  <meta property="og:title" content="${opts.title}" />
  <meta property="og:description" content="${opts.description}" />
  <meta property="og:image" content="https://ccclub.dev/og.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${opts.title}" />
  <meta name="twitter:description" content="${opts.description}" />
  <meta name="twitter:image" content="https://ccclub.dev/og.png" />

  <script async src="https://www.googletagmanager.com/gtag/js?id=G-RG2RD9V66M"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-RG2RD9V66M');
  </script>
`;
}

const BRAND = html`
    <a href="/" class="brand">
      <img src="https://raw.githubusercontent.com/mazzzystar/ccclub/main/assets/icon.png" alt="ccclub" width="28" height="28" />
      <span>ccclub</span>
    </a>
`;

const FOOTER = html`
    <div class="footer">
      <a href="/">← Home</a>
      &nbsp;·&nbsp;
      <a href="/guides">Guides</a>
      &nbsp;·&nbsp;
      <a href="/blog">Blog</a>
      &nbsp;·&nbsp;
      <a href="https://github.com/mazzzystar/ccclub">GitHub</a>
      &nbsp;·&nbsp;
      <a href="https://discord.gg/6QbGWJUVHq">Discord</a>
    </div>
`;

function guideJsonLd(page: GuidePage): string {
  const url = `https://ccclub.dev/${page.slug}`;
  const article = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: page.h1,
    description: page.description,
    url,
    datePublished: page.datePublished,
    dateModified: page.dateModified,
    author: { "@type": "Person", name: "Ke Fang", url: "https://github.com/mazzzystar" },
    publisher: { "@type": "Organization", name: "ccclub", url: "https://ccclub.dev" },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
  };
  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: page.faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "ccclub", item: "https://ccclub.dev/" },
      { "@type": "ListItem", position: 2, name: "Guides", item: "https://ccclub.dev/guides" },
      { "@type": "ListItem", position: 3, name: page.h1, item: url },
    ],
  };
  return [article, faq, breadcrumb]
    .map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`)
    .join("\n  ");
}

function guideHTML(page: GuidePage) {
  const url = `https://ccclub.dev/${page.slug}`;
  const others = GUIDE_PAGES.filter((g) => g.slug !== page.slug);
  return html`<!DOCTYPE html>
<html lang="en">
<head>
  ${headCommon({ title: page.metaTitle, description: page.description, canonical: url })}
  ${raw(guideJsonLd(page))}
  <style>${raw(BLOG_CSS + GUIDE_EXTRA_CSS)}</style>
</head>
<body>
  <div class="wrap">
    ${BRAND}
    <div class="breadcrumb"><a href="/">Home</a> › <a href="/guides">Guides</a></div>

    <article class="post">
      <h1>${page.h1}</h1>
      ${raw(page.body)}

      <div class="faq">
        <h2>FAQ</h2>
        ${page.faq.map((f) => html`<h3>${f.q}</h3><p>${f.a}</p>`)}
      </div>

      <p class="updated">Last updated ${page.dateModified}. Corrections welcome on <a href="https://github.com/mazzzystar/ccclub">GitHub</a>.</p>

      <div class="related">
        <h2>More guides</h2>
        <ul>
          ${others.map((g) => html`<li><a href="/${g.slug}">${g.h1}</a></li>`)}
          <li><a href="/g/global">Global leaderboard</a></li>
        </ul>
      </div>
    </article>

    ${FOOTER}
  </div>
</body>
</html>`;
}

function guidesIndexHTML() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "ccclub guides",
    url: "https://ccclub.dev/guides",
    itemListElement: GUIDE_PAGES.map((g, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: g.h1,
      url: `https://ccclub.dev/${g.slug}`,
    })),
  };
  return html`<!DOCTYPE html>
<html lang="en">
<head>
  ${headCommon({
    title: "Guides — Claude Code & Codex usage, limits, and tools",
    description:
      "Practical guides to tracking coding-agent usage: Claude Code /usage and limits, Codex logs, and honest comparisons of ccusage, viberank, and ccclub.",
    canonical: "https://ccclub.dev/guides",
  })}
  <script type="application/ld+json">${raw(JSON.stringify(jsonLd))}</script>
  <style>${raw(BLOG_CSS + GUIDE_EXTRA_CSS)}</style>
</head>
<body>
  <div class="wrap">
    ${BRAND}
    <div class="post-list">
      <h1>Guides</h1>
      <p class="intro">Practical notes on tracking coding-agent usage — no fluff, dated, kept current.</p>
      ${GUIDE_PAGES.map(
        (g) => html`
      <div class="post-item">
        <h2><a href="/${g.slug}">${g.h1}</a></h2>
        <p>${g.description}</p>
      </div>`,
      )}
    </div>
    ${FOOTER}
  </div>
</body>
</html>`;
}

export { app as guidesRoute };
