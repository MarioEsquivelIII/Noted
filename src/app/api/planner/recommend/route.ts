import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { rowToPlannerItem, recommendRequestSchema } from "@/lib/planner/types";
import { generateWorkBlocks } from "@/lib/planner/scheduler";
import { type CalendarEvent } from "@/lib/events";

/**
 * POST /api/planner/recommend
 * Generate work block recommendations.
 * Body: { itemIds?: string[], windowDays?: number }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = recommendRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { itemIds, windowDays } = parsed.data;

  // Load planner items
  let query = supabase
    .from("planner_items")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_archived", false)
    .gte("due_at", new Date().toISOString())
    .order("due_at", { ascending: true });

  if (itemIds && itemIds.length > 0) {
    query = query.in("id", itemIds);
  }

  const { data: itemRows, error: itemsError } = await query.limit(50);
  if (itemsError) {
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  const items = (itemRows || []).map(rowToPlannerItem);

  // Load existing calendar events
  const { data: eventRows } = await supabase
    .from("events")
    .select("*")
    .eq("user_id", user.id)
    .gte("date", new Date().toISOString().split("T")[0])
    .order("date", { ascending: true });

  const existingEvents: CalendarEvent[] = (eventRows || []).map((row) => ({
    id: row.id,
    title: row.title,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    color: row.color,
    allDay: row.all_day || false,
    isProtected: row.is_protected || false,
  }));

  // Load onboarding profile
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  // Generate work block recommendations
  const blocks = generateWorkBlocks(items, existingEvents, profile || null, windowDays);

  return NextResponse.json({
    blocks,
    stats: {
      itemsConsidered: items.length,
      blocksGenerated: blocks.length,
      totalMinutes: blocks.reduce((sum, b) => sum + b.durationMinutes, 0),
    },
  });
}
