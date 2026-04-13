import { type CalendarEvent, type RecurrenceRule } from "./events";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

/**
 * Expand recurring events into virtual instances within a date range.
 * Non-recurring events pass through unchanged.
 * Exception instances (isRecurrenceException=true) override their series date.
 */
export function expandRecurrences(
  events: CalendarEvent[],
  rangeStart: string, // YYYY-MM-DD
  rangeEnd: string,   // YYYY-MM-DD
): CalendarEvent[] {
  const result: CalendarEvent[] = [];

  // Separate into: non-recurring, masters (have recurrenceRule), exceptions
  const nonRecurring: CalendarEvent[] = [];
  const masters: CalendarEvent[] = [];
  const exceptions = new Map<string, CalendarEvent>(); // key: seriesId__date

  for (const event of events) {
    if (event.isRecurrenceException && event.seriesId) {
      exceptions.set(`${event.seriesId}__${event.date}`, event);
    } else if (event.recurrenceRule && event.seriesId) {
      masters.push(event);
    } else {
      nonRecurring.push(event);
    }
  }

  // Pass through non-recurring events that fall within the range
  for (const event of nonRecurring) {
    if (event.date >= rangeStart && event.date <= rangeEnd) {
      result.push(event);
    }
  }

  // Expand each master into virtual instances
  for (const master of masters) {
    const occurrences = computeOccurrences(master.date, master.recurrenceRule!, rangeStart, rangeEnd);

    for (const date of occurrences) {
      const exceptionKey = `${master.seriesId}__${date}`;
      const exception = exceptions.get(exceptionKey);

      if (exception) {
        // Exception overrides this instance — use exception if it has a title (not a tombstone)
        if (exception.title) {
          result.push(exception);
        }
        // If title is empty/null, this instance was deleted — skip it
        exceptions.delete(exceptionKey);
      } else {
        // Create virtual instance from master
        result.push({
          ...master,
          id: `${master.seriesId}__${date}`,
          date,
          // Don't propagate the recurrenceRule to virtual instances
          // (only the master stores it)
        });
      }
    }
  }

  // Add any remaining exceptions that didn't match a computed occurrence
  // (e.g., moved to a different date)
  for (const exception of exceptions.values()) {
    if (exception.date >= rangeStart && exception.date <= rangeEnd && exception.title) {
      result.push(exception);
    }
  }

  return result;
}

/**
 * Compute occurrence dates for a recurrence rule within a range.
 */
function computeOccurrences(
  startDate: string,
  rule: RecurrenceRule,
  rangeStart: string,
  rangeEnd: string,
): string[] {
  const dates: string[] = [];
  const start = parseDate(startDate);
  const rStart = parseDate(rangeStart);
  const rEnd = parseDate(rangeEnd);
  const interval = rule.interval || 1;
  let count = 0;
  const maxCount = rule.endType === "count" ? (rule.endCount || 50) : 500; // safety cap
  const endDate = rule.endType === "date" && rule.endDate ? parseDate(rule.endDate) : null;

  switch (rule.frequency) {
    case "daily": {
      const d = new Date(start);
      while (d <= rEnd && count < maxCount) {
        if (endDate && d > endDate) break;
        if (d >= rStart) {
          dates.push(formatDate(d));
          count++;
        }
        d.setDate(d.getDate() + interval);
      }
      break;
    }

    case "weekdays": {
      const d = new Date(start);
      while (d <= rEnd && count < maxCount) {
        if (endDate && d > endDate) break;
        const dow = d.getDay();
        if (dow >= 1 && dow <= 5 && d >= rStart) {
          dates.push(formatDate(d));
          count++;
        }
        d.setDate(d.getDate() + 1);
      }
      break;
    }

    case "weekly":
    case "biweekly":
    case "custom": {
      const targetDays = rule.daysOfWeek || [DAY_NAMES[start.getDay()]];
      const targetDayIndices = targetDays.map((name) => DAY_NAMES.indexOf(name)).filter((i) => i >= 0);
      const weekInterval = rule.frequency === "biweekly" ? 2 : interval;

      // Find the start of the week containing startDate
      const weekStart = new Date(start);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());

      const d = new Date(weekStart);
      let weekCount = 0;

      while (d <= rEnd && count < maxCount) {
        if (endDate && d > endDate) break;

        // Check each day of this week
        for (const targetDay of targetDayIndices) {
          const candidate = new Date(d);
          candidate.setDate(candidate.getDate() + targetDay);

          if (candidate < start) continue;
          if (endDate && candidate > endDate) break;
          if (candidate > rEnd) break;
          if (candidate >= rStart) {
            dates.push(formatDate(candidate));
            count++;
            if (count >= maxCount) break;
          }
        }

        // Jump to next eligible week
        weekCount++;
        d.setDate(d.getDate() + 7);
        // For biweekly/interval, skip weeks
        if (weekInterval > 1 && weekCount % weekInterval !== 0) {
          continue; // dates won't be added for skipped weeks since we already moved d
        }
      }
      break;
    }

    case "monthly": {
      const targetDay = rule.dayOfMonth || start.getDate();
      const d = new Date(start.getFullYear(), start.getMonth(), targetDay);

      while (d <= rEnd && count < maxCount) {
        if (endDate && d > endDate) break;
        if (d >= rStart && d >= start) {
          dates.push(formatDate(d));
          count++;
        }
        d.setMonth(d.getMonth() + interval);
        // Handle months with fewer days (e.g., 31st → 28th in Feb)
        d.setDate(Math.min(targetDay, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
      }
      break;
    }
  }

  return dates;
}

/**
 * Generate human-readable preview text for a recurrence rule.
 */
export function getRecurrencePreviewText(rule: RecurrenceRule | null | undefined): string {
  if (!rule) return "Does not repeat";

  const interval = rule.interval || 1;
  let base = "";

  switch (rule.frequency) {
    case "daily":
      base = interval === 1 ? "Repeats daily" : `Repeats every ${interval} days`;
      break;
    case "weekdays":
      base = "Repeats every weekday";
      break;
    case "weekly":
      if (rule.daysOfWeek && rule.daysOfWeek.length > 0) {
        const days = rule.daysOfWeek.join(", ");
        base = interval === 1 ? `Repeats every ${days}` : `Repeats every ${interval} weeks on ${days}`;
      } else {
        base = interval === 1 ? "Repeats weekly" : `Repeats every ${interval} weeks`;
      }
      break;
    case "biweekly":
      if (rule.daysOfWeek && rule.daysOfWeek.length > 0) {
        base = `Repeats every 2 weeks on ${rule.daysOfWeek.join(", ")}`;
      } else {
        base = "Repeats every 2 weeks";
      }
      break;
    case "monthly":
      base = interval === 1 ? "Repeats monthly" : `Repeats every ${interval} months`;
      if (rule.dayOfMonth) base += ` on the ${ordinal(rule.dayOfMonth)}`;
      break;
    case "custom":
      if (rule.daysOfWeek && rule.daysOfWeek.length > 0) {
        base = `Repeats every ${rule.daysOfWeek.join(", ")}`;
      } else {
        base = "Repeats on a custom schedule";
      }
      break;
  }

  // End condition
  if (rule.endType === "date" && rule.endDate) {
    const d = new Date(rule.endDate + "T12:00:00");
    base += ` until ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  } else if (rule.endType === "count" && rule.endCount) {
    base += `, ${rule.endCount} time${rule.endCount !== 1 ? "s" : ""}`;
  }

  return base;
}

/**
 * Check if a CalendarEvent ID is a virtual recurring instance.
 * Virtual IDs have format: {seriesId}__{YYYY-MM-DD}
 */
export function isVirtualInstance(eventId: string): boolean {
  return eventId.includes("__");
}

/**
 * Parse a virtual instance ID into seriesId + date.
 */
export function parseVirtualId(eventId: string): { seriesId: string; date: string } | null {
  const parts = eventId.split("__");
  if (parts.length !== 2) return null;
  return { seriesId: parts[0], date: parts[1] };
}

/**
 * Generate a series ID for a new recurring event.
 */
export function generateSeriesId(): string {
  return `series_${Math.random().toString(36).substring(2, 11)}`;
}

// ─── Helpers ───

function parseDate(dateStr: string): Date {
  return new Date(dateStr + "T00:00:00");
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
