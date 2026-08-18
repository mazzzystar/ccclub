export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  datePublished: string; // ISO date, e.g. "2026-02-13"
  dateModified?: string; // ISO date; falls back to datePublished
  displayDate: string; // e.g. "February 2026"
  author: string;
  /** Inner HTML of the <article>, after the <h1>. */
  body: string;
};

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "why-i-built-ccclub",
    title: "Why I built ccclub",
    description: "I wanted to know how my friends were using Claude Code. So I built a leaderboard.",
    datePublished: "2026-02-13",
    displayDate: "February 2026",
    author: "Ke Fang",
    body: `
      <p>A few months ago I started using Claude Code for most of my daily work. Writing features, fixing bugs, refactoring — the kind of things I used to do in an editor with occasional Stack Overflow tabs.</p>

      <p>One evening I was talking with a friend and we started comparing notes. How much are you spending? How many tokens? What model do you use? We were both curious, but neither of us had an easy way to check. Claude Code writes local usage logs, but they're raw JSONL files scattered across <code>~/.claude/projects/</code>. Not exactly something you'd screenshot and send.</p>

      <p>So I built ccclub — a small CLI tool that reads those logs, aggregates the numbers, and puts them on a shared leaderboard.</p>

      <h2>How it works</h2>

      <p>You run <code>npx ccclub init</code>, pick a name, and get a six-letter invite code. Share the code with friends. They run <code>npx ccclub join CODE</code>. That's it — no accounts, no email, no config.</p>

      <p>After that, every time you finish a Claude Code session, a hook automatically syncs your usage. Run <code>ccclub</code> in the terminal and you see a leaderboard: who spent the most, who sent the most tokens, who's active right now.</p>

      <p>There's also a web dashboard at <code>ccclub.dev/g/CODE</code> with an activity chart, so you can see when your friends are coding and how their usage patterns look over time.</p>

      <h2>What it tracks</h2>

      <p>Token counts, cost estimates, model names, and number of turns. That's all. No prompts, no code, no file paths, no conversation data. You can run <code>ccclub show-data</code> to see exactly what gets uploaded before it leaves your machine.</p>

      <p>The cost is calculated based on public API pricing — it shows you the equivalent dollar value of the tokens you've consumed. If you set your subscription plan (<code>ccclub profile --plan max200</code>), it also calculates your Monthly ROI: how much usage value you got relative to what you paid.</p>

      <h2>Beyond Claude Code</h2>

      <p>Since the initial release, ccclub has grown to support multiple coding agents. It now reads usage logs from Claude Code, Codex, OpenCode, Amp, Grok, and Pi. If you use more than one, all of them show up in the same leaderboard.</p>

      <p>The data stays local — ccclub reads from each agent's default log directory, aggregates everything into 30-minute blocks, and uploads only the numeric summaries.</p>

      <h2>What people use it for</h2>

      <p>Some teams use it to get a rough sense of who's actively using AI-assisted coding and how much it's costing. Some friend groups treat it as a lighthearted competition. A few solo developers just use it to track their own usage over time — the "all time" view gives you a nice historical picture.</p>

      <p>I didn't plan for any of these use cases. I just wanted to compare numbers with one friend. The rest happened on its own.</p>

      <h2>Try it</h2>

      <div class="cta-box">
        <code>npx ccclub init</code>
        <p>One command. No signup. Invite your friends and see the leaderboard.</p>
      </div>

      <p class="dim">ccclub is open source and free. The code is on <a href="https://github.com/mazzzystar/ccclub">GitHub</a>.</p>
    `,
  },
];

export function getPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}

export function postLastmod(post: BlogPost): string {
  return post.dateModified ?? post.datePublished;
}

/** Newest first. */
export function sortedPosts(): BlogPost[] {
  return [...BLOG_POSTS].sort((a, b) => b.datePublished.localeCompare(a.datePublished));
}
