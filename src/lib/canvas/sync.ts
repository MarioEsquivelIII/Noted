import { createClient as createSupabaseServer } from "@/utils/supabase/server";
import { CanvasClient } from "./client";
import { decrypt } from "./crypto";
import { COURSE_COLOR_PALETTE } from "./constants";
import { geocodeLocation } from "./geocode";
import {
  classifyItemType,
  detectLocationMode,
  type CanvasConnectionRow,
  type CanvasCourseRow,
  type NotedAcademicItem,
  type SyncResult,
  type SyncStats,
} from "./types";

/** Load the Canvas connection and create an authenticated client */
async function loadClient(
  userId: string,
): Promise<{ client: CanvasClient; connection: CanvasConnectionRow } | null> {
  const supabase = await createSupabaseServer();
  const { data: conn } = await supabase
    .from("canvas_connections")
    .select("*")
    .eq("user_id", userId)
    .limit(1)
    .single();

  if (!conn) return null;

  const accessToken = decrypt(conn.access_token_encrypted);
  const refreshToken = decrypt(conn.refresh_token_encrypted);

  return {
    client: new CanvasClient(conn.canvas_domain, accessToken, refreshToken, userId, conn.id),
    connection: conn as CanvasConnectionRow,
  };
}

/** Run the full Canvas sync pipeline */
export async function runCanvasSync(
  userId: string,
  courseFilter?: string[], // optional list of Canvas course IDs to sync
): Promise<SyncResult> {
  const supabase = await createSupabaseServer();
  const loaded = await loadClient(userId);
  if (!loaded) throw new Error("No Canvas connection found");

  const { client, connection } = loaded;
  const stats: SyncStats = { coursesSynced: 0, itemsSynced: 0, itemsNew: 0, itemsUpdated: 0 };

  // Create sync run log
  const { data: syncRun } = await supabase
    .from("canvas_sync_runs")
    .insert({
      user_id: userId,
      connection_id: connection.id,
      status: "running",
    })
    .select("id")
    .single();
  const syncRunId = syncRun?.id;

  try {
    // 1. Fetch courses
    const canvasCourses = await client.getCourses();
    const filteredCourses = courseFilter
      ? canvasCourses.filter((c) => courseFilter.includes(c.id.toString()))
      : canvasCourses;

    // Upsert courses with color assignment
    const existingCourses = await supabase
      .from("canvas_courses")
      .select("canvas_course_id, color")
      .eq("connection_id", connection.id);

    const existingColorMap = new Map(
      (existingCourses.data || []).map((c) => [c.canvas_course_id, c.color]),
    );
    let colorIdx = existingColorMap.size;

    const courseRows = filteredCourses.map((c) => ({
      user_id: userId,
      connection_id: connection.id,
      canvas_course_id: c.id.toString(),
      name: c.name,
      course_code: c.course_code || null,
      term_name: c.term?.name || null,
      start_date: c.start_at ? c.start_at.split("T")[0] : null,
      end_date: c.end_at ? c.end_at.split("T")[0] : null,
      color: existingColorMap.get(c.id.toString()) ||
        COURSE_COLOR_PALETTE[colorIdx++ % COURSE_COLOR_PALETTE.length],
      is_active: true,
    }));

    if (courseRows.length > 0) {
      await supabase
        .from("canvas_courses")
        .upsert(courseRows, { onConflict: "user_id,connection_id,canvas_course_id" });
    }

    // Reload courses to get UUIDs
    const { data: dbCourses } = await supabase
      .from("canvas_courses")
      .select("*")
      .eq("connection_id", connection.id)
      .eq("is_active", true);

    const courseMap = new Map(
      (dbCourses || []).map((c: CanvasCourseRow) => [c.canvas_course_id, c]),
    );
    stats.coursesSynced = courseMap.size;

    // 2. Fetch items for each course
    const allItems: Array<{
      user_id: string;
      connection_id: string;
      course_id: string | null;
      canvas_item_id: string;
      item_type: string;
      title: string;
      description: string | null;
      due_at: string | null;
      start_at: string | null;
      end_at: string | null;
      points_possible: number | null;
      submission_types: string[] | null;
      is_submitted: boolean;
      url: string | null;
      location_raw: string | null;
      location_mode: string;
      location_name: string | null;
      location_lat: number | null;
      location_lng: number | null;
      geocode_confidence: number | null;
      location_requires_review: boolean;
      source: string;
      confidence: number;
      approved: boolean;
    }> = [];

    for (const [canvasCourseId, dbCourse] of courseMap) {
      // Assignments
      try {
        const assignments = await client.getAssignments(canvasCourseId);
        for (const a of assignments) {
          const itemType = classifyItemType(a.name, a.submission_types);
          allItems.push({
            user_id: userId,
            connection_id: connection.id,
            course_id: dbCourse.id,
            canvas_item_id: `assignment_${a.id}`,
            item_type: itemType,
            title: a.name,
            description: a.description || null,
            due_at: a.due_at || null,
            start_at: a.unlock_at || null,
            end_at: a.lock_at || null,
            points_possible: a.points_possible ?? null,
            submission_types: a.submission_types || null,
            is_submitted: a.has_submitted_submissions || false,
            url: a.html_url || null,
            location_raw: null,
            location_mode: "unknown",
            location_name: null,
            location_lat: null,
            location_lng: null,
            geocode_confidence: null,
            location_requires_review: false,
            source: "api",
            confidence: 1.0,
            approved: true,
          });
        }
      } catch (err) {
        console.warn(`Failed to fetch assignments for course ${canvasCourseId}:`, err);
      }

      // Quizzes
      try {
        const quizzes = await client.getQuizzes(canvasCourseId);
        for (const q of quizzes) {
          allItems.push({
            user_id: userId,
            connection_id: connection.id,
            course_id: dbCourse.id,
            canvas_item_id: `quiz_${q.id}`,
            item_type: classifyItemType(q.title, undefined, q.quiz_type, "quiz"),
            title: q.title,
            description: q.description || null,
            due_at: q.due_at || null,
            start_at: q.unlock_at || null,
            end_at: q.lock_at || null,
            points_possible: q.points_possible ?? null,
            submission_types: null,
            is_submitted: false,
            url: q.html_url || null,
            location_raw: null,
            location_mode: "unknown",
            location_name: null,
            location_lat: null,
            location_lng: null,
            geocode_confidence: null,
            location_requires_review: false,
            source: "api",
            confidence: 1.0,
            approved: true,
          });
        }
      } catch (err) {
        console.warn(`Failed to fetch quizzes for course ${canvasCourseId}:`, err);
      }

      // Discussion topics (only graded ones with due dates)
      try {
        const discussions = await client.getDiscussionTopics(canvasCourseId);
        for (const d of discussions) {
          if (!d.assignment?.due_at) continue; // skip ungraded discussions
          allItems.push({
            user_id: userId,
            connection_id: connection.id,
            course_id: dbCourse.id,
            canvas_item_id: `discussion_${d.id}`,
            item_type: "discussion",
            title: d.title,
            description: d.message || null,
            due_at: d.assignment.due_at || null,
            start_at: null,
            end_at: null,
            points_possible: d.assignment.points_possible ?? null,
            submission_types: null,
            is_submitted: false,
            url: d.html_url || null,
            location_raw: null,
            location_mode: "unknown",
            location_name: null,
            location_lat: null,
            location_lng: null,
            geocode_confidence: null,
            location_requires_review: false,
            source: "api",
            confidence: 1.0,
            approved: true,
          });
        }
      } catch (err) {
        console.warn(`Failed to fetch discussions for course ${canvasCourseId}:`, err);
      }
    }

    // 3. Calendar events (across all courses)
    try {
      const contextCodes = Array.from(courseMap.keys()).map((id) => `course_${id}`);
      if (contextCodes.length > 0) {
        const calEvents = await client.getCalendarEvents(contextCodes);
        for (const e of calEvents) {
          const courseIdFromContext = e.context_code?.replace("course_", "") || "";
          const dbCourse = courseMap.get(courseIdFromContext);

          // Geocode location if present
          let locationData = {
            location_raw: e.location_name || null,
            location_mode: "unknown",
            location_name: null as string | null,
            location_lat: null as number | null,
            location_lng: null as number | null,
            geocode_confidence: null as number | null,
            location_requires_review: false,
          };

          if (e.location_name) {
            const geo = await geocodeLocation(e.location_name, e.description);
            locationData = {
              location_raw: e.location_name,
              location_mode: geo.locationMode,
              location_name: geo.mapboxPlaceName || e.location_name,
              location_lat: geo.latitude ?? null,
              location_lng: geo.longitude ?? null,
              geocode_confidence: geo.geocodeConfidence ?? null,
              location_requires_review: geo.requiresReview,
            };
          }

          allItems.push({
            user_id: userId,
            connection_id: connection.id,
            course_id: dbCourse?.id || null,
            canvas_item_id: `cal_event_${e.id}`,
            item_type: classifyItemType(e.title),
            title: e.title,
            description: e.description || null,
            due_at: null,
            start_at: e.start_at || null,
            end_at: e.end_at || null,
            points_possible: null,
            submission_types: null,
            is_submitted: false,
            url: e.html_url || null,
            ...locationData,
            source: "api",
            confidence: 1.0,
            approved: true,
          });
        }
      }
    } catch (err) {
      console.warn("Failed to fetch calendar events:", err);
    }

    // 4. Planner items (catch any remaining items)
    try {
      const plannerItems = await client.getPlannerItems();
      for (const p of plannerItems) {
        // Skip if we already have this item from a specific endpoint
        const existingId = `planner_${p.plannable_id}`;
        const isDuplicate = allItems.some(
          (i) =>
            i.canvas_item_id.endsWith(`_${p.plannable_id}`) &&
            i.item_type !== "other",
        );
        if (isDuplicate) continue;

        const courseIdStr = p.plannable.course_id?.toString() || "";
        const dbCourse = courseMap.get(courseIdStr);

        allItems.push({
          user_id: userId,
          connection_id: connection.id,
          course_id: dbCourse?.id || null,
          canvas_item_id: existingId,
          item_type: classifyItemType(p.plannable.title),
          title: p.plannable.title,
          description: null,
          due_at: p.plannable.due_at || p.plannable_date || null,
          start_at: null,
          end_at: null,
          points_possible: p.plannable.points_possible ?? null,
          submission_types: null,
          is_submitted: p.submissions?.submitted || false,
          url: p.html_url || null,
          location_raw: null,
          location_mode: "unknown",
          location_name: null,
          location_lat: null,
          location_lng: null,
          geocode_confidence: null,
          location_requires_review: false,
          source: "api",
          confidence: 1.0,
          approved: true,
        });
      }
    } catch (err) {
      console.warn("Failed to fetch planner items:", err);
    }

    // 5. Upsert all items
    if (allItems.length > 0) {
      // Check existing items to track new vs updated
      const { data: existing } = await supabase
        .from("canvas_academic_items")
        .select("canvas_item_id, item_type")
        .eq("connection_id", connection.id);

      const existingSet = new Set(
        (existing || []).map((e) => `${e.canvas_item_id}:${e.item_type}`),
      );

      for (const item of allItems) {
        const key = `${item.canvas_item_id}:${item.item_type}`;
        if (existingSet.has(key)) {
          stats.itemsUpdated++;
        } else {
          stats.itemsNew++;
        }
      }

      // Batch upsert (Supabase handles up to ~1000 rows per call)
      const batchSize = 500;
      for (let i = 0; i < allItems.length; i += batchSize) {
        const batch = allItems.slice(i, i + batchSize);
        await supabase
          .from("canvas_academic_items")
          .upsert(batch, { onConflict: "user_id,connection_id,canvas_item_id,item_type" });
      }

      stats.itemsSynced = allItems.length;
    }

    // 6. Update connection last_synced_at
    await supabase
      .from("canvas_connections")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", connection.id);

    // 7. Complete sync run log
    if (syncRunId) {
      await supabase
        .from("canvas_sync_runs")
        .update({
          completed_at: new Date().toISOString(),
          status: "completed",
          courses_synced: stats.coursesSynced,
          items_synced: stats.itemsSynced,
          items_new: stats.itemsNew,
          items_updated: stats.itemsUpdated,
        })
        .eq("id", syncRunId);
    }

    // Convert items to NotedAcademicItem shape for response
    const notedItems: NotedAcademicItem[] = allItems.map((item) => ({
      id: "", // DB will assign
      userId: item.user_id,
      source: "canvas" as const,
      sourceId: item.canvas_item_id,
      sourceCourseId: item.course_id || undefined,
      connectionId: item.connection_id,
      title: item.title,
      description: item.description || undefined,
      type: item.item_type as NotedAcademicItem["type"],
      courseName: item.course_id ? courseMap.get(
        Array.from(courseMap.entries()).find(([, v]) => v.id === item.course_id)?.[0] || "",
      )?.name : undefined,
      courseCode: item.course_id ? courseMap.get(
        Array.from(courseMap.entries()).find(([, v]) => v.id === item.course_id)?.[0] || "",
      )?.course_code || undefined : undefined,
      dueAt: item.due_at || undefined,
      startAt: item.start_at || undefined,
      endAt: item.end_at || undefined,
      pointsPossible: item.points_possible ?? undefined,
      url: item.url || undefined,
      isFixedTime: !!item.start_at && !!item.end_at,
      confidence: item.confidence,
      approved: item.approved,
      isArchived: false,
    }));

    return {
      courses: (dbCourses || []) as CanvasCourseRow[],
      items: notedItems,
      stats,
    };
  } catch (err) {
    // Log failed sync
    if (syncRunId) {
      await supabase
        .from("canvas_sync_runs")
        .update({
          completed_at: new Date().toISOString(),
          status: "failed",
          error_message: err instanceof Error ? err.message : "Unknown error",
        })
        .eq("id", syncRunId);
    }
    throw err;
  }
}
