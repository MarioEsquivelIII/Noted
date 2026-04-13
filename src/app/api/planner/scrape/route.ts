import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { hasValidAuth } from "@/lib/planner/scraper/auth";
import { scrapeCanvasCourses, mergeScrapedData } from "@/lib/planner/scraper/scraper";
import { classifyAndEstimate } from "@/lib/planner/estimator";
import { rowToPlannerItem, plannerItemToRow } from "@/lib/planner/types";

/**
 * POST /api/planner/scrape
 * Trigger Playwright scrape of Canvas courses and assignments.
 * Merges scraped data with existing planner items.
 * Body: { canvasDomain?: string }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get Canvas domain from request or profile
  const body = await req.json().catch(() => ({}));
  let domain = body.canvasDomain;

  if (!domain) {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("canvas_domain")
      .eq("user_id", user.id)
      .single();

    domain = profile?.canvas_domain;
  }

  if (!domain) {
    return NextResponse.json(
      { error: "Canvas domain not configured. Set it in your profile." },
      { status: 400 },
    );
  }

  domain = domain.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();

  // Check auth state
  if (!hasValidAuth(user.id)) {
    return NextResponse.json(
      { error: "auth_required", message: "Please authenticate with Canvas first via POST /api/planner/auth" },
      { status: 401 },
    );
  }

  try {
    // Scrape Canvas
    const { courses, error: scrapeError } = await scrapeCanvasCourses(user.id, domain);

    if (scrapeError === "auth_required" || scrapeError === "auth_expired") {
      return NextResponse.json(
        { error: scrapeError, message: "Canvas auth is missing or expired. Please re-authenticate." },
        { status: 401 },
      );
    }

    if (scrapeError) {
      return NextResponse.json({ error: scrapeError }, { status: 500 });
    }

    // Merge scraped data with existing planner items
    const { enriched, added } = await mergeScrapedData(supabase, user.id, courses);

    // Re-run workload estimation on enriched items
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("user_id", user.id)
      .single();

    const { data: itemRows } = await supabase
      .from("planner_items")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_archived", false);

    let reEstimated = 0;
    for (const row of itemRows || []) {
      const item = rowToPlannerItem(row);
      if (item.workloadSource === "user") continue; // don't override user estimates
      const estimated = classifyAndEstimate(item, profile || undefined);
      if (estimated.workloadMinutes !== item.workloadMinutes) {
        await supabase
          .from("planner_items")
          .update({
            workload_minutes: estimated.workloadMinutes,
            confidence: estimated.confidence,
            updated_at: new Date().toISOString(),
          })
          .eq("id", item.id);
        reEstimated++;
      }
    }

    return NextResponse.json({
      success: true,
      stats: {
        coursesScraped: courses.length,
        assignmentsFound: courses.reduce((sum, c) => sum + c.assignments.length, 0),
        itemsEnriched: enriched,
        itemsAdded: added,
        estimatesUpdated: reEstimated,
      },
    });
  } catch (error) {
    console.error("[Scraper] Error:", error);
    return NextResponse.json(
      { error: "Scraping failed", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
