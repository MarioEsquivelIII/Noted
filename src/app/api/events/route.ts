import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

// GET /api/events — fetch all events for the authenticated user
export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("user_id", user.id)
    .order("date", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Map DB rows to CalendarEvent shape
  const events = (data || []).map((row) => ({
    id: row.id,
    title: row.title,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    color: row.color,
    allDay: row.all_day || false,
    ...(row.location_name
      ? { location: { name: row.location_name, lat: row.location_lat, lng: row.location_lng } }
      : {}),
  }));

  return NextResponse.json({ events });
}

// POST /api/events — create one or more events
// Pass ?replaceAll=1 to delete all existing events first (used by Google Calendar overwrite)
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const replaceAll = req.nextUrl.searchParams.get("replaceAll") === "1";

  const body = await req.json();
  const items: Array<{
    id: string;
    title: string;
    date: string;
    startTime: string;
    endTime: string;
    color: string;
    allDay?: boolean;
    location?: { name: string; lat: number; lng: number };
  }> = Array.isArray(body) ? body : [body];

  const rows = items.map((e) => ({
    id: e.id,
    user_id: user.id,
    title: e.title,
    date: e.date,
    start_time: e.startTime,
    end_time: e.endTime,
    color: e.color || "green",
    all_day: e.allDay || false,
    location_name: e.location?.name || null,
    location_lat: e.location?.lat || null,
    location_lng: e.location?.lng || null,
  }));

  // Delete all existing events first if replacing
  if (replaceAll) {
    const { error: delError } = await supabase.from("events").delete().eq("user_id", user.id);
    if (delError) {
      return NextResponse.json({ error: delError.message }, { status: 500 });
    }
  }

  const { error } = await supabase.from("events").upsert(rows, { onConflict: "id" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// PUT /api/events — update a single event
export async function PUT(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const e = await req.json();

  const { error } = await supabase
    .from("events")
    .update({
      title: e.title,
      date: e.date,
      start_time: e.startTime,
      end_time: e.endTime,
      color: e.color,
      all_day: e.allDay || false,
      location_name: e.location?.name || null,
      location_lat: e.location?.lat || null,
      location_lng: e.location?.lng || null,
    })
    .eq("id", e.id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/events?id=xxx — delete a single event
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing event id" }, { status: 400 });
  }

  const { error } = await supabase
    .from("events")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
