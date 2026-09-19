import { describe, expect, it } from "vitest";
import worker from "./index.js";
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
