import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { encrypt, decrypt } from "@/lib/canvas/crypto";

const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const errorParam = searchParams.get("error");

  if (errorParam) {
    return NextResponse.redirect(
      `${origin}/account?canvas_error=${encodeURIComponent(errorParam)}`,
    );
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(`${origin}/account?canvas_error=missing_params`);
  }

  // Decrypt and validate state
  let state: { userId: string; domain: string; nonce: string; ts: number };
  try {
    state = JSON.parse(decrypt(stateParam));
  } catch {
    return NextResponse.redirect(`${origin}/account?canvas_error=invalid_state`);
  }

  if (Date.now() - state.ts > STATE_MAX_AGE_MS) {
    return NextResponse.redirect(`${origin}/account?canvas_error=state_expired`);
  }

  // Verify the Supabase user matches the state
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user || user.id !== state.userId) {
    return NextResponse.redirect(`${origin}/account?canvas_error=auth_mismatch`);
  }

  // Exchange code for tokens
  const clientId = process.env.CANVAS_CLIENT_ID || "";
  const clientSecret = process.env.CANVAS_CLIENT_SECRET || "";
  const redirectUri = `${origin}/api/canvas/callback`;

  const tokenRes = await fetch(`https://${state.domain}/login/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text().catch(() => "");
    console.error("Canvas token exchange failed:", tokenRes.status, errText);
    return NextResponse.redirect(`${origin}/account?canvas_error=token_exchange_failed`);
  }

  const tokenData = await tokenRes.json();
  const { access_token, refresh_token, expires_in, user: canvasUser } = tokenData;

  if (!access_token) {
    return NextResponse.redirect(`${origin}/account?canvas_error=no_access_token`);
  }

  // Encrypt tokens for storage
  const accessTokenEncrypted = encrypt(access_token);
  const refreshTokenEncrypted = encrypt(refresh_token || "");
  const tokenExpiresAt = expires_in
    ? new Date(Date.now() + expires_in * 1000).toISOString()
    : null;

  // Fetch Canvas user profile for timezone
  let canvasUserId = canvasUser?.id?.toString() || null;
  let canvasUserTimezone: string | null = null;
  try {
    const profileRes = await fetch(`https://${state.domain}/api/v1/users/self/profile`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (profileRes.ok) {
      const profile = await profileRes.json();
      canvasUserId = canvasUserId || profile.id?.toString();
      canvasUserTimezone = profile.time_zone || null;
    }
  } catch {
    // Non-critical — continue without timezone
  }

  // Upsert connection
  const { error: dbError } = await supabase.from("canvas_connections").upsert(
    {
      user_id: user.id,
      canvas_domain: state.domain,
      access_token_encrypted: accessTokenEncrypted,
      refresh_token_encrypted: refreshTokenEncrypted,
      token_expires_at: tokenExpiresAt,
      canvas_user_id: canvasUserId,
      canvas_user_timezone: canvasUserTimezone,
      connected_at: new Date().toISOString(),
    },
    { onConflict: "user_id,canvas_domain" },
  );

  if (dbError) {
    console.error("Failed to store Canvas connection:", dbError);
    return NextResponse.redirect(`${origin}/account?canvas_error=db_error`);
  }

  return NextResponse.redirect(`${origin}/account?canvas_connected=1`);
}
