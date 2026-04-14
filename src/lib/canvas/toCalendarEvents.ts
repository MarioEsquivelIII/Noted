import type { CalendarEvent, EventColor } from "../events";

interface AcademicItemRow {
  id: string;
  canvas_item_id: string;
  item_type: string;
  title: string;
  due_at: string | null;
  start_at: string | null;
  end_at: string | null;
  location_name: string | null;
  location_lat: number | null;
  location_lng: number | null;
  location_mode: string | null;
  course_id: string | null;
  canvas_courses?: {
    course_code: string | null;
    color: string;
    canvas_course_id: string;
  } | null;
}

interface MeetingRow {
  id: string;
  meeting_type: string;
  title: string | null;
  days_of_week: string[];
  start_time: string;
  end_time: string;
  location_name: string | null;
  location_lat: number | null;
  location_lng: number | null;
  effective_start_date: string | null;
  effective_end_date: string | null;
  canvas_courses?: {
    course_code: string | null;
    color: string;
    canvas_course_id: string;
  } | null;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function toYyyyMmDd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function toHhMm(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const DAY_MAP: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

/** Convert structured Canvas academic items to CalendarEvents */
export function convertItemsToCalendarEvents(
  items: AcademicItemRow[],
): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  for (const item of items) {
    const courseCode = item.canvas_courses?.course_code || "";
    const color = (item.canvas_courses?.color || "blue") as EventColor;

    // Items with start_at + end_at (calendar events with fixed times)
    if (item.start_at && item.end_at) {
      const start = new Date(item.start_at);
      const end = new Date(item.end_at);
      const location = item.location_name && item.location_lat
        ? { name: item.location_name, lat: item.location_lat, lng: item.location_lng! }
        : undefined;

      events.push({
        id: `canvas_${item.canvas_item_id}`,
        title: courseCode ? `${courseCode}: ${item.title}` : item.title,
        date: toYyyyMmDd(start),
        startTime: toHhMm(start),
        endTime: toHhMm(end),
        color,
        location,
      });
      continue;
    }

    // Items with due_at only (assignments, quizzes, etc.)
    if (item.due_at) {
      const due = new Date(item.due_at);
      const dueHhMm = toHhMm(due);

      // If due at midnight, make it an all-day event
      if (dueHhMm === "00:00" || dueHhMm === "23:59") {
        events.push({
          id: `canvas_${item.canvas_item_id}`,
          title: courseCode ? `${courseCode}: ${item.title}` : item.title,
          date: toYyyyMmDd(due),
          startTime: "00:00",
          endTime: "23:59",
          color,
          allDay: true,
        });
      } else {
        // Show as a 1-hour block ending at due time
        const startHour = due.getHours() - 1;
        const startTime = startHour >= 0
          ? `${pad2(startHour)}:${pad2(due.getMinutes())}`
          : "00:00";

        events.push({
          id: `canvas_${item.canvas_item_id}`,
          title: courseCode
            ? `${courseCode}: ${item.title} (Due)`
            : `${item.title} (Due)`,
          date: toYyyyMmDd(due),
          startTime,
          endTime: dueHhMm,
          color: item.item_type === "exam" ? "red" : color,
        });
      }
    }
  }

  return events;
}

/** Convert approved inferred meetings to recurring CalendarEvents */
export function convertMeetingsToCalendarEvents(
  meetings: MeetingRow[],
): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  for (const meeting of meetings) {
    const courseCode = meeting.canvas_courses?.course_code || "";
    const color = (meeting.canvas_courses?.color || "blue") as EventColor;
    const meetingColor: EventColor = meeting.meeting_type === "office_hours"
      ? "gray"
      : meeting.meeting_type === "exam"
        ? "red"
        : color;

    const title = meeting.title ||
      `${courseCode} ${meeting.meeting_type.replace("_", " ")}`;

    const location = meeting.location_name && meeting.location_lat
      ? { name: meeting.location_name, lat: meeting.location_lat, lng: meeting.location_lng! }
      : undefined;

    // Determine date range for expansion
    const startDate = meeting.effective_start_date
      ? new Date(meeting.effective_start_date + "T00:00:00")
      : new Date(); // default to today
    const endDate = meeting.effective_end_date
      ? new Date(meeting.effective_end_date + "T00:00:00")
      : (() => {
          // Default to 15 weeks from start
          const d = new Date(startDate);
          d.setDate(d.getDate() + 15 * 7);
          return d;
        })();

    // Expand each day-of-week across the date range
    const targetDays = meeting.days_of_week
      .map((d) => DAY_MAP[d])
      .filter((d) => d !== undefined);

    const current = new Date(startDate);
    while (current <= endDate) {
      if (targetDays.includes(current.getDay())) {
        const dateStr = toYyyyMmDd(current);
        events.push({
          id: `canvas_mtg_${meeting.id}_${dateStr}`,
          title,
          date: dateStr,
          startTime: meeting.start_time,
          endTime: meeting.end_time,
          color: meetingColor,
          location,
        });
      }
      current.setDate(current.getDate() + 1);
    }
  }

  return events;
}
