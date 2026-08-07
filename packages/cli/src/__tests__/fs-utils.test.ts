import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, afterEach } from "vitest";
import { atomicWriteFile } from "../fs-utils.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ccclub-fsu-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("atomicWriteFile", () => {
  it("writes the content and leaves no temp file", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "settings.json");
    await writeFile(path, "old");

    await atomicWriteFile(path, '{"a":1}\n');

    expect(await readFile(path, "utf-8")).toBe('{"a":1}\n');
    expect(readdirSync(dir)).toEqual(["settings.json"]);
  });

  it("rethrows on failure so callers keep their error contracts, without litter", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "no-such-dir", "settings.json");

    await expect(atomicWriteFile(path, "x")).rejects.toThrow();
    expect(existsSync(join(dir, "no-such-dir"))).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("a reader never observes a truncated file across repeated writes", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "settings.json");
    await atomicWriteFile(path, JSON.stringify({ i: -1 }));

    for (let i = 0; i < 25; i++) {
      await atomicWriteFile(path, JSON.stringify({ i, pad: "x".repeat(500) }));
      expect(() => JSON.parse(readFileSync(path, "utf-8"))).not.toThrow();
    }
  });
});
