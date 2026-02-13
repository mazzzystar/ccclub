import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { glob } from "glob";
import { CLAUDE_PROJECTS_DIR } from "@ccclub/shared";
import type { RawJSONLEntry, UsageEntry } from "@ccclub/shared";

export interface CollectionResult {
  entries: UsageEntry[];
  humanTurns: string[];  // timestamps of user messages
}

export async function collectUsageEntries(): Promise<CollectionResult> {
  const projectsDir = join(homedir(), CLAUDE_PROJECTS_DIR);
  const files = await glob("**/*.jsonl", { cwd: projectsDir, absolute: true });

  if (files.length === 0) {
    return { entries: [], humanTurns: [] };
  }

  const entries: UsageEntry[] = [];
  const humanTurns: string[] = [];
  const seen = new Set<string>();
  const seenHuman = new Set<string>();

  for (const file of files) {
    const content = await readFile(file, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());

    for (const line of lines) {
      let parsed: RawJSONLEntry;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      // Count real human messages (skip automated tool_result turns)
      if (parsed.type === "user" && parsed.timestamp) {
        const content = parsed.message?.content;
        const isToolResult = Array.isArray(content) &&
          content.length > 0 &&
          content.every((c: { type?: string }) => c.type === "tool_result");
        if (!isToolResult) {
          const humanKey = `${parsed.sessionId || ""}:${parsed.timestamp}`;
          if (!seenHuman.has(humanKey)) {
            seenHuman.add(humanKey);
            humanTurns.push(parsed.timestamp);
          }
        }
        continue;
      }

      // Only process assistant messages with usage data
      if (parsed.type !== "assistant" || !parsed.message?.usage) {
        continue;
      }

      const usage = parsed.message.usage;
      const requestId = parsed.requestId || "";
      const sessionId = parsed.sessionId || "";

      // Deduplicate by sessionId:requestId
      const dedupeKey = `${sessionId}:${requestId}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const inputTokens = usage.input_tokens || 0;
      const outputTokens = usage.output_tokens || 0;
      const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
      const cacheReadTokens = usage.cache_read_input_tokens || 0;

      entries.push({
        timestamp: parsed.timestamp,
        sessionId,
        requestId,
        model: parsed.message.model || "unknown",
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens,
        totalTokens: inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens,
        costUSD: parsed.costUSD || 0,
      });
    }
  }

  // Sort by timestamp
  entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  humanTurns.sort();
  return { entries, humanTurns };
}
