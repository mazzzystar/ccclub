import { Hono } from "hono";
import { html, raw } from "hono/html";
import type { Env } from "./types.js";
import type { GroupRecord } from "@ccclub/shared";
import { cachedPngResponse, getColor, hashCode, htmlEsc, latinOnly, ogCacheUrl, renderToPng, sanitizeCode, svgEsc, truncate } from "./og-utils.js";

const app = new Hono<{ Bindings: Env }>();

const esc = htmlEsc;

function getCreator(group: GroupRecord): string {
  const creator = group.members.find((m) => m.userId === group.createdBy);
  return creator?.displayName || group.members[0]?.displayName || "Someone";
}

// ── Invite page ──────────────────────────────────────────────

app.get("/invite/:code", async (c) => {
  const code = sanitizeCode(c.req.param("code"));
  if (!code) return c.text("Invalid code", 400);

  const group = await c.env.KV.get<GroupRecord>(`group:${code}`, "json");
  if (!group) return c.html(notFoundHTML(code), 404);

  return c.html(inviteHTML(group));
});

function inviteHTML(group: GroupRecord) {
  const creator = getCreator(group);
  const n = group.members.length;
  const code = group.code;
  const ogTitle = `${esc(creator)} invites you to join ${esc(truncate(group.name, 40))}`;
  const ogDesc = `${n} member${n !== 1 ? "s" : ""} competing on coding agent usage. Join with one command.`;

  const MAX_SHOW = 10;
  const shown = group.members.slice(0, MAX_SHOW);
  const overflow = n - MAX_SHOW;

  const memberAvatars = shown
    .map((m, i) => {
      const color = getColor(m.userId);
      const initial = esc((m.displayName || "?").charAt(0).toUpperCase());
      const ml = i === 0 ? "" : "margin-left: -8px;";
      return `<div class="avatar" style="background:${color};${ml}" title="${esc(m.displayName)}">${initial}</div>`;
    })
    .join("");

  const overflowBadge =
    overflow > 0
      ? `<div class="avatar overflow" style="margin-left:-8px;">+${overflow}</div>`
      : "";

  const memberNames = shown.map((m) => esc(m.displayName)).join(", ") + (overflow > 0 ? ` and ${overflow} more` : "");

  return html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${ogTitle} — ccclub</title>
  <meta name="description" content="${ogDesc}" />

  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://ccclub.dev/invite/${code}" />
  <meta property="og:title" content="${ogTitle}" />
  <meta property="og:description" content="${ogDesc}" />
  <meta property="og:image" content="https://ccclub.dev/invite/${code}/og.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${ogTitle}" />
  <meta name="twitter:description" content="${ogDesc}" />
  <meta name="twitter:image" content="https://ccclub.dev/invite/${code}/og.png" />

  <meta name="theme-color" content="#1a1816" />
  <link rel="canonical" href="https://ccclub.dev/invite/${code}" />
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
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      background: #1a1816; color: #e8e4de; min-height: 100vh;
      -webkit-font-smoothing: antialiased; line-height: 1.6;
    }
    a { color: #d4935e; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code, .mono {
      font-family: "SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace;
    }

    .wrap { max-width: 640px; margin: 0 auto; padding: 0 24px; }

    .brand {
      display: flex; align-items: center; gap: 8px;
      padding-top: 24px; text-decoration: none;
    }
    .brand img { border-radius: 6px; }
    .brand span {
      font-size: 16px; font-weight: 600; color: #9b9590;
      letter-spacing: -0.3px;
    }
    .brand:hover span { color: #c8c4be; }

    .invite-hero {
      text-align: center; padding: 56px 0 40px;
    }
    .invite-label {
      font-size: 14px; color: #6b6560; text-transform: uppercase;
      letter-spacing: 2px; font-weight: 500; margin-bottom: 16px;
    }
    .group-name {
      font-size: 36px; font-weight: 700; letter-spacing: -0.5px;
      line-height: 1.2; color: #d4935e; margin-bottom: 12px;
      word-break: break-word;
    }
    .created-by {
      font-size: 15px; color: #6b6560;
    }
    .created-by strong { color: #9b9590; font-weight: 500; }

    .members-section {
      text-align: center; padding: 32px 0;
    }
    .avatars {
      display: flex; justify-content: center; align-items: center;
      margin-bottom: 16px;
    }
    .avatar {
      width: 44px; height: 44px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-weight: 600; font-size: 16px; color: #1a1816;
      border: 3px solid #1a1816; flex-shrink: 0;
      position: relative; z-index: 1;
    }
    .avatar.overflow {
      background: #2e2c2a; color: #8a8480; font-size: 13px; font-weight: 500;
    }
    .member-count {
      font-size: 20px; font-weight: 600; color: #e8e4de;
      margin-bottom: 6px;
    }
    .member-names {
      font-size: 14px; color: #6b6560; max-width: 400px;
      margin: 0 auto; line-height: 1.5;
    }

    .join-section {
      padding: 24px 0 48px; text-align: center;
    }
    .join-card {
      background: #13110f; border: 1px solid rgba(255,255,255,0.06);
      border-radius: 12px; padding: 32px 24px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.4);
    }
    .join-label {
      font-size: 13px; color: #6b6560; margin-bottom: 16px;
      text-transform: uppercase; letter-spacing: 1px;
    }
    .join-cmd {
      display: inline-flex; align-items: center; gap: 0;
      background: #242220; border: 1px solid #363330;
      border-radius: 8px; padding: 14px 24px; font-size: 16px;
      cursor: pointer; transition: border-color 0.2s;
      position: relative;
    }
    .join-cmd:hover { border-color: #d4935e; }
    .join-cmd .dollar { color: #5aad7d; margin-right: 10px; }
    .join-cmd .cmd-text { color: #e8e4de; }
    .join-cmd .copy-hint {
      margin-left: 16px; color: #4a4640; font-size: 12px;
      transition: color 0.15s;
    }
    .join-cmd:hover .copy-hint { color: #6b6560; }
    .join-cmd .copied-msg {
      position: absolute; right: -8px; top: -28px;
      font-size: 12px; color: #5aad7d; opacity: 0;
      transition: opacity 0.2s; pointer-events: none;
    }

    .join-note {
      margin-top: 20px; font-size: 13px; color: #4a4640; line-height: 1.6;
    }
    .join-note a { color: #6b6560; }

    .leaderboard-link {
      display: inline-flex; align-items: center; gap: 6px;
      margin-top: 24px; padding: 10px 20px;
      border: 1px solid #2e2c2a; border-radius: 8px;
      color: #8a8480; font-size: 14px;
      transition: all 0.15s;
    }
    .leaderboard-link:hover {
      border-color: #4a4640; color: #c8c4be; text-decoration: none;
    }

    .footer {
      padding: 48px 0;
      border-top: 1px solid #2e2c2a;
      text-align: center; color: #5a5550; font-size: 13px;
    }
    .footer a { color: #6b6560; }

    @media (max-width: 600px) {
      .invite-hero { padding: 40px 0 32px; }
      .group-name { font-size: 28px; }
      .avatar { width: 38px; height: 38px; font-size: 14px; }
      .join-cmd { font-size: 14px; padding: 12px 18px; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <a href="/" class="brand">
      <img src="https://raw.githubusercontent.com/mazzzystar/ccclub/main/assets/icon.png" alt="ccclub" width="28" height="28" />
      <span>ccclub</span>
    </a>

    <div class="invite-hero">
      <div class="invite-label">You're invited</div>
      <div class="group-name">${esc(group.name)}</div>
      <div class="created-by">Created by <strong>${esc(creator)}</strong></div>
    </div>

    <div class="members-section">
      <div class="avatars">
        ${raw(memberAvatars + overflowBadge)}
      </div>
      <div class="member-count">${n} member${n !== 1 ? "s" : ""}</div>
      <div class="member-names">${memberNames}</div>
    </div>

    <div class="join-section">
      <div class="join-card">
        <div class="join-label">Join with one command</div>
        <div class="join-cmd mono" id="join-cmd">
          <span class="dollar">$</span>
          <span class="cmd-text">npx ccclub join ${code}</span>
          <span class="copy-hint">click to copy</span>
          <span class="copied-msg" id="copied-msg">Copied!</span>
        </div>
        <div class="join-note">
          Requires <a href="https://nodejs.org" target="_blank" rel="noopener">Node.js</a>. No signup needed.
        </div>
      </div>
      <a href="/g/${code}" class="leaderboard-link">
        View the leaderboard →
      </a>
    </div>

    <div class="footer">
      <a href="https://github.com/mazzzystar/ccclub">GitHub</a>
      &nbsp;·&nbsp;
      <a href="https://discord.gg/6QbGWJUVHq">Discord</a>
      &nbsp;·&nbsp; MIT License
    </div>
  </div>

  <script>
    document.getElementById("join-cmd").addEventListener("click", function() {
      navigator.clipboard.writeText("npx ccclub join ${code}");
      var msg = document.getElementById("copied-msg");
      msg.style.opacity = "1";
      setTimeout(function() { msg.style.opacity = "0"; }, 2000);
    });
  </script>
</body>
</html>`;
}

function notFoundHTML(code: string) {
  return html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Invite not found — ccclub</title>
  <meta name="theme-color" content="#1a1816" />
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏆</text></svg>" />
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #1a1816; color: #e8e4de; min-height: 100vh;
      -webkit-font-smoothing: antialiased; line-height: 1.6;
      display: flex; align-items: center; justify-content: center;
    }
    a { color: #d4935e; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { font-family: "SF Mono", "Fira Code", Menlo, Consolas, monospace; }
    .wrap { text-align: center; padding: 24px; max-width: 480px; }
    h1 { font-size: 24px; font-weight: 600; margin-bottom: 12px; color: #f0ece6; }
    p { color: #6b6560; font-size: 15px; margin-bottom: 24px; }
    .cta {
      display: inline-block; background: #242220; border: 1px solid #363330;
      border-radius: 8px; padding: 12px 24px; font-size: 15px; color: #e8e4de;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Invite not found</h1>
    <p>The group code <code>${esc(code)}</code> doesn't exist. It may have been deleted or the link is incorrect.</p>
    <a href="/" class="cta">Create your own group &rarr;</a>
  </div>
</body>
</html>`;
}

// ── OG image ─────────────────────────────────────────────────

app.get("/invite/:code/og.png", async (c) => {
  const code = sanitizeCode(c.req.param("code"));
  if (!code) return c.text("Invalid code", 400);

  const group = await c.env.KV.get<GroupRecord>(`group:${code}`, "json");
  if (!group) {
    return c.text("Not found", 404);
  }

  const version = hashCode(`${group.name}:${group.members.map((m) => `${m.userId}:${m.displayName}:${m.avatar || ""}:${m.joinedAt}`).join("|")}`);
  const cacheUrl = ogCacheUrl(c.req.url, `invite/v2/${code}/${version}.png`);
  return cachedPngResponse(cacheUrl, async () => {
    const svg = buildOgSvg(group);
    return renderToPng(svg);
  }, {
    maxAge: 86_400,
    staleWhileRevalidate: 604_800,
    executionCtx: c.executionCtx,
  });
});

function buildOgSvg(group: GroupRecord): string {
  const W = 1200;
  const H = 630;
  const creator = getCreator(group);
  const n = group.members.length;
  const groupName = svgEsc(truncate(latinOnly(group.name) || group.code, 36));
  const creatorName = svgEsc(truncate(latinOnly(creator) || "A friend", 30));
  const code = group.code;

  const MAX_AVATARS = 8;
  const shown = group.members.slice(0, MAX_AVATARS);
  const overflow = n - MAX_AVATARS;

  const avatarR = 30;
  const avatarSpacing = 46;
  const avatarStartX = 86;
  const avatarY = 382;

  let avatarsSvg = "";
  shown.forEach((m, i) => {
    const cx = avatarStartX + i * avatarSpacing;
    const color = getColor(m.userId);
    const latin = latinOnly(m.displayName);
    const initial = svgEsc((latin || "?").charAt(0).toUpperCase());
    avatarsSvg += `<circle cx="${cx}" cy="${avatarY}" r="${avatarR}" fill="${color}" stroke="#181512" stroke-width="4"/>`;
    avatarsSvg += `<text x="${cx}" y="${avatarY + 7}" text-anchor="middle" fill="#161412" font-size="21" font-weight="700" font-family="Inter, sans-serif">${initial}</text>`;
  });

  if (overflow > 0) {
    const cx = avatarStartX + shown.length * avatarSpacing;
    avatarsSvg += `<circle cx="${cx}" cy="${avatarY}" r="${avatarR}" fill="#27231f" stroke="#181512" stroke-width="4"/>`;
    avatarsSvg += `<text x="${cx}" y="${avatarY + 5}" text-anchor="middle" fill="#a8a19a" font-size="14" font-weight="700" font-family="Inter, sans-serif">+${overflow}</text>`;
  }

  const memberLabel = `${n} member${n !== 1 ? "s" : ""}`;

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#201d19"/>
      <stop offset="100%" stop-color="#13110f"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="url(#bg)" rx="0"/>
  <rect x="42" y="34" width="${W - 84}" height="${H - 68}" rx="24" fill="#181512" stroke="#2b2723"/>

  <!-- Brand -->
  <text x="86" y="78" fill="#746f69" font-size="20" font-weight="700" font-family="Inter, sans-serif">ccclub</text>
  <rect x="86" y="106" width="144" height="34" rx="17" fill="#201d19" stroke="#2c2824"/>
  <circle cx="106" cy="123" r="5" fill="#5fdc8f"/>
  <text x="122" y="128" fill="#a8a19a" font-size="14" font-weight="700" font-family="Inter, sans-serif">Invite link</text>

  <!-- "invites you to join" -->
  <text x="86" y="186" fill="#8a8480" font-size="22" font-family="Inter, sans-serif">${creatorName} invites you to join</text>

  <!-- Group name -->
  <text x="86" y="250" fill="#f3eee7" font-size="54" font-weight="700" font-family="Inter, sans-serif" letter-spacing="-1">${groupName}</text>

  <!-- Member count -->
  <text x="86" y="292" fill="#8a8480" font-size="20" font-family="Inter, sans-serif">${memberLabel} competing on coding agents</text>

  <!-- Avatars -->
  ${avatarsSvg}

  <!-- Join command -->
  <rect x="86" y="454" width="512" height="62" rx="14" fill="#080807" stroke="#26221e" stroke-width="1"/>
  <text x="112" y="493" fill="#5fdc8f" font-size="18" font-weight="700" font-family="Inter, monospace">$</text>
  <text x="136" y="493" fill="#f1ede7" font-size="18" font-family="Inter, monospace" xml:space="preserve">npx ccclub join ${code}</text>

  <!-- Preview panel -->
  <rect x="684" y="110" width="430" height="406" rx="20" fill="#201d19" stroke="#2c2824"/>
  <text x="716" y="158" fill="#d6b56d" font-size="15" font-weight="700" font-family="Inter, sans-serif">Claude Code &amp; Codex leaderboard</text>
  <rect x="716" y="190" width="334" height="46" rx="8" fill="#d6b56d" fill-opacity="0.075"/>
  <rect x="716" y="252" width="278" height="46" rx="8" fill="#aeb7bf" fill-opacity="0.045"/>
  <rect x="716" y="314" width="364" height="46" rx="8" fill="#c58a61" fill-opacity="0.05"/>
  <text x="742" y="219" fill="#d6b56d" font-size="18" font-weight="700" font-family="Inter, sans-serif">1</text>
  <text x="782" y="219" fill="#f1ede7" font-size="17" font-weight="600" font-family="Inter, sans-serif">friends</text>
  <text x="742" y="281" fill="#aeb7bf" font-size="18" font-weight="700" font-family="Inter, sans-serif">2</text>
  <text x="782" y="281" fill="#f1ede7" font-size="17" font-weight="600" font-family="Inter, sans-serif">agents</text>
  <text x="742" y="343" fill="#c58a61" font-size="18" font-weight="700" font-family="Inter, sans-serif">3</text>
  <text x="782" y="343" fill="#f1ede7" font-size="17" font-weight="600" font-family="Inter, sans-serif">tokens</text>
  <text x="716" y="430" fill="#8a8480" font-size="17" font-family="Inter, sans-serif">No signup. Local logs only.</text>

  <!-- Footer -->
  <text x="86" y="560" fill="#4f4942" font-size="16" font-family="Inter, sans-serif">Claude Code · Codex · OpenCode · Amp · pi-agent</text>
  <text x="${W - 86}" y="560" text-anchor="end" fill="#4f4942" font-size="16" font-family="Inter, sans-serif">ccclub.dev/invite/${svgEsc(code)}</text>
</svg>`;
}

export { app as inviteRoute };
