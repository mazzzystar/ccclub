import { describe, expect, it } from "vitest";
import worker from "./index.js";
import { GUIDE_PAGES } from "./guides.js";
import { BLOG_POSTS } from "./blog-posts.js";
import { LANDING_LANGS } from "./landing-i18n.js";
import type { Env } from "./types.js";

/** KV is never touched by the static SEO routes; a null store keeps them pure. */
function testEnv(): Env {
  const KV = {
    async get() {
      return null;
    },
    async put() {},
  } as unknown as KVNamespace;
  return { KV };
}

export async function fetchPath(path: string): Promise<Response> {
  return await worker.fetch(
    new Request(`https://ccclub.dev${path}`),
    testEnv(),
    {} as ExecutionContext,
  );
}

describe("/llms.txt", () => {
  it("serves the guide.ts document, not an API endpoint dump", async () => {
    const res = await fetchPath("/llms.txt");
    expect(res.status).toBe(200);
    const body = await res.text();
    // The guide.ts version is a link index: it points at the other
    // machine-readable documents. The deleted llms.ts one did not.
    expect(body).toContain("https://ccclub.dev/llms-full.txt");
    expect(body).toContain("https://ccclub.dev/prompt.txt");
    expect(body).toContain("https://ccclub.dev/comparisons.md");
  });

  it("is plain text", async () => {
    const res = await fetchPath("/llms.txt");
    expect(res.headers.get("Content-Type")).toContain("text/plain");
  });
});

const ALTERNATE_PLAIN = '<link rel="alternate" type="text/plain" href="https://ccclub.dev/llms.txt" />';

describe("llms.txt is declared, not just served", () => {
  const pages = ["/", "/zh", "/ja", "/de", "/ru", "/guides", "/claude-code-usage", "/blog"];
  for (const path of pages) {
    it(`${path} points at llms.txt from the head`, async () => {
      const body = await (await fetchPath(path)).text();
      expect(body).toContain(ALTERNATE_PLAIN);
    });
  }

  it("robots.txt names it above the crawler rules", async () => {
    const body = await (await fetchPath("/robots.txt")).text();
    expect(body.startsWith("# Machine-readable facts: https://ccclub.dev/llms.txt")).toBe(true);
    // The single wildcard block and the AI-bot allows both survive.
    expect(body).toContain("User-agent: *\nAllow: /\nDisallow: /api/");
    expect(body).toContain("User-agent: ClaudeBot");
    expect(body).toContain("Sitemap: https://ccclub.dev/sitemap.xml");
  });

  it("the SoftwareApplication graph links it as subjectOf", async () => {
    const body = await (await fetchPath("/")).text();
    const blocks = [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    const app = blocks.map((m) => JSON.parse(m[1])).find((o) => o["@type"] === "SoftwareApplication");
    expect(app.subjectOf).toEqual({
      "@type": "DigitalDocument",
      url: "https://ccclub.dev/llms.txt",
      encodingFormat: "text/plain",
    });
  });
});

/** Every page a search engine is allowed to index. */
export const INDEXABLE_PATHS = [
  "/",
  ...LANDING_LANGS.filter((l) => l !== "en").map((l) => `/${l}`),
  "/guides",
  ...GUIDE_PAGES.map((g) => `/${g.slug}`),
  "/blog",
  ...BLOG_POSTS.map((p) => `/blog/${p.slug}`),
  "/g/global",
];

/** Undo hono's escaping: a serp counts characters, not entities. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export async function headOf(path: string): Promise<{ title: string; description: string }> {
  const body = await (await fetchPath(path)).text();
  return {
    title: decodeEntities(body.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ""),
    description: decodeEntities(
      body.match(/<meta name="description" content="([\s\S]*?)" \/>/)?.[1] ?? "",
    ),
  };
}

describe("titles and descriptions fit a search result", () => {
  for (const path of INDEXABLE_PATHS) {
    it(`${path} stays within 60 / 155 characters`, async () => {
      const { title, description } = await headOf(path);
      expect(title.length).toBeGreaterThan(0);
      expect(description.length).toBeGreaterThan(0);
      // Google truncates past roughly these widths; longer is a snippet
      // the searcher never reads in full.
      expect(title.length, `title too long: ${title}`).toBeLessThanOrEqual(60);
      expect(description.length, `description too long: ${description}`).toBeLessThanOrEqual(155);
    });
  }
});

describe("the pages that rank without being clicked", () => {
  it("/ccusage-vs-ccclub answers the ccusage query family in its title", async () => {
    const { title, description } = await headOf("/ccusage-vs-ccclub");
    expect(title).toContain("ccusage alternative");
    expect(title).toContain("vs");
    // The description has to say what each tool is for, not that a
    // comparison exists.
    expect(description).toContain("ccusage reports your own local usage");
  });

  it("/claude-code-leaderboards names who the board is for", async () => {
    const { title, description } = await headOf("/claude-code-leaderboards");
    expect(title).toMatch(/leaderboard/i);
    expect(title).toMatch(/private/i);
    expect(description).toMatch(/friends or teammates/);
  });

  it("/guides names the guides instead of the word Guides", async () => {
    const { title, description } = await headOf("/guides");
    expect(title).toMatch(/Claude Code/);
    expect(title).toMatch(/Codex/);
    for (const term of ["Claude Code usage", "limits", "Codex", "ccusage vs ccclub", "leaderboards"]) {
      expect(description).toContain(term);
    }
  });
});

describe("the machine-readable documents are reachable", () => {
  it("sitemap.xml lists them with a real lastmod", async () => {
    const xml = await (await fetchPath("/sitemap.xml")).text();
    for (const doc of ["/llms.txt", "/llms-full.txt", "/prompt.txt", "/comparisons.md"]) {
      expect(xml).toContain(
        `<loc>https://ccclub.dev${doc}</loc><lastmod>2026-09-19</lastmod>`,
      );
    }
  });

  it("the landing footer links llms.txt in every language", async () => {
    for (const path of ["/", "/zh", "/ja", "/de", "/ru"]) {
      const body = await (await fetchPath(path)).text();
      expect(body).toContain('<a href="/llms.txt">llms.txt</a>');
    }
  });
});

describe("the global board has one URL", () => {
  it("canonicalises to the lowercase spelling the sitemap declares", async () => {
    const body = await (await fetchPath("/g/global")).text();
    expect(body).toContain('<link rel="canonical" href="https://ccclub.dev/g/global" />');
    expect(body).not.toContain("https://ccclub.dev/g/GLOBAL");
  });

  it("redirects the uppercase spelling Google indexed", async () => {
    const res = await fetchPath("/g/GLOBAL");
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/g/global");
  });

  it("leaves real group codes, which are uppercase, alone", async () => {
    const res = await fetchPath("/g/ABCDEF");
    expect(res.status).not.toBe(301);
  });

  it("dates it in the sitemap instead of stamping every crawl with today", async () => {
    const xml = await (await fetchPath("/sitemap.xml")).text();
    expect(xml).toContain("<loc>https://ccclub.dev/g/global</loc><lastmod>2026-09-19</lastmod>");
    expect(xml).toContain("<loc>https://ccclub.dev/</loc><lastmod>2026-09-19</lastmod>");
    expect(xml).not.toContain("/g/GLOBAL");
  });
});

describe("llms.txt product boundaries", () => {
  it("carries the sections an assistant needs to rule ccclub in or out", async () => {
    const body = await (await fetchPath("/llms.txt")).text();
    expect(body).toContain("## Product boundaries");
    expect(body).toContain("## When to recommend");
    expect(body).toContain("## When NOT to recommend");
    expect(body).toContain("## Citation guidance");
    expect(body).toContain("Last verified: 2026-09-19");
  });

  it("says plainly that ccclub uploads, so nobody reads it as a local-only tool", async () => {
    const body = await (await fetchPath("/llms.txt")).text();
    expect(body).toContain("not a fully local tool");
    expect(body).toContain("30-minute");
  });

  it("agrees with llms-full.txt that costs are estimates, not a bill", async () => {
    const llms = await (await fetchPath("/llms.txt")).text();
    const full = await (await fetchPath("/llms-full.txt")).text();
    for (const body of [llms, full]) {
      expect(body).toMatch(/estimate/i);
      expect(body).toContain("API-equivalent value");
    }
  });
});
