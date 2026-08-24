import { Hono } from "hono";
import { html, raw } from "hono/html";
import type { Env } from "./types.js";
import { isRankedSource, computeActivityStats, activityLevelFor, ACTIVITY_LEVEL_THRESHOLDS } from "@ccclub/shared";
import type { UsageData, UsageBlock, GroupRecord, DayTotal } from "@ccclub/shared";
import { cachedPngResponse, getColor, hashCode, latinOnly, ogCacheUrl, renderToPng } from "./og-utils.js";
import { localDayKey, aggregateDays, fmtTokensShort, activityOgSvg, cumulativeSeries, gridTicks } from "./activity-core.js";

const app = new Hono<{ Bindings: Env }>();

export { computeActivityStats as computeStats };

// ── Pure aggregation (exported for tests) ────────────────────

// ── API ──────────────────────────────────────────────────────

const USER_ID = /^[0-9a-f]{8,32}$/i;

/** /u/ handles are slugs first; a raw hex userId keeps resolving forever. */
async function resolveHandle(kv: Env["KV"], handle: string): Promise<string | null> {
  if (handle.length > 64) return null;
  const bySlug = await kv.get(`slug:${handle.toLowerCase()}`);
  if (bySlug) return bySlug;
  return USER_ID.test(handle) ? handle : null;
}

interface UserProfile {
  userId: string;
  displayName: string;
  slug?: string;
  avatar: string;
  plan?: string;
  url?: string;
  usage: UsageData | null;
}

/** Resolve a handle and load display info + usage; null when unknown. */
async function loadProfile(kv: Env["KV"], handle: string): Promise<UserProfile | null> {
  const userId = await resolveHandle(kv, handle);
  if (!userId) return null;
  const [usage, groupCodes] = await Promise.all([
    kv.get<UsageData>(`usage:${userId}`, "json"),
    kv.get<string[]>(`user_groups:${userId}`, "json"),
  ]);
  // Display info lives on the first group's member record, like /rank/global.
  const profile: UserProfile = { userId, displayName: userId.slice(0, 8), avatar: "", usage };
  const firstCode = groupCodes?.[0];
  if (firstCode) {
    const group = await kv.get<GroupRecord>(`group:${firstCode}`, "json");
    const member = group?.members.find((m) => m.userId === userId);
    if (member) {
      profile.displayName = member.displayName;
      profile.slug = member.slug;
      profile.avatar = member.avatar || "";
      profile.plan = member.plan;
      profile.url = member.url;
    }
  }
  if (!usage && !firstCode) return null;
  return profile;
}

app.get("/api/user/:handle/activity", async (c) => {
  const profile = await loadProfile(c.env.KV, c.req.param("handle"));
  if (!profile) return c.json({ error: "user not found" }, 404);
  const { userId, displayName, slug, avatar, plan, url, usage } = profile;
  const tz = Math.max(-840, Math.min(840, parseInt(c.req.query("tz") || "0", 10) || 0));

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

app.get("/u/:handle", async (c) => {
  const handle = c.req.param("handle");
  if (handle.length > 64) return c.notFound();
  // SSR the head so link previews carry the person, not a generic shell.
  const profile = await loadProfile(c.env.KV, handle);
  let ogTitle = "Activity — ccclub";
  let ogDesc = "Daily coding-agent token activity.";
  if (profile) {
    ogTitle = `${profile.displayName} — ccclub activity`;
    const stats = computeActivityStats(aggregateDays(profile.usage?.blocks ?? [], 0), localDayKey(Date.now(), 0));
    if (stats.activeDays > 0) {
      ogDesc = `${fmtTokensShort(stats.totalTokens)} tokens · ${stats.activeDays} active days · best day ${fmtTokensShort(stats.peakDayTokens)} · ${stats.currentStreak}-day streak`;
    }
  }
  return c.html(activityPageHTML(handle, ogTitle, ogDesc));
});

// ── OG image: avatar + name + stats + the last year as a heatmap ─────

/** Best-effort avatar embed; resvg renders PNG/JPEG/GIF data URIs. */
async function fetchAvatarDataUri(url: string): Promise<string | null> {
  if (!/^https:\/\//.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") || "").split(";")[0];
    if (!/^image\/(png|jpeg|gif)$/.test(type)) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 2_000_000) return null;
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return `data:${type};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

app.get("/u/:handle/og.png", async (c) => {
  const profile = await loadProfile(c.env.KV, c.req.param("handle"));
  if (!profile) return c.notFound();

  const version = hashCode(`${profile.usage?.lastSync || "0"}:${profile.displayName}:${profile.avatar}:${profile.plan || ""}`);
  const cacheUrl = ogCacheUrl(c.req.url, `u/v1/${profile.userId}/${version}.png`);

  return cachedPngResponse(cacheUrl, async () => {
    const days = aggregateDays(profile.usage?.blocks ?? [], 0);
    const todayKey = localDayKey(Date.now(), 0);
    const stats = computeActivityStats(days, todayKey);
    const tokensByDay = new Map([...days.values()].map((d) => [d.d, d.tokens]));
    // Inter only covers Latin — CJK names fall back to the ASCII slug.
    const name = latinOnly(profile.displayName) || profile.slug || profile.userId.slice(0, 8);
    const avatarDataUri = profile.avatar ? await fetchAvatarDataUri(profile.avatar) : null;
    const svg = activityOgSvg({
      name,
      plan: profile.plan,
      avatarDataUri,
      avatarColor: getColor(profile.userId),
      stats,
      tokensByDay,
      todayKey,
    });
    return renderToPng(svg);
  }, { maxAge: 3600, staleWhileRevalidate: 86400, executionCtx: c.executionCtx });
});

function activityPageHTML(handle: string, ogTitle: string, ogDesc: string) {
  const ogImage = `https://ccclub.dev/u/${encodeURIComponent(handle)}/og.png`;
  return html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${ogTitle}</title>
  <meta name="description" content="${ogDesc}" />
  <meta property="og:type" content="profile" />
  <meta property="og:title" content="${ogTitle}" />
  <meta property="og:description" content="${ogDesc}" />
  <meta property="og:site_name" content="ccclub" />
  <meta property="og:image" content="${ogImage}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${ogTitle}" />
  <meta name="twitter:description" content="${ogDesc}" />
  <meta name="twitter:image" content="${ogImage}" />
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
      --brand: #d4935e; --link: #7ab7c6; --success: #63b486;
      --cell-0: #242019;
      /* Three GitHub-style dim-to-bright ramps: hue = tier, depth = position. */
      --cell-1: #164430; --cell-2: #1a6b3e; --cell-3: #2aa155; --cell-4: #46d371;    /* green  */
      --cell-5: #4d3d12; --cell-6: #8a6a16; --cell-7: #c79b1d; --cell-8: #f7c72e;    /* gold   */
      --cell-9: #372560; --cell-10: #57389c; --cell-11: #7e57d9; --cell-12: #a97fff; /* purple */
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
    .card + .card { margin-top: 20px; }
    .card h2 { font-size: 15px; color: var(--title); margin-bottom: 14px; }
    .mini-label { color: var(--muted); font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }

    /* Cumulative curve. Its colors live here rather than on the SVG so the
       chart follows the palette; presentation attributes can't read var(). */
    .curve { display: block; width: 100%; height: auto; margin-top: 4px; }
    .curve-grid { stroke: var(--line-soft); }
    .curve-area { fill: url(#curveFade); }
    .curve-fade-top { stop-color: var(--success); stop-opacity: 0.30; }
    .curve-fade-bottom { stop-color: var(--success); stop-opacity: 0; }
    .curve-line { fill: none; stroke: var(--success); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
    .curve-tick { fill: var(--muted); font-size: 11px; }
    .curve-total { fill: var(--text); font-size: 12px; font-weight: 600; }
    .curve-dot { fill: var(--success); stroke: var(--surface); stroke-width: 2; }
    .curve-cross { stroke: var(--line); }
    /* Name and URL travel together as one centered credit; on a narrow card
       the pair wraps to two lines rather than squeezing the name out. */
    .curve-caption {
      display: flex; flex-wrap: wrap; justify-content: center; align-items: baseline;
      gap: 3px 12px; margin-top: 8px; font-size: 12px;
    }
    .curve-caption .who { color: var(--text); font-weight: 500; }
    .curve-caption .where {
      color: var(--muted);
      min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
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
    .c5 { background: var(--cell-5); } .c6 { background: var(--cell-6); }
    .c7 { background: var(--cell-7); } .c8 { background: var(--cell-8); }
    .c9 { background: var(--cell-9); } .c10 { background: var(--cell-10); }
    .c11 { background: var(--cell-11); } .c12 { background: var(--cell-12); }
    .cell.future { background: transparent; }
    .legend { display: flex; align-items: flex-start; gap: 14px; justify-content: flex-end; margin-top: 12px; font-size: 10px; color: var(--faint); }
    .legend .tier { text-align: center; }
    .legend .tier-cells { display: flex; justify-content: center; }
    .legend .cell { margin: 0 1px; cursor: default; }
    .legend .tier-label { margin-top: 2px; white-space: nowrap; }

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

    // Absolute log-spaced scale (mirrors @ccclub/shared): hue encodes the
    // magnitude tier, so two people's pages differ at a glance.
    var THRESHOLDS = ${raw(JSON.stringify(ACTIVITY_LEVEL_THRESHOLDS))};
    function levelFor(tokens) {
      var level = 0;
      for (var i = 0; i < THRESHOLDS.length; i++) {
        if (tokens >= THRESHOLDS[i]) level++;
        else break;
      }
      return level;
    }

    // ── Cumulative token curve ───────────────────────────────
    // Points for the curve, plus the width we last drew them at. Null means
    // there is nothing worth charting and the section was never emitted.
    var CURVE = null;
    var CURVE_W = 0;

    // Serialized straight out of activity-core.ts, where they are unit-tested:
    // the page can't import a module, and this maths deserves tests.
    var cumulativeSeries = ${raw(String(cumulativeSeries))};
    var gridTicks = ${raw(String(gridTicks))};

    function monthLabel(key) {
      return new Date(dayMs(key)).toLocaleString("en", { month: "short", year: "numeric", timeZone: "UTC" });
    }

    /** Build (or rebuild, after a resize) the chart inside its container. */
    function drawCurve() {
      var host = document.getElementById("curve");
      if (!host || !CURVE) return;
      var pts = CURVE;
      var W = Math.max(320, Math.round(host.clientWidth || 640));
      if (Math.abs(W - CURVE_W) < 2) return;
      CURVE_W = W;
      try {
        // Gutters: tick labels left, the end label right, dates underneath.
        var H = 200, x0 = 52, x1 = W - 58, y0 = 16, y1 = H - 24;
        var n = pts.length;
        var last = pts[n - 1].v;
        var top = last * 1.08;
        var xAt = function(i) { return x0 + (x1 - x0) * i / (n - 1); };
        var yAt = function(v) { return y1 - (y1 - y0) * v / top; };

        var grid = "";
        var ticks = gridTicks(top);
        for (var g = 0; g < ticks.length; g++) {
          var gy = Math.round(yAt(ticks[g])) + 0.5;
          grid += '<line class="curve-grid" x1="' + x0 + '" y1="' + gy + '" x2="' + x1 + '" y2="' + gy + '"/>' +
                  '<text class="curve-tick" x="' + (x0 - 8) + '" y="' + (gy + 4) + '" text-anchor="end">' + fmtTokens(ticks[g]) + "</text>";
        }

        var xy = [];
        for (var i = 0; i < n; i++) xy.push(xAt(i).toFixed(1) + "," + yAt(pts[i].v).toFixed(1));
        var area = "M" + x0 + "," + y1 + " L" + xy.join(" L") + " L" + x1 + "," + y1 + " Z";

        // 3–5 dates, deduped: a span inside one month shouldn't repeat itself.
        var k = Math.min(5, Math.max(3, Math.round((x1 - x0) / 150)));
        var dates = "";
        var seen = "";
        for (var t = 0; t < k; t++) {
          var idx = Math.round((n - 1) * t / (k - 1));
          var label = monthLabel(pts[idx].d);
          if (label === seen) continue;
          seen = label;
          var anchor = t === 0 ? "start" : t === k - 1 ? "end" : "middle";
          dates += '<text class="curve-tick" x="' + xAt(idx).toFixed(1) + '" y="' + (H - 5) + '" text-anchor="' + anchor + '">' + esc(label) + "</text>";
        }

        var ex = xAt(n - 1), ey = yAt(last);
        host.innerHTML =
          '<svg class="curve" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Cumulative tokens: ' + fmtTokens(last) + '">' +
            '<defs><linearGradient id="curveFade" x1="0" y1="0" x2="0" y2="1">' +
              '<stop class="curve-fade-top" offset="0"/><stop class="curve-fade-bottom" offset="1"/>' +
            "</linearGradient></defs>" +
            '<rect width="' + W + '" height="' + H + '" fill="transparent"/>' +
            grid + dates +
            '<path class="curve-area" d="' + area + '"/>' +
            '<polyline class="curve-line" points="' + xy.join(" ") + '"/>' +
            '<line class="curve-cross" x1="0" y1="' + y0 + '" x2="0" y2="' + y1 + '" style="display:none"/>' +
            '<circle class="curve-dot curve-hit" cx="0" cy="0" r="3.5" style="display:none"/>' +
            '<circle class="curve-dot" cx="' + ex.toFixed(1) + '" cy="' + ey.toFixed(1) + '" r="3.5"/>' +
            '<text class="curve-total" x="' + (ex + 9).toFixed(1) + '" y="' + (ey + 4).toFixed(1) + '">' + fmtTokens(last) + "</text>" +
          "</svg>";

        // Nearest-day crosshair. Pointer-only by design; touch just gets the line.
        var svg = host.firstChild;
        var cross = svg.querySelector(".curve-cross");
        var hit = svg.querySelector(".curve-hit");
        var tip = tooltip();
        svg.addEventListener("mousemove", function(e) {
          var r = svg.getBoundingClientRect();
          if (!r.width) return;
          var scale = r.width / W;
          var i = Math.round(((e.clientX - r.left) / scale - x0) / (x1 - x0) * (n - 1));
          i = Math.max(0, Math.min(n - 1, i));
          var px = xAt(i), py = yAt(pts[i].v);
          cross.setAttribute("x1", px);
          cross.setAttribute("x2", px);
          cross.style.display = "";
          hit.setAttribute("cx", px);
          hit.setAttribute("cy", py);
          hit.style.display = "";
          tip.textContent = pts[i].d + " · " + fmtTokens(pts[i].v) + " tokens";
          tip.style.display = "block";
          var left = e.clientX - tip.offsetWidth / 2;
          tip.style.left = Math.max(6, Math.min(left, window.innerWidth - tip.offsetWidth - 6)) + "px";
          tip.style.top = (r.top + py * scale - tip.offsetHeight - 12) + "px";
        });
        svg.addEventListener("mouseleave", function() {
          cross.style.display = "none";
          hit.style.display = "none";
          tip.style.display = "none";
        });
      } catch (err) {
        // A chart that can't be drawn takes its own section down with it.
        CURVE = null;
        if (host.parentNode && host.parentNode.parentNode) host.parentNode.parentNode.removeChild(host.parentNode);
      }
    }

    // Shared with the heatmap: title attributes are slow and unreliable here.
    var tipEl = null;
    function tooltip() {
      if (!tipEl) {
        tipEl = document.createElement("div");
        tipEl.className = "tip";
        document.body.appendChild(tipEl);
      }
      return tipEl;
    }

    function render(data) {
      var byDay = {};
      data.days.forEach(function(d) { byDay[d.d] = d; });

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
          var lvl = levelFor(tokens);
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

      // The trajectory chart. Anything odd in the day list just costs us the
      // section — it must never take the rest of the page down.
      var curve = "";
      try {
        // The API sends the last ~year of days while the stats cover all time,
        // so seed the sum with whatever fell off the window: the curve has to
        // land on the same number as the Total tokens stat above it.
        var windowTokens = 0;
        data.days.forEach(function(day) { windowTokens += day.tokens || 0; });
        CURVE = cumulativeSeries(data.days, data.today, (s.totalTokens || 0) - windowTokens);
        if (CURVE.length) {
          curve =
            '<div class="card">' +
              '<div class="mini-label">Cumulative tokens</div>' +
              '<div id="curve"></div>' +
              // Plain text, not a link: this row exists so a screenshot of the
              // chart still says whose it is and where it lives.
              '<div class="curve-caption">' +
                '<span class="who">' + esc(data.displayName) + "</span>" +
                '<span class="where">ccclub.dev/u/' + esc(data.slug || HANDLE) + "</span>" +
              "</div>" +
            "</div>";
        } else {
          CURVE = null;
        }
      } catch (err) {
        CURVE = null;
      }

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
        curve +
        '<div class="card"><h2>Token activity</h2>' +
          '<div class="map-scroll"><div class="map">' +
            '<div class="months">' + monthCells + "</div>" + rows +
          "</div></div>" +
          '<div class="legend">' +
            '<div class="tier"><div class="tier-cells"><div class="cell"></div></div><div class="tier-label">0</div></div>' +
            '<div class="tier"><div class="tier-cells"><div class="cell c1"></div><div class="cell c2"></div><div class="cell c3"></div><div class="cell c4"></div></div><div class="tier-label">&lt;100M</div></div>' +
            '<div class="tier"><div class="tier-cells"><div class="cell c5"></div><div class="cell c6"></div><div class="cell c7"></div><div class="cell c8"></div></div><div class="tier-label">100M–1B</div></div>' +
            '<div class="tier"><div class="tier-cells"><div class="cell c9"></div><div class="cell c10"></div><div class="cell c11"></div><div class="cell c12"></div></div><div class="tier-label">1B+</div></div>' +
          '</div>' +
        "</div>";
      document.title = data.displayName + " — ccclub activity";

      // Drawn at the container's own pixel width so the labels keep their real
      // size; below the 320 floor the whole chart scales down with the card.
      // A width change is the only thing worth redrawing for.
      if (CURVE) {
        drawCurve();
        window.addEventListener("resize", drawCurve);
      }

      // On narrow screens the grid overflows; land on the recent end, not
      // a year ago, and let the user scroll back in time.
      var scroller = document.querySelector(".map-scroll");
      if (scroller) scroller.scrollLeft = scroller.scrollWidth;

      // Canonical short URL: raw-userId links keep working, the bar shows the slug.
      if (data.slug && decodeURIComponent(location.pathname) !== "/u/" + data.slug) {
        history.replaceState(null, "", "/u/" + encodeURIComponent(data.slug));
      }

      var tip = tooltip();
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
