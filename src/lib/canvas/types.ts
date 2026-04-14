// ─── Academic Item Types ───

export type AcademicItemType =
  | "assignment"
  | "quiz"
  | "exam"
  | "project"
  | "lab"
  | "discussion"
  | "reading"
  | "class_meeting"
  | "office_hours"
  | "event"
  | "other";

export type LocationMode = "in_person" | "remote" | "hybrid" | "unknown";

export type MeetingType =
  | "lecture"
  | "lab"
  | "recitation"
  | "office_hours"
  | "exam"
  | "review_session";

// ─── Location ───

export interface AcademicLocation {
  rawText?: string;
  locationMode: LocationMode;
  mapboxPlaceName?: string;
  formattedAddress?: string;
  latitude?: number;
  longitude?: number;
  geocodeConfidence?: number;
  mapboxId?: string;
  requiresReview: boolean;
}

// ─── Normalized Academic Item (internal Noted model) ───

export interface NotedAcademicItem {
  id: string;
  userId: string;
  source: "canvas";
  sourceId: string;
  sourceCourseId?: string;
  connectionId: string;
  title: string;
  description?: string;
  type: AcademicItemType;
  courseName?: string;
  courseCode?: string;
  dueAt?: string;       // ISO 8601
  startAt?: string;      // ISO 8601
  endAt?: string;        // ISO 8601
  location?: AcademicLocation;
  pointsPossible?: number;
  url?: string;
  status?: "todo" | "submitted" | "missing" | "completed" | "unknown";
  isFixedTime: boolean;
  confidence: number;
  approved: boolean;
  eventId?: string;      // linked CalendarEvent ID once converted
  isArchived: boolean;
  rawPayload?: unknown;
}

// ─── Inferred Meeting ───

export interface InferredMeeting {
  id: string;
  userId: string;
  courseId: string;
  courseName?: string;
  courseCode?: string;
  meetingType: MeetingType;
  title?: string;
  daysOfWeek: string[];   // ["Monday", "Wednesday", "Friday"]
  startTime: string;       // HH:MM 24h
  endTime: string;
  locationRaw?: string;
  locationMode: LocationMode;
  locationName?: string;
  locationLat?: number;
  locationLng?: number;
  geocodeConfidence?: number;
  locationRequiresReview: boolean;
  instructorName?: string;
  effectiveStartDate?: string; // YYYY-MM-DD
  effectiveEndDate?: string;
  sourceText?: string;
  confidence: number;
  approved: boolean;
  eventsGenerated: boolean;
}

// ─── Canvas API Response Types ───

export interface CanvasApiCourse {
  id: number;
  name: string;
  course_code: string;
  term?: { name: string };
  start_at?: string;
  end_at?: string;
  enrollments?: Array<{ type: string; enrollment_state: string }>;
  syllabus_body?: string;
}

export interface CanvasApiAssignment {
  id: number;
  name: string;
  description?: string;
  due_at?: string;
  lock_at?: string;
  unlock_at?: string;
  points_possible?: number;
  submission_types?: string[];
  html_url?: string;
  has_submitted_submissions?: boolean;
  course_id: number;
  quiz_id?: number;
}

export interface CanvasApiQuiz {
  id: number;
  title: string;
  description?: string;
  due_at?: string;
  lock_at?: string;
  unlock_at?: string;
  points_possible?: number;
  quiz_type?: string;       // "assignment" | "practice_quiz" | "graded_survey" | "survey"
  time_limit?: number;       // minutes
  html_url?: string;
  course_id: number;
}

export interface CanvasApiDiscussion {
  id: number;
  title: string;
  message?: string;
  assignment?: {
    id: number;
    due_at?: string;
    points_possible?: number;
  };
  html_url?: string;
  course_id: number;
}

export interface CanvasApiCalendarEvent {
  id: number;
  title: string;
  description?: string;
  start_at?: string;
  end_at?: string;
  location_name?: string;
  location_address?: string;
  all_day?: boolean;
  context_code?: string;     // "course_12345"
  html_url?: string;
}

export interface CanvasApiPlannerItem {
  plannable_id: number;
  plannable_type: string;    // "assignment" | "quiz" | "discussion_topic" | "planner_note" | etc.
  plannable_date?: string;
  plannable: {
    id: number;
    title: string;
    due_at?: string;
    points_possible?: number;
    course_id?: number;
  };
  html_url?: string;
  context_name?: string;
  submissions?: { submitted?: boolean };
}

export interface CanvasApiPage {
  title: string;
  body?: string;
  html_url?: string;
  front_page?: boolean;
}

export interface CanvasApiUserProfile {
  id: number;
  name: string;
  time_zone?: string;
  locale?: string;
}

// ─── Canvas Connection (DB row shape) ───

export interface CanvasConnectionRow {
  id: string;
  user_id: string;
  canvas_domain: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_expires_at: string | null;
  canvas_user_id: string | null;
  canvas_user_timezone: string | null;
  connected_at: string;
  last_synced_at: string | null;
}

export interface CanvasCourseRow {
  id: string;
  user_id: string;
  connection_id: string;
  canvas_course_id: string;
  name: string;
  course_code: string | null;
  term_name: string | null;
  start_date: string | null;
  end_date: string | null;
  color: string;
  is_active: boolean;
  syllabus_extracted: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Sync Results ───

export interface SyncStats {
  coursesSynced: number;
  itemsSynced: number;
  itemsNew: number;
  itemsUpdated: number;
}

export interface SyncResult {
  courses: CanvasCourseRow[];
  items: NotedAcademicItem[];
  stats: SyncStats;
}

// ─── LLM Extraction Output ───

export interface ExtractedMeeting {
  title: string;
  meetingType: MeetingType;
  days: string[];
  startTime: string;
  endTime: string;
  date?: string;           // YYYY-MM-DD for one-off events like exams
  locationText?: string;
  locationMode: LocationMode;
  instructorName?: string;
  confidence: number;
  sourceSnippet: string;
}

// ─── Classify item type from title/metadata ───

export function classifyItemType(
  title: string,
  submissionTypes?: string[],
  quizType?: string,
  sourceEndpoint?: string,
): AcademicItemType {
  const lower = title.toLowerCase();

  if (/\b(final\s*exam|midterm|exam)\b/.test(lower)) return "exam";
  if (/\blab\b/.test(lower) && !/\bcollab\b/.test(lower)) return "lab";
  if (/\bproject\b/.test(lower)) return "project";
  if (/\breading\b/.test(lower)) return "reading";

  if (quizType || sourceEndpoint === "quiz") return "quiz";
  if (sourceEndpoint === "discussion") return "discussion";

  return "assignment";
}

// ─── Detect location mode from text ───

const REMOTE_PATTERNS = /\b(zoom|teams|webex|meet\.google|virtual|remote|online|bluejeans)\b/i;
const INPERSON_PATTERNS = /\b(room|building|hall|bldg|rm\s*\d|suite|floor)\b/i;
const ROOM_NUMBER = /\b[A-Z]{2,6}\s*\d{2,4}[A-Z]?\b/i;

export function detectLocationMode(text?: string): LocationMode {
  if (!text) return "unknown";
  const hasRemote = REMOTE_PATTERNS.test(text);
  const hasInPerson = INPERSON_PATTERNS.test(text) || ROOM_NUMBER.test(text);

  if (hasRemote && hasInPerson) return "hybrid";
  if (hasRemote) return "remote";
  if (hasInPerson) return "in_person";
  return "unknown";
}

// ─── Extract meeting/video links ───

const MEETING_LINK_RE = /https?:\/\/(?:[\w-]+\.)?(?:zoom\.us\/j|teams\.microsoft\.com\/l|meet\.google\.com)\/[^\s"<>)]+/gi;

export function extractMeetingLink(text?: string): string | null {
  if (!text) return null;
  const match = text.match(MEETING_LINK_RE);
  return match ? match[0] : null;
}
