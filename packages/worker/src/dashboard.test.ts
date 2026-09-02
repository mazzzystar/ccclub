import { describe, expect, it } from "vitest";
import type { Env } from "./types.js";
import { dashboardRoute } from "./dashboard.js";

function testEnv(): Env {
  const KV = {
    async get() {
      return null;
    },
    async put() {},
  } as unknown as KVNamespace;
  return { KV };
}

async function dashboardPage(): Promise<string> {
  const response = await dashboardRoute.request("/g/ABCDEF", {}, testEnv());
  return await response.text();
}

function inlineScripts(page: string): string[] {
  return [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

/** The page's own esc(): a text node, so quotes survive unescaped. */
function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type ChipApi = {
  projectChipHTML: (project: unknown) => string;
  projectsHTML: (row: unknown) => string;
  projectIconSrc: (url: string) => string;
  safeProjectUrl: (url: unknown) => string;
};

/**
 * Lift the project helpers out of the inline script and run them here, so the
 * escaping rules are exercised rather than eyeballed.
 */
function loadChipHelpers(script: string): ChipApi {
  const start = script.indexOf("var MAX_PROJECTS");
  const end = script.indexOf("function activeBadgeHTML");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const source = script.slice(start, end);
  return new Function(
    "esc",
    source + "\nreturn { projectChipHTML: projectChipHTML, projectsHTML: projectsHTML, projectIconSrc: projectIconSrc, safeProjectUrl: safeProjectUrl };",
  )(esc) as ChipApi;
}

let cachedApi: ChipApi | null = null;
async function chipHelpers(): Promise<ChipApi> {
  if (!cachedApi) cachedApi = loadChipHelpers(inlineScripts(await dashboardPage()).join("\n"));
  return cachedApi;
}

type ScoreApi = {
  weekWinnersHTML: (days: unknown) => string;
  activeSplitHTML: (rows: unknown, now: number) => string;
};

/**
 * The same trick as the chip helpers, for the two lines above the table: run
 * the builders here so the scoreline is asserted rather than eyeballed.
 */
function loadScoreHelpers(script: string): ScoreApi {
  const start = script.indexOf("var AGENT_ORDER");
  const end = script.indexOf('document.querySelectorAll(".periods');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return new Function(
    "esc",
    "ACTIVE_THRESHOLD_MS",
    script.slice(start, end) +
      "\nreturn { weekWinnersHTML: weekWinnersHTML, activeSplitHTML: activeSplitHTML };",
  )(esc, 15 * 60 * 1000) as ScoreApi;
}

let cachedScoreApi: ScoreApi | null = null;
async function scoreHelpers(): Promise<ScoreApi> {
  if (!cachedScoreApi) cachedScoreApi = loadScoreHelpers(inlineScripts(await dashboardPage()).join("\n"));
  return cachedScoreApi;
}

/** What a reader actually sees on the line, markup stripped. */
function readable(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** One resolved day, winners derived the way the worker derives them. */
function dayOf(date: string, counts: Array<[string, number]>) {
  const top = Math.max(...counts.map(([, users]) => users));
  return {
    day: date,
    winners: counts.filter(([, users]) => users === top).map(([source]) => source),
    counts: counts.map(([source, users]) => ({ source, users })),
  };
}

/** A member last seen a minute ago, working in `source`. */
function activeRow(source: string, now: number, agoMs = 60_000) {
  return { lastActiveAt: new Date(now - agoMs).toISOString(), lastActiveSource: source, agents: [source] };
}

describe("dashboard inline script", () => {
  it("parses — a stray backslash in the template would corrupt it", async () => {
    for (const script of inlineScripts(await dashboardPage())) {
      expect(() => new Function(script)).not.toThrow();
    }
  });

  it("styles chips without reserving space for members who have none", async () => {
    const page = await dashboardPage();
    expect(page).toContain(".project-line {");
    expect(page).toContain(".project-icon.errored + .project-letter { display: inline-flex; }");
  });
});

describe("project chips", () => {
  it("derives the owner avatar for GitHub projects", async () => {
    const { projectChipHTML } = await chipHelpers();
    const chip = projectChipHTML({ name: "ccclub", url: "https://github.com/mazzzystar/ccclub" });
    expect(chip).toContain('src="https://github.com/mazzzystar.png?size=32"');
    expect(chip).toContain('href="https://github.com/mazzzystar/ccclub"');
    expect(chip).toContain('target="_blank" rel="noopener"');
    expect(chip).toContain('onerror="this.classList.add(&#39;errored&#39;)"');
    expect(chip).toContain('<span class="project-letter">C</span>');
  });

  it("falls back to the site favicon for other https URLs", async () => {
    const { projectChipHTML, projectIconSrc } = await chipHelpers();
    expect(projectIconSrc("https://whispernotes.app/pricing")).toBe(
      "https://icons.duckduckgo.com/ip3/whispernotes.app.ico",
    );
    // github.com without an owner segment has no avatar to borrow.
    expect(projectIconSrc("https://github.com/")).toBe("");
    expect(projectChipHTML({ name: "Whisper Notes", url: "https://whispernotes.app" })).toContain(
      'src="https://icons.duckduckgo.com/ip3/whispernotes.app.ico"',
    );
  });

  it("renders a letter badge and plain text when there is no URL", async () => {
    const { projectChipHTML } = await chipHelpers();
    const chip = projectChipHTML({ name: "notes" });
    expect(chip).toBe('<span class="project-chip"><span class="project-letter">N</span><span class="project-name">notes</span></span>');
    expect(chip).not.toContain("<img");
    expect(chip).not.toContain("href");
  });

  it("drops URLs that are not https", async () => {
    const { projectChipHTML, safeProjectUrl } = await chipHelpers();
    for (const url of ["http://x.dev", "javascript:alert(1)", "//evil.dev", "data:text/html,x", 42, null]) {
      expect(safeProjectUrl(url)).toBe("");
    }
    // The chip degrades to plain text rather than linking something unvetted.
    expect(projectChipHTML({ name: "x", url: "javascript:alert(1)" })).not.toContain("href");
  });

  it("never lets a name or URL escape its attribute", async () => {
    const { projectChipHTML } = await chipHelpers();
    const chip = projectChipHTML({
      name: '"><img src=x onerror=alert(1)>',
      url: 'https://evil.dev/" onmouseover="alert(1)',
    });
    // The name only ever lands in text nodes, so its quotes stay inert.
    expect(chip).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(chip).not.toContain("<img src=x");
    // new URL() percent-encodes the quote before it reaches href/src.
    expect(chip).toContain('href="https://evil.dev/%22%20onmouseover=%22alert(1)"');
    expect(chip).not.toContain('onmouseover="alert(1)"');
  });

  it("shows at most five chips and nothing at all for an empty list", async () => {
    const { projectsHTML } = await chipHelpers();
    const many = Array.from({ length: 8 }, (_, i) => ({ name: `p${i}` }));
    expect((projectsHTML({ projects: many }).match(/project-chip/g) || []).length).toBe(5);
    expect(projectsHTML({ projects: [] })).toBe("");
    expect(projectsHTML({})).toBe("");
  });
});

describe("week winner votes", () => {
  it("spells today's vote out instead of leaving it in a tooltip", async () => {
    const { weekWinnersHTML } = await scoreHelpers();
    const html = weekWinnersHTML([
      dayOf("2026-08-17", [["claude", 21], ["codex", 18]]),
      dayOf("2026-08-18", [["claude", 23], ["codex", 16]]),
    ]);
    expect(readable(html)).toContain("Claude Code 23 : 16 Codex");
    expect(readable(html)).toContain("by main agent today");
    // The tooltip that used to be the only place the counts lived stays put.
    expect(html).toContain('title="Tue Aug 18 \u00b7 Claude Code 23, Codex 16"');
  });

  it("lists every agent that got a vote once there are more than two", async () => {
    const { weekWinnersHTML } = await scoreHelpers();
    const html = weekWinnersHTML([
      dayOf("2026-08-17", [["claude", 23], ["codex", 16], ["pi", 1], ["grok", 1]]),
    ]);
    expect(readable(html)).toContain("Claude Code 23 \u00b7 Codex 16 \u00b7 Pi 1 \u00b7 Grok 1");
  });

  it("names the day when today has not been decided yet", async () => {
    const { weekWinnersHTML } = await scoreHelpers();
    const html = weekWinnersHTML([
      dayOf("2026-08-17", [["claude", 4], ["codex", 2]]),
      { day: "2026-08-18", winners: [], counts: [] },
    ]);
    expect(readable(html)).toContain("by main agent Mon");
  });

  it("shows a 20:20 day as a draw, both icons in the slot", async () => {
    const { weekWinnersHTML } = await scoreHelpers();
    const html = weekWinnersHTML([dayOf("2026-08-17", [["claude", 20], ["codex", 20]])]);
    const slot = /<span class="ww-slot today tie"[^>]*>([\s\S]*?)<\/span>/.exec(html);
    expect(slot).not.toBeNull();
    expect(slot![1]).toContain("claude.svg");
    expect(slot![1]).toContain("codex.svg");
    expect(readable(html)).toContain("Claude Code 20 : 20 Codex");
  });

  it("shrinks the icons rather than overflowing a three-way draw", async () => {
    const { weekWinnersHTML } = await scoreHelpers();
    const html = weekWinnersHTML([dayOf("2026-08-17", [["claude", 1], ["codex", 1], ["grok", 1]])]);
    const slot = /<span class="ww-slot today tie tie-many"[^>]*>([\s\S]*?)<\/span>/.exec(html);
    expect(slot).not.toBeNull();
    expect((slot![1].match(/<img/g) || []).length).toBe(3);
  });

  it("still says nothing about a week nobody coded", async () => {
    const { weekWinnersHTML } = await scoreHelpers();
    expect(weekWinnersHTML([{ day: "2026-08-17", winners: [], counts: [] }])).toBe("");
    expect(weekWinnersHTML([])).toBe("");
  });
});

describe("active split", () => {
  it("says what the scoreline counted", async () => {
    const { activeSplitHTML } = await scoreHelpers();
    const now = Date.now();
    const rows = [
      ...Array.from({ length: 8 }, () => activeRow("claude", now)),
      ...Array.from({ length: 11 }, () => activeRow("codex", now)),
      // Yesterday's member is not part of "active".
      activeRow("codex", now, 60 * 60_000),
    ];
    expect(readable(activeSplitHTML(rows, now))).toBe("Claude 8 : 11 Codex by last activity");
  });

  it("gives the scoreline to any two agents, not only Claude Code and Codex", async () => {
    const { activeSplitHTML } = await scoreHelpers();
    const now = Date.now();
    const rows = [
      ...Array.from({ length: 3 }, () => activeRow("claude", now)),
      ...Array.from({ length: 2 }, () => activeRow("grok", now)),
    ];
    expect(readable(activeSplitHTML(rows, now))).toBe("Claude 3 : 2 Grok by last activity");
  });

  it("keeps a third agent on the line instead of rounding it away", async () => {
    const { activeSplitHTML } = await scoreHelpers();
    const now = Date.now();
    const rows = [
      ...Array.from({ length: 5 }, () => activeRow("claude", now)),
      ...Array.from({ length: 3 }, () => activeRow("codex", now)),
      activeRow("pi", now),
    ];
    expect(readable(activeSplitHTML(rows, now))).toBe("Claude 5 \u00b7 Codex 3 \u00b7 Pi 1 by last activity");
  });

  it("shows nothing when nobody is active", async () => {
    const { activeSplitHTML } = await scoreHelpers();
    const now = Date.now();
    expect(activeSplitHTML([activeRow("claude", now, 60 * 60_000)], now)).toBe("");
  });
});
