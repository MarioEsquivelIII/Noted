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
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const response = NextResponse.redirect(`${origin}${next}`);
      // Clear the redirect cookie
      response.cookies.set("noted_oauth_next", "", { path: "/", maxAge: 0 });

      // Only store the Google token cookie when the OAuth flow was triggered
      // for calendar access (redirect includes gcal_pending). A normal Google
      // login token lacks the calendar.readonly scope and would cause 403s.
      const isCalendarFlow = next.includes("gcal_pending");
      const providerToken = data.session?.provider_token;
      if (isCalendarFlow && providerToken) {
        response.cookies.set("noted_google_token", providerToken, {
          path: "/",
          maxAge: 3500, // ~58 minutes (Google tokens expire after 1 hour)
          httpOnly: false, // needs to be readable by client JS
          sameSite: "lax",
        });
      }

      return response;
    }
  }

  // Auth error — redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
