"use client";

import { OnboardingStepProps, UserType } from "@/lib/onboarding";

const USER_TYPES: { value: UserType; label: string; icon: string; description: string }[] = [
  {
    value: "student",
    label: "Student",
    icon: "M12 14l9-5-9-5-9 5 9 5z M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z",
    description: "Classes, assignments, study sessions",
  },
  {
    value: "professional",
    label: "Professional",
    icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
    description: "Meetings, deadlines, work-life balance",
  },
  {
    value: "personal",
    label: "Personal",
    icon: "M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z",
    description: "Hobbies, personal goals, daily life",
  },
];

export default function WelcomeStep({ data, onUpdate, onNext }: OnboardingStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
          Welcome to Noted
        </h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Tell us a bit about yourself so we can personalize your experience.
        </p>
      </div>

      <div className="space-y-3">
        <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>
          I am a...
        </label>
        {USER_TYPES.map((type) => {
          const selected = data.user_type === type.value;
          const isComingSoon = type.value !== "student";
          return (
            <button
              key={type.value}
              onClick={() => onUpdate({ user_type: type.value })}
              className="w-full flex items-center gap-4 px-4 py-4 rounded-xl text-left transition-all hover:scale-[1.01]"
              style={{
                background: selected ? "rgba(124,158,108,0.12)" : "var(--bg-surface)",
                border: selected ? "2px solid var(--accent)" : "1px solid var(--border-color)",
              }}
            >
              <div
                className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ background: selected ? "rgba(124,158,108,0.2)" : "rgba(139,144,168,0.1)" }}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={selected ? "var(--accent)" : "var(--text-secondary)"}
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={type.icon} />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    {type.label}
                  </span>
                  {isComingSoon && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(139,144,168,0.15)", color: "var(--text-muted)" }}>
                      Coming soon
                    </span>
                  )}
                </div>
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {type.description}
                </span>
              </div>
              {selected && (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          );
        })}
      </div>

      <button
        onClick={onNext}
        className="w-full px-4 py-2.5 rounded-xl text-white text-sm font-medium transition-all hover:scale-[1.02]"
        style={{ background: "var(--accent)" }}
      >
        Continue
      </button>
    </div>
  );
}
