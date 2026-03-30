import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // Read redirect target from query param first, fall back to cookie
  let next = searchParams.get("next");
  if (!next) {
    const cookies = request.headers.get("cookie") || "";
    const match = cookies.match(/noted_oauth_next=([^;]+)/);
    if (match) next = decodeURIComponent(match[1]);
  }
  next = next || "/home";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const response = NextResponse.redirect(`${origin}${next}`);
      // Clear the redirect cookie
      response.cookies.set("noted_oauth_next", "", { path: "/", maxAge: 0 });
      return response;
    }
  }

  // Auth error — redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
