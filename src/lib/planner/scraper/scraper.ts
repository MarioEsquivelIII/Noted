import { classifyItemType } from "@/lib/canvas/types";
import { createAuthenticatedContext, verifyAuth } from "./auth";
import { type ScrapedCourse, type ScrapedAssignment, type PlannerItem, plannerItemToRow } from "../types";
import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Scrape Canvas courses and assignments using Canvas's internal JSON API.
 *
 * Canvas exposes REST endpoints at /api/v1/* that work with session cookies
 * (not just OAuth tokens). Since Playwright has the student's cookies after
 * login, we use the browser's request context to call these APIs directly.
 * This is far more reliable than scraping HTML with CSS selectors, which
 * break across Canvas themes and dashboard layouts.
 */
export async function scrapeCanvasCourses(
  userId: string,
  canvasDomain: string,
): Promise<{ courses: ScrapedCourse[]; error?: string }> {
  const context = await createAuthenticatedContext(userId);
  if (!context) {
    return { courses: [], error: "auth_required" };
  }

  try {
    // Verify auth is still valid
    const isValid = await verifyAuth(context, canvasDomain);
    if (!isValid) {
      return { courses: [], error: "auth_expired" };
    }

    const baseUrl = `https://${canvasDomain}`;

    // We need a page to make fetch requests with the session cookies
    const page = await context.newPage();

    // Navigate to Canvas first to ensure cookies are attached
    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });

    // ─── Paginated fetch helper (Canvas uses Link header pagination) ───
    // Runs inside page.evaluate (browser context) so we use plain JS types
    async function fetchAllPages(browserPage: typeof page, startUrl: string): Promise<Record<string, unknown>[]> {
      const results = await browserPage.evaluate(async (url: string) => {
        const allResults: Record<string, unknown>[] = [];
        let nextUrl: string | null = url;
        let pageCount = 0;

        while (nextUrl && pageCount < 20) {
          const response: Response = await fetch(nextUrl, { credentials: "same-origin" });
          if (!response.ok) break;

          const data: unknown = await response.json();
          if (Array.isArray(data)) {
            allResults.push(...(data as Record<string, unknown>[]));
          } else {
            break;
          }

          // Parse Link header for next page
          const link: string | null = response.headers.get("Link");
          nextUrl = null;
          if (link) {
            const m: RegExpMatchArray | null = link.match(/<([^>]+)>;\s*rel="next"/);
            if (m) nextUrl = m[1];
          }
          pageCount++;
        }
        return allResults;
      }, startUrl);
      return results;
    }

    // ─── Step 1: Get current semester courses only ───
    const allCoursesJson = await fetchAllPages(
      page,
      `${baseUrl}/api/v1/courses?enrollment_state=active&per_page=50&include[]=total_scores&include[]=syllabus_body&include[]=term`
    );

    // Filter to current term only — check term dates or name
    const now = new Date();
    const coursesJson = allCoursesJson.filter((c) => {
      const term = c.term as Record<string, unknown> | undefined;
      // If term has end_at, check if it's still active
      if (term?.end_at) {
        const endDate = new Date(term.end_at as string);
        if (endDate < now) return false; // term already ended
      }
      // If term has start_at, check it started
      if (term?.start_at) {
        const startDate = new Date(term.start_at as string);
        const sixMonthsAgo = new Date(now.getTime() - 180 * 86400000);
        if (startDate < sixMonthsAgo) return false; // started more than 6 months ago
      }
      return true;
    });

    if (coursesJson.length === 0) {
      await page.close();
      return { courses: [], error: undefined };
    }

    const courses: ScrapedCourse[] = [];

    // ─── Step 2: For each course, get ALL assignments (past + present + future) ───
    for (const course of coursesJson) {
      const courseId = String(course.id);
      const courseName = String(course.name || "");
      const courseCode = String(course.course_code || "");

      // Fetch all assignments — no date filter, paginated to get everything
      const assignmentsJson = await fetchAllPages(
        page,
        `${baseUrl}/api/v1/courses/${courseId}/assignments?per_page=100&order_by=due_at&include[]=submission`
      );

      const assignments: ScrapedAssignment[] = [];

      for (const a of assignmentsJson) {
        // Skip unpublished assignments
        if (a.published === false) continue;

        const desc = a.description;
        assignments.push({
          courseId,
          courseName,
          courseCode,
          title: String(a.name || "Untitled"),
          description: typeof desc === "string" && desc ? stripHtmlToText(desc) : undefined,
          pointsPossible: (a.points_possible as number) || undefined,
          dueDate: (a.due_at as string) || undefined,
          submissionTypes: (a.submission_types as string[]) || undefined,
          url: String(a.html_url || `${baseUrl}/courses/${courseId}/assignments/${a.id}`),
          rubricText: undefined,
        });
      }

      // ─── Step 3: Get syllabus/front page text ───
      let syllabusText: string | undefined;
      const syllabusBody = course.syllabus_body;
      if (typeof syllabusBody === "string" && syllabusBody) {
        syllabusText = stripHtmlToText(syllabusBody);
      }

      // Fallback: try to fetch the course front page if no syllabus
      if (!syllabusText || syllabusText.length < 50) {
        try {
          const frontPageData = await page.evaluate(async (args: { url: string; id: string }) => {
            const res = await fetch(`${args.url}/api/v1/courses/${args.id}/front_page`, { credentials: "same-origin" });
            if (!res.ok) return null;
            return res.json();
          }, { url: baseUrl, id: courseId });
          if (frontPageData && typeof frontPageData.body === "string" && frontPageData.body) {
            const frontText = stripHtmlToText(frontPageData.body);
            if (frontText.length > (syllabusText?.length || 0)) {
              syllabusText = frontText;
            }
          }
        } catch { /* front page not available */ }
      }

      courses.push({
        id: courseId,
        name: courseName,
        code: courseCode,
        assignments,
        syllabusText,
      });
    }

    await page.close();
    return { courses };
  } catch (error) {
    console.error("[Scraper] Error:", error);
    return { courses: [], error: error instanceof Error ? error.message : "Unknown scraper error" };
  } finally {
    await context.browser()?.close();
  }
}

/**
 * Merge scraped data into existing planner items in the database.
 * Matches on normalized title + course code.
 */
export async function mergeScrapedData(
  supabase: SupabaseClient,
  userId: string,
  courses: ScrapedCourse[],
): Promise<{ enriched: number; added: number }> {
  let enriched = 0;
  let added = 0;

  for (const course of courses) {
    for (const assignment of course.assignments) {
      const normalizedTitle = normalizeTitle(assignment.title);

      // Try to find an existing iCal item to enrich
      const { data: existing } = await supabase
        .from("planner_items")
        .select("id, source, due_at, start_at, end_at")
        .eq("user_id", userId)
        .ilike("title", `%${normalizedTitle}%`)
        .limit(1)
        .single();

      if (existing) {
        // Enrich existing item with scraped data (descriptions, points, URL)
        // but NEVER overwrite iCal dates — iCal has accurate event times,
        // scraper has Canvas API due dates which are submission deadlines (often 11:59 PM)
        const updates: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
        };
        if (assignment.description) updates.description = assignment.description;
        if (assignment.pointsPossible) updates.points_possible = assignment.pointsPossible;
        if (assignment.url) updates.url = assignment.url;
        if (assignment.submissionTypes) updates.submission_types = assignment.submissionTypes;
        // Only update due_at if the existing item has NO date at all
        if (assignment.dueDate && !existing.due_at && !existing.start_at) {
          updates.due_at = assignment.dueDate;
        }
        updates.course_name = course.name;
        updates.course_code = course.code;
        updates.raw_scraper_data = {
          description: assignment.description?.slice(0, 500),
          scrapedAt: new Date().toISOString(),
        };

        await supabase
          .from("planner_items")
          .update(updates)
          .eq("id", existing.id);

        enriched++;
      } else {
        // Insert as new scraper-sourced item
        const item: PlannerItem = {
          id: "",
          userId,
          source: "scraper",
          sourceUid: `scraper-${course.id}-${normalizedTitle}`,
          title: assignment.title,
          description: assignment.description,
          itemType: classifyItemType(assignment.title, assignment.submissionTypes),
          courseName: course.name,
          courseCode: course.code,
          dueAt: assignment.dueDate || undefined,
          pointsPossible: assignment.pointsPossible,
          url: assignment.url,
          submissionTypes: assignment.submissionTypes,
          status: "todo",
          isFixedTime: false,
          confidence: 0.75,
          workloadSource: "heuristic",
          isArchived: false,
          rawScraperData: {
            description: assignment.description?.slice(0, 500),
            scrapedAt: new Date().toISOString(),
          },
        };

        const row = plannerItemToRow(item);
        // Use upsert to avoid duplicate key errors on re-scrape
        await supabase
          .from("planner_items")
          .upsert(row, { onConflict: "user_id,source,source_uid" });
        added++;
      }
    }

    // Store syllabus text as a special planner item so the AI can reference it
    if (course.syllabusText && course.syllabusText.length > 50) {
      const syllabusItem: PlannerItem = {
        id: "",
        userId,
        source: "scraper",
        sourceUid: `syllabus-${course.id}`,
        title: `${course.code || course.name} Syllabus`,
        description: course.syllabusText.slice(0, 2000), // cap at 2000 chars
        itemType: "other",
        courseName: course.name,
        courseCode: course.code,
        status: "todo",
        isFixedTime: false,
        confidence: 1.0,
        workloadSource: "heuristic",
        isArchived: false,
        rawScraperData: { type: "syllabus", scrapedAt: new Date().toISOString() },
      };
      const row = plannerItemToRow(syllabusItem);
      await supabase.from("planner_items").upsert(row, { onConflict: "user_id,source,source_uid" });
    }
  }

  return { enriched, added };
}

// ─── Helpers ───

function stripHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#?\w+;/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/^\[.*?\]\s*/, "")
    .replace(/\s*\(due.*?\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}
