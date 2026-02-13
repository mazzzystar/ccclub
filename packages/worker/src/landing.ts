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
  <title>ccclub \u2014 Know how much Claude Code your friends are burning through</title>
  <meta name="description" content="Track and compare Claude Code usage with friends. Create a group, share a code, see the leaderboard together." />

  <!-- Open Graph -->
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://ccclub.dev/" />
  <meta property="og:title" content="ccclub — Compare Claude Code usage with friends" />
  <meta property="og:description" content="Create a group, share a 6-letter code, compare usage. No signup, no config." />

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="ccclub — Compare Claude Code usage with friends" />
  <meta name="twitter:description" content="Create a group, share a 6-letter code, compare usage. No signup, no config." />

  <meta name="theme-color" content="#1a1816" />
  <link rel="canonical" href="https://ccclub.dev/" />
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏆</text></svg>" />
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      background: #1a1816; color: #e8e4de; min-height: 100vh;
      -webkit-font-smoothing: antialiased;
      line-height: 1.6;
    }
    a { color: #d4935e; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code, .mono {
      font-family: "SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace;
    }

    /* Layout */
    .wrap { max-width: 680px; margin: 0 auto; padding: 0 24px; }

    /* Hero */
    .hero { padding: 100px 0 64px; text-align: center; }
    .hero h1 {
      font-size: 42px; font-weight: 700; letter-spacing: -1.5px;
      line-height: 1.15; margin-bottom: 20px; color: #f0ece6;
    }
    .hero .tagline {
      font-size: 18px; color: #9b9590; line-height: 1.6;
      max-width: 440px; margin: 0 auto; font-weight: 400;
    }

    /* Terminal */
    .terminal-wrap { padding: 48px 0; }
    .terminal {
      background: #13110f; border: 1px solid #2e2c2a; border-radius: 10px;
      overflow: hidden;
    }
    .terminal-bar {
      padding: 12px 16px;
      display: flex; align-items: center; gap: 8px;
      border-bottom: 1px solid #2e2c2a;
    }
    .terminal-dot { width: 10px; height: 10px; border-radius: 50%; }
    .terminal-dot.r { background: #e05555; }
    .terminal-dot.y { background: #d4a03e; }
    .terminal-dot.g { background: #5aad7d; }
    .terminal-body {
      padding: 20px 24px; font-size: 13px; line-height: 1.8;
      color: #8a8480; white-space: pre; overflow-x: auto;
    }
    .terminal-body .prompt { color: #5aad7d; }
    .terminal-body .cmd { color: #e8e4de; }
    .terminal-body .dim { color: #5a5550; }
    .terminal-body .accent { color: #d4935e; }
    .terminal-body .gold { color: #d4a03e; }

    /* CTA */
    .cta { padding: 16px 0 80px; text-align: center; }
    .cta-cmd {
      display: inline-block; background: #242220; border: 1px solid #363330;
      border-radius: 8px; padding: 14px 28px; font-size: 16px;
      color: #e8e4de; cursor: pointer; transition: border-color 0.2s;
      position: relative;
    }
    .cta-cmd:hover { border-color: #d4935e; }
    .cta-cmd .dollar { color: #5aad7d; margin-right: 8px; }
    .cta-hint { margin-top: 14px; color: #6b6560; font-size: 14px; }
    .cta-hint code { color: #9b9590; }

    /* Divider */
    .divider {
      border: none; border-top: 1px solid #2e2c2a;
      margin: 0;
    }

    /* Section */
    .section { padding: 64px 0; }
    .section h2 {
      font-size: 22px; font-weight: 600; margin-bottom: 32px;
      letter-spacing: -0.3px; color: #e8e4de;
    }

    /* Steps */
    .steps { display: flex; flex-direction: column; gap: 24px; }
    .step {
      display: flex; gap: 20px; align-items: flex-start;
    }
    .step-num {
      flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%;
      border: 1px solid #363330; color: #9b9590;
      display: flex; align-items: center; justify-content: center;
      font-size: 13px; font-weight: 500; margin-top: 2px;
    }
    .step-content h3 {
      font-size: 15px; font-weight: 500; margin-bottom: 4px; color: #e8e4de;
    }
    .step-content p {
      font-size: 14px; color: #8a8480; line-height: 1.6;
    }
    .step-content code {
      background: #242220; padding: 1px 6px; border-radius: 4px;
      font-size: 13px; color: #c8c4be;
    }

    /* Privacy */
    .privacy-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 32px;
      margin-bottom: 20px;
    }
    .privacy-list { list-style: none; }
    .privacy-list li {
      font-size: 14px; line-height: 2; color: #8a8480;
      display: flex; align-items: center; gap: 8px;
    }
    .privacy-list .icon-yes { color: #5aad7d; font-size: 13px; }
    .privacy-list .icon-no { color: #c45c5c; font-size: 13px; }
    .privacy-note { color: #6b6560; font-size: 14px; line-height: 1.6; }
    .privacy-note code {
      background: #242220; padding: 1px 6px; border-radius: 4px;
      font-size: 13px; color: #c8c4be;
    }

    /* Commands */
    .cmd-list { display: flex; flex-direction: column; gap: 0; }
    .cmd-row {
      display: flex; justify-content: space-between; align-items: baseline;
      padding: 14px 0; border-bottom: 1px solid #2e2c2a;
    }
    .cmd-row:last-child { border-bottom: none; }
    .cmd-row code { font-size: 14px; color: #e8e4de; }
    .cmd-row span { font-size: 14px; color: #6b6560; }

    /* Footer */
    .footer {
      padding: 48px 0;
      border-top: 1px solid #2e2c2a;
      text-align: center; color: #5a5550; font-size: 13px;
    }
    .footer a { color: #6b6560; }

    @media (max-width: 600px) {
      .hero { padding: 64px 0 40px; }
      .hero h1 { font-size: 30px; }
      .privacy-grid { grid-template-columns: 1fr; gap: 16px; }
      .cmd-row { flex-direction: column; gap: 2px; }
    }
  </style>
</head>
<body>

  <div class="wrap">
    <div class="hero">
      <h1>Know how much Claude Code your friends are burning through.</h1>
      <p class="tagline">Create a group, share a 6-letter code, compare usage. No signup, no config.</p>
    </div>
  </div>

  <div class="wrap">
    <div class="terminal-wrap">
      <div class="terminal">
        <div class="terminal-bar">
          <div class="terminal-dot r"></div>
          <div class="terminal-dot y"></div>
          <div class="terminal-dot g"></div>
        </div>
        <div class="terminal-body"><span class="prompt">$</span> <span class="cmd">ccclub rank</span>

  <span class="accent">Ada's club</span>
  <span class="dim">DAILY \u00b7 2025-02-13 \u2192 2025-02-14 \u00b7 3 members</span>

  <span class="dim">#   Name              Tokens          Cost     Calls</span>
  <span class="gold">\u21921   Ada              481,200        $7.22       142</span>
   2   Bob              203,800        $3.06        87
   <span class="dim">3   Carol             98,500        $1.48        53</span>

  <span class="dim">Dashboard: https://ccclub.dev/g/R4NK7D</span></div>
      </div>
    </div>

    <div class="cta">
      <div class="cta-cmd mono" onclick="navigator.clipboard.writeText('npx ccclub init');this.querySelector('.copy-msg').style.opacity=1;setTimeout(()=>this.querySelector('.copy-msg').style.opacity=0,2000)">
        <span class="dollar">$</span>npx ccclub init
        <span class="copy-msg" style="position:absolute;right:-60px;top:50%;transform:translateY(-50%);font-size:12px;color:#5aad7d;opacity:0;transition:opacity .2s">Copied</span>
      </div>
      <div class="cta-hint">One command to start. After that just use <code class="mono">ccclub</code> directly.</div>
    </div>

    <hr class="divider" />

    <div class="section">
      <h2>How it works</h2>
      <div class="steps">
        <div class="step">
          <div class="step-num">1</div>
          <div class="step-content">
            <h3>Initialize</h3>
            <p>Run <code class="mono">npx ccclub init</code> and enter your name. You get a 6-letter invite code.</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num">2</div>
          <div class="step-content">
            <h3>Invite</h3>
            <p>Friends run <code class="mono">npx ccclub join CODE</code>. No account needed.</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num">3</div>
          <div class="step-content">
            <h3>Compare</h3>
            <p>Usage syncs automatically. Check <code class="mono">ccclub rank</code> or open the web dashboard.</p>
          </div>
        </div>
      </div>
    </div>

    <hr class="divider" />

    <div class="section">
      <h2>Privacy</h2>
      <div class="privacy-grid">
        <ul class="privacy-list">
          <li><span class="icon-yes">\u2713</span> Token counts</li>
          <li><span class="icon-yes">\u2713</span> Cost estimates</li>
          <li><span class="icon-yes">\u2713</span> Model names</li>
          <li><span class="icon-yes">\u2713</span> Number of calls</li>
        </ul>
        <ul class="privacy-list">
          <li><span class="icon-no">\u2717</span> Prompts or responses</li>
          <li><span class="icon-no">\u2717</span> Code or file contents</li>
          <li><span class="icon-no">\u2717</span> File paths or projects</li>
          <li><span class="icon-no">\u2717</span> Conversation data</li>
        </ul>
      </div>
      <p class="privacy-note">
        Run <code class="mono">ccclub show-data</code> to audit exactly what gets sent.
      </p>
    </div>

    <hr class="divider" />

    <div class="section">
      <h2>Commands</h2>
      <div class="cmd-list">
        <div class="cmd-row"><code class="mono">ccclub init</code><span>Create a group</span></div>
        <div class="cmd-row"><code class="mono">ccclub join CODE</code><span>Join a friend's group</span></div>
        <div class="cmd-row"><code class="mono">ccclub rank</code><span>Today's leaderboard</span></div>
        <div class="cmd-row"><code class="mono">ccclub rank -p weekly</code><span>Weekly / monthly / all-time</span></div>
        <div class="cmd-row"><code class="mono">ccclub sync</code><span>Manual sync</span></div>
        <div class="cmd-row"><code class="mono">ccclub show-data</code><span>Privacy audit</span></div>
      </div>
    </div>

    <div class="footer">
      <a href="https://github.com/mazzzystar/ccclub">GitHub</a>
      &nbsp;\u00b7&nbsp; MIT License
    </div>
  </div>

</body>
</html>`;
}

export { app as landingRoute };
