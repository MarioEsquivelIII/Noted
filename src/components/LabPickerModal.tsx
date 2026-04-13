"use client";

import { useState } from "react";

export interface LabOption {
  id: string;          // planner item ID
  courseCode: string;   // "CHEM 1310 B04"
  courseName: string;   // "CHEM 1310" (parent course)
  days: string;         // "Thursday"
  time: string;         // "12:30–15:15"
  location: string;     // "Clough UG Learning Commons 589"
  sourceUid: string;
}

export interface LabGroup {
  course: string;       // "CHEM 1310"
  options: LabOption[];
}

interface LabPickerModalProps {
  labGroups: LabGroup[];
  onConfirm: (selectedIds: string[]) => void;
  onSkip: () => void;
}

export default function LabPickerModal({ labGroups, onConfirm, onSkip }: LabPickerModalProps) {
  // Track which lab is selected per course (one per course)
  const [selected, setSelected] = useState<Record<string, string>>({});

  const handleSelect = (course: string, id: string) => {
    setSelected((prev) => ({ ...prev, [course]: id }));
  };

  const handleConfirm = () => {
    const ids = Object.values(selected).filter(Boolean);
    onConfirm(ids);
  };

  const allPicked = labGroups.every((g) => selected[g.course]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-md mx-4 rounded-2xl shadow-2xl overflow-hidden" style={{ background: "var(--card-bg)", border: "1px solid var(--border-color)" }}>
        <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Which lab sections are you in?</h3>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Select your lab for each course so we can add the correct time to your calendar.
          </p>
        </div>

        <div className="px-5 py-4 space-y-5 max-h-[60vh] overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
          {labGroups.map((group) => (
            <div key={group.course}>
              <p className="text-xs font-medium mb-2" style={{ color: "var(--text-primary)" }}>{group.course}</p>
              <div className="space-y-1.5">
                {group.options.map((opt) => {
                  const isSelected = selected[group.course] === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => handleSelect(group.course, opt.id)}
                      className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-left transition-all"
                      style={{
                        background: isSelected ? "rgba(124,158,108,0.12)" : "var(--bg-surface)",
                        border: isSelected ? "2px solid var(--accent)" : "1px solid var(--border-color)",
                      }}
                    >
                      {/* Radio indicator */}
                      <div
                        className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{
                          border: isSelected ? "none" : "2px solid var(--border-color)",
                          background: isSelected ? "var(--accent)" : "transparent",
                        }}
                      >
                        {isSelected && (
                          <div className="w-2 h-2 rounded-full bg-white" />
                        )}
                      </div>

                      {/* Lab info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                            {opt.courseCode}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(74,138,130,0.15)", color: "#4a8a82" }}>
                            Lab
                          </span>
                        </div>
                        <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                          {opt.days} · {opt.time}
                        </p>
                        <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>
                          {opt.location}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-4 flex gap-2" style={{ borderTop: "1px solid var(--border-subtle)" }}>
          <button
            onClick={onSkip}
            className="px-4 py-2.5 rounded-xl text-sm transition-all"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)", color: "var(--text-secondary)" }}
          >
            Skip
          </button>
          <button
            onClick={handleConfirm}
            disabled={!allPicked}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-all hover:scale-[1.02] disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {allPicked ? "Add to calendar" : `Select ${labGroups.length - Object.keys(selected).length} more`}
          </button>
        </div>
      </div>
    </div>
  );
}
