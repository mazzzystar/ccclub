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
  <title>ccclub \u2014 Claude Code & Codex Leaderboard Among Friends</title>
  <meta name="description" content="Claude Code and Codex leaderboard among friends. Track coding agent token usage, costs, and active status across Claude Code, Codex, OpenCode, Amp, and pi-agent." />
  <meta name="keywords" content="Claude Code leaderboard, Codex leaderboard, Claude Code usage tracker, Codex usage tracker, coding agent leaderboard, AI coding agent token usage, Claude Code cost tracking, Codex cost tracking, OpenCode usage, Amp usage, pi-agent usage, ccclub" />
  <meta name="application-name" content="ccclub" />

  <!-- Open Graph -->
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://ccclub.dev/" />
  <meta property="og:site_name" content="ccclub" />
  <meta property="og:title" content="ccclub — Claude Code & Codex Leaderboard Among Friends" />
  <meta property="og:description" content="Track Claude Code, Codex, OpenCode, Amp, and pi-agent token usage, costs, and active status with friends." />
  <meta property="og:image" content="https://ccclub.dev/og.png" />
  <meta property="og:image:width" content="1264" />
  <meta property="og:image:height" content="756" />

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="ccclub — Claude Code & Codex Leaderboard Among Friends" />
  <meta name="twitter:description" content="A Claude Code and Codex leaderboard among friends for token usage, costs, and active status." />
  <meta name="twitter:image" content="https://ccclub.dev/og.png" />

  <meta name="theme-color" content="#1a1816" />
  <link rel="canonical" href="https://ccclub.dev/" />
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏆</text></svg>" />

  <!-- Google tag (gtag.js) -->
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
      --bg: #1a1816;
      --panel: #201e1c;
      --panel-soft: #24211f;
      --line: #332f2b;
      --text: #e8e4de;
      --title: #f1ede7;
      --muted: #8a8480;
      --faint: #5a5550;
      --brand: #d4935e;
      --link: #7ab7c6;
      --success: #63b486;
      --gold: #d6b56d;
      --silver: #aeb7bf;
      --bronze: #c58a61;
      --paper: #f4f1ed;
      --paper-soft: #e9e5df;
      --ink: #181615;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      background: var(--bg); color: var(--text); min-height: 100vh;
      -webkit-font-smoothing: antialiased;
      line-height: 1.6;
    }
    a { color: var(--link); text-decoration: none; }
    a:hover { text-decoration: underline; }
    code, .mono {
      font-family: "SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace;
    }

    /* Layout */
    .wrap { max-width: 760px; margin: 0 auto; padding: 0 24px; }

    /* Brand */
    .brand {
      display: flex; align-items: center; gap: 8px;
      padding-top: 24px; text-decoration: none;
    }
    .brand img { border-radius: 6px; }
    .brand span {
      font-size: 16px; font-weight: 600; color: var(--muted);
      letter-spacing: -0.3px;
    }
    .brand:hover span { color: var(--text); }

    /* Hero */
    .hero { padding: 42px 0 26px; text-align: center; }
    .eyebrow {
      display: inline-flex; align-items: center; gap: 8px;
      color: var(--brand); font-size: 12px; font-weight: 600;
      letter-spacing: 0.08em; text-transform: uppercase;
      margin-bottom: 14px;
    }
    .eyebrow::before, .eyebrow::after {
      content: ""; width: 22px; height: 1px; background: var(--line);
    }
    .hero h1 {
      font-size: clamp(34px, 6vw, 56px); font-weight: 720; letter-spacing: -1.8px;
      line-height: 0.98; margin-bottom: 18px; color: var(--title);
    }
    .hero .tagline {
      font-size: 18px; color: var(--muted); line-height: 1.6;
      max-width: 590px; margin: 0 auto; font-weight: 400;
    }
    .hero-links { display: flex; gap: 16px; justify-content: center; margin-top: 18px; }
    .hero-links a { display: flex; align-items: center; color: var(--muted); opacity: 0.65; transition: all 0.15s ease; }
    .hero-links a:hover { color: var(--link); opacity: 1; }
    .hero-links svg { fill: var(--muted); }
    .preview-wrap { padding: 4px 0 30px; }
    .preview-frame {
      display: block; border-radius: 16px; overflow: hidden;
      border: 1px solid rgba(255,255,255,0.08);
      background: var(--panel); box-shadow: 0 22px 70px rgba(0,0,0,0.38);
      text-decoration: none;
    }
    .preview-frame:hover { text-decoration: none; border-color: rgba(122,183,198,0.32); }
    .preview-frame:hover .preview-title { color: var(--link); }
    .preview-frame img {
      display: block; width: 100%; height: auto; aspect-ratio: 1264 / 756; object-fit: cover;
    }
    .preview-caption {
      display: flex; justify-content: space-between; gap: 16px;
      padding: 12px 16px; color: var(--muted); font-size: 12px;
      border-top: 1px solid rgba(255,255,255,0.06); background: #151310;
    }
    .preview-title {
      display: inline-flex; align-items: center; gap: 8px;
      color: var(--text); font-weight: 500; transition: color 0.15s ease;
    }
    .live-dot {
      width: 7px; height: 7px; border-radius: 999px; flex: 0 0 auto;
      background: #5fdc8f; box-shadow: 0 0 0 0 rgba(95,220,143,0.5);
      animation: livePulse 1.8s ease-out infinite;
    }
    @keyframes livePulse {
      0% { box-shadow: 0 0 0 0 rgba(95,220,143,0.42); }
      70% { box-shadow: 0 0 0 7px rgba(95,220,143,0); }
      100% { box-shadow: 0 0 0 0 rgba(95,220,143,0); }
    }
    .setup-panel {
      margin: 28px auto 0; max-width: 620px; padding: 10px;
      border-radius: 18px; background: var(--paper); color: var(--ink);
      box-shadow: 0 24px 70px rgba(0,0,0,0.28), 0 0 0 1px rgba(255,255,255,0.08);
    }
    .setup-tabs {
      display: grid; grid-template-columns: 1fr 1fr; gap: 4px;
      padding: 4px; border-radius: 13px; background: var(--paper-soft);
      box-shadow: inset 0 0 0 1px rgba(0,0,0,0.04);
    }
    .setup-tab {
      border: none; border-radius: 10px; padding: 12px 14px;
      background: transparent; color: #766f68; cursor: pointer;
      display: flex; justify-content: center; align-items: center; gap: 8px;
      font: inherit; font-size: 16px; line-height: 1; transition: all 0.18s ease;
    }
    .setup-tab svg { width: 18px; height: 18px; }
    .setup-tab.active {
      background: #fff; color: #151312;
      box-shadow: 0 4px 14px rgba(0,0,0,0.08), inset 0 0 0 1px rgba(0,0,0,0.04);
    }
    .setup-body { padding: 24px 16px 18px; text-align: center; }
    .setup-title {
      font-size: 21px; line-height: 1.45; font-weight: 700;
      letter-spacing: -0.2px; max-width: 470px; margin: 0 auto;
    }
    .setup-subtitle {
      color: #7b746e; font-size: 13px; line-height: 1.5;
      max-width: 480px; margin: 8px auto 0;
    }
    .supported-card {
      display: flex; align-items: center; justify-content: center; gap: 14px;
      margin: 22px auto 0; color: #605951;
    }
    .agent-stack { display: flex; align-items: center; flex-shrink: 0; padding-left: 12px; }
    .agent-logo {
      width: 36px; height: 36px; border-radius: 50%; background: #fff;
      border: 2px solid #f4f1ed; display: flex; align-items: center; justify-content: center;
      box-shadow: 0 5px 18px rgba(0,0,0,0.12); margin-left: -12px; overflow: hidden;
    }
    .agent-logo img { width: 20px; height: 20px; display: block; }
    .agent-logo.pi { background: #181615; color: #f4f1ed; font-size: 15px; font-weight: 700; }
    .supported-copy { text-align: left; min-width: 0; }
    .supported-copy strong {
      display: block; color: #181615; font-size: 13px; line-height: 1.2;
    }
    .supported-copy span {
      display: block; color: #7b746e; font-size: 12px; line-height: 1.4; margin-top: 2px;
    }
    .setup-command {
      width: 100%; margin-top: 22px; border: none; border-radius: 13px;
      background: #181615; color: var(--paper); padding: 14px 16px;
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      cursor: pointer; font: inherit; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08);
    }
    .setup-command:hover { background: #24211e; }
    .setup-command code {
      color: #75c993; font-size: 13px; line-height: 1.4;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .copy-icon {
      width: 20px; height: 20px; color: #a8a19a; flex: 0 0 auto;
    }
    .copy-feedback {
      min-height: 18px; margin-top: 9px; color: #3f8f5a;
      font-size: 12px; opacity: 0; transition: opacity 0.18s ease;
    }
    .copy-feedback.show { opacity: 1; }
    .setup-after-demo { padding: 0 0 64px; }

    /* Divider */
    .divider {
      border: none; border-top: 1px solid var(--line);
      margin: 0;
    }

    /* Section */
    .section { padding: 64px 0; }
    .section h2 {
      font-size: 22px; font-weight: 600; margin-bottom: 32px;
      letter-spacing: -0.3px; color: var(--text);
    }

    /* Steps */
    .steps { display: flex; flex-direction: column; gap: 24px; }
    .step {
      display: flex; gap: 20px; align-items: flex-start;
    }
    .step-num {
      flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%;
      border: 1px solid var(--line); color: var(--muted);
      display: flex; align-items: center; justify-content: center;
      font-size: 13px; font-weight: 500; margin-top: 2px;
    }
    .step-content h3 {
      font-size: 15px; font-weight: 500; margin-bottom: 4px; color: var(--text);
    }
    .step-content p {
      font-size: 14px; color: var(--muted); line-height: 1.6;
    }
    .step-content code {
      background: var(--panel-soft); padding: 1px 6px; border-radius: 4px;
      font-size: 13px; color: var(--text);
    }

    /* How-detail */
    .how-detail {
      margin-top: 24px; color: var(--muted); font-size: 14px; line-height: 1.7;
    }
    .how-detail code {
      background: var(--panel-soft); padding: 1px 6px; border-radius: 4px;
      font-size: 13px; color: var(--text);
    }

    /* Commands */
    .cmd-list { display: flex; flex-direction: column; gap: 0; }
    .cmd-row {
      display: flex; justify-content: space-between; align-items: baseline;
      padding: 14px 0; border-bottom: 1px solid var(--line);
    }
    .cmd-row:last-child { border-bottom: none; }
    .cmd-row code { font-size: 14px; color: var(--text); }
    .cmd-row span { font-size: 14px; color: var(--muted); }

    /* Footer */
    .footer {
      padding: 48px 0;
      border-top: 1px solid var(--line);
      text-align: center; color: var(--faint); font-size: 13px;
    }
    .footer a { color: var(--muted); }

    @media (max-width: 600px) {
      .hero { padding: 32px 0 22px; }
      .hero h1 { font-size: 36px; letter-spacing: -1.2px; }
      .preview-caption { flex-direction: column; gap: 2px; }
      .setup-panel { border-radius: 16px; }
      .setup-tab { font-size: 14px; padding: 11px 8px; }
      .setup-title { font-size: 18px; }
      .supported-card { flex-direction: column; gap: 8px; }
      .supported-copy { text-align: center; }
      .setup-command { align-items: flex-start; }
      .setup-command code {
        font-size: 12px; white-space: normal; overflow: visible;
        text-overflow: clip; text-align: left;
      }
      .cmd-row { flex-direction: column; gap: 2px; }
    }
  </style>
</head>
<body>

  <div class="wrap">
    <a href="/" class="brand"><img src="https://raw.githubusercontent.com/mazzzystar/ccclub/main/assets/icon.png" alt="ccclub" width="28" height="28" /><span>ccclub</span></a>
    <div class="hero">
      <div class="eyebrow">Among friends</div>
      <h1>Claude Code & Codex leaderboard among friends.</h1>
      <p class="tagline">Track coding agent token usage, cost, active status, and agent mix across Claude Code, Codex, OpenCode, Amp, and pi-agent.</p>
      <div class="hero-links">
        <a href="https://github.com/mazzzystar/ccclub" target="_blank" rel="noopener" aria-label="GitHub"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg></a>
        <a href="https://discord.gg/6QbGWJUVHq" target="_blank" rel="noopener" aria-label="Discord"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg></a>
      </div>
    </div>
  </div>

  <div class="wrap">
    <div class="preview-wrap">
      <a class="preview-frame" href="https://ccclub.dev/g/YHAW6P" aria-label="Open the live ccclub leaderboard preview">
        <img src="/og.png" alt="ccclub leaderboard preview" width="1264" height="756" />
        <div class="preview-caption">
          <strong class="preview-title"><span class="live-dot" aria-hidden="true"></span>Live leaderboard preview</strong>
          <span>Cost · tokens · turns · active friends · agent mix</span>
        </div>
      </a>
    </div>

    <div class="setup-after-demo">
      <div class="setup-panel">
        <div class="setup-tabs" role="tablist" aria-label="Setup mode">
          <button class="setup-tab active" type="button" data-setup-mode="agent" role="tab" aria-selected="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="6" y="8" width="12" height="9" rx="2"/><path d="M12 5v3M9 17v2m6-2v2M8.5 12h.01M15.5 12h.01M4 11v3m16-3v3"/></svg>
            I'm Agent
          </button>
          <button class="setup-tab" type="button" data-setup-mode="human" role="tab" aria-selected="false">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><circle cx="12" cy="8" r="3.4"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></svg>
            I'm Human
          </button>
        </div>
        <div class="setup-body">
          <p class="setup-title" id="setup-title">Send this prompt to your coding agent.</p>
          <p class="setup-subtitle" id="setup-subtitle">It will install ccclub, initialize your group, and keep supported agent usage fresh with almost no setup.</p>
          <div class="supported-card" aria-label="Supported coding agents">
            <div class="agent-stack">
              <span class="agent-logo" title="Claude Code"><img src="/agent-icons/claude.svg" alt="Claude Code" /></span>
              <span class="agent-logo" title="Codex"><img src="/agent-icons/codex.svg" alt="Codex" /></span>
              <span class="agent-logo" title="OpenCode"><img src="/agent-icons/opencode.svg" alt="OpenCode" /></span>
              <span class="agent-logo" title="Amp"><img src="/agent-icons/amp.svg" alt="Amp" /></span>
              <span class="agent-logo pi" title="pi-agent">π</span>
            </div>
            <div class="supported-copy">
              <strong>Supported agents</strong>
              <span>Claude Code · Codex · OpenCode · Amp · pi-agent</span>
            </div>
          </div>
          <button class="setup-command" id="copy-setup" type="button" data-copy="Read https://ccclub.dev/llms-full.txt">
            <code class="mono" id="setup-code">Read https://ccclub.dev/llms-full.txt</code>
            <svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 16H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
          <div class="copy-feedback" id="copy-feedback">Copied</div>
        </div>
      </div>
    </div>

    <hr class="divider" />

    <div class="section">
      <h2>How it works</h2>
      <div class="steps">
        <div class="step">
          <div class="step-num">1</div>
          <div class="step-content">
            <h3>Initialize</h3>
            <p>Run <code class="mono">npx ccclub init</code> and enter your name. You get an invite link to share.</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num">2</div>
          <div class="step-content">
            <h3>Invite</h3>
            <p>Share your invite link or have friends run <code class="mono">npx ccclub join CODE</code>. No account needed.</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num">3</div>
          <div class="step-content">
            <h3>See the leaderboard</h3>
            <p>Claude Code syncs at session end, and background sync picks up Codex, OpenCode, Amp, and pi-agent. Run <code class="mono">ccclub</code> or open the web dashboard.</p>
          </div>
        </div>
      </div>
      <div class="how-detail">
        <p>ccclub reads token counts, cost estimates, model names, and number of calls from local coding agent logs for Claude Code, Codex, OpenCode, Amp, and pi-agent. No prompts, responses, code, file paths, or conversation data ever leave your machine.</p>
        <p style="margin-top:8px">Run <code class="mono">ccclub show-data</code> to see exactly what gets uploaded.</p>
      </div>
    </div>

    <hr class="divider" />

    <div class="section">
      <h2>Commands</h2>
      <div class="cmd-list">
        <div class="cmd-row"><code class="mono">ccclub init</code><span>Create a group</span></div>
        <div class="cmd-row"><code class="mono">ccclub join CODE</code><span>Join a friend's group</span></div>
        <div class="cmd-row"><code class="mono">ccclub</code><span>Today's leaderboard (active members only)</span></div>
        <div class="cmd-row"><code class="mono">ccclub --all</code><span>Show everyone, including those with no activity</span></div>
        <div class="cmd-row"><code class="mono">ccclub --no-cache</code><span>Exclude cache tokens from count</span></div>
        <div class="cmd-row"><code class="mono">ccclub -d 1</code><span>Yesterday / 7 / 30 / all</span></div>
        <div class="cmd-row"><code class="mono">ccclub sync</code><span>Manual sync (auto-sync also runs in background)</span></div>
        <div class="cmd-row"><code class="mono">ccclub show-data</code><span>Privacy audit</span></div>
      </div>
    </div>

    <div class="footer">
      <a href="https://github.com/mazzzystar/ccclub" target="_blank" rel="noopener">GitHub</a>
      &nbsp;\u00b7&nbsp;
      <a href="https://discord.gg/6QbGWJUVHq" target="_blank" rel="noopener">Discord</a>
      &nbsp;\u00b7&nbsp; MIT License
    </div>
  </div>

  <script>
    var setupModes = {
      agent: {
        title: "Send this prompt to your coding agent.",
        subtitle: "It will install ccclub, initialize your group, and keep supported agent usage fresh with almost no setup.",
        copy: "Read https://ccclub.dev/llms-full.txt"
      },
      human: {
        title: "Run one command and start your club.",
        subtitle: "ccclub auto-detects supported local agent logs. Friends can join with the invite code it prints.",
        copy: "npx ccclub init"
      }
    };
    function setSetupMode(mode) {
      var data = setupModes[mode];
      if (!data) return;
      document.querySelectorAll(".setup-tab").forEach(function(tab) {
        var active = tab.getAttribute("data-setup-mode") === mode;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", active ? "true" : "false");
      });
      document.getElementById("setup-title").textContent = data.title;
      document.getElementById("setup-subtitle").textContent = data.subtitle;
      document.getElementById("setup-code").textContent = data.copy;
      document.getElementById("copy-setup").setAttribute("data-copy", data.copy);
    }
    document.querySelectorAll(".setup-tab").forEach(function(tab) {
      tab.addEventListener("click", function() {
        setSetupMode(tab.getAttribute("data-setup-mode"));
      });
    });
    document.getElementById("copy-setup").addEventListener("click", function() {
      var feedback = document.getElementById("copy-feedback");
      navigator.clipboard.writeText(this.getAttribute("data-copy") || "").then(function() {
        feedback.classList.add("show");
        setTimeout(function() { feedback.classList.remove("show"); }, 1800);
      });
    });
  </script>
</body>
</html>`;
}

export { app as landingRoute };
