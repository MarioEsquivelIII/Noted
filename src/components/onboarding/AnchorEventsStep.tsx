"use client";

import { useState } from "react";
import { OnboardingStepProps, AnchorEvent, ANCHOR_EVENT_PRESETS, DAYS_OF_WEEK } from "@/lib/onboarding";

function DayChip({ day, selected, onClick }: { day: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-8 h-8 rounded-lg text-[10px] font-medium transition-all"
      style={{
        background: selected ? "rgba(124,158,108,0.2)" : "var(--bg-surface)",
        border: selected ? "2px solid var(--accent)" : "1px solid var(--border-color)",
        color: selected ? "var(--accent)" : "var(--text-secondary)",
      }}
    >
      {day.slice(0, 2)}
    </button>
  );
}

export default function AnchorEventsStep({ data, onUpdate, onNext, onBack, onSkip }: OnboardingStepProps) {
  const [editing, setEditing] = useState<number | null>(null);

  const events = data.anchor_events || [];

  const addPreset = (presetIndex: number) => {
    const preset = ANCHOR_EVENT_PRESETS[presetIndex];
    const newEvent: AnchorEvent = {
      name: preset.defaults.name || "",
      days: [],
      startTime: preset.defaults.startTime || "09:00",
      endTime: preset.defaults.endTime || "10:00",
      priority: preset.defaults.priority || "medium",
    };
    const updated = [...events, newEvent];
    onUpdate({ anchor_events: updated });
    setEditing(updated.length - 1);
  };

  const updateEvent = (index: number, partial: Partial<AnchorEvent>) => {
    const updated = events.map((ev, i) => (i === index ? { ...ev, ...partial } : ev));
    onUpdate({ anchor_events: updated });
  };

  const removeEvent = (index: number) => {
    onUpdate({ anchor_events: events.filter((_, i) => i !== index) });
    setEditing(null);
  };

  const toggleDay = (index: number, day: string) => {
    const ev = events[index];
    const days = ev.days.includes(day) ? ev.days.filter((d) => d !== day) : [...ev.days, day];
    updateEvent(index, { days });
  };

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h1 className="text-2xl font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
          Your non-negotiables
        </h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Add personal commitments that your schedule should always protect.
        </p>
      </div>

      {/* Existing anchor events */}
      {events.length > 0 && (
        <div className="space-y-2">
          {events.map((ev, i) => (
            <div key={i}>
              {editing === i ? (
                /* ─── Edit mode ─── */
                <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--accent)" }}>
                  <input
                    type="text"
                    value={ev.name}
                    onChange={(e) => updateEvent(i, { name: e.target.value })}
                    placeholder="Event name"
                    className="w-full px-3 py-2 rounded-lg text-sm"
                    style={{ background: "var(--bg-primary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
                    autoFocus
                  />

                  <div>
                    <label className="block text-[10px] mb-1.5" style={{ color: "var(--text-muted)" }}>Days</label>
                    <div className="flex gap-1">
                      {DAYS_OF_WEEK.map((day) => (
                        <DayChip key={day} day={day} selected={ev.days.includes(day)} onClick={() => toggleDay(i, day)} />
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-[10px] mb-1" style={{ color: "var(--text-muted)" }}>Start</label>
                      <input type="time" value={ev.startTime} onChange={(e) => updateEvent(i, { startTime: e.target.value })}
                        className="w-full px-2 py-1.5 rounded-lg text-xs [color-scheme:dark]"
                        style={{ background: "var(--bg-primary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} />
                    </div>
                    <div className="flex-1">
                      <label className="block text-[10px] mb-1" style={{ color: "var(--text-muted)" }}>End</label>
                      <input type="time" value={ev.endTime} onChange={(e) => updateEvent(i, { endTime: e.target.value })}
                        className="w-full px-2 py-1.5 rounded-lg text-xs [color-scheme:dark]"
                        style={{ background: "var(--bg-primary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] mb-1.5" style={{ color: "var(--text-muted)" }}>Priority</label>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => updateEvent(i, { priority: "high" })}
                        className="flex-1 px-3 py-1.5 rounded-lg text-xs transition-all"
                        style={{ background: ev.priority === "high" ? "rgba(124,158,108,0.15)" : "var(--bg-primary)", border: ev.priority === "high" ? "2px solid var(--accent)" : "1px solid var(--border-color)", color: ev.priority === "high" ? "var(--accent)" : "var(--text-secondary)" }}>
                        Must protect
                      </button>
                      <button type="button" onClick={() => updateEvent(i, { priority: "medium" })}
                        className="flex-1 px-3 py-1.5 rounded-lg text-xs transition-all"
                        style={{ background: ev.priority === "medium" ? "rgba(124,158,108,0.15)" : "var(--bg-primary)", border: ev.priority === "medium" ? "2px solid var(--accent)" : "1px solid var(--border-color)", color: ev.priority === "medium" ? "var(--accent)" : "var(--text-secondary)" }}>
                        Prefer to keep
                      </button>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button type="button" onClick={() => setEditing(null)}
                      className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                      style={{ background: "var(--accent)", color: "white" }}>
                      Done
                    </button>
                    <button type="button" onClick={() => removeEvent(i)}
                      className="px-3 py-1.5 rounded-lg text-xs transition-all"
                      style={{ background: "rgba(232,113,113,0.08)", border: "1px solid rgba(232,113,113,0.15)", color: "#e87171" }}>
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                /* ─── Display mode ─── */
                <button type="button" onClick={() => setEditing(i)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all hover:scale-[1.01]"
                  style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)" }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: ev.priority === "high" ? "rgba(124,158,108,0.2)" : "rgba(139,144,168,0.1)" }}>
                    <span className="text-sm">{ev.priority === "high" ? "!" : "·"}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium block" style={{ color: "var(--text-primary)" }}>
                      {ev.name || "Untitled event"}
                    </span>
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      {ev.days.length > 0 ? ev.days.map((d) => d.slice(0, 3)).join(", ") : "No days set"} · {ev.startTime}–{ev.endTime}
                    </span>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add preset buttons */}
      <div>
        <label className="block text-xs mb-2" style={{ color: "var(--text-muted)" }}>
          {events.length > 0 ? "Add another" : "Quick add"}
        </label>
        <div className="flex flex-wrap gap-2">
          {ANCHOR_EVENT_PRESETS.map((preset, i) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => addPreset(i)}
              className="px-3 py-1.5 rounded-xl text-xs transition-all hover:scale-[1.02]"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
            >
              + {preset.label}
            </button>
          ))}
        </div>
      </div>

      {events.length === 0 && (
        <p className="text-xs text-center py-2" style={{ color: "var(--text-muted)" }}>
          No events yet. Add activities you want protected in your schedule.
        </p>
      )}

      <div className="flex gap-3 pt-1">
        <button onClick={onBack}
          className="px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}>
          Back
        </button>
        <button onClick={onNext}
          className="flex-1 px-4 py-2.5 rounded-xl text-white text-sm font-medium transition-all hover:scale-[1.02]"
          style={{ background: "var(--accent)" }}>
          Continue
        </button>
      </div>
      <button onClick={onSkip} className="w-full text-xs text-center transition-colors" style={{ color: "var(--text-muted)" }}>
        Skip this step
      </button>
    </div>
  );
}
