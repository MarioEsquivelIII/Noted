"use client";

import { useState, useEffect, useRef } from "react";
import { CalendarEvent, formatTime, getDayName, getMonthName, getDayNumber } from "@/lib/events";

interface EventDetailPanelProps {
  event: CalendarEvent;
  position: { x: number; y: number };
  onClose: () => void;
  onSave: (updated: CalendarEvent) => void;
  onDelete: (id: string) => void;
}

const colors: { name: CalendarEvent["color"]; bg: string; label: string }[] = [
  { name: "green", bg: "bg-[#5a8a4a]", label: "Green" },
  { name: "blue", bg: "bg-[#4a7a8a]", label: "Blue" },
  { name: "orange", bg: "bg-[#8a7040]", label: "Orange" },
  { name: "red", bg: "bg-[#8a4a4a]", label: "Red" },
  { name: "purple", bg: "bg-[#7a5a8a]", label: "Purple" },
  { name: "gray", bg: "bg-[#6a6a6a]", label: "Gray" },
  { name: "teal", bg: "bg-[#4a8a82]", label: "Teal" },
  { name: "yellow", bg: "bg-[#a08c32]", label: "Yellow" },
  { name: "pink", bg: "bg-[#a05078]", label: "Pink" },
];

export default function EventDetailPanel({ event, position, onClose, onSave, onDelete }: EventDetailPanelProps) {
  const [title, setTitle] = useState(event.title);
  const [startTime, setStartTime] = useState(event.startTime);
  const [endTime, setEndTime] = useState(event.endTime);
  const [date, setDate] = useState(event.date);
  const [color, setColor] = useState(event.color);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onSave({ ...event, title: title || event.title, startTime, endTime, date, color });
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onSave({ ...event, title: title || event.title, startTime, endTime, date, color });
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose, onSave, event, title, startTime, endTime, date, color]);

  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const durationMins = (eh * 60 + em) - (sh * 60 + sm);
  const durationStr = durationMins >= 60 ? `${Math.floor(durationMins / 60)}h${durationMins % 60 > 0 ? ` ${durationMins % 60}m` : ""}` : `${durationMins}m`;

  // Meal detection and suggestions near GT campus
  const titleLower = title.toLowerCase();
  const isMealEvent = ["breakfast", "brunch", "lunch", "dinner"].some((m) => titleLower.includes(m));
  const mealType = titleLower.includes("breakfast") || titleLower.includes("brunch") ? "breakfast spots"
    : titleLower.includes("lunch") ? "lunch spots"
    : titleLower.includes("dinner") ? "dinner spots" : "restaurants";

  const mealSuggestionsMap: Record<string, { name: string; rating: string }[]> = {
    "breakfast spots": [
      { name: "Waffle House — North Ave", rating: "4.2" },
      { name: "Highland Bakery — 5th St", rating: "4.5" },
      { name: "Einstein Bros — Student Center", rating: "3.9" },
      { name: "Starbucks — Tech Square", rating: "4.1" },
    ],
    "lunch spots": [
      { name: "Tin Drum Asian Kitchen — Tech Square", rating: "4.3" },
      { name: "Moe's Southwest — Spring St", rating: "4.0" },
      { name: "Subway — Student Center", rating: "3.7" },
      { name: "Panera Bread — 5th St", rating: "4.2" },
    ],
    "dinner spots": [
      { name: "Antico Pizza — Hemphill", rating: "4.7" },
      { name: "The Varsity — North Ave", rating: "4.0" },
      { name: "Tin Drum Asian Kitchen — Tech Square", rating: "4.3" },
      { name: "Publik Draft House — Hemphill", rating: "4.4" },
    ],
    restaurants: [
      { name: "Antico Pizza — Hemphill", rating: "4.7" },
      { name: "Tin Drum — Tech Square", rating: "4.3" },
    ],
  };
  const mealSuggestions = mealSuggestionsMap[mealType] || [];

  const panelWidth = 360;
  const left = Math.min(position.x, window.innerWidth - panelWidth - 20);
  const top = Math.min(Math.max(position.y - 100, 20), window.innerHeight - 500);

  return (
    <div className="fixed inset-0 z-[90]" onClick={(e) => { if (e.target === e.currentTarget) { onSave({ ...event, title: title || event.title, startTime, endTime, date, color }); onClose(); } }}>
      <div
        ref={ref}
        className="absolute rounded-2xl shadow-2xl overflow-hidden"
        style={{ left, top, width: panelWidth, background: "var(--card-bg)", border: "1px solid var(--border-color)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>Event</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
          </div>
          <div className="flex items-center gap-1">
            <button className="p-1.5 rounded-md transition-colors" title="More options" onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
            </button>
            <button className="p-1.5 rounded-md transition-colors" title="Open in new window" onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            </button>
            <button onClick={() => { onSave({ ...event, title: title || event.title, startTime, endTime, date, color }); onClose(); }} className="p-1.5 rounded-md transition-colors" onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        <div className="px-4 py-4 space-y-4">
          {/* Title */}
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full text-lg font-medium bg-transparent border-none outline-none"
            style={{ color: "var(--text-primary)" }}
            placeholder="Event name"
          />

          {/* Time row */}
          <div className="flex items-center gap-3 text-sm">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="bg-transparent border-none text-sm font-medium"
                style={{ color: "var(--text-primary)" }}
              />
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="bg-transparent border-none text-sm font-medium"
                style={{ color: "var(--text-primary)" }}
              />
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>{durationStr}</span>
            </div>
          </div>

          {/* Date */}
          <div className="text-sm ml-7" style={{ color: "var(--text-secondary)" }}>
            {getDayName(date)} {getMonthName(date).slice(0, 3)} {getDayNumber(date)}
          </div>

          {/* Quick options */}
          <div className="flex items-center gap-3 ml-7 text-xs" style={{ color: "var(--text-muted)" }}>
            <button className="hover:opacity-80 transition-colors">All-day</button>
            <button className="hover:opacity-80 transition-colors">Time zone</button>
            <button className="hover:opacity-80 transition-colors">Repeat</button>
          </div>

          <div className="my-2" style={{ borderTop: "1px solid var(--border-subtle)" }} />

          {/* Additional fields */}
          <div className="space-y-3">
            <button className="flex items-center gap-3 w-full text-sm transition-colors py-1" style={{ color: "var(--text-muted)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
              </svg>
              Participants
            </button>
            {/* Location */}
            <div className="flex items-start gap-3 w-full text-sm py-1">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={event.location ? "var(--text-secondary)" : "var(--text-muted)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 flex-shrink-0">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
              </svg>
              <div className="flex-1">
                {event.location ? (
                  <span style={{ color: "var(--text-primary)" }}>{event.location.name}</span>
                ) : (
                  <span style={{ color: "var(--text-muted)" }}>Location</span>
                )}
                {isMealEvent && (
                  <div className="mt-2 space-y-1.5">
                    <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                      Nearby {mealType}
                    </p>
                    {mealSuggestions.map((s, i) => (
                      <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors cursor-pointer" style={{ background: "var(--bg-tertiary)" }}
                        onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
                        onMouseLeave={(e) => e.currentTarget.style.background = "var(--bg-tertiary)"}
                      >
                        <span className="text-xs" style={{ color: "var(--text-primary)" }}>{s.name}</span>
                        <span className="text-[10px] ml-auto" style={{ color: "var(--text-muted)" }}>{s.rating}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <button className="flex items-center gap-3 w-full text-sm transition-colors py-1" style={{ color: "var(--text-muted)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
              Docs and links
            </button>
          </div>

          <div className="my-2" style={{ borderTop: "1px solid var(--border-subtle)" }} />

          {/* Description */}
          <div className="text-sm italic" style={{ color: "var(--text-muted)" }}>Description</div>

          <div className="my-2" style={{ borderTop: "1px solid var(--border-subtle)" }} />

          {/* Color picker */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowColorPicker(!showColorPicker)}
              className="flex items-center gap-2 text-sm transition-colors"
              style={{ color: "var(--text-secondary)" }}
            >
              <div className={`w-4 h-4 rounded ${colors.find(c => c.name === color)?.bg || "bg-[#5a8a4a]"}`} />
              <span>{colors.find(c => c.name === color)?.label || "Color"}</span>
            </button>
            <button
              onClick={() => onDelete(event.id)}
              className="text-xs text-[#e87171] hover:text-[#ff8888] transition-colors"
            >
              Delete
            </button>
          </div>

          {showColorPicker && (
            <div className="flex gap-2 ml-6">
              {colors.map((c) => (
                <button
                  key={c.name}
                  onClick={() => { setColor(c.name); setShowColorPicker(false); }}
                  className={`w-6 h-6 rounded-full ${c.bg} transition-all ${color === c.name ? "ring-2 ring-white/40 scale-110" : "hover:scale-110"}`}
                  title={c.label}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
