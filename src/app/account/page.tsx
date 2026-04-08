"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import GoogleCalendarSyncFlow from "@/components/GoogleCalendarSyncFlow";
import CanvasSyncFlow from "@/components/CanvasSyncFlow";
import type { CalendarEvent } from "@/lib/events";
import { GCAL_IMPORT_KEY } from "@/lib/gcalSync";
import { CANVAS_IMPORT_KEY } from "@/lib/canvas/constants";

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

  // Canvas LMS state
  const [canvasConnected, setCanvasConnected] = useState(false);
  const [canvasDomain, setCanvasDomain] = useState<string | null>(null);
  const [canvasLastSync, setCanvasLastSync] = useState<string | null>(null);
  const [canvasSyncOpen, setCanvasSyncOpen] = useState(false);
  const [canvasError, setCanvasError] = useState<string | null>(null);

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

    // Check Canvas connection status
    fetch("/api/canvas/status")
      .then((r) => r.json())
      .then((data) => {
        setCanvasConnected(!!data.connected);
        setCanvasDomain(data.domain || null);
        setCanvasLastSync(data.lastSyncedAt || null);
      })
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
          scopes: "https://www.googleapis.com/auth/calendar.readonly",
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
                <button
                  type="button"
                  onClick={handleGcalSyncClick}
                  className="px-3 py-1.5 rounded-xl text-xs transition-all hover:scale-[1.02]"
                  style={{ background: "var(--bg-hover)", border: "1px solid var(--glass-border)", color: "var(--text-secondary)" }}
                >
                  {googleProviderToken ? "Sync calendar" : "Connect"}
                </button>
                {gcalOAuthError && (
                  <p className="text-[10px] max-w-[200px] text-right leading-snug" style={{ color: "#e87171" }}>{gcalOAuthError}</p>
                )}
              </div>
            </div>

            {/* Canvas LMS */}
            <div className="flex items-center justify-between mt-4 pt-4" style={{ borderTop: "1px solid var(--glass-border)" }}>
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
                    {canvasConnected
                      ? `Connected to ${canvasDomain}${canvasLastSync ? ` · Last synced ${new Date(canvasLastSync).toLocaleDateString()}` : ""}`
                      : "Import courses, assignments, and class schedules"}
                  </p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                {canvasConnected ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setCanvasSyncOpen(true)}
                      className="px-3 py-1.5 rounded-xl text-xs transition-all hover:scale-[1.02]"
                      style={{ background: "var(--bg-hover)", border: "1px solid var(--glass-border)", color: "var(--text-secondary)" }}
                    >
                      Sync now
                    </button>
                    <button
                      type="button"
                      onClick={handleCanvasDisconnect}
                      className="px-3 py-1.5 rounded-xl text-xs transition-all hover:scale-[1.02]"
                      style={{ background: "rgba(232,113,113,0.08)", border: "1px solid rgba(232,113,113,0.15)", color: "#e87171" }}
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCanvasSyncOpen(true)}
                    className="px-3 py-1.5 rounded-xl text-xs transition-all hover:scale-[1.02]"
                    style={{ background: "var(--bg-hover)", border: "1px solid var(--glass-border)", color: "var(--text-secondary)" }}
                  >
                    Connect
                  </button>
                )}
                {canvasError && (
                  <p className="text-[10px] max-w-[200px] text-right leading-snug" style={{ color: "#e87171" }}>{canvasError}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Preferences */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="px-6 py-4" style={{ borderBottom: "1px solid var(--glass-border)" }}>
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Preferences</h2>
          </div>
          <div className="px-6 py-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm" style={{ color: "var(--text-primary)" }}>Default view</p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>What you see when you open Noted</p>
              </div>
              <select className="px-3 py-1.5 rounded-xl text-xs [color-scheme:dark]"
                style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}>
                <option>Home</option>
                <option>Calendar</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm" style={{ color: "var(--text-primary)" }}>Week starts on</p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>First day of the week</p>
              </div>
              <select className="px-3 py-1.5 rounded-xl text-xs [color-scheme:dark]"
                style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}>
                <option>Sunday</option>
                <option>Monday</option>
              </select>
            </div>
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
