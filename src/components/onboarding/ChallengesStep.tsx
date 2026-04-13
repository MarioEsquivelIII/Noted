"use client";

import { OnboardingStepProps, TIME_STRUGGLES, TimeStruggle } from "@/lib/onboarding";

const STRUGGLE_DISPLAY: Record<TimeStruggle, { label: string; emoji: string }> = {
  procrastination: { label: "Procrastination", emoji: "~" },
  overbooking: { label: "Overbooking my day", emoji: "+" },
  underestimating_time: { label: "Underestimating how long things take", emoji: "?" },
  forgetting_deadlines: { label: "Forgetting deadlines", emoji: "!" },
  staying_focused: { label: "Staying focused", emoji: "*" },
  balancing_social_life: { label: "Balancing social life", emoji: "&" },
};

export default function ChallengesStep({ data, onUpdate, onNext, onBack, onSkip }: OnboardingStepProps) {
  const toggle = (struggle: TimeStruggle) => {
    const current = data.time_struggles;
    const updated = current.includes(struggle)
      ? current.filter((s) => s !== struggle)
      : [...current, struggle];
    onUpdate({ time_struggles: updated });
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
          Time management challenges
        </h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Select any that apply. This helps us give smarter suggestions.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2">
        {TIME_STRUGGLES.map((struggle) => {
          const selected = data.time_struggles.includes(struggle);
          const { label } = STRUGGLE_DISPLAY[struggle];
          return (
            <button
              key={struggle}
              onClick={() => toggle(struggle)}
              className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-left transition-all"
              style={{
                background: selected ? "rgba(124,158,108,0.12)" : "var(--bg-surface)",
                border: selected ? "2px solid var(--accent)" : "1px solid var(--border-color)",
                color: selected ? "var(--accent)" : "var(--text-primary)",
                fontWeight: selected ? 500 : 400,
              }}
            >
              <div
                className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                style={{
                  background: selected ? "var(--accent)" : "transparent",
                  border: selected ? "none" : "1.5px solid var(--border-color)",
                }}
              >
                {selected && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex gap-3">
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
