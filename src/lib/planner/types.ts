import { z } from "zod";
import { type AcademicItemType } from "@/lib/canvas/types";

// ─── Planner Item (unified Canvas data from iCal + scraper) ───

export interface PlannerItem {
  id: string;
  userId: string;
  source: "ical" | "scraper" | "manual";
  sourceUid?: string;
  title: string;
  description?: string;
  itemType: AcademicItemType;
  courseName?: string;
  courseCode?: string;
  dueAt?: string;          // ISO 8601
  startAt?: string;
  endAt?: string;
  locationRaw?: string;
  pointsPossible?: number;
  url?: string;
  weightPercent?: number;
  submissionTypes?: string[];
  status: "todo" | "submitted" | "missing" | "completed" | "unknown";
  isFixedTime: boolean;
  confidence: number;       // 0-1
  workloadMinutes?: number;
  workloadSource: "heuristic" | "ai" | "user";
  isArchived: boolean;
  rawIcalData?: Record<string, unknown>;
  rawScraperData?: Record<string, unknown>;
}

// ─── Work Block (recommended study/work session) ───

export interface WorkBlock {
  id: string;
  plannerItemId: string;
  title: string;            // e.g. "Study: CS 2340 Midterm"
  date: string;             // YYYY-MM-DD
  startTime: string;        // HH:MM (24h)
  endTime: string;          // HH:MM (24h)
  durationMinutes: number;
  blockType: "study" | "work" | "review" | "prep";
  color: string;
  reasoning: string;        // why this block was suggested
  isCommitted: boolean;     // user accepted → becomes CalendarEvent
}

// ─── Workload Estimate ───

export interface WorkloadEstimate {
  itemType: AcademicItemType;
  baseMinutes: number;
  adjustedMinutes: number;
  confidence: number;       // 0-1
  reasoning: string;
  studentQuestions?: string[]; // questions to ask if confidence is low
}

// ─── iCal Parsed Event ───

export interface ICalEvent {
  uid: string;
  summary: string;
  description?: string;
  dtstart: Date;
  dtend?: Date;
  location?: string;
  categories?: string[];
  raw: Record<string, unknown>;
}

// ─── Scraped Data ───

export interface ScrapedAssignment {
  courseId: string;
  courseName: string;
  courseCode: string;
  title: string;
  description?: string;
  pointsPossible?: number;
  dueDate?: string;
  submissionTypes?: string[];
  url: string;
  rubricText?: string;
}

export interface ScrapedCourse {
  id: string;
  name: string;
  code: string;
  assignments: ScrapedAssignment[];
  syllabusText?: string;
  modulesText?: string;
}

// ─── Zod Validation Schemas ───

export const icalUrlSchema = z
  .string()
  .url()
  .refine(
    (url) => url.includes("/feeds/calendars/") && url.endsWith(".ics"),
    "Must be a Canvas iCal feed URL (ends with .ics)"
  );

export const ingestRequestSchema = z.object({
  icalUrl: icalUrlSchema.optional(),
  canvasDomain: z.string().optional(),
});

export const recommendRequestSchema = z.object({
  itemIds: z.array(z.string().uuid()).optional(),
  windowDays: z.number().int().min(1).max(60).default(14),
});

// ─── DB row → PlannerItem mapper ───

export function rowToPlannerItem(row: Record<string, unknown>): PlannerItem {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    source: row.source as PlannerItem["source"],
    sourceUid: row.source_uid as string | undefined,
    title: row.title as string,
    description: row.description as string | undefined,
    itemType: row.item_type as AcademicItemType,
    courseName: row.course_name as string | undefined,
    courseCode: row.course_code as string | undefined,
    dueAt: row.due_at as string | undefined,
    startAt: row.start_at as string | undefined,
    endAt: row.end_at as string | undefined,
    locationRaw: row.location_raw as string | undefined,
    pointsPossible: row.points_possible as number | undefined,
    url: row.url as string | undefined,
    weightPercent: row.weight_percent as number | undefined,
    submissionTypes: row.submission_types as string[] | undefined,
    status: (row.status as PlannerItem["status"]) || "todo",
    isFixedTime: (row.is_fixed_time as boolean) || false,
    confidence: (row.confidence as number) || 0.8,
    workloadMinutes: row.workload_minutes as number | undefined,
    workloadSource: (row.workload_source as PlannerItem["workloadSource"]) || "heuristic",
    isArchived: (row.is_archived as boolean) || false,
    rawIcalData: row.raw_ical_data as Record<string, unknown> | undefined,
    rawScraperData: row.raw_scraper_data as Record<string, unknown> | undefined,
  };
}

// ─── PlannerItem → DB row mapper ───

export function plannerItemToRow(item: PlannerItem) {
  return {
    user_id: item.userId,
    source: item.source,
    source_uid: item.sourceUid || null,
    title: item.title,
    description: item.description || null,
    item_type: item.itemType,
    course_name: item.courseName || null,
    course_code: item.courseCode || null,
    due_at: item.dueAt || null,
    start_at: item.startAt || null,
    end_at: item.endAt || null,
    location_raw: item.locationRaw || null,
    points_possible: item.pointsPossible || null,
    url: item.url || null,
    weight_percent: item.weightPercent || null,
    submission_types: item.submissionTypes || [],
    status: item.status,
    is_fixed_time: item.isFixedTime,
    confidence: item.confidence,
    workload_minutes: item.workloadMinutes || null,
    workload_source: item.workloadSource,
    is_archived: item.isArchived,
    raw_ical_data: item.rawIcalData || null,
    raw_scraper_data: item.rawScraperData || null,
    updated_at: new Date().toISOString(),
  };
}
