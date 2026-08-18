import { Resvg, initWasm } from "@resvg/resvg-wasm";
// @ts-expect-error wasm module imported as asset
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
// @ts-expect-error font binary imported as data
import interRegular from "./fonts/Inter-Regular.ttf";
// @ts-expect-error font binary imported as data
import interBold from "./fonts/Inter-Bold.ttf";

let wasmInitPromise: Promise<void> | null = null;

export * from "./og-text.js";

export async function renderToPng(svg: string): Promise<ArrayBuffer> {
  if (!wasmInitPromise) {
    wasmInitPromise = initWasm(resvgWasm).catch((err) => {
      wasmInitPromise = null;
      throw err;
    });
  }
  await wasmInitPromise;

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: 1200 },
    font: {
      fontBuffers: [
        new Uint8Array(interRegular as ArrayBuffer),
        new Uint8Array(interBold as ArrayBuffer),
      ],
      defaultFontFamily: "Inter",
    },
  });
  const rendered = resvg.render();
  return rendered.asPng() as unknown as ArrayBuffer;
}

export function ogCacheUrl(requestUrl: string, key: string): string {
  const url = new URL(requestUrl);
  return `${url.origin}/__og-cache/${key.replace(/[^a-zA-Z0-9/_:.-]/g, "-")}`;
}

export async function cachedPngResponse(
  cacheUrl: string,
  render: () => Promise<ArrayBuffer>,
  options: { maxAge: number; staleWhileRevalidate: number; executionCtx?: ExecutionContext },
): Promise<Response> {
  const cache = caches.default;
  const cacheRequest = new Request(cacheUrl);
  const cached = await cache.match(cacheRequest);
  if (cached) {
    const response = new Response(cached.body, cached);
    response.headers.set("X-CCClub-OG-Cache", "HIT");
    return response;
  }

  const png = await render();
  const response = new Response(png, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": `public, max-age=${options.maxAge}, stale-while-revalidate=${options.staleWhileRevalidate}`,
      "X-CCClub-OG-Cache": "MISS",
    },
  });
  const cachePut = cache.put(cacheRequest, response.clone());
  if (options.executionCtx) {
    options.executionCtx.waitUntil(cachePut);
  } else {
    await cachePut;
  }
  return response;
}
