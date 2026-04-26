import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/utils/supabase/middleware";
import { rateLimit, getClientIp } from "@/utils/rate-limit";

const EXPENSIVE_API_ROUTES = ["/api/chat", "/api/extract", "/api/planner/ingest"];

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (pathname.startsWith("/api/")) {
    const ip = getClientIp(request.headers);
    const isExpensive = EXPENSIVE_API_ROUTES.some((r) => pathname.startsWith(r));
    const limit = isExpensive ? 10 : 60;
    const windowMs = 60_000;
    const result = rateLimit(`${ip}:${pathname}`, limit, windowMs);

    if (!result.allowed) {
      return new NextResponse(
        JSON.stringify({ error: "Too many requests" }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": Math.ceil((result.resetAt - Date.now()) / 1000).toString(),
            "x-ratelimit-limit": result.limit.toString(),
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": Math.ceil(result.resetAt / 1000).toString(),
          },
        },
      );
    }
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
