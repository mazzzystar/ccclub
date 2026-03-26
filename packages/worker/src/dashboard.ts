import { Hono } from "hono";
import { html } from "hono/html";
import type { Env } from "./types.js";

const app = new Hono<{ Bindings: Env }>();

function sanitizeCode(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, "");
}

app.get("/g/:code", (c) => {
  const code = sanitizeCode(c.req.param("code"));
  if (!code) return c.text("Invalid code", 400);
  return c.html(dashboardHTML(code));
});

function dashboardHTML(code: string) {
  const isGlobal = code.toLowerCase() === "global";
  return html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ccclub \u2014 Leaderboard</title>
  <meta name="description" content="Claude Code leaderboard among friends" />

  <meta property="og:type" content="website" />
  <meta property="og:title" content="ccclub \u2014 Leaderboard" />
  <meta property="og:description" content="Claude Code leaderboard among friends. See how you're all doing." />
  <meta property="og:url" content="https://ccclub.dev/g/${code}" />

  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="ccclub \u2014 Leaderboard" />
  <meta name="twitter:description" content="Claude Code leaderboard among friends. See how you're all doing." />

  <meta name="theme-color" content="#1a1816" />
  <link rel="canonical" href="https://ccclub.dev/g/${code}" />
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
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      background: #1a1816; color: #e8e4de; min-height: 100vh;
      -webkit-font-smoothing: antialiased;
      line-height: 1.6;
    }
    code { font-family: "SF Mono", "Fira Code", Menlo, Consolas, monospace; }

    .wrap { max-width: 640px; margin: 0 auto; padding: 48px 24px; }

    /* Top nav */
    .top-nav {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 20px;
    }

    /* Back link */
    .back-link {
      color: #6b6560; font-size: 13px; text-decoration: none;
      transition: color 0.15s;
    }
    .back-link:hover { color: #c8c4be; }

    .global-link {
      color: #6b6560; font-size: 13px; text-decoration: none;
      transition: color 0.15s;
    }
    .global-link:hover { color: #c8c4be; }

    /* Header */
    h1 { font-size: 24px; font-weight: 600; letter-spacing: -0.5px; color: #f0ece6; }
    .subtitle { color: #6b6560; font-size: 13px; margin-top: 4px; }

    /* Period selector */
    .periods { display: flex; gap: 6px; margin: 28px 0; flex-wrap: wrap; align-items: center; }
    .periods button {
      padding: 6px 14px; border-radius: 6px; border: 1px solid #363330;
      background: transparent; color: #8a8480; cursor: pointer;
      font-size: 13px; font-family: inherit;
      transition: all 0.15s ease;
    }
    .periods button:hover:not(.toggle) { border-color: #5a5550; color: #c8c4be; }
    .periods button.active {
      background: #2a2826; color: #e8e4de; border-color: #4a4640;
    }

    /* Cache toggle */
    .toggle-wrap {
      margin-left: auto; display: flex; align-items: center; gap: 6px;
    }
    .toggle-label { font-size: 12px; color: #6b6560; user-select: none; cursor: pointer; }
    .periods button.toggle,
    .toggle {
      position: relative; width: 32px; height: 18px; cursor: pointer;
      background: #363330; border-radius: 9px; border: none; outline: none;
      padding: 0; transition: background 0.2s;
    }
    .toggle::after {
      content: ""; position: absolute; top: 2px; left: 2px;
      width: 14px; height: 14px; border-radius: 50%;
      background: #6b6560; transition: all 0.2s;
    }
    .periods button.toggle.on,
    .toggle.on { background: #5aad7d; }
    .toggle.on::after { left: 16px; background: #e8e4de; }

    /* Table */
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th {
      color: #5a5550; font-size: 11px; text-transform: uppercase;
      letter-spacing: 0.5px; font-weight: 500;
      text-align: left; padding: 8px 12px;
      border-bottom: 1px solid #2e2c2a;
    }
    td { padding: 14px 12px; border-bottom: 1px solid #242220; }
    tr:hover { background: rgba(255,255,255,0.015); }
    .rank { font-weight: 600; width: 40px; color: #6b6560; }
    .rank.top { color: #d4a03e; }
    .name-cell { display: flex; align-items: center; gap: 12px; }
    .name-cell > div:last-child { flex: 1; min-width: 0; }
    .avatar-wrap { position: relative; flex-shrink: 0; width: 32px; height: 32px; }
    .avatar {
      width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      font-weight: 600; font-size: 13px; color: #1a1816;
    }
    .active-dot {
      position: absolute; top: 1px; right: 1px;
      width: 6px; height: 6px; border-radius: 50%;
      background: #4ade80; box-shadow: 0 0 0 2px #1a1816;
      animation: breathe 3s infinite ease-in-out;
    }
    @keyframes breathe {
      0%, 100% { opacity: 0.5; transform: scale(0.85); }
      50% { opacity: 1; transform: scale(1); }
    }
    .avatar img {
      width: 32px; height: 32px; border-radius: 50%; object-fit: cover;
    }
    .avatar img.errored { display: none; }
    .avatar .fallback { display: none; }
    .avatar img.errored + .fallback { display: flex; }
    .name-text { font-weight: 500; font-size: 14px; }
    .active-count { color: #5aad7d; font-size: 13px; margin-top: 4px; position: relative; display: inline-block; }
    .name-link { color: #6ba3be; text-decoration: none; }
    .name-link:hover { text-decoration: underline; }
    .bar {
      height: 3px; background: #d4935e; border-radius: 2px; margin-top: 6px;
      opacity: 0.5; transition: width 0.3s;
    }
    .tokens { color: #8a8480; font-variant-numeric: tabular-nums; font-size: 14px; }
    .cost { font-variant-numeric: tabular-nums; font-size: 14px; }
    .roi { font-variant-numeric: tabular-nums; font-size: 13px; white-space: nowrap; }
    .roi .price { color: #6b6560; }
    .roi .pct { font-weight: 500; }
    .roi .pct.high { color: #5aad7d; }
    .roi .pct.mid { color: #d4a03e; }
    .roi .pct.low { color: #6b6560; }
    .usage { font-family: "SF Mono", "Fira Code", Menlo, Consolas, monospace; color: #8a8480; font-size: 13px; white-space: nowrap; }
    .calls { color: #6b6560; font-size: 14px; }

    /* Activity chart */
    .chart-section { margin-top: 32px; }
    .chart-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 16px;
    }
    .chart-title { font-size: 15px; font-weight: 500; color: #e8e4de; }
    .chart-canvas {
      background: #13110f; border-radius: 8px; padding: 16px;
      border: 1px solid rgba(255,255,255,0.06);
    }
    .chart-canvas svg { width: 100%; display: block; }
    .chart-legend {
      display: flex; flex-wrap: wrap; gap: 12px; margin-top: 10px;
      padding: 0 4px;
    }
    .chart-legend-item {
      display: flex; align-items: center; gap: 5px;
      font-size: 12px; color: #8a8480; cursor: pointer; user-select: none;
    }
    .chart-legend-item.hidden { opacity: 0.4; }
    .chart-legend-dot {
      width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
    }
    .chart-canvas { position: relative; }
    .chart-tooltip {
      position: absolute; pointer-events: none; opacity: 0;
      background: #1e1c1a; border: 1px solid rgba(255,255,255,0.12);
      border-radius: 6px; padding: 6px 10px; font-size: 12px;
      color: #e8e4de; white-space: nowrap; z-index: 10;
      transition: opacity 0.15s;
    }
    .chart-tooltip.visible { opacity: 1; }

    /* Empty */
    .empty { text-align: center; color: #5a5550; padding: 64px 0; font-size: 14px; line-height: 1.8; }

    /* Invite */
    .invite {
      margin-top: 40px; padding: 20px; background: #242220; border-radius: 10px;
      display: flex; align-items: center; justify-content: space-between;
    }
    .invite-label { color: #6b6560; font-size: 13px; margin-bottom: 4px; }
    .invite-code {
      font-family: "SF Mono", Menlo, monospace;
      font-size: 14px; letter-spacing: 0.5px; font-weight: 600; color: #e8e4de;
    }
    .copy-btn {
      padding: 8px 16px; border-radius: 6px; border: 1px solid #363330;
      background: transparent; color: #8a8480; cursor: pointer;
      font-size: 13px; font-family: inherit; transition: all 0.15s ease;
    }
    .copy-btn:hover { border-color: #5a5550; color: #c8c4be; }

    /* Footer */
    .meta { color: #3a3835; font-size: 12px; margin-top: 24px; text-align: center; }

    @media (max-width: 600px) {
      .wrap { padding: 32px 16px; }
      th:nth-last-child(1), td:nth-last-child(1) { display: none; }
      .hide-mobile { display: none; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top-nav">
      <a href="/" class="back-link" id="back-link">\u2190 ${isGlobal ? "My Club" : "Home"}</a>
      ${isGlobal ? html`` : html`<a href="/g/global" class="global-link">Global \u2192</a>`}
    </div>
    <h1 id="title"></h1>
    <div class="subtitle" id="date-range"></div>
    <div class="active-count" id="active-count"></div>

    <div class="periods">
      <button class="active" data-period="daily">Today</button>
      <button data-period="yesterday">Yesterday</button>
      <button data-period="weekly">7d</button>
      <button data-period="monthly">30d</button>
      <button data-period="all-time">All Time</button>
      <div class="toggle-wrap">
        <span class="toggle-label" id="cache-label">Cache</span>
        <button class="toggle" id="cache-toggle" aria-label="Include cache tokens"></button>
      </div>
    </div>

    <div id="content"></div>

    <div class="chart-section">
      <div class="chart-header">
        <span class="chart-title">Activity</span>
      </div>
      <div class="chart-canvas" id="chart"></div>
    </div>

    ${isGlobal ? html`` : html`
    <div class="invite">
      <div>
        <div class="invite-label">Invite friends to join</div>
        <div class="invite-code" id="invite-code-display"></div>
      </div>
      <button class="copy-btn" id="copy-btn">Copy<span class="hide-mobile"> command</span></button>
    </div>`}

    <div class="meta" id="refresh-info"></div>
    <div class="meta" style="margin-top:16px;display:flex;align-items:center;justify-content:center;gap:12px">
      <a href="/" style="color:#6b6560;text-decoration:none">\u2190 Home</a>
      <a href="https://github.com/mazzzystar/ccclub" style="display:flex;align-items:center;opacity:0.5" aria-label="GitHub"><svg width="16" height="16" viewBox="0 0 24 24" fill="#6b6560"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg></a>
      <a href="https://discord.gg/6QbGWJUVHq" style="display:flex;align-items:center;opacity:0.5" aria-label="Discord"><svg width="18" height="18" viewBox="0 0 24 24" fill="#6b6560"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z"/></svg></a>
    </div>
  </div>

  <script>
    var CODE = "${code}";
    var IS_GLOBAL = ${isGlobal ? "true" : "false"};
    var period = "daily";
    var showCache = false;
    var ACTIVE_THRESHOLD_MS = 15 * 60 * 1000;

    // Global page: back link goes to referrer group or fallback to home
    if (IS_GLOBAL) {
      var backLink = document.getElementById("back-link");
      if (backLink) {
        var ref = document.referrer;
        var groupMatch = ref && ref.match(/\\/g\\/([a-zA-Z0-9]+)/);
        if (groupMatch && groupMatch[1].toLowerCase() !== "global") {
          backLink.href = "/g/" + groupMatch[1];
        }
      }
    }

    var cacheToggle = document.getElementById("cache-toggle");
    var cacheLabel = document.getElementById("cache-label");
    cacheToggle.addEventListener("click", function() {
      showCache = !showCache;
      cacheToggle.classList.toggle("on", showCache);
      load();
    });
    cacheLabel.addEventListener("click", function() {
      cacheToggle.click();
    });

    var inviteEl = document.getElementById("invite-code-display");
    if (inviteEl) inviteEl.textContent = "npx ccclub join " + CODE;
    var copyBtn = document.getElementById("copy-btn");
    if (copyBtn) {
      copyBtn.addEventListener("click", function() {
        navigator.clipboard.writeText("npx ccclub join " + CODE);
        this.textContent = "Copied!";
        var btn = this;
        setTimeout(function() { btn.textContent = "Copy"; }, 2000);
      });
    }

    var AVATAR_COLORS = [
      "#c45c5c","#d4845a","#d4a03e","#8aaa5a","#5aad7d",
      "#4a9b8a","#4a8aaa","#5a7aaa","#7a6aaa","#9a5aaa",
      "#aa5a8a","#c46a7a"
    ];
    function hashCode(str) {
      var h = 0;
      for (var i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
      return Math.abs(h);
    }
    function getAvatarColor(userId) {
      return AVATAR_COLORS[hashCode(userId) % AVATAR_COLORS.length];
    }
    function avatarHTML(userId, displayName, avatarUrl, isActive) {
      var initial = esc((displayName || "?").charAt(0).toUpperCase());
      var color = getAvatarColor(userId);
      var dot = isActive ? '<div class="active-dot"></div>' : '';
      if (avatarUrl) {
        return '<div class="avatar-wrap">' +
          '<div class="avatar">' +
          '<img src="' + esc(avatarUrl) + '" alt="" onerror="this.classList.add(&#39;errored&#39;)">' +
          '<span class="fallback avatar" style="background:' + color + ';width:32px;height:32px;display:none;align-items:center;justify-content:center">' + initial + '</span>' +
          '</div>' + dot + '</div>';
      }
      return '<div class="avatar-wrap"><div class="avatar" style="background:' + color + '">' + initial + '</div>' + dot + '</div>';
    }

    document.querySelectorAll(".periods button[data-period]").forEach(function(btn) {
      btn.addEventListener("click", function() {
        document.querySelectorAll(".periods button").forEach(function(b) { b.classList.remove("active"); });
        btn.classList.add("active");
        period = btn.dataset.period;
        load();
        loadChart();
      });
    });

    function load() {
      var apiPath = IS_GLOBAL ? "/api/rank/global" : "/api/rank/" + encodeURIComponent(CODE);
      var tz = -new Date().getTimezoneOffset();
      fetch(apiPath + "?period=" + period + "&tz=" + tz)
        .then(function(res) { return res.json(); })
        .then(function(data) {
          document.getElementById("title").textContent = data.group.name;
          document.getElementById("date-range").textContent =
            data.start.slice(0,10) + " \u2014 " + data.end.slice(0,10) +
            " \u00b7 " + data.group.memberCount + (IS_GLOBAL ? " public users" : " members");

          var now = Date.now();
          var activeCount = data.rankings.filter(function(r) {
            return r.lastSync && (now - new Date(r.lastSync).getTime()) < ACTIVE_THRESHOLD_MS;
          }).length;
          var activeEl = document.getElementById("active-count");
          activeEl.innerHTML = activeCount > 0 ? '<span style="position:relative">' + activeCount + ' active<div class="active-dot" style="position:absolute;top:-2px;right:-10px"></div></span>' : "";

          if (data.rankings.length === 0) {
            document.getElementById("content").innerHTML =
              '<div class="empty">' + (IS_GLOBAL
                ? 'No public users yet.<br>Set your profile to public with: ccclub profile --public'
                : 'No usage data for this period yet.<br>Run: ccclub sync') + '</div>';
            return;
          }

          var maxCost = 0;
          data.rankings.forEach(function(r) { if (r.costUSD > maxCost) maxCost = r.costUSD; });
          var hasPlan = data.rankings.some(function(r) { return r.plan; });
          var hasUsage = data.rankings.some(function(r) { return r.usageSnapshot; });
          var PLAN_PRICES = { pro: 20, max100: 100, max200: 200, api: 0 };
          var h = '<table><thead><tr><th>#</th><th>Name</th><th>Cost</th><th>Tokens</th>';
          if (hasPlan) h += '<th>Monthly ROI</th>';
          h += '<th>Chats</th><th>$/Chat</th>';
          if (hasUsage) h += '<th>Usage 7d</th>';
          h += '</tr></thead><tbody>';

          data.rankings.forEach(function(r) {
            var pct = maxCost > 0 ? (r.costUSD / maxCost * 100) : 0;
            var rankClass = r.rank <= 3 ? "rank top" : "rank";
            var isActive = r.lastSync && (now - new Date(r.lastSync).getTime()) < ACTIVE_THRESHOLD_MS;
            h += '<tr>' +
              '<td class="' + rankClass + '">' + r.rank + '</td>' +
              '<td><div class="name-cell">' + avatarHTML(r.userId, r.displayName, r.avatar, isActive) +
                '<div><div class="name-text">' + (r.url ? '<a href="' + esc(r.url) + '" target="_blank" rel="noopener" class="name-link">' + esc(r.displayName) + '</a>' : esc(r.displayName)) + '</div>' +
                '<div class="bar" style="width:' + pct + '%"></div></div></div></td>' +
              '<td class="cost">$' + r.costUSD.toFixed(2) + '</td>' +
              '<td class="tokens">' + formatTokens(showCache ? r.totalTokens : (r.inputTokens + r.outputTokens)) + '</td>';
            if (hasPlan) {
              if (r.plan && r.plan !== "api") {
                var price = PLAN_PRICES[r.plan] || 0;
                var monthly = r.monthlyCostUSD || 0;
                var roi = price > 0 ? Math.round(monthly / price * 100) : 0;
                var pctClass = roi >= 100 ? "pct high" : roi >= 50 ? "pct mid" : "pct low";
                h += '<td class="roi"><span class="price">$' + price + '/</span><span class="' + pctClass + '">' + roi + '%</span></td>';
              } else if (r.plan === "api") {
                h += '<td class="roi"><span class="pct low">API</span></td>';
              } else {
                h += '<td class="roi"><span class="pct low">\u2014</span></td>';
              }
            }
            var chats = r.chatCount || 0;
            var perChat = chats > 0 ? '$' + (r.costUSD / chats).toFixed(2) : '\u2014';
            h += '<td class="calls">' + chats + '</td><td class="cost">' + perChat + '</td>';
            if (hasUsage) {
              if (r.usageSnapshot) {
                var snapshotTitle = "7d rolling \u00b7 as of " + new Date(r.usageSnapshot.snapshotAt).toLocaleString();
                h += '<td class="usage" title="' + esc(snapshotTitle) + '">' + Math.round(r.usageSnapshot.sevenDay) + '%</td>';
              } else {
                h += '<td class="usage"><span style="color:#4a4640">\u2014</span></td>';
              }
            }
            h += '</tr>';
          });
          h += '</tbody></table>';
          document.getElementById("content").innerHTML = h;
          document.getElementById("refresh-info").textContent =
            "Last updated " + new Date().toLocaleTimeString();
        })
        .catch(function() {
          document.getElementById("content").innerHTML =
            '<div class="empty">Couldn\\'t load the leaderboard. Try refreshing.</div>';
        });
    }

    function formatTokens(n) {
      if (n >= 1000000000) { var b = n / 1000000000; return (b % 1 === 0 ? b : parseFloat(b.toFixed(1))) + "B"; }
      if (n >= 1000000) { var m = n / 1000000; return (m % 1 === 0 ? m : parseFloat(m.toFixed(1))) + "M"; }
      if (n >= 1000) { var k = n / 1000; return (k % 1 === 0 ? k : parseFloat(k.toFixed(1))) + "K"; }
      return String(n);
    }
    function esc(s) {
      var d = document.createElement("div"); d.textContent = s; return d.innerHTML;
    }

    // Activity chart
    var CHART_COLORS = ["#d4935e","#5aad7d","#4a8aaa","#d4a03e","#9a5aaa","#c45c5c","#8aaa5a","#c46a7a"];
    var hiddenUsers = {};

    function periodToRange(p) {
      if (p === "yesterday") return "yesterday";
      if (p === "weekly") return "7d";
      if (p === "monthly" || p === "all-time") return "30d";
      return "24h";
    }

    function loadChart() {
      var apiPath = IS_GLOBAL ? "/api/activity/global" : "/api/activity/" + encodeURIComponent(CODE);
      var tz = -new Date().getTimezoneOffset();
      var range = periodToRange(period);
      fetch(apiPath + "?range=" + range + "&tz=" + tz)
        .then(function(res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        })
        .then(function(data) { renderChart(data); })
        .catch(function() {
          document.getElementById("chart").innerHTML = '<div style="color:#5a5550;text-align:center;padding:24px;font-size:13px">Couldn\\'t load activity chart</div>';
        });
    }

    function renderChart(data) {
      var el = document.getElementById("chart");
      var startMs = new Date(data.start).getTime();
      var endMs = new Date(data.end).getTime();
      var durationMs = endMs - startMs;
      var range = data.range;

      if (!data.series || data.series.length === 0) {
        el.innerHTML = '<div style="color:#5a5550;text-align:center;padding:24px;font-size:13px">No activity in this period</div>';
        return;
      }

      // Bucket blocks into time intervals to show activity intensity
      var W = 560, H = 200, PAD_L = 0, PAD_R = 0, PAD_T = 8, PAD_B = 20;
      var plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
      var bucketCount = range === "24h" || range === "yesterday" ? 48 : range === "7d" ? 28 : 30;
      var bucketMs = durationMs / bucketCount;

      var globalMax = 0;
      var userSeries = data.series.map(function(user) {
        var buckets = new Array(bucketCount).fill(0);
        user.blocks.forEach(function(bl) {
          var idx = Math.min(Math.floor((new Date(bl.t).getTime() - startMs) / bucketMs), bucketCount - 1);
          if (idx >= 0) buckets[idx] += bl.cost;
        });
        for (var b = 0; b < buckets.length; b++) {
          if (buckets[b] > globalMax) globalMax = buckets[b];
        }
        var total = user.blocks.reduce(function(s, bl) { return s + bl.cost; }, 0);
        // Convert buckets to points
        var points = buckets.map(function(v, i) {
          return { t: startMs + (i + 0.5) * bucketMs, v: v };
        });
        return { name: user.displayName, url: user.url || "", total: total, points: points };
      });

      if (globalMax === 0) globalMax = 1;

      // Build SVG paths with smooth cubic bezier curves
      var paths = "";
      userSeries.forEach(function(us, idx) {
        var color = CHART_COLORS[idx % CHART_COLORS.length];
        var pts = us.points.map(function(pt) {
          return {
            x: PAD_L + ((pt.t - startMs) / durationMs) * plotW,
            y: PAD_T + plotH - (pt.v / globalMax) * plotH
          };
        });
        if (pts.length < 2) return;
        var d = "M" + pts[0].x.toFixed(1) + "," + pts[0].y.toFixed(1);
        for (var j = 1; j < pts.length; j++) {
          var prev = pts[j - 1], cur = pts[j];
          var cpx = (prev.x + cur.x) / 2;
          d += " C" + cpx.toFixed(1) + "," + prev.y.toFixed(1) +
               " " + cpx.toFixed(1) + "," + cur.y.toFixed(1) +
               " " + cur.x.toFixed(1) + "," + cur.y.toFixed(1);
        }
        paths += '<path id="chart-path-' + idx + '" d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>';
      });

      // Time axis labels
      var labels = "";
      var labelCount = range === "24h" || range === "yesterday" ? 6 : range === "7d" ? 7 : 6;
      for (var i = 0; i <= labelCount; i++) {
        var t = startMs + (durationMs * i / labelCount);
        var dt = new Date(t);
        var label;
        if (range === "24h" || range === "yesterday") {
          label = dt.getHours().toString().padStart(2, "0") + ":" + dt.getMinutes().toString().padStart(2, "0");
        } else {
          label = (dt.getMonth() + 1) + "/" + dt.getDate();
        }
        var lx = PAD_L + (i / labelCount) * plotW;
        labels += '<text x="' + lx.toFixed(1) + '" y="' + (H - 2) + '" fill="#5a5550" font-size="10" text-anchor="middle">' + label + '</text>';
        labels += '<line x1="' + lx.toFixed(1) + '" y1="' + PAD_T + '" x2="' + lx.toFixed(1) + '" y2="' + (PAD_T + plotH) + '" stroke="#2e2c2a" stroke-width="1"/>';
      }

      // Cost axis label (peak per bucket)
      var costLabel = globalMax >= 1 ? "$" + globalMax.toFixed(0) : "$" + globalMax.toFixed(2);
      labels += '<text x="' + (W - 2) + '" y="' + (PAD_T + 10) + '" fill="#5a5550" font-size="10" text-anchor="end">' + costLabel + '</text>';

      // Crosshair line + dot markers (hidden by default) + hover overlay
      var overlay = '<line id="chart-crosshair" x1="0" y1="' + PAD_T + '" x2="0" y2="' + (PAD_T + plotH) + '" stroke="#5a5550" stroke-width="1" stroke-dasharray="3,3" opacity="0"/>';
      userSeries.forEach(function(us, idx) {
        var color = CHART_COLORS[idx % CHART_COLORS.length];
        overlay += '<circle id="chart-dot-' + idx + '" cx="0" cy="0" r="3.5" fill="' + color + '" stroke="#1a1816" stroke-width="1.5" opacity="0"/>';
      });
      overlay += '<rect x="' + PAD_L + '" y="' + PAD_T + '" width="' + plotW + '" height="' + plotH + '" fill="transparent" id="chart-overlay" style="cursor:crosshair"/>';

      var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">' +
        labels + paths + overlay + '</svg>';

      // Legend
      var legend = '<div class="chart-legend">';
      userSeries.forEach(function(us, idx) {
        var color = CHART_COLORS[idx % CHART_COLORS.length];
        var legendName = us.url ? '<a href="' + esc(us.url) + '" target="_blank" rel="noopener" class="name-link">' + esc(us.name) + '</a>' : esc(us.name);
        legend += '<div class="chart-legend-item" data-idx="' + idx + '"><span class="chart-legend-dot" style="background:' + color + '"></span>' +
          legendName + ' $' + us.total.toFixed(2) + '</div>';
      });
      legend += '</div>';

      el.innerHTML = svg + '<div class="chart-tooltip" id="chart-tooltip"></div>' + legend;

      // Re-apply hidden state after re-render (keyed by user name)
      userSeries.forEach(function(us, idx) {
        if (hiddenUsers[us.name]) {
          var item = el.querySelector('.chart-legend-item[data-idx="' + idx + '"]');
          if (item) item.classList.add("hidden");
          var path = document.getElementById("chart-path-" + idx);
          if (path) path.setAttribute("opacity", "0");
        }
      });

      // Crosshair hover logic
      var tooltip = document.getElementById("chart-tooltip");
      var crosshair = document.getElementById("chart-crosshair");
      var overlayRect = document.getElementById("chart-overlay");
      var svgEl = el.querySelector("svg");

      overlayRect.addEventListener("mousemove", function(e) {
        var svgRect = svgEl.getBoundingClientRect();
        var mouseX = (e.clientX - svgRect.left) / svgRect.width * W;
        // Find nearest bucket index
        var bucketIdx = Math.round((mouseX - PAD_L) / plotW * (bucketCount - 1));
        bucketIdx = Math.max(0, Math.min(bucketCount - 1, bucketIdx));
        // X position of this bucket
        var bx = PAD_L + ((bucketIdx + 0.5) * bucketMs / durationMs) * plotW;
        // Show crosshair
        crosshair.setAttribute("x1", bx.toFixed(1));
        crosshair.setAttribute("x2", bx.toFixed(1));
        crosshair.setAttribute("opacity", "1");
        // Time label
        var bt = new Date(startMs + bucketIdx * bucketMs);
        var timeLabel = range === "24h" || range === "yesterday"
          ? bt.getHours().toString().padStart(2, "0") + ":" + bt.getMinutes().toString().padStart(2, "0")
          : (bt.getMonth() + 1) + "/" + bt.getDate();
        // Position dots and build tooltip content
        var tipLines = '<div style="color:#5a5550;margin-bottom:2px">' + timeLabel + '</div>';
        var hasData = false;
        userSeries.forEach(function(us, idx) {
          var pt = us.points[bucketIdx];
          var color = CHART_COLORS[idx % CHART_COLORS.length];
          var dot = document.getElementById("chart-dot-" + idx);
          if (hiddenUsers[us.name]) {
            dot.setAttribute("opacity", "0");
            return;
          }
          var py = PAD_T + plotH - (pt.v / globalMax) * plotH;
          dot.setAttribute("cx", bx.toFixed(1));
          dot.setAttribute("cy", py.toFixed(1));
          dot.setAttribute("opacity", pt.v > 0 ? "1" : "0");
          if (pt.v > 0) {
            hasData = true;
            tipLines += '<div><span style="color:' + color + '">' + esc(us.name) + '</span> <b>$' + pt.v.toFixed(2) + '</b></div>';
          }
        });
        if (!hasData) {
          tipLines += '<div style="color:#5a5550">No activity</div>';
        }
        tooltip.innerHTML = tipLines;
        // Position tooltip
        var elRect = el.getBoundingClientRect();
        var scaleX = svgRect.width / W;
        var left = (svgRect.left - elRect.left) + bx * scaleX;
        tooltip.style.left = left + "px";
        tooltip.style.top = "0px";
        tooltip.style.transform = "translateX(-50%)";
        tooltip.classList.add("visible");
      });

      overlayRect.addEventListener("mouseleave", function() {
        crosshair.setAttribute("opacity", "0");
        userSeries.forEach(function(us, idx) {
          document.getElementById("chart-dot-" + idx).setAttribute("opacity", "0");
        });
        tooltip.classList.remove("visible");
      });

      // Legend toggle: click to show/hide individual lines
      el.querySelectorAll(".chart-legend-item").forEach(function(item) {
        item.addEventListener("click", function() {
          var idx = parseInt(item.getAttribute("data-idx"), 10);
          var userName = userSeries[idx].name;
          var pathEl = document.getElementById("chart-path-" + idx);
          if (hiddenUsers[userName]) {
            delete hiddenUsers[userName];
            item.classList.remove("hidden");
            if (pathEl) pathEl.setAttribute("opacity", "0.85");
          } else {
            hiddenUsers[userName] = true;
            item.classList.add("hidden");
            if (pathEl) pathEl.setAttribute("opacity", "0");
          }
        });
      });
    }

    load();
    loadChart();
    setInterval(function() { load(); loadChart(); }, 5 * 60 * 1000);
  </script>
</body>
</html>`;
}

export { app as dashboardRoute };
