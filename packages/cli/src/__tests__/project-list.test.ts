import { afterEach, describe, it, expect, vi } from "vitest";
import { projectListsMatch, saveProjects, withProjectAdded, withProjectRemoved } from "../commands/project.js";

const ccclub = { name: "ccclub", url: "https://github.com/mazzzystar/ccclub" };

afterEach(() => vi.unstubAllGlobals());

describe("withProjectAdded", () => {
  it("appends a project with an optional URL", () => {
    expect(withProjectAdded([], "  ccclub  ", "https://ccclub.dev")).toEqual({
      ok: true,
      projects: [{ name: "ccclub", url: "https://ccclub.dev" }],
    });
    expect(withProjectAdded([], "notes")).toEqual({
      ok: true,
      projects: [{ name: "notes" }],
    });
  });

  it("replaces the URL of a name that is already listed, in place", () => {
    const result = withProjectAdded([{ name: "notes" }, ccclub], "CCCLUB", "https://ccclub.dev");
    expect(result).toEqual({
      ok: true,
      projects: [{ name: "notes" }, { name: "CCCLUB", url: "https://ccclub.dev" }],
    });
  });

  it("keeps the existing URL when re-adding without one", () => {
    expect(withProjectAdded([ccclub], "ccclub")).toEqual({ ok: true, projects: [ccclub] });
  });

  it("rejects a sixth project", () => {
    const five = ["a", "b", "c", "d", "e"].map((name) => ({ name }));
    const result = withProjectAdded(five, "f");
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ error: expect.stringContaining("at most 5 projects") });
    // Replacing one of the five still works at the limit.
    expect(withProjectAdded(five, "A", "https://a.dev")).toMatchObject({ ok: true });
  });

  it("rejects empty, overlong, and non-https input", () => {
    expect(withProjectAdded([], "   ")).toMatchObject({ ok: false });
    expect(withProjectAdded([], "x".repeat(31))).toMatchObject({ ok: false });
    expect(withProjectAdded([], "x".repeat(30))).toMatchObject({ ok: true });
    expect(withProjectAdded([], "x", "http://insecure.dev")).toMatchObject({ ok: false });
    expect(withProjectAdded([], "x", "ccclub.dev")).toMatchObject({ ok: false });
    expect(withProjectAdded([], "x", "https://")).toMatchObject({ ok: false });
    expect(withProjectAdded([], "x", "https://" + "y".repeat(200))).toMatchObject({ ok: false });
  });

  it("leaves the caller's list untouched", () => {
    const original = [ccclub];
    withProjectAdded(original, "notes");
    expect(original).toEqual([ccclub]);
  });
});

describe("withProjectRemoved", () => {
  it("removes by case-insensitive name and reports the stored spelling", () => {
    expect(withProjectRemoved([{ name: "notes" }, ccclub], "CCClub")).toEqual({
      ok: true,
      projects: [{ name: "notes" }],
      removed: ccclub,
    });
  });

  it("reports a name that is not listed", () => {
    const result = withProjectRemoved([ccclub], "nope");
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('No project named "nope"') });
  });
});

describe("projectListsMatch", () => {
  it("requires the server to echo the requested replacement", () => {
    expect(projectListsMatch([ccclub], [ccclub])).toBe(true);
    expect(projectListsMatch([ccclub], undefined)).toBe(false);
    expect(projectListsMatch([ccclub], [])).toBe(false);
    expect(projectListsMatch([ccclub], { projects: [ccclub] })).toBe(false);
  });

  it("treats an omitted empty list as a successful clear", () => {
    expect(projectListsMatch([], undefined)).toBe(true);
    expect(projectListsMatch([], [])).toBe(true);
  });

  it("makes a successful HTTP response fail when the server ignored the write", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      displayName: "Test",
      avatar: "",
      visibility: "private",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    await expect(saveProjects(
      { apiUrl: "https://example.test", token: "test-token" },
      [ccclub],
    )).rejects.toThrow("server did not save projects");
  });
});
