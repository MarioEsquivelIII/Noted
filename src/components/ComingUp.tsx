"use client";

import { CalendarEvent, getEventsForDate, formatTime, getDayName, getMonthName, getDayNumber, isToday, getUpcomingDates } from "@/lib/events";

interface ComingUpProps {
  events: CalendarEvent[];
  onContextMenu: (event: CalendarEvent, x: number, y: number) => void;
}

const colorVar: Record<string, string> = {
  green: "var(--ev-green-border)", blue: "var(--ev-blue-border)", orange: "var(--ev-orange-border)",
  red: "var(--ev-red-border)", purple: "var(--ev-purple-border)", gray: "var(--ev-gray-border)",
};

const textVar: Record<string, string> = {
  green: "var(--ev-green-text)", blue: "var(--ev-blue-text)", orange: "var(--ev-orange-text)",
  red: "var(--ev-red-text)", purple: "var(--ev-purple-text)", gray: "var(--ev-gray-text)",
};

export default function ComingUp({ events, onContextMenu }: ComingUpProps) {
  const dates = getUpcomingDates(7);
  const datesWithEvents = dates.filter((d) => {
    const dayEvents = getEventsForDate(events, d);
    return dayEvents.length > 0 || isToday(d);
  });

  return (
    <div className="w-full max-w-2xl mx-auto px-3 sm:px-5">
      <h2 className="text-lg sm:text-xl font-medium mb-4 sm:mb-5" style={{ color: "var(--text-primary)" }}>Coming up</h2>

      <div className="space-y-2">
        {datesWithEvents.map((date) => {
          const dayEvents = getEventsForDate(events, date);
          const today = isToday(date);

          return (
            <div
              key={date}
              className="rounded-2xl px-5 py-4 transition-colors"
              style={{
                background: today ? "var(--glass-bg)" : "transparent",
                backdropFilter: today ? "blur(12px)" : "none",
                WebkitBackdropFilter: today ? "blur(12px)" : "none",
                border: today ? "1px solid var(--glass-border)" : "1px solid transparent",
              }}
            >
              {/* Date row */}
              <div className="flex items-center gap-3 mb-2">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-sm"
                  style={today
                    ? { background: "var(--accent)", color: "white", fontWeight: 600 }
                    : { color: "var(--text-secondary)", fontWeight: 500 }
                  }
                >
                  {getDayNumber(date)}
                </div>
                <div>
                  <span className="text-[13px] font-medium" style={{ color: today ? "var(--accent)" : "var(--text-primary)" }}>
                    {today ? "Today" : getDayName(date)}
                  </span>
                  <span className="text-[13px] ml-1.5" style={{ color: "var(--text-muted)" }}>
                    {getMonthName(date).slice(0, 3)} {getDayNumber(date)}
                  </span>
                </div>
              </div>

              {/* Events */}
              {dayEvents.length === 0 ? (
                <p className="text-[13px] ml-11" style={{ color: "var(--text-muted)" }}>No events</p>
              ) : (
                <div className="ml-11 space-y-0.5">
                  {dayEvents.map((event) => (
                    <div
                      key={event.id}
                      onContextMenu={(e) => { e.preventDefault(); onContextMenu(event, e.clientX, e.clientY); }}
                      className="flex items-center gap-3 px-3 py-2 -mx-3 rounded-xl cursor-default transition-colors"
                      onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                    >
                      <div className="w-[3px] h-5 rounded-full flex-shrink-0" style={{ background: colorVar[event.color] || colorVar.green }} />
                      <div className="min-w-0 flex-1 flex items-baseline gap-2">
                        <span className="text-[13px] font-medium truncate" style={{ color: textVar[event.color] || "var(--text-primary)" }}>
                          {event.title}
                        </span>
                        <span className="text-[12px] flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                          {formatTime(event.startTime)} – {formatTime(event.endTime)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
