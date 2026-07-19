import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { makeReqLogger, generateRequestId } from "./lib/logger";

const PUBLIC_PATHS = ["/login", "/api/auth", "/integrations/", "/fonts/"];
const PUBLIC_API_PREFIXES = ["/api/auth", "/api/billing/webhook", "/api/invitations"];

export function middleware(request: NextRequest) {
  const start = performance.now();
  const { pathname } = request.nextUrl;
  const rid = generateRequestId();
  const log = makeReqLogger("middleware", rid);
  request.headers.set("x-request-id", rid);

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (/\.(png|jpg|jpeg|gif|svg|webp|ico|css|js|woff2?|ttf|eot)$/i.test(pathname)) {
    return NextResponse.next();
  }

  const isApiRoute = pathname.startsWith("/api/");
  if (isApiRoute && PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (isApiRoute) {
    const sessionToken = request.cookies.get("better-auth.session_token")?.value;
    if (!sessionToken) {
      log.warn("missing session token", { status: 401 });
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }
    const response = NextResponse.next();
    response.headers.set("x-request-id", rid);
    return response;
  }

  const sessionToken = request.cookies.get("better-auth.session_token")?.value;

  if (!sessionToken) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const response = NextResponse.next();
  response.headers.set("x-request-id", rid);
  const ms = (performance.now() - start).toFixed(0);
  log.info(`${request.method} ${pathname}`, { ms: parseInt(ms) });
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|favicon\\.svg|public/).*)",
  ],
};
