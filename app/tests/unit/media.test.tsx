import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { describe, expect, it, vi } from "vitest";
import { mediaSigningKey, signMediaPath, verifyMediaSignature } from "@/lib/media/signed-url";
import { createImageFetcher, dominantColor, imageSize } from "@/lib/media/source-images";
import { createLocalStorage } from "@/lib/media/storage";
import { createTemplateRenderer, PLATFORM_IMAGES, readableTextOn } from "@/lib/media/templates";

const key = mediaSigningKey("s".repeat(40));
const now = Date.UTC(2026, 9, 21, 12, 0, 0);

function parse(path: string) {
  const url = new URL(path, "http://x");
  return { id: url.pathname.split("/").pop()!, exp: url.searchParams.get("exp"), sig: url.searchParams.get("sig") };
}

function png(width: number, height: number, color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/></svg>`;
  return new Uint8Array(new Resvg(svg).render().asPng());
}

describe("signed media URLs", () => {
  it("verifies a fresh link", () => {
    const { id, exp, sig } = parse(signMediaPath("cabc123def456", { key, now }));
    expect(id).toBe("cabc123def456");
    expect(verifyMediaSignature(id, exp, sig, { key, now })).toEqual({ ok: true, secondsLeft: 600 });
  });

  it("rejects expired, tampered, re-targeted, unsigned and over-long links", () => {
    const { id, exp, sig } = parse(signMediaPath("cabc123def456", { key, now }));
    expect(verifyMediaSignature(id, exp, sig, { key, now: now + 601_000 })).toEqual({ ok: false, reason: "expired" });
    expect(verifyMediaSignature(id, String(Number(exp) + 60), sig, { key, now })).toEqual({ ok: false, reason: "bad" });
    expect(verifyMediaSignature("cother0000000", exp, sig, { key, now })).toEqual({ ok: false, reason: "bad" });
    expect(verifyMediaSignature(id, exp, sig, { key: mediaSigningKey("t".repeat(40)), now })).toEqual({
      ok: false,
      reason: "bad",
    });
    expect(verifyMediaSignature(id, null, null, { key, now })).toEqual({ ok: false, reason: "missing" });
    const long = parse(signMediaPath("cabc123def456", { key, now, ttlSeconds: 999_999 }));
    expect(Number(long.exp) - now / 1000).toBe(3600); // capped at one hour
  });
});

describe("local media storage", () => {
  it("stores and reads files, and refuses paths outside its folder", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jaded-media-"));
    const storage = createLocalStorage(dir);
    await storage.put("ws1/post1/m1.png", new Uint8Array([1, 2, 3]), "image/png");
    expect(await storage.get("ws1/post1/m1.png")).toEqual(new Uint8Array([1, 2, 3]));
    expect(await storage.get("ws1/post1/missing.png")).toBeNull();
    for (const bad of ["../escape.png", "ws1/../../x.png", "/etc/passwd", "ws1/a.exe", "WS1/A.PNG"]) {
      await expect(storage.put(bad, new Uint8Array([1]), "image/png")).rejects.toThrow(/Invalid media key/);
    }
    await storage.delete("ws1/post1/m1.png");
    expect(await readdir(join(dir, "ws1", "post1"))).toEqual([]);
  });
});

describe("source images", () => {
  it("reads PNG sizes and the icon's main colour", () => {
    const red = png(40, 20, "#c94f39");
    expect(imageSize(red, "image/png")).toEqual({ width: 40, height: 20 });
    const icon = { dataUri: `data:image/png;base64,${Buffer.from(red).toString("base64")}`, width: 40, height: 20 };
    expect(dominantColor(icon)).toBe("#c94f39");
    expect(readableTextOn("#c94f39")).toBe("#ffffff");
    expect(readableTextOn("#f4f0e7")).toBe("#1b2826");
  });

  it("only fetches PNG/JPEG images from store image hosts, without redirects", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(png(10, 10, "#000"), { headers: { "content-type": "image/png" } }),
    );
    const fetchImage = createImageFetcher(fetchImpl);
    expect(await fetchImage("https://evil.example/a.png")).toBeNull();
    expect(await fetchImage("http://is1-ssl.mzstatic.com/a.png")).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await fetchImage("https://is1-ssl.mzstatic.com/a.png")).toMatchObject({ width: 10, height: 10 });
    expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].redirect).toBe("manual");
    const svg = createImageFetcher(
      async () => new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }),
    );
    expect(await svg("https://is1-ssl.mzstatic.com/a.svg")).toBeNull();
  });
});

describe("template images", () => {
  const renderer = createTemplateRenderer();
  const shot = png(390, 844, "#ffffff");
  const screenshot = {
    dataUri: `data:image/png;base64,${Buffer.from(shot).toString("base64")}`,
    width: 390,
    height: 844,
  };

  it.each(Object.entries(PLATFORM_IMAGES).flatMap(([platform, layouts]) => layouts.map((l) => [platform, l] as const)))(
    "renders %s %o at the platform size",
    async (_platform, layout) => {
      const image = await renderer.render({
        ...layout,
        appName: "Demo",
        headline: "Offline mode is here",
        highlights: ["Works on the subway"],
        brandColor: "#c94f39",
        icon: null,
        screenshot,
      });
      expect(imageSize(image.png, "image/png")).toEqual({ width: layout.width, height: layout.height });
      expect(image.generator).toBe(`template:${layout.template}-v1`);
    },
  );
});
