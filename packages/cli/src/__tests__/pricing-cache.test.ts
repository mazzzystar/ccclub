import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, afterEach, vi } from "vitest";
import { loadPricingTable, refreshPricingCache } from "../pricing.js";
import { PRICING_SNAPSHOT } from "@ccclub/shared";
import type { PricingTable } from "@ccclub/shared";

const API_URL = "https://ccclub.test";

const REMOTE_TABLE: PricingTable = {
  version: "1-deadbeef",
  updatedAt: "2026-06-01T00:00:00.000Z",
  source: "litellm",
  models: { "gpt-5": { input: 9, output: 90, cacheCreation: 0, cacheRead: 0.9 } },
};

const tempDirs: string[] = [];

async function makeCachePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ccclub-pricing-"));
  tempDirs.push(dir);
  return join(dir, "pricing.json");
}

function writeCacheFile(path: string, fetchedAt: string, table: PricingTable = REMOTE_TABLE): Promise<void> {
  return writeFile(path, JSON.stringify({ fetchedAt, table }));
}

function stubFetch(response: () => Response): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async () => response());
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("loadPricingTable", () => {
  it("returns the bundled snapshot when no cache file exists", async () => {
    const table = await loadPricingTable(await makeCachePath());
    expect(table).toEqual(PRICING_SNAPSHOT);
  });

  it("returns the bundled snapshot when the cache file is corrupt", async () => {
    const path = await makeCachePath();
    await writeFile(path, "{not json");
    expect(await loadPricingTable(path)).toEqual(PRICING_SNAPSHOT);
  });

  it("overlays cached prices on the snapshot without losing snapshot-only models", async () => {
    const path = await makeCachePath();
    await writeCacheFile(path, new Date().toISOString());

    const table = await loadPricingTable(path);
    expect(table.models["gpt-5"].input).toBe(9);
    expect(table.models["claude-opus-4-7"]).toEqual(PRICING_SNAPSHOT.models["claude-opus-4-7"]);
  });
});

describe("refreshPricingCache", () => {
  it("does not touch the network while the cache is fresh", async () => {
    const path = await makeCachePath();
    await writeCacheFile(path, new Date().toISOString());
    const fetchMock = stubFetch(() => Response.json(REMOTE_TABLE));

    await refreshPricingCache(API_URL, path);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches and stores a new table when the cache is stale", async () => {
    const path = await makeCachePath();
    const staleTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await writeCacheFile(path, staleTime, { ...REMOTE_TABLE, version: "0-old" });
    const fetchMock = stubFetch(() => Response.json(REMOTE_TABLE));

    await refreshPricingCache(API_URL, path);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_URL}/api/pricing`);
    expect((init.headers as Record<string, string>)["If-None-Match"]).toBe('"0-old"');
    const stored = JSON.parse(await readFile(path, "utf-8"));
    expect(stored.table.version).toBe("1-deadbeef");
  });

  it("fetches without a cache file and creates one", async () => {
    const path = await makeCachePath();
    stubFetch(() => Response.json(REMOTE_TABLE));

    await refreshPricingCache(API_URL, path);

    const table = await loadPricingTable(path);
    expect(table.models["gpt-5"].input).toBe(9);
  });

  it("only bumps fetchedAt on 304 Not Modified", async () => {
    const path = await makeCachePath();
    const staleTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await writeCacheFile(path, staleTime);
    stubFetch(() => new Response(null, { status: 304 }));

    await refreshPricingCache(API_URL, path);

    const stored = JSON.parse(await readFile(path, "utf-8"));
    expect(stored.table).toEqual(REMOTE_TABLE);
    expect(new Date(stored.fetchedAt).getTime()).toBeGreaterThan(new Date(staleTime).getTime());
  });

  it("keeps the existing cache on server errors and invalid bodies", async () => {
    const path = await makeCachePath();
    const staleTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await writeCacheFile(path, staleTime);

    stubFetch(() => new Response("oops", { status: 500 }));
    await refreshPricingCache(API_URL, path);

    stubFetch(() => Response.json({ nonsense: true }));
    await refreshPricingCache(API_URL, path);

    const stored = JSON.parse(await readFile(path, "utf-8"));
    expect(stored).toEqual({ fetchedAt: staleTime, table: REMOTE_TABLE });
  });

  it("never throws when the network is unreachable", async () => {
    const path = await makeCachePath();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));

    await expect(refreshPricingCache(API_URL, path)).resolves.toBeUndefined();
  });
});
