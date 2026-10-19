import type { Metadata } from "next";
import { connection } from "next/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jaded",
  description: "Turns your code pushes into social posts for your app.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Render per request so Next.js can attach the CSP nonce from src/proxy.ts.
  await connection();
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
