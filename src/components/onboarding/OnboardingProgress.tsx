"use client";

interface OnboardingProgressProps {
  currentStep: number;
  totalSteps: number;
}

export default function OnboardingProgress({ currentStep, totalSteps }: OnboardingProgressProps) {
  const progress = ((currentStep + 1) / totalSteps) * 100;

  return (
    <div className="w-full mb-8">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Step {currentStep + 1} of {totalSteps}
        </span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {Math.round(progress)}%
        </span>
      </div>
      <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border-color)" }}>
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{ width: `${progress}%`, background: "var(--accent)" }}
        />
      </div>
    </div>
  );
}
