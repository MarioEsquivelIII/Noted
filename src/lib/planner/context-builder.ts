import { type PlannerItem, rowToPlannerItem } from "./types";
import { computeUrgency } from "./estimator";
import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Build a rich planning context string for the AI system prompt.
 *
 * Includes:
 * - Course list with syllabi summaries
 * - Upcoming deadlines with workload estimates and urgency
 * - Assignment descriptions (for RAG-style Q&A about course content)
 * - Fixed events (classes, meetings)
 * - Scheduling guidelines
 *
 * The AI can use this to answer questions like "what's on the CHEM 1310 syllabus?"
 * or "tell me about Project 4 for CS-3451" without needing another API call.
 */
export async function buildPlannerContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  // Load ALL non-archived planner items (not just future — past items give course context)
  const { data: rows, error } = await supabase
    .from("planner_items")
    .select("*")
    .eq("user_id", userId)
    .eq("is_archived", false)
    .order("due_at", { ascending: true })
    .limit(200);

  if (error || !rows || rows.length === 0) return null;

  const items: PlannerItem[] = rows.map(rowToPlannerItem);
  const now = new Date();

  // Group by course
  const byCourse: Record<string, PlannerItem[]> = {};
  for (const item of items) {
    const key = item.courseCode || item.courseName || "Other";
    if (!byCourse[key]) byCourse[key] = [];
    byCourse[key].push(item);
  }

  let ctx = "Academic context (from Canvas LMS data):\n";

  // ─── Courses overview ───
  ctx += "\n## Courses\n";
  for (const [courseKey, courseItems] of Object.entries(byCourse)) {
    const futureCount = courseItems.filter((i) => i.dueAt && new Date(i.dueAt) > now).length;
    const totalPoints = courseItems.reduce((sum, i) => sum + (i.pointsPossible || 0), 0);
    ctx += `- ${courseKey}: ${courseItems.length} items total, ${futureCount} upcoming`;
    if (totalPoints > 0) ctx += `, ${totalPoints} total points`;
    ctx += "\n";
  }

  // ─── Upcoming deadlines (next 28 days) with urgency ───
  const upcoming = items
    .filter((i) => i.dueAt && !i.isFixedTime && new Date(i.dueAt) > now && new Date(i.dueAt) < new Date(now.getTime() + 28 * 86400000))
    .sort((a, b) => (a.dueAt || "").localeCompare(b.dueAt || ""));

  if (upcoming.length > 0) {
    ctx += "\n## Upcoming deadlines\n";
    for (const item of upcoming) {
      const dueDate = new Date(item.dueAt!).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      const course = item.courseCode ? `${item.courseCode}: ` : "";
      const workload = item.workloadMinutes ? ` (~${Math.round(item.workloadMinutes / 60 * 10) / 10}h est.)` : "";
      const points = item.pointsPossible ? ` [${item.pointsPossible}pts]` : "";
      const urgency = computeUrgency(item);
      const urgencyTag = urgency > 0.8 ? " **URGENT**" : urgency > 0.6 ? " *soon*" : "";
      ctx += `- ${course}${item.title} — due ${dueDate}${points}${workload} (${item.itemType})${urgencyTag}\n`;
    }
  }

  // ─── Assignment details (RAG context — descriptions, rubrics) ───
  // Include descriptions for items the user is likely to ask about (upcoming + high-value)
  const withDetails = items.filter((i) => i.description && i.description.length > 20);
  if (withDetails.length > 0) {
    ctx += "\n## Assignment details (for answering specific questions)\n";
    // Limit to ~30 items to avoid context overflow, prioritize upcoming
    const sorted = [...withDetails].sort((a, b) => {
      const aFuture = a.dueAt && new Date(a.dueAt) > now ? 0 : 1;
      const bFuture = b.dueAt && new Date(b.dueAt) > now ? 0 : 1;
      if (aFuture !== bFuture) return aFuture - bFuture;
      return (b.pointsPossible || 0) - (a.pointsPossible || 0);
    });

    for (const item of sorted.slice(0, 30)) {
      const course = item.courseCode || item.courseName || "";
      // Truncate long descriptions to keep context manageable
      const desc = item.description!.length > 300 ? item.description!.slice(0, 300) + "..." : item.description!;
      ctx += `\n### ${course ? course + ": " : ""}${item.title}\n`;
      if (item.dueAt) ctx += `Due: ${new Date(item.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}\n`;
      if (item.pointsPossible) ctx += `Points: ${item.pointsPossible}\n`;
      ctx += `Type: ${item.itemType}\n`;
      ctx += `Description: ${desc}\n`;
    }
  }

  // ─── Class meeting schedule (from GT Scheduler / Banner 9) ───
  const classMeetings = items.filter((i) => i.itemType === "class_meeting" && i.rawScraperData);
  if (classMeetings.length > 0) {
    ctx += "\n## Weekly class schedule (from GT Banner registration system — exact times)\n";
    for (const item of classMeetings) {
      const data = item.rawScraperData as Record<string, unknown>;
      if (data?.source === "gt-scheduler") {
        const days = (data.days as string[])?.join("/") || "";
        ctx += `- ${item.courseCode}: ${days} ${data.startTime}-${data.endTime} @ ${data.location}`;
        if (data.instructor) ctx += ` (${data.instructor})`;
        ctx += "\n";
      }
    }
    ctx += "These are exact class times from the GT registration system. NEVER suggest scheduling over these.\n";
  }

  // ─── Scheduling instructions ───
  ctx += "\n## Scheduling guidelines\n";
  ctx += "- The user is a college student. All data above comes from their Canvas LMS.\n";
  ctx += "- Workload estimates are heuristic approximations. Ask the student if unsure.\n";
  ctx += "- When scheduling study time, place work blocks BEFORE deadlines, not on the due date.\n";
  ctx += "- Respect existing calendar events and class times.\n";
  ctx += "- For urgent items (marked URGENT), recommend starting today.\n";
  ctx += "- If the user asks about a specific assignment, syllabus, or course details, use the assignment details section above.\n";
  ctx += "- If the user asks you to build their schedule, use the deadlines, workload estimates, and their onboarding preferences to suggest realistic study blocks.\n";

  return ctx;
}
