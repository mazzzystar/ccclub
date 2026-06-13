import { Hono } from "hono";
import { html } from "hono/html";
import type { Env } from "./types.js";

const app = new Hono<{ Bindings: Env }>();

app.get("/blog/why-i-built-ccclub", (c) => {
  return c.html(blogPostHTML());
});

function blogPostHTML() {
  const title = "Why I built ccclub";
  const description = "I wanted to know how my friends were using Claude Code. So I built a leaderboard.";
  const url = "https://ccclub.dev/blog/why-i-built-ccclub";

  return html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — ccclub</title>
  <meta name="description" content="${description}" />

  <meta property="og:type" content="article" />
  <meta property="og:url" content="${url}" />
  <meta property="og:site_name" content="ccclub" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="https://ccclub.dev/og.png" />
  <meta property="article:author" content="Ke Fang" />
  <meta property="article:published_time" content="2026-02-13" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="https://ccclub.dev/og.png" />

  <meta name="theme-color" content="#1a1816" />
  <link rel="canonical" href="${url}" />
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏆</text></svg>" />

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "headline": "${title}",
    "description": "${description}",
    "url": "${url}",
    "datePublished": "2026-02-13",
    "author": { "@type": "Person", "name": "Ke Fang", "url": "https://github.com/mazzzystar" },
    "publisher": { "@type": "Organization", "name": "ccclub", "url": "https://ccclub.dev" },
    "image": "https://ccclub.dev/og.png"
  }
  </script>

  <script async src="https://www.googletagmanager.com/gtag/js?id=G-RG2RD9V66M"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-RG2RD9V66M');
  </script>

  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #1a1816; --text: #e8e4de; --title: #f1ede7; --muted: #8a8480;
      --faint: #5a5550; --line: #332f2b; --brand: #d4935e; --link: #7ab7c6;
      --success: #63b486; --panel: #201e1c;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      background: var(--bg); color: var(--text); min-height: 100vh;
      -webkit-font-smoothing: antialiased; line-height: 1.7;
    }
    a { color: var(--link); text-decoration: none; }
    a:hover { text-decoration: underline; }
    code {
      font-family: "SF Mono", "Fira Code", Menlo, Consolas, monospace;
      background: var(--panel); padding: 2px 6px; border-radius: 4px;
      font-size: 14px;
    }
    pre {
      background: var(--panel); border-radius: 8px; padding: 16px 20px;
      overflow-x: auto; margin: 24px 0; border: 1px solid var(--line);
    }
    pre code { background: none; padding: 0; font-size: 14px; line-height: 1.6; }

    .wrap { max-width: 640px; margin: 0 auto; padding: 0 24px; }

    .brand {
      display: flex; align-items: center; gap: 8px;
      padding-top: 24px; text-decoration: none;
    }
    .brand img { border-radius: 6px; }
    .brand span { font-size: 16px; font-weight: 600; color: var(--muted); letter-spacing: -0.3px; }
    .brand:hover span { color: var(--text); }

    .post { padding: 48px 0 64px; }
    .post-meta { color: var(--faint); font-size: 14px; margin-bottom: 8px; }
    .post h1 {
      font-size: 32px; font-weight: 700; letter-spacing: -0.5px;
      line-height: 1.2; color: var(--title); margin-bottom: 32px;
    }
    .post h2 {
      font-size: 20px; font-weight: 600; color: var(--title);
      margin: 40px 0 16px; letter-spacing: -0.3px;
    }
    .post p { margin-bottom: 16px; color: var(--text); font-size: 16px; }
    .post p.dim { color: var(--muted); }
    .post ul, .post ol { margin: 16px 0; padding-left: 24px; }
    .post li { margin-bottom: 8px; font-size: 16px; }
    .post blockquote {
      border-left: 3px solid var(--brand); padding: 12px 20px;
      margin: 24px 0; color: var(--muted); font-style: italic;
    }
    .post hr {
      border: none; border-top: 1px solid var(--line);
      margin: 40px 0;
    }
    .cta-box {
      background: var(--panel); border: 1px solid var(--line);
      border-radius: 10px; padding: 24px; margin: 32px 0;
      text-align: center;
    }
    .cta-box code { font-size: 16px; color: var(--success); background: none; }
    .cta-box p { color: var(--muted); font-size: 14px; margin: 8px 0 0; }

    .footer {
      padding: 48px 0; border-top: 1px solid var(--line);
      text-align: center; color: var(--faint); font-size: 13px;
    }
    .footer a { color: var(--muted); }

    @media (max-width: 600px) {
      .post h1 { font-size: 26px; }
      .post { padding: 32px 0 48px; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <a href="/" class="brand">
      <img src="https://raw.githubusercontent.com/mazzzystar/ccclub/main/assets/icon.png" alt="ccclub" width="28" height="28" />
      <span>ccclub</span>
    </a>

    <article class="post">
      <div class="post-meta">February 2026</div>
      <h1>Why I built ccclub</h1>

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

      <p>Since the initial release, ccclub has grown to support multiple coding agents. It now reads usage logs from Claude Code, Codex, OpenCode, Amp, and pi-agent. If you use more than one, all of them show up in the same leaderboard.</p>

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
    </article>

    <div class="footer">
      <a href="/">← Home</a>
      &nbsp;·&nbsp;
      <a href="https://github.com/mazzzystar/ccclub">GitHub</a>
      &nbsp;·&nbsp;
      <a href="https://discord.gg/6QbGWJUVHq">Discord</a>
    </div>
  </div>
</body>
</html>`;
}

export { app as blogRoute };
