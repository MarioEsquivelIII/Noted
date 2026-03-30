import type { CalendarEvent } from "./events";

/** sessionStorage key — home writes current events so account merge can read them */
export const EVENTS_SNAPSHOT_KEY = "noted_events_snapshot";

/** sessionStorage key — account writes final import; home applies once then clears */
export const GCAL_IMPORT_KEY = "noted_gcal_import";

export type RangePreset = "this_week" | "30d" | "3m" | "all" | "custom";

export interface GcalApiEvent {
  id?: string;
  status?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  colorId?: string;
}

// Google Calendar colorId → Noted color mapping
// See: https://developers.google.com/calendar/api/v3/reference/colors
type EventColor = "green" | "blue" | "orange" | "red" | "purple" | "gray" | "teal" | "yellow" | "pink";
const GCAL_COLOR_MAP: Record<string, EventColor> = {
  "1":  "purple",   // Lavender
  "2":  "green",    // Sage
  "3":  "purple",   // Grape
  "4":  "pink",     // Flamingo
  "5":  "yellow",   // Banana
  "6":  "orange",   // Tangerine
  "7":  "teal",     // Peacock
  "8":  "gray",     // Graphite
  "9":  "blue",     // Blueberry
  "10": "green",    // Basil
  "11": "red",      // Tomato
};

function gcalColorToNoted(colorId?: string): EventColor {
  if (!colorId) return "blue"; // Default Google Calendar blue
  return GCAL_COLOR_MAP[colorId] || "blue";
}

export interface GcalListResponse {
  items?: GcalApiEvent[];
  nextPageToken?: string;
  error?: { message?: string; code?: number };
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** YYYY-MM-DD in local calendar for a Date */
export function toYyyyMmDd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function toHHMM(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Parse a single Google event into one or more CalendarEvents (multi-day events produce one per day). */
export function parseGoogleEventToCalendarEvent(raw: GcalApiEvent): CalendarEvent | null {
  const results = parseGoogleEventToCalendarEvents(raw);
  return results.length > 0 ? results[0] : null;
}

export function parseGoogleEventToCalendarEvents(raw: GcalApiEvent): CalendarEvent[] {
  const gid = raw.id?.trim();
  if (!gid || raw.status === "cancelled") return [];

  const summary = raw.summary?.trim() || "(No title)";
  const start = raw.start;
  const end = raw.end;
  if (!start) return [];

  const eventColor = gcalColorToNoted(raw.colorId);

  // All-day events: Google uses date (not dateTime) and end date is exclusive
  if (start.date && !start.dateTime) {
    const startDate = new Date(start.date + "T00:00:00");
    const endDate = end?.date ? new Date(end.date + "T00:00:00") : new Date(startDate.getTime() + 86400000);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return [];

    const events: CalendarEvent[] = [];
    const cursor = new Date(startDate);
    while (cursor < endDate) {
      const dayStr = toYyyyMmDd(cursor);
      events.push({
        id: events.length === 0 ? `gcal_${gid}` : `gcal_${gid}_${dayStr}`,
        title: summary,
        date: dayStr,
        startTime: "00:00",
        endTime: "23:59",
        color: eventColor,
        allDay: true,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return events;
  }

  // Timed events
  if (start.dateTime) {
    const s = new Date(start.dateTime);
    const e = end?.dateTime ? new Date(end.dateTime) : new Date(s.getTime() + 3600000);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return [];

    const startDate = toYyyyMmDd(s);
    const endDate = toYyyyMmDd(e);

    // Single-day event
    if (startDate === endDate) {
      return [{
        id: `gcal_${gid}`,
        title: summary,
        date: startDate,
        startTime: toHHMM(s),
        endTime: toHHMM(e),
        color: eventColor,
      }];
    }

    // Multi-day timed event: split into one entry per day
    const events: CalendarEvent[] = [];
    const cursor = new Date(s);
    cursor.setHours(0, 0, 0, 0);
    const endDay = new Date(e);
    endDay.setHours(0, 0, 0, 0);

    while (cursor <= endDay) {
      const dayStr = toYyyyMmDd(cursor);
      const isFirst = dayStr === startDate;
      const isLast = dayStr === endDate;
      events.push({
        id: isFirst ? `gcal_${gid}` : `gcal_${gid}_${dayStr}`,
        title: summary,
        date: dayStr,
        startTime: isFirst ? toHHMM(s) : "00:00",
        endTime: isLast ? toHHMM(e) : "23:59",
        color: eventColor,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return events;
  }

  return [];
}

export function startOfWeekSundayLocal(d: Date): Date {
  const c = new Date(d);
  const day = c.getDay();
  c.setDate(c.getDate() - day);
  c.setHours(0, 0, 0, 0);
  return c;
}

export function endOfWeekSaturdayLocal(d: Date): Date {
  const s = startOfWeekSundayLocal(d);
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  e.setHours(23, 59, 59, 999);
  return e;
}

export function rangeToRFC3339Bounds(preset: RangePreset, customStart?: string, customEnd?: string): { timeMin: string; timeMax: string } {
  const now = new Date();

  if (preset === "custom" && customStart && customEnd) {
    const s = new Date(customStart + "T00:00:00");
    const e = new Date(customEnd + "T23:59:59");
    return { timeMin: s.toISOString(), timeMax: e.toISOString() };
  }

  if (preset === "this_week") {
    const start = startOfWeekSundayLocal(now);
    const end = endOfWeekSaturdayLocal(now);
    return { timeMin: start.toISOString(), timeMax: end.toISOString() };
  }

  if (preset === "30d") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setDate(end.getDate() + 30);
    end.setHours(23, 59, 59, 999);
    return { timeMin: start.toISOString(), timeMax: end.toISOString() };
  }

  if (preset === "3m") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setMonth(end.getMonth() + 3);
    end.setHours(23, 59, 59, 999);
    return { timeMin: start.toISOString(), timeMax: end.toISOString() };
  }

  // all upcoming — start from today, cap at 2y
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setFullYear(end.getFullYear() + 2);
  end.setHours(23, 59, 59, 999);
  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}

function eventMinutesOnDate(e: CalendarEvent): { startM: number; endM: number } {
  if (e.allDay) {
    return { startM: 0, endM: 24 * 60 - 1 };
  }
  const [sh, sm] = e.startTime.split(":").map(Number);
  const [eh, em] = e.endTime.split(":").map(Number);
  return { startM: sh * 60 + sm, endM: eh * 60 + em };
}

export function eventsOverlapSameDay(a: CalendarEvent, b: CalendarEvent): boolean {
  if (a.date !== b.date) return false;
  const A = eventMinutesOnDate(a);
  const B = eventMinutesOnDate(b);
  return A.startM <= B.endM && B.startM <= A.endM;
}

export interface ConflictRow {
  rowId: string;
  noted: CalendarEvent;
  google: CalendarEvent;
}

export function findConflictRows(notedEvents: CalendarEvent[], googleEvents: CalendarEvent[]): ConflictRow[] {
  const rows: ConflictRow[] = [];
  for (const g of googleEvents) {
    for (const k of notedEvents) {
      if (eventsOverlapSameDay(k, g)) {
        rows.push({
          rowId: `${k.id}__${g.id}`,
          noted: k,
          google: g,
        });
      }
    }
  }
  return rows;
}

export type ConflictResolution = "keep_noted" | "use_google" | "keep_both";

export function applyMergeWithResolutions(
  existing: CalendarEvent[],
  incoming: CalendarEvent[],
  conflictRows: ConflictRow[],
  resolutions: Map<string, ConflictResolution>
): CalendarEvent[] {
  const conflictGoogleIds = new Set(conflictRows.map((r) => r.google.id));
  const removeNotedIds = new Set<string>();
  const addGoogleIds = new Set<string>();

  for (const row of conflictRows) {
    const res = resolutions.get(row.rowId);
    if (!res) continue;
    if (res === "keep_noted") {
      /* skip adding this google via conflict handling */
    } else if (res === "use_google") {
      removeNotedIds.add(row.noted.id);
      addGoogleIds.add(row.google.id);
    } else if (res === "keep_both") {
      addGoogleIds.add(row.google.id);
    }
  }

  let result = existing.filter((e) => !removeNotedIds.has(e.id));
  const googleById = new Map(incoming.map((g) => [g.id, g]));

  for (const id of addGoogleIds) {
    const ge = googleById.get(id);
    if (ge) result.push(ge);
  }

  for (const g of incoming) {
    if (!conflictGoogleIds.has(g.id)) {
      result.push(g);
    }
  }

  const seen = new Set<string>();
  return result.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

export interface GcalCalendarEntry {
  id: string;
  name: string;
  backgroundColor: string;
}

interface GcalCalendarListRawEntry {
  id?: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  selected?: boolean;
  accessRole?: string;
}

interface GcalCalendarListResponse {
  items?: GcalCalendarListRawEntry[];
  nextPageToken?: string;
  error?: { message?: string; code?: number };
}

/** Fetch the full list of calendars on the user's account with name and color. */
export async function fetchCalendarList(accessToken: string): Promise<GcalCalendarEntry[]> {
  const calendars: GcalCalendarEntry[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL("https://www.googleapis.com/calendar/v3/users/me/calendarList");
    url.searchParams.set("maxResults", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    let body: GcalCalendarListResponse;
    try {
      body = (await res.json()) as GcalCalendarListResponse;
    } catch {
      break;
    }

    if (!res.ok) break;

    for (const cal of body.items || []) {
      if (cal.id) {
        calendars.push({
          id: cal.id,
          name: cal.summaryOverride || cal.summary || cal.id,
          backgroundColor: cal.backgroundColor || "#4285F4",
        });
      }
    }

    pageToken = body.nextPageToken;
  } while (pageToken);

  return calendars.length > 0 ? calendars : [{ id: "primary", name: "Primary", backgroundColor: "#4285F4" }];
}

/** Fetch events from a single calendar. */
async function fetchEventsFromCalendar(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<CalendarEvent[]> {
  const collected: CalendarEvent[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("timeMax", timeMax);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "250");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    let body: GcalListResponse;
    try {
      body = (await res.json()) as GcalListResponse;
    } catch {
      // Skip this calendar on parse failure
      break;
    }

    if (!res.ok) {
      // Skip calendars that error (e.g. permission denied) rather than failing the whole sync
      break;
    }

    for (const item of body.items || []) {
      const evs = parseGoogleEventToCalendarEvents(item);
      for (const ev of evs) collected.push(ev);
    }

    pageToken = body.nextPageToken;
  } while (pageToken);

  return collected;
}

export async function fetchGoogleCalendarEvents(accessToken: string, timeMin: string, timeMax: string, calendarIds?: string[]): Promise<CalendarEvent[]> {
  const ids = calendarIds && calendarIds.length > 0 ? calendarIds : ["primary"];

  // Fetch selected calendars in parallel
  const results = await Promise.all(
    ids.map((id) => fetchEventsFromCalendar(accessToken, id, timeMin, timeMax))
  );

  const all = results.flat();

  // Deduplicate by event id (same event can appear in multiple calendar views)
  const seen = new Set<string>();
  return all.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

export function readEventsSnapshot(): CalendarEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(EVENTS_SNAPSHOT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as CalendarEvent[];
  } catch {
    return [];
  }
}
