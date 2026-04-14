import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { convertMeetingsToCalendarEvents } from "@/lib/canvas/toCalendarEvents";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { approvals } = await req.json();
  if (!Array.isArray(approvals)) {
    return NextResponse.json({ error: "approvals array is required" }, { status: 400 });
  }

  const approvedMeetingIds: string[] = [];

  for (const approval of approvals) {
    const { meetingId, approved, edits } = approval;
    if (!meetingId) continue;

    const updateData: Record<string, unknown> = { approved: !!approved };

    // Apply edits if provided
    if (edits) {
      if (edits.daysOfWeek) updateData.days_of_week = edits.daysOfWeek;
      if (edits.startTime) updateData.start_time = edits.startTime;
      if (edits.endTime) updateData.end_time = edits.endTime;
      if (edits.locationRaw) updateData.location_raw = edits.locationRaw;
      if (edits.locationMode) updateData.location_mode = edits.locationMode;
      if (edits.title) updateData.title = edits.title;
    }

    await supabase
      .from("canvas_inferred_meetings")
      .update(updateData)
      .eq("id", meetingId)
      .eq("user_id", user.id);

    if (approved) approvedMeetingIds.push(meetingId);
  }

  // Load approved meetings and convert to CalendarEvents
  if (approvedMeetingIds.length === 0) {
    return NextResponse.json({ events: [] });
  }

  const { data: meetings } = await supabase
    .from("canvas_inferred_meetings")
    .select("*, canvas_courses(*)")
    .in("id", approvedMeetingIds)
    .eq("user_id", user.id);

  if (!meetings || meetings.length === 0) {
    return NextResponse.json({ events: [] });
  }

  const events = convertMeetingsToCalendarEvents(meetings);

  // Mark meetings as events_generated
  await supabase
    .from("canvas_inferred_meetings")
    .update({ events_generated: true })
    .in("id", approvedMeetingIds)
    .eq("user_id", user.id);

  return NextResponse.json({ events });
}
