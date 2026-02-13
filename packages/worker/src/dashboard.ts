import { Hono } from "hono";
import { html } from "hono/html";
import type { Env } from "./types.js";

const app = new Hono<{ Bindings: Env }>();

// Sanitize code to only allow alphanumeric characters (invite codes are [A-Z0-9])
function sanitizeCode(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, "");
}

// GET /g/:code - Web dashboard
app.get("/g/:code", (c) => {
  const code = sanitizeCode(c.req.param("code"));
  if (!code) {
    return c.text("Invalid code", 400);
  }
  return c.html(dashboardHTML(code));
});

function dashboardHTML(code: string) {
  const isGlobal = code.toLowerCase() === "global";
  // code is already sanitized to [a-zA-Z0-9], safe for all contexts
  return html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CCClub - Rankings</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0a0a0a; color: #ededed; min-height: 100vh;
      padding: 32px 16px;
    }
    .container { max-width: 640px; margin: 0 auto; }
    h1 { font-size: 24px; margin-bottom: 4px; }
    .subtitle { color: #666; font-size: 13px; margin-bottom: 24px; }
    .periods { display: flex; gap: 8px; margin-bottom: 24px; flex-wrap: wrap; }
    .periods button {
      padding: 6px 16px; border-radius: 6px; border: 1px solid #333;
      background: transparent; color: #888; cursor: pointer; font-size: 13px;
    }
    .periods button.active { background: #2563eb; color: white; border-color: #2563eb; }
    .periods button.global-btn { border-color: #7c3aed; color: #a78bfa; }
    .periods button.global-btn.active { background: #7c3aed; color: white; border-color: #7c3aed; }
    table { width: 100%; border-collapse: collapse; }
    th { color: #555; font-size: 11px; text-transform: uppercase; text-align: left;
         padding: 8px 12px; border-bottom: 1px solid #222; }
    td { padding: 12px; border-bottom: 1px solid #1a1a1a; }
    tr:hover { background: rgba(255,255,255,0.02); }
    .rank { font-weight: 700; width: 40px; }
    .gold { color: #f59e0b; }
    .name-cell { display: flex; align-items: center; gap: 10px; }
    .avatar {
      width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 14px; color: white;
    }
    .avatar img {
      width: 32px; height: 32px; border-radius: 50%; object-fit: cover;
      display: block;
    }
    .avatar img.errored { display: none; }
    .avatar .fallback { display: none; }
    .avatar img.errored + .fallback { display: flex; }
    .name-text { font-weight: 500; }
    .tokens { font-variant-numeric: tabular-nums; }
    .cost { color: #888; font-variant-numeric: tabular-nums; }
    .bar { height: 4px; background: #2563eb; border-radius: 2px; margin-top: 4px;
           transition: width 0.3s; }
    .empty { text-align: center; color: #555; padding: 60px 0; }
    .invite { margin-top: 32px; padding: 16px; background: #111; border-radius: 8px;
              border: 1px solid #222; display: flex; align-items: center; gap: 12px; }
    .invite-code { font-family: monospace; font-size: 20px; letter-spacing: 2px; font-weight: 700; }
    .invite-label { color: #666; font-size: 12px; }
    .copy-btn { padding: 6px 12px; border-radius: 6px; border: 1px solid #333;
                background: transparent; color: #888; cursor: pointer; font-size: 12px; }
    .refresh { color: #333; font-size: 11px; margin-top: 16px; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <h1 id="title">Loading...</h1>
    <div class="subtitle" id="date-range"></div>

    <div class="periods">
      <button class="active" data-period="daily">Today</button>
      <button data-period="weekly">This Week</button>
      <button data-period="monthly">This Month</button>
      <button data-period="all-time">All Time</button>
      <button class="global-btn${isGlobal ? " active" : ""}" onclick="window.location.href='/g/global'">Global</button>
    </div>

    <div id="content"></div>

    ${isGlobal ? html`` : html`
    <div class="invite">
      <div>
        <div class="invite-label">Invite friends to join</div>
        <div class="invite-code" id="invite-code-display"></div>
      </div>
      <button class="copy-btn" id="copy-btn">Copy</button>
    </div>`}

    <div class="refresh" id="refresh-info"></div>
  </div>

  <script>
    // code is sanitized server-side to [a-zA-Z0-9] only
    var CODE = "${code}";
    var IS_GLOBAL = ${isGlobal ? "true" : "false"};

    var period = "daily";

    // Set invite code display
    var inviteEl = document.getElementById("invite-code-display");
    if (inviteEl) inviteEl.textContent = CODE;
    var copyBtn = document.getElementById("copy-btn");
    if (copyBtn) {
      copyBtn.addEventListener("click", function() {
        navigator.clipboard.writeText("npx ccclub join " + CODE);
        this.textContent = "Copied!";
        var btn = this;
        setTimeout(function() { btn.textContent = "Copy"; }, 2000);
      });
    }

    // Avatar color generation from userId hash
    var AVATAR_COLORS = [
      "#ef4444","#f97316","#f59e0b","#84cc16","#22c55e",
      "#14b8a6","#06b6d4","#3b82f6","#6366f1","#8b5cf6",
      "#a855f7","#d946ef","#ec4899","#f43f5e"
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
        // img with CSS fallback: on error, hide img and show the fallback span
        return '<div class="avatar">' +
          '<img src="' + esc(avatarUrl) + '" alt="" onerror="this.classList.add(\'errored\')">' +
          '<span class="fallback avatar" style="background:' + color + ';width:32px;height:32px;display:none;align-items:center;justify-content:center">' + initial + '</span>' +
          '</div>';
      }
      return '<div class="avatar" style="background:' + color + '">' + initial + '</div>';
    }

    document.querySelectorAll(".periods button:not(.global-btn)").forEach(function(btn) {
      btn.addEventListener("click", function() {
        document.querySelectorAll(".periods button").forEach(function(b) { b.classList.remove("active"); });
        btn.classList.add("active");
        period = btn.dataset.period;
        load();
      });
    });

    function load() {
      var apiPath = IS_GLOBAL ? "/api/rank/global" : "/api/rank/" + encodeURIComponent(CODE);
      fetch(apiPath + "?period=" + period)
        .then(function(res) { return res.json(); })
        .then(function(data) {
          document.getElementById("title").textContent = data.group.name;
          document.getElementById("date-range").textContent =
            data.start.slice(0,10) + " \u2014 " + data.end.slice(0,10) +
            " \u00b7 " + data.group.memberCount + (IS_GLOBAL ? " public users" : " members");

          if (data.rankings.length === 0) {
            document.getElementById("content").innerHTML =
              '<div class="empty">' + (IS_GLOBAL
                ? 'No public users with data for this period yet.<br>Set your profile to public: npx ccclub profile --public'
                : 'No usage data for this period yet.<br>Sync with: npx ccclub sync') + '</div>';
            return;
          }

          var maxTok = 0;
          data.rankings.forEach(function(r) { if (r.totalTokens > maxTok) maxTok = r.totalTokens; });
          var h = '<table><thead><tr><th>#</th><th>Name</th><th>Tokens</th><th>Cost</th><th>Calls</th></tr></thead><tbody>';

          data.rankings.forEach(function(r) {
            var pct = maxTok > 0 ? (r.totalTokens / maxTok * 100) : 0;
            var rankClass = r.rank <= 3 ? "gold" : "";
            h += '<tr>' +
              '<td class="rank ' + rankClass + '">' + r.rank + '</td>' +
              '<td><div class="name-cell">' + avatarHTML(r.userId, r.displayName, r.avatar) +
                '<div><div class="name-text">' + esc(r.displayName) + '</div>' +
                '<div class="bar" style="width:' + pct + '%"></div></div></div></td>' +
              '<td class="tokens">' + r.totalTokens.toLocaleString() + '</td>' +
              '<td class="cost">$' + r.costUSD.toFixed(2) + '</td>' +
              '<td>' + r.entryCount + '</td></tr>';
          });
          h += '</tbody></table>';
          document.getElementById("content").innerHTML = h;
          document.getElementById("refresh-info").textContent =
            "Auto-refreshes every 5 min \u00b7 Last: " + new Date().toLocaleTimeString();
        })
        .catch(function() {
          document.getElementById("content").innerHTML =
            '<div class="empty">Failed to load rankings</div>';
        });
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
