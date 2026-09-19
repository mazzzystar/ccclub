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
    const nodes = await landingGraph("/");
    const app = nodes.find((o) => o["@type"] === "SoftwareApplication");
    expect(app).toBeDefined();
    expect(app?.subjectOf).toEqual({
      "@type": "DigitalDocument",
      url: "https://ccclub.dev/llms.txt",
      encodingFormat: "text/plain",
    });
  });
});

/** The nodes of the landing page's single `@graph`, one block per page. */
async function landingGraph(path: string): Promise<Array<Record<string, any>>> {
  const body = await (await fetchPath(path)).text();
  const blocks = [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  expect(blocks).toHaveLength(1);
  const doc = JSON.parse(blocks[0][1]);
  expect(doc["@context"]).toBe("https://schema.org");
  return doc["@graph"];
}

describe("the landing pages describe one site, not three loose objects", () => {
  for (const path of ["/", "/zh", "/ja", "/de", "/ru"]) {
    it(`${path} emits Organization, WebSite and SoftwareApplication in one graph`, async () => {
      const nodes = await landingGraph(path);
      expect(nodes.map((n) => n["@type"])).toEqual([
        "Organization",
        "WebSite",
        "SoftwareApplication",
      ]);
      const [org, site, app] = nodes;
      // Stable ids, identical in every language, so five pages describe the
      // same three entities rather than fifteen.
      expect(org["@id"]).toBe("https://ccclub.dev/#organization");
      expect(site["@id"]).toBe("https://ccclub.dev/#website");
      expect(app["@id"]).toBe("https://ccclub.dev/#software");
      expect(site.publisher).toEqual({ "@id": org["@id"] });
      expect(app.publisher).toEqual({ "@id": org["@id"] });
      expect(app.isPartOf).toEqual({ "@id": site["@id"] });
      expect(app.subjectOf.url).toBe("https://ccclub.dev/llms.txt");
    });
  }
});

describe("favicon and social cards", () => {
  for (const path of ["/favicon.ico", "/favicon.svg"]) {
    it(`${path} serves a real icon instead of a 404`, async () => {
      const res = await fetchPath(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("image/svg+xml");
      expect(res.headers.get("Cache-Control")).toContain("max-age=86400");
      expect(await res.text()).toContain("<svg");
    });
  }

  it("every indexable page declares the fetchable icon, not only the data URI", async () => {
    for (const path of ["/", "/zh", "/guides", "/claude-code-cost", "/blog"]) {
      const body = await (await fetchPath(path)).text();
      expect(body).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />');
    }
  });

  it("/blog shares with a card like its posts do", async () => {
    const body = await (await fetchPath("/blog")).text();
    expect(body).toContain('<meta property="og:image" content="https://ccclub.dev/og.png" />');
    expect(body).toContain('<meta property="og:url" content="https://ccclub.dev/blog" />');
    expect(body).toContain('<meta name="twitter:card" content="summary_large_image" />');
  });

  it("dates the blog index by its own last edit, not its newest post", async () => {
    const xml = await (await fetchPath("/sitemap.xml")).text();
    expect(xml).toContain("<loc>https://ccclub.dev/blog</loc><lastmod>2026-09-19</lastmod>");
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

/** Rendered prose of a page: body plus the FAQ, markup and code blocks out. */
function proseOf(html: string): string {
  return html
    .replace(/<pre[\s\S]*?<\/pre>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("each guide is long enough to answer, and written only once", () => {
  const prose = new Map(
    GUIDE_PAGES.map((g) => [
      `/${g.slug}`,
      `${proseOf(g.body)} ${g.faq.map((f) => `${f.q} ${f.a}`).join(" ")}`,
    ]),
  );

  for (const [path, text] of prose) {
    it(`${path} carries enough of its own prose`, () => {
      const words = text.split(/\s+/).filter(Boolean).length;
      expect(words, `${path} is thin: ${words} words`).toBeGreaterThanOrEqual(400);
      expect(words, `${path} is bloated: ${words} words`).toBeLessThanOrEqual(1800);
    });
  }

  it("shares no twelve-word run between any two pages", () => {
    // Google folds near-duplicates, so a paragraph reused across pages costs
    // one of them. Twelve words is long enough that a collision is copying
    // rather than coincidence.
    const N = 12;
    const owner = new Map<string, string>();
    const shared: string[] = [];
    for (const [path, text] of prose) {
      const words = text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
      const local = new Set<string>();
      for (let i = 0; i + N <= words.length; i++) {
        const shingle = words.slice(i, i + N).join(" ");
        if (local.has(shingle)) continue;
        local.add(shingle);
        const prior = owner.get(shingle);
        if (prior == null) owner.set(shingle, path);
        else if (prior !== path) shared.push(`${prior} + ${path}: "${shingle}"`);
      }
    }
    expect(shared, shared.slice(0, 5).join("\n")).toHaveLength(0);
  });
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

/**
 * Single-intent pages added in sprint 2. Each has to be a real guide — in
 * GUIDE_PAGES, so the length, FAQ and sitemap checks above cover it — and
 * linked from the places a crawler and an assistant look.
 */
describe("the single-intent pages are registered everywhere", () => {
  const registered = [
    { slug: "claude-code-statusline", inLlms: "Claude Code statusline" },
    { slug: "how-to-check-claude-code-usage", inLlms: "How to check Claude Code usage" },
    { slug: "claude-code-cost", inLlms: "Claude Code cost" },
  ];

  for (const { slug, inLlms } of registered) {
    it(`/${slug} is a guide, indexed and linked`, async () => {
      expect(GUIDE_PAGES.some((g) => g.slug === slug)).toBe(true);
      expect(INDEXABLE_PATHS).toContain(`/${slug}`);

      const page = await fetchPath(`/${slug}`);
      expect(page.status).toBe(200);
      const body = await page.text();
      expect(body).toContain(`<link rel="canonical" href="https://ccclub.dev/${slug}" />`);
      expect((body.match(/<h1>/g) ?? []).length).toBe(1);

      const sitemap = await (await fetchPath("/sitemap.xml")).text();
      expect(sitemap).toContain(`<loc>https://ccclub.dev/${slug}</loc><lastmod>2026-09-19</lastmod>`);

      const llms = await (await fetchPath("/llms.txt")).text();
      expect(llms).toContain(`[${inLlms}](https://ccclub.dev/${slug})`);

      const guides = await (await fetchPath("/guides")).text();
      expect(guides).toContain(`href="/${slug}"`);

      // The landing footer no longer lists every guide — it links three and
      // the hub. Reachability from the homepage is the hub's job now.
      const landing = await (await fetchPath("/")).text();
      expect(landing).toContain('href="/guides"');
    });
  }

  it("the landing footer links the hub and the three guides it kept", async () => {
    const landing = await (await fetchPath("/")).text();
    expect(landing).toContain('href="/guides"');
    for (const slug of ["claude-code-usage", "claude-code-limits", "claude-code-cost"]) {
      expect(landing).toContain(`href="/${slug}"`);
    }
    // Trimmed from the footer on purpose: eight links sat directly above the
    // one link that leads to all of them. These stay one click away.
    for (const slug of [
      "how-to-check-claude-code-usage",
      "claude-code-statusline",
      "codex-usage",
      "ccusage-vs-ccclub",
      "claude-code-leaderboards",
    ]) {
      expect(landing).not.toContain(`href="/${slug}"`);
    }
  });
});

describe("/ccusage-vs-ccclub shows its work", () => {
  it("names who wrote it, what was checked, and when", async () => {
    const body = await (await fetchPath("/ccusage-vs-ccclub")).text();
    expect(body).toContain("<h2>Methodology</h2>");
    expect(body).toContain("not a neutral review");
    expect(body).toContain("2026-09-19");
    expect(body).toContain("<h2>Sources</h2>");
    // The repo moved out of ryoppippi/ into its own org; cite where it is.
    expect(body).toContain("https://github.com/ccusage/ccusage/blob/main/apps/ccusage/README.md");
    expect(body).toContain("https://ccusage.com");
  });

  it("claims nothing about ccusage that its README does not say", async () => {
    const body = await (await fetchPath("/ccusage-vs-ccclub")).text();
    expect(body).not.toContain("uploads nothing");
    expect(body).toContain("no upload");
  });
});

describe("guide FAQs render exactly what the JSON-LD claims", () => {
  for (const page of GUIDE_PAGES) {
    it(`/${page.slug} answers match its FAQPage`, async () => {
      const body = await (await fetchPath(`/${page.slug}`)).text();
      const faqLd = [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
        .map((m) => JSON.parse(m[1]))
        .find((o) => o["@type"] === "FAQPage");
      const questions = faqLd.mainEntity as Array<{
        name: string;
        acceptedAnswer: { text: string };
      }>;
      expect(questions).toHaveLength(page.faq.length);
      const visible = decodeEntities(body);
      for (const [i, q] of questions.entries()) {
        expect(q.name).toBe(page.faq[i].q);
        expect(q.acceptedAnswer.text).toBe(page.faq[i].a);
        // Both the heading and the answer are on the page, not just in the graph.
        expect(visible).toContain(`<h3>${q.name}</h3>`);
        expect(visible).toContain(q.acceptedAnswer.text);
      }
    });
  }
});

describe("/u/:handle ships HTML, not a script full of HTML", () => {
  it("has no JS-built tags in the shell", async () => {
    const body = await (await fetchPath("/u/someone")).text();
    expect(body).not.toContain('"<h1>"');
    expect(body).not.toContain("esc(data.displayName)");
    // Exactly one <h1> would be nice; the shell has none until the
    // script renders one, and either way no fake one from a JS string.
    expect(body.match(/<h1>/g)).toBeNull();
    expect(body).toContain('<script src="/u/activity.js" defer></script>');
  });

  it("stays out of the index", async () => {
    const body = await (await fetchPath("/u/someone")).text();
    expect(body).toContain('<meta name="robots" content="noindex" />');
  });

  it("serves the script as javascript, ahead of the handle route", async () => {
    const res = await fetchPath("/u/activity.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/javascript");
    const js = await res.text();
    expect(js).toContain('"<h1>" + esc(data.displayName) + "</h1>"');
    // The handle used to be baked into the page; it now comes off the URL.
    expect(js).toContain('var HANDLE = decodeURIComponent(location.pathname.replace(/^\\/u\\//, ""));');
    // Compiled, never run: proves the move out of the template kept it valid.
    expect(() => new Function(js)).not.toThrow();
  });
});

describe("HTML that never changes between deploys is cacheable at the edge", () => {
  const cacheable = ["/guides", ...GUIDE_PAGES.map((g) => `/${g.slug}`), "/blog", ...BLOG_POSTS.map((p) => `/blog/${p.slug}`)];

  for (const path of cacheable) {
    it(`${path} asks shared caches for an hour and browsers for nothing`, async () => {
      const res = await fetchPath(path);
      expect(res.headers.get("Cache-Control")).toBe(
        "public, max-age=0, s-maxage=3600, stale-while-revalidate=3600",
      );
    });
  }

  it("leaves per-user and live pages alone", async () => {
    // Landing pages set a language cookie and embed the live demo board;
    // group and profile pages are per-visitor. None may carry an s-maxage.
    for (const path of ["/", "/zh", "/g/global", "/g/ABCDEF", "/u/someone"]) {
      const res = await fetchPath(path);
      expect(res.headers.get("Cache-Control") ?? "").not.toContain("s-maxage");
    }
  });

  it("does not cache a blog 404 under the slug that produced it", async () => {
    const res = await fetchPath("/blog/no-such-post");
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control") ?? "").not.toContain("s-maxage");
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

  it("ranks English above its own translations without delisting them", async () => {
    const xml = await (await fetchPath("/sitemap.xml")).text();
    expect(xml).toContain("<loc>https://ccclub.dev/</loc>");
    expect(xml).toMatch(/<loc>https:\/\/ccclub\.dev\/<\/loc>[\s\S]*?<priority>1\.0<\/priority>/);
    for (const lang of LANDING_LANGS.filter((l) => l !== "en")) {
      // Still listed, still hreflang-paired on the page — just not the URL
      // we ask a crawler to spend its budget on.
      expect(xml).toContain(`<loc>https://ccclub.dev/${lang}</loc>`);
      expect(xml).toMatch(
        new RegExp(`<loc>https://ccclub\\.dev/${lang}</loc>[^<]*(<[^>]+>[^<]*)*?<priority>0\\.3</priority>`),
      );
      const body = await (await fetchPath(`/${lang}`)).text();
      expect(body).not.toContain('<meta name="robots" content="noindex" />');
      expect(body).toContain(`<link rel="alternate" hreflang="${lang}" href="https://ccclub.dev/${lang}" />`);
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
