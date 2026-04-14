import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { launchAuthBrowser, hasValidAuth, getAuthStatePath } from "@/lib/planner/scraper/auth";
import { existsSync, unlinkSync } from "fs";

/**
 * POST /api/planner/auth
 * Launch a headed browser for the student to log into Canvas.
 * Body: { canvasDomain: string }
 *
 * NOTE: Only works in local development (needs visible browser window).
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { canvasDomain } = await req.json();
  if (!canvasDomain) {
    return NextResponse.json({ error: "canvasDomain is required" }, { status: 400 });
  }

  // Clean domain
  const domain = canvasDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();

  // Save domain to profile
  await supabase
    .from("user_profiles")
    .update({ canvas_domain: domain })
    .eq("user_id", user.id);

  // Launch auth browser
  const result = await launchAuthBrowser(user.id, domain);

  if (result.success) {
    return NextResponse.json({ success: true, message: "Canvas auth saved successfully" });
  }

  return NextResponse.json(
    { error: result.error || "Authentication failed" },
    { status: 500 },
  );
}

/**
 * GET /api/planner/auth
 * Check if the student has valid Canvas auth state.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hasAuth = hasValidAuth(user.id);
  return NextResponse.json({ authenticated: hasAuth });
}

/**
 * DELETE /api/planner/auth
 * Remove Playwright auth state for the user.
 */
export async function DELETE() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const path = getAuthStatePath(user.id);
    if (existsSync(path)) {
      unlinkSync(path);
    }
  } catch { /* silent */ }

  return NextResponse.json({ ok: true });
}
