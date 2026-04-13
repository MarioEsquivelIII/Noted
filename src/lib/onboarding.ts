// Onboarding types, defaults, and personalization prompt builder

// ─── User Settings (feature toggles — stored in extra_preferences.settings) ───

export interface UserSettings {
  /** Auto-sync Canvas data when opening the app */
  autoSyncCanvas: boolean;
  /** AI can directly add events to calendar (vs suggest-only mode) */
  aiDirectCalendarAccess: boolean;
  /** Show anchor events on the calendar */
  showAnchorEventsOnCalendar: boolean;
  /** AI can manage anchor events via chat */
  aiCanManageAnchors: boolean;
  /** Include workload estimates in AI context */
  includeWorkloadEstimates: boolean;
  /** Voice input enabled */
  voiceEnabled: boolean;
  /** Wake word detection (future — always disabled for now) */
  wakeWordEnabled: boolean;
  /** Auto-send after speech recognition ends (vs populate input) */
  voiceAutoSend: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  autoSyncCanvas: true,
  aiDirectCalendarAccess: true,
  showAnchorEventsOnCalendar: true,
  aiCanManageAnchors: true,
  includeWorkloadEstimates: true,
  voiceEnabled: true,
  wakeWordEnabled: false,
  voiceAutoSend: true,
};

export function getUserSettings(profile: { extra_preferences?: Record<string, unknown> } | null): UserSettings {
  if (!profile?.extra_preferences?.settings) return { ...DEFAULT_SETTINGS };
  const saved = profile.extra_preferences.settings as Partial<UserSettings>;
  return { ...DEFAULT_SETTINGS, ...saved };
}

export type UserType = "student" | "professional" | "personal";
export type SessionStyle = "short" | "deep_work";
export type DeadlineApproach = "early" | "close_to_deadline";
export type PeakProductivity = "morning" | "afternoon" | "night";
export type StructureLevel = "light" | "moderate" | "hands_on";
export type ExerciseFrequency = "daily" | "3_4x_week" | "1_2x_week";
export type WorkoutTime = "morning" | "afternoon" | "evening";
export type BalancePreference = "productivity" | "balanced";

// ─── Anchor Events (personal important recurring events) ───

export interface AnchorEvent {
  name: string;          // "Morning workout", "Prayer", "Yoga"
  days: string[];        // ["Monday", "Wednesday", "Friday"]
  startTime: string;     // HH:MM (24h)
  endTime: string;       // HH:MM (24h)
  priority: "high" | "medium"; // high = never schedule over, medium = prefer not to
}

export const ANCHOR_EVENT_PRESETS: { label: string; icon: string; defaults: Partial<AnchorEvent> }[] = [
  { label: "Workout", icon: "M18 6L6 18M6 6l12 12", defaults: { name: "Workout", startTime: "07:00", endTime: "08:00", priority: "high" } },
  { label: "Yoga", icon: "M12 2v20M2 12h20", defaults: { name: "Yoga", startTime: "06:30", endTime: "07:30", priority: "high" } },
  { label: "Prayer", icon: "M12 3v18M5 8l7-5 7 5M5 16l7 5 7-5", defaults: { name: "Prayer", startTime: "06:00", endTime: "06:30", priority: "high" } },
  { label: "Meditation", icon: "M12 2a10 10 0 100 20 10 10 0 000-20z", defaults: { name: "Meditation", startTime: "07:00", endTime: "07:30", priority: "medium" } },
  { label: "Meal prep", icon: "M3 11h18M12 2v20", defaults: { name: "Meal prep", startTime: "18:00", endTime: "19:00", priority: "medium" } },
  { label: "Work shift", icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4", defaults: { name: "Work shift", startTime: "09:00", endTime: "17:00", priority: "high" } },
  { label: "Custom", icon: "M12 5v14M5 12h14", defaults: { name: "", startTime: "09:00", endTime: "10:00", priority: "medium" } },
];

export const TIME_STRUGGLES = [
  "procrastination",
  "overbooking",
  "underestimating_time",
  "forgetting_deadlines",
  "staying_focused",
  "balancing_social_life",
] as const;
export type TimeStruggle = (typeof TIME_STRUGGLES)[number];

export const DAYS_OF_WEEK = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export interface OnboardingProfile {
  user_type: UserType;
  onboarding_completed: boolean;

  // Academic (student)
  school_name: string | null;
  major: string | null;
  num_classes: number | null;
  study_hours_per_week: number | null;

  // Study preferences
  session_style: SessionStyle | null;
  deadline_approach: DeadlineApproach | null;
  preferred_study_days: string[];
  preferred_study_times: string[];
  peak_productivity: PeakProductivity | null;
  structure_level: StructureLevel | null;

  // Challenges
  time_struggles: TimeStruggle[];

  // Wellness
  exercises_regularly: boolean | null;
  exercise_frequency: ExerciseFrequency | null;
  include_workouts: boolean | null;
  preferred_workout_time: WorkoutTime | null;
  balance_preference: BalancePreference | null;

  // Anchor events (personal recurring commitments — all user types)
  anchor_events: AnchorEvent[];

  // Extensibility
  extra_preferences: Record<string, unknown>;
}

export interface OnboardingStepProps {
  data: OnboardingProfile;
  onUpdate: (partial: Partial<OnboardingProfile>) => void;
  onNext: () => void;
  onBack: () => void;
  onSkip?: () => void;
}

export const ONBOARDING_DEFAULTS: OnboardingProfile = {
  user_type: "student",
  onboarding_completed: false,
  school_name: null,
  major: null,
  num_classes: null,
  study_hours_per_week: null,
  session_style: null,
  deadline_approach: null,
  preferred_study_days: [],
  preferred_study_times: [],
  peak_productivity: null,
  structure_level: null,
  time_struggles: [],
  exercises_regularly: null,
  exercise_frequency: null,
  include_workouts: null,
  preferred_workout_time: null,
  balance_preference: null,
  anchor_events: [],
  extra_preferences: {},
};

// Human-readable label maps
const STRUGGLE_LABELS: Record<TimeStruggle, string> = {
  procrastination: "procrastination",
  overbooking: "overbooking",
  underestimating_time: "underestimating how long tasks take",
  forgetting_deadlines: "forgetting deadlines",
  staying_focused: "staying focused",
  balancing_social_life: "balancing social life",
};

const SESSION_LABELS: Record<SessionStyle, string> = {
  short: "shorter study sessions",
  deep_work: "deep work sessions",
};

const DEADLINE_LABELS: Record<DeadlineApproach, string> = {
  early: "starts assignments early",
  close_to_deadline: "works closer to deadlines",
};

const PRODUCTIVITY_LABELS: Record<PeakProductivity, string> = {
  morning: "morning",
  afternoon: "afternoon",
  night: "night",
};

const STRUCTURE_LABELS: Record<StructureLevel, string> = {
  light: "light suggestions",
  moderate: "moderate guidance",
  hands_on: "hands-on planning",
};

const FREQUENCY_LABELS: Record<ExerciseFrequency, string> = {
  daily: "daily",
  "3_4x_week": "3-4x/week",
  "1_2x_week": "1-2x/week",
};

const WORKOUT_TIME_LABELS: Record<WorkoutTime, string> = {
  morning: "morning",
  afternoon: "afternoon",
  evening: "evening",
};

/**
 * Converts an onboarding profile into a natural-language personalization
 * block that gets appended to the AI system prompt.
 * Only includes sections where the user actually provided data.
 */
export function buildPersonalizationPrompt(profile: OnboardingProfile): string {
  const lines: string[] = [];

  // Identity
  if (profile.user_type === "student") {
    const parts: string[] = ["College student"];
    if (profile.school_name) parts[0] += ` at ${profile.school_name}`;
    if (profile.major) parts.push(`studying ${profile.major}`);
    lines.push(parts.join(", "));
  } else if (profile.user_type === "professional") {
    lines.push("Working professional");
  } else {
    lines.push("Personal/hobby user");
  }

  // Academic load
  const loadParts: string[] = [];
  if (profile.num_classes) loadParts.push(`takes ${profile.num_classes} classes`);
  if (profile.study_hours_per_week) loadParts.push(`aims for ${profile.study_hours_per_week} study hours/week`);
  if (loadParts.length > 0) lines.push(loadParts.join(", "));

  // Study preferences
  const prefParts: string[] = [];
  if (profile.session_style) prefParts.push(`prefers ${SESSION_LABELS[profile.session_style]}`);
  if (profile.deadline_approach) prefParts.push(DEADLINE_LABELS[profile.deadline_approach]);
  if (prefParts.length > 0) lines.push(prefParts.join(", "));

  if (profile.peak_productivity) {
    let prodLine = `Most productive in the ${PRODUCTIVITY_LABELS[profile.peak_productivity]}`;
    if (profile.preferred_study_days.length > 0) {
      prodLine += `, prefers studying ${profile.preferred_study_days.join("/")}`;
    }
    lines.push(prodLine);
  } else if (profile.preferred_study_days.length > 0) {
    lines.push(`Prefers studying ${profile.preferred_study_days.join("/")}`);
  }

  if (profile.structure_level) {
    lines.push(`Wants ${STRUCTURE_LABELS[profile.structure_level]} from the assistant`);
  }

  // Challenges
  if (profile.time_struggles.length > 0) {
    const labels = profile.time_struggles.map((s) => STRUGGLE_LABELS[s]);
    lines.push(`Struggles with: ${labels.join(", ")}`);
  }

  // Wellness
  if (profile.exercises_regularly) {
    const wellParts: string[] = [];
    if (profile.exercise_frequency) wellParts.push(`exercises ${FREQUENCY_LABELS[profile.exercise_frequency]}`);
    if (profile.include_workouts) wellParts.push("wants workouts in schedule");
    if (profile.preferred_workout_time) wellParts.push(`${WORKOUT_TIME_LABELS[profile.preferred_workout_time]} preferred`);
    if (wellParts.length > 0) lines.push(wellParts.join(", "));
  }

  if (profile.balance_preference) {
    lines.push(
      profile.balance_preference === "balanced"
        ? "Prefers a balanced schedule with meals, rest, and exercise"
        : "Prefers a productivity-focused schedule"
    );
  }

  if (lines.length === 0) return "";

  // Build the tailored instruction block
  let prompt = `User personalization context:\n${lines.map((l) => `- ${l}`).join("\n")}`;

  // Add scheduling guidance based on the profile
  const guidance: string[] = [];

  if (profile.peak_productivity === "morning") {
    guidance.push("favor morning study/work blocks");
  } else if (profile.peak_productivity === "night") {
    guidance.push("avoid early-morning study blocks, favor evening sessions");
  }

  if (profile.session_style === "deep_work") {
    guidance.push("schedule longer focused sessions (1.5-2+ hours) rather than scattered short blocks");
  } else if (profile.session_style === "short") {
    guidance.push("break work into shorter 30-45 minute sessions with breaks");
  }

  if (profile.deadline_approach === "early") {
    guidance.push("front-load work well before deadlines");
  } else if (profile.deadline_approach === "close_to_deadline") {
    guidance.push("this user tends to work closer to deadlines — still spread work consistently across multiple days to build good habits, but it's okay to have slightly more weight in the second half of the window. Never stack everything the night before. Consistency is key.");
  }

  if (profile.time_struggles.includes("procrastination")) {
    guidance.push("suggest starting tasks earlier with smaller initial blocks to reduce procrastination");
  }
  if (profile.time_struggles.includes("underestimating_time")) {
    guidance.push("add buffer time since user tends to underestimate task duration");
  }
  if (profile.time_struggles.includes("forgetting_deadlines")) {
    guidance.push("proactively remind about upcoming deadlines");
  }

  if (profile.include_workouts && profile.preferred_workout_time) {
    guidance.push(`protect ${WORKOUT_TIME_LABELS[profile.preferred_workout_time]} workout slots`);
  }

  if (profile.balance_preference === "balanced") {
    guidance.push("include breaks for meals, rest, and exercise in schedule suggestions");
  }

  if (profile.structure_level === "hands_on") {
    guidance.push("be detailed and proactive with scheduling suggestions");
  } else if (profile.structure_level === "light") {
    guidance.push("keep suggestions brief and optional, don't over-schedule");
  }

  // ─── Anchor events (personal recurring commitments) ───
  if (profile.anchor_events && profile.anchor_events.length > 0) {
    const anchorLines: string[] = [];
    for (const ev of profile.anchor_events) {
      const days = ev.days.length > 0 ? ev.days.join("/") : "daily";
      const prio = ev.priority === "high" ? "MUST protect — never schedule over" : "prefer to keep";
      anchorLines.push(`${ev.name}: ${days} ${ev.startTime}-${ev.endTime} (${prio})`);
    }
    lines.push(`Personal commitments: ${anchorLines.join("; ")}`);
    guidance.push("always respect the user's personal commitments listed above — these are non-negotiable anchor events");
  }

  if (guidance.length > 0) {
    prompt += `\n\nTailor scheduling accordingly: ${guidance.join("; ")}.`;
  }

  return prompt;
}
