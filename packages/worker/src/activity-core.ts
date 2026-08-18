// Pure pieces of the personal activity feature: day aggregation and the OG
// SVG builder. Kept free of route/wasm imports so tests can load them.
import { isRankedSource, computeActivityStats, activityLevelFor } from "@ccclub/shared";
import type { UsageBlock, DayTotal } from "@ccclub/shared";
import { svgEsc, truncate } from "./og-text.js";

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


export function fmtTokensShort(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}


const OG_CELL_COLORS = [
  "#26221d",
  "#164430", "#1a6b3e", "#2aa155", "#46d371",
  "#4d3d12", "#8a6a16", "#c79b1d", "#f7c72e",
  "#372560", "#57389c", "#7e57d9", "#a97fff",
];

export function activityOgSvg(opts: {
  name: string;
  plan?: string;
  avatarDataUri: string | null;
  avatarColor: string;
  stats: ReturnType<typeof computeActivityStats>;
  tokensByDay: Map<string, number>;
  todayKey: string;
}): string {
  const { name, plan, avatarDataUri, avatarColor, stats, tokensByDay, todayKey } = opts;
  const W = 1200;
  const H = 630;

  const initial = svgEsc((name[0] || "?").toUpperCase());
  const avatar = avatarDataUri
    ? `<clipPath id="av"><circle cx="134" cy="140" r="54"/></clipPath>
       <image href="${avatarDataUri}" x="80" y="86" width="108" height="108" clip-path="url(#av)" preserveAspectRatio="xMidYMid slice"/>
       <circle cx="134" cy="140" r="54" fill="none" stroke="#332f2b" stroke-width="3"/>`
    : `<circle cx="134" cy="140" r="54" fill="${avatarColor}"/>
       <text x="134" y="160" font-size="52" font-weight="700" fill="#ffffff" text-anchor="middle">${initial}</text>`;

  const planBadge = plan
    ? `<text x="212" y="176" font-size="22" fill="#d4935e">${svgEsc(plan === "max100" ? "Max $100" : plan === "max200" ? "Max $200" : plan === "api" ? "API" : "Pro")}</text>`
    : "";

  const statDefs = [
    [fmtTokensShort(stats.totalTokens), "Total tokens"],
    [fmtTokensShort(stats.peakDayTokens), "Best day"],
    [String(stats.activeDays), "Active days"],
    [`${stats.currentStreak}d`, "Streak"],
  ];
  const statsSvg = statDefs.map(([v, k], i) => {
    const x = 700 + (i % 2) * 240;
    const y = i < 2 ? 120 : 200;
    return `<text x="${x}" y="${y}" font-size="34" font-weight="700" fill="#f1ede7">${svgEsc(v)}</text>
            <text x="${x}" y="${y + 28}" font-size="19" fill="#8a8480">${svgEsc(k)}</text>`;
  }).join("\n");

  // 53×7 grid of the last year, same absolute levels as the page.
  const DAY = 86_400_000;
  const todayMs = Date.parse(`${todayKey}T00:00:00Z`);
  const firstWeek = todayMs - new Date(todayMs).getUTCDay() * DAY - 52 * 7 * DAY;
  const CELL = 16;
  const GAP = 4;
  const gx = (W - (53 * (CELL + GAP) - GAP)) / 2;
  const gy = 330;
  const cells: string[] = [];
  for (let w = 0; w < 53; w++) {
    for (let dow = 0; dow < 7; dow++) {
      const ms = firstWeek + (w * 7 + dow) * DAY;
      if (ms > todayMs) continue;
      const key = new Date(ms).toISOString().slice(0, 10);
      const level = activityLevelFor(tokensByDay.get(key) ?? 0);
      cells.push(`<rect x="${gx + w * (CELL + GAP)}" y="${gy + dow * (CELL + GAP)}" width="${CELL}" height="${CELL}" rx="3.5" fill="${OG_CELL_COLORS[level]}"/>`);
    }
  }

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="#1a1816"/>
  ${avatar}
  <text x="212" y="132" font-size="46" font-weight="700" fill="#f1ede7">${svgEsc(truncate(name, 24))}</text>
  ${planBadge}
  ${statsSvg}
  <text x="80" y="290" font-size="22" fill="#8a8480">Token activity — last 12 months</text>
  ${cells.join("\n")}
  <text x="${W - 80}" y="${H - 46}" font-size="22" fill="#5a5550" text-anchor="end">ccclub.dev</text>
</svg>`;
}

