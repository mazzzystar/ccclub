import { Hono } from "hono";
import { html } from "hono/html";
import type { Env } from "./types.js";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => {
  return c.html(landingHTML());
});

function landingHTML() {
  return html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ccclub.dev - Know how much Claude Code your friends are burning through</title>
  <meta name="description" content="Track and compare Claude Code usage with friends. Create a group, share a code, see the leaderboard together." />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0a0a0a; color: #ededed; min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }
    a { color: #60a5fa; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { font-family: "SF Mono", "Fira Code", "Fira Mono", Menlo, monospace; }

    /* Hero */
    .hero {
      max-width: 720px; margin: 0 auto;
      padding: 80px 24px 48px;
      text-align: center;
    }
    .hero h1 {
      font-size: 48px; font-weight: 800; letter-spacing: -1px;
      line-height: 1.1; margin-bottom: 16px;
    }
    .hero h1 span { color: #60a5fa; }
    .hero p.tagline {
      font-size: 20px; color: #888; line-height: 1.5;
      max-width: 480px; margin: 0 auto 40px;
    }

    /* Terminal */
    .terminal {
      max-width: 600px; margin: 0 auto 48px;
      background: #111; border: 1px solid #222; border-radius: 12px;
      overflow: hidden; text-align: left;
    }
    .terminal-bar {
      background: #1a1a1a; padding: 10px 16px;
      display: flex; align-items: center; gap: 8px;
    }
    .terminal-dot {
      width: 12px; height: 12px; border-radius: 50%;
    }
    .terminal-dot.r { background: #ff5f57; }
    .terminal-dot.y { background: #febc2e; }
    .terminal-dot.g { background: #28c840; }
    .terminal-title {
      flex: 1; text-align: center; color: #555; font-size: 12px;
    }
    .terminal-body {
      padding: 20px 24px; font-size: 14px; line-height: 1.7;
      color: #999; white-space: pre; overflow-x: auto;
    }
    .terminal-body .prompt { color: #22c55e; }
    .terminal-body .cmd { color: #ededed; }
    .terminal-body .dim { color: #555; }
    .terminal-body .blue { color: #60a5fa; }
    .terminal-body .gold { color: #f59e0b; }
    .terminal-body .green { color: #22c55e; }

    /* CTA */
    .cta {
      max-width: 720px; margin: 0 auto;
      padding: 0 24px 64px; text-align: center;
    }
    .cta-cmd {
      display: inline-block; background: #111; border: 1px solid #333;
      border-radius: 8px; padding: 14px 28px; font-size: 18px;
      font-family: "SF Mono", "Fira Code", Menlo, monospace;
      color: #ededed; cursor: pointer; transition: border-color 0.2s;
      position: relative;
    }
    .cta-cmd:hover { border-color: #60a5fa; }
    .cta-cmd .dollar { color: #22c55e; margin-right: 8px; }
    .cta-hint {
      margin-top: 12px; color: #555; font-size: 13px;
    }

    /* Sections */
    .section {
      max-width: 720px; margin: 0 auto;
      padding: 48px 24px;
    }
    .section h2 {
      font-size: 28px; font-weight: 700; margin-bottom: 24px;
      letter-spacing: -0.5px;
    }

    /* How it works */
    .steps {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px;
    }
    @media (max-width: 600px) {
      .steps { grid-template-columns: 1fr; }
      .hero h1 { font-size: 32px; }
    }
    .step {
      background: #111; border: 1px solid #1a1a1a; border-radius: 12px;
      padding: 24px;
    }
    .step-num {
      width: 32px; height: 32px; border-radius: 50%;
      background: #1e3a5f; color: #60a5fa;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 14px; margin-bottom: 12px;
    }
    .step h3 { font-size: 16px; margin-bottom: 8px; }
    .step p { color: #888; font-size: 14px; line-height: 1.5; }
    .step code {
      background: #1a1a1a; padding: 2px 6px; border-radius: 4px;
      font-size: 13px; color: #ededed;
    }

    /* Privacy */
    .privacy-box {
      background: #111; border: 1px solid #1a1a1a; border-radius: 12px;
      padding: 24px; margin-bottom: 16px;
    }
    .privacy-box h3 { font-size: 16px; margin-bottom: 12px; color: #22c55e; }
    .privacy-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
    }
    @media (max-width: 600px) {
      .privacy-grid { grid-template-columns: 1fr; }
    }
    .privacy-yes, .privacy-no {
      font-size: 14px; line-height: 1.8; color: #888;
    }
    .privacy-yes span { color: #22c55e; margin-right: 6px; }
    .privacy-no span { color: #ef4444; margin-right: 6px; }

    /* Commands */
    .cmd-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
    }
    @media (max-width: 600px) {
      .cmd-grid { grid-template-columns: 1fr; }
    }
    .cmd-card {
      background: #111; border: 1px solid #1a1a1a; border-radius: 8px;
      padding: 16px;
    }
    .cmd-card code {
      display: block; margin-bottom: 6px; font-size: 14px; color: #ededed;
    }
    .cmd-card p { font-size: 13px; color: #666; }

    /* Footer */
    .footer {
      max-width: 720px; margin: 0 auto;
      padding: 48px 24px;
      border-top: 1px solid #1a1a1a;
      text-align: center; color: #444; font-size: 13px;
    }
    .footer a { color: #555; }
  </style>
</head>
<body>

  <div class="hero">
    <h1>Know how much <span>Claude Code</span> your friends are burning through.</h1>
    <p class="tagline">Create a group, share a 6-letter code, compare usage together. No signup, no config.</p>
  </div>

  <div class="terminal">
    <div class="terminal-bar">
      <div class="terminal-dot r"></div>
      <div class="terminal-dot y"></div>
      <div class="terminal-dot g"></div>
      <div class="terminal-title">Terminal</div>
    </div>
    <div class="terminal-body"><span class="prompt">$</span> <span class="cmd">ccclub rank</span>

  <span class="blue">Ada's Coding Club</span>
  <span class="dim">DAILY \u00b7 2025-02-13 \u2192 2025-02-14 \u00b7 3 members</span>

  <span class="dim">#   Name              Tokens          Cost     Calls</span>
  <span class="gold">\u21921   Ada              481,200        $7.22       142</span>
   2   Bob              203,800        $3.06        87
   <span class="dim">3   Carol             98,500        $1.48        53</span>

  <span class="dim">Dashboard: https://ccclub.dev/g/R4NK7D</span></div>
  </div>

  <div class="cta">
    <div class="cta-cmd" onclick="navigator.clipboard.writeText('npx ccclub init');this.querySelector('.copy-msg').style.opacity=1;setTimeout(()=>this.querySelector('.copy-msg').style.opacity=0,2000)">
      <span class="dollar">$</span>npx ccclub init
      <span class="copy-msg" style="position:absolute;right:-70px;top:50%;transform:translateY(-50%);font-size:12px;color:#22c55e;opacity:0;transition:opacity .2s">Copied!</span>
    </div>
    <div class="cta-hint">One command. Takes 10 seconds. After that just use <code style="color:#ededed">ccclub</code> directly.</div>
  </div>

  <div class="section">
    <h2>How it works</h2>
    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <h3>Init</h3>
        <p>Run <code>npx ccclub init</code>, enter your name. You get a 6-letter invite code and a group.</p>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <h3>Invite</h3>
        <p>Friends run <code>npx ccclub join CODE</code>. After that, <code>ccclub</code> works directly.</p>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <h3>Compare</h3>
        <p>Usage syncs every hour. Check <code>ccclub rank</code> or open the web dashboard.</p>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Privacy first</h2>
    <div class="privacy-box">
      <h3>What gets uploaded</h3>
      <div class="privacy-grid">
        <div class="privacy-yes">
          <span>\u2713</span> Token counts (input/output)<br>
          <span>\u2713</span> Cost estimate<br>
          <span>\u2713</span> Model names<br>
          <span>\u2713</span> Number of API calls
        </div>
        <div class="privacy-no">
          <span>\u2717</span> Prompts or responses<br>
          <span>\u2717</span> Code or file contents<br>
          <span>\u2717</span> File paths or project names<br>
          <span>\u2717</span> Session or conversation data
        </div>
      </div>
    </div>
    <p style="color:#666;font-size:14px">
      Run <code style="background:#1a1a1a;padding:2px 6px;border-radius:4px;font-size:13px">ccclub show-data</code> to audit exactly what gets sent before syncing.
      You are private by default\u200a\u2014\u200avisible only in groups you join.
    </p>
  </div>

  <div class="section">
    <h2>Commands</h2>
    <div class="cmd-grid">
      <div class="cmd-card">
        <code>ccclub init</code>
        <p>One-time setup, creates a group</p>
      </div>
      <div class="cmd-card">
        <code>ccclub join &lt;CODE&gt;</code>
        <p>Join a friend's group</p>
      </div>
      <div class="cmd-card">
        <code>ccclub sync</code>
        <p>Manual sync (auto every hour)</p>
      </div>
      <div class="cmd-card">
        <code>ccclub rank</code>
        <p>See today's leaderboard</p>
      </div>
      <div class="cmd-card">
        <code>ccclub rank -p weekly</code>
        <p>This week / monthly / all-time</p>
      </div>
      <div class="cmd-card">
        <code>ccclub rank --global</code>
        <p>Public leaderboard (opt-in)</p>
      </div>
      <div class="cmd-card">
        <code>ccclub profile</code>
        <p>View/edit name, avatar, visibility</p>
      </div>
      <div class="cmd-card">
        <code>ccclub show-data</code>
        <p>Audit what gets uploaded</p>
      </div>
    </div>
  </div>

  <div class="footer">
    <a href="https://github.com/user/ccclub">GitHub</a>
    &nbsp;\u00b7&nbsp; MIT License
    &nbsp;\u00b7&nbsp; Built with Cloudflare Workers
  </div>

</body>
</html>`;
}

export { app as landingRoute };
