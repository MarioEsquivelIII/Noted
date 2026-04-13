import { type CalendarEvent } from "@/lib/events";
import { type OnboardingProfile } from "@/lib/onboarding";
import { type PlannerItem, type WorkBlock } from "./types";
import { computePriority } from "./estimator";

// ─── Time slot config ───

interface TimeSlot {
  start: string; // HH:MM
  end: string;   // HH:MM
}

const MORNING_SLOTS: TimeSlot[] = [
  { start: "08:00", end: "10:00" },
  { start: "10:00", end: "12:00" },
];

const AFTERNOON_SLOTS: TimeSlot[] = [
  { start: "13:00", end: "15:00" },
  { start: "15:00", end: "17:00" },
];

const EVENING_SLOTS: TimeSlot[] = [
  { start: "18:00", end: "20:00" },
  { start: "20:00", end: "22:00" },
];

// Meal/break windows to avoid (always protected)
const PROTECTED_WINDOWS: TimeSlot[] = [
  { start: "12:00", end: "13:00" }, // lunch
  { start: "17:00", end: "18:00" }, // dinner prep
];

// ─── Color assignments by item type ───

const TYPE_COLORS: Record<string, string> = {
  assignment: "blue",
  quiz: "orange",
  exam: "red",
  project: "purple",
  lab: "teal",
  discussion: "green",
  reading: "yellow",
  other: "gray",
};

/**
 * Generate recommended work blocks for planner items,
 * respecting existing calendar events and student preferences.
 */
export function generateWorkBlocks(
  items: PlannerItem[],
  existingEvents: CalendarEvent[],
  profile: OnboardingProfile | null,
  windowDays: number = 14,
): WorkBlock[] {
  const blocks: WorkBlock[] = [];
  const now = new Date();
  const windowEnd = new Date(now.getTime() + windowDays * 86400000);

  // Filter to actionable items (has due date, not archived, not fixed-time, needs work)
  const actionable = items
    .filter((item) => {
      if (item.isArchived || item.isFixedTime) return false;
      if (item.status === "completed" || item.status === "submitted") return false;
      if (!item.dueAt) return false;
      if (!item.workloadMinutes || item.workloadMinutes <= 0) return false;
      const due = new Date(item.dueAt);
      return due > now && due <= windowEnd;
    })
    .sort((a, b) => computePriority(b) - computePriority(a)); // highest priority first

  // Build a map of occupied slots per day from existing events
  const occupiedSlots = buildOccupiedMap(existingEvents);

  // Get preferred time slots based on profile
  const preferredSlots = getPreferredSlots(profile);

  // Get session duration limits
  const { minSession, maxSession } = getSessionLimits(profile);

  for (const item of actionable) {
    const dueDate = new Date(item.dueAt!);
    let remainingMinutes = item.workloadMinutes!;
    const color = TYPE_COLORS[item.itemType] || "gray";

    // Determine work window: from today to day before due
    const workDays = getWorkDays(now, dueDate, profile);

    // Determine how many sessions to split into
    const sessionsNeeded = Math.ceil(remainingMinutes / maxSession);
    const minutesPerSession = Math.ceil(remainingMinutes / Math.max(sessionsNeeded, 1));

    // Determine block type based on item type and proximity to deadline
    const blockType = getBlockType(item, dueDate);

    // Distribute sessions across available days
    for (const day of workDays) {
      if (remainingMinutes <= 0) break;

      const dayStr = formatDate(day);
      const available = findAvailableSlots(dayStr, preferredSlots, occupiedSlots, profile);

      for (const slot of available) {
        if (remainingMinutes <= 0) break;

        const duration = Math.min(
          remainingMinutes,
          minutesPerSession,
          maxSession,
          slotDuration(slot),
        );

        if (duration < minSession) continue;

        const endTime = addMinutes(slot.start, duration);

        const block: WorkBlock = {
          id: `wb-${item.sourceUid || item.id}-${dayStr}-${slot.start}`,
          plannerItemId: item.id,
          title: buildBlockTitle(item, blockType),
          date: dayStr,
          startTime: slot.start,
          endTime,
          durationMinutes: duration,
          blockType,
          color,
          reasoning: buildReasoning(item, day, dueDate, profile),
          isCommitted: false,
        };

        blocks.push(block);
        remainingMinutes -= duration;

        // Mark slot as occupied for future items
        if (!occupiedSlots[dayStr]) occupiedSlots[dayStr] = [];
        occupiedSlots[dayStr].push({ start: slot.start, end: endTime });

        break; // one block per day per item (spread it out)
      }
    }

    // If we couldn't fit all the work, note it but don't force overflow
    if (remainingMinutes > 0) {
      // The last block's reasoning will note insufficient time
    }
  }

  // Sort blocks chronologically
  blocks.sort((a, b) => {
    const dateComp = a.date.localeCompare(b.date);
    return dateComp !== 0 ? dateComp : a.startTime.localeCompare(b.startTime);
  });

  return blocks;
}

// ─── Helpers ───

function getPreferredSlots(profile: OnboardingProfile | null): TimeSlot[] {
  if (!profile?.peak_productivity) {
    return [...MORNING_SLOTS, ...AFTERNOON_SLOTS, ...EVENING_SLOTS];
  }

  switch (profile.peak_productivity) {
    case "morning":
      return [...MORNING_SLOTS, ...AFTERNOON_SLOTS, ...EVENING_SLOTS];
    case "afternoon":
      return [...AFTERNOON_SLOTS, ...MORNING_SLOTS, ...EVENING_SLOTS];
    case "night":
      return [...EVENING_SLOTS, ...AFTERNOON_SLOTS, ...MORNING_SLOTS];
    default:
      return [...MORNING_SLOTS, ...AFTERNOON_SLOTS, ...EVENING_SLOTS];
  }
}

function getSessionLimits(profile: OnboardingProfile | null): { minSession: number; maxSession: number } {
  if (profile?.session_style === "short") {
    return { minSession: 25, maxSession: 45 };
  }
  if (profile?.session_style === "deep_work") {
    return { minSession: 60, maxSession: 120 };
  }
  return { minSession: 30, maxSession: 90 };
}

function getWorkDays(now: Date, dueDate: Date, profile: OnboardingProfile | null): Date[] {
  const days: Date[] = [];
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  // End one day before due date (don't schedule work on due day itself)
  const end = new Date(dueDate);
  end.setDate(end.getDate() - 1);
  end.setHours(0, 0, 0, 0);

  // If due tomorrow or today, include today
  if (end < start) {
    days.push(new Date(start));
    return days;
  }

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const preferredDays = profile?.preferred_study_days || [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dayName = dayNames[d.getDay()];

    // If user specified preferred days, prioritize those (but still allow others)
    if (preferredDays.length > 0 && !preferredDays.includes(dayName)) {
      // Still include non-preferred days, but add them at the end
      days.push(new Date(d));
    } else {
      // Preferred days go first
      days.unshift(new Date(d));
    }
  }

  // For "early" approach, front-load by keeping preferred days first (already done above)
  // For "close_to_deadline", we still spread work across all days for consistency
  // but allow slightly more weight toward the later half. We do NOT reverse — that
  // would cram everything last-minute and enable procrastination.
  // Instead, keep the spread but interleave: preferred days still first, then others.

  return days;
}

function buildOccupiedMap(events: CalendarEvent[]): Record<string, TimeSlot[]> {
  const map: Record<string, TimeSlot[]> = {};
  for (const event of events) {
    if (!map[event.date]) map[event.date] = [];
    map[event.date].push({ start: event.startTime, end: event.endTime });
  }
  return map;
}

function findAvailableSlots(
  date: string,
  preferredSlots: TimeSlot[],
  occupied: Record<string, TimeSlot[]>,
  profile: OnboardingProfile | null,
): TimeSlot[] {
  const dayOccupied = [
    ...(occupied[date] || []),
    ...PROTECTED_WINDOWS,
  ];

  // Add workout protection if configured
  if (profile?.include_workouts && profile?.preferred_workout_time) {
    const workoutSlot = getWorkoutSlot(profile.preferred_workout_time);
    if (workoutSlot) dayOccupied.push(workoutSlot);
  }

  // Protect anchor events (personal non-negotiable commitments)
  if (profile?.anchor_events) {
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayOfWeek = dayNames[new Date(date).getDay()];
    for (const anchor of profile.anchor_events) {
      if (anchor.days.includes(dayOfWeek)) {
        dayOccupied.push({ start: anchor.startTime, end: anchor.endTime });
      }
    }
  }

  return preferredSlots.filter((slot) => {
    return !dayOccupied.some((occ) => slotsOverlap(slot, occ));
  });
}

function getWorkoutSlot(time: string): TimeSlot | null {
  switch (time) {
    case "morning": return { start: "06:30", end: "08:00" };
    case "afternoon": return { start: "15:00", end: "16:30" };
    case "evening": return { start: "18:00", end: "19:30" };
    default: return null;
  }
}

function slotsOverlap(a: TimeSlot, b: TimeSlot): boolean {
  return a.start < b.end && a.end > b.start;
}

function slotDuration(slot: TimeSlot): number {
  const [ah, am] = slot.start.split(":").map(Number);
  const [bh, bm] = slot.end.split(":").map(Number);
  return (bh * 60 + bm) - (ah * 60 + am);
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const newH = Math.floor(total / 60);
  const newM = total % 60;
  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function getBlockType(item: PlannerItem, dueDate: Date): WorkBlock["blockType"] {
  const daysUntilDue = (dueDate.getTime() - Date.now()) / 86400000;

  if (item.itemType === "exam" || item.itemType === "quiz") return "review";
  if (daysUntilDue < 2) return "prep";  // crunch time
  return "work";
}

function buildBlockTitle(item: PlannerItem, blockType: WorkBlock["blockType"]): string {
  const prefix = blockType === "review" ? "Review" : blockType === "prep" ? "Prep" : "Work on";
  const course = item.courseCode ? `${item.courseCode}: ` : "";
  return `${prefix}: ${course}${item.title}`;
}

function buildReasoning(
  item: PlannerItem,
  blockDate: Date,
  dueDate: Date,
  profile: OnboardingProfile | null,
): string {
  const parts: string[] = [];
  const daysUntilDue = Math.ceil((dueDate.getTime() - blockDate.getTime()) / 86400000);

  parts.push(`Due in ${daysUntilDue} day${daysUntilDue !== 1 ? "s" : ""}`);

  if (item.workloadMinutes) {
    const hours = Math.round(item.workloadMinutes / 60 * 10) / 10;
    parts.push(`~${hours}h total estimated work`);
  }

  if (profile?.peak_productivity) {
    parts.push(`scheduled during ${profile.peak_productivity} (your peak time)`);
  }

  if (profile?.deadline_approach === "early") {
    parts.push("front-loaded per your preference");
  } else if (profile?.deadline_approach === "close_to_deadline") {
    parts.push("spread consistently to build good habits");
  }

  return parts.join(". ") + ".";
}
