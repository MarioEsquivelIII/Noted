"use client";

import { useState } from "react";
import { type ExtractedCandidate } from "@/app/api/extract/route";
import { generateId, type CalendarEvent } from "@/lib/events";

interface ExtractionReviewProps {
  candidates: ExtractedCandidate[];
  onConfirm: (events: CalendarEvent[]) => void;
  onChatFallback: () => void; // "Just chat about this" button
  onCancel: () => void;
}

const TYPE_ICONS: Record<string, string> = {
  event: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  task: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
  note: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
  reminder: "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9",
};

const TYPE_COLORS: Record<string, string> = {
  event: "blue",
  task: "orange",
  note: "gray",
  reminder: "yellow",
};

function confidenceColor(c: number): string {
  if (c >= 0.8) return "#5a8a4a"; // green
  if (c >= 0.5) return "#a08c32"; // yellow
  return "#e87171"; // red
}

function confidenceLabel(c: number): string {
  if (c >= 0.8) return "High";
  if (c >= 0.5) return "Medium";
  return "Low";
}

export default function ExtractionReview({ candidates, onConfirm, onChatFallback, onCancel }: ExtractionReviewProps) {
  const [items, setItems] = useState(
    candidates.map((c) => ({
      ...c,
      enabled: c.confidence >= 0.4, // auto-disable very low confidence
      // Allow editing
      editTitle: c.title,
      editDate: c.date || "",
      editStartTime: c.startTime || "",
      editEndTime: c.endTime || "",
    }))
  );

  const enabledCount = items.filter((i) => i.enabled).length;

  const toggle = (id: string) => {
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, enabled: !i.enabled } : i));
  };

  const updateField = (id: string, field: string, value: string) => {
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, [field]: value } : i));
  };

  const handleConfirm = () => {
    const events: CalendarEvent[] = items
      .filter((i) => i.enabled && i.editDate)
      .map((i) => ({
        id: generateId(),
        title: i.editTitle,
        date: i.editDate,
        startTime: i.editStartTime || "09:00",
        endTime: i.editEndTime || "10:00",
        color: (TYPE_COLORS[i.type] || "gray") as CalendarEvent["color"],
        description: i.description || undefined,
        ...(i.location ? { location: { name: i.location, lat: 0, lng: 0 } } : {}),
      }));

    onConfirm(events);
  };

  if (candidates.length === 0) {
    return (
      <div className="rounded-2xl p-6 text-center space-y-4" style={{ background: "var(--card-bg)", border: "1px solid var(--border-color)" }}>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No events or tasks found in this image.</p>
        <div className="flex gap-2 justify-center">
          <button onClick={onChatFallback} className="px-4 py-2 rounded-xl text-xs font-medium transition-all hover:scale-[1.02]"
            style={{ background: "var(--accent)", color: "white" }}>
            Chat about this image
          </button>
          <button onClick={onCancel} className="px-4 py-2 rounded-xl text-xs transition-all"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)", color: "var(--text-secondary)" }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card-bg)", border: "1px solid var(--border-color)" }}>
      {/* Header */}
      <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <div>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Found {candidates.length} item{candidates.length !== 1 ? "s" : ""}
          </h3>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
            Review and edit before adding to your calendar
          </p>
        </div>
        <button onClick={onChatFallback} className="text-[11px] px-2.5 py-1 rounded-lg transition-colors"
          style={{ color: "var(--accent)", background: "rgba(124,158,108,0.1)" }}>
          Just chat about this
        </button>
      </div>

      {/* Candidates list */}
      <div className="max-h-[400px] overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
        {items.map((item) => (
          <div key={item.id} className="px-5 py-3 transition-colors" style={{
            borderBottom: "1px solid var(--border-subtle)",
            opacity: item.enabled ? 1 : 0.4,
          }}>
            <div className="flex items-start gap-3">
              {/* Toggle */}
              <button onClick={() => toggle(item.id)} className="mt-1 flex-shrink-0">
                <div className="w-4 h-4 rounded flex items-center justify-center transition-colors"
                  style={{ background: item.enabled ? "var(--accent)" : "transparent", border: item.enabled ? "none" : "1.5px solid var(--border-color)" }}>
                  {item.enabled && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
              </button>

              {/* Content */}
              <div className="flex-1 min-w-0 space-y-2">
                {/* Title + type + confidence */}
                <div className="flex items-center gap-2 flex-wrap">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d={TYPE_ICONS[item.type] || TYPE_ICONS.event} />
                  </svg>
                  <input
                    type="text"
                    value={item.editTitle}
                    onChange={(e) => updateField(item.id, "editTitle", e.target.value)}
                    className="flex-1 min-w-0 px-2 py-1 rounded text-sm bg-transparent"
                    style={{ color: "var(--text-primary)", border: "1px solid transparent" }}
                    onFocus={(e) => e.currentTarget.style.borderColor = "var(--border-color)"}
                    onBlur={(e) => e.currentTarget.style.borderColor = "transparent"}
                  />
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: `${confidenceColor(item.confidence)}20`, color: confidenceColor(item.confidence) }}>
                    {confidenceLabel(item.confidence)}
                  </span>
                </div>

                {/* Date/time editors */}
                {item.enabled && (
                  <div className="flex gap-2 flex-wrap">
                    <input type="date" value={item.editDate}
                      onChange={(e) => updateField(item.id, "editDate", e.target.value)}
                      className="px-2 py-1 rounded text-[11px] [color-scheme:dark]"
                      style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} />
                    <input type="time" value={item.editStartTime}
                      onChange={(e) => updateField(item.id, "editStartTime", e.target.value)}
                      className="px-2 py-1 rounded text-[11px] [color-scheme:dark]"
                      style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} />
                    <span className="text-[11px] self-center" style={{ color: "var(--text-muted)" }}>to</span>
                    <input type="time" value={item.editEndTime}
                      onChange={(e) => updateField(item.id, "editEndTime", e.target.value)}
                      className="px-2 py-1 rounded text-[11px] [color-scheme:dark]"
                      style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} />
                  </div>
                )}

                {/* Clarification question */}
                {item.needsClarification && item.clarificationQuestion && item.enabled && (
                  <div className="px-2.5 py-2 rounded-lg text-[11px]" style={{ background: "rgba(160,140,50,0.08)", border: "1px solid rgba(160,140,50,0.2)", color: "#a08c32" }}>
                    {item.clarificationQuestion}
                  </div>
                )}

                {/* Extra info */}
                {item.location && (
                  <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Location: {item.location}</p>
                )}
                {item.description && (
                  <p className="text-[11px] line-clamp-2" style={{ color: "var(--text-muted)" }}>{item.description}</p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 flex items-center justify-between" style={{ borderTop: "1px solid var(--border-subtle)" }}>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {enabledCount} of {items.length} selected
        </span>
        <div className="flex gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 rounded-xl text-xs transition-all"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)", color: "var(--text-secondary)" }}>
            Cancel
          </button>
          <button onClick={handleConfirm} disabled={enabledCount === 0}
            className="px-4 py-1.5 rounded-xl text-xs font-medium text-white transition-all hover:scale-[1.02] disabled:opacity-50"
            style={{ background: "var(--accent)" }}>
            Add {enabledCount} to calendar
          </button>
        </div>
      </div>
    </div>
  );
}
