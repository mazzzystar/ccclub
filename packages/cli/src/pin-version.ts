/**
 * Heartbeat plists and Claude hooks pin `ccclub@<version>`. An older CLI that
 * ran `sync` used to treat any other pin as stale and rewrite it, so a leftover
 * 0.8.0 entrypoint could keep winning over 0.9.x every five minutes.
 *
 * Mirrored in scripts/postinstall.cjs (CJS, cannot import this ESM module).
 * pin-version.test.ts asserts the two comparators stay in lockstep.
 */

const PINNED_PACKAGE = /ccclub@([0-9A-Za-z][0-9A-Za-z.+-]*)/;
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function extractPinnedVersion(text: string): string | null {
  return text.match(PINNED_PACKAGE)?.[1] ?? null;
}

type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
  pre: string[] | null;
};

function parseNpmVersion(version: string): ParsedVersion | null {
  const match = VERSION.exec(version);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split(".") : null,
  };
}

function comparePreRelease(a: string[], b: string[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const left = a[i];
    const right = b[i];
    if (left == null) return -1;
    if (right == null) return 1;
    const leftNum = /^\d+$/u.test(left) ? Number(left) : null;
    const rightNum = /^\d+$/u.test(right) ? Number(right) : null;
    if (leftNum != null && rightNum != null) {
      if (leftNum !== rightNum) return leftNum - rightNum;
      continue;
    }
    if (leftNum != null) return -1;
    if (rightNum != null) return 1;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

/** Negative if a < b, 0 if equal, positive if a > b, null if either is unparseable. */
export function compareNpmVersions(a: string, b: string): number | null {
  const left = parseNpmVersion(a);
  const right = parseNpmVersion(b);
  if (!left || !right) return null;
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  if (left.pre == null && right.pre == null) return 0;
  if (left.pre == null) return 1;
  if (right.pre == null) return -1;
  return comparePreRelease(left.pre, right.pre);
}

export interface PinOptions {
  /**
   * Re-pin the background entrypoints to the running version even when the
   * on-disk pin is newer. Only explicit, user-initiated paths set it
   * (`ccclub init`, `ccclub hook`): it is the escape hatch for a newer pin
   * whose template is broken — a deleted nvm bin dir, a yanked release, a
   * version that crashes on start. Automatic paths (sync, rank) never do.
   * It bypasses the newer-pin guard only; an identical template stays a
   * no-op, so forcing never churns launchctl or settings.json for nothing.
   */
  force?: boolean;
}

export function isNewerPin(installed: string | null, current: string): boolean {
  if (installed == null) return false;
  const cmp = compareNpmVersions(installed, current);
  return cmp != null && cmp > 0;
}

/**
 * The one dim line to print when the on-disk pin is ahead of this CLI —
 * otherwise the guard is silent and a user on an older binary has no way to
 * tell why their background sync keeps running someone else's version.
 *
 * Pure on purpose: the keep/rewrite predicates never write to stdout, so the
 * message decision is testable without a temp HOME. `forced` is for the
 * explicit paths, which say what they moved instead of what they kept.
 */
export function pinNotice(pinned: string | null, running: string, forced = false): string | null {
  if (pinned == null) return null;
  return forced
    ? `Background sync re-pinned from ccclub@${pinned} to this ${running}.`
    : `Background sync stays on ccclub@${pinned} (newer than this ${running}). Run "ccclub hook" to pin this version instead.`;
}
