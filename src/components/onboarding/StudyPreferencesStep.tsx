"use client";

import { OnboardingStepProps, SessionStyle, DeadlineApproach, PeakProductivity, StructureLevel, DAYS_OF_WEEK } from "@/lib/onboarding";

function OptionPill({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-3.5 py-2 rounded-xl text-sm transition-all"
      style={{
        background: selected ? "rgba(124,158,108,0.15)" : "var(--bg-surface)",
        border: selected ? "2px solid var(--accent)" : "1px solid var(--border-color)",
        color: selected ? "var(--accent)" : "var(--text-primary)",
        fontWeight: selected ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
}

function DayChip({ day, selected, onClick }: { day: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-10 h-10 rounded-lg text-xs font-medium transition-all"
      style={{
        background: selected ? "rgba(124,158,108,0.2)" : "var(--bg-surface)",
        border: selected ? "2px solid var(--accent)" : "1px solid var(--border-color)",
        color: selected ? "var(--accent)" : "var(--text-secondary)",
      }}
    >
      {day.slice(0, 3)}
    </button>
  );
}

export default function StudyPreferencesStep({ data, onUpdate, onNext, onBack, onSkip }: OnboardingStepProps) {
  const toggleDay = (day: string) => {
    const days = data.preferred_study_days.includes(day)
      ? data.preferred_study_days.filter((d) => d !== day)
      : [...data.preferred_study_days, day];
    onUpdate({ preferred_study_days: days });
  };

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h1 className="text-2xl font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
          Study preferences
        </h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          How do you like to study? We&apos;ll use this to suggest better time blocks.
        </p>
      </div>

      {/* Session style */}
      <div>
        <label className="block text-xs mb-2" style={{ color: "var(--text-muted)" }}>Session style</label>
        <div className="flex gap-2">
          <OptionPill
            label="Short sessions (30-45 min)"
            selected={data.session_style === "short"}
            onClick={() => onUpdate({ session_style: "short" as SessionStyle })}
          />
          <OptionPill
            label="Deep work (1.5-2+ hours)"
            selected={data.session_style === "deep_work"}
            onClick={() => onUpdate({ session_style: "deep_work" as SessionStyle })}
          />
        </div>
      </div>

      {/* Deadline approach */}
      <div>
        <label className="block text-xs mb-2" style={{ color: "var(--text-muted)" }}>When do you start assignments?</label>
        <div className="flex gap-2">
          <OptionPill
            label="Early, well ahead"
            selected={data.deadline_approach === "early"}
            onClick={() => onUpdate({ deadline_approach: "early" as DeadlineApproach })}
          />
          <OptionPill
            label="Closer to the deadline"
            selected={data.deadline_approach === "close_to_deadline"}
            onClick={() => onUpdate({ deadline_approach: "close_to_deadline" as DeadlineApproach })}
          />
        </div>
      </div>

      {/* Preferred study days */}
      <div>
        <label className="block text-xs mb-2" style={{ color: "var(--text-muted)" }}>Preferred study days</label>
        <div className="flex gap-1.5 flex-wrap">
          {DAYS_OF_WEEK.map((day) => (
            <DayChip
              key={day}
              day={day}
              selected={data.preferred_study_days.includes(day)}
              onClick={() => toggleDay(day)}
            />
          ))}
        </div>
      </div>

      {/* Peak productivity */}
      <div>
        <label className="block text-xs mb-2" style={{ color: "var(--text-muted)" }}>When are you most productive?</label>
        <div className="flex gap-2">
          {([["morning", "Morning"], ["afternoon", "Afternoon"], ["night", "Night"]] as const).map(([val, label]) => (
            <OptionPill
              key={val}
              label={label}
              selected={data.peak_productivity === val}
              onClick={() => onUpdate({ peak_productivity: val as PeakProductivity })}
            />
          ))}
        </div>
      </div>

      {/* Structure level */}
      <div>
        <label className="block text-xs mb-2" style={{ color: "var(--text-muted)" }}>How much structure do you want?</label>
        <div className="flex gap-2">
          {([["light", "Light suggestions"], ["moderate", "Moderate guidance"], ["hands_on", "Hands-on planning"]] as const).map(([val, label]) => (
            <OptionPill
              key={val}
              label={label}
              selected={data.structure_level === val}
              onClick={() => onUpdate({ structure_level: val as StructureLevel })}
            />
          ))}
        </div>
      </div>

      <div className="flex gap-3 pt-1">
        <button
          onClick={onBack}
          className="px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
        >
          Back
        </button>
        <button
          onClick={onNext}
          className="flex-1 px-4 py-2.5 rounded-xl text-white text-sm font-medium transition-all hover:scale-[1.02]"
          style={{ background: "var(--accent)" }}
        >
          Continue
        </button>
      </div>
      <button onClick={onSkip} className="w-full text-xs text-center transition-colors" style={{ color: "var(--text-muted)" }}>
        Skip this step
      </button>
    </div>
  );
}
