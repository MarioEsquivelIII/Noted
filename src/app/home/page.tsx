"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import ComingUp from "@/components/ComingUp";
import WeekCalendar from "@/components/WeekCalendar";
import ChatBar from "@/components/ChatBar";
import EventContextMenu from "@/components/EventContextMenu";
import EditEventModal from "@/components/EditEventModal";
import EventDetailPanel from "@/components/EventDetailPanel";
import MapView from "@/components/MapView";
import { CalendarEvent, generateId } from "@/lib/events";
import { EVENTS_SNAPSHOT_KEY, GCAL_IMPORT_KEY } from "@/lib/gcalSync";
import { CANVAS_IMPORT_KEY } from "@/lib/canvas/constants";
import { resolveKnownLocation } from "@/lib/canvas/geocode";
import { ChatMessage } from "@/lib/chat";
import { useTheme } from "@/lib/theme";
import { User } from "@supabase/supabase-js";

const NOTED_FEEDBACK_FORM_URL = "https://forms.gle/SsLmAmPGHRCwnewL7";

// Location resolution now uses the shared module from src/lib/canvas/geocode.ts
// which contains the GT_LOCATIONS lookup + Mapbox geocoding fallback
function resolveLocation(locationStr: string): { name: string; lat: number; lng: number } | undefined {
  return resolveKnownLocation(locationStr);
}

export default function HomePage() {
  const router = useRouter();
  const supabase = createClient();
  const [user, setUser] = useState<User | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatExpanded, setChatExpanded] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [view, setView] = useState<"home" | "overview" | "calendar" | "map">("overview");
  const [contextMenu, setContextMenu] = useState<{ event: CalendarEvent; x: number; y: number } | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [detailPanel, setDetailPanel] = useState<{ event: CalendarEvent; x: number; y: number } | null>(null);
  const [chatMode, setChatMode] = useState<"collapsed" | "floating" | "sidebar" | "fullscreen">("collapsed");
  const { theme, toggleTheme } = useTheme();
  const isAuthenticatedRef = useRef(false);
  const eventsLoadedRef = useRef(false);
  const [academicContext, setAcademicContext] = useState<string | null>(null);


  // --- Auth + event loading ---
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user: authUser } }) => {
      if (!authUser) {
        // Guest fallback
        const stored = localStorage.getItem("noted_user");
        if (stored) {
          const parsed = JSON.parse(stored);
          setDisplayName(parsed.name || parsed.email?.split("@")[0] || "User");
        } else {
          router.push("/login");
          return;
        }
        // Load events from localStorage for guests
        isAuthenticatedRef.current = false;
        const savedEvents = localStorage.getItem("noted_events");
        if (savedEvents) {
          try {
            setEvents(JSON.parse(savedEvents));
          } catch {
            setEvents([]);
          }
        }
        eventsLoadedRef.current = true;
        return;
      }
      setUser(authUser);
      setDisplayName(
        authUser.user_metadata?.full_name ||
        authUser.user_metadata?.name ||
        authUser.email?.split("@")[0] ||
        "User"
      );
      isAuthenticatedRef.current = true;

      // Check if there's a pending Google Calendar import — if so, use those events
      // instead of loading from Supabase (the import handler will persist them)
      const pendingImport = sessionStorage.getItem(GCAL_IMPORT_KEY);
      if (pendingImport) {
        // Remove immediately so a second effect run doesn't re-process
        sessionStorage.removeItem(GCAL_IMPORT_KEY);
        try {
          const parsed = JSON.parse(pendingImport);
          const imported: CalendarEvent[] = Array.isArray(parsed) ? parsed : parsed?.events;
          const replaceAll: boolean = !Array.isArray(parsed) && parsed?.replaceAll === true;
          if (Array.isArray(imported) && imported.length > 0) {
            setEvents(imported);
            eventsLoadedRef.current = true;
            // Persist to Supabase and wait for it to complete
            const url = replaceAll ? "/api/events?replaceAll=1" : "/api/events";
            try {
              await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(imported),
              });
            } catch { /* persist failed, events still in local state */ }
            return;
          }
        } catch { /* parse failed, fall through to normal load */ }
      }

      // Check for pending Canvas LMS import (same pattern as Google Calendar)
      const pendingCanvasImport = sessionStorage.getItem(CANVAS_IMPORT_KEY);
      if (pendingCanvasImport) {
        sessionStorage.removeItem(CANVAS_IMPORT_KEY);
        try {
          const parsed = JSON.parse(pendingCanvasImport);
          const imported: CalendarEvent[] = Array.isArray(parsed) ? parsed : parsed?.events;
          if (Array.isArray(imported) && imported.length > 0) {
            // Merge with existing events rather than replacing
            setEvents((prev) => {
              const existingIds = new Set(prev.map((e) => e.id));
              const newEvents = imported.filter((e) => !existingIds.has(e.id));
              return [...prev, ...newEvents];
            });
            eventsLoadedRef.current = true;
            try {
              await fetch("/api/events", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(imported),
              });
            } catch { /* persist failed, events still in local state */ }
            return;
          }
        } catch { /* parse failed, fall through to normal load */ }
      }

      // If events were already loaded by an import (React strict mode double-run),
      // don't overwrite them
      if (eventsLoadedRef.current) return;

      // Load events from Supabase for authenticated users
      try {
        const res = await fetch("/api/events");
        if (res.ok) {
          const data = await res.json();
          setEvents(data.events || []);
        }
      } catch {
        // API unreachable — start empty
      }
      eventsLoadedRef.current = true;
    });
  }, [router, supabase.auth]);

  // Google Calendar imports are now handled inside the auth effect above
  // to avoid race conditions where Supabase loading overwrites imported events.

  // Load Canvas academic context for AI planner
  useEffect(() => {
    if (!isAuthenticatedRef.current) return;
    fetch("/api/canvas/status")
      .then((r) => r.json())
      .then((data) => {
        if (!data.connected) return;
        // Build academic context from Canvas data via Supabase
        const sb = createClient();
        Promise.all([
          sb.from("canvas_courses").select("course_code, name, color").eq("user_id", user?.id).eq("is_active", true),
          sb.from("canvas_academic_items")
            .select("title, item_type, due_at, canvas_courses(course_code)")
            .eq("user_id", user?.id)
            .eq("is_archived", false)
            .not("due_at", "is", null)
            .gte("due_at", new Date().toISOString())
            .lte("due_at", new Date(Date.now() + 14 * 86400000).toISOString())
            .order("due_at", { ascending: true })
            .limit(20),
        ]).then(([coursesRes, itemsRes]) => {
          const courses = coursesRes.data || [];
          const items = itemsRes.data || [];
          if (courses.length === 0) return;

          let ctx = `Academic context (from Canvas LMS — ${data.domain}):\n\nCurrent courses:\n`;
          for (const c of courses) {
            ctx += `  - ${c.course_code || c.name}\n`;
          }
          if (items.length > 0) {
            ctx += `\nUpcoming deadlines (next 14 days):\n`;
            for (const i of items) {
              const cc = (i as Record<string, unknown>).canvas_courses as Record<string, string> | null;
              const code = cc?.course_code || "";
              const dueStr = i.due_at ? new Date(i.due_at).toLocaleDateString() : "";
              ctx += `  - ${code}: ${i.title} — due ${dueStr} [${i.item_type}]\n`;
            }
          }
          ctx += `\nThe user is a college student. Respect class times and suggest study blocks before exams.`;
          setAcademicContext(ctx);
        }).catch(() => {});
      })
      .catch(() => {});
  }, [user, supabase]);

  // Keep sessionStorage snapshot + localStorage fallback in sync
  useEffect(() => {
    if (!eventsLoadedRef.current) return;
    try {
      sessionStorage.setItem(EVENTS_SNAPSHOT_KEY, JSON.stringify(events));
      if (!isAuthenticatedRef.current) {
        localStorage.setItem("noted_events", JSON.stringify(events));
      }
    } catch {
      /* quota */
    }
  }, [events]);

  const handleContextMenu = useCallback((event: CalendarEvent, x: number, y: number) => {
    setContextMenu({ event, x, y });
    setDetailPanel(null);
  }, []);

  const handleDeleteEvent = useCallback((id: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    setDetailPanel(null);
    setContextMenu(null);
    if (isAuthenticatedRef.current) {
      fetch(`/api/events?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    }
  }, []);

  const handleEditEvent = useCallback((event: CalendarEvent) => {
    setEditingEvent(event);
  }, []);

  const handleSaveEvent = useCallback((updated: CalendarEvent) => {
    setEvents((prev) => {
      const exists = prev.find((e) => e.id === updated.id);
      if (exists) return prev.map((e) => (e.id === updated.id ? updated : e));
      return [...prev, updated];
    });
    setEditingEvent(null);
    if (isAuthenticatedRef.current) {
      fetch("/api/events", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      }).catch(() => {});
    }
  }, []);

  const handleAddEvent = useCallback((event: CalendarEvent) => {
    setEvents((prev) => [...prev, event]);
    if (isAuthenticatedRef.current) {
      fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      }).catch(() => {});
    }
  }, []);

  const handleClickEvent = useCallback((event: CalendarEvent, x: number, y: number) => {
    setDetailPanel({ event, x, y });
    setContextMenu(null);
  }, []);

  const handleSendMessage = async (content: string, imageBase64?: string) => {
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: imageBase64 ? `${content || ""} [Uploaded an image]` : content,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setChatLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content, events, imageBase64, today: new Date().toISOString().split("T")[0], academicContext }),
      });

      const data = await res.json();
      let responseText = data.response || data.error || "Sorry, something went wrong.";

      const jsonPatterns = [
        /```json\s*([\s\S]*?)```/,
        /```\s*([\s\S]*?\{"actions"[\s\S]*?)```/,
        /(\{"actions"\s*:\s*\[[\s\S]*\]\s*\})/,
      ];

      let parsed = null;
      for (const pattern of jsonPatterns) {
        const match = responseText.match(pattern);
        if (match) {
          try {
            parsed = JSON.parse(match[1] || match[0]);
            responseText = responseText.replace(match[0], "").trim();
            break;
          } catch {
            // Try next pattern
          }
        }
      }

      if (parsed?.actions) {
        const toAdd: CalendarEvent[] = [];
        const toDeleteIds: string[] = [];

        setEvents((prev) => {
          let updated = [...prev];

          for (const action of parsed.actions) {
            if (action.type === "delete") {
              if (action.id) {
                toDeleteIds.push(action.id);
                updated = updated.filter((e) => e.id !== action.id);
              } else if (action.title) {
                const titleLower = action.title.toLowerCase();
                const dateFilter = action.date;
                updated = updated.filter((e) => {
                  const match = e.title.toLowerCase().includes(titleLower) || titleLower.includes(e.title.toLowerCase());
                  if (dateFilter && match && e.date === dateFilter) {
                    toDeleteIds.push(e.id);
                    return false;
                  }
                  if (!dateFilter && match) {
                    toDeleteIds.push(e.id);
                    return false;
                  }
                  return true;
                });
              }
            } else if (action.type === "add") {
              const newEvent: CalendarEvent = {
                id: generateId(),
                title: action.title,
                date: action.date,
                startTime: action.startTime,
                endTime: action.endTime,
                color: action.color || "green",
              };
              if (action.location) {
                const resolved = resolveLocation(action.location);
                if (resolved) {
                  newEvent.location = resolved;
                }
              }
              toAdd.push(newEvent);
            }
          }

          return [...updated, ...toAdd];
        });

        // Persist to Supabase
        if (isAuthenticatedRef.current) {
          for (const id of toDeleteIds) {
            fetch(`/api/events?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
          }
          if (toAdd.length > 0) {
            fetch("/api/events", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(toAdd),
            }).catch(() => {});
          }
        }
      }

      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: responseText,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "Sorry, I couldn't reach the AI service. Please check your connection and try again.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setChatLoading(false);
    }
  };

  if (!user && !displayName) return null;

  const greetHour = new Date().getHours();
  const greeting = greetHour < 12 ? "Good morning" : greetHour < 18 ? "Good afternoon" : "Good evening";

  const tabs: { key: typeof view; label: string }[] = [
    { key: "home", label: "Home" },
    { key: "overview", label: "Overview" },
    { key: "calendar", label: "Calendar" },
    { key: "map", label: "Map" },
  ];

  return (
    <div className="min-h-screen bg-sky-gradient relative">
      {/* Floating glass navigation */}
      <header className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[95%] max-w-4xl">
        <nav className="rounded-full px-5 h-14 flex items-center justify-between bg-white/10 backdrop-blur-md border border-white/20 shadow-lg shadow-black/5">
          <div className="flex items-center gap-3">
            <span className="font-logo text-xl" style={{ color: "var(--text-primary)" }}>Noted</span>
          </div>

          {/* View toggle — pill switcher */}
          <div className="flex items-center gap-0.5 rounded-full p-1 bg-white/5 border border-white/10">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setView(tab.key)}
                className="px-4 py-1.5 rounded-full text-[12px] font-medium transition-all"
                style={{
                  background: view === tab.key ? "var(--accent)" : "transparent",
                  color: view === tab.key ? "white" : "var(--text-muted)",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-white/10"
              style={{ color: "var(--text-muted)" }}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
                </svg>
              )}
            </button>
            <button
              onClick={() => router.push("/account")}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-colors overflow-hidden hover:bg-white/10"
            >
              {user?.user_metadata?.avatar_url ? (
                <img src={user.user_metadata.avatar_url} alt="" className="w-7 h-7 rounded-full" />
              ) : (
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white" style={{ background: "var(--accent)" }}>
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
            </button>
          </div>
        </nav>
      </header>

      {/* ========== HOME TAB — About Noted ========== */}
      {view === "home" && (
        <main className={`pt-24 pb-20 relative z-10 transition-all ${chatMode === "sidebar" ? "mr-100" : ""}`}>
          <div className="max-w-3xl mx-auto px-5 space-y-16">
            {/* Hero welcome */}
            <div className="text-center pt-8">
              <span className="font-logo text-5xl md:text-6xl glass-text" style={{ color: "var(--accent)" }}>Noted</span>
              <p className="text-lg mt-4" style={{ color: "var(--text-secondary)" }}>
                Your AI-powered calendar. Describe your schedule — Noted builds it.
              </p>
            </div>

            {/* Quick start */}
            <div className="glass-card rounded-2xl p-8">
              <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--text-primary)" }}>Getting started</h2>
              <div className="space-y-4">
                {[
                  { num: "1", title: "Open the chat", desc: "Click the chat bar at the bottom and describe your ideal week in plain language." },
                  { num: "2", title: "Watch it appear", desc: "Noted creates your events instantly. Switch to the Calendar tab to see your schedule." },
                  { num: "3", title: "Refine as you go", desc: "Ask Noted to move, add, or remove events. Or drag and resize them directly on the calendar." },
                ].map((step) => (
                  <div key={step.num} className="flex gap-4 items-start">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold text-white flex-shrink-0" style={{ background: "var(--accent)" }}>
                      {step.num}
                    </div>
                    <div>
                      <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{step.title}</p>
                      <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>{step.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Features grid */}
            <div>
              <h2 className="text-lg font-semibold mb-5" style={{ color: "var(--text-primary)" }}>What Noted can do</h2>
              <div className="grid md:grid-cols-2 gap-4">
                {[
                  {
                    title: "Natural language scheduling",
                    desc: "Say \"gym every weekday at 6am\" or \"study 2 hours after dinner\" — Noted figures out the rest.",
                    icon: (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                      </svg>
                    ),
                  },
                  {
                    title: "Photo-to-calendar",
                    desc: "Upload a photo of a class schedule, meeting agenda, or handwritten plan. It becomes events.",
                    icon: (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
                      </svg>
                    ),
                  },
                  {
                    title: "Voice input",
                    desc: "Tap the mic and speak. Noted transcribes and processes your schedule hands-free.",
                    icon: (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" /><path d="M19 10v2a7 7 0 01-14 0v-2" />
                      </svg>
                    ),
                  },
                  {
                    title: "Google Calendar sync",
                    desc: "Import events from Google Calendar. Choose which calendars, merge or overwrite, resolve conflicts.",
                    icon: (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" /><path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" />
                      </svg>
                    ),
                  },
                  {
                    title: "Drag, resize, edit",
                    desc: "Switch to the Calendar tab to visually move events, adjust times, or click to edit details.",
                    icon: (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                    ),
                  },
                  {
                    title: "Recurring events",
                    desc: "\"Gym every weekday for 4 weeks\" — Noted expands recurring requests into individual events.",
                    icon: (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                      </svg>
                    ),
                  },
                ].map((feature) => (
                  <div key={feature.title} className="glass-card rounded-xl p-5">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(124,158,108,0.12)" }}>
                        {feature.icon}
                      </div>
                      <div>
                        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{feature.title}</p>
                        <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--text-secondary)" }}>{feature.desc}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Try it prompt */}
            <div className="glass-card rounded-2xl p-8 text-center">
              <p className="text-lg font-medium mb-2" style={{ color: "var(--text-primary)" }}>Try saying this in the chat:</p>
              <p className="text-sm italic mb-5" style={{ color: "var(--text-secondary)" }}>
                &ldquo;Make me a weekly schedule for college. I have classes Monday and Wednesday from 10 AM to 2 PM,
                want to study 2 hours a day, go to the gym 4 times a week, keep Fridays lighter, and sleep by midnight.&rdquo;
              </p>
              <button
                onClick={() => setView("overview")}
                className="px-6 py-2.5 rounded-full text-sm font-medium text-white transition-all hover:scale-[1.02]"
                style={{ background: "var(--accent)" }}
              >
                Go to Overview
              </button>
            </div>

            {/* Feedback */}
            <div className="glass-card rounded-2xl p-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>Send feedback</h2>
                <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
                  Tell us what you think about the UI, the chat, or what you wish your calendar could do — it helps a lot.
                </p>
              </div>
              <a
                href={NOTED_FEEDBACK_FORM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center px-6 py-2.5 rounded-full text-sm font-medium whitespace-nowrap border transition-all hover:bg-white/10"
                style={{ borderColor: "var(--accent)", color: "var(--text-primary)" }}
              >
                Open feedback form
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ml-2 opacity-70" aria-hidden>
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            </div>
          </div>
        </main>
      )}

      {/* ========== OVERVIEW TAB — Greeting + Coming Up ========== */}
      {view === "overview" && (
        <main className={`pt-24 relative z-10 transition-all ${chatExpanded && chatMode !== "sidebar" ? "pb-[58vh]" : "pb-20"} ${chatMode === "sidebar" ? "mr-100" : ""}`}>
          <div className="space-y-10">
            <div className="max-w-2xl mx-auto px-5">
              <div className="glass-card rounded-2xl p-6">
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                </p>
                <h1 className="text-2xl font-semibold mt-1" style={{ color: "var(--text-primary)" }}>
                  {greeting}, {displayName}
                </h1>
              </div>
            </div>

            <ComingUp events={events} onContextMenu={handleContextMenu} />
          </div>
        </main>
      )}

      {/* ========== CALENDAR TAB ========== */}
      {view === "calendar" && (
        <div className={`flex flex-col pt-20 relative z-10 transition-all ${chatMode === "sidebar" ? "mr-100" : ""}`} style={{ height: "100vh" }}>
          <div className="flex-1 mx-4 mb-4 glass-card rounded-2xl overflow-hidden">
            <WeekCalendar
              events={events}
              onContextMenu={handleContextMenu}
              onAddEvent={handleAddEvent}
              onClickEvent={handleClickEvent}
              onUpdateEvent={handleSaveEvent}
              onGoogleSync={async () => { router.push("/account"); }}
            />
          </div>
        </div>
      )}

      {/* ========== MAP TAB ========== */}
      {view === "map" && (
        <div className={`flex flex-col pt-20 relative z-10 transition-all ${chatMode === "sidebar" ? "mr-100" : ""}`} style={{ height: "100vh" }}>
          <MapView events={events} theme={theme} />
        </div>
      )}

      {/* Chat bar */}
      <ChatBar
        messages={messages}
        onSendMessage={handleSendMessage}
        isExpanded={chatExpanded}
        onToggleExpand={() => setChatExpanded(!chatExpanded)}
        isLoading={chatLoading}
        onModeChange={setChatMode}
      />

      {/* Context menu */}
      {contextMenu && (
        <EventContextMenu
          event={contextMenu.event}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onDelete={handleDeleteEvent}
          onEdit={handleEditEvent}
        />
      )}

      {/* Edit modal (from context menu) */}
      {editingEvent && (
        <EditEventModal
          event={editingEvent}
          onSave={handleSaveEvent}
          onClose={() => setEditingEvent(null)}
        />
      )}

      {/* Detail panel (Notion-style, from clicking event) */}
      {detailPanel && (
        <EventDetailPanel
          event={detailPanel.event}
          position={{ x: detailPanel.x, y: detailPanel.y }}
          onClose={() => setDetailPanel(null)}
          onSave={handleSaveEvent}
          onDelete={(id) => { handleDeleteEvent(id); setDetailPanel(null); }}
        />
      )}
    </div>
  );
}
