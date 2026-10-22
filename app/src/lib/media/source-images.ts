import { Resvg } from "@resvg/resvg-js";
import { safeImageUrl } from "../stores";

/**
 * Loads the app's icon and screenshots for templates. Only https images on
 * the stores' own image hosts are fetched (see safeImageUrl), without
 * following redirects, with a timeout and a size cap.
 */
const MAX_IMAGE_BYTES = 5_000_000;

export interface SourceImage {
  dataUri: string;
  width: number;
  height: number;
}

export type ImageFetcher = (url: string) => Promise<SourceImage | null>;

export function createImageFetcher(fetchImpl: typeof fetch = fetch): ImageFetcher {
  return async (url) => {
    const safe = safeImageUrl(url);
    if (!safe) return null;
    try {
      const response = await fetchImpl(safe, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return null;
      const type = response.headers.get("content-type")?.split(";")[0].trim();
      if (type !== "image/png" && type !== "image/jpeg") return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_IMAGE_BYTES) return null;
      const size = imageSize(bytes, type);
      if (!size) return null;
      return { dataUri: `data:${type};base64,${Buffer.from(bytes).toString("base64")}`, ...size };
    } catch {
      return null;
    }
  };
}

/** Reads width/height from PNG or JPEG headers. */
export function imageSize(bytes: Uint8Array, type: string): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === "image/png") {
    if (bytes.length < 24 || view.getUint32(0) !== 0x89504e47) return null;
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  // JPEG: walk segments to a start-of-frame marker.
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    const length = view.getUint16(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: view.getUint16(i + 5), width: view.getUint16(i + 7) };
    }
    i += 2 + length;
  }
  return null;
}

/** The icon's average non-white, non-transparent colour, as #rrggbb. */
export function dominantColor(icon: SourceImage | null): string | null {
  if (!icon) return null;
  try {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="24" height="24"><image width="24" height="24" xlink:href="${icon.dataUri}"/></svg>`;
    const pixels = new Resvg(svg).render().pixels;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const [pr, pg, pb, pa] = [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
      if (pa < 200 || (pr > 235 && pg > 235 && pb > 235) || (pr < 20 && pg < 20 && pb < 20)) continue;
      r += pr;
      g += pg;
      b += pb;
      n++;
    }
    if (n < 10) return null;
    const hex = (v: number) =>
      Math.round(v / n)
        .toString(16)
        .padStart(2, "0");
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  } catch {
    return null;
  }
}
