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

export function isNewerPin(installed: string | null, current: string): boolean {
  if (installed == null) return false;
  const cmp = compareNpmVersions(installed, current);
  return cmp != null && cmp > 0;
}
