import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import type { SourceImage } from "./source-images";

/**
 * Template images built from the app's own icon, screenshots and colour, with
 * an AI-written headline. Rendered on the server (satori → SVG → resvg → PNG).
 * Implements ImageRenderer so an AI image generator can be added later.
 */

export interface ImageSpec {
  template: "hero" | "card";
  width: number;
  height: number;
  appName: string;
  headline: string;
  highlights: string[];
  brandColor: string;
  icon: SourceImage | null;
  screenshot: SourceImage | null;
}

export interface RenderedImage {
  png: Uint8Array;
  width: number;
  height: number;
  contentType: "image/png";
  generator: string;
}

export interface ImageRenderer {
  render(spec: ImageSpec): Promise<RenderedImage>;
}

const INK = "#1b2826";
const PAPER = "#f4f0e7";

type Font = { name: string; data: Buffer; weight: 400 | 500 | 600 | 700; style: "normal" };
let fonts: Promise<Font[]> | undefined;

function loadFonts(): Promise<Font[]> {
  const file = (pkg: string, name: string) => join(process.cwd(), "node_modules", "@fontsource", pkg, "files", name);
  fonts ??= Promise.all([
    readFile(file("dm-sans", "dm-sans-latin-400-normal.woff")).then((data) => ({
      name: "DM Sans",
      data,
      weight: 400 as const,
      style: "normal" as const,
    })),
    readFile(file("dm-sans", "dm-sans-latin-700-normal.woff")).then((data) => ({
      name: "DM Sans",
      data,
      weight: 700 as const,
      style: "normal" as const,
    })),
    readFile(file("frank-ruhl-libre", "frank-ruhl-libre-latin-500-normal.woff")).then((data) => ({
      name: "Frank Ruhl Libre",
      data,
      weight: 500 as const,
      style: "normal" as const,
    })),
  ]);
  return fonts;
}

export function readableTextOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lum = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lum(r) + 0.7152 * lum(g) + 0.0722 * lum(b);
  return L > 0.45 ? INK : "#ffffff";
}

function Icon({
  icon,
  appName,
  size,
  color,
}: {
  icon: SourceImage | null;
  appName: string;
  size: number;
  color: string;
}) {
  if (icon) {
    return <img alt="" src={icon.dataUri} width={size} height={size} style={{ borderRadius: size * 0.22 }} />;
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.22,
        background: color,
        color: readableTextOn(color),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.5,
        fontWeight: 700,
      }}
    >
      {appName.slice(0, 1).toUpperCase()}
    </div>
  );
}

function Hero(spec: ImageSpec) {
  const fg = readableTextOn(spec.brandColor);
  const wide = spec.width > spec.height;
  const pad = Math.round(spec.width * 0.07);
  const shot = spec.screenshot;
  // Without a screenshot the text is the whole picture, so it gets more room.
  const headlineSize = Math.round((wide ? spec.height : spec.width) * (wide ? 0.11 : shot ? 0.085 : 0.11));
  const shotHeight = wide ? spec.height - pad * 2 : Math.round(spec.height * 0.55);
  const shotWidth = shot ? Math.round((shot.width / shot.height) * shotHeight) : 0;

  return (
    <div
      style={{
        width: spec.width,
        height: spec.height,
        display: "flex",
        flexDirection: wide ? "row" : "column",
        background: spec.brandColor,
        color: fg,
        fontFamily: "DM Sans",
        padding: pad,
        gap: pad * 0.6,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          gap: pad * 0.4,
          justifyContent: shot ? "flex-start" : "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <Icon icon={spec.icon} appName={spec.appName} size={Math.round(headlineSize * 1.3)} color={PAPER} />
          <div style={{ fontSize: Math.round(headlineSize * 0.45), fontWeight: 700, letterSpacing: 1 }}>
            {spec.appName}
          </div>
        </div>
        <div style={{ fontFamily: "Frank Ruhl Libre", fontSize: headlineSize, lineHeight: 1.1, display: "flex" }}>
          {spec.headline}
        </div>
        {!shot &&
          spec.highlights.map((h) => (
            <div key={h} style={{ fontSize: Math.round(headlineSize * 0.42), display: "flex", opacity: 0.9 }}>
              {`• ${h}`}
            </div>
          ))}
      </div>
      {shot && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: wide ? "center" : "flex-end" }}>
          <div
            style={{
              display: "flex",
              padding: 14,
              background: "#111",
              borderRadius: 48,
              boxShadow: "0 20px 40px rgba(0,0,0,0.35)",
            }}
          >
            <img alt="" src={shot.dataUri} width={shotWidth} height={shotHeight} style={{ borderRadius: 36 }} />
          </div>
        </div>
      )}
    </div>
  );
}

function Card(spec: ImageSpec) {
  const pad = Math.round(spec.width * 0.08);
  const headlineSize = Math.round(spec.width * 0.075);
  return (
    <div
      style={{
        width: spec.width,
        height: spec.height,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: PAPER,
        color: INK,
        fontFamily: "DM Sans",
        padding: pad,
        borderTop: `${Math.round(pad * 0.35)}px solid ${spec.brandColor}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <Icon icon={spec.icon} appName={spec.appName} size={Math.round(headlineSize * 1.4)} color={spec.brandColor} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{ fontSize: Math.round(headlineSize * 0.36), fontWeight: 700, letterSpacing: 3, color: "#4e605b" }}
          >
            WHAT&apos;S NEW
          </div>
          <div style={{ fontSize: Math.round(headlineSize * 0.5), fontWeight: 700 }}>{spec.appName}</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: Math.round(pad * 0.35) }}>
        <div style={{ fontFamily: "Frank Ruhl Libre", fontSize: headlineSize, lineHeight: 1.1, display: "flex" }}>
          {spec.headline}
        </div>
        {spec.highlights.map((h) => (
          <div
            key={h}
            style={{ display: "flex", gap: 16, fontSize: Math.round(headlineSize * 0.42), alignItems: "flex-start" }}
          >
            <div
              style={{
                width: 14,
                height: 14,
                marginTop: 14,
                background: spec.brandColor,
                borderRadius: 3,
                display: "flex",
              }}
            />
            <div style={{ display: "flex", flex: 1 }}>{h}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", height: 6, background: spec.brandColor, opacity: 0.4 }} />
    </div>
  );
}

export function createTemplateRenderer(): ImageRenderer {
  return {
    async render(spec) {
      const element = spec.template === "hero" ? <Hero {...spec} /> : <Card {...spec} />;
      const svg = await satori(element, { width: spec.width, height: spec.height, fonts: await loadFonts() });
      const png = new Resvg(svg, { fitTo: { mode: "width", value: spec.width } }).render().asPng();
      return {
        png: new Uint8Array(png),
        width: spec.width,
        height: spec.height,
        contentType: "image/png",
        generator: `template:${spec.template}-v1`,
      };
    },
  };
}

/** Image sizes per platform: up to three images per post. */
export const PLATFORM_IMAGES: Record<
  "INSTAGRAM" | "FACEBOOK",
  Array<{ template: ImageSpec["template"]; width: number; height: number; needsScreenshot?: boolean }>
> = {
  INSTAGRAM: [
    { template: "hero", width: 1080, height: 1350 },
    { template: "card", width: 1080, height: 1080 },
  ],
  FACEBOOK: [
    { template: "hero", width: 1200, height: 630 },
    { template: "card", width: 1080, height: 1080 },
  ],
};
