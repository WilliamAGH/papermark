import { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import AppMiddleware from "@/lib/middleware/app";
import DomainMiddleware from "@/lib/middleware/domain";
import { BLOCKED_PATHNAMES } from "./lib/constants";
import PostHogMiddleware from "./lib/middleware/posthog";

function isAnalyticsPath(path: string) {
  // Create a regular expression
  // ^ - asserts position at start of the line
  // /ingest/ - matches the literal string "/ingest/"
  // .* - matches any character (except for line terminators) 0 or more times
  const pattern = /^\/ingest\/.*/;

  return pattern.test(path);
}

function normalizeHost(host: string | null): string {
  return host?.trim().toLowerCase().split(":", 1)[0] ?? "";
}

function getAppBaseHosts(): string[] {
  return (process.env.APP_BASE_HOSTS ?? "")
    .split(",")
    .map((host) => normalizeHost(host))
    .filter(Boolean);
}

export const config = {
  matcher: [
    /*
     * Match all paths except for:
     * 1. /api/ routes
     * 2. /_next/ (Next.js internals)
     * 3. /_static (inside /public)
     * 4. /_vercel (Vercel internals)
     * 5. /favicon.ico, /sitemap.xml (static files)
     */
    "/((?!api/|_next/|_static|_icons|_vercel|favicon.ico|sitemap.xml).*)",
  ],
};

export default async function middleware(req: NextRequest, ev: NextFetchEvent) {
  const path = req.nextUrl.pathname;
  const host = req.headers.get("host");
  const requestHost = normalizeHost(host);
  const appBaseHosts = getAppBaseHosts();
  const appHostIndex = appBaseHosts.indexOf(requestHost);

  if (appHostIndex > 0) {
    const canonicalUrl = req.nextUrl.clone();
    canonicalUrl.hostname = appBaseHosts[0];
    canonicalUrl.port = "";
    canonicalUrl.protocol = process.env.NEXTAUTH_URL?.startsWith("http://")
      ? "http:"
      : "https:";
    return NextResponse.redirect(canonicalUrl, 308);
  }

  if (isAnalyticsPath(path)) {
    return PostHogMiddleware(req);
  }

  const isDevelopmentAppHost =
    process.env.NODE_ENV === "development" &&
    (requestHost === "localhost" || requestHost.endsWith(".local"));
  const isConfiguredAppHost = appHostIndex === 0;

  if (!isDevelopmentAppHost && !isConfiguredAppHost) {
    return DomainMiddleware(req);
  }

  if (
    path !== "/" &&
    path !== "/v1" &&
    path !== "/register" &&
    path !== "/privacy" &&
    path !== "/terms" &&
    path !== "/oss-friends" &&
    path !== "/pricing" &&
    path !== "/docsend-alternatives" &&
    path !== "/data-room" &&
    path !== "/launch-week" &&
    path !== "/open-source-investors" &&
    path !== "/investors" &&
    path !== "/ai" &&
    path !== "/share-notion-page" &&
    !path.startsWith("/alternatives") &&
    !path.startsWith("/solutions") &&
    !path.startsWith("/investors") &&
    !path.startsWith("/blog") &&
    !path.startsWith("/view/")
  ) {
    return AppMiddleware(req);
  }

  const url = req.nextUrl.clone();

  if (
    path.startsWith("/view/") &&
    (BLOCKED_PATHNAMES.some((blockedPath) => path.includes(blockedPath)) ||
      path.includes("."))
  ) {
    url.pathname = "/404";
    return NextResponse.rewrite(url, { status: 404 });
  }

  return NextResponse.next();
}
