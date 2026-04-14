"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { OnboardingProfile, ONBOARDING_DEFAULTS } from "@/lib/onboarding";
import OnboardingProgress from "@/components/onboarding/OnboardingProgress";
import StepContainer from "@/components/onboarding/StepContainer";
import WelcomeStep from "@/components/onboarding/WelcomeStep";
import AnchorEventsStep from "@/components/onboarding/AnchorEventsStep";
import AcademicInfoStep from "@/components/onboarding/AcademicInfoStep";
import StudyPreferencesStep from "@/components/onboarding/StudyPreferencesStep";
import ChallengesStep from "@/components/onboarding/ChallengesStep";
import WellnessStep from "@/components/onboarding/WellnessStep";
import CanvasStep from "@/components/onboarding/CanvasStep";

// Step IDs — the actual step sequence depends on user type
type StepId = "welcome" | "anchor" | "academic" | "preferences" | "challenges" | "wellness" | "canvas";

const STUDENT_STEPS: StepId[] = ["welcome", "anchor", "academic", "preferences", "challenges", "wellness", "canvas"];
const NON_STUDENT_STEPS: StepId[] = ["welcome", "anchor", "wellness"];

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = createClient();
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [data, setData] = useState<OnboardingProfile>({ ...ONBOARDING_DEFAULTS });
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const steps = data.user_type === "student" ? STUDENT_STEPS : NON_STUDENT_STEPS;
  const currentStepId = steps[stepIndex] || "welcome";

  // Check auth + load existing partial progress
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        router.push("/login");
        return;
      }
      setDisplayName(
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.email?.split("@")[0] ||
        "there"
      );

      const { data: profile } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (profile?.onboarding_completed) {
        router.push("/home");
        return;
      }

      // Restore partial progress
      if (profile) {
        const restored: OnboardingProfile = {
          user_type: profile.user_type || "student",
          onboarding_completed: false,
          school_name: profile.school_name || null,
          major: profile.major || null,
          num_classes: profile.num_classes || null,
          study_hours_per_week: profile.study_hours_per_week || null,
          session_style: profile.session_style || null,
          deadline_approach: profile.deadline_approach || null,
          preferred_study_days: profile.preferred_study_days || [],
          preferred_study_times: profile.preferred_study_times || [],
          peak_productivity: profile.peak_productivity || null,
          structure_level: profile.structure_level || null,
          time_struggles: profile.time_struggles || [],
          exercises_regularly: profile.exercises_regularly ?? null,
          exercise_frequency: profile.exercise_frequency || null,
          include_workouts: profile.include_workouts ?? null,
          preferred_workout_time: profile.preferred_workout_time || null,
          balance_preference: profile.balance_preference || null,
          anchor_events: profile.anchor_events || [],
          extra_preferences: profile.extra_preferences || {},
        };
        setData(restored);

        // Restore step index — clamp to valid range for the user type
        const userSteps = restored.user_type === "student" ? STUDENT_STEPS : NON_STUDENT_STEPS;
        const savedStep = profile.onboarding_step || 0;
        setStepIndex(Math.min(savedStep, userSteps.length - 1));
      }

      setLoaded(true);
    });
  }, [router, supabase]);

  // Auto-save progress on step change (debounced)
  const saveProgress = useCallback(async (currentData: OnboardingProfile, currentStep: number) => {
    try {
      await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...currentData,
          onboarding_completed: false,
          onboarding_step: currentStep,
        }),
      });
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveProgress(data, stepIndex);
    }, 500);
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, [stepIndex, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpdate = useCallback((partial: Partial<OnboardingProfile>) => {
    setData((prev) => ({ ...prev, ...partial }));
  }, []);

  const goNext = useCallback(() => {
    setDirection(1);
    setStepIndex((s) => Math.min(s + 1, steps.length - 1));
  }, [steps.length]);

  const goBack = useCallback(() => {
    setDirection(-1);
    setStepIndex((s) => Math.max(s - 1, 0));
  }, []);

  const goSkip = useCallback(() => {
    setDirection(1);
    setStepIndex((s) => Math.min(s + 1, steps.length - 1));
  }, [steps.length]);

  const handleComplete = async () => {
    setSaving(true);
    try {
      await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          onboarding_completed: true,
          onboarding_step: steps.length,
        }),
      });
    } catch (err) {
      console.error("Failed to save profile:", err);
    }
    setSaving(false);
    router.push("/home");
  };

  const isLastStep = stepIndex === steps.length - 1;

  const stepProps = {
    data,
    onUpdate: handleUpdate,
    onNext: isLastStep ? handleComplete : goNext,
    onBack: goBack,
    onSkip: goSkip,
  };

  // Welcome step: after selecting user type, if it changes the step set, reset to step 0
  const handleWelcomeNext = () => {
    goNext();
  };

  const renderStep = () => {
    switch (currentStepId) {
      case "welcome":
        return <WelcomeStep {...stepProps} onNext={handleWelcomeNext} />;
      case "anchor":
        return <AnchorEventsStep {...stepProps} />;
      case "academic":
        return <AcademicInfoStep {...stepProps} />;
      case "preferences":
        return <StudyPreferencesStep {...stepProps} />;
      case "challenges":
        return <ChallengesStep {...stepProps} />;
      case "wellness":
        // For non-students, wellness is the last step before completion
        if (data.user_type !== "student" && isLastStep) {
          return <WellnessStep {...stepProps} onNext={handleComplete} />;
        }
        return <WellnessStep {...stepProps} />;
      case "canvas":
        return <CanvasStep {...stepProps} onNext={handleComplete} />;
      default:
        return null;
    }
  };

  if (!loaded) {
    return (
      <div className="min-h-screen bg-sky-gradient flex items-center justify-center">
        <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-sky-gradient flex items-center justify-center relative overflow-hidden">
      <div
        className="absolute top-[15%] right-[25%] w-[500px] h-[500px] rounded-full opacity-[0.06] pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(148,120,170,0.6), transparent 70%)" }}
      />
      <div
        className="absolute bottom-[15%] left-[15%] w-[400px] h-[400px] rounded-full opacity-[0.04] pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(124,158,108,0.5), transparent 70%)" }}
      />

      <div className="w-full max-w-lg px-6 relative z-10">
        <div className="text-center mb-6">
          <span className="font-logo text-4xl bg-gradient-to-br from-white via-[#c8d0e8] to-[#8b90a8] bg-clip-text text-transparent">
            Noted
          </span>
          {displayName && (
            <p className="text-sm mt-2" style={{ color: "var(--text-secondary)" }}>
              Hey {displayName}, let&apos;s set things up
            </p>
          )}
        </div>

        <div className="glass-card rounded-2xl p-6 relative">
          {stepIndex > 0 && (
            <OnboardingProgress currentStep={stepIndex} totalSteps={steps.length} />
          )}

          <StepContainer stepKey={stepIndex} direction={direction}>
            {renderStep()}
          </StepContainer>

          {saving && (
            <div className="absolute inset-0 rounded-2xl flex items-center justify-center" style={{ background: "rgba(0,0,0,0.3)" }}>
              <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
