import { classifyItemType } from "@/lib/canvas/types";
import { type PlannerItem, type ICalEvent } from "./types";

/**
 * Parse a Canvas iCal feed URL into normalized PlannerItems.
 *
 * Uses a lightweight custom parser instead of node-ical/ical.js
 * because those libraries use BigInt which breaks Turbopack bundling.
 *
 * Canvas iCal feeds embed course info in SUMMARY as:
 *   "[COURSE_CODE - Course Name] Assignment Title"
 * or sometimes just "Assignment Title" for personal calendar items.
 */
export async function parseCanvasICalFeed(
  url: string,
  userId: string,
): Promise<PlannerItem[]> {
  // Fetch the raw .ics text
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch iCal feed: ${response.status} ${response.statusText}`);
  }
  const icsText = await response.text();

  // Parse into VEVENT objects
  const vevents = parseICS(icsText);
  const items: PlannerItem[] = [];
  const now = new Date();

  for (const vevent of vevents) {
    if (!vevent.summary) continue;

    // Parse course info from summary
    const { courseCode, courseName, title } = parseSummary(vevent.summary);

    // Determine dates
    const dtstart = vevent.dtstart ? parseICalDate(vevent.dtstart) : null;
    const dtend = vevent.dtend ? parseICalDate(vevent.dtend) : null;

    // Skip events that ended more than 7 days ago
    const relevantDate = dtend || dtstart;
    if (relevantDate && relevantDate.getTime() < now.getTime() - 7 * 86400000) {
      continue;
    }

    // Determine if this is a fixed-time event (has both start and end with times)
    // vs a deadline (all-day or only start date)
    const hasTimeComponent = dtstart && dtend &&
      (dtstart.getHours() !== 0 || dtstart.getMinutes() !== 0) &&
      (dtend.getHours() !== 0 || dtend.getMinutes() !== 0);
    const isFixedTime = !!hasTimeComponent;

    const itemType = classifyItemType(title);

    const icalEvent: ICalEvent = {
      uid: vevent.uid || `${Date.now()}-${Math.random()}`,
      summary: vevent.summary,
      description: vevent.description || undefined,
      dtstart: dtstart || new Date(),
      dtend: dtend || undefined,
      location: vevent.location || undefined,
      raw: { uid: vevent.uid, summary: vevent.summary },
    };

    items.push({
      id: "",
      userId,
      source: "ical",
      sourceUid: icalEvent.uid,
      title,
      description: icalEvent.description,
      itemType,
      courseName: courseName || undefined,
      courseCode: courseCode || undefined,
      dueAt: isFixedTime ? undefined : dtstart?.toISOString(),
      startAt: isFixedTime ? dtstart?.toISOString() : undefined,
      endAt: isFixedTime ? dtend?.toISOString() : undefined,
      locationRaw: icalEvent.location,
      status: "todo",
      isFixedTime,
      confidence: 0.8,
      workloadSource: "heuristic",
      isArchived: false,
      rawIcalData: { uid: icalEvent.uid, summary: icalEvent.summary },
    });
  }

  // Sort by due date ascending
  items.sort((a, b) => {
    const dateA = a.dueAt || a.startAt || "";
    const dateB = b.dueAt || b.startAt || "";
    return dateA.localeCompare(dateB);
  });

  return items;
}

// ─── Lightweight iCal Parser ───

interface RawVEvent {
  uid?: string;
  summary?: string;
  description?: string;
  dtstart?: string;
  dtend?: string;
  location?: string;
}

/**
 * Parse an ICS text string into an array of VEVENT objects.
 * Handles line unfolding (RFC 5545 §3.1) and basic property extraction.
 */
function parseICS(text: string): RawVEvent[] {
  // Unfold continuation lines (RFC 5545: lines starting with space/tab are continuations)
  const unfolded = text.replace(/\r\n[ \t]/g, "").replace(/\r/g, "");
  const lines = unfolded.split("\n");

  const events: RawVEvent[] = [];
  let current: RawVEvent | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "BEGIN:VEVENT") {
      current = {};
      continue;
    }

    if (trimmed === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
      continue;
    }

    if (!current) continue;

    // Parse property: NAME;params:value or NAME:value
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const propPart = trimmed.substring(0, colonIdx);
    const value = trimmed.substring(colonIdx + 1);
    // Strip parameters (everything after semicolon in propPart)
    const propName = propPart.split(";")[0].toUpperCase();

    switch (propName) {
      case "UID":
        current.uid = value;
        break;
      case "SUMMARY":
        current.summary = unescapeICalText(value);
        break;
      case "DESCRIPTION":
        current.description = unescapeICalText(value);
        break;
      case "DTSTART":
        current.dtstart = value;
        break;
      case "DTEND":
        current.dtend = value;
        break;
      case "LOCATION":
        current.location = unescapeICalText(value);
        break;
    }
  }

  return events;
}

/**
 * Parse an iCal date string (various formats) into a JavaScript Date.
 * Handles: 20260415T090000Z, 20260415T090000, 20260415 (all-day)
 */
function parseICalDate(dateStr: string): Date | null {
  if (!dateStr) return null;

  // Remove VALUE=DATE: prefix if present
  const clean = dateStr.replace(/^VALUE=DATE:/i, "").trim();

  // Format: YYYYMMDD (all-day)
  if (/^\d{8}$/.test(clean)) {
    return new Date(`${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}T00:00:00`);
  }

  // Format: YYYYMMDDTHHmmssZ or YYYYMMDDTHHmmss
  const match = clean.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (match) {
    const [, year, month, day, hour, min, sec, z] = match;
    const iso = `${year}-${month}-${day}T${hour}:${min}:${sec}${z ? "Z" : ""}`;
    return new Date(iso);
  }

  // Try ISO format directly
  const parsed = new Date(clean);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Unescape iCal text values (RFC 5545 §3.3.11).
 */
function unescapeICalText(text: string): string {
  return text
    .replace(/\\n/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/**
 * Parse Canvas iCal SUMMARY field into course + title.
 * Supports two formats:
 *   "[CS 2340 - OO Design] Homework 3"  (brackets at start)
 *   "Homework 3 [CS 2340]"              (brackets at end — GT format)
 *   "Midterm Examination 2 [CHEM 1310 B]"
 * Fallback: entire summary is the title if no brackets found.
 */
function parseSummary(summary: string): {
  courseCode: string | null;
  courseName: string | null;
  title: string;
} {
  // Format 1: "[COURSE CODE - Course Name] Title" (brackets at start)
  const startBracketMatch = summary.match(/^\[(.+?)\]\s*(.+)$/);
  if (startBracketMatch) {
    const bracketContent = startBracketMatch[1];
    const title = startBracketMatch[2].trim();

    const dashMatch = bracketContent.match(/^(.+?)\s*-\s*(.+)$/);
    if (dashMatch) {
      return { courseCode: dashMatch[1].trim(), courseName: dashMatch[2].trim(), title };
    }
    return { courseCode: bracketContent.trim(), courseName: null, title };
  }

  // Format 2: "Title [COURSE CODE]" (brackets at end — GT Canvas format)
  const endBracketMatch = summary.match(/^(.+?)\s*\[(.+?)\]$/);
  if (endBracketMatch) {
    const title = endBracketMatch[1].trim();
    const bracketContent = endBracketMatch[2].trim();

    const dashMatch = bracketContent.match(/^(.+?)\s*-\s*(.+)$/);
    if (dashMatch) {
      return { courseCode: dashMatch[1].trim(), courseName: dashMatch[2].trim(), title };
    }
    return { courseCode: bracketContent.trim(), courseName: null, title };
  }

  // No brackets — full summary is the title
  return { courseCode: null, courseName: null, title: summary.trim() };
}
