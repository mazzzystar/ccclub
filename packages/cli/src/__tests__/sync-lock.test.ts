import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { acquireSyncLock } from "../sync-lock.js";

const tempDirs: string[] = [];

async function lockPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ccclub-lock-"));
  tempDirs.push(dir);
  return join(dir, "sync.lock");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("sync lock", () => {
  it("allows only one process owner at a time", async () => {
    const path = await lockPath();
    const first = await acquireSyncLock(path);
    expect(first).not.toBeNull();
    expect(await acquireSyncLock(path)).toBeNull();

    await first?.release();
    const next = await acquireSyncLock(path);
    expect(next).not.toBeNull();
    await next?.release();
  });

  it("recovers a stale lock", async () => {
    const path = await lockPath();
    await writeFile(path, "dead-owner");
    const old = new Date(Date.now() - 60_000);
    await utimes(path, old, old);

    const lock = await acquireSyncLock(path, 1_000);
    expect(lock).not.toBeNull();
    await lock?.release();
  });

  it("does not let a stale former owner release the successor's lock", async () => {
    const path = await lockPath();
    const former = await acquireSyncLock(path);
    expect(former).not.toBeNull();

    const old = new Date(Date.now() - 60_000);
    await utimes(path, old, old);
    const successor = await acquireSyncLock(path, 1_000);
    expect(successor).not.toBeNull();

    await former?.release();
    expect(await acquireSyncLock(path)).toBeNull();
    await successor?.release();
  });
});
