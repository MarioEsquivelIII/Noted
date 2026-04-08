import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { encrypt } from "@/lib/canvas/crypto";
import { randomBytes } from "crypto";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { domain } = await req.json();
  if (!domain || typeof domain !== "string") {
    return NextResponse.json({ error: "Canvas domain is required" }, { status: 400 });
  }

  // Validate domain format (basic hostname check)
  const domainClean = domain.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}$/.test(domainClean)) {
    return NextResponse.json({ error: "Invalid Canvas domain format" }, { status: 400 });
  }

  const clientId = process.env.CANVAS_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "Canvas integration not configured" }, { status: 500 });
  }

  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/canvas/callback`;

  // Build encrypted state parameter (CSRF protection + domain routing)
  const nonce = randomBytes(16).toString("hex");
  const state = encrypt(
    JSON.stringify({
      userId: user.id,
      domain: domainClean,
      nonce,
      ts: Date.now(),
    }),
  );

  const authUrl = new URL(`https://${domainClean}/login/oauth2/auth`);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", "");  // Canvas default scope grants access to user's data

  return NextResponse.json({ authUrl: authUrl.toString(), domain: domainClean });
}
