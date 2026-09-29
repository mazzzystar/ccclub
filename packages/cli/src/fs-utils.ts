import { appendFile, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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

/** Per-generation cap for a rolling diagnostic log. */
const LOG_MAX_BYTES = 256 * 1024;

/**
 * Append to a small diagnostic log, rotating so it can never grow without
 * bound: at the cap the current file becomes `<path>.1` (replacing the
 * previous generation) and a fresh one starts, which holds the pair to two
 * caps for good. Writing it must never be able to break the run that produced
 * the lines, so every failure here is swallowed — a diagnostic that can fail a
 * sync is worse than no diagnostic.
 */
export async function appendCappedLog(
  path: string,
  text: string,
  maxBytes = LOG_MAX_BYTES,
): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    const info = await stat(path).catch(() => null);
    if (info != null && info.size + Buffer.byteLength(text) > maxBytes) {
      await rename(path, `${path}.1`);
    }
    await appendFile(path, text);
  } catch {
    // Nothing to do and nowhere to say it: this IS the place complaints go.
  }
}
