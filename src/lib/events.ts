export interface CalendarEvent {
  id: string;
  title: string;
  date: string; // ISO date string YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  color: "green" | "blue" | "orange" | "red" | "purple" | "gray" | "teal" | "yellow" | "pink";
  allDay?: boolean;
  location?: { name: string; lat: number; lng: number };
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
