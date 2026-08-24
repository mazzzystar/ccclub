import { Hono } from "hono";
import { html, raw } from "hono/html";
import type { Env } from "./types.js";
import { getNonCacheTokens, isRankedSource } from "@ccclub/shared";
import type { AgentSource, GroupRecord, RankingEntry, UsageData } from "@ccclub/shared";
import { computeGlobalRankings } from "./routes/rankings.js";
import { cachedPngResponse, getColor, hashCode, htmlEsc, latinOnly, ogCacheUrl, renderToPng, sanitizeCode, svgEsc, truncate } from "./og-utils.js";

const app = new Hono<{ Bindings: Env }>();

const GLOBAL_SSR_CACHE_KEY = "ssr_global:v1:weekly";

app.get("/g/:code", async (c) => {
  const code = sanitizeCode(c.req.param("code"));
  if (!code) return c.text("Invalid code", 400);
  const isGlobal = code.toLowerCase() === "global";

  if (isGlobal) {
    // Server-render the weekly top rows so the global leaderboard has real,
    // crawlable content (the client JS replaces it with the live view).
    let ssr = await c.env.KV.get<{ rankings: RankingEntry[]; memberCount: number }>(GLOBAL_SSR_CACHE_KEY, "json");
    if (!ssr) {
      try {
        const rank = await computeGlobalRankings(c.env, "weekly", 0);
        ssr = { rankings: rank.rankings.slice(0, 20), memberCount: rank.group.memberCount };
        c.executionCtx.waitUntil(
          c.env.KV.put(GLOBAL_SSR_CACHE_KEY, JSON.stringify(ssr), { expirationTtl: 600 }),
        );
      } catch {
        ssr = { rankings: [], memberCount: 0 };
      }
    }
    return c.html(dashboardHTML(code, "Global Rankings", ssr.memberCount, { ssr }));
  }

  const group = await c.env.KV.get<GroupRecord>(`group:${code}`, "json");
  // Private group dashboards are for members, not search results: noindex.
  // Unknown codes return the same shell with a 404 status.
  if (!group) {
    return c.html(dashboardHTML(code, "", 0, { noindex: true }), 404);
  }
  return c.html(dashboardHTML(code, group.name, group.members.length, { noindex: true }));
});

function ssrGlobalContentHTML(rankings: RankingEntry[]): string {
  if (rankings.length === 0) return "";
  const rows = rankings
    .map((r, i) => {
      const rankClass = i === 0 ? "rank gold" : i === 1 ? "rank silver" : i === 2 ? "rank bronze" : "rank";
      // Names go to the member's ccclub activity page; a member's own URL is
      // shown there rather than hijacking the name click.
      const name = `<a href="/u/${encodeURIComponent(r.slug || r.userId)}" class="name-link">${htmlEsc(r.displayName)}</a>`;
      return `<tr><td class="${rankClass}">${i + 1}</td><td><span class="name-text">${name}</span></td><td class="cost">$${r.costUSD.toFixed(2)}</td><td class="tokens">${formatCompactNumber(r.totalTokens)}</td><td class="calls">${formatCompactNumber(r.chatCount || 0)}</td></tr>`;
    })
    .join("");
  return `<div class="table-shell"><table><thead><tr><th>#</th><th>Member</th><th>Cost</th><th>Tokens</th><th>Turns</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="meta" style="text-align:left;margin-top:16px">Last 7 days, UTC. Everyone here opted in with <code>ccclub profile --public</code>. Cost is an estimate at public API pricing across Claude Code, Codex, OpenCode, Amp, Grok, and Pi.</p>`;
}

function ssrGlobalJsonLd(rankings: RankingEntry[]): string {
  if (rankings.length === 0) return "";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "ccclub global leaderboard — top users this week",
    url: "https://ccclub.dev/g/global",
    numberOfItems: Math.min(rankings.length, 10),
    itemListElement: rankings.slice(0, 10).map((r, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: r.displayName,
    })),
  };
  return `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;
}

// ── Dashboard OG image with ranking table ────────────────────

app.get("/g/:code/og.png", async (c) => {
  const code = sanitizeCode(c.req.param("code"));
  if (!code) return c.text("Invalid code", 400);
  const isGlobal = code.toLowerCase() === "global";

  let groupName: string;
  let members: Array<{ userId: string; displayName: string }>;
  let totalMembers: number;
  let cacheVersion: string;

  if (isGlobal) {
    groupName = "Global Rankings";
    const publicUsers = (await c.env.KV.get<string[]>("public_users", "json")) || [];
    totalMembers = publicUsers.length;
    members = publicUsers.slice(0, 30).map((id) => ({ userId: id, displayName: id.slice(0, 8) }));
    cacheVersion = `global:${totalMembers}:${Math.floor(Date.now() / 300_000)}`;
  } else {
    const [group, lastSync] = await Promise.all([
      c.env.KV.get<GroupRecord>(`group:${code}`, "json"),
      c.env.KV.get(`last_sync:${code}`, "text"),
    ]);
    if (!group) return c.text("Not found", 404);
    groupName = group.name;
    members = group.members.map((m) => ({ userId: m.userId, displayName: m.displayName }));
    totalMembers = members.length;
    cacheVersion = `${lastSync || "0"}:${hashCode(`${group.name}:${group.members.map((m) => `${m.userId}:${m.displayName}:${m.avatar || ""}:${m.joinedAt}`).join("|")}`)}`;
  }

  const cacheUrl = ogCacheUrl(c.req.url, `g/v2/${code}/${cacheVersion}.png`);
  return cachedPngResponse(cacheUrl, async () => {
    const usageResults = await Promise.all(
      members.map((m) => c.env.KV.get<UsageData>(`usage:${m.userId}`, "json")),
    );

    const now = Date.now();
    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);
    const startMs = todayStart.getTime();
    const endMs = startMs + 86_400_000;
    const agentSet = new Set<AgentSource>();
    let activeCount = 0;

    const ranked: DashboardOgEntry[] = [];
    for (let i = 0; i < members.length; i++) {
      const usage = usageResults[i];
      let cost = 0;
      let tokens = 0;
      let turns = 0;
      let lastActiveMs = 0;
      const agents = new Set<AgentSource>();

      if (usage) {
        for (const block of usage.blocks) {
          if (!isRankedSource(block.source)) continue;
          const t = new Date(block.blockStart).getTime();
          if (t < startMs || t >= endMs) continue;
          const activityTime = new Date(block.lastActivityAt || block.blockEnd || block.blockStart).getTime();
          if (Number.isFinite(activityTime) && activityTime > lastActiveMs) lastActiveMs = activityTime;
          const source = block.source ?? "claude";
          cost += block.costUSD;
          tokens += getNonCacheTokens(block);
          turns += block.chatCount || 0;
          agents.add(source);
          agentSet.add(source);
        }
      }
      if (lastActiveMs > 0 && now - lastActiveMs < 15 * 60 * 1000) {
        activeCount++;
      }
      ranked.push({
        ...members[i],
        agents: Array.from(agents),
        costUSD: Math.round(cost * 100) / 100,
        tokens,
        turns,
      });
    }
    ranked.sort((a, b) => b.costUSD - a.costUSD);

    const svg = buildDashboardOgSvg(
      groupName,
      ranked.slice(0, 5),
      totalMembers,
      activeCount,
      formatAgentSummary(Array.from(agentSet)),
      code,
    );
    return renderToPng(svg);
  }, {
    maxAge: 300,
    staleWhileRevalidate: 86_400,
    executionCtx: c.executionCtx,
  });
});

type DashboardOgEntry = {
  displayName: string;
  userId: string;
  costUSD: number;
  tokens: number;
  turns: number;
  agents: AgentSource[];
};

const AGENT_LABELS_OG: Record<AgentSource, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  amp: "Amp",
  pi: "Pi",
  grok: "Grok",
  // Wire-compat only: openclaw blocks are excluded from rankings server-side
  // and never render; the key exists because Record<AgentSource, …> needs it.
  openclaw: "OpenClaw",
};

const AGENT_ORDER_OG: AgentSource[] = ["claude", "codex", "opencode", "amp", "grok", "pi"];

function formatAgentSummary(agents: AgentSource[]): string {
  const ordered = AGENT_ORDER_OG.filter((a) => agents.includes(a));
  return ordered.length > 0 ? ordered.map((a) => AGENT_LABELS_OG[a]).join(" · ") : "Claude Code · Codex · OpenCode · Amp · Grok · Pi";
}

function formatAgentCell(agents: AgentSource[]): string {
  const ordered = AGENT_ORDER_OG.filter((a) => agents.includes(a));
  if (ordered.length === 0) return "—";
  return ordered.slice(0, 2).map((a) => AGENT_LABELS_OG[a].replace(" Code", "")).join(", ");
}

function formatCompactNumber(n: number): string {
  if (n >= 1_000_000_000) return `${parseFloat((n / 1_000_000_000).toFixed(1))}B`;
  if (n >= 1_000_000) return `${parseFloat((n / 1_000_000).toFixed(1))}M`;
  if (n >= 1_000) return `${parseFloat((n / 1_000).toFixed(1))}K`;
  return String(Math.round(n));
}

function buildDashboardOgSvg(
  groupName: string,
  top5: DashboardOgEntry[],
  totalMembers: number,
  activeCount: number,
  agentSummary: string,
  code: string,
): string {
  const W = 1200;
  const H = 630;
  const name = svgEsc(truncate(latinOnly(groupName) || code, 32));

  const ROW_H = 56;
  const TABLE_X = 86;
  const TABLE_W = 1028;
  const TABLE_Y = 238;
  const memberLabel = `${totalMembers} member${totalMembers !== 1 ? "s" : ""}`;
  const activeLabel = `${activeCount} active`;

  let tableRows = "";
  top5.forEach((entry, i) => {
    const y = TABLE_Y + i * ROW_H;
    const color = getColor(entry.userId);
    const latin = latinOnly(entry.displayName);
    const initial = svgEsc((latin || "?").charAt(0).toUpperCase());
    const displayName = svgEsc(truncate(latin || entry.userId.slice(0, 8), 22));
    const rankColor = i === 0 ? "#d6b56d" : i === 1 ? "#aeb7bf" : i === 2 ? "#c58a61" : "#746f69";
    const tint = i === 0 ? "#d6b56d" : i === 1 ? "#aeb7bf" : i === 2 ? "#c58a61" : "#ffffff";
    const tintOpacity = i === 0 ? "0.075" : i === 1 ? "0.045" : i === 2 ? "0.05" : i % 2 === 0 ? "0.026" : "0.018";
    const costStr = entry.costUSD > 0 ? `$${entry.costUSD.toFixed(2)}` : "$0.00";
    const agentStr = svgEsc(formatAgentCell(entry.agents));

    tableRows += `
      <rect x="${TABLE_X}" y="${y}" width="${TABLE_W}" height="${ROW_H - 4}" rx="8" fill="${tint}" fill-opacity="${tintOpacity}" stroke="#2a2723" stroke-width="1"/>
      <text x="${TABLE_X + 24}" y="${y + 34}" fill="${rankColor}" font-size="18" font-weight="700" font-family="Inter, sans-serif">${i + 1}</text>
      <circle cx="${TABLE_X + 72}" cy="${y + 27}" r="17" fill="${color}"/>
      <text x="${TABLE_X + 72}" y="${y + 33}" text-anchor="middle" fill="#161412" font-size="14" font-weight="700" font-family="Inter, sans-serif">${initial}</text>
      <text x="${TABLE_X + 104}" y="${y + 34}" fill="#f1ede7" font-size="18" font-weight="600" font-family="Inter, sans-serif">${displayName}</text>
      <text x="${TABLE_X + 460}" y="${y + 34}" fill="#a8a19a" font-size="15" font-weight="500" font-family="Inter, sans-serif">${agentStr}</text>
      <text x="${TABLE_X + 700}" y="${y + 34}" text-anchor="end" fill="#d4935e" font-size="17" font-weight="700" font-family="Inter, sans-serif">${costStr}</text>
      <text x="${TABLE_X + 850}" y="${y + 34}" text-anchor="end" fill="#cfc8c0" font-size="16" font-weight="600" font-family="Inter, sans-serif">${formatCompactNumber(entry.tokens)}</text>
      <text x="${TABLE_X + TABLE_W - 28}" y="${y + 34}" text-anchor="end" fill="#cfc8c0" font-size="16" font-weight="600" font-family="Inter, sans-serif">${formatCompactNumber(entry.turns)}</text>`;
  });

  if (top5.length === 0) {
    tableRows = `<rect x="${TABLE_X}" y="${TABLE_Y}" width="${TABLE_W}" height="170" rx="12" fill="#1f1c18" stroke="#2a2723"/><text x="${W / 2}" y="${TABLE_Y + 94}" text-anchor="middle" fill="#6b6560" font-size="20" font-family="Inter, sans-serif">No activity yet today</text>`;
  }

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#201d19"/>
      <stop offset="100%" stop-color="#13110f"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="42" y="34" width="${W - 84}" height="${H - 68}" rx="24" fill="#181512" stroke="#2b2723"/>

  <!-- Brand -->
  <text x="86" y="78" fill="#746f69" font-size="20" font-weight="700" font-family="Inter, sans-serif">ccclub</text>
  <circle cx="86" cy="118" r="5" fill="#5fdc8f"/>
  <text x="102" y="124" fill="#8a8480" font-size="15" font-weight="600" font-family="Inter, sans-serif">Live leaderboard preview</text>

  <!-- Group name -->
  <text x="86" y="166" fill="#f3eee7" font-size="44" font-weight="700" font-family="Inter, sans-serif" letter-spacing="-1">${name}</text>

  <!-- Subtitle -->
  <text x="86" y="194" fill="#8a8480" font-size="17" font-family="Inter, sans-serif">Today · ${memberLabel} · ${activeLabel}</text>
  <rect x="748" y="72" width="366" height="52" rx="14" fill="#201d19" stroke="#2c2824"/>
  <text x="770" y="105" fill="#a8a19a" font-size="15" font-weight="600" font-family="Inter, sans-serif">${svgEsc(truncate(agentSummary, 44))}</text>

  <!-- Header row -->
  <text x="${TABLE_X + 24}" y="${TABLE_Y - 14}" fill="#6d6760" font-size="12" font-weight="700" font-family="Inter, sans-serif" letter-spacing="0.8">#</text>
  <text x="${TABLE_X + 104}" y="${TABLE_Y - 14}" fill="#6d6760" font-size="12" font-weight="700" font-family="Inter, sans-serif" letter-spacing="0.8">MEMBER</text>
  <text x="${TABLE_X + 460}" y="${TABLE_Y - 14}" fill="#6d6760" font-size="12" font-weight="700" font-family="Inter, sans-serif" letter-spacing="0.8">AGENTS</text>
  <text x="${TABLE_X + 700}" y="${TABLE_Y - 14}" text-anchor="end" fill="#6d6760" font-size="12" font-weight="700" font-family="Inter, sans-serif" letter-spacing="0.8">COST</text>
  <text x="${TABLE_X + 850}" y="${TABLE_Y - 14}" text-anchor="end" fill="#6d6760" font-size="12" font-weight="700" font-family="Inter, sans-serif" letter-spacing="0.8">TOKENS</text>
  <text x="${TABLE_X + TABLE_W - 28}" y="${TABLE_Y - 14}" text-anchor="end" fill="#6d6760" font-size="12" font-weight="700" font-family="Inter, sans-serif" letter-spacing="0.8">TURNS</text>

  <!-- Ranking rows -->
  ${tableRows}

  <!-- Footer -->
  <text x="86" y="${H - 70}" fill="#4f4942" font-size="15" font-family="Inter, sans-serif">ccclub.dev/g/${svgEsc(code)}</text>
  <text x="${W - 86}" y="${H - 70}" text-anchor="end" fill="#4f4942" font-size="15" font-family="Inter, sans-serif">Claude Code · Codex leaderboard among friends</text>
</svg>`;
}


function dashboardHTML(
  code: string,
  groupName: string,
  memberCount: number,
  opts: { noindex?: boolean; ssr?: { rankings: RankingEntry[]; memberCount: number } } = {},
) {
  const isGlobal = code.toLowerCase() === "global";
  const ogTitle = isGlobal
    ? "Global Coding-Agent Leaderboard \u2014 ccclub"
    : groupName
      ? `${htmlEsc(truncate(groupName, 40))} \u2014 ccclub`
      : "ccclub \u2014 Leaderboard";
  const ogDesc = isGlobal
    ? "Live leaderboard of Claude Code, Codex, OpenCode, Amp, Grok, and Pi usage \u2014 developers who opted in, ranked by tokens and estimated cost."
    : groupName
      ? `${memberCount} member${memberCount !== 1 ? "s" : ""} competing on coding agent usage.`
      : "Coding agent leaderboard among friends. See how you're all doing.";
  const ssrContent = opts.ssr ? ssrGlobalContentHTML(opts.ssr.rankings) : "";
  return html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${ogTitle}</title>
  <meta name="description" content="${ogDesc}" />
  ${opts.noindex ? html`<meta name="robots" content="noindex" />` : ""}
  ${opts.ssr ? raw(ssrGlobalJsonLd(opts.ssr.rankings)) : ""}

  <meta property="og:type" content="website" />
  <meta property="og:title" content="${ogTitle}" />
  <meta property="og:description" content="${ogDesc}" />
  <meta property="og:url" content="https://ccclub.dev/g/${code}" />
  <meta property="og:image" content="https://ccclub.dev/g/${code}/og.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${ogTitle}" />
  <meta name="twitter:description" content="${ogDesc}" />
  <meta name="twitter:image" content="https://ccclub.dev/g/${code}/og.png" />

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
    :root {
      --bg: #1a1816;
      --surface: #201e1c;
      --surface-soft: #24211f;
      --surface-deep: #13110f;
      --line: #332f2b;
      --line-soft: #282521;
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
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      background: var(--bg); color: var(--text); min-height: 100vh;
      -webkit-font-smoothing: antialiased;
      line-height: 1.6;
    }
    code { font-family: "SF Mono", "Fira Code", Menlo, Consolas, monospace; }

    .wrap { max-width: 880px; margin: 0 auto; padding: 44px 24px; }

    /* Top nav */
    .top-nav {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 20px;
    }

    /* Back link */
    .back-link {
      color: var(--muted); font-size: 13px; text-decoration: none;
      transition: color 0.15s;
    }
    .back-link:hover { color: var(--link); }

    .global-link {
      color: var(--muted); font-size: 13px; text-decoration: none;
      transition: color 0.15s;
    }
    .global-link:hover { color: var(--link); }

    /* Header */
    h1 { font-size: 28px; font-weight: 680; letter-spacing: -0.7px; color: var(--title); }
    .subtitle { color: var(--muted); font-size: 13px; margin-top: 4px; }
    .agent-summary { color: var(--muted); font-size: 12px; margin-top: 5px; min-height: 18px; }

    /* Period selector */
    .periods {
      display: flex; gap: 6px; margin: 28px 0; flex-wrap: wrap; align-items: center;
      padding: 4px; border-radius: 10px; background: rgba(255,255,255,0.025);
      border: 1px solid var(--line-soft);
    }
    .periods button {
      padding: 6px 14px; border-radius: 7px; border: 1px solid transparent;
      background: transparent; color: var(--muted); cursor: pointer;
      font-size: 13px; font-family: inherit;
      transition: all 0.15s ease;
    }
    .periods button:hover:not(.toggle) { color: var(--text); background: rgba(255,255,255,0.035); }
    .periods button.active {
      background: var(--surface-soft); color: var(--text); border-color: rgba(255,255,255,0.06);
    }

    /* Cache toggle */
    .toggle-wrap {
      margin-left: auto; display: flex; align-items: center; gap: 6px;
    }
    .toggle-label { font-size: 12px; color: var(--muted); user-select: none; cursor: pointer; }
    .periods button.toggle,
    .toggle {
      position: relative; width: 32px; height: 18px; cursor: pointer;
      background: var(--line); border-radius: 9px; border: none; outline: none;
      padding: 0; transition: background 0.2s;
    }
    .toggle::after {
      content: ""; position: absolute; top: 2px; left: 2px;
      width: 14px; height: 14px; border-radius: 50%;
      background: var(--muted); transition: all 0.2s;
    }
    .periods button.toggle.on,
    .toggle.on { background: var(--success); }
    .toggle.on::after { left: 16px; background: var(--text); }

    /* Table */
    .table-shell {
      overflow-x: auto; border-radius: 10px; border: 1px solid var(--line-soft);
      background: rgba(19,17,15,0.38);
    }
    table { width: 100%; border-collapse: collapse; margin-top: 0; min-width: 680px; }
    th {
      color: var(--faint); font-size: 11px; text-transform: uppercase;
      letter-spacing: 0.5px; font-weight: 500;
      text-align: left; padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      background: rgba(255,255,255,0.012);
    }
    td { padding: 14px 12px; border-bottom: 1px solid var(--line-soft); }
    tbody tr { transition: background 0.15s ease; }
    tbody tr:hover { background: rgba(255,255,255,0.025); }
    tbody tr:last-child td { border-bottom: none; }
    tr.top-one { background: rgba(214,181,109,0.045); }
    tr.top-two { background: rgba(174,183,191,0.028); }
    tr.top-three { background: rgba(197,138,97,0.032); }
    .rank { font-weight: 650; width: 40px; color: var(--faint); }
    .rank.gold { color: var(--gold); }
    .rank.silver { color: var(--silver); }
    .rank.bronze { color: var(--bronze); }
    .name-cell { display: flex; align-items: center; gap: 12px; }
    .name-cell > div:last-child { flex: 1; min-width: 0; }
    .avatar-wrap { position: relative; flex-shrink: 0; width: 32px; height: 32px; }
    .avatar {
      width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      font-weight: 600; font-size: 13px; color: var(--bg);
    }
    .typing-bubble {
      position: absolute; top: -6px; right: -4px;
      background: var(--surface-soft); border-radius: 8px;
      padding: 3px 5px; display: flex; gap: 2px; align-items: center;
      box-shadow: 0 0 0 2px var(--bg);
    }
    .typing-bubble span {
      width: 3.5px; height: 3.5px; border-radius: 50%; background: var(--text);
      opacity: 0.15; animation: typing-fade 1.2s infinite ease-in-out;
    }
    .typing-bubble span:nth-child(1) { animation-delay: 0s; }
    .typing-bubble span:nth-child(2) { animation-delay: 0.3s; }
    .typing-bubble span:nth-child(3) { animation-delay: 0.6s; }
    @keyframes typing-fade {
      0%, 100% { opacity: 0.15; }
      30%, 50% { opacity: 1; }
    }
    .avatar img {
      width: 32px; height: 32px; border-radius: 50%; object-fit: cover;
    }
    .avatar img.errored { display: none; }
    .avatar .fallback { display: none; }
    .avatar img.errored + .fallback { display: flex; }
    .name-text { font-weight: 500; font-size: 14px; }
    .agent-line {
      color: var(--faint); font-size: 11px; margin-top: 4px; min-height: 18px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .agent-source { color: var(--muted); }
    .agent-percent { color: var(--faint); font-variant-numeric: tabular-nums; }
    /* Members without projects get no container at all, so the row keeps its rhythm. */
    .project-line { display: flex; flex-wrap: wrap; gap: 5px 6px; margin-top: 5px; }
    .project-chip {
      display: inline-flex; align-items: center; gap: 5px; max-width: 100%;
      padding: 2px 7px; border-radius: 999px;
      background: var(--surface-soft); border: 1px solid var(--line-soft);
      color: var(--muted); font-size: 11px; line-height: 1.55; text-decoration: none;
    }
    a.project-chip:hover { color: var(--text); border-color: var(--line); }
    .project-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 150px; }
    .project-icon { width: 12px; height: 12px; border-radius: 3px; object-fit: cover; flex: 0 0 auto; }
    .project-letter {
      width: 12px; height: 12px; border-radius: 3px; flex: 0 0 auto;
      display: inline-flex; align-items: center; justify-content: center;
      background: rgba(255,255,255,0.07); color: var(--muted);
      font-size: 8px; font-weight: 650; line-height: 1;
    }
    .project-icon + .project-letter { display: none; }
    .project-icon.errored { display: none; }
    .project-icon.errored + .project-letter { display: inline-flex; }
    .active-badge {
      display: inline-flex; align-items: center; gap: 4px; vertical-align: -1px;
      color: var(--success); font-size: 12px; font-weight: 400; margin-left: 6px; line-height: 1;
    }
    .active-agent-icon {
      width: 12px; height: 12px; display: block; object-fit: contain; flex: 0 0 auto;
    }
    .active-agent-fallback {
      width: 12px; height: 12px; display: inline-flex; align-items: center; justify-content: center;
      border-radius: 3px; background: rgba(99,180,134,0.12); color: var(--success); font-size: 10px; font-weight: 600;
    }
    .active-count {
      color: var(--success); font-size: 13px; margin-top: 4px;
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    }
    .active-split {
      display: inline-flex; align-items: center; gap: 6px;
      color: var(--muted); font-size: 12px;
    }
    .active-source-score {
      display: inline-flex; align-items: center; gap: 4px;
      white-space: nowrap;
    }
    .active-source-score img {
      width: 13px; height: 13px; display: block; object-fit: contain;
    }
    .active-source-score .fallback {
      width: 13px; height: 13px; border-radius: 3px;
      display: inline-flex; align-items: center; justify-content: center;
      background: rgba(99,180,134,0.12); color: var(--success);
      font-size: 10px; font-weight: 650; line-height: 1;
    }
    .active-source-score .score-count {
      color: var(--success); font-weight: 650; font-variant-numeric: tabular-nums;
    }
    .active-score-sep { color: var(--faint); }
    .week-winners {
      display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
      margin-top: 9px; min-height: 22px;
    }
    /* A group with no coding this week shows nothing rather than a bare frame. */
    .week-winners:empty { display: none; }
    .ww-label { color: var(--faint); font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; }
    .ww-track { display: inline-flex; align-items: center; gap: 5px; }
    .ww-slot {
      width: 22px; height: 22px; border-radius: 7px;
      display: inline-flex; align-items: center; justify-content: center; gap: 1px;
      background: var(--surface-soft); border: 1px solid var(--line-soft);
      cursor: default;
    }
    .ww-slot img { width: 13px; height: 13px; display: block; object-fit: contain; }
    .ww-slot.tie img { width: 10px; height: 10px; }
    .ww-slot.quiet { background: transparent; border-style: dashed; }
    .ww-slot.pending { background: transparent; border-color: var(--line-soft); opacity: 0.45; }
    .ww-slot.today { border-color: var(--success); box-shadow: 0 0 0 2px rgba(99,180,134,0.15); }
    .name-link { color: inherit; text-decoration: none; }
    .name-link:hover { color: #ffffff; }
    .bar {
      height: 3px; background: var(--brand); border-radius: 2px; margin-top: 6px;
      opacity: 0.55; transition: width 0.3s;
    }
    .tokens { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 14px; }
    .cost { font-variant-numeric: tabular-nums; font-size: 14px; }
    .roi { font-variant-numeric: tabular-nums; font-size: 13px; white-space: nowrap; }
    .roi .price { color: var(--faint); }
    .roi .pct { font-weight: 500; }
    .roi .pct.high { color: var(--success); }
    .roi .pct.mid { color: var(--brand); }
    .roi .pct.low { color: var(--faint); }
    .calls { color: var(--muted); font-size: 14px; }
    .avg-turn { font-variant-numeric: tabular-nums; white-space: nowrap; }
    .avg-turn-main { color: var(--text); font-size: 14px; }
    .avg-turn-sub { color: var(--faint); font-size: 11px; margin-top: 2px; }

    /* Activity chart */
    .chart-section { margin-top: 32px; }
    .chart-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 16px;
    }
    .chart-title { font-size: 15px; font-weight: 500; color: var(--text); }
    .chart-canvas {
      background: var(--surface-deep); border-radius: 10px; padding: 16px;
      border: 1px solid rgba(255,255,255,0.06);
    }
    .chart-canvas svg { width: 100%; display: block; }
    .chart-legend {
      display: flex; flex-wrap: wrap; gap: 12px; margin-top: 10px;
      padding: 0 4px;
    }
    .chart-legend-item {
      display: flex; align-items: center; gap: 5px;
      font-size: 12px; color: var(--muted); cursor: pointer; user-select: none;
    }
    .chart-legend-item.hidden { opacity: 0.4; }
    .chart-legend-dot {
      width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
    }
    .chart-canvas { position: relative; }
    .chart-tooltip {
      position: absolute; pointer-events: none; opacity: 0;
      background: var(--surface); border: 1px solid rgba(255,255,255,0.12);
      border-radius: 6px; padding: 6px 10px; font-size: 12px;
      color: var(--text); white-space: nowrap; z-index: 10;
      transition: opacity 0.15s;
    }
    .chart-tooltip.visible { opacity: 1; }

    /* Empty */
    .empty { text-align: center; color: var(--faint); padding: 64px 0; font-size: 14px; line-height: 1.8; }

    /* Invite */
    .invite {
      margin-top: 40px; padding: 20px; background: var(--surface-soft); border-radius: 10px;
      display: flex; align-items: center; justify-content: space-between;
      border: 1px solid var(--line-soft);
    }
    .invite-label { color: var(--muted); font-size: 13px; margin-bottom: 4px; }
    .invite-code {
      font-family: "SF Mono", Menlo, monospace;
      font-size: 14px; letter-spacing: 0.5px; font-weight: 600; color: var(--text);
    }
    .copy-btn {
      padding: 8px 16px; border-radius: 6px; border: 1px solid var(--line);
      background: transparent; color: var(--muted); cursor: pointer;
      font-size: 13px; font-family: inherit; transition: all 0.15s ease;
    }
    .copy-btn:hover { border-color: var(--link); color: var(--text); }

    /* Solo-group callout: shown above the table when the group has 1 member */
    .solo-cta {
      margin-bottom: 20px; padding: 22px 20px; text-align: center;
      background: linear-gradient(180deg, rgba(212,147,94,0.08), rgba(212,147,94,0.02));
      border: 1px solid rgba(212,147,94,0.25); border-radius: 12px;
    }
    .solo-cta-title { font-size: 16px; font-weight: 650; color: var(--text); margin-bottom: 4px; }
    .solo-cta-sub { font-size: 13px; color: var(--muted); margin-bottom: 14px; }
    .solo-cta-row {
      display: inline-flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: center;
    }
    .solo-cta-row code {
      font-family: "SF Mono", Menlo, monospace; font-size: 13px; color: var(--text);
      background: var(--surface-soft); border: 1px solid var(--line-soft);
      border-radius: 6px; padding: 8px 12px;
    }

    /* Footer */
    .meta { color: var(--faint); font-size: 12px; margin-top: 24px; text-align: center; }

    @media (max-width: 600px) {
      .wrap { padding: 32px 16px; }
      .periods { align-items: stretch; }
      .toggle-wrap { width: 100%; margin-left: 0; justify-content: flex-end; padding: 2px 6px 4px; }
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
    <h1 id="title">${isGlobal ? "Global Rankings" : ""}</h1>
    <div class="subtitle" id="date-range">${isGlobal ? "Coding-agent usage leaderboard · opt-in · updates live" : ""}</div>
    <div class="agent-summary" id="agent-summary">${isGlobal ? "Claude Code · Codex · OpenCode · Amp · Grok · Pi" : ""}</div>
    <div class="week-winners" id="week-winners"></div>
    <div class="active-count" id="active-count"></div>

    <div class="periods">
      <button class="active" data-period="daily">Today</button>
      <button data-period="yesterday">Yesterday</button>
      <button data-period="weekly">7d</button>
      <button data-period="monthly">30d</button>
      <button data-period="all-time">All Time</button>
      <div class="toggle-wrap">
        <span class="toggle-label" id="cache-label">Include cache</span>
        <button class="toggle on" id="cache-toggle" aria-label="Include cache tokens"></button>
      </div>
    </div>

    <div id="content">${raw(ssrContent)}</div>

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
      <a href="/" style="color:var(--muted);text-decoration:none">\u2190 Home</a>
      <a href="https://github.com/mazzzystar/ccclub" style="display:flex;align-items:center;opacity:0.58;color:var(--muted)" aria-label="GitHub"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg></a>
      <a href="https://discord.gg/6QbGWJUVHq" style="display:flex;align-items:center;opacity:0.58;color:var(--muted)" aria-label="Discord"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z"/></svg></a>
    </div>
  </div>

  <script>
    var CODE = "${code}";
    var IS_GLOBAL = ${isGlobal ? "true" : "false"};
    var period = "daily";
    var showCache = true;
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
      var bubble = isActive ? '<div class="typing-bubble"><span></span><span></span><span></span></div>' : '';
      if (avatarUrl) {
        return '<div class="avatar-wrap">' +
          '<div class="avatar">' +
          '<img src="' + esc(avatarUrl) + '" alt="" onerror="this.classList.add(&#39;errored&#39;)">' +
          '<span class="fallback avatar" style="background:' + color + ';width:32px;height:32px;display:none;align-items:center;justify-content:center">' + initial + '</span>' +
          '</div>' + bubble + '</div>';
      }
      return '<div class="avatar-wrap"><div class="avatar" style="background:' + color + '">' + initial + '</div>' + bubble + '</div>';
    }

    var AGENT_ORDER = ["claude", "codex", "opencode", "amp", "grok", "pi"];
    var AGENT_LABELS = { claude: "Claude Code", codex: "Codex", opencode: "OpenCode", amp: "Amp", pi: "Pi", grok: "Grok" };
    var AGENT_ICONS = { claude: "/agent-icons/claude.svg", codex: "/agent-icons/codex.svg", opencode: "/agent-icons/opencode-light.svg", amp: "/agent-icons/amp.svg", grok: "/agent-icons/grok-light.svg", pi: "/agent-icons/pi-light.svg" };
    function activeTime(row) {
      var value = row.lastActiveAt || row.lastSync;
      if (!value) return 0;
      var ms = new Date(value).getTime();
      return isNaN(ms) ? 0 : ms;
    }
    function isRecentlyActive(row, now) {
      var ms = activeTime(row);
      return ms > 0 && (now - ms) < ACTIVE_THRESHOLD_MS;
    }
    function activeSourceForRow(row) {
      return row.lastActiveSource || (row.agents && row.agents[0]);
    }
    function orderedAgents(agents) {
      agents = agents || [];
      return AGENT_ORDER.filter(function(a) { return agents.indexOf(a) !== -1; })
        .concat(agents.filter(function(a) { return AGENT_ORDER.indexOf(a) === -1; }));
    }
    function getAgentBreakdown(row) {
      if (row.agentBreakdown && row.agentBreakdown.length > 0) return row.agentBreakdown;
      return orderedAgents(row.agents).map(function(source) {
        return { source: source, costUSD: 0, totalTokens: 0, nonCacheTokens: 0, chatCount: 0, entryCount: 0, percent: 0 };
      });
    }
    function nonCacheTokensForRow(row) {
      if (typeof row.nonCacheTokens === "number") return row.nonCacheTokens;
      if (row.agentBreakdown && row.agentBreakdown.length > 0) {
        return row.agentBreakdown.reduce(function(sum, agent) {
          return sum + (agent.nonCacheTokens || 0);
        }, 0);
      }
      // Compatibility with responses cached by workers older than v0.6.10.
      return row.inputTokens + row.outputTokens + (row.reasoningTokens || 0);
    }
    function agentTooltip(row) {
      if (!row.agentBreakdown || row.agentBreakdown.length === 0) {
        return orderedAgents(row.agents).map(function(source) {
          return AGENT_LABELS[source] || source;
        }).join("\\n");
      }
      return getAgentBreakdown(row).map(function(agent) {
        var label = AGENT_LABELS[agent.source] || agent.source;
        var pct = agent.percent ? agent.percent + "% · " : "";
        var cost = agent.costUSD ? "$" + agent.costUSD.toFixed(2) + " · " : "";
        var tokenCount = showCache ? agent.totalTokens : (agent.nonCacheTokens != null ? agent.nonCacheTokens : agent.totalTokens);
        var tokens = tokenCount ? formatTokens(tokenCount) + " tokens · " : "";
        var turns = (agent.chatCount || 0) + " turn" + ((agent.chatCount || 0) === 1 ? "" : "s");
        return label + ": " + pct + cost + tokens + turns;
      }).join("\\n");
    }
    function agentMixHTML(row) {
      var breakdown = getAgentBreakdown(row);
      if (breakdown.length === 0) return "";
      var hasBreakdown = row.agentBreakdown && row.agentBreakdown.length > 0;
      var text = breakdown.map(function(agent) {
        var label = esc(AGENT_LABELS[agent.source] || agent.source);
        if (hasBreakdown && breakdown.length > 1) {
          return '<span class="agent-source">' + label + '</span> <span class="agent-percent">(' + agent.percent + '%)</span>';
        }
        return '<span class="agent-source">' + label + '</span>';
      }).join('<span class="agent-percent">, </span>');
      return '<div class="agent-line" title="' + esc(agentTooltip(row)) + '">' +
        text + '</div>';
    }
    var MAX_PROJECTS = 5;
    // Project names and URLs are whatever a member typed. esc() leaves quotes
    // alone, so nothing reaches an attribute without passing through the URL
    // parser (which percent-encodes quotes) or encodeURIComponent first.
    function safeProjectUrl(url) {
      if (typeof url !== "string" || !/^https:\\/\\//.test(url)) return "";
      try {
        var parsed = new URL(url);
        if (parsed.protocol !== "https:") return "";
        return /^https:\\/\\//.test(parsed.href) ? parsed.href : "";
      } catch (e) {
        return "";
      }
    }
    // GitHub projects borrow the owner's avatar; everything else falls back to
    // the site's favicon service. Both are best-effort — onerror reveals the
    // letter badge underneath rather than a broken-image glyph.
    function projectIconSrc(url) {
      try {
        var parsed = new URL(url);
        if (!parsed.hostname) return "";
        if (parsed.hostname === "github.com" || parsed.hostname === "www.github.com") {
          var owner = parsed.pathname.split("/").filter(Boolean)[0];
          if (owner) return "https://github.com/" + encodeURIComponent(owner) + ".png?size=32";
          return "";
        }
        return "https://icons.duckduckgo.com/ip3/" + encodeURIComponent(parsed.hostname) + ".ico";
      } catch (e) {
        return "";
      }
    }
    function projectChipHTML(project) {
      if (!project || typeof project.name !== "string") return "";
      var name = project.name.trim();
      if (!name) return "";
      var url = safeProjectUrl(project.url);
      var iconSrc = url ? projectIconSrc(url) : "";
      var letter = '<span class="project-letter">' + esc(name.charAt(0).toUpperCase()) + '</span>';
      var icon = iconSrc
        ? '<img class="project-icon" src="' + iconSrc + '" alt="" onerror="this.classList.add(&#39;errored&#39;)">' + letter
        : letter;
      var inner = icon + '<span class="project-name">' + esc(name) + '</span>';
      if (url) {
        return '<a class="project-chip" href="' + esc(url) + '" target="_blank" rel="noopener">' + inner + '</a>';
      }
      return '<span class="project-chip">' + inner + '</span>';
    }
    function projectsHTML(row) {
      if (!row.projects || row.projects.length === 0) return "";
      var chips = row.projects.slice(0, MAX_PROJECTS).map(projectChipHTML).join("");
      if (!chips) return "";
      return '<div class="project-line">' + chips + '</div>';
    }
    function activeBadgeHTML(row, isActive) {
      if (!isActive) return "";
      var source = row.lastActiveSource || (row.agents && row.agents[0]);
      var label = (source && AGENT_LABELS[source]) || source || "active";
      var icon = "";
      if (source && AGENT_ICONS[source]) {
        icon = '<img class="active-agent-icon" src="' + AGENT_ICONS[source] + '" alt="">';
      }
      return '<span class="active-badge" title="' + esc(label + " active") + '">' + icon + '<span>active</span></span>';
    }
    function activeSourceScoreHTML(source, count, countFirst) {
      var label = AGENT_LABELS[source] || source;
      var icon = "";
      if (AGENT_ICONS[source]) {
        icon = '<img src="' + AGENT_ICONS[source] + '" alt="">';
      } else {
        icon = '<span class="fallback">' + esc((label || "?").charAt(0).toUpperCase()) + '</span>';
      }
      var countHTML = '<span class="score-count">' + count + '</span>';
      var labelHTML = '<span>' + esc(source === "claude" ? "Claude" : label) + '</span>';
      return '<span class="active-source-score" title="' + esc(label + " active") + '">' +
        (countFirst ? countHTML + icon + labelHTML : icon + labelHTML + countHTML) +
        '</span>';
    }
    var WEEK_DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    function weekDayLabel(day) {
      var d = new Date(day + "T00:00:00Z");
      if (isNaN(d.getTime())) return day;
      return WEEK_DAY_NAMES[d.getUTCDay()] + " " + MONTH_NAMES[d.getUTCMonth()] + " " + d.getUTCDate();
    }
    function weekSlotIconHTML(source) {
      if (AGENT_ICONS[source]) {
        return '<img src="' + AGENT_ICONS[source] + '" alt="' + esc(AGENT_LABELS[source] || source) + '">';
      }
      return '<span class="fallback">' + esc((AGENT_LABELS[source] || source || "?").charAt(0)) + '</span>';
    }
    // One slot per weekday, Monday first. Elapsed days carry the winning
    // agent; the rest stay empty so the row reads as a week in progress.
    function weekWinnersHTML(days) {
      if (!days || days.length === 0) return "";
      var wins = 0;
      var slots = "";
      for (var i = 0; i < 7; i++) {
        var day = days[i];
        if (!day) {
          slots += '<span class="ww-slot pending"></span>';
          continue;
        }
        var winners = day.winners || [];
        var cls = "ww-slot";
        if (i === days.length - 1) cls += " today";
        if (winners.length === 0) cls += " quiet";
        if (winners.length > 1) cls += " tie";

        var detail = (day.counts || []).map(function(c) {
          return (AGENT_LABELS[c.source] || c.source) + " " + c.users;
        }).join(", ");
        var title = weekDayLabel(day.day) + " · " + (detail || "no coding");

        slots += '<span class="' + cls + '" title="' + esc(title) + '">' +
          winners.map(weekSlotIconHTML).join("") + '</span>';
        if (winners.length > 0) wins++;
      }

      // Nobody coded all week: skip the row instead of showing seven blanks.
      if (wins === 0) return "";

      return '<span class="ww-label">Week Winner</span>' +
        '<span class="ww-track">' + slots + '</span>';
    }
    function claudeCodexActiveSplitHTML(claudeCount, codexCount) {
      return '<span class="active-split">' +
        '<span class="active-source-score" title="Claude Code active">' +
          '<img src="' + AGENT_ICONS.claude + '" alt="">' +
          '<span>Claude</span>' +
          '<span class="score-count">' + claudeCount + '</span>' +
        '</span>' +
        '<span class="active-score-sep">:</span>' +
        '<span class="active-source-score" title="Codex active">' +
          '<span class="score-count">' + codexCount + '</span>' +
          '<span>Codex</span>' +
          '<img src="' + AGENT_ICONS.codex + '" alt="">' +
        '</span>' +
      '</span>';
    }
    function activeSplitHTML(rows, now) {
      var counts = {};
      rows.forEach(function(row) {
        if (!isRecentlyActive(row, now)) return;
        var source = activeSourceForRow(row);
        if (!source) return;
        counts[source] = (counts[source] || 0) + 1;
      });
      var sources = AGENT_ORDER.filter(function(source) { return counts[source] > 0; })
        .concat(Object.keys(counts).filter(function(source) { return AGENT_ORDER.indexOf(source) === -1; }));
      if (sources.length === 0) return "";
      if (sources.length === 2 && counts.claude && counts.codex) {
        return claudeCodexActiveSplitHTML(counts.claude, counts.codex);
      }
      return '<span class="active-split">' + sources.map(function(source) {
        return activeSourceScoreHTML(source, counts[source], false);
      }).join('<span class="active-score-sep">·</span>') + '</span>';
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
          // Boundaries are UTC instants; render the viewer's local calendar
          // dates (end is exclusive) so "Today" reads as one day, not two.
          var rangeText = "";
          if (period !== "all-time") {
            var localYMD = function(d) {
              return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
            };
            var startDay = localYMD(new Date(data.start));
            var endDay = localYMD(new Date(new Date(data.end).getTime() - 1));
            rangeText = (startDay === endDay ? startDay : startDay + " \u2014 " + endDay) + " \u00b7 ";
          }
          document.getElementById("date-range").textContent =
            rangeText + data.group.memberCount + (IS_GLOBAL ? " public users" : " members");

          var now = Date.now();
          var agentSet = {};
          data.rankings.forEach(function(r) {
            (r.agents || []).forEach(function(a) { agentSet[a] = true; });
          });
          var agentKeys = AGENT_ORDER.filter(function(a) { return agentSet[a]; })
            .concat(Object.keys(agentSet).filter(function(a) { return AGENT_ORDER.indexOf(a) === -1; }));
          var agentNames = agentKeys.map(function(a) { return AGENT_LABELS[a] || a; });
          var agentSummaryEl = document.getElementById("agent-summary");
          agentSummaryEl.textContent = agentNames.length > 0
            ? "Sources this period: " + agentNames.join(" \u00b7 ")
            : "Supports Claude Code \u00b7 Codex \u00b7 OpenCode \u00b7 Amp \u00b7 Grok \u00b7 Pi";

          var activeCount = data.rankings.filter(function(r) {
            return isRecentlyActive(r, now);
          }).length;
          var activeEl = document.getElementById("active-count");
          activeEl.innerHTML = activeCount > 0
            ? '<span>' + activeCount + ' active</span>' + activeSplitHTML(data.rankings, now)
            : "";

          document.getElementById("week-winners").innerHTML = weekWinnersHTML(data.weekWinners);

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
          var hasAgents = data.rankings.some(function(r) {
            return r.agents && r.agents.length > 0 && !(r.agents.length === 1 && r.agents[0] === "claude");
          });
          var PLAN_PRICES = { pro: 20, max100: 100, max200: 200, api: 0 };
          var h = '<div class="table-shell"><table><thead><tr><th>#</th><th>Member</th><th>Cost</th><th>Tokens</th><th>Turns</th><th title="Cost and tokens per turn">Avg Turn</th>';
          if (hasPlan) h += '<th>ROI</th>';
          h += '</tr></thead><tbody>';

          data.rankings.forEach(function(r) {
            var pct = maxCost > 0 ? (r.costUSD / maxCost * 100) : 0;
            var rowClass = r.rank === 1 ? "top-one" : r.rank === 2 ? "top-two" : r.rank === 3 ? "top-three" : "";
            var rankClass = r.rank === 1 ? "rank gold" : r.rank === 2 ? "rank silver" : r.rank === 3 ? "rank bronze" : "rank";
            var isActive = isRecentlyActive(r, now);
            var agentLine = "";
            if (hasAgents && r.agents && r.agents.length > 0) {
              agentLine = agentMixHTML(r);
            }
            var displayedTokens = showCache ? r.totalTokens : nonCacheTokensForRow(r);
            h += '<tr class="' + rowClass + '">' +
              '<td class="' + rankClass + '">' + r.rank + '</td>' +
              '<td><div class="name-cell">' + avatarHTML(r.userId, r.displayName, r.avatar, isActive) +
                '<div><div class="name-text">' + '<a href="/u/' + encodeURIComponent(r.slug || r.userId) + '" class="name-link">' + esc(r.displayName) + '</a>' + activeBadgeHTML(r, isActive) + '</div>' +
                agentLine + projectsHTML(r) + '<div class="bar" style="width:' + pct + '%"></div></div></div></td>' +
              '<td class="cost">$' + r.costUSD.toFixed(2) + '</td>' +
              '<td class="tokens">' + formatTokens(displayedTokens) + '</td>';
            var chats = r.chatCount || 0;
            var perChat = chats > 0 ? '$' + (r.costUSD / chats).toFixed(2) : '\u2014';
            var tokensPerChat = chats > 0 ? formatTokens(Math.round(displayedTokens / chats)) + ' tok' : '';
            h += '<td class="calls">' + chats + '</td>' +
              '<td class="avg-turn"><div class="avg-turn-main">' + perChat + '</div>' +
              (tokensPerChat ? '<div class="avg-turn-sub">' + tokensPerChat + '</div>' : '') + '</td>';
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
            h += '</tr>';
          });
          h += '</tbody></table></div>';
          // Solo group: a leaderboard of one has no reason to stick around —
          // put the invite front and center instead of buried in the footer.
          if (!IS_GLOBAL && data.group.memberCount === 1) {
            h = '<div class="solo-cta">' +
              '<div class="solo-cta-title">It\\'s just you here</div>' +
              '<div class="solo-cta-sub">A leaderboard needs rivals — invite a friend and see who burns more.</div>' +
              '<div class="solo-cta-row"><code>ccclub.dev/invite/' + CODE + '</code>' +
              '<button class="copy-btn" id="solo-copy-btn">Copy link</button></div>' +
              '</div>' + h;
          }
          document.getElementById("content").innerHTML = h;
          var soloCopy = document.getElementById("solo-copy-btn");
          if (soloCopy) {
            soloCopy.addEventListener("click", function() {
              navigator.clipboard.writeText("https://ccclub.dev/invite/" + CODE);
              this.textContent = "Copied!";
              var btn = this;
              setTimeout(function() { btn.textContent = "Copy link"; }, 2000);
            });
          }
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
    var CHART_COLORS = ["#d4935e","#63b486","#7ab7c6","#d6b56d","#aeb7bf","#c58a61","#8aaa5a","#c46a7a"];
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
          document.getElementById("chart").innerHTML = '<div style="color:var(--faint);text-align:center;padding:24px;font-size:13px">Couldn\\'t load activity chart</div>';
        });
    }

    function renderChart(data) {
      var el = document.getElementById("chart");
      var startMs = new Date(data.start).getTime();
      var endMs = new Date(data.end).getTime();
      var durationMs = endMs - startMs;
      var range = data.range;

      if (!data.series || data.series.length === 0) {
        el.innerHTML = '<div style="color:var(--faint);text-align:center;padding:24px;font-size:13px">No activity in this period</div>';
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
        return { name: user.displayName, handle: user.slug || user.userId || "", total: total, points: points };
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
        labels += '<line x1="' + lx.toFixed(1) + '" y1="' + PAD_T + '" x2="' + lx.toFixed(1) + '" y2="' + (PAD_T + plotH) + '" stroke="#332f2b" stroke-width="1" opacity="0.72"/>';
      }

      // Cost axis label (peak per bucket)
      var costLabel = globalMax >= 1 ? "$" + globalMax.toFixed(0) : "$" + globalMax.toFixed(2);
      labels += '<text x="' + (W - 2) + '" y="' + (PAD_T + 10) + '" fill="#8a8480" font-size="10" text-anchor="end">' + costLabel + '</text>';

      // Crosshair line + dot markers (hidden by default) + hover overlay
      var overlay = '<line id="chart-crosshair" x1="0" y1="' + PAD_T + '" x2="0" y2="' + (PAD_T + plotH) + '" stroke="#7ab7c6" stroke-width="1" stroke-dasharray="3,3" opacity="0"/>';
      userSeries.forEach(function(us, idx) {
        var color = CHART_COLORS[idx % CHART_COLORS.length];
        overlay += '<circle id="chart-dot-' + idx + '" cx="0" cy="0" r="3.5" fill="' + color + '" stroke="#13110f" stroke-width="1.5" opacity="0"/>';
      });
      overlay += '<rect x="' + PAD_L + '" y="' + PAD_T + '" width="' + plotW + '" height="' + plotH + '" fill="transparent" id="chart-overlay" style="cursor:crosshair"/>';

      var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">' +
        labels + paths + overlay + '</svg>';

      // Legend
      var legend = '<div class="chart-legend">';
      userSeries.forEach(function(us, idx) {
        var color = CHART_COLORS[idx % CHART_COLORS.length];
        var legendName = us.handle ? '<a href="/u/' + encodeURIComponent(us.handle) + '" class="name-link">' + esc(us.name) + '</a>' : esc(us.name);
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
        var tipLines = '<div style="color:#8a8480;margin-bottom:2px">' + timeLabel + '</div>';
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
