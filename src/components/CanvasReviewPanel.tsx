"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { generateId, type CalendarEvent } from "@/lib/events";
import { CANVAS_IMPORT_KEY } from "@/lib/canvas/constants";

/** Shape returned by /api/planner/ingest → items[] */
export interface PlannerItemSummary {
  id: string;
  title: string;
  description?: string;
  itemType: string;
  courseName?: string;
  courseCode?: string;
  dueAt?: string;
  startAt?: string;
  endAt?: string;
  pointsPossible?: number;
  url?: string;
  status?: string;
  isFixedTime?: boolean;
  workloadMinutes?: number;
  confidence?: number;
  source?: string;
}

// Types that go on calendar directly (fixed-time events)
const CALENDAR_TYPES = new Set(["exam", "class_meeting", "event"]);
const TYPE_COLORS: Record<string, CalendarEvent["color"]> = {
  assignment: "blue", quiz: "orange", exam: "red", project: "purple",
  lab: "teal", discussion: "green", reading: "yellow", class_meeting: "blue",
  event: "gray", other: "gray",
};

const TYPE_LABELS: Record<string, string> = {
  assignment: "Assignment", quiz: "Quiz", exam: "Exam", project: "Project",
  lab: "Lab", discussion: "Discussion", reading: "Reading",
  class_meeting: "Class", event: "Event", other: "Other",
};

type ItemMode = "calendar" | "context" | "off";

interface CanvasReviewPanelProps {
  items: PlannerItemSummary[];
  onDone: () => void;
  compact?: boolean;
}

export default function CanvasReviewPanel({ items, onDone, compact }: CanvasReviewPanelProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  // Smart defaults: exams/fixed → calendar, assignments → context only
  const [modes, setModes] = useState<Record<string, ItemMode>>(() => {
    const map: Record<string, ItemMode> = {};
    for (const item of items) {
      if (CALENDAR_TYPES.has(item.itemType) || item.isFixedTime) {
        map[item.id] = "calendar";
      } else {
        map[item.id] = "context"; // AI knows about it, but not cluttering the calendar
      }
    }
    return map;
  });

  const grouped = useMemo(() => {
    const map: Record<string, PlannerItemSummary[]> = {};
    for (const item of items) {
      const key = item.courseCode || item.courseName || "Other";
      if (!map[key]) map[key] = [];
      map[key].push(item);
    }
    return map;
  }, [items]);

  const calendarCount = Object.values(modes).filter((m) => m === "calendar").length;
  const contextCount = Object.values(modes).filter((m) => m === "context").length;

  const cycleMode = (id: string) => {
    setModes((prev) => {
      const current = prev[id];
      // cycle: calendar → context → off → calendar
      const next = current === "calendar" ? "context" : current === "context" ? "off" : "calendar";
      return { ...prev, [id]: next };
    });
  };

  const setAllInCourse = (courseKey: string, mode: ItemMode) => {
    const courseItems = grouped[courseKey] || [];
    setModes((prev) => {
      const next = { ...prev };
      for (const item of courseItems) next[item.id] = mode;
      return next;
    });
  };

  /** Confirm selection — create calendar events for items the user toggled to "calendar".
   *  Lectures are already on the calendar from ingest. Labs/exams toggled here get added. */
  const handleConfirm = async () => {
    const calendarEvents: CalendarEvent[] = [];

    for (const item of items) {
      if (modes[item.id] !== "calendar") continue;

      const color = TYPE_COLORS[item.itemType] || "gray";

      // Lab/class meetings — create calendar events via API
      if (item.itemType === "class_meeting") {
        // Tell the server to expand this planner item into calendar events
        try {
          await fetch("/api/planner/expand-class", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ plannerItemId: item.id }),
          });
        } catch { /* silent */ }
        continue;
      }

      // Skip lecture class_meetings — already on calendar from ingest
      if (item.itemType === "class_meeting") continue;

      // Exams and other items with due dates
      if (item.dueAt) {
        const due = new Date(item.dueAt);
        const h = due.getHours();
        const m = due.getMinutes();
        const startH = h === 0 && m === 0 ? 23 : h;
        const startM = h === 0 && m === 0 ? 0 : m;
        const duration = item.itemType === "exam" ? 120 : 30;
        const endTotal = startM + duration;
        calendarEvents.push({
          id: generateId(),
          title: `${item.courseCode ? item.courseCode + " " : ""}${item.title}`,
          date: due.toISOString().split("T")[0],
          startTime: `${String(startH).padStart(2, "0")}:${String(startM).padStart(2, "0")}`,
          endTime: `${String(startH + Math.floor(endTotal / 60)).padStart(2, "0")}:${String(endTotal % 60).padStart(2, "0")}`,
          color,
          isProtected: item.itemType === "exam",
        });
      }
    }

    // Archive items the user toggled "off" so they don't appear in AI context
    const offIds = items.filter((i) => modes[i.id] === "off").map((i) => i.id);
    if (offIds.length > 0) {
      try {
        for (const id of offIds) {
          await fetch("/api/planner/items", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, is_archived: true }) }).catch(() => {});
        }
      } catch { /* silent */ }
    }

    if (calendarEvents.length > 0) {
      sessionStorage.setItem(CANVAS_IMPORT_KEY, JSON.stringify({ events: calendarEvents, replaceAll: false }));
    }

    router.push("/home");
    onDone();
  };

  /** Generate a full schedule: exams on calendar + study blocks for all assignments */
  const handleGenerateSchedule = async () => {
    setLoading(true);
    try {
      // Step 1: Get recommended work blocks from the planner engine
      const res = await fetch("/api/planner/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ windowDays: 21 }),
      });
      const data = await res.json();

      const calendarEvents: CalendarEvent[] = [];

      // Step 2: Add exam/fixed calendar items
      for (const item of items) {
        if (modes[item.id] === "off") continue;
        if (modes[item.id] !== "calendar") continue;
        const color = TYPE_COLORS[item.itemType] || "gray";
        if (item.dueAt) {
          const due = new Date(item.dueAt);
          const h = due.getHours();
          const m = due.getMinutes();
          const startH = h === 0 && m === 0 ? 23 : h;
          const startM = h === 0 && m === 0 ? 0 : m;
          const duration = item.itemType === "exam" ? 120 : 30;
          const endTotal = startM + duration;
          calendarEvents.push({
            id: generateId(),
            title: `${item.courseCode ? item.courseCode + " " : ""}${item.title}`,
            date: due.toISOString().split("T")[0],
            startTime: `${String(startH).padStart(2, "0")}:${String(startM).padStart(2, "0")}`,
            endTime: `${String(startH + Math.floor(endTotal / 60)).padStart(2, "0")}:${String(endTotal % 60).padStart(2, "0")}`,
            color,
            isProtected: item.itemType === "exam",
          });
        }
      }

      // Step 3: Add generated work/study blocks
      if (res.ok && data.blocks?.length > 0) {
        for (const block of data.blocks as { title: string; date: string; startTime: string; endTime: string; color: string; durationMinutes: number; reasoning: string }[]) {
          calendarEvents.push({
            id: generateId(),
            title: block.title,
            date: block.date,
            startTime: block.startTime,
            endTime: block.endTime,
            color: (block.color || "green") as CalendarEvent["color"],
            description: block.reasoning,
          });
        }
      }

      // Step 4: Push everything to calendar
      if (calendarEvents.length > 0) {
        sessionStorage.setItem(CANVAS_IMPORT_KEY, JSON.stringify({ events: calendarEvents, replaceAll: false }));
      }

      router.push("/home");
      onDone();
    } catch {
      handleConfirm();
    } finally {
      setLoading(false);
    }
  };

  const formatDueDate = (iso?: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };

  const formatWorkload = (mins?: number) => {
    if (!mins) return "";
    if (mins < 60) return `~${mins}min`;
    return `~${(mins / 60).toFixed(1)}h`;
  };

  const modeIcon = (mode: ItemMode) => {
    switch (mode) {
      case "calendar": return { bg: "var(--accent)", label: "On calendar", symbol: "cal" };
      case "context": return { bg: "rgba(124,158,108,0.4)", label: "AI context only", symbol: "ai" };
      case "off": return { bg: "transparent", label: "Excluded", symbol: "" };
    }
  };

  return (
    <div className={`space-y-4 ${compact ? "" : "rounded-xl p-5"}`} style={compact ? {} : { background: "var(--bg-surface)", border: "1px solid var(--border-color)" }}>
      {/* Header */}
      <div>
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Review Canvas data
        </h3>
        <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
          Click items to cycle: <span style={{ color: "var(--accent)" }}>green = on calendar</span> · <span style={{ color: "rgba(124,158,108,0.7)" }}>dim green = AI context only</span> · <span style={{ color: "var(--text-muted)" }}>off = excluded</span>
        </p>
      </div>

      {/* Grouped items */}
      <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1" style={{ scrollbarWidth: "thin" }}>
        {Object.entries(grouped).map(([courseKey, courseItems]) => {
          const calCount = courseItems.filter((i) => modes[i.id] === "calendar").length;
          const ctxCount = courseItems.filter((i) => modes[i.id] === "context").length;

          return (
            <div key={courseKey}>
              {/* Course header */}
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                  {courseKey}
                  <span className="ml-1.5 font-normal" style={{ color: "var(--text-muted)" }}>
                    ({calCount} cal · {ctxCount} ai · {courseItems.length - calCount - ctxCount} off)
                  </span>
                </span>
                <div className="flex gap-1">
                  <button onClick={() => setAllInCourse(courseKey, "calendar")} className="text-[9px] px-1.5 py-0.5 rounded transition-colors" style={{ color: "var(--accent)", background: "rgba(124,158,108,0.1)" }}>Cal</button>
                  <button onClick={() => setAllInCourse(courseKey, "context")} className="text-[9px] px-1.5 py-0.5 rounded transition-colors" style={{ color: "var(--text-muted)", background: "var(--bg-hover)" }}>AI</button>
                  <button onClick={() => setAllInCourse(courseKey, "off")} className="text-[9px] px-1.5 py-0.5 rounded transition-colors" style={{ color: "var(--text-muted)", background: "var(--bg-hover)" }}>Off</button>
                </div>
              </div>

              {/* Items */}
              <div className="space-y-1 ml-1">
                {courseItems.map((item) => {
                  const mode = modes[item.id];
                  const mi = modeIcon(mode);
                  const typeColor = TYPE_COLORS[item.itemType] || "gray";
                  return (
                    <button
                      key={item.id}
                      onClick={() => cycleMode(item.id)}
                      className="flex items-center gap-2.5 w-full text-left px-2.5 py-2 rounded-lg transition-all"
                      style={{ opacity: mode === "off" ? 0.35 : 1 }}
                    >
                      {/* Mode indicator */}
                      <div
                        className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-colors"
                        style={{ background: mi.bg, border: mode === "off" ? "1.5px solid var(--border-color)" : "none" }}
                      >
                        {mode === "calendar" && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                        {mode === "context" && (
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="4" />
                          </svg>
                        )}
                      </div>

                      {/* Item info */}
                      <div className="flex-1 min-w-0">
                        <span className="text-xs truncate block" style={{ color: "var(--text-primary)" }}>{item.title}</span>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                            style={{ background: `var(--ev-${typeColor}-bg, rgba(139,144,168,0.1))`, color: `var(--ev-${typeColor}-text, var(--text-muted))` }}>
                            {TYPE_LABELS[item.itemType] || item.itemType}
                          </span>
                          {item.dueAt && <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{formatDueDate(item.dueAt)}</span>}
                          {item.workloadMinutes && item.workloadMinutes > 0 && <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{formatWorkload(item.workloadMinutes)}</span>}
                          {item.pointsPossible ? <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{item.pointsPossible}pts</span> : null}
                          {mode !== "off" && <span className="text-[9px]" style={{ color: mode === "calendar" ? "var(--accent)" : "var(--text-muted)" }}>{mi.label}</span>}
                        </div>
                        {/* Show schedule details for class meetings (labs, lectures) */}
                        {item.itemType === "class_meeting" && item.description && (
                          <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>
                            {item.description.split("\n")[0]}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="pt-3 space-y-2" style={{ borderTop: "1px solid var(--border-color)" }}>
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {calendarCount} on calendar · {contextCount} AI context
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleConfirm}
            className="flex-1 px-4 py-2 rounded-xl text-xs font-medium text-white transition-all hover:scale-[1.02]"
            style={{ background: "var(--accent)" }}
          >
            Confirm selection
          </button>
          <button
            onClick={handleGenerateSchedule}
            disabled={loading}
            className="flex-1 px-4 py-2 rounded-xl text-xs font-medium transition-all hover:scale-[1.02] disabled:opacity-50"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--accent)", color: "var(--accent)" }}
          >
            {loading ? "Generating..." : "Generate schedule"}
          </button>
        </div>
        <p className="text-[10px] text-center" style={{ color: "var(--text-muted)" }}>
          &quot;Generate schedule&quot; creates study blocks based on your preferences and deadlines.
        </p>
      </div>
    </div>
  );
}
