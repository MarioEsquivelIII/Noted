import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

// GET /api/profile — fetch the onboarding profile for the authenticated user
export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (error && error.code === "PGRST116") {
    // No row found
    return NextResponse.json({ profile: null }, { status: 404 });
  }
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ profile: data });
}

// POST /api/profile — create or update an onboarding profile (upsert)
// Supports incremental saves: onboarding_completed defaults to false
// so partial progress is preserved if the user leaves midway.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  const row = {
    user_id: user.id,
    onboarding_completed: body.onboarding_completed ?? false,
    onboarding_step: body.onboarding_step ?? 0,
    user_type: body.user_type || "student",
    school_name: body.school_name || null,
    major: body.major || null,
    num_classes: body.num_classes || null,
    study_hours_per_week: body.study_hours_per_week || null,
    session_style: body.session_style || null,
    deadline_approach: body.deadline_approach || null,
    preferred_study_days: body.preferred_study_days || [],
    preferred_study_times: body.preferred_study_times || [],
    peak_productivity: body.peak_productivity || null,
    structure_level: body.structure_level || null,
    time_struggles: body.time_struggles || [],
    exercises_regularly: body.exercises_regularly ?? null,
    exercise_frequency: body.exercise_frequency || null,
    include_workouts: body.include_workouts ?? null,
    preferred_workout_time: body.preferred_workout_time || null,
    balance_preference: body.balance_preference || null,
    anchor_events: body.anchor_events || [],
    extra_preferences: body.extra_preferences || {},
    updated_at: new Date().toISOString(),
  };

  // Upsert: insert if no profile exists, update if one does
  const { error } = await supabase
    .from("user_profiles")
    .upsert(row, { onConflict: "user_id" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// PUT /api/profile — update an existing onboarding profile
export async function PUT(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  const { error } = await supabase
    .from("user_profiles")
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
