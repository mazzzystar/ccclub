import { Hono } from "hono";
import { html, raw } from "hono/html";
import type { Env } from "./types.js";
import { isRankedSource, computeActivityStats } from "@ccclub/shared";
import type { UsageData, UsageBlock, GroupRecord, DayTotal } from "@ccclub/shared";

const app = new Hono<{ Bindings: Env }>();

export { computeActivityStats as computeStats };

// ── Pure aggregation (exported for tests) ────────────────────

/** Local calendar day of a timestamp under a fixed UTC-offset, in minutes. */
export function localDayKey(ms: number, tzMinutes: number): string {
  return new Date(ms + tzMinutes * 60_000).toISOString().slice(0, 10);
}

/**
 * Sum every ranked block into its viewer-local calendar day. Full history:
 * the heatmap only shows the last year, but streaks and totals shouldn't
 * forget the rest.
 */
export function aggregateDays(blocks: UsageBlock[], tzMinutes: number): Map<string, DayTotal> {
  const days = new Map<string, DayTotal>();
  for (const block of blocks) {
    if (!isRankedSource(block.source)) continue;
    const ms = new Date(block.blockStart).getTime();
    if (!Number.isFinite(ms)) continue;
    const key = localDayKey(ms, tzMinutes);
    const day = days.get(key) ?? { d: key, tokens: 0, cost: 0, chats: 0 };
    day.tokens += block.totalTokens || 0;
    day.cost += block.costUSD || 0;
    day.chats += block.chatCount || 0;
    days.set(key, day);
  }
  return days;
}

// ── API ──────────────────────────────────────────────────────

const USER_ID = /^[0-9a-f]{8,32}$/i;

/** /u/ handles are slugs first; a raw hex userId keeps resolving forever. */
async function resolveHandle(kv: Env["KV"], handle: string): Promise<string | null> {
  if (handle.length > 64) return null;
  const bySlug = await kv.get(`slug:${handle.toLowerCase()}`);
  if (bySlug) return bySlug;
  return USER_ID.test(handle) ? handle : null;
}

app.get("/api/user/:handle/activity", async (c) => {
  const userId = await resolveHandle(c.env.KV, c.req.param("handle"));
  if (!userId) return c.json({ error: "user not found" }, 404);
  const tz = Math.max(-840, Math.min(840, parseInt(c.req.query("tz") || "0", 10) || 0));

  const [usage, groupCodes] = await Promise.all([
    c.env.KV.get<UsageData>(`usage:${userId}`, "json"),
    c.env.KV.get<string[]>(`user_groups:${userId}`, "json"),
  ]);

  // Display info lives on the first group's member record, like /rank/global.
  let displayName = userId.slice(0, 8);
  let slug: string | undefined;
  let avatar = "";
  let plan: string | undefined;
  let url: string | undefined;
  const firstCode = groupCodes?.[0];
  if (firstCode) {
    const group = await c.env.KV.get<GroupRecord>(`group:${firstCode}`, "json");
    const member = group?.members.find((m) => m.userId === userId);
    if (member) {
      displayName = member.displayName;
      slug = member.slug;
      avatar = member.avatar || "";
      plan = member.plan;
      url = member.url;
    }
  }
  if (!usage && !firstCode) return c.json({ error: "user not found" }, 404);

  const days = aggregateDays(usage?.blocks ?? [], tz);
  const todayKey = localDayKey(Date.now(), tz);
  const stats = computeActivityStats(days, todayKey);

  // The grid wants the last 53 weeks; older days only feed the stats above.
  const cutoff = localDayKey(Date.now() - 370 * 86_400_000, tz);
  const recent = [...days.values()].filter((day) => day.d >= cutoff).sort((a, b) => (a.d < b.d ? -1 : 1));

  return c.json({
    userId,
    slug: slug || null,
    displayName,
    avatar,
    plan: plan || null,
    url: url || null,
    today: todayKey,
    stats,
    days: recent.map((day) => ({
      d: day.d,
      tokens: day.tokens,
      cost: Math.round(day.cost * 100) / 100,
      chats: day.chats,
    })),
  });
});

// ── Page ─────────────────────────────────────────────────────

app.get("/u/:handle", (c) => {
  const handle = c.req.param("handle");
  if (handle.length > 64) return c.notFound();
  return c.html(activityPageHTML(handle));
});

function activityPageHTML(handle: string) {
  return html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Activity — ccclub</title>
  <meta name="description" content="Daily coding-agent token activity." />
  <meta name="robots" content="noindex" />
  <meta name="theme-color" content="#1a1816" />
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏆</text></svg>" />

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
      --bg: #1a1816; --surface: #201e1c; --surface-soft: #24211f;
      --line: #332f2b; --line-soft: #282521;
      --text: #e8e4de; --title: #f1ede7; --muted: #8a8480; --faint: #5a5550;
      --brand: #d4935e; --link: #7ab7c6;
      --cell-0: #242019; --cell-1: #4a3323; --cell-2: #7c4e2a; --cell-3: #b06f38; --cell-4: #d4935e;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      background: var(--bg); color: var(--text); min-height: 100vh;
      -webkit-font-smoothing: antialiased; line-height: 1.6;
    }
    .wrap { max-width: 880px; margin: 0 auto; padding: 44px 24px; }
    .top-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; }
    .brand { display: flex; align-items: center; gap: 8px; color: var(--title); text-decoration: none; font-weight: 700; }
    .brand img { width: 24px; height: 24px; border-radius: 5px; }
    .back-link { color: var(--muted); font-size: 13px; text-decoration: none; }
    .back-link:hover { color: var(--link); }

    .profile { text-align: center; margin: 8px 0 28px; }
    .big-avatar {
      width: 84px; height: 84px; border-radius: 50%; margin: 0 auto 14px;
      display: flex; align-items: center; justify-content: center;
      font-size: 34px; font-weight: 700; color: #fff; overflow: hidden;
      border: 2px solid var(--line);
    }
    .big-avatar img { width: 100%; height: 100%; object-fit: cover; }
    .profile h1 { font-size: 26px; color: var(--title); font-weight: 700; }
    .profile .sub { color: var(--muted); font-size: 14px; margin-top: 4px; display: flex; gap: 8px; align-items: center; justify-content: center; }
    .plan-badge {
      display: inline-block; padding: 1px 9px; border-radius: 999px;
      border: 1px solid var(--line); color: var(--brand); font-size: 12px; font-weight: 600;
    }
    .ext-link { color: var(--link); text-decoration: none; font-size: 13px; }
    .ext-link:hover { text-decoration: underline; }

    .stats {
      display: grid; grid-template-columns: repeat(5, 1fr);
      border: 1px solid var(--line-soft); border-radius: 14px; background: var(--surface);
      padding: 18px 8px; margin-bottom: 28px;
    }
    .stat { text-align: center; padding: 2px 6px; border-left: 1px solid var(--line-soft); }
    .stat:first-child { border-left: none; }
    .stat .v { font-size: 21px; font-weight: 700; color: var(--title); }
    .stat .k { font-size: 12px; color: var(--muted); margin-top: 2px; }
    @media (max-width: 640px) {
      .stats { grid-template-columns: repeat(2, 1fr); gap: 10px 0; }
      .stat { border-left: none; }
    }

    .card { border: 1px solid var(--line-soft); border-radius: 14px; background: var(--surface); padding: 20px; }
    .card h2 { font-size: 15px; color: var(--title); margin-bottom: 14px; }
    .map-scroll { overflow-x: auto; padding-bottom: 4px; }
    .map { display: inline-block; }
    .months { display: flex; margin-left: 30px; font-size: 11px; color: var(--faint); height: 16px; }
    .months span { position: relative; }
    .grid-row { display: flex; }
    .dow { width: 30px; font-size: 10px; color: var(--faint); line-height: 13px; }
    .cell {
      width: 11px; height: 11px; border-radius: 2.5px; margin: 1px;
      background: var(--cell-0); flex: none;
    }
    .c1 { background: var(--cell-1); } .c2 { background: var(--cell-2); }
    .c3 { background: var(--cell-3); } .c4 { background: var(--cell-4); }
    .cell.future { background: transparent; }
    .legend { display: flex; align-items: center; gap: 4px; justify-content: flex-end; margin-top: 10px; font-size: 11px; color: var(--faint); }
    .legend .cell { margin: 0 1px; }

    .tip {
      display: none; position: fixed; z-index: 10; pointer-events: none;
      background: #2e2a26; color: var(--text); border: 1px solid var(--line);
      border-radius: 7px; padding: 4px 10px; font-size: 12px; white-space: nowrap;
      box-shadow: 0 4px 14px rgba(0,0,0,0.4);
    }
    .loading, .error-box { text-align: center; color: var(--muted); padding: 60px 0; }
    .footer { text-align: center; color: var(--faint); font-size: 12px; margin-top: 32px; }
    .footer a { color: var(--muted); text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top-nav">
      <a href="/" class="brand"><img src="https://raw.githubusercontent.com/mazzzystar/ccclub/main/assets/icon.png" alt="" /><span>ccclub</span></a>
      <a href="javascript:history.back()" class="back-link">← Back</a>
    </div>
    <div id="content"><div class="loading">Loading activity…</div></div>
    <div class="footer"><a href="/">ccclub</a> — coding-agent leaderboard among friends</div>
  </div>

  <script>
    var HANDLE = ${raw(JSON.stringify(handle))};
    var AVATAR_COLORS = [
      "#c45c5c","#d4845a","#d4a03e","#8aaa5a","#5aad7d",
      "#4a9b8a","#4a8aaa","#5a7aaa","#7a6aaa","#9a5aaa",
      "#aa5a8a","#c46a7a"
    ];
    function esc(s) {
      return String(s).replace(/[&<>"']/g, function(ch) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
      });
    }
    function hashCode(str) {
      var h = 0;
      for (var i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
      return Math.abs(h);
    }
    function fmtTokens(n) {
      if (n >= 1e12) return (n / 1e12).toFixed(1) + "T";
      if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
      if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
      if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
      return String(n);
    }
    function dayMs(key) { return Date.parse(key + "T00:00:00Z"); }

    function levelFor(tokens, thresholds) {
      if (tokens <= 0) return 0;
      for (var i = 0; i < thresholds.length; i++) if (tokens <= thresholds[i]) return i + 1;
      return 4;
    }

    function render(data) {
      var byDay = {};
      var nonZero = [];
      data.days.forEach(function(d) { byDay[d.d] = d; if (d.tokens > 0) nonZero.push(d.tokens); });
      nonZero.sort(function(a, b) { return a - b; });
      // ceil-1, not floor: with floor, q(0.75) of a small sample is its
      // maximum and the brightest level is unreachable.
      function q(p) { return nonZero.length ? nonZero[Math.max(0, Math.ceil(p * nonZero.length) - 1)] : 0; }
      var thresholds = [q(0.25), q(0.5), q(0.75)];

      // 53 columns of weeks ending with the current week; rows Sun..Sat.
      var todayMs = dayMs(data.today);
      var todayDow = new Date(todayMs).getUTCDay();
      var weekStart = todayMs - todayDow * 86400000; // this week's Sunday
      var firstWeek = weekStart - 52 * 7 * 86400000;

      var monthCells = "";
      var lastMonth = -1;
      for (var w = 0; w < 53; w++) {
        var wkMs = firstWeek + w * 7 * 86400000;
        var m = new Date(wkMs).getUTCMonth();
        var label = "";
        // Label the first full week of each month; keep first column honest.
        if (m !== lastMonth && new Date(wkMs).getUTCDate() <= 7) {
          label = new Date(wkMs).toLocaleString("en", { month: "short", timeZone: "UTC" });
          lastMonth = m;
        }
        monthCells += '<span style="width:13px">' + (label ? '<span style="position:absolute">' + label + "</span>" : "") + "</span>";
      }

      var DOW_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];
      var rows = "";
      for (var dow = 0; dow < 7; dow++) {
        var cells = "";
        for (var w2 = 0; w2 < 53; w2++) {
          var ms = firstWeek + (w2 * 7 + dow) * 86400000;
          if (ms > todayMs) { cells += '<div class="cell future"></div>'; continue; }
          var key = new Date(ms).toISOString().slice(0, 10);
          var d = byDay[key];
          var tokens = d ? d.tokens : 0;
          var lvl = levelFor(tokens, thresholds);
          var tip = key + (tokens > 0 ? " · " + fmtTokens(tokens) + " tokens" + (d.chats ? " · " + d.chats + " chats" : "") : " · no activity");
          cells += '<div class="cell' + (lvl ? " c" + lvl : "") + '" data-tip="' + esc(tip) + '"></div>';
        }
        rows += '<div class="grid-row"><div class="dow">' + DOW_LABELS[dow] + "</div>" + cells + "</div>";
      }

      var s = data.stats;
      var avatar = data.avatar
        ? '<div class="big-avatar"><img src="' + esc(data.avatar) + '" alt="" /></div>'
        : '<div class="big-avatar" style="background:' + AVATAR_COLORS[hashCode(data.userId) % AVATAR_COLORS.length] + '">' + esc((data.displayName || "?").charAt(0).toUpperCase()) + "</div>";
      var sub = [];
      if (data.plan && data.plan !== "api") sub.push('<span class="plan-badge">' + esc(data.plan === "max100" ? "Max $100" : data.plan === "max200" ? "Max $200" : "Pro") + "</span>");
      if (data.plan === "api") sub.push('<span class="plan-badge">API</span>');
      if (data.url) sub.push('<a class="ext-link" href="' + esc(data.url) + '" target="_blank" rel="noopener">' + esc(data.url.replace(/^https:\\/\\//, "")) + "</a>");

      document.getElementById("content").innerHTML =
        '<div class="profile">' + avatar +
          "<h1>" + esc(data.displayName) + "</h1>" +
          (sub.length ? '<div class="sub">' + sub.join(" ") + "</div>" : "") +
        "</div>" +
        '<div class="stats">' +
          '<div class="stat"><div class="v">' + fmtTokens(s.totalTokens) + '</div><div class="k">Total tokens</div></div>' +
          '<div class="stat"><div class="v">' + fmtTokens(s.peakDayTokens) + '</div><div class="k">Best day</div></div>' +
          '<div class="stat"><div class="v">' + s.activeDays + '</div><div class="k">Active days</div></div>' +
          '<div class="stat"><div class="v">' + s.currentStreak + '</div><div class="k">Current streak</div></div>' +
          '<div class="stat"><div class="v">' + s.longestStreak + '</div><div class="k">Longest streak</div></div>' +
        "</div>" +
        '<div class="card"><h2>Token activity</h2>' +
          '<div class="map-scroll"><div class="map">' +
            '<div class="months">' + monthCells + "</div>" + rows +
          "</div></div>" +
          '<div class="legend">Less <div class="cell"></div><div class="cell c1"></div><div class="cell c2"></div><div class="cell c3"></div><div class="cell c4"></div> More</div>' +
        "</div>";
      document.title = data.displayName + " — ccclub activity";

      // Canonical short URL: raw-userId links keep working, the bar shows the slug.
      if (data.slug && decodeURIComponent(location.pathname) !== "/u/" + data.slug) {
        history.replaceState(null, "", "/u/" + encodeURIComponent(data.slug));
      }

      // Real tooltip — title attributes are slow and unreliable on tight grids.
      var tip = document.createElement("div");
      tip.className = "tip";
      document.body.appendChild(tip);
      var map = document.querySelector(".map");
      map.addEventListener("mouseover", function(e) {
        var t = e.target;
        if (!(t instanceof Element) || !t.hasAttribute("data-tip")) return;
        tip.textContent = t.getAttribute("data-tip");
        var r = t.getBoundingClientRect();
        tip.style.display = "block";
        var left = r.left + r.width / 2 - tip.offsetWidth / 2;
        left = Math.max(6, Math.min(left, window.innerWidth - tip.offsetWidth - 6));
        tip.style.left = left + "px";
        tip.style.top = (r.top - tip.offsetHeight - 8) + "px";
      });
      map.addEventListener("mouseout", function() { tip.style.display = "none"; });
    }

    var tz = -new Date().getTimezoneOffset();
    fetch("/api/user/" + encodeURIComponent(HANDLE) + "/activity?tz=" + tz)
      .then(function(r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(render)
      .catch(function() {
        document.getElementById("content").innerHTML = '<div class="error-box">No activity found for this user.</div>';
      });
  </script>
</body>
</html>`;
}

export { app as userActivityRoute };
