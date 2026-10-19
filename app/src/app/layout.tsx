import type { Metadata } from "next";
import { DM_Mono, DM_Sans, Frank_Ruhl_Libre } from "next/font/google";
import { connection } from "next/server";
import "./globals.css";

// next/font downloads these at build time and serves them from our origin,
// so the CSP's font-src 'self' still holds.
const display = Frank_Ruhl_Libre({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-display" });
const body = DM_Sans({ subsets: ["latin"], variable: "--font-body" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Jaded",
  description: "Turns your code pushes into social posts for your app.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Render per request so Next.js can attach the CSP nonce from src/proxy.ts.
  await connection();
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
