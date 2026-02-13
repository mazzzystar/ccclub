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
  <title>CCClub \u2014 Rankings</title>
  <meta name="description" content="Live Claude Code usage leaderboard" />

  <meta property="og:type" content="website" />
  <meta property="og:title" content="CCClub \u2014 Rankings" />
  <meta property="og:description" content="Live Claude Code usage leaderboard. See who's burning the most tokens." />
  <meta property="og:url" content="https://ccclub.dev/g/${code}" />

  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="CCClub \u2014 Rankings" />
  <meta name="twitter:description" content="Live Claude Code usage leaderboard. See who's burning the most tokens." />

  <meta name="theme-color" content="#1a1816" />
  <link rel="canonical" href="https://ccclub.dev/g/${code}" />
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏆</text></svg>" />
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

    /* Header */
    h1 { font-size: 24px; font-weight: 600; letter-spacing: -0.5px; color: #f0ece6; }
    .subtitle { color: #6b6560; font-size: 13px; margin-top: 4px; }

    /* Period selector */
    .periods { display: flex; gap: 6px; margin: 28px 0; flex-wrap: wrap; }
    .periods button {
      padding: 6px 14px; border-radius: 6px; border: 1px solid #363330;
      background: transparent; color: #8a8480; cursor: pointer;
      font-size: 13px; font-family: inherit;
      transition: all 0.15s ease;
    }
    .periods button:hover { border-color: #5a5550; color: #c8c4be; }
    .periods button.active {
      background: #2a2826; color: #e8e4de; border-color: #4a4640;
    }

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
    .avatar {
      width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      font-weight: 600; font-size: 13px; color: #1a1816;
    }
    .avatar img {
      width: 32px; height: 32px; border-radius: 50%; object-fit: cover;
    }
    .avatar img.errored { display: none; }
    .avatar .fallback { display: none; }
    .avatar img.errored + .fallback { display: flex; }
    .name-text { font-weight: 500; font-size: 14px; }
    .bar {
      height: 3px; background: #d4935e; border-radius: 2px; margin-top: 6px;
      opacity: 0.5; transition: width 0.3s;
    }
    .tokens { font-variant-numeric: tabular-nums; font-size: 14px; }
    .cost { color: #8a8480; font-variant-numeric: tabular-nums; font-size: 14px; }
    .calls { color: #6b6560; font-size: 14px; }

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
      th:nth-child(5), td:nth-child(5), th:nth-child(6), td:nth-child(6) { display: none; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1 id="title"></h1>
    <div class="subtitle" id="date-range"></div>

    <div class="periods">
      <button class="active" data-period="daily">Today</button>
      <button data-period="weekly">This Week</button>
      <button data-period="monthly">This Month</button>
      <button data-period="all-time">All Time</button>
      ${isGlobal ? html`` : html`<button data-nav="global">Global</button>`}
    </div>

    <div id="content"></div>

    ${isGlobal ? html`` : html`
    <div class="invite">
      <div>
        <div class="invite-label">Invite friends to join</div>
        <div class="invite-code" id="invite-code-display"></div>
      </div>
      <button class="copy-btn" id="copy-btn">Copy command</button>
    </div>`}

    <div class="meta" id="refresh-info"></div>
    <div class="meta" style="margin-top:16px;display:flex;align-items:center;justify-content:center;gap:12px">
      <a href="/" style="color:#6b6560;text-decoration:none">\u2190 Home</a>
      <a href="https://github.com/mazzzystar/ccclub" style="display:flex;align-items:center;opacity:0.5" aria-label="GitHub"><svg width="16" height="16" viewBox="0 0 24 24" fill="#6b6560"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg></a>
    </div>
  </div>

  <script>
    var CODE = "${code}";
    var IS_GLOBAL = ${isGlobal ? "true" : "false"};
    var period = "daily";

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

    // Global navigation button
    var navGlobal = document.querySelector('[data-nav="global"]');
    if (navGlobal) {
      navGlobal.addEventListener("click", function() {
        window.location.href = "/g/global";
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
    function avatarHTML(userId, displayName, avatarUrl) {
      var initial = esc((displayName || "?").charAt(0).toUpperCase());
      var color = getAvatarColor(userId);
      if (avatarUrl) {
        return '<div class="avatar">' +
          '<img src="' + esc(avatarUrl) + '" alt="" onerror="this.classList.add(&#39;errored&#39;)">' +
          '<span class="fallback avatar" style="background:' + color + ';width:32px;height:32px;display:none;align-items:center;justify-content:center">' + initial + '</span>' +
          '</div>';
      }
      return '<div class="avatar" style="background:' + color + '">' + initial + '</div>';
    }

    document.querySelectorAll(".periods button[data-period]").forEach(function(btn) {
      btn.addEventListener("click", function() {
        document.querySelectorAll(".periods button").forEach(function(b) { b.classList.remove("active"); });
        btn.classList.add("active");
        period = btn.dataset.period;
        load();
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

          if (data.rankings.length === 0) {
            document.getElementById("content").innerHTML =
              '<div class="empty">' + (IS_GLOBAL
                ? 'No public users yet.<br>Set your profile to public with: ccclub profile --public'
                : 'No usage data for this period yet.<br>Run: ccclub sync') + '</div>';
            return;
          }

          var maxCost = 0;
          data.rankings.forEach(function(r) { if (r.costUSD > maxCost) maxCost = r.costUSD; });
          var h = '<table><thead><tr><th>#</th><th>Name</th><th>Tokens</th><th>+ Cache</th><th>Cost</th><th>Chats</th></tr></thead><tbody>';

          data.rankings.forEach(function(r) {
            var pct = maxCost > 0 ? (r.costUSD / maxCost * 100) : 0;
            var rankClass = r.rank <= 3 ? "rank top" : "rank";
            var tokens = r.inputTokens + r.outputTokens;
            h += '<tr>' +
              '<td class="' + rankClass + '">' + r.rank + '</td>' +
              '<td><div class="name-cell">' + avatarHTML(r.userId, r.displayName, r.avatar) +
                '<div><div class="name-text">' + esc(r.displayName) + '</div>' +
                '<div class="bar" style="width:' + pct + '%"></div></div></div></td>' +
              '<td class="tokens">' + formatTokens(tokens) + '</td>' +
              '<td class="tokens">' + formatTokens(r.totalTokens) + '</td>' +
              '<td class="cost">$' + r.costUSD.toFixed(2) + '</td>' +
              '<td class="calls">' + (r.chatCount || 0) + '</td></tr>';
          });
          h += '</tbody></table>';
          document.getElementById("content").innerHTML = h;
          document.getElementById("refresh-info").textContent =
            "Last updated " + new Date().toLocaleTimeString();
        })
        .catch(function() {
          document.getElementById("content").innerHTML =
            '<div class="empty">Failed to load rankings</div>';
        });
    }

    function formatTokens(n) {
      if (n >= 1000000) { var m = n / 1000000; return (m % 1 === 0 ? m : parseFloat(m.toFixed(1))) + "M"; }
      if (n >= 1000) { var k = n / 1000; return (k % 1 === 0 ? k : parseFloat(k.toFixed(1))) + "K"; }
      return String(n);
    }
    function esc(s) {
      var d = document.createElement("div"); d.textContent = s; return d.innerHTML;
    }

    load();
    setInterval(load, 5 * 60 * 1000);
  </script>
</body>
</html>`;
}

export { app as dashboardRoute };
