import { writeFile, rename, rm } from "node:fs/promises";

/**
 * Rename-swap write for files other processes read while we write —
 * ~/.claude/settings.json above all: Claude Code reads it, and a plain write
 * truncates first, so a concurrent reader can see half a file. That misread
 * isn't hypothetical: an installer reading a torn settings.json classifies
 * the statusline as foreign and silently skips setup.
 *
 * Rethrows on failure (after cleaning up the temp file) so callers keep
 * their own error contracts.
 */
export async function atomicWriteFile(path: string, data: string): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, path);
  } catch (err) {
    try { await rm(tmp, { force: true }); } catch { /* nothing to clean up */ }
    throw err;
  }
}
