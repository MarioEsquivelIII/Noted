import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { parseCanvasICalFeed } from "@/lib/planner/ical-parser";
import { classifyAndEstimate } from "@/lib/planner/estimator";
import { hasValidAuth } from "@/lib/planner/scraper/auth";
import { scrapeCanvasCourses, mergeScrapedData } from "@/lib/planner/scraper/scraper";
import { plannerItemToRow, type PlannerItem } from "@/lib/planner/types";
import { enrichWithGTScheduler } from "@/lib/planner/gt-scheduler";
import { generateSeriesId } from "@/lib/recurrence";
import { resolveKnownLocation } from "@/lib/canvas/geocode";
import { generateId } from "@/lib/events";

/**
 * POST /api/planner/ingest
 * Ingest Canvas data via iCal feed and/or Playwright scraping.
 *
 * Supports two modes:
 * 1. iCal feed (if school enables it): Body { icalUrl, canvasDomain? }
 * 2. Playwright scrape (primary for GT): Body { canvasDomain, scrape: true }
 * 3. Both: merges iCal dates with scraped descriptions
 *
 * Many schools (like Georgia Tech) disable iCal feeds and personal tokens.
 * In that case, Playwright scraping is the only automated data source.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { icalUrl, canvasDomain, scrape } = body;

  // Save domain to user profile if provided
  if (canvasDomain) {
    const domain = canvasDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
    await supabase
      .from("user_profiles")
      .update({ canvas_domain: domain })
      .eq("user_id", user.id);
  }

  // Load onboarding profile for workload estimation adjustments
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  let icalItems: PlannerItem[] = [];
  let scrapeStats = { coursesScraped: 0, assignmentsFound: 0, itemsEnriched: 0, itemsAdded: 0 };

  // ─── Path 1: iCal feed (if URL provided) ───
  if (icalUrl) {
    try {
      const rawItems = await parseCanvasICalFeed(icalUrl, user.id);
      icalItems = rawItems.map((item) => classifyAndEstimate(item, profile || undefined));

      // Save iCal URL to profile
      await supabase
        .from("user_profiles")
        .update({ canvas_ical_url: icalUrl })
        .eq("user_id", user.id);
    } catch (error) {
      console.error("iCal ingest error:", error);
      // Don't fail the whole request — fall through to scraping
    }
  }

  // ─── Path 2: Playwright scraping (primary for schools that disable iCal) ───
  const domain = canvasDomain?.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase()
    || profile?.canvas_domain;

  if ((scrape || !icalUrl) && domain) {
    if (!hasValidAuth(user.id)) {
      // If no iCal items either, we have nothing to work with
      if (icalItems.length === 0) {
        return NextResponse.json({
          error: "auth_required",
          message: "Canvas login required. Click 'Log in to Canvas' to authenticate with Playwright, then try again.",
        }, { status: 401 });
      }
      // Otherwise, proceed with iCal items only
    } else {
      try {
        const { courses, error: scrapeError } = await scrapeCanvasCourses(user.id, domain);
        if (!scrapeError && courses.length > 0) {
          const merged = await mergeScrapedData(supabase, user.id, courses);
          scrapeStats = {
            coursesScraped: courses.length,
            assignmentsFound: courses.reduce((sum, c) => sum + c.assignments.length, 0),
            itemsEnriched: merged.enriched,
            itemsAdded: merged.added,
          };
        }
      } catch (error) {
        console.error("Scrape error during ingest:", error);
      }
    }
  }

  // ─── Upsert iCal items to database ───
  let newCount = 0;
  let updatedCount = 0;

  for (const item of icalItems) {
    if (!item.sourceUid) continue;

    const row = plannerItemToRow(item);
    const { data: existing } = await supabase
      .from("planner_items")
      .select("id")
      .eq("user_id", user.id)
      .eq("source", "ical")
      .eq("source_uid", item.sourceUid)
      .single();

    if (existing) {
      const { user_id: __, ...updateFields } = row;
      await supabase
        .from("planner_items")
        .update(updateFields)
        .eq("id", existing.id);
      updatedCount++;
    } else {
      await supabase.from("planner_items").insert(row);
      newCount++;
    }
  }

  // ─── Re-estimate workloads for all items with enriched data ───
  if (scrapeStats.itemsEnriched > 0 || scrapeStats.itemsAdded > 0) {
    const { data: allRows } = await supabase
      .from("planner_items")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_archived", false);

    for (const row of allRows || []) {
      if (row.workload_source === "user") continue;
      const item = {
        ...row,
        itemType: row.item_type,
        userId: row.user_id,
        sourceUid: row.source_uid,
        courseName: row.course_name,
        courseCode: row.course_code,
        dueAt: row.due_at,
        startAt: row.start_at,
        endAt: row.end_at,
        locationRaw: row.location_raw,
        pointsPossible: row.points_possible,
        weightPercent: row.weight_percent,
        submissionTypes: row.submission_types,
        isFixedTime: row.is_fixed_time,
        workloadMinutes: row.workload_minutes,
        workloadSource: row.workload_source,
        isArchived: row.is_archived,
      } as PlannerItem;

      const estimated = classifyAndEstimate(item, profile || undefined);
      if (estimated.workloadMinutes !== item.workloadMinutes) {
        await supabase
          .from("planner_items")
          .update({
            workload_minutes: estimated.workloadMinutes,
            confidence: estimated.confidence,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
      }
    }
  }

  // ─── Enrich with GT Scheduler data (exact building/room/times from Banner 9) ───
  // Only available for Georgia Tech students — silently skipped for other schools
  const isGT = domain?.includes("gatech") || profile?.canvas_domain?.includes("gatech") || profile?.school_name?.toLowerCase()?.includes("georgia tech");

  // Collect unique course codes from all planner items
  const { data: courseCodeRows } = !isGT ? { data: null } : await supabase
    .from("planner_items")
    .select("course_code")
    .eq("user_id", user.id)
    .eq("is_archived", false)
    .not("course_code", "is", null);

  const uniqueCodes = [...new Set((courseCodeRows || []).map((r) => r.course_code).filter(Boolean))];

  if (uniqueCodes.length > 0) {
    try {
      const { classMeetings } = await enrichWithGTScheduler(uniqueCodes as string[]);

      // Check which courses already have lab events on the calendar (user already picked)
      const { data: existingLabEvents } = await supabase
        .from("events")
        .select("title")
        .eq("user_id", user.id)
        .like("title", "% Lab")
        .limit(50);
      const coursesWithLabPicked = new Set<string>();
      for (const ev of existingLabEvents || []) {
        // "CHEM 1310 B08 Lab" → "CHEM 1310"
        const m = (ev.title || "").match(/^([A-Z]+ \d+)/);
        if (m) coursesWithLabPicked.add(m[1]);
      }

      // Create recurring class meeting events in planner_items
      // Lectures are auto-added to calendar. Labs are shown in review for user to pick.
      for (const meeting of classMeetings) {
        // Skip lab planner items if the user already picked a lab for this course
        if (meeting.isLab) {
          const parentMatch = meeting.courseCode.match(/^([A-Z]+ \d+)/);
          if (parentMatch && coursesWithLabPicked.has(parentMatch[1])) {
            continue; // user already picked a lab — don't recreate options
          }
        }
        const sourceUid = `gt-class-${meeting.courseCode}-${meeting.days.join("")}`;
        const sid = generateSeriesId();

        const classItem: PlannerItem = {
          id: "",
          userId: user.id,
          source: "scraper",
          sourceUid,
          title: meeting.title,
          description: `${meeting.isLab ? "Lab/Studio" : "Lecture"} · ${meeting.days.join("/")} ${meeting.startTime}–${meeting.endTime}\nLocation: ${meeting.location}\nInstructor: ${meeting.instructor}`,
          itemType: "class_meeting",
          courseName: meeting.title,
          courseCode: meeting.courseCode,
          startAt: undefined, // recurring — no single start
          endAt: undefined,
          locationRaw: meeting.location,
          status: "todo",
          isFixedTime: true,
          confidence: 1.0,
          workloadSource: "heuristic",
          workloadMinutes: 0,
          isArchived: false,
          rawScraperData: {
            source: "gt-scheduler",
            days: meeting.days,
            startTime: meeting.startTime,
            endTime: meeting.endTime,
            location: meeting.location,
            instructor: meeting.instructor,
            isLab: meeting.isLab,
            seriesId: sid,
          },
        };

        const row = plannerItemToRow(classItem);
        await supabase.from("planner_items").upsert(row, { onConflict: "user_id,source,source_uid" });

        // Create REAL calendar events so classes appear on calendar + map
        // Lectures: auto-add (one per course). Labs: only add to planner_items — user picks in review.
        if (meeting.isLab) continue; // labs stay as planner items for user to pick

        const location = resolveKnownLocation(meeting.location);
        const dayNameToIndex: Record<string, number> = {
          Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
        };
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Check if we already created events for this class (avoid duplicates on re-sync)
        // Check BOTH by series_id AND by title+time (catches old events without series_id)
        const classTitle = meeting.isLab ? `${meeting.courseCode} Lab` : meeting.courseCode;
        const classSeriesId = `class-${meeting.courseCode}-${meeting.days.join("")}`;

        const { data: existingBySeries } = await supabase
          .from("events")
          .select("id")
          .eq("user_id", user.id)
          .eq("series_id", classSeriesId)
          .limit(1);

        const { data: existingByTitle } = await supabase
          .from("events")
          .select("id")
          .eq("user_id", user.id)
          .eq("title", classTitle)
          .eq("start_time", meeting.startTime)
          .limit(1);

        const alreadyExists = (existingBySeries && existingBySeries.length > 0) || (existingByTitle && existingByTitle.length > 0);

        if (!alreadyExists) {
          const classEvents = [];

          for (let week = 0; week < 16; week++) {
            for (const dayName of meeting.days) {
              const dayIdx = dayNameToIndex[dayName];
              if (dayIdx === undefined) continue;

              const d = new Date(today);
              // Find next occurrence of this day of week
              const currentDay = d.getDay();
              const daysUntil = (dayIdx - currentDay + 7) % 7;
              d.setDate(d.getDate() + daysUntil + week * 7);

              // Skip if in the past
              if (d < today) continue;

              const dateStr = d.toISOString().split("T")[0];
              classEvents.push({
                id: generateId(),
                user_id: user.id,
                title: meeting.isLab ? `${meeting.courseCode} Lab` : meeting.courseCode,
                date: dateStr,
                start_time: meeting.startTime,
                end_time: meeting.endTime,
                color: meeting.isLab ? "teal" : "blue",
                all_day: false,
                description: `${meeting.title}\nInstructor: ${meeting.instructor}\nRoom: ${meeting.location}`,
                location_name: location?.name || meeting.location,
                location_lat: location?.lat || null,
                location_lng: location?.lng || null,
                series_id: classSeriesId,
                is_protected: true, // classes are non-negotiable
              });
            }
          }

          // Batch insert all class events
          if (classEvents.length > 0) {
            await supabase.from("events").upsert(classEvents, { onConflict: "id" });
          }
        }
      }
    } catch (error) {
      console.error("GT Scheduler enrichment error:", error);
    }

    // Clean up stale lab planner items from wrong sections
    // (from previous syncs before the section filter was added)
    try {
      const { data: allClassItems } = await supabase
        .from("planner_items")
        .select("id, course_code, raw_scraper_data")
        .eq("user_id", user.id)
        .eq("item_type", "class_meeting")
        .eq("source", "scraper");

      if (allClassItems) {
        // Build lecture letter map from current courses
        const lecLetters: Record<string, string> = {};
        for (const code of uniqueCodes) {
          const clean = (code as string).replace(/-/g, " ").replace(/\s+/g, " ").trim();
          const m = clean.match(/^([A-Z]+)\s*(\d{4})\s+([A-Z])/i);
          if (m && !/L$/i.test(clean.split(/\s+/)[1] || "")) {
            lecLetters[`${m[1].toUpperCase()} ${m[2]}`] = m[3].toUpperCase();
          }
        }

        const staleIds: string[] = [];
        for (const item of allClassItems) {
          const scrData = item.raw_scraper_data as Record<string, unknown> | null;
          if (!scrData?.isLab) continue;
          // Extract parent course from course_code (e.g., "CHEM 1310 A07" → "CHEM 1310", letter "A")
          const cc = (item.course_code || "").replace(/-/g, " ");
          const m = cc.match(/^([A-Z]+)\s*(\d{4})\s+([A-Z])/i);
          if (!m) continue;
          const parentKey = `${m[1].toUpperCase()} ${m[2]}`;
          const labLetter = m[3].toUpperCase();
          const expectedLetter = lecLetters[parentKey];
          if (expectedLetter && labLetter !== expectedLetter) {
            staleIds.push(item.id);
          }
        }

        if (staleIds.length > 0) {
          await supabase.from("planner_items").delete().in("id", staleIds);
          // Also delete any calendar events for these stale labs
          for (const id of staleIds) {
            const item = allClassItems.find((i) => i.id === id);
            if (item?.course_code) {
              await supabase.from("events").delete()
                .eq("user_id", user.id)
                .like("title", `${item.course_code}%`);
            }
          }
        }
      }
    } catch { /* cleanup failed, continue */ }
  }

  // ─── Dedup: remove duplicate calendar events (same title + date + start_time) ───
  try {
    const { data: allEvents } = await supabase
      .from("events")
      .select("id, title, date, start_time")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    if (allEvents && allEvents.length > 0) {
      const seen = new Set<string>();
      const dupeIds: string[] = [];
      for (const ev of allEvents) {
        const key = `${ev.title}|${ev.date}|${ev.start_time}`;
        if (seen.has(key)) {
          dupeIds.push(ev.id);
        } else {
          seen.add(key);
        }
      }
      if (dupeIds.length > 0) {
        // Direct DB delete bypassing the API's protection check — this is server-side cleanup
        await supabase.from("events").delete().in("id", dupeIds).eq("user_id", user.id);
      }
    }
  } catch { /* dedup failed, continue */ }

  // Load all current items to return to the client for review
  // Class meetings (labs, lectures) sort first so they're always visible
  const { data: allItems } = await supabase
    .from("planner_items")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_archived", false)
    .order("item_type", { ascending: true }) // class_meeting sorts before other types
    .order("due_at", { ascending: true })
    .limit(300);

  const items = (allItems || []).map((row: Record<string, unknown>) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    itemType: row.item_type,
    courseName: row.course_name,
    courseCode: row.course_code,
    dueAt: row.due_at,
    startAt: row.start_at,
    endAt: row.end_at,
    pointsPossible: row.points_possible,
    url: row.url,
    status: row.status,
    isFixedTime: row.is_fixed_time,
    workloadMinutes: row.workload_minutes,
    confidence: row.confidence,
    source: row.source,
  }));

  return NextResponse.json({
    success: true,
    stats: {
      ical: { total: icalItems.length, new: newCount, updated: updatedCount },
      scraper: scrapeStats,
    },
    items,
  });
}
