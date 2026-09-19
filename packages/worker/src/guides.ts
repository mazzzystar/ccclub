import { Hono } from "hono";
import { html, raw } from "hono/html";
import type { Env } from "./types.js";
import { BLOG_CSS } from "./blog.js";
import { cacheStaticHTML } from "./edge-cache.js";

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
    metaTitle: "Claude Code Usage: Tokens, Cost and Cache Explained",
    h1: "Claude Code usage, explained",
    description:
      "What a Claude Code usage number counts — input, output and cache tokens — why cache dominates the total, and how to read it per day, week or agent.",
    datePublished: "2026-07-07",
    dateModified: "2026-09-19",
    body: `
      <p>Usage is one word for at least four different numbers: how many tokens a session moved, how many of those were cache, what those tokens would have cost at list price, and how many times you actually pressed Enter. Two honest trackers can report totals an order of magnitude apart for the same week simply because they headline different columns. This page takes the numbers apart — what each one counts, which are measured and which are estimated, and where to look for a per-day, per-week or per-agent view. For the shortest route to a figure on your own machine, see the <a href="/how-to-check-claude-code-usage">step-by-step walkthrough</a>.</p>

      <h2>The four counters behind every total</h2>

      <p>Each assistant response Claude Code appends to its transcript carries a usage record, and ccclub's collector lifts four fields out of it: input tokens, output tokens, cache-creation tokens, and cache-read tokens — plus the subset of cache writes made with a one-hour lifetime, where the record reports one. Those columns are stored exactly as found and then summed; every token figure ccclub displays anywhere is a sum of them and nothing else. A fifth counter, reasoning tokens, exists for agents that report thinking separately. Claude Code's records do not, so for Claude Code that column is always zero.</p>

      <p>The buckets behave nothing alike. Output tokens are the model writing. Input tokens are the genuinely new part of a request. The two cache counters are your conversation being re-sent: written once, then read back on every turn that follows. Past the first few exchanges of a session, they are most of the traffic.</p>

      <h2>Why cache tokens dominate Claude Code token usage</h2>

      <p>A coding agent re-sends its whole working context on each turn — instructions, file contents, tool results, the transcript so far. Prompt caching means that bulk is charged at a fraction of the input rate rather than the full one, but it is still counted, and it is counted again every turn. A total-tokens headline therefore grows with the length of the session squared, while the part you would recognise as your own typing barely moves at all.</p>

      <p>That is why ccclub keeps two token views instead of one. The default total includes cache; <code>ccclub --no-cache</code> in the terminal, and the <em>Include cache</em> switch on a group's dashboard, drop to input plus output. Neither is the honest one and the other a fiction — those cached tokens really were sent. They answer different questions. The cache-inclusive total tracks what a bill would reflect; the non-cache total tracks how much distinct material actually passed through the model, which is the fairer comparison between someone running one long session and someone running twenty short ones.</p>

      <h2>Tokens, cost and turns measure different things</h2>

      <p>A ccclub leaderboard row carries all three on purpose. Tokens measure volume. Cost converts that volume to dollars at public list prices, which makes it an estimate rather than a statement of what anyone was charged — <a href="/claude-code-cost">how that figure is built</a> is its own subject. Turns count the messages a person typed: ccclub counts human turns inside each 30-minute block, not the model's replies and not its tool calls, which is why a row can show millions of tokens against a dozen turns. The column that divides the first by the third — <code>$/Turn</code> in the CLI, <em>Avg Turn</em> on the web dashboard — is the closest thing on the board to a measure of how expensive one unit of intent has become.</p>

      <h2>A usage dashboard for today, 7 days, 30 days or all time</h2>

      <p>Everything in ccclub is scoped to a period. Bare <code>ccclub</code> prints today; <code>ccclub -d 1</code> is yesterday, <code>-d 7</code> the last seven days, <code>-d 30</code> the last thirty, and <code>-d all</code> everything that has ever been synced. The same five periods appear as a selector on each group's web page at <code>ccclub.dev/g/CODE</code>, next to an activity chart. Boundaries follow your machine's timezone, which the CLI sends with the request, so "today" means your today rather than UTC's.</p>

      <p>For a longer horizon there is <code>ccclub activity</code>: a GitHub-style heatmap of the last 53 weeks, computed entirely from local logs. It makes no network call, so it works before you have joined any group and keeps working offline.</p>

      <h2>A per-agent breakdown when you run more than one</h2>

      <p>Most people tracking this now have more than one agent installed. ccclub reads Claude Code, Codex, OpenCode, Amp, Grok and Pi from their local logs by default, and Cursor through an explicit opt-in, because Cursor writes no local usage files at all. Each usage block is tagged with the agent that produced it, so the board can show an Agents column with each member's mix and a split of who is currently active in which tool. That tagging is also what makes <code>ccclub --no-cache</code> behave correctly across agents: the non-cache figure follows each source's own output and reasoning conventions instead of assuming everyone reports tokens the way Claude Code does.</p>

      <h2>What Claude Code reports about itself</h2>

      <p><code>/usage</code> inside Claude Code is the first-party view, and Anthropic's command reference lists <code>/cost</code> and <code>/stats</code> as aliases that open the very same screen, described there as session cost, plan usage limits and activity stats. (<a href="https://code.claude.com/docs/en/commands" rel="noopener">code.claude.com/docs/en/commands</a>, read 2026-09-19.) Paid plans get one thing more: recent consumption attributed to skills, subagents, plugins and individual MCP servers. That answers a question none of the columns discussed here do — not how much, but which part of your setup is responsible for it.</p>

      <p>Two qualifications, both from the cost documentation rather than the command reference. It calls its figures approximate rather than exact. And the breakdown is derived locally, from the transcripts on one computer, so a second machine or anything done in the Claude app is simply outside its field of view. (<a href="https://code.claude.com/docs/en/costs" rel="noopener">code.claude.com/docs/en/costs</a>, read 2026-09-19.)</p>

      <h2>Where the raw records live</h2>

      <p>Claude Code keeps one JSONL transcript per session under <code>~/.claude/projects/</code>, one directory per project, as its own file-layout reference sets out. Those files hold the entire conversation — that is the point of them — which is why local reporting tools parse the usage fields and leave the message bodies untouched. ccclub aggregates its four counters into 30-minute blocks before anything is uploaded, together with model names, the cost estimate, and call and turn counts. <code>ccclub show-data</code> prints that payload on your screen before it is sent anywhere, and is the honest way to check the claim rather than take it.</p>

      <h2>Comparing your usage with other people's</h2>

      <p>A single-machine figure tells you how much, never whether that is a lot. The official answer for organisations is the admin analytics that come with Team and Enterprise seats. The informal answer is a shared board: everyone runs <code>npx ccclub init</code> or <code>join</code>, and the group sees one ranking of tokens, estimated cost and agent mix, updated without anyone exporting anything. It is built for curiosity among people who know each other, not for reporting — token counts measure activity and spend, and nothing about whether the work was any good.</p>
    `,
    faq: [
      {
        q: "How do I see my Claude Code usage quickly?",
        a: "Run /usage inside Claude Code. The documentation lists /cost and /stats as aliases reaching the very same screen, which carries a cost figure for the current session, bars for your plan allowances, and activity statistics. On a paid plan it also attributes recent consumption to skills, subagents and MCP servers.",
      },
      {
        q: "Where does Claude Code store usage logs locally?",
        a: "In JSONL session transcripts under ~/.claude/projects/, one directory per project. Each assistant response carries its model and token counts, which is what tools like ccusage and ccclub read — they never need the message text.",
      },
      {
        q: "Why is my total token count so much larger than what I typed?",
        a: "Because cache tokens are counted too. A coding agent re-sends its working context every turn, so cache reads and writes accumulate with the length of the session and quickly dwarf your own input. Use ccclub --no-cache, or the Include cache switch on the dashboard, to see input plus output only.",
      },
      {
        q: "How can I see Claude Code costs if I'm on Pro or Max?",
        a: "Subscriptions don't bill per token, so every tool showing dollars is estimating the API-equivalent value of your tokens at public pricing. ccusage reports it locally; ccclub additionally shows how that value compares with your plan price as a Monthly ROI column.",
      },
      {
        q: "Can I see my teammates' Claude Code usage?",
        a: "Team and Enterprise plans include official admin usage analytics. Failing that, each person can opt into a shared board: ccclub syncs aggregated numeric summaries from local logs into a group leaderboard, with no accounts and no upload of prompts or code.",
      },
      {
        q: "Do usage-tracking tools upload my code or prompts?",
        a: "The local transcripts do contain conversation data, but reporting tools read only the usage metadata beside it. ccusage documents no upload of your usage at all. ccclub sends numeric summaries — tokens, estimated cost, model names, turn counts — and ccclub show-data prints exactly that payload first.",
      },
    ],
  },
  {
    slug: "how-to-check-claude-code-usage",
    metaTitle: "How to Check Claude Code Usage: A Step-by-Step Guide",
    h1: "How to check Claude Code usage",
    description:
      "Check Claude Code usage in order: the built-in /usage screen, the local transcripts, then ccclub for a dated history — and how to read what you get.",
    datePublished: "2026-09-19",
    dateModified: "2026-09-19",
    body: `
      <p>There is no single place that holds all of it, which is why this question keeps getting asked. What exists is a short ladder: one command that answers it for right now, a directory of files that answers it for the past, and a tool on top of those files if you want the past arranged by day. Work down the ladder and stop at the rung that answers your question — most people never need the bottom one.</p>

      <h2>Step 1: ask Claude Code, in the session</h2>

      <p>Type <code>/usage</code> at the prompt. Anthropic's command reference describes what comes back as session cost, plan usage limits and activity stats, and lists <code>/cost</code> and <code>/stats</code> as aliases that open the same screen — worth knowing, because plenty of older write-ups still present them as three separate features. (<a href="https://code.claude.com/docs/en/commands" rel="noopener">code.claude.com/docs/en/commands</a>, read 2026-09-19.) On a Pro, Max, Team or Enterprise plan the screen also breaks down what has been driving your limits recently, and <kbd>d</kbd> and <kbd>w</kbd> toggle that breakdown between the last 24 hours and the last 7 days.</p>

      <p>Two things the cost documentation is explicit about, and that change how much weight to put on the answer: the figures are approximate, and they come from the session history stored on the machine you are sitting at. A second laptop, a work desktop, or anything done on claude.ai is not in them. (<a href="https://code.claude.com/docs/en/costs" rel="noopener">code.claude.com/docs/en/costs</a>, read 2026-09-19.)</p>

      <h2>Step 2: get a written report out of it</h2>

      <p>If you want something to read rather than a screen to squint at, the same documentation describes <code>/insights</code>: it analyses recent sessions on that machine and writes an HTML report to <code>~/.claude/usage-data/report.html</code>, keeping a timestamped copy of each run. Note what it is and is not — the documentation calls it a report on how you work rather than how many tokens you have used, covering what you work on, friction points such as misunderstood requests or buggy code, and suggestions for using Claude Code more effectively. It also costs tokens to produce, since the analysis runs through your own account.</p>

      <p>For a number that is in front of you permanently instead of on demand, Claude Code passes its status line script a <code>rate_limits</code> object with your five-hour and seven-day percentages, for subscription accounts, after the first API response of a session. Writing that script is a small job, and <a href="/claude-code-statusline">ccclub ships one</a> if you would rather not.</p>

      <h2>Step 3: know where the raw data is</h2>

      <p>Everything past this point reads the same source: the JSONL transcripts Claude Code writes under <code>~/.claude/projects/</code>, one directory per project and one file per session. Every assistant response in those files carries the model it used and its token counts. You can grep them yourself; it is not pleasant, but it means no tool below needs any access you have not already granted it, and it means you can verify any claim any of them makes.</p>

      <p>If you have set <code>CLAUDE_CONFIG_DIR</code>, or your install uses <code>~/.config/claude/projects</code>, that is where to look instead. Tools that read these files check both locations.</p>

      <h2>Step 4: turn the files into a dated history</h2>

      <p>The transcripts have no notion of "last week". Something has to sum them. For your own numbers only, ccusage is the established choice and uploads nothing. For a history that also compares against other people, this is ccclub, and setup is one command:</p>

      <pre><code>npx ccclub init</code></pre>

      <p>That asks for a display name, creates a group with a six-letter invite code, detects which agents you have logs for, and installs the automatic sync. No account, no email, no configuration file to edit. Once it has run:</p>

      <pre><code>ccclub                 # today
ccclub -d 1            # yesterday
ccclub -d 7            # last 7 days
ccclub -d 30           # last 30 days
ccclub -d all          # everything synced
ccclub --json          # the same data as JSON, for scripts and agents</code></pre>

      <p>The same periods are on the web page every group gets at <code>ccclub.dev/g/CODE</code>. For the shape of your year rather than a table, <code>ccclub activity</code> draws a heatmap of the last 53 weeks straight from local logs, with no network call at all.</p>

      <h2>Step 5: check what leaves the machine, before it does</h2>

      <p>Anything that compares you with other people has to send something. Run <code>ccclub show-data</code> and it prints the last five 30-minute blocks in full, field by field: token counts, the estimated cost, model names, call and turn counts, under a heading saying that is exactly what gets uploaded. Those five are a sample, not the payload — what follows them is a set of all-time totals. But the sample is the point: every other block carries the same fields, and nothing else is uploaded either. No prompts, no code, no file paths, no project names. Reading that output takes a minute and is a better basis for trusting the tool than any sentence on this page.</p>

      <h2>Step 6: read the number you got</h2>

      <p>Three things trip people up at the end of this, and all three are about interpretation rather than measurement.</p>

      <ul>
        <li><strong>The big total is mostly cache.</strong> Cache reads and writes are counted alongside input and output, and on long sessions they dominate everything else. <code>ccclub --no-cache</code> drops to input plus output; the two numbers will not be close, and neither is wrong. Why that gap exists is covered in <a href="/claude-code-usage">what a usage number counts</a>.</li>
        <li><strong>The dollar figure is not a bill.</strong> On a subscription nothing is charged per token, so every tool showing dollars is pricing your tokens at public API list rates. It is a useful unit for comparison and a bad one for accounting — see <a href="/claude-code-cost">how the estimate is built</a>.</li>
        <li><strong>One machine is one machine.</strong> Both the built-in screen and any local tool see the logs in front of them. If you use Claude Code on two computers, you have two partial answers, and only syncing them somewhere gives you one.</li>
      </ul>

      <p>And the ceiling question is a different question. If what you actually want to know is how much of your allowance is left rather than how much you have used, that lives in <a href="/claude-code-limits">the rate-limit windows</a>, not in any of the totals above.</p>
    `,
    faq: [
      {
        q: "What is the fastest way to check Claude Code usage?",
        a: "Type /usage at the Claude Code prompt. Its documentation describes the screen as session cost, plan usage limits and activity stats, with /cost and /stats as aliases for the same thing. Nothing needs to be installed and it answers the question for the current machine immediately.",
      },
      {
        q: "How do I check Claude Code usage for last week or last month?",
        a: "The built-in screen covers the recent window, not arbitrary ranges. For dated history, a tool has to sum the local transcripts: ccusage prints daily and monthly tables locally, and ccclub gives you ccclub -d 7, -d 30 and -d all plus the same periods on a web page.",
      },
      {
        q: "Can I check Claude Code usage without installing anything?",
        a: "Yes — /usage covers the current machine and current window, and the raw transcripts under ~/.claude/projects/ are readable with any tool you already have. You only need something installed when you want those files summed into days, weeks or a comparison.",
      },
      {
        q: "Does checking usage this way share my data with anyone?",
        a: "Reading /usage and reading your own transcripts share nothing. ccusage documents no upload of your usage. ccclub does upload, because a shared board needs it, but only aggregated numeric blocks — run ccclub show-data to see the exact payload before deciding.",
      },
      {
        q: "Why do two tools give me different Claude Code usage totals?",
        a: "Almost always because one includes cache tokens in its headline and the other does not, or because one prices tokens at list rates the other does not use. Compare like for like: check whether cache is included, and whether the dollar figure is an estimate or a real charge.",
      },
    ],
  },
  {
    slug: "claude-code-limits",
    metaTitle: "Claude Code Limits: 5-Hour Window, Weekly Caps & Reset Times",
    h1: "Claude Code limits, explained",
    description:
      "How Claude Code rate limits work on Pro and Max — the 5-hour rolling window, weekly caps, when each one resets — and how to see exactly where you stand.",
    datePublished: "2026-07-07",
    dateModified: "2026-09-19",
    body: `
      <p>On a subscription, Claude Code meters you with rolling allowances rather than a per-token bill, and there is more than one of them running at once. The mechanics are simple once laid side by side; what confuses people is that three separate ceilings can each stop a request, for different reasons, with different ways out. Everything below about Anthropic's behaviour is read from its own documentation, cited where it matters and checked on 2026-09-19 — limits change, and <code>/usage</code> is always the authority for your account.</p>

      <h2>The rolling 5-hour session window</h2>

      <p>The shortest ceiling is a session window, and Claude Code's status-line documentation is where its shape is written down: a rolling five-hour window, exposed to a status line as <code>rate_limits.five_hour</code> with a used percentage from 0 to 100 and a <code>resets_at</code> timestamp in epoch seconds. Rolling is the word that matters — it is not a daily quota, it has no calendar boundary, and several complete windows can pass inside one working day. Where yours ends is what <code>resets_at</code> reports, and what <code>/usage</code> shows as a reset time. (<a href="https://code.claude.com/docs/en/statusline" rel="noopener">code.claude.com/docs/en/statusline</a>, read 2026-09-19.)</p>

      <h2>The weekly window on top of it</h2>

      <p>Behind the session window sits a seven-day one, exposed in the same payload as <code>rate_limits.seven_day</code>. The two are consumed simultaneously, not in sequence, and Anthropic's error reference is direct about the consequence: a single burst of heavy activity — a large workflow fanout, say — can exhaust the weekly allowance before the session window has even reset. That is the case where waiting five hours does nothing for you, and it surprises people who have only ever met the shorter limit.</p>

      <p>Both of these are shared across models. Switching from one model to another does not restore access to either, because neither is scoped to a model in the first place.</p>

      <h2>The per-model weekly limit</h2>

      <p>The third ceiling is scoped. Anthropic's usage API reports it as a weekly limit attached to a particular model family, labelled with that model's display name, and the corresponding error messages name the family directly — the documented examples are "You've hit your Opus limit" and "You've hit your Sonnet limit". Unlike the session and weekly windows, this one has an escape hatch that costs nothing: switching to a model outside that family with <code>/model</code> keeps you working. The documentation notes the price of doing so, which is that each model keeps its own prompt cache, so the first request after the switch re-reads the whole conversation with no cache hits.</p>

      <p>Because the label comes from the API rather than from a hard-coded list, ccclub renders whatever family name it is handed. If Anthropic scopes a weekly limit to a model that did not exist when your copy of ccclub was published, the segment still appears with the right name.</p>

      <h2>What hitting a limit looks like</h2>

      <p>The messages are specific, and each one carries its own reset time — "You've hit your session limit · resets 3:45pm", "You've hit your weekly limit · resets Mon 12:00am". Claude Code blocks further requests until that moment. Recent versions can also warn you on the way down, with a line such as "You've used 85% of your session limit", and can hold an interactive session open and continue the interrupted task shortly after the reset rather than making you come back to it. (<a href="https://code.claude.com/docs/en/errors" rel="noopener">code.claude.com/docs/en/errors</a>, read 2026-09-19.)</p>

      <h2>When the limits reset</h2>

      <p>Neither clock is tied to the calendar. The five-hour window rolls, and the weekly window runs on your account's own seven-day schedule; neither turns over at midnight. Both reset times are in <code>/usage</code>, and both are in the status-line payload as Unix timestamps, which is what lets a status line count down to them. If the usage endpoint is itself rate limited when you ask, Anthropic's cost documentation says <code>/usage</code> falls back to the last bars it loaded on that machine within the past 60 minutes and labels them as last-known rather than pretending they are live. (<a href="https://code.claude.com/docs/en/costs" rel="noopener">code.claude.com/docs/en/costs</a>, read 2026-09-19.)</p>

      <h2>What the limits actually count</h2>

      <p>Anthropic does not publish a token quota per window, and effective capacity is not a fixed number anyway: it moves with model choice and with how much context each request carries. The practical shape of it is that a heavyweight model consumes the allowance far faster than a small one, and that long conversations are expensive in a compounding way, because every turn re-sends what came before. The percentages in <code>/usage</code> are the only authoritative measure of where you stand.</p>

      <h2>How ccclub reads your limits</h2>

      <p>ccclub does not scrape <code>/usage</code> or guess from your logs. During a sync it asks Anthropic's own usage endpoint for your percentages, authenticating with the OAuth credentials Claude Code already stored in the macOS Keychain — no second login, and the token is sent only to Anthropic, the service that issued it, and is never uploaded to ccclub. It reads the five-hour and seven-day utilisation figures from that response, plus any model-scoped weekly entry, and writes them to a small cache under <code>~/.ccclub/</code> with a five-minute freshness window. The <a href="/claude-code-statusline">Claude Code statusline</a> then renders that cache without ever making a request of its own.</p>

      <p>Three honest limitations follow from that design. It is macOS-only, because the Keychain is where the credential lives. It covers Claude only — no other agent ccclub tracks exposes an equivalent endpoint. And it is a periodic reading rather than a live monitor: past three hours the numbers render dimmed with a trailing marker, and past twelve they are not shown at all, since a percentage that old describes a window which has since emptied and refilled. If you want alerts or burn-rate predictions, a dedicated real-time monitor is the right tool, not this.</p>

      <h2>What to do when you are close</h2>

      <ul>
        <li><strong>Match the model to the task.</strong> Mechanical edits and lookups do not need your most capable model, and model choice is the single largest lever on how fast an allowance drains.</li>
        <li><strong>Keep contexts short.</strong> Start a fresh session for an unrelated task and use <code>/compact</code>; re-sending an enormous conversation on every turn is what empties a window fastest.</li>
        <li><strong>Batch related questions</strong> rather than trickling out many small turns, each of which pays the context cost again.</li>
        <li><strong>Switch families if the limit is model-scoped.</strong> An Opus or Sonnet limit leaves the rest of the lineup available; a session or weekly limit does not.</li>
        <li><strong>Buy or request usage credits.</strong> <code>/usage-credits</code> — previously named <code>/extra-usage</code> — turns on metered usage beyond the allowance on Pro and Max, or sends a request to an admin on Team and Enterprise.</li>
        <li><strong>Let it wait.</strong> On recent versions Claude Code can hold the session and resume the interrupted task at the reset time, which is usually better than restarting the task cold.</li>
      </ul>

      <h2>Watching the pattern instead of the moment</h2>

      <p>Limits are a question about the next five hours; habits are a question about the last five weeks. The two need different instruments. <code>/usage</code> and a status line cover the moment. For the pattern, <a href="/claude-code-usage">reading your own usage numbers</a> over 7 and 30 days shows whether the sessions that cost you the most are the ones you would have guessed, and a shared board with friends is a blunter version of the same signal — it tells you quickly whether your consumption is ordinary or unusual for the way you work.</p>
    `,
    faq: [
      {
        q: "How does the Claude Code 5-hour limit work?",
        a: "It is a rolling five-hour window with its own allowance, which Claude Code exposes to a status line as rate_limits.five_hour — a used percentage and a resets_at timestamp. When the allowance runs out, Claude Code blocks further requests until the reset time shown in the message. The session allowance is shared across models, so switching models does not restore access.",
      },
      {
        q: "When does the Claude Code limit reset?",
        a: "Not at midnight, and not on a fixed server schedule: the five-hour window rolls and the weekly window runs on your account's own seven-day cycle. /usage shows the exact reset time for both, and the status-line payload carries them as resets_at Unix timestamps.",
      },
      {
        q: "Is the Claude Code session limit daily?",
        a: "No — it is a rolling five-hour window, not a daily quota, so several complete windows can fit into one working day. The longer-horizon ceiling is the weekly window, which is consumed at the same time rather than afterwards.",
      },
      {
        q: "How many tokens do you get per 5-hour window?",
        a: "Anthropic's documentation publishes no fixed token quota, and effective capacity shifts with model choice and context size — a heavyweight model drains the allowance far faster than a small one. The percentages in /usage are the only authoritative measure.",
      },
      {
        q: "How do I check how close I am to my Claude Code limit?",
        a: "Run /usage for the live percentages. For continuous visibility, a status line can display the rate_limits fields Claude Code passes it, or ccclub's statusline can show the 5h and 7d percentages it fetched from Anthropic's usage endpoint during the last sync.",
      },
      {
        q: "Can I keep working after hitting a limit?",
        a: "It depends which limit. A model-scoped Opus or Sonnet limit leaves other model families available via /model. A session or weekly limit does not: you wait for the reset, turn on usage credits with /usage-credits, or let Claude Code hold the session and continue automatically once the window resets.",
      },
      {
        q: "Why am I hitting Claude Code limits faster than before?",
        a: "Capacity depends on model and context size, and long conversations re-send everything that came before on every turn, so the same amount of work costs more late in a session than early. Anthropic has also adjusted limit levels over time; /usage reflects the current policy rather than any figure published earlier.",
      },
      {
        q: "Do Claude Code weekly limits exist on every plan?",
        a: "Subscription plans have a weekly window alongside the five-hour one, and separate model-scoped weekly limits exist too — the documented error messages name Opus and Sonnet. On Team and Enterprise the allowance is per seat and shared with Claude chat and Cowork. API pay-per-token usage has rate limits but no subscription-style weekly window.",
      },
      {
        q: "What's the best way to use less of my limit without working less?",
        a: "Use smaller models for mechanical tasks, keep sessions short and contexts compact, and batch related questions instead of sending many small turns. Model choice and context size dominate everything else you could tune.",
      },
    ],
  },
  {
    slug: "claude-code-cost",
    metaTitle: "Claude Code Cost: How Much Am I Actually Spending?",
    h1: "Claude Code cost, and what the number means",
    description:
      "How a Claude Code cost figure is built — list-price table, the four token buckets, provider-reported costs — and why on a subscription it is not a bill.",
    datePublished: "2026-09-19",
    dateModified: "2026-09-19",
    body: `
      <p>Every tool in this space will show you a dollar figure, and almost none of them are showing you what you paid. That is not dishonesty; it is the only thing they can compute. Understanding the gap is the difference between a number you can act on and a number that just makes you anxious. This page is about how ccclub builds its figure, line by line, and what you can legitimately conclude from yours.</p>

      <h2>On a subscription, nobody is charging you per token</h2>

      <p>If you are on Pro or Max, your tokens are not priced individually by anyone. The dollar amount any tracker shows is what those tokens <em>would have cost</em> had they been billed at public API list rates. Call it API-equivalent value. It is a real quantity and a useful one — it is comparable across days, across people and against a monthly plan price — but it is not an invoice and nothing reconciles against it.</p>

      <p>Claude Code says the same thing about its own screen. Its cost documentation describes the session figure as computed locally from token counts at list price, calls it an estimate, and points at the Console's usage page for authoritative billing. (<a href="https://code.claude.com/docs/en/costs" rel="noopener">code.claude.com/docs/en/costs</a>, read 2026-09-19.) Any tool reading the same logs inherits the same caveat.</p>

      <h2>Where the prices come from</h2>

      <p>ccclub ships with a price table baked into the package, so a fresh install can compute costs before it has spoken to anything. On top of that it fetches an updated table from <code>ccclub.dev/api/pricing</code> at most once a day, using a conditional request so an unchanged table costs a round trip and nothing more. The server side of that endpoint refreshes nightly from the LiteLLM price feed. The fetched table is overlaid on the bundled one rather than replacing it, so a model the feed has dropped keeps its price instead of silently becoming free.</p>

      <p>Two consequences worth knowing. The table is keyed by normalised model ID, and a dated or suffixed variant the feed has not picked up yet falls back to a representative model from the same family — usually correct, and a great deal better than counting those tokens at zero. And because the fetch is never on the critical path, being offline does not break cost calculation; you simply keep using the table you already had.</p>

      <h2>The formula</h2>

      <p>Prices are per million tokens, and each bucket is charged at its own rate:</p>

      <pre><code>cost = ( input       x input rate
       + output      x output rate
       + cache write x cache-write rate
       + cache read  x cache-read rate ) / 1,000,000</code></pre>

      <p>Four refinements sit on top of that. Cache writes made with a one-hour lifetime carry a premium over the standard write rate, so ccclub prices every write at the standard rate and then adds the difference for the one-hour subset only, clamped so a malformed log cannot claim more long-lived writes than it reported writes. Models that price the whole request differently once its input passes a threshold switch every rate for that request rather than applying a marginal band. Reasoning tokens, where a source reports them separately, are charged at the output rate. And if your <code>~/.codex/config.toml</code> sets <code>service_tier</code> to <code>fast</code> or <code>priority</code>, every Codex request is priced on that tier: the whole total is multiplied at the end, by 2 unless the price table carries a different multiplier for that model.</p>

      <p>The arithmetic happens once, in the collector that parsed the entry, and the result is summed into 30-minute blocks. That is deliberate: the raw token counts are what gets stored, so a corrected price table can reprice history without anyone re-reading multi-gigabyte logs.</p>

      <h2>When the source reports its own cost</h2>

      <p>Some agents write a cost into their own logs. Where a source has historically treated that number as authoritative, ccclub uses it in preference to its own calculation — the provider knows its contract and ccclub only knows a public rate card. The rule is presence, not truthiness: a reported zero is a real answer, meaning the request was included and cost nothing, and the price table would have invented a figure instead, because its fallbacks never return zero. A negative number is not a price at all — a refund line, or a parser reading the wrong field — so it is treated as absent and the calculated cost wins.</p>

      <h2>The ROI column</h2>

      <p>If you tell ccclub which plan you are on, the leaderboard adds a column comparing the two. Set it with <code>ccclub profile --plan pro</code>, <code>max100</code>, <code>max200</code> or <code>api</code>. The definition is exactly one division: your estimated cost over the last 30 days, divided by the plan's monthly price, as a percentage. A row reading <code>$200/1610%</code> means a $200 plan against $3,220 of tracked usage at list prices.</p>

      <p>It is a blunt instrument and worth naming the ways it misleads. It is denominated in list prices, so it inherits every caveat above. It counts every agent ccclub tracks, not only the one your plan pays for, which flatters anyone running several. And a percentage below 100 does not mean you are wasting money — plenty of people get their money's worth from a plan they use lightly but at exactly the right moments.</p>

      <h2>How to read your own number</h2>

      <p>Do not go looking for a normal figure to compare against; the spread between people doing similar work is enormous, and ccclub is not going to invent a benchmark for you. Anthropic's cost documentation does publish one calibration point, for enterprise deployments — an average of around $13 per developer per active day — but that population is nothing like someone on a personal plan, and reading it as a target would be a mistake.</p>

      <p>Your own number is more useful read as a trend and a ratio. Compare this week with last week rather than with anyone else. Watch the per-turn column — <code>$/Turn</code> in the CLI, <em>Avg Turn</em> on the web dashboard — which divides cost by the messages you actually typed: when it climbs, it usually means sessions are running longer before you clear them, not that the work got harder. And if you want the comparison against other people anyway, that is what a group board is for — a handful of people you know is a far better reference class than an average.</p>

      <h2>What it will never tell you</h2>

      <p>Not real spending, not per-project attribution, and not whether the money was well spent. ccclub has no per-project cost report at all: the project chips on a leaderboard row are labels a member attaches to themselves, never anything derived from usage. And cost, like tokens, is a measure of activity. A cheap week where the right thing shipped beats an expensive one, and no column here can tell the difference.</p>
    `,
    faq: [
      {
        q: "Is the Claude Code cost shown by usage tools my real bill?",
        a: "Not on a subscription. Pro and Max do not charge per token, so any dollar figure is your tokens priced at public API list rates — API-equivalent value, not an invoice. Claude Code describes its own session cost figure the same way and points at the Console for authoritative billing.",
      },
      {
        q: "How does ccclub calculate cost?",
        a: "Each token bucket is multiplied by its own per-million-token rate — input, output, cache write and cache read — with a premium added for one-hour cache writes and whole-request rates for models that price long context differently. Prices come from a bundled table overlaid with a daily refresh from the ccclub pricing endpoint.",
      },
      {
        q: "Why does ccclub sometimes use a cost from the agent instead of calculating one?",
        a: "Because some sources write an authoritative cost into their own logs, and the provider knows its own contract. A reported zero is honoured as a real answer, since the price table's fallbacks never return zero; a negative value is treated as missing and the calculated cost is used instead.",
      },
      {
        q: "What does the ROI percentage on the leaderboard mean?",
        a: "Estimated cost over the last 30 days divided by your plan's monthly price. $200/1610% means $3,220 of tracked usage at list prices against a $200 plan. It counts every agent ccclub tracks, not just the one your plan pays for, so read it as a rough ratio rather than a return.",
      },
      {
        q: "How much should Claude Code cost per month?",
        a: "There is no useful answer to that as a benchmark — the spread between people doing similar work is very wide. Read your own figure as a trend instead: this week against last week, and the $/Turn column, which usually rises because sessions are running long rather than because the work got harder.",
      },
    ],
  },
  {
    slug: "claude-code-statusline",
    metaTitle: "Claude Code Statusline: Limits, Rank and Cost in One Line",
    h1: "Claude Code statusline: what ccclub puts there",
    description:
      "A Claude Code statusline showing model, effort, your 5h and 7d limit percentages and your group rank — drawn from cache, with no network call to render.",
    datePublished: "2026-09-19",
    dateModified: "2026-09-19",
    body: `
      <p>Claude Code lets you replace the bar under the prompt with the output of any command: it hands your script a JSON payload on stdin and prints whatever comes back. That is a genuinely open slot, and most people fill it with context percentage and a git branch. ccclub fills it with the two numbers that are otherwise a command away — how much of your rate-limit windows you have spent, and where you sit on your group's board today. This page is about that one line: what it contains, how it stays current, and what it deliberately refuses to do.</p>

      <h2>What the line shows</h2>

      <p>Up to three segments, separated by dim pipes, and every one of them optional:</p>

      <pre><code> Fable 5 xhigh | 5h: 15% / 7d: 43% / Fable: 8% | #11/67 $19.0</code></pre>

      <ul>
        <li><strong>Model and effort.</strong> The display name Claude Code passes in, with a parenthetical context size shortened so "(200K context)" does not eat the line, followed by the session's reasoning effort level when the current model has one. The effort word is coloured by intensity, so a session left on the highest setting is visible without reading it.</li>
        <li><strong>Limits.</strong> The percentage of your five-hour window and your seven-day window consumed, plus a third figure when a model-scoped weekly limit applies — labelled with whatever family name the API returns. Each percentage turns amber at 60% and above, and red at 80% and above, which is the only warning the line gives.</li>
        <li><strong>Rank and cost.</strong> Your position on your first group's board for today and today's estimated cost, with the top three positions in gold, silver and bronze. The segment is wrapped in a terminal hyperlink, so in a terminal that supports them the rank is click-through to the group dashboard, and in one that does not it renders as ordinary text.</li>
      </ul>

      <p>Segments degrade independently. No group yet, an expired credential, a model with no effort knob — whatever is missing is simply absent, and the rest of the line still prints. If nothing at all is available, the statusline prints nothing rather than an error.</p>

      <h2>Turning it on and off</h2>

      <p><code>ccclub statusline on</code> writes a <code>statusLine</code> entry into <code>~/.claude/settings.json</code> pointing at <code>ccclub-statusline</code>, a small binary npm installs beside the main <code>ccclub</code> command. It is a separate executable on purpose: the main CLI pulls in an argument parser and a colour library that the render path has no use for, and this one runs on every turn. Because Claude Code has to be able to find that binary by name, the command requires ccclub to be installed globally and says so plainly instead of writing a setting that would silently do nothing.</p>

      <p><code>ccclub statusline off</code> removes the entry and records the decision. That record matters: ccclub will enable the statusline once, on its own, on a machine where nothing else is configured — and the opt-out marker is what stops that automatic path from ever bringing it back. Running <code>ccclub statusline</code> with no argument prints the current state and the command it would install.</p>

      <h2>Where the numbers come from</h2>

      <p>Not from the payload Claude Code hands it. The renderer reads exactly two things out of that JSON — the model display name and the effort level — and takes everything else off disk. Limit percentages and rank live in small cache files under <code>~/.ccclub/</code>, written by <code>ccclub sync</code>: the sync asks Anthropic's usage endpoint for your own percentages, using the credential Claude Code already holds locally, and asks the ccclub API for your rank. The render path opens those files, formats a line and exits.</p>

      <p>Sync runs often enough for that to work without anyone thinking about it. <code>ccclub init</code> installs Claude Code hooks that fire when a turn stops and when a session ends, and on macOS a LaunchAgent that syncs every five minutes on top of them. On Linux and Windows there is no such agent: the hooks are the whole of the schedule, so the cache is as fresh as your last turn. Either way, while you are actually using Claude Code it is rarely more than a few minutes old.</p>

      <h2>What a slept-through night does to it</h2>

      <p>Both triggers stop while the machine is asleep — a hook needs a turn to end, and the periodic agent is suppressed outright. Measured on one laptop, that meant effective gaps of about forty minutes in ordinary use and eight hours across a night, and the old result was a limits segment that vanished for hours the next morning with nothing to explain why.</p>

      <p>Two changes fixed it, both visible in the line. A reading older than three hours still renders, dimmed and with a trailing tilde: plainly not live, still better than a gap. Past twelve hours it is dropped, because by then the window it describes has emptied and refilled and the figure would be false rather than merely old. And the statusline now kicks off a background sync when it sees the cache has aged — after the line is already on stdout, never before, and no more than once every five minutes however those syncs turn out. A machine that slept heals itself within a turn or two of waking.</p>

      <h2>What it never does</h2>

      <p>The render path makes no network request. None: it reads stdin and three small JSON files, and every one of those reads is wrapped so that a missing or corrupt file drops one segment instead of failing. Both the payload and the caches are treated as untrusted input, since the line is printed raw into a terminal between escape codes — text from either is stripped to printable ASCII and length-bounded before it is used, and the dashboard URL behind the rank hyperlink has to match a strict pattern or the link is dropped and the text printed plain.</p>

      <p>It also does not alert, predict, or notify. There is no burn-rate projection and no "you will run out at 4pm" — just a percentage that changes colour. If you want prediction, run a monitor built for it; this is a readout, and it is honest about being one.</p>

      <h2>If you already have a statusline</h2>

      <p>Claude Code has one <code>statusLine</code> slot, so two tools cannot both own it. ccclub resolves that in the only direction that cannot lose someone's work: if the configured command is not exactly <code>ccclub-statusline</code>, ccclub treats it as yours and refuses to touch it. <code>ccclub statusline on</code> declines with a message telling you to remove the existing one first; the automatic enable never fires at all; and uninstalling only ever removes a command that is byte-for-byte ours. Even a pipeline that mentions ccclub by name — piping our output into your own filter, say — counts as yours under that rule, which is the conservative reading and the right one.</p>

      <p>If you would rather build your own, Claude Code's own payload already carries <code>rate_limits.five_hour</code> and <code>rate_limits.seven_day</code> for subscription accounts, with a percentage and a reset timestamp each, and its <a href="https://code.claude.com/docs/en/statusline" rel="noopener">status line documentation</a> (read 2026-09-19) has worked examples. ccclub's version exists because it also knows your rank, and because the limit figures it shows are fetched independently rather than waiting on the first API response of a session.</p>
    `,
    faq: [
      {
        q: "How do I enable the ccclub statusline in Claude Code?",
        a: "Run ccclub statusline on. It points Claude Code's statusLine setting at the ccclub-statusline binary, which npm installs alongside the CLI, so ccclub has to be installed globally. Open a new Claude Code session to see it.",
      },
      {
        q: "Will it overwrite my existing Claude Code status line?",
        a: "No. If the configured command is anything other than ccclub-statusline exactly, ccclub treats the slot as yours: it refuses to install over it, never enables itself automatically, and only ever removes a command that is exactly its own.",
      },
      {
        q: "Does the statusline slow down Claude Code or call the network?",
        a: "The render path makes no network request. It reads the JSON payload on stdin plus three small cache files under ~/.ccclub/ and prints one line. The percentages are fetched separately by ccclub sync, which the Claude Code session hooks already run — and on macOS a LaunchAgent runs it every five minutes as well.",
      },
      {
        q: "Why are my limit percentages dim with a tilde after them?",
        a: "That marks a reading older than three hours — usually a laptop that slept through the background syncs. The numbers still render because a stale figure beats a blank space, but they are visibly not live. Past twelve hours they are dropped entirely, and the statusline starts a background sync to refresh them.",
      },
      {
        q: "Why does the statusline show no limits at all?",
        a: "Either no usable reading exists yet or the machine cannot produce one. The percentages come from Anthropic's usage endpoint via the credential Claude Code stores in the macOS Keychain, so they are macOS-only and Claude-only, and an expired credential or a never-run sync leaves the segment out rather than showing a zero.",
      },
    ],
  },
  {
    slug: "codex-usage",
    metaTitle: "Codex Usage: How to Check Limits, Logs and Costs (2026)",
    h1: "How to track Codex usage",
    description:
      "Check Codex usage with /status, find the session logs in ~/.codex/sessions/, and see the tools that report Codex tokens — alongside Claude Code.",
    datePublished: "2026-07-07",
    dateModified: "2026-08-04",
    body: `
      <p>OpenAI's Codex CLI gets less usage-tooling attention than Claude Code, but the same layers exist: a built-in status command, local session logs, and open-source tools that read them. (Details as of July 2026.)</p>

      <h2>Built-in: /status</h2>

      <p>Inside Codex, <code>/status</code> shows your account, model, and current rate-limit state — the equivalent of Claude Code's <code>/usage</code>. If you use Codex through a ChatGPT plan, limits are metered in rolling windows plus a weekly allowance, and heavy use can be topped up with pay-as-you-go credits.</p>

      <h2>Local session logs</h2>

      <p>Codex writes JSONL session files under <code>~/.codex/sessions/</code>, including per-turn token counts and the model used. As with Claude Code's <code>~/.claude/projects/</code>, these local files are what usage tools parse — nothing needs a network call.</p>

      <h2>Reports across time: ccusage</h2>

      <p><a href="https://ccusage.com" rel="noopener">ccusage</a> supports Codex alongside Claude Code and other coding CLIs — daily/monthly/per-session tables with costs estimated at public API pricing. Local data in, terminal tables out — no upload documented.</p>

      <h2>Codex and Claude Code on one board</h2>

      <p>Many developers now run both agents and want one picture of usage — or want to compare with friends who use a different agent. <a href="/">ccclub</a> (our project) reads local logs from Codex, Claude Code, OpenCode, Amp, Grok, and Pi — plus opt-in Cursor, which has no local logs to read — and puts a group on a single leaderboard with each member's agent mix. Set up with <code>npx ccclub init</code>; only numeric summaries are uploaded (no prompts, code, or file paths). If you only want your own numbers, stick with ccusage — see the <a href="/ccusage-vs-ccclub">comparison</a>.</p>

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
    metaTitle: "ccusage vs ccclub: a ccusage alternative for teams",
    h1: "ccusage vs ccclub",
    description:
      "ccusage reports your own local usage; ccclub is the ccusage alternative for a shared board — friends or a team ranked on one leaderboard, auto-synced.",
    datePublished: "2026-07-07",
    dateModified: "2026-09-19",
    body: `
      <p>Short answer: they solve different problems, and plenty of people use both. <a href="https://ccusage.com" rel="noopener">ccusage</a> answers "what did <em>I</em> use?"; <a href="/">ccclub</a> answers "how does our <em>group</em> compare?". Disclosure up front: ccclub is our project — we'll try to be even-handed anyway.</p>

      <h2>What each tool does</h2>

      <p><strong>ccusage</strong> is a reporting CLI. It reads local coding-agent data and prints tables — daily, weekly, monthly, per-session, or Claude Code's 5-hour billing windows — with costs in USD. Its README lists 18 sources, from Claude Code and Codex through Gemini CLI, GitHub Copilot CLI, and Goose. Nothing in that README describes uploading your usage anywhere; the only network access it documents is fetching model prices, which <code>--offline</code> skips by using a pre-cached table. It has become the de-facto standard for personal usage reports.</p>

      <p><strong>ccclub</strong> is a shared leaderboard. Everyone in a group runs <code>npx ccclub init</code> or <code>join CODE</code>; after that, usage syncs automatically (a session-end hook for Claude Code, background sync for Codex, OpenCode, Amp, Grok, and Pi, and for Cursor once you enable it) and the group sees one ranking — in the terminal via <code>ccclub</code> or on a live web dashboard. It uploads aggregated numeric summaries only: token counts, estimated cost, model names, turn counts, in 30-minute blocks. No prompts, code, or file paths; <code>ccclub show-data</code> prints the exact payload.</p>

      <h2>Side by side</h2>

      <div class="table-scroll">
      <table>
        <thead><tr><th></th><th>ccusage</th><th>ccclub</th></tr></thead>
        <tbody>
          <tr><td>Core question</td><td>What did I use?</td><td>How does our group compare?</td></tr>
          <tr><td>Usage leaves your machine</td><td>No upload documented</td><td>Numeric summaries only</td></tr>
          <tr><td>Account required</td><td>No</td><td>No (6-letter invite code)</td></tr>
          <tr><td>Report granularity</td><td>Daily / weekly / monthly / session / 5-hour blocks</td><td>Today / yesterday / 7d / 30d / all-time</td></tr>
          <tr><td>Web dashboard</td><td>No (terminal tables, plus a Claude Code statusline)</td><td>Yes, live per group</td></tr>
          <tr><td>Auto-sync</td><td>n/a (run on demand)</td><td>Yes (hook + background)</td></tr>
          <tr><td>Agent coverage</td><td>18 sources listed in its README</td><td>Claude Code, Codex, OpenCode, Amp, Grok, Pi, Cursor</td></tr>
          <tr><td>License</td><td>MIT</td><td>MIT</td></tr>
        </tbody>
      </table>
      </div>

      <h2>Pick ccusage if…</h2>
      <ul>
        <li>You want reports for yourself and nobody else needs to see them.</li>
        <li>You need coverage for an agent ccclub doesn't support yet — its source list is the longer one.</li>
        <li>You want fine-grained analysis: per-session reports, 5-hour blocks, or Claude Code grouped by project with <code>--instances</code>.</li>
      </ul>

      <h2>Pick ccclub if…</h2>
      <ul>
        <li>You and friends or teammates want one leaderboard that stays current without anyone manually running reports.</li>
        <li>You want a shareable live dashboard (each group gets <code>ccclub.dev/g/CODE</code>).</li>
        <li>You're curious how your usage ranks more broadly — there's an opt-in <a href="/g/global">global board</a>.</li>
      </ul>

      <h2>Or use both</h2>

      <p>They read the same local logs and don't conflict. A common setup: ccusage for detailed personal analysis, ccclub for the group scoreboard. If you're deciding among leaderboard tools specifically, see the <a href="/claude-code-leaderboards">leaderboard comparison</a>.</p>

      <h2>Methodology</h2>

      <p>ccclub publishes this comparison; treat it as our argument, not a neutral review. Every claim about ccusage on this page was read from its own README and documentation site on 2026-09-19 — its source list, report granularity, pricing and offline behaviour, project grouping, and license. Where the README does not say something, this page does not claim it: it documents no upload of your usage, so that is how the table words it, rather than asserting on ccusage's behalf that nothing is ever sent.</p>

      <p>The ccclub side is read from our own source: what the CLI collects, what the sync payload contains, and what the leaderboard computes. The boundaries are listed in machine-readable form at <a href="/llms.txt">llms.txt</a>.</p>

      <h2>Sources</h2>

      <ol>
        <li>ccusage README — <a href="https://github.com/ccusage/ccusage/blob/main/apps/ccusage/README.md" rel="noopener">github.com/ccusage/ccusage</a> (read 2026-09-19). The older <code>github.com/ryoppippi/ccusage</code> URL redirects here.</li>
        <li>ccusage documentation — <a href="https://ccusage.com" rel="noopener">ccusage.com</a>.</li>
        <li>ccclub source and README — <a href="https://github.com/mazzzystar/ccclub" rel="noopener">github.com/mazzzystar/ccclub</a> (MIT).</li>
        <li>ccclub boundaries, machine-readable — <a href="/llms.txt">ccclub.dev/llms.txt</a> and <a href="/llms-full.txt">ccclub.dev/llms-full.txt</a>.</li>
      </ol>
    `,
    faq: [
      {
        q: "Is ccclub a replacement for ccusage?",
        a: "No. ccusage is a local reporting tool for your own usage; ccclub is a shared leaderboard for a group. They read the same local logs and many people use both.",
      },
      {
        q: "Does ccclub upload more data than ccusage?",
        a: "Yes. ccusage documents no upload of your usage — it reads local data and prints reports. ccclub uploads aggregated numeric summaries (tokens, estimated cost, model names, turn counts in 30-minute blocks) so the group board can update — never prompts, code, or file paths. Run ccclub show-data to see the exact payload.",
      },
      {
        q: "Which supports more coding agents?",
        a: "ccusage covers more: its README lists 18 sources. ccclub currently supports Claude Code, Codex, OpenCode, Amp, Grok, Pi, and Cursor — the ones it can sync into a shared leaderboard.",
      },
      {
        q: "Can I use ccclub just for myself?",
        a: "Yes — a group of one works, and the all-time view makes it a simple personal history. But if you never want a shared board, ccusage alone is the simpler tool.",
      },
    ],
  },
  {
    slug: "claude-code-leaderboards",
    metaTitle: "Claude Code Leaderboard: public boards vs private groups",
    h1: "Claude Code leaderboards, compared",
    description:
      "Which Claude Code leaderboard is public and which stays private to friends or teammates: viberank, ccgather, tokenleaders and ccclub. (We build ccclub.)",
    datePublished: "2026-07-07",
    dateModified: "2026-08-04",
    body: `
      <p>Ranking Claude Code usage has become a small genre of its own. The tools differ mainly on two axes: <strong>who sees the board</strong> (the public, or just your group) and <strong>how data gets there</strong> (manual submission, or automatic sync). Disclosure: <a href="/">ccclub</a> is our project; descriptions of the others are based on their public docs as of July 2026.</p>

      <h2>The options</h2>

      <p><strong><a href="https://www.viberank.app" rel="noopener">viberank</a></strong> — a public community leaderboard. You sign in with GitHub and submit your usage (generated via ccusage); rankings by cost and tokens. Good if you want your numbers visible in a global community.</p>

      <p><strong><a href="https://ccgather.com" rel="noopener">ccgather</a></strong> — an open-source public leaderboard and community. You sync usage with its CLI (<code>npx ccgather</code>) and get global and country-level rankings, levels and badges, an activity heatmap, and an AI-translated community feed. The most community-oriented of the group.</p>

      <p><strong><a href="https://tokenleaders.fun" rel="noopener">tokenleaders</a></strong> — a lightweight public Claude usage ranking; simple and fun rather than feature-heavy.</p>

      <p>Other public boards in the same vein: <a href="https://clawd.gg" rel="noopener">clawd.gg</a> (ranks prompts, tokens, and lines of code) and <a href="https://ccleaderboard.com" rel="noopener">CCLeaderboard</a> (CLI submission, daily and all-time rankings).</p>

      <p><strong>ccclub</strong> — private-first. You create a group with <code>npx ccclub init</code>, friends join with a 6-letter code, and the board updates automatically from local logs (Claude Code session-end hook; background sync for Codex, OpenCode, Amp, Grok, Pi — and Cursor, which is opt-in because it has no local logs). No accounts. Each group gets a live web dashboard, and there's an opt-in <a href="/g/global">global board</a> if you do want a public ranking. Only numeric summaries are uploaded — no prompts, code, or file paths.</p>

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
        <li><strong>Don't want a leaderboard at all?</strong> You may just want usage reports — see <a href="/how-to-check-claude-code-usage">how to check Claude Code usage</a> or <a href="https://ccusage.com" rel="noopener">ccusage</a>.</li>
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

app.get("/guides", cacheStaticHTML(), (c) => c.html(guidesIndexHTML()));

for (const page of GUIDE_PAGES) {
  app.get(`/${page.slug}`, cacheStaticHTML(), (c) => c.html(guideHTML(page)));
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
  <link rel="alternate" type="text/plain" href="https://ccclub.dev/llms.txt" />
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏆</text></svg>" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />

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
    title: "Guides: Claude Code Usage, Limits, Codex, and Leaderboards",
    description:
      "Guides to checking Claude Code usage, how the 5-hour and weekly limits work, tracking Codex, ccusage vs ccclub, and comparing leaderboards.",
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
