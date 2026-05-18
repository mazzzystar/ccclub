import { Resvg, initWasm } from "@resvg/resvg-wasm";
// @ts-expect-error wasm module imported as asset
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
// @ts-expect-error font binary imported as data
import interRegular from "./fonts/Inter-Regular.ttf";
// @ts-expect-error font binary imported as data
import interBold from "./fonts/Inter-Bold.ttf";

let wasmInitPromise: Promise<void> | null = null;

export const AVATAR_COLORS = [
  "#c45c5c", "#d4845a", "#d4a03e", "#8aaa5a", "#5aad7d",
  "#4a9b8a", "#4a8aaa", "#5a7aaa", "#7a6aaa", "#9a5aaa",
  "#aa5a8a", "#c46a7a",
];

export function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function getColor(userId: string): string {
  return AVATAR_COLORS[hashCode(userId) % AVATAR_COLORS.length];
}

export function svgEsc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function htmlEsc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export function sanitizeCode(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

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
