import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/auth", "/integrations/", "/fonts/"];
const PUBLIC_API_PREFIXES = ["/api/auth", "/api/billing/webhook", "/api/invitations"];

export function middleware(request: NextRequest) {
  const start = performance.now();
  const { pathname } = request.nextUrl;

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
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }
    return NextResponse.next();
  }

  const sessionToken = request.cookies.get("better-auth.session_token")?.value;

  if (!sessionToken) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const response = NextResponse.next();
  const ms = (performance.now() - start).toFixed(0);
  console.log(`${request.method} ${pathname} 200 in ${ms}ms`);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|favicon\\.svg|public/).*)",
  ],
};
