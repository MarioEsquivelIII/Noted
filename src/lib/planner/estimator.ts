import { type AcademicItemType } from "@/lib/canvas/types";
import { type OnboardingProfile } from "@/lib/onboarding";
import { type PlannerItem, type WorkloadEstimate } from "./types";

// ─── Base workload estimates by item type (minutes) ───

const BASE_ESTIMATES: Record<AcademicItemType, number> = {
  assignment: 120,
  quiz: 45,
  exam: 240,
  project: 480,
  lab: 90,
  discussion: 30,
  reading: 60,
  class_meeting: 0,  // fixed-time, no work estimate needed
  office_hours: 0,
  event: 0,
  other: 60,
};

// ─── Keywords that adjust workload ───

const DESCRIPTION_MULTIPLIERS: { pattern: RegExp; multiplier: number; label: string }[] = [
  { pattern: /\b(paper|essay|write|writing|report)\b/i, multiplier: 1.5, label: "writing-heavy" },
  { pattern: /\b(presentation|present|slide|demo)\b/i, multiplier: 1.3, label: "presentation" },
  { pattern: /\b(group|team|partner|collaborate)\b/i, multiplier: 1.3, label: "group work" },
  { pattern: /\b(research|literature\s+review|annotated)\b/i, multiplier: 1.4, label: "research-heavy" },
  { pattern: /\b(coding|program|implement|code)\b/i, multiplier: 1.3, label: "coding required" },
  { pattern: /\b(short|brief|quick|mini)\b/i, multiplier: 0.6, label: "described as short" },
  { pattern: /\b(major|comprehensive|extensive|final)\b/i, multiplier: 1.5, label: "described as major" },
];

/**
 * Estimate the workload for a single planner item.
 * Uses rule-based heuristics with transparent reasoning.
 */
export function estimateWorkload(
  item: PlannerItem,
  profile?: OnboardingProfile | null,
): WorkloadEstimate {
  const base = BASE_ESTIMATES[item.itemType] || 60;
  let adjusted = base;
  const reasons: string[] = [];
  const questions: string[] = [];

  // ─── Points-based adjustments ───
  if (item.pointsPossible) {
    if (item.pointsPossible > 200) {
      adjusted *= 2.0;
      reasons.push(`high-point value (${item.pointsPossible} pts)`);
    } else if (item.pointsPossible > 100) {
      adjusted *= 1.5;
      reasons.push(`above-average points (${item.pointsPossible} pts)`);
    } else if (item.pointsPossible < 20) {
      adjusted *= 0.7;
      reasons.push(`low-point value (${item.pointsPossible} pts)`);
    }
  }

  // ─── Grade weight adjustments ───
  if (item.weightPercent) {
    if (item.weightPercent > 25) {
      adjusted *= 2.0;
      reasons.push(`heavy grade weight (${item.weightPercent}%)`);
    } else if (item.weightPercent > 15) {
      adjusted *= 1.5;
      reasons.push(`significant grade weight (${item.weightPercent}%)`);
    }
  }

  // ─── Description/title keyword adjustments ───
  const textToAnalyze = `${item.title} ${item.description || ""}`;
  for (const { pattern, multiplier, label } of DESCRIPTION_MULTIPLIERS) {
    if (pattern.test(textToAnalyze)) {
      adjusted *= multiplier;
      reasons.push(label);
    }
  }

  // ─── Urgency: less time remaining = need larger sessions ───
  if (item.dueAt) {
    const daysUntilDue = (new Date(item.dueAt).getTime() - Date.now()) / 86400000;
    if (daysUntilDue < 1) {
      reasons.push("due very soon — prioritize immediately");
    } else if (daysUntilDue < 3) {
      reasons.push("due within 3 days");
    }
  }

  // ─── Student preference adjustments ───
  if (profile) {
    if (profile.session_style === "short") {
      adjusted *= 1.1; // overhead from context switching
      reasons.push("adjusted for short-session preference (+10%)");
    } else if (profile.session_style === "deep_work") {
      adjusted *= 0.9; // efficiency from focused sessions
      reasons.push("adjusted for deep-work efficiency (-10%)");
    }

    if (profile.time_struggles?.includes("underestimating_time")) {
      adjusted *= 1.25;
      reasons.push("buffer added (user tends to underestimate)");
    }
  }

  // ─── Confidence assessment ───
  let confidence = 0.7; // default moderate confidence

  if (item.description && item.description.length > 100) {
    confidence += 0.15; // richer description = better estimate
  }
  if (item.pointsPossible) {
    confidence += 0.05; // points give us a signal
  }
  if (item.weightPercent) {
    confidence += 0.05;
  }

  // Cap confidence
  confidence = Math.min(confidence, 0.95);

  // ─── Low confidence → generate student questions ───
  if (confidence < 0.6) {
    questions.push(`How long do you think "${item.title}" will take?`);
    questions.push(`Is this assignment easy, medium, or hard for you?`);
  } else if (confidence < 0.75 && !item.description) {
    questions.push(`We don't have details for "${item.title}". Is it a quick task or a bigger one?`);
  }

  // Round to nearest 15 minutes
  adjusted = Math.round(adjusted / 15) * 15;
  adjusted = Math.max(15, adjusted); // minimum 15 minutes

  return {
    itemType: item.itemType,
    baseMinutes: base,
    adjustedMinutes: adjusted,
    confidence,
    reasoning: reasons.length > 0
      ? `Base: ${base} min for ${item.itemType}. Adjustments: ${reasons.join(", ")}.`
      : `Base: ${base} min for ${item.itemType}. No additional adjustments.`,
    studentQuestions: questions.length > 0 ? questions : undefined,
  };
}

/**
 * Classify item type (if not set) and attach workload estimate.
 * Returns a new PlannerItem with workloadMinutes populated.
 */
export function classifyAndEstimate(
  item: PlannerItem,
  profile?: OnboardingProfile | null,
): PlannerItem {
  // Skip estimation for fixed-time events (classes, meetings)
  if (item.isFixedTime) {
    return { ...item, workloadMinutes: 0 };
  }

  // Don't override user-provided estimates
  if (item.workloadSource === "user" && item.workloadMinutes) {
    return item;
  }

  const estimate = estimateWorkload(item, profile);

  return {
    ...item,
    workloadMinutes: estimate.adjustedMinutes,
    workloadSource: "heuristic",
    confidence: estimate.confidence,
  };
}

/**
 * Compute urgency score (0-1) for a planner item based on
 * due date proximity and estimated workload.
 */
export function computeUrgency(item: PlannerItem): number {
  if (!item.dueAt) return 0.3; // no deadline = moderate baseline

  const hoursUntilDue = (new Date(item.dueAt).getTime() - Date.now()) / 3600000;
  const workHoursNeeded = (item.workloadMinutes || 60) / 60;

  // Ratio of work needed vs time available
  const workRatio = workHoursNeeded / Math.max(hoursUntilDue, 1);

  if (hoursUntilDue < 0) return 1.0;      // overdue
  if (hoursUntilDue < 24) return 0.95;     // due today
  if (workRatio > 0.5) return 0.9;         // tight timeline
  if (hoursUntilDue < 72) return 0.7;      // due within 3 days
  if (hoursUntilDue < 168) return 0.5;     // due within a week
  return 0.3;                               // plenty of time
}

/**
 * Compute priority score combining urgency, grade weight, and points.
 */
export function computePriority(item: PlannerItem): number {
  let priority = computeUrgency(item);

  // Boost for high-stakes items
  if (item.itemType === "exam") priority = Math.min(priority + 0.2, 1.0);
  if (item.itemType === "project") priority = Math.min(priority + 0.1, 1.0);
  if (item.weightPercent && item.weightPercent > 20) priority = Math.min(priority + 0.15, 1.0);
  if (item.pointsPossible && item.pointsPossible > 100) priority = Math.min(priority + 0.1, 1.0);

  return Math.round(priority * 100) / 100;
}
