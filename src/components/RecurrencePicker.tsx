"use client";

import { useState } from "react";
import { type RecurrenceRule } from "@/lib/events";
import { getRecurrencePreviewText } from "@/lib/recurrence";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const FREQUENCY_OPTIONS: { value: RecurrenceRule["frequency"] | "none"; label: string }[] = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Every weekday (Mon-Fri)" },
  { value: "weekly", label: "Every week" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Every month" },
  { value: "custom", label: "Custom..." },
];

interface RecurrencePickerProps {
  rule: RecurrenceRule | null;
  onChange: (rule: RecurrenceRule | null) => void;
  /** The date of the event being edited — used for default day selection */
  eventDate?: string;
}

export default function RecurrencePicker({ rule, onChange, eventDate }: RecurrencePickerProps) {
  const [showCustom, setShowCustom] = useState(rule?.frequency === "custom");

  const currentFreq = rule?.frequency || "none";

  const handleFrequencyChange = (freq: string) => {
    if (freq === "none") {
      onChange(null);
      setShowCustom(false);
      return;
    }

    if (freq === "custom") {
      setShowCustom(true);
      // Default custom: the day of the event
      const defaultDay = eventDate ? DAYS[new Date(eventDate + "T12:00:00").getDay()] : "Monday";
      onChange({
        frequency: "custom",
        daysOfWeek: [defaultDay],
        endType: "never",
      });
      return;
    }

    setShowCustom(false);
    const newRule: RecurrenceRule = {
      frequency: freq as RecurrenceRule["frequency"],
      endType: rule?.endType || "never",
      endDate: rule?.endDate,
      endCount: rule?.endCount,
    };

    // Set default daysOfWeek for weekly/biweekly
    if ((freq === "weekly" || freq === "biweekly") && eventDate) {
      const day = DAYS[new Date(eventDate + "T12:00:00").getDay()];
      newRule.daysOfWeek = [day];
    }

    // Set default dayOfMonth for monthly
    if (freq === "monthly" && eventDate) {
      newRule.dayOfMonth = new Date(eventDate + "T12:00:00").getDate();
    }

    onChange(newRule);
  };

  const toggleDay = (day: string) => {
    if (!rule) return;
    const days = rule.daysOfWeek || [];
    const updated = days.includes(day) ? days.filter((d) => d !== day) : [...days, day];
    if (updated.length === 0) return; // must have at least one day
    onChange({ ...rule, daysOfWeek: updated });
  };

  const handleEndTypeChange = (endType: RecurrenceRule["endType"]) => {
    if (!rule) return;
    onChange({ ...rule, endType, endDate: endType === "date" ? rule.endDate : undefined, endCount: endType === "count" ? (rule.endCount || 10) : undefined });
  };

  return (
    <div className="space-y-3">
      {/* Frequency selector */}
      <div>
        <label className="block text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>Repeat</label>
        <select
          value={showCustom ? "custom" : currentFreq}
          onChange={(e) => handleFrequencyChange(e.target.value)}
          className="w-full px-3 py-2 rounded-xl text-sm [color-scheme:dark]"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
        >
          {FREQUENCY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Day chips for weekly/biweekly/custom */}
      {rule && (rule.frequency === "weekly" || rule.frequency === "biweekly" || rule.frequency === "custom") && (
        <div>
          <label className="block text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>On these days</label>
          <div className="flex gap-1">
            {DAYS.map((day) => {
              const selected = (rule.daysOfWeek || []).includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className="w-9 h-9 rounded-lg text-[10px] font-medium transition-all"
                  style={{
                    background: selected ? "rgba(124,158,108,0.2)" : "var(--bg-surface)",
                    border: selected ? "2px solid var(--accent)" : "1px solid var(--border-color)",
                    color: selected ? "var(--accent)" : "var(--text-secondary)",
                  }}
                >
                  {day.slice(0, 2)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* End condition */}
      {rule && (
        <div className="space-y-2">
          <label className="block text-xs" style={{ color: "var(--text-muted)" }}>Ends</label>
          <div className="flex gap-2">
            {(["never", "date", "count"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => handleEndTypeChange(type)}
                className="px-3 py-1.5 rounded-lg text-xs transition-all"
                style={{
                  background: rule.endType === type ? "rgba(124,158,108,0.15)" : "var(--bg-surface)",
                  border: rule.endType === type ? "2px solid var(--accent)" : "1px solid var(--border-color)",
                  color: rule.endType === type ? "var(--accent)" : "var(--text-secondary)",
                }}
              >
                {type === "never" ? "Never" : type === "date" ? "On date" : "After"}
              </button>
            ))}
          </div>

          {rule.endType === "date" && (
            <input
              type="date"
              value={rule.endDate || ""}
              onChange={(e) => onChange({ ...rule, endDate: e.target.value })}
              className="w-full px-3 py-2 rounded-xl text-sm [color-scheme:dark]"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
            />
          )}

          {rule.endType === "count" && (
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={200}
                value={rule.endCount || 10}
                onChange={(e) => onChange({ ...rule, endCount: Math.max(1, Number(e.target.value)) })}
                className="w-20 px-3 py-2 rounded-xl text-sm [color-scheme:dark]"
                style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
              />
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>occurrences</span>
            </div>
          )}
        </div>
      )}

      {/* Preview text */}
      <div className="text-xs italic pt-1" style={{ color: "var(--text-muted)" }}>
        {getRecurrencePreviewText(rule)}
      </div>
    </div>
  );
}
