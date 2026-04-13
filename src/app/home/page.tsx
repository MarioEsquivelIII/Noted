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
import { CalendarEvent, generateId, type RecurrenceRule, splitAroundProtected } from "@/lib/events";
import { expandRecurrences, generateSeriesId } from "@/lib/recurrence";
import { EVENTS_SNAPSHOT_KEY, GCAL_IMPORT_KEY } from "@/lib/gcalSync";
import { CANVAS_IMPORT_KEY } from "@/lib/canvas/constants";
import { resolveKnownLocation } from "@/lib/canvas/geocode";
import { ChatMessage } from "@/lib/chat";
import ExtractionReview from "@/components/ExtractionReview";
import { type ExtractedCandidate } from "@/app/api/extract/route";
import { useTheme } from "@/lib/theme";
import { OnboardingProfile, buildPersonalizationPrompt, getUserSettings, type UserSettings } from "@/lib/onboarding";
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const isAuthenticatedRef = useRef(false);
  const eventsLoadedRef = useRef(false);
  const [academicContext, setAcademicContext] = useState<string | null>(null);
  const [personalContext, setPersonalContext] = useState<string | null>(null);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [extractionCandidates, setExtractionCandidates] = useState<unknown[] | null>(null);
  const [extractionImageBase64, setExtractionImageBase64] = useState<string | null>(null);
  const [extractionText, setExtractionText] = useState<string>("");


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

      // Fetch onboarding profile for AI personalization + settings
      try {
        const profileRes = await fetch("/api/profile");
        if (profileRes.ok) {
          const { profile } = await profileRes.json();
          if (profile) {
            const prompt = buildPersonalizationPrompt(profile as OnboardingProfile);
            if (prompt) setPersonalContext(prompt);
            setUserSettings(getUserSettings(profile));
          }
        }
      } catch { /* profile fetch failed, continue without personalization */ }

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
            // Load existing events FIRST, then merge new ones on top
            let existingEvents: CalendarEvent[] = [];
            try {
              const existingRes = await fetch("/api/events");
              if (existingRes.ok) {
                const existingData = await existingRes.json();
                existingEvents = existingData.events || [];
              }
            } catch { /* continue with empty */ }

            const existingIds = new Set(existingEvents.map((e) => e.id));
            const newEvents = imported.filter((e) => !existingIds.has(e.id));
            setEvents([...existingEvents, ...newEvents]);
            eventsLoadedRef.current = true;

            // Persist new events to Supabase
            if (newEvents.length > 0) {
              try {
                await fetch("/api/events", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(newEvents),
                });
              } catch { /* persist failed, events still in local state */ }
            }
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

  // Load academic context for AI planner (Canvas OAuth or iCal planner items)
  useEffect(() => {
    if (!isAuthenticatedRef.current) return;

    // Try Canvas OAuth first (existing flow)
    fetch("/api/canvas/status")
      .then((r) => r.json())
      .then((data) => {
        if (data.connected) {
          // Build academic context from Canvas OAuth data via Supabase
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
          return;
        }

        // Auto-sync Canvas data in the background (if enabled in settings)
        if (!userSettings || userSettings.autoSyncCanvas) {
          fetch("/api/planner/auth")
            .then((r) => r.json())
            .then((authData) => {
              if (authData.authenticated) {
                fetch("/api/planner/ingest", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ scrape: true }),
                }).catch(() => {});
              }
            })
            .catch(() => {});
        }

        // Load rich planner context (iCal + scraper data with descriptions, syllabi)
        fetch("/api/planner/context")
          .then((r) => r.json())
          .then((data) => {
            if (data.context) setAcademicContext(data.context);
          })
          .catch(() => {});
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
      // Route images through extraction pipeline first
      if (imageBase64) {
        try {
          const extractRes = await fetch("/api/extract", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageBase64, text: content, today: new Date().toISOString().split("T")[0] }),
          });
          const extractData = await extractRes.json();
          if (extractData.candidates && extractData.candidates.length > 0) {
            // Show extraction review — pause chat flow
            setExtractionCandidates(extractData.candidates);
            setExtractionImageBase64(imageBase64);
            setExtractionText(content);
            setChatLoading(false);

            const assistantMsg: ChatMessage = {
              id: (Date.now() + 1).toString(),
              role: "assistant",
              content: `I found ${extractData.candidates.length} item${extractData.candidates.length !== 1 ? "s" : ""} in that image. Review them above and choose what to add to your calendar.`,
              timestamp: new Date(),
            };
            setMessages((prev) => [...prev, assistantMsg]);
            return;
          }
        } catch {
          // Extraction failed — fall through to regular chat
        }
      }

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          events,
          imageBase64,
          today: new Date().toISOString().split("T")[0],
          academicContext,
          personalContext,
          // Send recent chat history for conversation memory (last 20 messages)
          history: messages.slice(-20).map((m) => ({ role: m.role, content: m.content })),
        }),
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

        // Handle bulk delete_all_unprotected FIRST
        const hasBulkDelete = parsed.actions.some((a: { type: string }) => a.type === "delete_all_unprotected");
        if (hasBulkDelete) {
          setEvents((prev) => {
            const kept = prev.filter((e) => e.isProtected);
            const removed = prev.filter((e) => !e.isProtected);
            for (const e of removed) toDeleteIds.push(e.id);
            return kept;
          });

          // Persist bulk delete to API
          if (isAuthenticatedRef.current) {
            // Delete all non-protected events via API
            for (const id of toDeleteIds) {
              fetch(`/api/events?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
            }
          }
        }

        // Handle individual actions (skip if bulk delete already handled)
        if (!hasBulkDelete) {
        setEvents((prev) => {
          let updated = [...prev];

          const protectedSkipped: string[] = [];

          for (const action of parsed.actions) {
            if (action.type === "delete") {
              if (action.id) {
                // Check if event is protected
                const target = updated.find((e) => e.id === action.id);
                if (target?.isProtected) {
                  protectedSkipped.push(target.title);
                  continue; // skip — don't delete protected events
                }
                toDeleteIds.push(action.id);
                updated = updated.filter((e) => e.id !== action.id);
              } else if (action.title) {
                const titleLower = action.title.toLowerCase();
                const dateFilter = action.date;
                updated = updated.filter((e) => {
                  const match = e.title.toLowerCase().includes(titleLower) || titleLower.includes(e.title.toLowerCase());
                  if (match && e.isProtected) {
                    protectedSkipped.push(e.title);
                    return true; // keep — protected
                  }
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
                description: action.description || undefined,
              };
              if (action.location) {
                const resolved = resolveLocation(action.location);
                if (resolved) {
                  newEvent.location = resolved;
                }
              }
              // Handle protection flag from AI
              if (action.isProtected) {
                newEvent.isProtected = true;
              }
              // Handle recurrence rule from AI
              if (action.recurrenceRule) {
                const sid = generateSeriesId();
                newEvent.seriesId = sid;
                newEvent.recurrenceRule = action.recurrenceRule as RecurrenceRule;
              }
              toAdd.push(newEvent);
            }
          }

          // Append note about protected events that were skipped
          if (protectedSkipped.length > 0) {
            const names = protectedSkipped.map((n) => `"${n}"`).join(", ");
            responseText += `\n\n*Note: ${names} ${protectedSkipped.length === 1 ? "is" : "are"} non-negotiable and can't be deleted. Remove the protection in Settings first, or ask me to remove the protection.*`;
          }

          return [...updated, ...toAdd];
        });
        } // end if (!hasBulkDelete)

        // Handle protect/unprotect actions
        const protectActions = parsed.actions.filter(
          (a: { type: string }) => a.type === "protect" || a.type === "unprotect"
        );
        if (protectActions.length > 0 && isAuthenticatedRef.current) {
          for (const action of protectActions) {
            const isProtect = action.type === "protect";
            // Find event by id or title
            const targetId = action.id;
            const targetTitle = action.title?.toLowerCase();

            setEvents((prev) => prev.map((e) => {
              if (targetId && e.id === targetId) return { ...e, isProtected: isProtect };
              if (targetTitle && e.title.toLowerCase().includes(targetTitle)) return { ...e, isProtected: isProtect };
              return e;
            }));

            // Persist to DB
            const target = events.find((e) =>
              (targetId && e.id === targetId) || (targetTitle && e.title.toLowerCase().includes(targetTitle))
            );
            if (target) {
              fetch("/api/events", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...target, isProtected: isProtect }),
              }).catch(() => {});
            }
          }
        }

        // Handle anchor event actions (add/remove personal commitments)
        const anchorActions = parsed.actions.filter(
          (a: { type: string }) => a.type === "anchor_add" || a.type === "anchor_remove"
        );
        if (anchorActions.length > 0 && isAuthenticatedRef.current && (!userSettings || userSettings.aiCanManageAnchors)) {
          // Load current anchor events from profile
          fetch("/api/profile").then((r) => r.json()).then((profileData) => {
            let anchors: { name: string; days: string[]; startTime: string; endTime: string; priority: string }[] = profileData.profile?.anchor_events || [];

            for (const action of anchorActions) {
              if (action.type === "anchor_add") {
                // Remove existing with same name (update), then add
                anchors = anchors.filter((a) => a.name.toLowerCase() !== (action.name || "").toLowerCase());
                anchors.push({
                  name: action.name,
                  days: action.days || [],
                  startTime: action.startTime || "09:00",
                  endTime: action.endTime || "10:00",
                  priority: action.priority || "high",
                });
              } else if (action.type === "anchor_remove") {
                anchors = anchors.filter((a) => a.name.toLowerCase() !== (action.name || "").toLowerCase());
              }
            }

            fetch("/api/profile", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ anchor_events: anchors }),
            }).catch(() => {});
          }).catch(() => {});
        }

        // Persist calendar events to Supabase (skip if bulk delete already handled it)
        if (isAuthenticatedRef.current && !hasBulkDelete) {
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
      <header className="fixed top-2 sm:top-4 left-1/2 -translate-x-1/2 z-50 w-[98%] sm:w-[95%] max-w-4xl">
        <nav className="rounded-full px-3 sm:px-5 h-11 sm:h-14 flex items-center justify-between bg-white/10 backdrop-blur-md border border-white/20 shadow-lg shadow-black/5">
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="font-logo text-lg sm:text-xl" style={{ color: "var(--text-primary)" }}>Noted</span>
          </div>

          {/* View toggle — custom dropdown on mobile, pills on desktop */}
          {/* Mobile dropdown */}
          <div className="relative sm:hidden">
            <button
              onClick={() => setMobileNavOpen(!mobileNavOpen)}
              className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-semibold tracking-wide transition-all"
              style={{ background: "var(--accent)", color: "white" }}
            >
              {tabs.find((t) => t.key === view)?.label}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" className={`transition-transform ${mobileNavOpen ? "rotate-180" : ""}`}><path d="M6 9l6 6 6-6"/></svg>
            </button>
            {mobileNavOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMobileNavOpen(false)} />
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 rounded-xl overflow-hidden shadow-2xl" style={{ background: "var(--card-bg)", border: "1px solid var(--border-color)", minWidth: "140px" }}>
                  {tabs.map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => { setView(tab.key); setMobileNavOpen(false); }}
                      className="w-full px-4 py-2.5 text-left text-[12px] font-medium transition-colors flex items-center gap-2"
                      style={{
                        color: view === tab.key ? "var(--accent)" : "var(--text-primary)",
                        background: view === tab.key ? "rgba(124,158,108,0.1)" : "transparent",
                      }}
                      onMouseEnter={(e) => { if (view !== tab.key) e.currentTarget.style.background = "var(--bg-hover)"; }}
                      onMouseLeave={(e) => { if (view !== tab.key) e.currentTarget.style.background = "transparent"; }}
                    >
                      {view === tab.key && (
                        <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />
                      )}
                      {tab.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {/* Desktop pills */}
          <div className="hidden sm:flex items-center gap-0.5 rounded-full p-1 bg-white/5 border border-white/10">
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
        <main className={`pt-16 sm:pt-24 pb-16 sm:pb-20 relative z-10 transition-all ${chatMode === "sidebar" ? "sm:mr-100" : ""}`}>
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
        <main className={`pt-16 sm:pt-24 relative z-10 transition-all ${chatExpanded && chatMode !== "sidebar" ? "pb-[58vh]" : "pb-16 sm:pb-20"} ${chatMode === "sidebar" ? "sm:mr-100" : ""}`}>
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

            <ComingUp events={splitAroundProtected(expandRecurrences(events, new Date().toISOString().split("T")[0], new Date(Date.now() + 28 * 86400000).toISOString().split("T")[0]))} onContextMenu={handleContextMenu} />
          </div>
        </main>
      )}

      {/* ========== CALENDAR TAB ========== */}
      {view === "calendar" && (
        <div className={`flex flex-col pt-14 sm:pt-20 relative z-10 transition-all ${chatMode === "sidebar" ? "sm:mr-100" : ""}`} style={{ height: "100dvh" }}>
          <div className="flex-1 mx-4 mb-4 glass-card rounded-2xl overflow-hidden">
            <WeekCalendar
              events={(() => {
                // Expand recurring events for the visible range (4 weeks from today)
                const today = new Date();
                const start = new Date(today);
                start.setDate(start.getDate() - start.getDay()); // start of current week
                const end = new Date(start);
                end.setDate(end.getDate() + 28);
                return splitAroundProtected(expandRecurrences(events, start.toISOString().split("T")[0], end.toISOString().split("T")[0]));
              })()}
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
        <div className={`flex flex-col pt-14 sm:pt-20 relative z-10 transition-all ${chatMode === "sidebar" ? "sm:mr-100" : ""}`} style={{ height: "100dvh" }}>
          <MapView events={events} theme={theme} />
        </div>
      )}

      {/* Extraction review panel (shown after image analysis) */}
      {extractionCandidates && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] w-full max-w-lg px-4">
          <ExtractionReview
            candidates={extractionCandidates as ExtractedCandidate[]}
            onConfirm={(confirmedEvents) => {
              for (const ev of confirmedEvents) {
                handleAddEvent(ev);
              }
              setExtractionCandidates(null);
              const msg: ChatMessage = {
                id: Date.now().toString(),
                role: "assistant",
                content: `Added ${confirmedEvents.length} event${confirmedEvents.length !== 1 ? "s" : ""} to your calendar.`,
                timestamp: new Date(),
              };
              setMessages((prev) => [...prev, msg]);
            }}
            onChatFallback={async () => {
              // Send the original image to regular chat
              setExtractionCandidates(null);
              if (extractionImageBase64) {
                setChatLoading(true);
                try {
                  const res = await fetch("/api/chat", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ message: extractionText, events, imageBase64: extractionImageBase64, today: new Date().toISOString().split("T")[0], academicContext, personalContext }),
                  });
                  const data = await res.json();
                  const msg: ChatMessage = {
                    id: Date.now().toString(),
                    role: "assistant",
                    content: data.response || "I couldn't process that image.",
                    timestamp: new Date(),
                  };
                  setMessages((prev) => [...prev, msg]);
                } catch {
                  // ignore
                } finally {
                  setChatLoading(false);
                }
              }
            }}
            onCancel={() => setExtractionCandidates(null)}
          />
        </div>
      )}

      {/* Chat bar — only visible on calendar tab */}
      {view === "calendar" && (
        <ChatBar
          messages={messages}
          onSendMessage={handleSendMessage}
          isExpanded={chatExpanded}
          onToggleExpand={() => setChatExpanded(!chatExpanded)}
          isLoading={chatLoading}
          onModeChange={setChatMode}
        />
      )}

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
