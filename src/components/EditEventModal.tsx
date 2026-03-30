"use client";

import { useState, useEffect, useRef } from "react";
import { CalendarEvent } from "@/lib/events";

interface EditEventModalProps {
  event: CalendarEvent;
  onSave: (updated: CalendarEvent) => void;
  onClose: () => void;
}

export default function EditEventModal({ event, onSave, onClose }: EditEventModalProps) {
  const [title, setTitle] = useState(event.title);
  const [date, setDate] = useState(event.date);
  const [startTime, setStartTime] = useState(event.startTime);
  const [endTime, setEndTime] = useState(event.endTime);
  const [color, setColor] = useState(event.color);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ ...event, title, date, startTime, endTime, color });
  };

  const colors: CalendarEvent["color"][] = ["green", "blue", "orange", "red", "purple", "gray", "teal", "yellow", "pink"];
  const colorDisplay: Record<string, string> = {
    green: "bg-[#5a8a4a]",
    blue: "bg-[#4a7a8a]",
    orange: "bg-[#8a7040]",
    red: "bg-[#8a4a4a]",
    purple: "bg-[#7a5a8a]",
    gray: "bg-[#6a6a6a]",
    teal: "bg-[#4a8a82]",
    yellow: "bg-[#a08c32]",
    pink: "bg-[#a05078]",
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: "var(--overlay-bg)", backdropFilter: "blur(4px)" }}>
      <div ref={ref} className="w-full max-w-sm mx-4 rounded-2xl shadow-2xl overflow-hidden" style={{ background: "var(--card-bg)", border: "1px solid var(--border-color)" }}>
        <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Edit Event</h3>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm transition-colors"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm transition-colors"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>Start</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm transition-colors"
                style={{ background: "var(--bg-primary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
              />
            </div>
            <div>
              <label className="block text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>End</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm transition-colors"
                style={{ background: "var(--bg-primary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>Color</label>
            <div className="flex gap-2">
              {colors.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full ${colorDisplay[c]} transition-all ${
                    color === c ? "ring-2 ring-white/40 scale-110" : "hover:scale-105"
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg text-sm transition-colors"
              style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2.5 rounded-lg bg-[#5a8a4a] text-sm text-white font-medium hover:bg-[#6a9a5a] transition-colors"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
