import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const keepEvents = body.keepEvents === true;

  // Find connection
  const { data: conn } = await supabase
    .from("canvas_connections")
    .select("id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!conn) {
    return NextResponse.json({ error: "No Canvas connection found" }, { status: 404 });
  }

  // Optionally delete CalendarEvents that came from Canvas
  if (!keepEvents) {
    // Canvas-generated event IDs start with "canvas_"
    const { data: canvasItems } = await supabase
      .from("canvas_academic_items")
      .select("event_id")
      .eq("connection_id", conn.id)
      .not("event_id", "is", null);

    if (canvasItems && canvasItems.length > 0) {
      const eventIds = canvasItems.map((i) => i.event_id).filter(Boolean);
      if (eventIds.length > 0) {
        await supabase
          .from("events")
          .delete()
          .eq("user_id", user.id)
          .in("id", eventIds);
      }
    }
  }

  // Delete connection (cascades to courses, items, meetings, sync_runs)
  const { error } = await supabase
    .from("canvas_connections")
    .delete()
    .eq("id", conn.id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
