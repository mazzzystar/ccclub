import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { CCCLUB_CONFIG_DIR } from "@ccclub/shared";

const DEFAULT_STALE_MS = 10 * 60 * 1000;

export interface SyncLock {
  release(): Promise<void>;
}

export function getSyncLockPath(): string {
  return join(homedir(), CCCLUB_CONFIG_DIR, "sync.lock");
}

function isAlreadyExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "EEXIST";
}

async function removeIfStale(path: string, staleMs: number): Promise<boolean> {
  try {
    const info = await stat(path);
    if (Date.now() - info.mtimeMs <= staleMs) return false;
    await rm(path, { force: true });
    return true;
  } catch {
    return true;
  }
}

/**
 * Acquire the cross-process sync lock with an atomic O_EXCL create. A stale
 * lock left by a killed process is recovered after ten minutes.
 */
export async function acquireSyncLock(
  path = getSyncLockPath(),
  staleMs = DEFAULT_STALE_MS,
): Promise<SyncLock | null> {
  await mkdir(dirname(path), { recursive: true });
  const owner = `${process.pid}:${randomUUID()}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    let created = false;
    try {
      handle = await open(path, "wx", 0o600);
      created = true;
      await handle.writeFile(owner, "utf8");
      await handle.close();
      handle = null;

      let released = false;
      return {
        async release() {
          if (released) return;
          released = true;
          try {
            if ((await readFile(path, "utf8")) === owner) {
              await rm(path, { force: true });
            }
          } catch {
            // The cache lock is best-effort cleanup; a missing file is fine.
          }
        },
      };
    } catch (error) {
      await handle?.close().catch(() => {});
      if (created) await rm(path, { force: true }).catch(() => {});
      if (!isAlreadyExists(error)) throw error;
      if (attempt === 0 && await removeIfStale(path, staleMs)) continue;
      return null;
    }
  }

  return null;
}
