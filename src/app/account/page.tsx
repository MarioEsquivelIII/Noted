"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import GoogleCalendarSyncFlow from "@/components/GoogleCalendarSyncFlow";
import CanvasSyncFlow from "@/components/CanvasSyncFlow";
import type { CalendarEvent } from "@/lib/events";
import { GCAL_IMPORT_KEY } from "@/lib/gcalSync";
import { CANVAS_IMPORT_KEY } from "@/lib/canvas/constants";
import CanvasReviewPanel, { type PlannerItemSummary } from "@/components/CanvasReviewPanel";
import LabPickerModal, { type LabGroup } from "@/components/LabPickerModal";
import SchoolCanvasPicker from "@/components/SchoolCanvasPicker";
import { type AnchorEvent, ANCHOR_EVENT_PRESETS, DAYS_OF_WEEK, type UserSettings, DEFAULT_SETTINGS, getUserSettings } from "@/lib/onboarding";

export default function AccountPage() {
  const router = useRouter();
  const supabase = createClient();
  const [user, setUser] = useState<{ email: string; name: string; avatar_url?: string } | null>(null);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);
  const [sessionIsSupabase, setSessionIsSupabase] = useState(false);
  const [googleProviderToken, setGoogleProviderToken] = useState<string | null>(null);
  const [gcalSyncOpen, setGcalSyncOpen] = useState(false);
  const [gcalOAuthError, setGcalOAuthError] = useState<string | null>(null);
  const [gcalExporting, setGcalExporting] = useState(false);
  const [gcalExportResult, setGcalExportResult] = useState<string | null>(null);

  // Canvas LMS state (OAuth flow — legacy)
  const [canvasConnected, setCanvasConnected] = useState(false);
  const [canvasDomain, setCanvasDomain] = useState<string | null>(null);
  const [canvasLastSync, setCanvasLastSync] = useState<string | null>(null);
  const [canvasSyncOpen, setCanvasSyncOpen] = useState(false);
  const [canvasError, setCanvasError] = useState<string | null>(null);

  // Canvas Playwright scraper state
  const [plannerAuth, setPlannerAuth] = useState(false);
  const [plannerDomain, setPlannerDomain] = useState("");
  const [plannerStatus, setPlannerStatus] = useState<"idle" | "authenticating" | "scraping" | "done" | "error">("idle");
  const [plannerItemCount, setPlannerItemCount] = useState(0);
  const [plannerError, setPlannerError] = useState<string | null>(null);
  const [plannerSyncProgress, setPlannerSyncProgress] = useState(0);
  const [plannerSyncStats, setPlannerSyncStats] = useState<{ courses: number; assignments: number } | null>(null);
  const [plannerReviewItems, setPlannerReviewItems] = useState<PlannerItemSummary[] | null>(null);
  const [labGroups, setLabGroups] = useState<LabGroup[] | null>(null);

  // Anchor events state
  const [anchorEvents, setAnchorEvents] = useState<AnchorEvent[]>([]);
  const [editingAnchor, setEditingAnchor] = useState<number | null>(null);
  const [anchorSaving, setAnchorSaving] = useState(false);

  // User settings
  const [settings, setSettings] = useState<UserSettings>({ ...DEFAULT_SETTINGS });
  const [settingsSaving, setSettingsSaving] = useState(false);

  const refreshSessionTokens = useCallback(async () => {
    // Only use the cookie token (set after OAuth with calendar scope).
    // session.provider_token from Supabase login may lack calendar.readonly scope.
    const match = typeof document !== "undefined" ? document.cookie.match(/noted_google_token=([^;]+)/) : null;
    setGoogleProviderToken(match ? decodeURIComponent(match[1]) : null);
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user: supaUser } }) => {
      if (supaUser) {
        setSessionIsSupabase(true);
        const u = {
          email: supaUser.email || "",
          name: supaUser.user_metadata?.full_name || supaUser.user_metadata?.name || supaUser.email?.split("@")[0] || "User",
          avatar_url: supaUser.user_metadata?.avatar_url,
        };
        setUser(u);
        setName(u.name);
      } else {
        setSessionIsSupabase(false);
        const stored = localStorage.getItem("noted_user");
        if (!stored) { router.push("/login"); return; }
        const parsed = JSON.parse(stored);
        setUser(parsed);
        setName(parsed.name);
      }
    });
    refreshSessionTokens();

    // Check Canvas connection status (OAuth — legacy)
    fetch("/api/canvas/status")
      .then((r) => r.json())
      .then((data) => {
        setCanvasConnected(!!data.connected);
        setCanvasDomain(data.domain || null);
        setCanvasLastSync(data.lastSyncedAt || null);
      })
      .catch(() => {});

    // Load anchor events + settings + Canvas domain from profile
    fetch("/api/profile")
      .then((r) => r.json())
      .then((data) => {
        if (data.profile?.anchor_events) setAnchorEvents(data.profile.anchor_events);
        if (data.profile?.canvas_domain) setPlannerDomain(data.profile.canvas_domain);
        setSettings(getUserSettings(data.profile));
      })
      .catch(() => {});

    // Check Playwright auth status + planner item count
    fetch("/api/planner/auth")
      .then((r) => r.json())
      .then((data) => setPlannerAuth(!!data.authenticated))
      .catch(() => {});
    fetch("/api/planner/items?future=true")
      .then((r) => r.json())
      .then((data) => setPlannerItemCount(data.items?.length || 0))
      .catch(() => {});
  }, [router, supabase.auth, refreshSessionTokens]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      // Re-check the cookie on auth state changes (e.g. after OAuth redirect).
      // Don't use session.provider_token — it may lack calendar scope.
      const match = document.cookie.match(/noted_google_token=([^;]+)/);
      setGoogleProviderToken(match ? decodeURIComponent(match[1]) : null);
    });
    return () => subscription.unsubscribe();
  }, [supabase.auth]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("gcal_pending") !== "1") return;
    url.searchParams.delete("gcal_pending");
    const search = url.searchParams.toString();
    window.history.replaceState({}, "", `${url.pathname}${search ? `?${search}` : ""}`);

    void (async () => {
      // Use the cookie token (set after OAuth with calendar scope).
      // session.provider_token from Supabase login may lack calendar.readonly scope.
      const match = document.cookie.match(/noted_google_token=([^;]+)/);
      const token = match ? decodeURIComponent(match[1]) : null;

      if (token) {
        setGoogleProviderToken(token);
        setGcalSyncOpen(true);
        setGcalOAuthError(null);
      } else {
        setGcalOAuthError(
          "Google Calendar access token expired. Click 'Connect Google Calendar' to re-authorize."
        );
      }
    })();
  }, [supabase.auth]);

  const handleSave = async () => {
    if (!user) return;
    await supabase.auth.updateUser({ data: { full_name: name } });
    const updated = { ...user, name };
    localStorage.setItem("noted_user", JSON.stringify(updated));
    setUser(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem("noted_user");
    router.push("/login");
  };

  const handleDeleteAccount = async () => {
    if (confirm("Are you sure you want to delete your account? This cannot be undone.")) {
      await supabase.auth.signOut();
      localStorage.removeItem("noted_user");
      localStorage.removeItem("noted_events");
      router.push("/login");
    }
  };

  const handleGoogleCalConnect = async () => {
    setGcalOAuthError(null);
    if (!sessionIsSupabase) {
      setGcalOAuthError("Sign in with your account (not guest mode) to connect Google Calendar.");
      return;
    }
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    // Store redirect target in cookie so the auth callback can find it
    // even if Supabase's OAuth flow drops the query param
    document.cookie = `noted_oauth_next=${encodeURIComponent("/account?gcal_pending=1")}; path=/; max-age=300; SameSite=Lax`;
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          scopes: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly",
          redirectTo: `${origin}/auth/callback`,
          queryParams: {
            access_type: "offline",
            prompt: "consent",
          },
        },
      });
      if (error) {
        setGcalOAuthError(error.message || "Google sign-in was cancelled or failed.");
      }
    } catch (e) {
      setGcalOAuthError(e instanceof Error ? e.message : "Something went wrong connecting to Google.");
    }
  };

  const handleGcalSyncClick = () => {
    setGcalOAuthError(null);
    if (!sessionIsSupabase) {
      setGcalOAuthError("Sign in with your account (not guest mode) to sync Google Calendar.");
      return;
    }
    // Check cookie for token if state is empty
    if (!googleProviderToken) {
      const match = document.cookie.match(/noted_google_token=([^;]+)/);
      if (match) {
        const token = decodeURIComponent(match[1]);
        setGoogleProviderToken(token);
        setGcalSyncOpen(true);
        return;
      }
      void handleGoogleCalConnect();
      return;
    }
    setGcalSyncOpen(true);
  };

  // Handle Canvas OAuth redirect
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("canvas_connected") === "1") {
      url.searchParams.delete("canvas_connected");
      window.history.replaceState({}, "", `${url.pathname}${url.search || ""}`);
      setCanvasConnected(true);
      setCanvasSyncOpen(true);
      // Refresh status
      fetch("/api/canvas/status")
        .then((r) => r.json())
        .then((data) => {
          setCanvasDomain(data.domain || null);
          setCanvasLastSync(data.lastSyncedAt || null);
        })
        .catch(() => {});
    }
    const canvasErr = url.searchParams.get("canvas_error");
    if (canvasErr) {
      url.searchParams.delete("canvas_error");
      window.history.replaceState({}, "", `${url.pathname}${url.search || ""}`);
      setCanvasError(canvasErr.replace(/_/g, " "));
    }
  }, []);

  const handleCanvasDisconnect = async () => {
    if (!confirm("Disconnect Canvas LMS? Your synced academic data will be removed.")) return;
    try {
      await fetch("/api/canvas/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keepEvents: false }),
      });
      setCanvasConnected(false);
      setCanvasDomain(null);
      setCanvasLastSync(null);
      setCanvasError(null);
    } catch {
      setCanvasError("Failed to disconnect Canvas");
    }
  };

  const onCanvasImportComplete = (events: CalendarEvent[]) => {
    try {
      sessionStorage.setItem(CANVAS_IMPORT_KEY, JSON.stringify({ events, replaceAll: false }));
    } catch {
      setCanvasError("Couldn't save imported events. Try again.");
      return;
    }
    router.push("/home");
  };

  const onGcalImportComplete = (events: CalendarEvent[], strategy?: "overwrite" | "merge") => {
    try {
      sessionStorage.setItem(GCAL_IMPORT_KEY, JSON.stringify({ events, replaceAll: strategy === "overwrite" }));
    } catch {
      setGcalOAuthError("Couldn't save imported events. Try again with fewer events.");
      return;
    }
    router.push("/home");
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-sky-gradient">
      {gcalSyncOpen && googleProviderToken && (
        <GoogleCalendarSyncFlow
          open={gcalSyncOpen}
          accessToken={googleProviderToken}
          onClose={() => setGcalSyncOpen(false)}
          onImportComplete={onGcalImportComplete}
          onReconnect={() => {
            setGoogleProviderToken(null);
            void handleGoogleCalConnect();
          }}
        />
      )}

      {canvasSyncOpen && (
        <CanvasSyncFlow
          open={canvasSyncOpen}
          onClose={() => setCanvasSyncOpen(false)}
          onImportComplete={onCanvasImportComplete}
          isConnected={canvasConnected}
          connectionDomain={canvasDomain || undefined}
        />
      )}

      {/* Top nav */}
      <header className="sticky top-0 z-40 glass-nav">
        <div className="max-w-2xl mx-auto px-5 h-14 flex items-center justify-between">
          <button
            onClick={() => router.push("/home")}
            className="flex items-center gap-2 text-sm transition-colors"
            style={{ color: "var(--text-secondary)" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <span className="font-logo text-lg" style={{ color: "var(--text-primary)" }}>Account</span>
          <div className="w-16" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-8 space-y-6">
        {/* Profile section */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="px-6 py-4" style={{ borderBottom: "1px solid var(--glass-border)" }}>
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Profile</h2>
          </div>
          <div className="px-6 py-5 space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-semibold text-white" style={{ background: "var(--accent)" }}>
                {name.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{name}</p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>{user.email}</p>
              </div>
            </div>

            <div>
              <label className="block text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>Display name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-sm transition-colors"
                style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
              />
            </div>

            <div>
              <label className="block text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>Email</label>
              <input
                type="email"
                value={user.email}
                disabled
                className="w-full px-3 py-2 rounded-xl text-sm cursor-not-allowed"
                style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)", color: "var(--text-muted)" }}
              />
            </div>

            <button
              onClick={handleSave}
              className="px-4 py-2 rounded-xl text-sm text-white font-medium transition-all hover:scale-[1.02]"
              style={{ background: "var(--accent)" }}
            >
              {saved ? "Saved!" : "Save changes"}
            </button>
          </div>
        </div>

        {/* Connected accounts */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="px-6 py-4" style={{ borderBottom: "1px solid var(--glass-border)" }}>
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Connected accounts</h2>
          </div>
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "var(--bg-hover)" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                </div>
                <div>
                  <p className="text-sm" style={{ color: "var(--text-primary)" }}>Google Calendar</p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>Sync events with Google Calendar</p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleGcalSyncClick}
                    className="px-3 py-1.5 rounded-xl text-xs transition-all hover:scale-[1.02]"
                    style={{ background: "var(--bg-hover)", border: "1px solid var(--glass-border)", color: "var(--text-secondary)" }}
                  >
                    {googleProviderToken ? "Import" : "Connect"}
                  </button>
                  {googleProviderToken && (
                    <button
                      type="button"
                      disabled={gcalExporting}
                      onClick={async () => {
                        setGcalExporting(true);
                        setGcalExportResult(null);
                        try {
                          // Fetch all events from Noted
                          const evRes = await fetch("/api/events");
                          if (!evRes.ok) throw new Error("Failed to load events");
                          const { events } = await evRes.json();

                          if (!events || events.length === 0) {
                            setGcalExportResult("No events to export.");
                            setGcalExporting(false);
                            return;
                          }

                          const res = await fetch("/api/gcal-export", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ events }),
                          });
                          const data = await res.json();

                          if (data.error === "google_auth_required") {
                            setGcalOAuthError("Please reconnect Google Calendar to enable export.");
                          } else if (res.ok) {
                            const parts = [];
                            if (data.exported > 0) parts.push(`${data.exported} exported`);
                            if (data.skipped > 0) parts.push(`${data.skipped} already existed`);
                            if (data.failed > 0) parts.push(`${data.failed} failed`);
                            setGcalExportResult(parts.join(", ") || "Done!");
                          } else {
                            setGcalExportResult(data.error || "Export failed");
                          }
                        } catch {
                          setGcalExportResult("Export failed.");
                        }
                        setGcalExporting(false);
                      }}
                      className="px-3 py-1.5 rounded-xl text-xs transition-all hover:scale-[1.02] disabled:opacity-50"
                      style={{ background: "var(--bg-hover)", border: "1px solid var(--glass-border)", color: "var(--text-secondary)" }}
                    >
                      {gcalExporting ? "Exporting..." : "Export"}
                    </button>
                  )}
                </div>
                {gcalOAuthError && (
                  <p className="text-[10px] max-w-[200px] text-right leading-snug" style={{ color: "#e87171" }}>{gcalOAuthError}</p>
                )}
                {gcalExportResult && (
                  <p className="text-[10px] max-w-[200px] text-right leading-snug" style={{ color: "var(--accent)" }}>{gcalExportResult}</p>
                )}
              </div>
            </div>

            {/* Canvas LMS (Playwright scraping) */}
            <div className="mt-4 pt-4 space-y-3" style={{ borderTop: "1px solid var(--glass-border)" }}>
              {/* Header row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "var(--bg-hover)" }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="#E24A3F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M2 17l10 5 10-5" stroke="#E24A3F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M2 12l10 5 10-5" stroke="#E24A3F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm" style={{ color: "var(--text-primary)" }}>Canvas LMS</p>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {plannerAuth
                        ? `Logged in to ${plannerDomain}${plannerItemCount > 0 ? ` · ${plannerItemCount} item${plannerItemCount !== 1 ? "s" : ""} tracked` : ""}`
                        : "Import courses, assignments, and deadlines"}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {plannerAuth && plannerStatus !== "scraping" && plannerStatus !== "done" ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          setPlannerStatus("scraping");
                          setPlannerError(null);
                          setPlannerSyncProgress(0);
                          setPlannerSyncStats(null);
                          // Simulate progress while waiting for the real request
                          const progressInterval = setInterval(() => {
                            setPlannerSyncProgress((p) => {
                              if (p >= 90) { clearInterval(progressInterval); return 90; }
                              // Fast at first, slows down as it approaches 90%
                              return p + (90 - p) * 0.08;
                            });
                          }, 400);
                          try {
                            const res = await fetch("/api/planner/ingest", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ canvasDomain: plannerDomain, scrape: true }),
                            });
                            clearInterval(progressInterval);
                            const d = await res.json();
                            if (res.ok) {
                              setPlannerSyncProgress(100);
                              const courses = d.stats?.scraper?.coursesScraped || 0;
                              const assignments = d.stats?.scraper?.assignmentsFound || 0;
                              setPlannerSyncStats({ courses, assignments });
                              setPlannerItemCount(d.items?.length || assignments);
                              const allItems: PlannerItemSummary[] = d.items || [];
                              setPlannerReviewItems(allItems);

                              // Check for lab options — show picker ONLY if user hasn't already picked
                              const labItems = allItems.filter((i: PlannerItemSummary) =>
                                i.itemType === "class_meeting" && i.description?.includes("Lab/Studio")
                              );
                              if (labItems.length > 1) {
                                // Check if lab events already exist on the calendar (user already picked)
                                let labAlreadyPicked = false;
                                try {
                                  const evRes = await fetch("/api/events");
                                  if (evRes.ok) {
                                    const evData = await evRes.json();
                                    const labEvents = (evData.events || []).filter((e: { title: string }) =>
                                      /Lab$/i.test(e.title)
                                    );
                                    if (labEvents.length > 0) labAlreadyPicked = true;
                                  }
                                } catch { /* check failed, show picker */ }

                                if (!labAlreadyPicked) {
                                  const groups: Record<string, LabGroup> = {};
                                  for (const lab of labItems) {
                                    const parentMatch = (lab.courseCode || "").match(/^([A-Z]+ \d+)/);
                                    const parent = parentMatch ? parentMatch[1] : lab.courseCode || "Unknown";
                                    if (!groups[parent]) groups[parent] = { course: parent, options: [] };
                                    const descLine = lab.description?.split("\n")[0] || "";
                                    const dayTime = descLine.replace("Lab/Studio · ", "").split("\n")[0];
                                    const parts = dayTime.split(" ");
                                    const days = parts.slice(0, -1).join(" ");
                                    const time = parts[parts.length - 1] || "";
                                    groups[parent].options.push({
                                      id: lab.id,
                                      courseCode: lab.courseCode || "",
                                      courseName: parent,
                                      days: days || "TBA",
                                      time: time || "TBA",
                                      location: lab.description?.split("\n").find((l: string) => l.startsWith("Location:"))?.replace("Location: ", "") || "TBA",
                                      sourceUid: lab.id,
                                    });
                                  }
                                  const groupList = Object.values(groups).filter((g) => g.options.length > 1);
                                  if (groupList.length > 0) {
                                    setLabGroups(groupList);
                                  }
                                }
                              }

                              // Brief delay to show 100% before switching to done
                              setTimeout(() => setPlannerStatus("done"), 600);
                            } else {
                              setPlannerSyncProgress(0);
                              setPlannerError(d.error === "auth_required" ? "Canvas login expired. Click Re-login." : (d.error || "Sync failed"));
                              setPlannerStatus("error");
                            }
                          } catch {
                            clearInterval(progressInterval);
                            setPlannerSyncProgress(0);
                            setPlannerError("Sync failed");
                            setPlannerStatus("error");
                          }
                        }}
                        className="px-3 py-1.5 rounded-xl text-xs transition-all hover:scale-[1.02]"
                        style={{ background: "var(--bg-hover)", border: "1px solid var(--glass-border)", color: "var(--text-secondary)" }}
                      >
                        Sync now
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          setPlannerStatus("authenticating");
                          setPlannerError(null);
                          try {
                            const res = await fetch("/api/planner/auth", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ canvasDomain: plannerDomain }),
                            });
                            if (res.ok) {
                              setPlannerAuth(true);
                              setPlannerStatus("idle");
                            } else {
                              setPlannerError("Re-auth failed");
                              setPlannerStatus("error");
                            }
                          } catch {
                            setPlannerError("Re-auth failed");
                            setPlannerStatus("error");
                          }
                        }}
                        className="px-3 py-1.5 rounded-xl text-xs transition-all hover:scale-[1.02]"
                        style={{ background: "var(--bg-hover)", border: "1px solid var(--glass-border)", color: "var(--text-secondary)" }}
                      >
                        Re-login
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!confirm("Disconnect Canvas? This will remove all Canvas-synced events (classes, labs) from your calendar and clear all Canvas data. Your manually created events will be kept.")) return;
                          if (!confirm("Are you sure? This cannot be undone.")) return;

                          setPlannerStatus("scraping");
                          setPlannerError(null);
                          try {
                            // 1. Delete all Canvas-sourced planner items
                            const { data: { user: authUser } } = await (await import("@/utils/supabase/client")).createClient().auth.getUser();
                            if (authUser) {
                              const sb = (await import("@/utils/supabase/client")).createClient();
                              // Delete planner items
                              await sb.from("planner_items").delete().eq("user_id", authUser.id);
                              // Delete Canvas-created calendar events (classes, labs — have series_id starting with "class-")
                              await sb.from("events").delete().eq("user_id", authUser.id).like("series_id", "class-%");
                              // Also delete lab events
                              await sb.from("events").delete().eq("user_id", authUser.id).like("title", "% Lab");
                              // Clear Canvas domain from profile
                              await sb.from("user_profiles").update({ canvas_domain: null, canvas_ical_url: null }).eq("user_id", authUser.id);
                            }

                            // 2. Delete Playwright auth state
                            await fetch("/api/planner/auth", { method: "DELETE" }).catch(() => {});

                            setPlannerAuth(false);
                            setPlannerDomain("");
                            setPlannerItemCount(0);
                            setPlannerStatus("idle");
                            setPlannerReviewItems(null);
                          } catch {
                            setPlannerError("Disconnect failed");
                            setPlannerStatus("error");
                          }
                        }}
                        className="px-3 py-1.5 rounded-xl text-xs transition-all hover:scale-[1.02]"
                        style={{ background: "rgba(232,113,113,0.08)", border: "1px solid rgba(232,113,113,0.15)", color: "#e87171" }}
                      >
                        Disconnect
                      </button>
                    </div>
                  ) : !plannerAuth && plannerStatus !== "scraping" && plannerStatus !== "done" ? (
                    <button
                      type="button"
                      disabled={plannerStatus === "authenticating" || !plannerDomain}
                      title={!plannerDomain ? "Pick your school first" : undefined}
                      onClick={async () => {
                        if (!plannerDomain) {
                          setPlannerError("Pick your school below first.");
                          return;
                        }
                        setPlannerStatus("authenticating");
                        setPlannerError(null);
                        try {
                          // Note: /api/planner/auth saves the domain to the profile on success
                          const res = await fetch("/api/planner/auth", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ canvasDomain: plannerDomain }),
                          });
                          const d = await res.json();
                          if (res.ok) {
                            setPlannerAuth(true);
                            setPlannerStatus("idle");
                          } else {
                            setPlannerError(d.error || "Login failed");
                            setPlannerStatus("error");
                          }
                        } catch {
                          setPlannerError("Failed to connect");
                          setPlannerStatus("error");
                        }
                      }}
                      className="px-3 py-1.5 rounded-xl text-xs transition-all hover:scale-[1.02] disabled:opacity-50"
                      style={{ background: "var(--bg-hover)", border: "1px solid var(--glass-border)", color: "var(--text-secondary)" }}
                    >
                      {plannerStatus === "authenticating" ? "Waiting for login..." : "Connect"}
                    </button>
                  ) : null}
                  {plannerError && (
                    <p className="text-[10px] max-w-[200px] text-right leading-snug" style={{ color: "#e87171" }}>{plannerError}</p>
                  )}
                </div>
              </div>

              {/* School picker — shown when no domain is set yet (e.g. after Disconnect) */}
              {!plannerAuth && !plannerDomain && plannerStatus !== "scraping" && plannerStatus !== "done" && (
                <div className="pt-1">
                  <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>Pick your school to connect Canvas:</p>
                  <SchoolCanvasPicker value={plannerDomain} onChange={setPlannerDomain} />
                </div>
              )}

              {/* Progress bar during sync */}
              {plannerStatus === "scraping" && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-3.5 h-3.5 border-2 rounded-full animate-spin" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
                      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                        {plannerSyncProgress < 30 ? "Connecting to Canvas..." : plannerSyncProgress < 60 ? "Scanning courses..." : plannerSyncProgress < 85 ? "Reading assignments & syllabi..." : "Estimating workloads..."}
                      </span>
                    </div>
                    <span className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>{Math.round(plannerSyncProgress)}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border-color)" }}>
                    <div
                      className="h-full rounded-full transition-all duration-500 ease-out"
                      style={{ width: `${plannerSyncProgress}%`, background: "var(--accent)" }}
                    />
                  </div>
                </div>
              )}

              {/* Lab picker popup — shown before review if labs were found */}
              {labGroups && labGroups.length > 0 && (
                <LabPickerModal
                  labGroups={labGroups}
                  onConfirm={async (selectedIds) => {
                    setLabGroups(null);
                    const selectedSet = new Set(selectedIds);

                    // Get ALL lab option IDs across all groups
                    const allLabIds = labGroups.flatMap((g) => g.options.map((o) => o.id));
                    const rejectedIds = allLabIds.filter((id) => !selectedSet.has(id));

                    // Delete the labs the user DIDN'T pick (planner items + any calendar events)
                    for (const id of rejectedIds) {
                      try {
                        // Delete planner item
                        await fetch(`/api/planner/items?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
                      } catch { /* silent */ }
                    }

                    // Expand selected labs into calendar events
                    for (const id of selectedIds) {
                      try {
                        await fetch("/api/planner/expand-class", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ plannerItemId: id }),
                        });
                      } catch { /* silent */ }
                    }
                  }}
                  onSkip={() => setLabGroups(null)}
                />
              )}

              {/* Review panel after sync — user toggles items before adding to calendar */}
              {/* Filter out class_meeting items (handled by ingest + lab picker) */}
              {plannerStatus === "done" && !labGroups && plannerReviewItems && plannerReviewItems.length > 0 && (
                <CanvasReviewPanel
                  items={plannerReviewItems.filter((i) => i.itemType !== "class_meeting")}
                  onDone={() => {
                    setPlannerStatus("idle");
                    setPlannerSyncStats(null);
                    setPlannerReviewItems(null);
                  }}
                />
              )}

              {/* Done but nothing found */}
              {plannerStatus === "done" && (!plannerReviewItems || plannerReviewItems.length === 0) && (
                <div className="rounded-xl p-4 text-center" style={{ background: "rgba(124,158,108,0.06)", border: "1px solid rgba(124,158,108,0.2)" }}>
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No upcoming assignments found on Canvas.</p>
                  <button
                    type="button"
                    onClick={() => { setPlannerStatus("idle"); setPlannerSyncStats(null); setPlannerReviewItems(null); }}
                    className="mt-2 px-3 py-1.5 rounded-xl text-xs transition-all hover:scale-[1.02]"
                    style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)", color: "var(--text-secondary)" }}
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Anchor Events (non-negotiable personal commitments) */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--glass-border)" }}>
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Non-negotiables</h2>
            {anchorSaving && <span className="text-[10px]" style={{ color: "var(--accent)" }}>Saving...</span>}
          </div>
          <div className="px-6 py-4 space-y-3">
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Personal commitments your schedule should always protect. The AI will never schedule over these.
            </p>

            {/* Existing anchor events */}
            {anchorEvents.map((ev, i) => (
              <div key={i}>
                {editingAnchor === i ? (
                  <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--accent)" }}>
                    <input type="text" value={ev.name}
                      onChange={(e) => { const u = [...anchorEvents]; u[i] = { ...u[i], name: e.target.value }; setAnchorEvents(u); }}
                      placeholder="Event name" className="w-full px-3 py-2 rounded-lg text-sm"
                      style={{ background: "var(--bg-primary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} autoFocus />
                    <div>
                      <label className="block text-[10px] mb-1.5" style={{ color: "var(--text-muted)" }}>Days</label>
                      <div className="flex gap-1">
                        {DAYS_OF_WEEK.map((day) => (
                          <button key={day} type="button"
                            onClick={() => {
                              const u = [...anchorEvents];
                              const days = ev.days.includes(day) ? ev.days.filter((d) => d !== day) : [...ev.days, day];
                              u[i] = { ...u[i], days };
                              setAnchorEvents(u);
                            }}
                            className="w-8 h-8 rounded-lg text-[10px] font-medium transition-all"
                            style={{
                              background: ev.days.includes(day) ? "rgba(124,158,108,0.2)" : "var(--bg-primary)",
                              border: ev.days.includes(day) ? "2px solid var(--accent)" : "1px solid var(--border-color)",
                              color: ev.days.includes(day) ? "var(--accent)" : "var(--text-secondary)",
                            }}>
                            {day.slice(0, 2)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <label className="block text-[10px] mb-1" style={{ color: "var(--text-muted)" }}>Start</label>
                        <input type="time" value={ev.startTime}
                          onChange={(e) => { const u = [...anchorEvents]; u[i] = { ...u[i], startTime: e.target.value }; setAnchorEvents(u); }}
                          className="w-full px-2 py-1.5 rounded-lg text-xs [color-scheme:dark]"
                          style={{ background: "var(--bg-primary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} />
                      </div>
                      <div className="flex-1">
                        <label className="block text-[10px] mb-1" style={{ color: "var(--text-muted)" }}>End</label>
                        <input type="time" value={ev.endTime}
                          onChange={(e) => { const u = [...anchorEvents]; u[i] = { ...u[i], endTime: e.target.value }; setAnchorEvents(u); }}
                          className="w-full px-2 py-1.5 rounded-lg text-xs [color-scheme:dark]"
                          style={{ background: "var(--bg-primary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] mb-1.5" style={{ color: "var(--text-muted)" }}>Priority</label>
                      <div className="flex gap-2">
                        {(["high", "medium"] as const).map((p) => (
                          <button key={p} type="button"
                            onClick={() => { const u = [...anchorEvents]; u[i] = { ...u[i], priority: p }; setAnchorEvents(u); }}
                            className="flex-1 px-3 py-1.5 rounded-lg text-xs transition-all"
                            style={{
                              background: ev.priority === p ? "rgba(124,158,108,0.15)" : "var(--bg-primary)",
                              border: ev.priority === p ? "2px solid var(--accent)" : "1px solid var(--border-color)",
                              color: ev.priority === p ? "var(--accent)" : "var(--text-secondary)",
                            }}>
                            {p === "high" ? "Must protect" : "Prefer to keep"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button type="button" className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium text-white" style={{ background: "var(--accent)" }}
                        onClick={async () => {
                          setEditingAnchor(null);
                          setAnchorSaving(true);
                          await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ anchor_events: anchorEvents }) });
                          setAnchorSaving(false);
                        }}>
                        Save
                      </button>
                      <button type="button" className="px-3 py-1.5 rounded-lg text-xs"
                        style={{ background: "rgba(232,113,113,0.08)", border: "1px solid rgba(232,113,113,0.15)", color: "#e87171" }}
                        onClick={async () => {
                          const updated = anchorEvents.filter((_, idx) => idx !== i);
                          setAnchorEvents(updated);
                          setEditingAnchor(null);
                          setAnchorSaving(true);
                          await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ anchor_events: updated }) });
                          setAnchorSaving(false);
                        }}>
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setEditingAnchor(i)}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all hover:scale-[1.01]"
                    style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)" }}>
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: ev.priority === "high" ? "var(--accent)" : "var(--text-muted)" }} />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm block" style={{ color: "var(--text-primary)" }}>{ev.name || "Untitled"}</span>
                      <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                        {ev.days.length > 0 ? ev.days.map((d) => d.slice(0, 3)).join(", ") : "No days"} · {ev.startTime}–{ev.endTime} · {ev.priority === "high" ? "Protected" : "Preferred"}
                      </span>
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                )}
              </div>
            ))}

            {/* Quick add */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {ANCHOR_EVENT_PRESETS.map((preset, i) => (
                <button key={preset.label} type="button"
                  onClick={async () => {
                    const newEvent: AnchorEvent = {
                      name: preset.defaults.name || "",
                      days: [],
                      startTime: preset.defaults.startTime || "09:00",
                      endTime: preset.defaults.endTime || "10:00",
                      priority: preset.defaults.priority || "medium",
                    };
                    const updated = [...anchorEvents, newEvent];
                    setAnchorEvents(updated);
                    setEditingAnchor(updated.length - 1);
                  }}
                  className="px-2.5 py-1 rounded-lg text-[11px] transition-all hover:scale-[1.02]"
                  style={{ background: "var(--bg-hover)", border: "1px solid var(--glass-border)", color: "var(--text-secondary)" }}>
                  + {preset.label}
                </button>
              ))}
            </div>

            {anchorEvents.length === 0 && (
              <p className="text-xs text-center py-2" style={{ color: "var(--text-muted)" }}>
                No events yet. Add commitments like workouts, prayer, or meal prep.
              </p>
            )}
          </div>
        </div>

        {/* AI & Scheduling Settings */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--glass-border)" }}>
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>AI & Scheduling</h2>
            {settingsSaving && <span className="text-[10px]" style={{ color: "var(--accent)" }}>Saved</span>}
          </div>
          <div className="px-6 py-4 space-y-1">
            {([
              { key: "aiDirectCalendarAccess" as const, label: "AI can add events to calendar", desc: "When off, the AI will only suggest events — you confirm before they're added" },
              { key: "autoSyncCanvas" as const, label: "Auto-sync Canvas on open", desc: "Automatically check for new assignments when you open Noted" },
              { key: "showAnchorEventsOnCalendar" as const, label: "Show non-negotiables on calendar", desc: "Display your personal commitments (workouts, prayer, etc.) as calendar events" },
              { key: "aiCanManageAnchors" as const, label: "AI can manage non-negotiables", desc: "Allow the AI to add/remove personal commitments via chat" },
              { key: "includeWorkloadEstimates" as const, label: "Include workload estimates", desc: "AI uses estimated hours to suggest realistic study blocks" },
              { key: "voiceEnabled" as const, label: "Voice input", desc: "Use your microphone to talk to Noted" },
              { key: "voiceAutoSend" as const, label: "Auto-send voice", desc: "Automatically send your message when you stop speaking" },
            ]).map(({ key, label, desc }) => (
              <button
                key={key}
                type="button"
                onClick={async () => {
                  const updated = { ...settings, [key]: !settings[key] };
                  setSettings(updated);
                  setSettingsSaving(true);
                  await fetch("/api/profile", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ extra_preferences: { settings: updated } }),
                  }).catch(() => {});
                  setSettingsSaving(false);
                  setTimeout(() => setSettingsSaving(false), 1500);
                }}
                className="w-full flex items-center justify-between py-3 text-left"
                style={{ borderBottom: "1px solid var(--glass-border)" }}
              >
                <div className="pr-4">
                  <p className="text-sm" style={{ color: "var(--text-primary)" }}>{label}</p>
                  <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>{desc}</p>
                </div>
                <div
                  className="w-10 h-6 rounded-full relative flex-shrink-0 transition-colors"
                  style={{ background: settings[key] ? "var(--accent)" : "var(--border-color)" }}
                >
                  <div
                    className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all"
                    style={{ left: settings[key] ? "18px" : "2px" }}
                  />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Danger zone */}
        <div className="glass-card rounded-2xl overflow-hidden" style={{ borderColor: "rgba(232,113,113,0.15)" }}>
          <div className="px-6 py-4" style={{ borderBottom: "1px solid rgba(232,113,113,0.1)" }}>
            <h2 className="text-sm font-semibold" style={{ color: "#e87171" }}>Danger zone</h2>
          </div>
          <div className="px-6 py-4 space-y-3">
            <button
              onClick={handleLogout}
              className="w-full px-4 py-2.5 rounded-xl text-sm text-left transition-colors"
              style={{ background: "var(--bg-hover)", border: "1px solid var(--glass-border)", color: "var(--text-primary)" }}
            >
              Log out
            </button>
            <button
              onClick={handleDeleteAccount}
              className="w-full px-4 py-2.5 rounded-xl text-sm text-left transition-colors"
              style={{ background: "rgba(232,113,113,0.08)", border: "1px solid rgba(232,113,113,0.15)", color: "#e87171" }}
            >
              Delete account
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
