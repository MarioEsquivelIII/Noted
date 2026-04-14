import { NextResponse } from "next/server";
import { createClient as createSupabaseServer } from "@/utils/supabase/server";
import { CanvasClient } from "@/lib/canvas/client";
import { decrypt } from "@/lib/canvas/crypto";
import { extractMeetingsFromText } from "@/lib/canvas/syllabus";
import { geocodeLocation } from "@/lib/canvas/geocode";
import type { CanvasCourseRow, InferredMeeting } from "@/lib/canvas/types";

export async function POST(req: Request) {
  const supabase = await createSupabaseServer();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { courseId } = await req.json();
  if (!courseId) {
    return NextResponse.json({ error: "courseId is required" }, { status: 400 });
  }

  // Load course and connection
  const { data: course } = await supabase
    .from("canvas_courses")
    .select("*, canvas_connections(*)")
    .eq("id", courseId)
    .eq("user_id", user.id)
    .single();

  if (!course) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  const conn = (course as Record<string, unknown>).canvas_connections as Record<string, string>;
  const accessToken = decrypt(conn.access_token_encrypted);
  const refreshToken = decrypt(conn.refresh_token_encrypted);

  const client = new CanvasClient(
    conn.canvas_domain,
    accessToken,
    refreshToken,
    user.id,
    conn.id,
  );

  // Fetch syllabus and front page
  const [syllabusHtml, frontPageHtml] = await Promise.all([
    client.getCourseSyllabus(course.canvas_course_id),
    client.getCourseFrontPage(course.canvas_course_id),
  ]);

  const combinedHtml = [syllabusHtml, frontPageHtml].filter(Boolean).join("\n\n");
  if (!combinedHtml) {
    return NextResponse.json({ meetings: [], message: "No syllabus or homepage content found" });
  }

  // Extract meetings via LLM
  const extracted = await extractMeetingsFromText(
    course.name,
    course.course_code || "",
    combinedHtml,
  );

  if (extracted.length === 0) {
    // Mark course as extracted (even if nothing found)
    await supabase
      .from("canvas_courses")
      .update({ syllabus_extracted: true })
      .eq("id", courseId);
    return NextResponse.json({ meetings: [], message: "No meeting information found in syllabus" });
  }

  // Geocode locations and store as inferred meetings
  const meetings: InferredMeeting[] = [];
  for (const m of extracted) {
    let locationData = {
      location_raw: m.locationText || null,
      location_mode: m.locationMode,
      location_name: null as string | null,
      location_lat: null as number | null,
      location_lng: null as number | null,
      geocode_confidence: null as number | null,
      location_requires_review: false,
    };

    if (m.locationText && m.locationMode !== "remote") {
      const geo = await geocodeLocation(m.locationText);
      locationData = {
        location_raw: m.locationText,
        location_mode: geo.locationMode,
        location_name: geo.mapboxPlaceName || m.locationText,
        location_lat: geo.latitude ?? null,
        location_lng: geo.longitude ?? null,
        geocode_confidence: geo.geocodeConfidence ?? null,
        location_requires_review: geo.requiresReview,
      };
    }

    const row = {
      user_id: user.id,
      course_id: courseId,
      meeting_type: m.meetingType,
      title: m.title || `${course.course_code || course.name} ${m.meetingType}`,
      days_of_week: m.days,
      start_time: m.startTime,
      end_time: m.endTime,
      location_raw: locationData.location_raw,
      location_mode: locationData.location_mode,
      location_name: locationData.location_name,
      location_lat: locationData.location_lat,
      location_lng: locationData.location_lng,
      geocode_confidence: locationData.geocode_confidence,
      location_requires_review: locationData.location_requires_review,
      instructor_name: m.instructorName || null,
      effective_start_date: course.start_date || null,
      effective_end_date: course.end_date || null,
      source_text: m.sourceSnippet || null,
      confidence: m.confidence,
      approved: false,
      events_generated: false,
    };

    const { data: inserted } = await supabase
      .from("canvas_inferred_meetings")
      .upsert(row)
      .select("id")
      .single();

    meetings.push({
      id: inserted?.id || "",
      userId: user.id,
      courseId,
      courseName: course.name,
      courseCode: course.course_code,
      meetingType: m.meetingType,
      title: row.title,
      daysOfWeek: m.days,
      startTime: m.startTime,
      endTime: m.endTime,
      locationRaw: locationData.location_raw || undefined,
      locationMode: locationData.location_mode as InferredMeeting["locationMode"],
      locationName: locationData.location_name || undefined,
      locationLat: locationData.location_lat ?? undefined,
      locationLng: locationData.location_lng ?? undefined,
      geocodeConfidence: locationData.geocode_confidence ?? undefined,
      locationRequiresReview: locationData.location_requires_review,
      instructorName: m.instructorName || undefined,
      effectiveStartDate: course.start_date || undefined,
      effectiveEndDate: course.end_date || undefined,
      sourceText: m.sourceSnippet || undefined,
      confidence: m.confidence,
      approved: false,
      eventsGenerated: false,
    });
  }

  // Mark course syllabus as extracted
  await supabase
    .from("canvas_courses")
    .update({ syllabus_extracted: true })
    .eq("id", courseId);

  return NextResponse.json({ meetings });
}
