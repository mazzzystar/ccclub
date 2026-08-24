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
