"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { CalendarEvent, getEventsForDate, formatTime, getDayName, getDayNumber, getMonthName, isToday, generateId } from "@/lib/events";

type CalendarViewMode = "day" | "week" | "month";

interface WeekCalendarProps {
  events: CalendarEvent[];
  onContextMenu: (event: CalendarEvent, x: number, y: number) => void;
  onAddEvent: (event: CalendarEvent) => void;
  onClickEvent: (event: CalendarEvent, x: number, y: number) => void;
  onUpdateEvent?: (event: CalendarEvent) => void;
  onGoogleSync?: () => Promise<void>;
}

/* ── Overlap layout (Google Calendar style) ── */

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Google Calendar-style overlap layout.
 * - Events that share the exact same start time → equal-width side by side columns
 * - Events that partially overlap (different start times) → later event indents over earlier
 * - Back-to-back events (end === start) → full width, stacked vertically (no overlap)
 */
function computeOverlapLayout(dayEvents: CalendarEvent[]): Map<string, { left: number; width: number }> {
  const layout = new Map<string, { left: number; width: number }>();
  if (dayEvents.length === 0) return layout;

  // Sort by start time, then longer events first
  const sorted = [...dayEvents].sort((a, b) => {
    const d = toMinutes(a.startTime) - toMinutes(b.startTime);
    return d !== 0 ? d : toMinutes(b.endTime) - toMinutes(a.endTime);
  });

  // Group events that share the exact same start time into "sibling groups"
  // These get equal-width side-by-side columns
  const siblingGroups: CalendarEvent[][] = [];
  let i = 0;
  while (i < sorted.length) {
    const startMin = toMinutes(sorted[i].startTime);
    const group = [sorted[i]];
    while (i + 1 < sorted.length && toMinutes(sorted[i + 1].startTime) === startMin) {
      i++;
      group.push(sorted[i]);
    }
    siblingGroups.push(group);
    i++;
  }

  // For each sibling group, assign equal-width side-by-side columns
  // Then check if this group overlaps with any previous group for indent
  const placed: { startMin: number; endMin: number; depth: number }[] = [];

  for (const group of siblingGroups) {
    const groupStart = toMinutes(group[0].startTime);

    // Find how many previous placed groups this group overlaps with
    // (back-to-back does NOT count as overlap: use strict <)
    let depth = 0;
    for (const prev of placed) {
      if (groupStart < prev.endMin) {
        depth = Math.max(depth, prev.depth + 1);
      }
    }

    const INDENT_PCT = 10;
    const groupLeft = Math.min(depth * INDENT_PCT, 60);
    const groupWidth = 100 - groupLeft;
    const cols = group.length;

    let groupMaxEnd = 0;
    for (let j = 0; j < group.length; j++) {
      const ev = group[j];
      const evEnd = toMinutes(ev.endTime);
      groupMaxEnd = Math.max(groupMaxEnd, evEnd);

      if (cols === 1) {
        // Single event at this start time: full available width
        layout.set(ev.id, { left: groupLeft, width: groupWidth });
      } else {
        // Multiple events at same start time: split available width equally
        layout.set(ev.id, {
          left: groupLeft + (j / cols) * groupWidth,
          width: groupWidth / cols,
        });
      }
    }

    placed.push({ startMin: groupStart, endMin: groupMaxEnd, depth });
  }

  return layout;
}

// Solid opaque event colors matching Chronos style (white text on colored bg)
const EVENT_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  green:  { bg: "rgba(90, 138, 74, 0.85)",  border: "#5a8a4a",  text: "#ffffff" },
  blue:   { bg: "rgba(74, 122, 138, 0.85)",  border: "#4a7a8a",  text: "#ffffff" },
  orange: { bg: "rgba(138, 112, 64, 0.85)",  border: "#8a7040",  text: "#ffffff" },
  red:    { bg: "rgba(138, 74, 74, 0.85)",   border: "#8a4a4a",  text: "#ffffff" },
  purple: { bg: "rgba(122, 90, 138, 0.85)",  border: "#7a5a8a",  text: "#ffffff" },
  gray:   { bg: "rgba(106, 106, 106, 0.85)", border: "#6a6a6a",  text: "#ffffff" },
  teal:   { bg: "rgba(74, 138, 130, 0.85)",  border: "#4a8a82",  text: "#ffffff" },
  yellow: { bg: "rgba(160, 140, 50, 0.85)",  border: "#a08c32",  text: "#ffffff" },
  pink:   { bg: "rgba(160, 80, 120, 0.85)",  border: "#a05078",  text: "#ffffff" },
};

const dotColorMap: Record<string, string> = {
  green: "#5a8a4a", blue: "#4a7a8a", orange: "#8a7040",
  red: "#8a4a4a", purple: "#7a5a8a", gray: "#6a6a6a",
  teal: "#4a8a82", yellow: "#a08c32", pink: "#a05078",
};

const HOUR_HEIGHT = 56;

function getMonthGridDates(year: number, month: number): string[] {
  const firstDay = new Date(year, month, 1);
  const startDate = new Date(firstDay);
  startDate.setDate(1 - firstDay.getDay());
  const dates: string[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

function getDatesForView(viewMode: CalendarViewMode, numDays: number, offset: number): string[] {
  if (viewMode === "month") {
    const today = new Date();
    const targetMonth = today.getMonth() + offset;
    const targetDate = new Date(today.getFullYear(), targetMonth, 1);
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth();
    const dates: string[] = [];
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let i = 1; i <= daysInMonth; i++) {
      dates.push(new Date(year, month, i).toISOString().split("T")[0]);
    }
    return dates;
  }
  const today = new Date();
  if (viewMode === "day") {
    today.setDate(today.getDate() + offset);
    return [today.toISOString().split("T")[0]];
  }
  // Week view: find the Sunday of the current week, then apply week offset
  const dayOfWeek = today.getDay(); // 0=Sun
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - dayOfWeek + offset);
  const dates: string[] = [];
  for (let i = 0; i < numDays; i++) {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

export default function WeekCalendar({ events, onContextMenu, onAddEvent, onClickEvent, onUpdateEvent, onGoogleSync }: WeekCalendarProps) {
  const [viewMode, setViewMode] = useState<CalendarViewMode>("week");
  const [numDays, setNumDays] = useState(7);
  const [weekOffset, setWeekOffset] = useState(0);
  const [showViewMenu, setShowViewMenu] = useState(false);
  const [showDaysMenu, setShowDaysMenu] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showWeekends, setShowWeekends] = useState(true);
  const [showDeclinedEvents, setShowDeclinedEvents] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const [dragging, setDragging] = useState(false);
  const [dragDate, setDragDate] = useState<string | null>(null);
  const [dragStartMin, setDragStartMin] = useState<number | null>(null);
  const [dragEndMin, setDragEndMin] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Drag-to-move existing events
  const [movingEvent, setMovingEvent] = useState<CalendarEvent | null>(null);
  const [moveGhostDate, setMoveGhostDate] = useState<string | null>(null);
  const [moveGhostMin, setMoveGhostMin] = useState<number>(0);

  // Current time line
  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const effectiveOffset = viewMode === "month" ? weekOffset : weekOffset * 7;
  const allDates = getDatesForView(viewMode, numDays, effectiveOffset);
  const displayDates = showWeekends ? allDates : allDates.filter(d => {
    const day = new Date(d + "T12:00:00").getDay();
    return day !== 0 && day !== 6;
  });

  const hours = Array.from({ length: 24 }, (_, i) => i);

  const monthLabel = (() => {
    if (viewMode === "month") {
      const today = new Date();
      const targetMonth = today.getMonth() + weekOffset;
      const targetDate = new Date(today.getFullYear(), targetMonth, 1);
      return `${targetDate.toLocaleDateString("en-US", { month: "long" })} ${targetDate.getFullYear()}`;
    }
    if (displayDates.length === 0) return "";
    const first = new Date(displayDates[0] + "T12:00:00");
    const last = new Date(displayDates[displayDates.length - 1] + "T12:00:00");
    if (first.getMonth() === last.getMonth()) {
      return `${getMonthName(displayDates[0])} ${first.getFullYear()}`;
    }
    return `${first.toLocaleDateString("en-US", { month: "short" })} – ${last.toLocaleDateString("en-US", { month: "short" })} ${last.getFullYear()}`;
  })();

  const monthGridDates = (() => {
    if (viewMode !== "month") return [];
    const today = new Date();
    const targetMonth = today.getMonth() + weekOffset;
    const targetDate = new Date(today.getFullYear(), targetMonth, 1);
    return getMonthGridDates(targetDate.getFullYear(), targetDate.getMonth());
  })();

  const currentMonthIndex = (() => {
    if (viewMode !== "month") return -1;
    const today = new Date();
    const targetMonth = today.getMonth() + weekOffset;
    return new Date(today.getFullYear(), targetMonth, 1).getMonth();
  })();

  const snap15 = (minutes: number) => Math.round(minutes / 15) * 15;

  const getMinutesFromMouseY = useCallback((e: React.MouseEvent, hour: number) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const yInCell = e.clientY - rect.top;
    const fraction = Math.max(0, Math.min(1, yInCell / HOUR_HEIGHT));
    return snap15(hour * 60 + fraction * 60);
  }, []);

  const handleMouseDown = (date: string, hour: number, e: React.MouseEvent) => {
    const minutes = getMinutesFromMouseY(e, hour);
    setDragging(true);
    setDragDate(date);
    setDragStartMin(minutes);
    setDragEndMin(minutes + 15);
  };

  const handleMouseMove = useCallback((hour: number, e: React.MouseEvent) => {
    if (!dragging || dragStartMin === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const yInCell = e.clientY - rect.top;
    const fraction = Math.max(0, Math.min(1, yInCell / HOUR_HEIGHT));
    const minutes = snap15(hour * 60 + fraction * 60);
    setDragEndMin(Math.max(minutes + 15, dragStartMin + 15));
  }, [dragging, dragStartMin]);

  const handleMouseUp = () => {
    // Handle move drop
    if (movingEvent && moveGhostDate && onUpdateEvent) {
      const startH = parseInt(movingEvent.startTime.split(":")[0]);
      const startM = parseInt(movingEvent.startTime.split(":")[1]);
      const endH = parseInt(movingEvent.endTime.split(":")[0]);
      const endM = parseInt(movingEvent.endTime.split(":")[1]);
      const durationMin = (endH * 60 + endM) - (startH * 60 + startM);
      const newEndMin = moveGhostMin + durationMin;
      onUpdateEvent({
        ...movingEvent,
        date: moveGhostDate,
        startTime: `${Math.floor(moveGhostMin / 60).toString().padStart(2, "0")}:${(moveGhostMin % 60).toString().padStart(2, "0")}`,
        endTime: `${Math.floor(newEndMin / 60).toString().padStart(2, "0")}:${(newEndMin % 60).toString().padStart(2, "0")}`,
      });
    }
    setMovingEvent(null);
    setMoveGhostDate(null);

    // Handle create-by-drag
    if (dragging && dragDate && dragStartMin !== null && dragEndMin !== null) {
      const startMin = Math.min(dragStartMin, dragEndMin - 15);
      const endMin = Math.max(dragStartMin + 15, dragEndMin);
      const newEvent: CalendarEvent = {
        id: generateId(),
        title: "New Event",
        date: dragDate,
        startTime: `${Math.floor(startMin / 60).toString().padStart(2, "0")}:${(startMin % 60).toString().padStart(2, "0")}`,
        endTime: `${Math.floor(endMin / 60).toString().padStart(2, "0")}:${(endMin % 60).toString().padStart(2, "0")}`,
        color: "green",
      };
      onAddEvent(newEvent);
      setTimeout(() => onClickEvent(newEvent, window.innerWidth / 2, 200), 50);
    }
    setDragging(false);
    setDragDate(null);
    setDragStartMin(null);
    setDragEndMin(null);
  };

  const handleEventDragStart = (event: CalendarEvent, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setMovingEvent(event);
    setMoveGhostDate(event.date);
    const startH = parseInt(event.startTime.split(":")[0]);
    const startM = parseInt(event.startTime.split(":")[1]);
    setMoveGhostMin(startH * 60 + startM);
  };

  const handleCellMouseMove = (date: string, hour: number, e: React.MouseEvent) => {
    if (movingEvent) {
      setMoveGhostDate(date);
      const rect = e.currentTarget.getBoundingClientRect();
      const yInCell = e.clientY - rect.top;
      const fraction = Math.max(0, Math.min(1, yInCell / HOUR_HEIGHT));
      setMoveGhostMin(snap15(hour * 60 + fraction * 60));
    }
    if (dragging) {
      handleMouseMove(hour, e);
    }
  };

  const handlePrev = () => setWeekOffset(weekOffset - 1);
  const handleNext = () => setWeekOffset(weekOffset + 1);

  const colTemplate = `60px repeat(${displayDates.length}, 1fr)`;
  const weekdayHeaders = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="w-full h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 h-12 flex-shrink-0">
        <div className="flex items-center gap-3">
          {/* Today */}
          <button
            onClick={() => setWeekOffset(0)}
            className="px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-colors"
            style={weekOffset === 0
              ? { background: "var(--accent)", color: "white" }
              : { border: "1px solid var(--border-color)", color: "var(--text-secondary)" }
            }
          >
            Today
          </button>

          {/* Nav arrows */}
          <div className="flex items-center gap-0.5">
            <button onClick={handlePrev} className="w-8 h-8 rounded-full flex items-center justify-center transition-colors" onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <button onClick={handleNext} className="w-8 h-8 rounded-full flex items-center justify-center transition-colors" onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          </div>

          {/* Month label */}
          <h2 className="text-[17px] font-medium" style={{ color: "var(--text-primary)" }}>{monthLabel}</h2>
        </div>

        <div className="flex items-center gap-2">
          {/* Google Calendar sync */}
          {onGoogleSync && (
            <button
              onClick={async () => { setSyncing(true); try { await onGoogleSync(); } finally { setSyncing(false); } }}
              disabled={syncing}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors disabled:opacity-50"
              style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", color: "var(--text-secondary)" }}
              title="Sync Google Calendar"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" className={syncing ? "animate-spin" : ""}>
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              {syncing ? "Syncing..." : "Google"}
            </button>
          )}

        {/* View selector */}
        <div className="relative">
          <button
            onClick={() => { setShowViewMenu(!showViewMenu); setShowDaysMenu(false); setShowSettingsMenu(false); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors"
            style={{ border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
          >
            {viewMode === "day" ? "Day" : viewMode === "week" ? "Week" : "Month"}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          {showViewMenu && (
            <div className="absolute right-0 top-full mt-1 w-52 rounded-xl shadow-2xl overflow-hidden z-50" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-color)" }}>
              {([
                { m: "day" as CalendarViewMode, label: "Day", shortcut: "D" },
                { m: "week" as CalendarViewMode, label: "Week", shortcut: "W" },
                { m: "month" as CalendarViewMode, label: "Month", shortcut: "M" },
              ]).map(({ m, label, shortcut }) => (
                <button
                  key={m}
                  onClick={() => { setViewMode(m); setWeekOffset(0); setShowViewMenu(false); if (m === "day") setNumDays(1); else if (m === "week") setNumDays(7); }}
                  className="w-full flex items-center justify-between px-3 py-2 text-[13px] transition-colors"
                  style={{ color: viewMode === m ? "var(--accent)" : "var(--text-primary)", background: viewMode === m ? "var(--bg-hover)" : "transparent" }}
                  onMouseEnter={(e) => { if (viewMode !== m) e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { if (viewMode !== m) e.currentTarget.style.background = "transparent"; }}
                >
                  <div className="flex items-center gap-2">
                    {viewMode === m && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
                    {viewMode !== m && <div className="w-3" />}
                    {label}
                  </div>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>{shortcut}</span>
                </button>
              ))}

              <div style={{ borderTop: "1px solid var(--border-color)" }} />

              {/* Number of days */}
              <div>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowDaysMenu(!showDaysMenu); setShowSettingsMenu(false); }}
                  className="w-full flex items-center justify-between px-3 py-2 text-[13px] transition-colors"
                  style={{ color: "var(--text-secondary)" }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-3" />
                    Number of days
                  </div>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" style={{ transform: showDaysMenu ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}><path d="M9 18l6-6-6-6" /></svg>
                </button>
                {showDaysMenu && (
                  <div className="pl-6" style={{ borderTop: "1px solid var(--border-color)" }}>
                    {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                      <button
                        key={n}
                        onClick={() => { setNumDays(n); setViewMode("week"); setShowDaysMenu(false); setShowViewMenu(false); }}
                        className="w-full flex items-center justify-between px-3 py-1.5 text-[13px] transition-colors"
                        style={{ color: numDays === n && viewMode === "week" ? "var(--accent)" : "var(--text-secondary)", background: numDays === n && viewMode === "week" ? "var(--bg-hover)" : "transparent" }}
                        onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
                        onMouseLeave={(e) => { if (!(numDays === n && viewMode === "week")) e.currentTarget.style.background = "transparent"; }}
                      >
                        {n} days
                        <span className="text-xs" style={{ color: "var(--text-muted)" }}>{n}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* View settings */}
              <div>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowSettingsMenu(!showSettingsMenu); setShowDaysMenu(false); }}
                  className="w-full flex items-center justify-between px-3 py-2 text-[13px] transition-colors"
                  style={{ color: "var(--text-secondary)" }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-3" />
                    View settings
                  </div>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" style={{ transform: showSettingsMenu ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}><path d="M9 18l6-6-6-6" /></svg>
                </button>
                {showSettingsMenu && (
                  <div className="pl-6" style={{ borderTop: "1px solid var(--border-color)" }}>
                    <button
                      onClick={() => setShowWeekends(!showWeekends)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[13px] transition-colors"
                      style={{ color: "var(--text-secondary)" }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                    >
                      {showWeekends ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg> : <div className="w-3" />}
                      Show weekends
                    </button>
                    <button
                      onClick={() => setShowDeclinedEvents(!showDeclinedEvents)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[13px] transition-colors"
                      style={{ color: "var(--text-secondary)" }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                    >
                      {showDeclinedEvents ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg> : <div className="w-3" />}
                      Declined events
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* ===== MONTH VIEW ===== */}
      {viewMode === "month" ? (
        <div className="flex-1 min-h-0 overflow-hidden" style={{ background: "var(--card-bg)", borderTop: "1px solid var(--border-color)" }}>
          <div className="grid grid-cols-7" style={{ borderBottom: "1px solid var(--border-color)" }}>
            {weekdayHeaders.map((day) => (
              <div key={day} className="px-2 py-2 text-center text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthGridDates.map((dateStr, idx) => {
              const dateObj = new Date(dateStr + "T12:00:00");
              const isCurrentMonth = dateObj.getMonth() === currentMonthIndex;
              const isTodayDate = isToday(dateStr);
              const dayEvents = getEventsForDate(events, dateStr);
              const visibleEvents = dayEvents.slice(0, 3);
              const extraCount = dayEvents.length - 3;

              return (
                <div key={dateStr + idx} className="min-h-[100px] p-1.5"
                  style={{ borderTop: idx >= 7 ? "1px solid var(--grid-line-strong)" : undefined, borderLeft: idx % 7 !== 0 ? "1px solid var(--grid-line-strong)" : undefined }}>
                  <div className="flex justify-center mb-1">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs"
                      style={isTodayDate ? { background: "var(--accent)", color: "white", fontWeight: 600 } : { color: isCurrentMonth ? "var(--text-primary)" : "var(--text-muted)", fontWeight: isCurrentMonth ? 500 : 400 }}>
                      {dateObj.getDate()}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {visibleEvents.map((event) => {
                      const es = EVENT_STYLES[event.color] || EVENT_STYLES.green;
                      return (
                        <button key={event.id}
                          onClick={(e) => { e.stopPropagation(); onClickEvent(event, e.clientX, e.clientY); }}
                          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(event, e.clientX, e.clientY); }}
                          className="w-full flex items-center gap-1 px-1 py-0.5 rounded text-left truncate transition-colors"
                          onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
                          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                          <span className="w-[5px] h-[5px] rounded-full flex-shrink-0" style={{ background: dotColorMap[event.color] }} />
                          <span className="text-[10px] truncate" style={{ color: es.text }}>
                            {event.title}
                          </span>
                        </button>
                      );
                    })}
                    {extraCount > 0 && (
                      <div className="text-[10px] px-1 py-0.5 font-medium" style={{ color: "var(--text-muted)" }}>+{extraCount} more</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* ===== DAY / WEEK VIEW ===== */
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ background: "var(--card-bg)", borderTop: "1px solid var(--border-color)" }}>
          {/* Day headers */}
          <div className="grid shrink-0" style={{ gridTemplateColumns: colTemplate, borderBottom: "1px solid var(--border-color)" }}>
            <div />
            {displayDates.map((date) => {
              const today = isToday(date);
              return (
                <div key={date} className="py-2.5 text-center">
                  <div className="text-[11px] uppercase tracking-wider mb-0.5" style={{ color: today ? "var(--accent)" : "var(--text-muted)", fontWeight: 500 }}>
                    {getDayName(date)}
                  </div>
                  <div
                    className="inline-flex items-center justify-center w-9 h-9 rounded-full text-[15px] transition-all"
                    style={today ? { background: "var(--accent)", color: "white", fontWeight: 600 } : { color: "var(--text-primary)", fontWeight: 400 }}
                  >
                    {getDayNumber(date)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Time grid */}
          <div ref={gridRef} className="flex-1 min-h-0 overflow-y-auto select-none" onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
            <div className="grid relative" style={{ gridTemplateColumns: colTemplate }}>
              {/* Current time line */}
              {(() => {
                const nowH = currentTime.getHours();
                const nowM = currentTime.getMinutes();
                if (nowH >= hours[0] && nowH <= hours[hours.length - 1]) {
                  const topPx = (nowH - hours[0]) * HOUR_HEIGHT + (nowM / 60) * HOUR_HEIGHT;
                  return (
                    <div className="absolute left-0 right-0 z-30 pointer-events-none flex items-center" style={{ top: `${topPx}px` }}>
                      <div className="w-[60px] flex justify-end pr-1">
                        <span className="text-[10px] font-semibold" style={{ color: "var(--now-line)" }}>
                          {currentTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                        </span>
                      </div>
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 -ml-1" style={{ background: "var(--now-line)" }} />
                      <div className="flex-1 h-[2px]" style={{ background: "var(--now-line)" }} />
                    </div>
                  );
                }
                return null;
              })()}

              {hours.map((hour) => (
                <div key={hour} className="contents">
                  {/* Time label */}
                  <div className="flex items-start justify-end pr-2 pt-0" style={{ height: `${HOUR_HEIGHT}px` }}>
                    <span className="text-[11px] -mt-2 font-light" style={{ color: "var(--text-muted)" }}>
                      {hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`}
                    </span>
                  </div>
                  {/* Day cells */}
                  {displayDates.map((date) => {
                    const dayEvents = getEventsForDate(events, date);
                    const overlapLayout = computeOverlapLayout(dayEvents);

                    return (
                      <div
                        key={`${date}-${hour}`}
                        className="relative cursor-crosshair"
                        style={{ height: `${HOUR_HEIGHT}px`, borderTop: "1px solid var(--grid-line)", borderLeft: "1px solid var(--grid-line)" }}
                        onMouseDown={(e) => { if (e.button === 0 && !movingEvent) handleMouseDown(date, hour, e); }}
                        onMouseMove={(e) => handleCellMouseMove(date, hour, e)}
                      >
                        {/* Half-hour line */}
                        <div className="absolute left-0 right-0" style={{ top: `${HOUR_HEIGHT / 2}px`, borderTop: "1px dashed var(--grid-line)" }} />

                        {/* Drag-to-create preview */}
                        {dragging && !movingEvent && dragDate === date && dragStartMin !== null && dragEndMin !== null && (() => {
                          const startMin = Math.min(dragStartMin, dragEndMin - 15);
                          const endMin = Math.max(dragStartMin + 15, dragEndMin);
                          if (Math.floor(startMin / 60) !== hour) return null;
                          const topPx = ((startMin % 60) / 60) * HOUR_HEIGHT;
                          const heightPx = ((endMin - startMin) / 60) * HOUR_HEIGHT;
                          return (
                            <div
                              className="cal-event absolute left-1 right-1 z-20 pointer-events-none"
                              style={{ top: `${topPx}px`, height: `${heightPx}px`, background: "var(--ev-green-bg)", borderLeftColor: "var(--ev-green-border)" }}
                            >
                              <p className="text-[11px] font-medium truncate" style={{ color: "var(--ev-green-text)" }}>New Event</p>
                            </div>
                          );
                        })()}

                        {/* Move ghost preview */}
                        {movingEvent && moveGhostDate === date && Math.floor(moveGhostMin / 60) === hour && (() => {
                          const startH = parseInt(movingEvent.startTime.split(":")[0]);
                          const startM = parseInt(movingEvent.startTime.split(":")[1]);
                          const endH = parseInt(movingEvent.endTime.split(":")[0]);
                          const endM = parseInt(movingEvent.endTime.split(":")[1]);
                          const duration = (endH * 60 + endM) - (startH * 60 + startM);
                          const topPx = ((moveGhostMin % 60) / 60) * HOUR_HEIGHT;
                          const heightPx = (duration / 60) * HOUR_HEIGHT;
                          const es = EVENT_STYLES[movingEvent.color] || EVENT_STYLES.green;
                          return (
                            <div
                              className="cal-event absolute left-1 right-1 z-30 pointer-events-none"
                              style={{ top: `${topPx}px`, height: `${heightPx}px`, minHeight: "14px", background: es.bg, borderLeftColor: es.border, opacity: 0.7, overflow: "hidden" }}
                            >
                              <p className="text-[11px] font-medium truncate" style={{ color: es.text }}>{movingEvent.title}</p>
                            </div>
                          );
                        })()}

                        {/* Events */}
                        {dayEvents
                          .filter((e) => parseInt(e.startTime.split(":")[0]) === hour)
                          .filter((e) => !(movingEvent && movingEvent.id === e.id))
                          .map((event) => {
                            const startH = parseInt(event.startTime.split(":")[0]);
                            const startM = parseInt(event.startTime.split(":")[1]);
                            const endH = parseInt(event.endTime.split(":")[0]);
                            const endM = parseInt(event.endTime.split(":")[1]);
                            const durationMinutes = (endH * 60 + endM) - (startH * 60 + startM);
                            const heightPx = (durationMinutes / 60) * HOUR_HEIGHT;
                            const topPx = (startM / 60) * HOUR_HEIGHT;
                            const es = EVENT_STYLES[event.color] || EVENT_STYLES.green;
                            const overlap = overlapLayout.get(event.id) || { left: 0, width: 100 };

                            return (
                              <div
                                key={event.id}
                                onClick={(e) => { e.stopPropagation(); onClickEvent(event, e.clientX, e.clientY); }}
                                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(event, e.clientX, e.clientY); }}
                                onMouseDown={(e) => { if (e.button === 0) { e.stopPropagation(); handleEventDragStart(event, e); } }}
                                className={`cal-event absolute ${heightPx <= 20 ? "flex items-center" : ""}`}
                                style={{
                                  top: `${topPx}px`,
                                  height: `${Math.max(heightPx - 2, 12)}px`,
                                  marginTop: "1px",
                                  marginBottom: "1px",
                                  padding: heightPx <= 20 ? "0 6px" : undefined,
                                  left: `calc(${overlap.left}% + 2px)`,
                                  width: `calc(${overlap.width}% - 4px)`,
                                  background: es.bg,
                                  borderLeftColor: es.border,
                                  overflow: "hidden",
                                  zIndex: 10 + Math.max(0, Math.floor(600 / Math.max(durationMinutes, 1))),
                                  cursor: "grab",
                                }}
                              >
                                {heightPx <= 20 ? (
                                  /* Very short events: title and time on one line */
                                  <p className="text-[10px] font-medium truncate leading-none" style={{ color: es.text }}>
                                    {event.title}, {formatTime(event.startTime)}
                                  </p>
                                ) : heightPx <= 34 ? (
                                  /* Short events: title on first line, time on second */
                                  <>
                                    <p className="text-[11px] font-medium truncate leading-tight" style={{ color: es.text }}>{event.title}</p>
                                    <p className="text-[10px] truncate" style={{ color: es.text, opacity: 0.8 }}>
                                      {formatTime(event.startTime)} – {formatTime(event.endTime)}
                                    </p>
                                  </>
                                ) : (
                                  /* Normal+ events: title, time, and optionally location */
                                  <>
                                    <p className="text-[11px] font-medium truncate leading-tight" style={{ color: es.text }}>{event.title}</p>
                                    <p className="text-[10px] truncate mt-px" style={{ color: es.text, opacity: 0.7 }}>
                                      {formatTime(event.startTime)} – {formatTime(event.endTime)}
                                    </p>
                                    {heightPx > 50 && event.location && (
                                      <p className="text-[9px] truncate mt-px" style={{ color: es.text, opacity: 0.5 }}>{event.location.name}</p>
                                    )}
                                  </>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
