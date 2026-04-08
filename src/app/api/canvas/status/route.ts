import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get connection
  const { data: conn } = await supabase
    .from("canvas_connections")
    .select("id, canvas_domain, last_synced_at, connected_at")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!conn) {
    return NextResponse.json({ connected: false });
  }

  // Get counts
  const [coursesRes, itemsRes] = await Promise.all([
    supabase
      .from("canvas_courses")
      .select("id", { count: "exact", head: true })
      .eq("connection_id", conn.id)
      .eq("is_active", true),
    supabase
      .from("canvas_academic_items")
      .select("id", { count: "exact", head: true })
      .eq("connection_id", conn.id)
      .eq("is_archived", false),
  ]);

  return NextResponse.json({
    connected: true,
    domain: conn.canvas_domain,
    connectionId: conn.id,
    connectedAt: conn.connected_at,
    lastSyncedAt: conn.last_synced_at,
    courseCount: coursesRes.count || 0,
    itemCount: itemsRes.count || 0,
  });
}
