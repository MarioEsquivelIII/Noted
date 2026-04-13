"use client";

import { OnboardingStepProps, ExerciseFrequency, WorkoutTime, BalancePreference } from "@/lib/onboarding";

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

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (val: boolean) => void; label: string }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between w-full px-4 py-3 rounded-xl text-sm transition-all"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
    >
      <span>{label}</span>
      <div
        className="w-10 h-6 rounded-full relative transition-colors"
        style={{ background: checked ? "var(--accent)" : "var(--border-color)" }}
      >
        <div
          className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
          style={{ left: checked ? "18px" : "2px" }}
        />
      </div>
    </button>
  );
}

export default function WellnessStep({ data, onUpdate, onNext, onBack, onSkip }: OnboardingStepProps) {
  return (
    <div className="space-y-5">
      <div className="text-center">
        <h1 className="text-2xl font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
          Wellness & balance
        </h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Noted can protect time for exercise and rest in your schedule.
        </p>
      </div>

      <div className="space-y-3">
        <Toggle
          checked={data.exercises_regularly ?? false}
          onChange={(val) => onUpdate({ exercises_regularly: val })}
          label="I exercise regularly"
        />

        {data.exercises_regularly && (
          <>
            <div>
              <label className="block text-xs mb-2" style={{ color: "var(--text-muted)" }}>How often?</label>
              <div className="flex gap-2">
                {([["daily", "Daily"], ["3_4x_week", "3-4x/week"], ["1_2x_week", "1-2x/week"]] as const).map(([val, label]) => (
                  <OptionPill
                    key={val}
                    label={label}
                    selected={data.exercise_frequency === val}
                    onClick={() => onUpdate({ exercise_frequency: val as ExerciseFrequency })}
                  />
                ))}
              </div>
            </div>

            <Toggle
              checked={data.include_workouts ?? false}
              onChange={(val) => onUpdate({ include_workouts: val })}
              label="Include workouts in my schedule"
            />

            {data.include_workouts && (
              <div>
                <label className="block text-xs mb-2" style={{ color: "var(--text-muted)" }}>Preferred workout time</label>
                <div className="flex gap-2">
                  {([["morning", "Morning"], ["afternoon", "Afternoon"], ["evening", "Evening"]] as const).map(([val, label]) => (
                    <OptionPill
                      key={val}
                      label={label}
                      selected={data.preferred_workout_time === val}
                      onClick={() => onUpdate({ preferred_workout_time: val as WorkoutTime })}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div>
        <label className="block text-xs mb-2" style={{ color: "var(--text-muted)" }}>Schedule balance</label>
        <div className="flex gap-2">
          <OptionPill
            label="Productivity-focused"
            selected={data.balance_preference === "productivity"}
            onClick={() => onUpdate({ balance_preference: "productivity" as BalancePreference })}
          />
          <OptionPill
            label="Balanced (meals, rest, exercise)"
            selected={data.balance_preference === "balanced"}
            onClick={() => onUpdate({ balance_preference: "balanced" as BalancePreference })}
          />
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
