export type EventColor = "green" | "blue" | "orange" | "red" | "purple" | "gray" | "teal" | "yellow" | "pink";

export interface RecurrenceRule {
  frequency: "daily" | "weekdays" | "weekly" | "biweekly" | "monthly" | "custom";
  interval?: number;        // e.g. every 2 weeks (default 1)
  daysOfWeek?: string[];    // ["Monday", "Wednesday"] for weekly/custom
  dayOfMonth?: number;      // for monthly (e.g. 15th)
  endType: "never" | "date" | "count";
  endDate?: string;         // YYYY-MM-DD
  endCount?: number;        // after N occurrences
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: string; // ISO date string YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  color: EventColor;
  allDay?: boolean;
  location?: { name: string; lat: number; lng: number };
  description?: string;
  recurrenceRule?: RecurrenceRule;
  seriesId?: string;             // links all instances in a recurring series
  isRecurrenceException?: boolean; // true if this instance overrides the series
  isProtected?: boolean;           // non-negotiable — immune to casual deletion
}

function getDateStr(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().split("T")[0];
}

export function getEventsForDate(events: CalendarEvent[], date: string): CalendarEvent[] {
  return events.filter((e) => e.date === date).sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${hour} ${period}` : `${hour}:${m.toString().padStart(2, "0")} ${period}`;
}

export function getDayName(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

export function getMonthName(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "long" });
}

export function getDayNumber(dateStr: string): number {
  const d = new Date(dateStr + "T12:00:00");
  return d.getDate();
}

export function isToday(dateStr: string): boolean {
  return dateStr === getDateStr(0);
}

export function getUpcomingDates(days: number): string[] {
  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    dates.push(getDateStr(i));
  }
  return dates;
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

/**
 * Split regular events around protected/non-negotiable events on the same day.
 *
 * If a protected event (10:00-11:30) overlaps with a regular event (8:00-12:00),
 * the regular event becomes two pieces:
 *   - 8:00-10:00 (before the protected event)
 *   - 11:30-12:00 (after the protected event)
 *
 * Protected events are never modified.
 */
export function splitAroundProtected(events: CalendarEvent[]): CalendarEvent[] {
  // Group events by date
  const byDate: Record<string, CalendarEvent[]> = {};
  for (const event of events) {
    if (!byDate[event.date]) byDate[event.date] = [];
    byDate[event.date].push(event);
  }

  const result: CalendarEvent[] = [];

  for (const [, dayEvents] of Object.entries(byDate)) {
    const protectedEvents = dayEvents.filter((e) => e.isProtected);
    const regularEvents = dayEvents.filter((e) => !e.isProtected);

    // Pass through all protected events unchanged
    result.push(...protectedEvents);

    // For each regular event, check if it overlaps with any protected event
    for (const regular of regularEvents) {
      let segments = [{ start: regular.startTime, end: regular.endTime }];

      for (const prot of protectedEvents) {
        const newSegments: { start: string; end: string }[] = [];
        for (const seg of segments) {
          // Check overlap
          if (seg.start < prot.endTime && seg.end > prot.startTime) {
            // There's an overlap — split
            // Before the protected event
            if (seg.start < prot.startTime) {
              newSegments.push({ start: seg.start, end: prot.startTime });
            }
            // After the protected event
            if (seg.end > prot.endTime) {
              newSegments.push({ start: prot.endTime, end: seg.end });
            }
            // The overlapping portion is removed
          } else {
            // No overlap — keep as is
            newSegments.push(seg);
          }
        }
        segments = newSegments;
      }

      // Convert segments back to events
      if (segments.length === 0) {
        // Entire event was consumed by protected events — skip it
        continue;
      }

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        // Skip tiny segments (less than 5 minutes)
        const startMin = toMinutes(seg.start);
        const endMin = toMinutes(seg.end);
        if (endMin - startMin < 5) continue;

        result.push({
          ...regular,
          id: i === 0 ? regular.id : `${regular.id}_split_${i}`,
          startTime: seg.start,
          endTime: seg.end,
        });
      }
    }
  }

  return result;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
