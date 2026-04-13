import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveKnownLocation } from "@/lib/canvas/geocode";
import { generateId } from "@/lib/events";

/**
 * POST /api/planner/expand-class
 * Takes a planner_item ID (class_meeting type with GT Scheduler data)
 * and creates recurring calendar events from it.
 *
 * Body: { plannerItemId: string }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { plannerItemId } = await req.json();
  if (!plannerItemId) {
    return NextResponse.json({ error: "Missing plannerItemId" }, { status: 400 });
  }

  // Load the planner item
  const { data: item, error: itemError } = await supabase
    .from("planner_items")
    .select("*")
    .eq("id", plannerItemId)
    .eq("user_id", user.id)
    .single();

  if (itemError || !item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  // Extract GT Scheduler data from rawScraperData
  const scraperData = item.raw_scraper_data as Record<string, unknown> | null;
  if (!scraperData || scraperData.source !== "gt-scheduler") {
    return NextResponse.json({ error: "Not a GT Scheduler item" }, { status: 400 });
  }

  const days = scraperData.days as string[] | undefined;
  const startTime = scraperData.startTime as string | undefined;
  const endTime = scraperData.endTime as string | undefined;
  const locationStr = scraperData.location as string | undefined;
  const instructor = scraperData.instructor as string | undefined;

  if (!days || !startTime || !endTime) {
    return NextResponse.json({ error: "Missing schedule data" }, { status: 400 });
  }

  const location = locationStr ? resolveKnownLocation(locationStr) : null;
  const courseCode = item.course_code || item.title;
  const isLab = Boolean(scraperData.isLab) || item.description?.includes("Lab/Studio") || item.title?.includes("Lab");
  const seriesId = `class-${courseCode}-${days.join("")}`;

  // Check if events already exist (by series_id OR by title+time)
  const eventTitle = isLab ? `${courseCode} Lab` : courseCode;
  const { data: existingBySeries } = await supabase
    .from("events").select("id").eq("user_id", user.id).eq("series_id", seriesId).limit(1);
  const { data: existingByTitle } = await supabase
    .from("events").select("id").eq("user_id", user.id).eq("title", eventTitle).eq("start_time", startTime).limit(1);

  if ((existingBySeries && existingBySeries.length > 0) || (existingByTitle && existingByTitle.length > 0)) {
    return NextResponse.json({ ok: true, message: "Events already exist", count: 0 });
  }

  // Expand into individual calendar events for the next 16 weeks
  const dayNameToIndex: Record<string, number> = {
    Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
  };
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const classEvents = [];

  for (let week = 0; week < 16; week++) {
    for (const dayName of days) {
      const dayIdx = dayNameToIndex[dayName];
      if (dayIdx === undefined) continue;

      const d = new Date(today);
      const currentDay = d.getDay();
      const daysUntil = (dayIdx - currentDay + 7) % 7;
      d.setDate(d.getDate() + daysUntil + week * 7);

      if (d < today) continue;

      const dateStr = d.toISOString().split("T")[0];
      classEvents.push({
        id: generateId(),
        user_id: user.id,
        title: isLab ? `${courseCode} Lab` : courseCode,
        date: dateStr,
        start_time: startTime,
        end_time: endTime,
        color: isLab ? "teal" : "blue",
        all_day: false,
        description: `${item.title}\nInstructor: ${instructor || "TBA"}\nRoom: ${locationStr || "TBA"}`,
        location_name: location?.name || locationStr || null,
        location_lat: location?.lat || null,
        location_lng: location?.lng || null,
        series_id: seriesId,
        is_protected: true,
      });
    }
  }

  if (classEvents.length > 0) {
    const { error } = await supabase.from("events").upsert(classEvents, { onConflict: "id" });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, count: classEvents.length });
}
