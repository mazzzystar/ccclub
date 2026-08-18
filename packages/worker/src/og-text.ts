// Pure text/color helpers for OG rendering — importable from tests and
// pure modules without dragging in the resvg wasm asset chain.

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

// Strip non-Latin chars for OG images (Inter font only covers Latin/Cyrillic/Greek)
export function latinOnly(s: string): string {
  return s.replace(/[^\u0000-\u024F\u1E00-\u1EFF\u0400-\u04FF\u0370-\u03FF\d\s\p{P}]/gu, "").trim();
}

