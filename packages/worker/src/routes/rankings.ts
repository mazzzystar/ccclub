import { Hono } from "hono";
import type { Env } from "../types.js";
import type {
  GroupRecord,
  UsageData,
  RankingEntry,
  RankingPeriod,
  RankResponse,
} from "@ccclub/shared";

const app = new Hono<{ Bindings: Env }>();

const VALID_PERIODS: RankingPeriod[] = ["daily", "weekly", "monthly", "all-time"];

function parsePeriod(raw: string | undefined): RankingPeriod {
  if (raw && VALID_PERIODS.includes(raw as RankingPeriod)) return raw as RankingPeriod;
  return "daily";
}

function getDateRange(period: RankingPeriod, date?: string): { start: Date; end: Date } {
  const now = date ? new Date(date) : new Date();
  switch (period) {
    case "daily": {
      const s = new Date(now);
      s.setUTCHours(0, 0, 0, 0);
      const e = new Date(s);
      e.setUTCDate(e.getUTCDate() + 1);
      return { start: s, end: e };
    }
    case "weekly": {
      const s = new Date(now);
      s.setUTCDate(s.getUTCDate() - s.getUTCDay());
      s.setUTCHours(0, 0, 0, 0);
      const e = new Date(s);
      e.setUTCDate(e.getUTCDate() + 7);
      return { start: s, end: e };
    }
    case "monthly": {
      const s = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const e = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      return { start: s, end: e };
    }
    case "all-time":
      return { start: new Date("2020-01-01"), end: new Date("2099-12-31") };
  }
}

// GET /api/rank/global - Global public ranking (must be before :code route)
app.get("/rank/global", async (c) => {
  const period = parsePeriod(c.req.query("period"));
  const publicUsers = (await c.env.KV.get<string[]>("public_users", "json")) || [];

  if (publicUsers.length === 0) {
    return c.json<RankResponse>({
      group: { name: "Global Rankings", code: "global", memberCount: 0 },
      period,
      start: new Date().toISOString(),
      end: new Date().toISOString(),
      rankings: [],
    });
  }

  const { start, end } = getDateRange(period);
  const startMs = start.getTime();
  const endMs = end.getTime();

  const entries: RankingEntry[] = [];

  for (const userId of publicUsers) {
    const usage = await c.env.KV.get<UsageData>(`usage:${userId}`, "json");

    // Get user's display name and avatar from their first group
    let displayName = userId.slice(0, 8);
    let avatar = "";
    const userGroups = await c.env.KV.get<string[]>(`user_groups:${userId}`, "json");
    if (userGroups && userGroups.length > 0) {
      const group = await c.env.KV.get<GroupRecord>(`group:${userGroups[0]}`, "json");
      const member = group?.members.find((m) => m.userId === userId);
      if (member) {
        displayName = member.displayName;
        avatar = member.avatar || "";
      }
    }

    if (!usage) continue;

    let totalTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let costUSD = 0;
    let entryCount = 0;
    const models = new Set<string>();

    for (const block of usage.blocks) {
      const blockTime = new Date(block.blockStart).getTime();
      if (blockTime >= startMs && blockTime < endMs) {
        totalTokens += block.totalTokens;
        inputTokens += block.inputTokens;
        outputTokens += block.outputTokens;
        costUSD += block.costUSD;
        entryCount += block.entryCount;
        for (const m of block.models) models.add(m);
      }
    }

    if (totalTokens > 0 || entryCount > 0) {
      entries.push({
        rank: 0,
        userId,
        displayName,
        avatar,
        totalTokens,
        inputTokens,
        outputTokens,
        costUSD: Math.round(costUSD * 10000) / 10000,
        models: Array.from(models),
        entryCount,
      });
    }
  }

  entries.sort((a, b) => b.costUSD - a.costUSD);
  entries.forEach((e, i) => (e.rank = i + 1));

  return c.json<RankResponse>({
    group: { name: "Global Rankings", code: "global", memberCount: publicUsers.length },
    period,
    start: start.toISOString(),
    end: end.toISOString(),
    rankings: entries,
  });
});

// GET /api/rank/:code
app.get("/rank/:code", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const period = parsePeriod(c.req.query("period"));

  const group = await c.env.KV.get<GroupRecord>(`group:${code}`, { type: "json", cacheTtl: 60 });
  if (!group) {
    return c.json({ error: "group not found" }, 404);
  }

  const { start, end } = getDateRange(period);
  const startMs = start.getTime();
  const endMs = end.getTime();

  // Fetch usage for each member
  const entries: RankingEntry[] = [];

  for (const member of group.members) {
    const usage = await c.env.KV.get<UsageData>(`usage:${member.userId}`, "json");
    if (!usage) continue;

    let totalTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let costUSD = 0;
    let entryCount = 0;
    const models = new Set<string>();

    for (const block of usage.blocks) {
      const blockTime = new Date(block.blockStart).getTime();
      if (blockTime >= startMs && blockTime < endMs) {
        totalTokens += block.totalTokens;
        inputTokens += block.inputTokens;
        outputTokens += block.outputTokens;
        costUSD += block.costUSD;
        entryCount += block.entryCount;
        for (const m of block.models) models.add(m);
      }
    }

    if (totalTokens > 0 || entryCount > 0) {
      entries.push({
        rank: 0,
        userId: member.userId,
        displayName: member.displayName,
        avatar: member.avatar || "",
        totalTokens,
        inputTokens,
        outputTokens,
        costUSD: Math.round(costUSD * 10000) / 10000,
        models: Array.from(models),
        entryCount,
      });
    }
  }

  entries.sort((a, b) => b.costUSD - a.costUSD);
  entries.forEach((e, i) => (e.rank = i + 1));

  return c.json<RankResponse>({
    group: { name: group.name, code: group.code, memberCount: group.members.length },
    period,
    start: start.toISOString(),
    end: end.toISOString(),
    rankings: entries,
  });
});

export { app as rankRoutes };
