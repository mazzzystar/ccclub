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
