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

function getDateRange(period: RankingPeriod, tzOffsetMin = 0): { start: Date; end: Date } {
  // Shift "now" into the user's local day by applying their tz offset
  const nowUtc = Date.now();
  const nowLocal = new Date(nowUtc + tzOffsetMin * 60_000);

  switch (period) {
    case "daily": {
      const s = new Date(nowLocal);
      s.setUTCHours(0, 0, 0, 0);
      // Shift back to real UTC
      return { start: new Date(s.getTime() - tzOffsetMin * 60_000), end: new Date(s.getTime() - tzOffsetMin * 60_000 + 86_400_000) };
    }
    case "weekly": {
      const s = new Date(nowLocal);
      s.setUTCDate(s.getUTCDate() - s.getUTCDay());
      s.setUTCHours(0, 0, 0, 0);
      const startUtc = s.getTime() - tzOffsetMin * 60_000;
      return { start: new Date(startUtc), end: new Date(startUtc + 7 * 86_400_000) };
    }
    case "monthly": {
      const s = new Date(Date.UTC(nowLocal.getUTCFullYear(), nowLocal.getUTCMonth(), 1));
      const e = new Date(Date.UTC(nowLocal.getUTCFullYear(), nowLocal.getUTCMonth() + 1, 1));
      return { start: new Date(s.getTime() - tzOffsetMin * 60_000), end: new Date(e.getTime() - tzOffsetMin * 60_000) };
    }
    case "all-time":
      return { start: new Date("2020-01-01"), end: new Date("2099-12-31") };
  }
}

// GET /api/rank/global - Global public ranking (must be before :code route)
app.get("/rank/global", async (c) => {
  const period = parsePeriod(c.req.query("period"));
  const tz = parseInt(c.req.query("tz") || "0", 10) || 0;
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

  const { start, end } = getDateRange(period, tz);
  const startMs = start.getTime();
  const endMs = end.getTime();

  // Fetch all usage data and user groups in parallel
  const [usageResults, groupsResults] = await Promise.all([
    Promise.all(publicUsers.map((id) => c.env.KV.get<UsageData>(`usage:${id}`, "json"))),
    Promise.all(publicUsers.map((id) => c.env.KV.get<string[]>(`user_groups:${id}`, "json"))),
  ]);

  // Fetch first group for each user (for display name) in parallel
  const firstGroupCodes = groupsResults.map((g) => g?.[0]);
  const uniqueCodes = [...new Set(firstGroupCodes.filter(Boolean))] as string[];
  const groupMap = new Map<string, GroupRecord>();
  await Promise.all(
    uniqueCodes.map(async (code) => {
      const g = await c.env.KV.get<GroupRecord>(`group:${code}`, "json");
      if (g) groupMap.set(code, g);
    }),
  );

  const entries: RankingEntry[] = [];

  for (let idx = 0; idx < publicUsers.length; idx++) {
    const userId = publicUsers[idx];
    const usage = usageResults[idx];

    let displayName = userId.slice(0, 8);
    let avatar = "";
    const firstCode = firstGroupCodes[idx];
    if (firstCode) {
      const group = groupMap.get(firstCode);
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
    let cacheCreationTokens = 0;
    let cacheReadTokens = 0;
    let costUSD = 0;
    let entryCount = 0;
    let chatCount = 0;
    const models = new Set<string>();

    for (const block of usage.blocks) {
      const blockTime = new Date(block.blockStart).getTime();
      if (blockTime >= startMs && blockTime < endMs) {
        totalTokens += block.totalTokens;
        inputTokens += block.inputTokens;
        outputTokens += block.outputTokens;
        cacheCreationTokens += block.cacheCreationTokens || 0;
        cacheReadTokens += block.cacheReadTokens || 0;
        costUSD += block.costUSD;
        entryCount += block.entryCount;
        chatCount += block.chatCount || 0;
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
        cacheCreationTokens,
        cacheReadTokens,
        costUSD: Math.round(costUSD * 10000) / 10000,
        models: Array.from(models),
        entryCount,
        chatCount,
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
  const tz = parseInt(c.req.query("tz") || "0", 10) || 0;

  const group = await c.env.KV.get<GroupRecord>(`group:${code}`, { type: "json", cacheTtl: 60 });
  if (!group) {
    return c.json({ error: "group not found" }, 404);
  }

  const { start, end } = getDateRange(period, tz);
  const startMs = start.getTime();
  const endMs = end.getTime();

  // Fetch usage for all members in parallel
  const usageResults = await Promise.all(
    group.members.map((m) => c.env.KV.get<UsageData>(`usage:${m.userId}`, "json")),
  );

  const entries: RankingEntry[] = [];

  for (let idx = 0; idx < group.members.length; idx++) {
    const member = group.members[idx];
    const usage = usageResults[idx];

    let totalTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheCreationTokens = 0;
    let cacheReadTokens = 0;
    let costUSD = 0;
    let entryCount = 0;
    let chatCount = 0;
    const models = new Set<string>();

    if (usage) {
      for (const block of usage.blocks) {
        const blockTime = new Date(block.blockStart).getTime();
        if (blockTime >= startMs && blockTime < endMs) {
          totalTokens += block.totalTokens;
          inputTokens += block.inputTokens;
          outputTokens += block.outputTokens;
          cacheCreationTokens += block.cacheCreationTokens || 0;
          cacheReadTokens += block.cacheReadTokens || 0;
          costUSD += block.costUSD;
          entryCount += block.entryCount;
          chatCount += block.chatCount || 0;
          for (const m of block.models) models.add(m);
        }
      }
    }

    entries.push({
      rank: 0,
      userId: member.userId,
      displayName: member.displayName,
      avatar: member.avatar || "",
      totalTokens,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      costUSD: Math.round(costUSD * 10000) / 10000,
      models: Array.from(models),
      entryCount,
      chatCount,
    });
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
