import { NextResponse, type NextRequest } from "next/server";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";
import { buildPageCsp, generateNonce } from "@/lib/security-headers";

// Sign-in endpoints: 30 requests per minute per client address.
const authLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

/**
 * Runs before every non-static request:
 *  - when deployed (production with an https APP_URL), plain-HTTP requests
 *    are redirected (GET/HEAD) or refused (anything else, so webhooks are
 *    never accepted over HTTP). The host terminates TLS and reports the
 *    original scheme in x-forwarded-proto;
 *  - sign-in endpoints are rate-limited per client address;
 *  - pages get a strict, per-request nonce CSP.
 * Static headers (HSTS etc.) come from next.config.ts.
 */
export function proxy(request: NextRequest) {
  const isDev = process.env.NODE_ENV === "development";

  const deployed = process.env.NODE_ENV === "production" && process.env.APP_URL?.startsWith("https://");
  if (deployed && request.headers.get("x-forwarded-proto") === "http") {
    if (request.method === "GET" || request.method === "HEAD") {
      const url = request.nextUrl.clone();
      url.protocol = "https:";
      url.port = "";
      return NextResponse.redirect(url, 308);
    }
    return new NextResponse("HTTPS required", { status: 403 });
  }

  if (request.nextUrl.pathname.startsWith("/api/auth/") && !authLimiter.hit(clientIp(request.headers))) {
    return new NextResponse("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
  }

  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();

  const nonce = generateNonce();
  const csp = buildPageCsp(nonce, isDev);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
