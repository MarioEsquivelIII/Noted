import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { rowToPlannerItem } from "@/lib/planner/types";
import { computeUrgency, computePriority } from "@/lib/planner/estimator";

/**
 * GET /api/planner/items
 * List planner items for the authenticated user.
 * Query params: future=true (only upcoming), archived=false
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const futureOnly = url.searchParams.get("future") !== "false";
  const showArchived = url.searchParams.get("archived") === "true";

  let query = supabase
    .from("planner_items")
    .select("*")
    .eq("user_id", user.id)
    .order("due_at", { ascending: true });

  if (!showArchived) {
    query = query.eq("is_archived", false);
  }

  if (futureOnly) {
    const now = new Date().toISOString();
    query = query.or(`due_at.gte.${now},due_at.is.null`);
  }

  const { data: rows, error } = await query.limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = (rows || []).map((row) => {
    const item = rowToPlannerItem(row);
    return {
      ...item,
      urgencyScore: computeUrgency(item),
      priorityScore: computePriority(item),
    };
  });

  return NextResponse.json({ items });
}

/**
 * DELETE /api/planner/items?id=xxx
 * Delete a planner item and any associated calendar events.
 */
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  // Get the item first to find associated calendar events
  const { data: item } = await supabase
    .from("planner_items")
    .select("course_code, title, raw_scraper_data")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  // Delete the planner item
  await supabase.from("planner_items").delete().eq("id", id).eq("user_id", user.id);

  // Also delete any calendar events created from this item
  if (item?.course_code) {
    const scrData = item.raw_scraper_data as Record<string, unknown> | null;
    const days = scrData?.days as string[] | undefined;
    if (days) {
      const seriesId = `class-${item.course_code}-${days.join("")}`;
      await supabase.from("events").delete().eq("user_id", user.id).eq("series_id", seriesId);
    }
    // Also try title-based cleanup
    await supabase.from("events").delete()
      .eq("user_id", user.id)
      .like("title", `${item.course_code}%`);
  }

  return NextResponse.json({ ok: true });
}
