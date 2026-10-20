/**
 * App Store and Google Play listing import. The user pastes a listing URL; we
 * pull out the store's app ID and fetch only fixed store endpoints built from
 * it (never the pasted URL itself), with a timeout, a size cap and no
 * redirects. Everything returned is untrusted text written by whoever
 * published the listing.
 */
import { cleanText } from "../text";

export type StoreKind = "APP_STORE" | "GOOGLE_PLAY";

export interface ListingRef {
  store: StoreKind;
  storeAppId: string;
  country: string;
  sourceUrl: string;
}

export interface ImportedListing {
  name: string;
  description: string;
  category: string | null;
  iconUrl: string | null;
  screenshots: string[];
}

export class ListingError extends Error {}

const MAX_BYTES = 3_000_000;
const MAX_SCREENSHOTS = 10;
const IMAGE_HOSTS = [/\.mzstatic\.com$/, /^play-lh\.googleusercontent\.com$/];

export function parseListingUrl(input: string): ListingRef {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new ListingError("That doesn't look like a link. Paste the full App Store or Google Play address.");
  }
  if (url.protocol !== "https:") throw new ListingError("Use the https:// store link.");

  if (url.hostname === "apps.apple.com" || url.hostname === "itunes.apple.com") {
    const id = url.pathname.match(/\/id(\d{5,15})(?:$|[/?])/)?.[1] ?? url.pathname.match(/\/id(\d{5,15})$/)?.[1];
    if (!id) throw new ListingError("Couldn't find the app ID in that App Store link.");
    const country = url.pathname.match(/^\/([a-z]{2})\//)?.[1] ?? "us";
    return { store: "APP_STORE", storeAppId: id, country, sourceUrl: `https://apps.apple.com/${country}/app/id${id}` };
  }

  if (url.hostname === "play.google.com" && url.pathname === "/store/apps/details") {
    const id = url.searchParams.get("id") ?? "";
    if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(id) || id.length > 150) {
      throw new ListingError("Couldn't find the app ID in that Google Play link.");
    }
    return {
      store: "GOOGLE_PLAY",
      storeAppId: id,
      country: "us",
      sourceUrl: `https://play.google.com/store/apps/details?id=${id}`,
    };
  }

  throw new ListingError("Only App Store (apps.apple.com) and Google Play (play.google.com) links are supported.");
}

export function storeFetchUrl(ref: ListingRef): string {
  return ref.store === "APP_STORE"
    ? `https://itunes.apple.com/lookup?id=${ref.storeAppId}&country=${ref.country}&entity=software`
    : `https://play.google.com/store/apps/details?id=${encodeURIComponent(ref.storeAppId)}&hl=en&gl=US`;
}

export async function importListing(ref: ListingRef, fetchImpl: typeof fetch = fetch): Promise<ImportedListing> {
  const response = await fetchImpl(storeFetchUrl(ref), {
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
    headers: { "user-agent": "Mozilla/5.0 (compatible; JadedImporter/1.0)", "accept-language": "en" },
  });
  if (response.status === 404) throw new ListingError("The store says that app doesn't exist.");
  if (!response.ok) throw new ListingError("The store didn't respond. Try again in a minute.");
  const body = await readCapped(response);
  const listing = ref.store === "APP_STORE" ? parseAppStoreLookup(body) : parsePlayListing(body);
  if (!listing.name) throw new ListingError("Couldn't read that listing.");
  return listing;
}

async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) throw new ListingError("That listing page is unexpectedly large.");
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new ListingError("That listing page is unexpectedly large.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const clean = cleanText;

/** Only https images from the stores' own image hosts are kept. */
export function safeImageUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && IMAGE_HOSTS.some((h) => h.test(url.hostname)) ? url.href : null;
  } catch {
    return null;
  }
}

export function parseAppStoreLookup(body: string): ImportedListing {
  let data: { resultCount?: number; results?: Array<Record<string, unknown>> };
  try {
    data = JSON.parse(body);
  } catch {
    throw new ListingError("Couldn't read that listing.");
  }
  const app = data.results?.[0];
  if (!app) throw new ListingError("The App Store has no app with that ID in this country.");
  const shots = [...((app.screenshotUrls as unknown[]) ?? []), ...((app.ipadScreenshotUrls as unknown[]) ?? [])];
  return {
    name: clean(app.trackName, 200),
    description: clean(app.description, 5000),
    category: clean(app.primaryGenreName, 100) || null,
    iconUrl: safeImageUrl(app.artworkUrl512 ?? app.artworkUrl100),
    screenshots: unique(shots.map(safeImageUrl)).slice(0, MAX_SCREENSHOTS),
  };
}

export function parsePlayListing(html: string): ImportedListing {
  const ld = jsonLdApp(html);
  const meta = (property: string) =>
    decodeEntities(
      html.match(new RegExp(`<meta[^>]+(?:property|name)="${property}"[^>]+content="([^"]*)"`, "i"))?.[1] ??
        html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${property}"`, "i"))?.[1] ??
        "",
    );
  const screenshots = unique(
    [...html.matchAll(/<img\b[^>]*>/gi)]
      .map((m) => m[0])
      .filter((tag) => /alt="[^"]*screenshot[^"]*"/i.test(tag))
      .map((tag) => decodeEntities(tag.match(/\bsrc="([^"]+)"/i)?.[1] ?? ""))
      .map(safeImageUrl),
  ).slice(0, MAX_SCREENSHOTS);

  return {
    name: clean(ld?.name ?? meta("og:title").replace(/ - Apps on Google Play$/, ""), 200),
    description: clean(ld?.description ?? meta("og:description") ?? meta("description"), 5000),
    category: clean(ld?.applicationCategory, 100) || null,
    iconUrl: safeImageUrl(ld?.image ?? meta("og:image")),
    screenshots,
  };
}

function jsonLdApp(html: string): Record<string, string> | null {
  for (const match of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(match[1]);
      for (const item of Array.isArray(data) ? data : [data]) {
        if (item?.["@type"] === "SoftwareApplication" || item?.["@type"] === "MobileApplication") return item;
      }
    } catch {
      // Ignore malformed blocks.
    }
  }
  return null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function unique(values: Array<string | null>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))];
}
