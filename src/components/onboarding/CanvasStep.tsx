"use client";

import { useState, useRef } from "react";
import { OnboardingStepProps } from "@/lib/onboarding";
import CanvasReviewPanel, { type PlannerItemSummary } from "@/components/CanvasReviewPanel";
import SchoolCanvasPicker from "@/components/SchoolCanvasPicker";

type CanvasStatus = "idle" | "connecting" | "scraping" | "review" | "error";

export default function CanvasStep({ data, onUpdate, onNext, onBack }: OnboardingStepProps) {
  const [status, setStatus] = useState<CanvasStatus>("idle");
  const [domain, setDomain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [reviewItems, setReviewItems] = useState<PlannerItemSummary[]>([]);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Use domain from onboarding school name if available
  const effectiveDomain = domain || (data.school_name ? "" : "");

  const handleDomainChange = (d: string) => {
    setDomain(d);
  };

  const handleConnect = async () => {
    if (!domain) {
      setError("Please select your school first.");
      return;
    }

    setStatus("connecting");
    setError(null);

    // Step 1: Launch Playwright auth browser
    try {
      const authRes = await fetch("/api/planner/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canvasDomain: domain }),
      });
      if (!authRes.ok) {
        const d = await authRes.json();
        setError(d.error || "Login failed");
        setStatus("error");
        return;
      }
    } catch {
      setError("Failed to connect. Make sure the dev server is running locally.");
      setStatus("error");
      return;
    }

    // Step 2: Scrape with progress bar
    setStatus("scraping");
    setProgress(0);
    progressRef.current = setInterval(() => {
      setProgress((p) => {
        if (p >= 90) { if (progressRef.current) clearInterval(progressRef.current); return 90; }
        return p + (90 - p) * 0.08;
      });
    }, 400);

    try {
      const res = await fetch("/api/planner/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canvasDomain: domain, scrape: true }),
      });
      if (progressRef.current) clearInterval(progressRef.current);
      const resData = await res.json();

      if (!res.ok) {
        setError(resData.error || "Import failed");
        setStatus("error");
        setProgress(0);
        return;
      }

      setProgress(100);
      setReviewItems(resData.items || []);
      setTimeout(() => setStatus("review"), 500);
    } catch {
      if (progressRef.current) clearInterval(progressRef.current);
      setError("Import failed.");
      setStatus("error");
      setProgress(0);
    }
  };

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h1 className="text-2xl font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
          Connect Canvas
        </h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {status === "review"
            ? "Choose which items to add to your calendar."
            : "Import your courses, assignments, and deadlines from Canvas."}
        </p>
      </div>

      {status === "review" ? (
        <CanvasReviewPanel items={reviewItems} onDone={onNext} compact />

      ) : status === "scraping" ? (
        <div className="rounded-xl p-5 space-y-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-3.5 h-3.5 border-2 rounded-full animate-spin" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {progress < 30 ? "Connecting to Canvas..." : progress < 60 ? "Scanning courses..." : progress < 85 ? "Reading assignments..." : "Almost done..."}
              </span>
            </div>
            <span className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>{Math.round(progress)}%</span>
          </div>
          <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border-color)" }}>
            <div className="h-full rounded-full transition-all duration-500 ease-out" style={{ width: `${progress}%`, background: "var(--accent)" }} />
          </div>
        </div>

      ) : (
        <div className="space-y-4">
          {/* School picker */}
          <SchoolCanvasPicker value={domain} onChange={handleDomainChange} />

          <div className="rounded-xl p-5 text-center space-y-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)" }}>
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl" style={{ background: "var(--bg-hover)" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="#E24A3F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 17l10 5 10-5" stroke="#E24A3F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 12l10 5 10-5" stroke="#E24A3F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              A browser window will open for you to log in with your school credentials. After login, Noted imports your data automatically.
            </p>

            {error && (
              <div className="px-3 py-2 rounded-lg text-xs" style={{ background: "rgba(232,113,113,0.1)", border: "1px solid rgba(232,113,113,0.2)", color: "#e87171" }}>
                {error}
              </div>
            )}

            <button
              onClick={handleConnect}
              disabled={status === "connecting" || !domain}
              className="w-full px-4 py-2.5 rounded-xl text-white text-sm font-medium transition-all hover:scale-[1.02] disabled:opacity-50"
              style={{ background: "var(--accent)" }}
            >
              {status === "connecting" ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: "white", borderTopColor: "transparent" }} />
                  Waiting for login...
                </span>
              ) : "Connect Canvas"}
            </button>
          </div>
        </div>
      )}

      {status !== "review" && (
        <>
          <div className="flex gap-3">
            <button onClick={onBack} disabled={status === "connecting" || status === "scraping"}
              className="px-4 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}>
              Back
            </button>
            <button onClick={onNext} disabled={status === "connecting" || status === "scraping"}
              className="flex-1 px-4 py-2.5 rounded-xl text-white text-sm font-medium transition-all hover:scale-[1.02] disabled:opacity-50"
              style={{ background: "var(--accent)" }}>
              Skip & finish
            </button>
          </div>
          <p className="text-[11px] text-center" style={{ color: "var(--text-muted)" }}>
            You can always connect Canvas later in Settings.
          </p>
        </>
      )}
    </div>
  );
}
