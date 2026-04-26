import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/utils/supabase/server";

const eventInputSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  start_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  color: z.string().max(50).optional(),
  allDay: z.boolean().optional(),
  location: z.object({
    name: z.string().max(500),
    lat: z.number().optional(),
    lng: z.number().optional(),
  }).passthrough().optional(),
  description: z.string().max(5_000).optional(),
  recurrenceRule: z.unknown().optional(),
  recurrence_rule: z.unknown().optional(),
  seriesId: z.string().max(200).optional(),
  series_id: z.string().max(200).optional(),
  isRecurrenceException: z.boolean().optional(),
  is_recurrence_exception: z.boolean().optional(),
  isProtected: z.boolean().optional(),
  is_protected: z.boolean().optional(),
}).passthrough();

const eventsPostSchema = z.union([eventInputSchema, z.array(eventInputSchema).max(10_000)]);

const eventPutSchema = eventInputSchema;

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
    ...(row.description ? { description: row.description } : {}),
    ...(row.recurrence_rule ? { recurrenceRule: row.recurrence_rule } : {}),
    ...(row.series_id ? { seriesId: row.series_id } : {}),
    ...(row.is_recurrence_exception ? { isRecurrenceException: true } : {}),
    ...(row.is_protected ? { isProtected: true } : {}),
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

  const parsed = eventsPostSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.issues }, { status: 400 });
  }
  const items: Array<Record<string, unknown>> = Array.isArray(parsed.data) ? parsed.data : [parsed.data];

  const rows = items.map((e) => ({
    id: e.id as string,
    user_id: user.id,
    title: e.title as string,
    date: e.date as string,
    start_time: (e.startTime as string) || (e.start_time as string),
    end_time: (e.endTime as string) || (e.end_time as string),
    color: (e.color as string) || "green",
    all_day: (e.allDay as boolean) || false,
    location_name: (e.location as { name?: string })?.name || null,
    location_lat: (e.location as { lat?: number })?.lat || null,
    location_lng: (e.location as { lng?: number })?.lng || null,
    description: (e.description as string) || null,
    recurrence_rule: e.recurrenceRule || e.recurrence_rule || null,
    series_id: (e.seriesId as string) || (e.series_id as string) || null,
    is_recurrence_exception: (e.isRecurrenceException as boolean) || (e.is_recurrence_exception as boolean) || false,
    is_protected: (e.isProtected as boolean) || (e.is_protected as boolean) || false,
  }));

  // Delete all existing events first if replacing — but KEEP protected events
  if (replaceAll) {
    const { error: delError } = await supabase.from("events").delete().eq("user_id", user.id).eq("is_protected", false);
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

  const parsedPut = eventPutSchema.safeParse(await req.json());
  if (!parsedPut.success) {
    return NextResponse.json({ error: "Invalid request", details: parsedPut.error.issues }, { status: 400 });
  }
  const e = parsedPut.data as Record<string, unknown> & {
    id: string;
    title: string;
    date: string;
    startTime?: string;
    endTime?: string;
    color?: string;
    allDay?: boolean;
    location?: { name?: string; lat?: number; lng?: number };
    description?: string;
    recurrenceRule?: unknown;
    seriesId?: string;
    isRecurrenceException?: boolean;
    isProtected?: boolean;
  };

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
      description: e.description || null,
      recurrence_rule: e.recurrenceRule || null,
      series_id: e.seriesId || null,
      is_recurrence_exception: e.isRecurrenceException || false,
      is_protected: e.isProtected ?? undefined, // only update if explicitly provided
    })
    .eq("id", e.id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/events?id=xxx — delete a single event
// For series: ?id=xxx&seriesId=yyy&scope=all|following
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get("id");
  const seriesId = req.nextUrl.searchParams.get("seriesId");
  const scope = req.nextUrl.searchParams.get("scope"); // "all" | "following"
  const force = req.nextUrl.searchParams.get("force") === "1"; // bypass protection (settings only)

  if (!id && !seriesId) {
    return NextResponse.json({ error: "Missing event id or seriesId" }, { status: 400 });
  }

  // Check if event is protected (unless force flag is set — only from settings)
  if (id && !force) {
    const { data: event } = await supabase
      .from("events")
      .select("is_protected, title")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (event?.is_protected) {
      return NextResponse.json({
        error: "protected",
        message: `"${event.title}" is a non-negotiable event and can't be deleted. Remove its protection in Settings first, or ask the AI to remove the protection.`,
      }, { status: 403 });
    }
  }

  // Delete entire series (only non-protected unless forced)
  if (seriesId && scope === "all") {
    let query = supabase
      .from("events")
      .delete()
      .eq("series_id", seriesId)
      .eq("user_id", user.id);

    if (!force) query = query.eq("is_protected", false);

    const { error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Delete single event
  if (id) {
    const { error } = await supabase
      .from("events")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid delete request" }, { status: 400 });
}
