import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { buildPlannerContext } from "@/lib/planner/context-builder";

/**
 * GET /api/planner/context
 * Returns the rich academic context string for the AI system prompt.
 * Includes courses, deadlines, assignment details, and scheduling guidelines.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const context = await buildPlannerContext(supabase, user.id);
  return NextResponse.json({ context });
}
