"use client";

import { useState, useEffect } from "react";
import type { CalendarEvent } from "@/lib/events";
import { formatTime } from "@/lib/events";
import type { InferredMeeting, CanvasCourseRow, NotedAcademicItem } from "@/lib/canvas/types";
import { COURSE_COLOR_PALETTE } from "@/lib/canvas/constants";

type Step =
  | "domain_entry"
  | "loading_courses"
  | "course_selection"
  | "syncing"
  | "syllabus_review"
  | "location_review"
  | "import_summary"
  | "complete"
  | "error";

interface CanvasSyncFlowProps {
  open: boolean;
  onClose: () => void;
  onImportComplete: (events: CalendarEvent[]) => void;
  /** If already connected, skip domain entry */
  isConnected?: boolean;
  connectionDomain?: string;
}

interface CourseSelection {
  id: string;
  canvasCourseId: string;
  name: string;
  courseCode: string;
  color: string;
  selected: boolean;
}

export default function CanvasSyncFlow({
  open,
  onClose,
  onImportComplete,
  isConnected,
  connectionDomain,
}: CanvasSyncFlowProps) {
  const [step, setStep] = useState<Step>("domain_entry");
  const [domain, setDomain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [courses, setCourses] = useState<CourseSelection[]>([]);
  const [items, setItems] = useState<NotedAcademicItem[]>([]);
  const [meetings, setMeetings] = useState<InferredMeeting[]>([]);
  const [meetingApprovals, setMeetingApprovals] = useState<Record<string, boolean>>({});
  const [syncProgress, setSyncProgress] = useState("");
  const [importedEvents, setImportedEvents] = useState<CalendarEvent[]>([]);
  const [lowConfidenceLocations, setLowConfidenceLocations] = useState<InferredMeeting[]>([]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setItems([]);
    setMeetings([]);
    setMeetingApprovals({});
    setImportedEvents([]);
    setLowConfidenceLocations([]);

    if (isConnected && connectionDomain) {
      setDomain(connectionDomain);
      setStep("loading_courses");
      startSync();
    } else {
      setStep("domain_entry");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleConnect = async () => {
    const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
    if (!cleanDomain) {
      setError("Please enter your school's Canvas URL");
      return;
    }

    setError(null);
    try {
      const res = await fetch("/api/canvas/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: cleanDomain }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to start Canvas connection");
        return;
      }

      // Redirect to Canvas OAuth page
      window.location.href = data.authUrl;
    } catch {
      setError("Failed to connect to Canvas. Please try again.");
    }
  };

  const startSync = async (courseIds?: string[]) => {
    setStep("syncing");
    setSyncProgress("Loading courses and assignments...");

    try {
      const res = await fetch("/api/canvas/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseIds }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Sync failed");
        setStep("error");
        return;
      }

      // Process courses
      const courseSelections: CourseSelection[] = (data.courses || []).map(
        (c: CanvasCourseRow, i: number) => ({
          id: c.id,
          canvasCourseId: c.canvas_course_id,
          name: c.name,
          courseCode: c.course_code || c.name,
          color: c.color || COURSE_COLOR_PALETTE[i % COURSE_COLOR_PALETTE.length],
          selected: true,
        }),
      );
      setCourses(courseSelections);
      setItems(data.items || []);

      // Extract syllabi for each course
      setSyncProgress("Extracting class schedules from syllabi...");
      const allMeetings: InferredMeeting[] = [];
      for (const course of courseSelections) {
        try {
          const syllRes = await fetch("/api/canvas/syllabus", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ courseId: course.id }),
          });
          const syllData = await syllRes.json();
          if (syllData.meetings?.length > 0) {
            allMeetings.push(...syllData.meetings);
          }
        } catch {
          // Syllabus extraction is optional — continue
        }
      }

      setMeetings(allMeetings);

      // Initialize approvals (default: approve high-confidence meetings)
      const approvals: Record<string, boolean> = {};
      for (const m of allMeetings) {
        approvals[m.id] = m.confidence >= 0.7;
      }
      setMeetingApprovals(approvals);

      // Find low-confidence locations for review
      setLowConfidenceLocations(
        allMeetings.filter((m) => m.locationRequiresReview),
      );

      if (allMeetings.length > 0) {
        setStep("syllabus_review");
      } else {
        setStep("import_summary");
      }
    } catch {
      setError("Sync failed. Please try again.");
      setStep("error");
    }
  };

  const handleApproveMeetings = async () => {
    // Build approval list and submit
    const approvals = Object.entries(meetingApprovals).map(([meetingId, approved]) => ({
      meetingId,
      approved,
    }));

    try {
      const res = await fetch("/api/canvas/approve-meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvals }),
      });
      const data = await res.json();

      if (data.events?.length > 0) {
        setImportedEvents((prev) => [...prev, ...data.events]);
      }
    } catch {
      // Non-critical — continue
    }

    if (lowConfidenceLocations.length > 0) {
      setStep("location_review");
    } else {
      setStep("import_summary");
    }
  };

  const handleFinalImport = async () => {
    // Convert academic items to CalendarEvents via API
    // (items are already in Supabase; just need to generate CalendarEvents)
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(importedEvents),
      });
      if (!res.ok) {
        console.warn("Failed to persist Canvas events");
      }
    } catch {
      // fire-and-forget
    }

    onImportComplete(importedEvents);
    setStep("complete");
  };

  const toggleMeetingApproval = (id: string) => {
    setMeetingApprovals((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const selectAllMeetings = (approved: boolean) => {
    const updated: Record<string, boolean> = {};
    for (const m of meetings) {
      updated[m.id] = approved;
    }
    setMeetingApprovals(updated);
  };

  if (!open) return null;

  const confidenceBadge = (c: number) => {
    if (c >= 0.8) return { label: "High", cls: "bg-green-600/30 text-green-300" };
    if (c >= 0.5) return { label: "Medium", cls: "bg-yellow-600/30 text-yellow-300" };
    return { label: "Low", cls: "bg-red-600/30 text-red-300" };
  };

  const meetingTypeLabel = (type: string) => {
    const map: Record<string, string> = {
      lecture: "Lecture",
      lab: "Lab",
      recitation: "Recitation",
      office_hours: "Office Hours",
      exam: "Exam",
      review_session: "Review Session",
    };
    return map[type] || type;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-[#333] bg-[#242424] shadow-xl">
        {/* ─── Step: Domain Entry ─── */}
        {step === "domain_entry" && (
          <div className="p-6 space-y-4">
            <h3 className="text-sm font-semibold text-[#e8e8e8]">Connect Canvas LMS</h3>
            <p className="text-xs text-[#888]">
              Enter your school&apos;s Canvas URL to connect your account.
            </p>
            <div className="space-y-2">
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="canvas.gatech.edu"
                className="w-full rounded-lg border border-[#333] bg-[#1a1a1a] px-3 py-2 text-sm text-[#e8e8e8] placeholder-[#666] focus:border-[#5a8a4a] focus:outline-none"
                onKeyDown={(e) => e.key === "Enter" && handleConnect()}
              />
              {error && <p className="text-xs text-red-400">{error}</p>}
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-xs text-[#888] hover:text-[#ccc] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConnect}
                className="rounded-lg bg-[#5a8a4a] px-4 py-2 text-xs text-white hover:bg-[#4a7a3a] transition-colors"
              >
                Connect to Canvas
              </button>
            </div>
          </div>
        )}

        {/* ─── Step: Loading / Syncing ─── */}
        {(step === "loading_courses" || step === "syncing") && (
          <div className="p-6 flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#5a8a4a] border-t-transparent" />
            <p className="text-xs text-[#888]">{syncProgress || "Connecting to Canvas..."}</p>
          </div>
        )}

        {/* ─── Step: Course Selection ─── */}
        {step === "course_selection" && (
          <div className="p-6 space-y-4">
            <h3 className="text-sm font-semibold text-[#e8e8e8]">Select Courses</h3>
            <p className="text-xs text-[#888]">Choose which courses to import.</p>
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => setCourses(courses.map((c) => ({ ...c, selected: true })))}
                className="text-xs text-[#5a8a4a] hover:underline"
              >
                Select all
              </button>
              <button
                onClick={() => setCourses(courses.map((c) => ({ ...c, selected: false })))}
                className="text-xs text-[#888] hover:underline"
              >
                Deselect all
              </button>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {courses.map((course) => (
                <label
                  key={course.id}
                  className="flex items-center gap-3 rounded-lg p-2 hover:bg-[#2a2a2a] cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={course.selected}
                    onChange={() =>
                      setCourses(
                        courses.map((c) =>
                          c.id === course.id ? { ...c, selected: !c.selected } : c,
                        ),
                      )
                    }
                    className="accent-[#5a8a4a]"
                  />
                  <span
                    className="h-3 w-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: `var(--event-${course.color}-bg, #5a8a4a)` }}
                  />
                  <div className="min-w-0">
                    <div className="text-xs text-[#e8e8e8] truncate">{course.name}</div>
                    <div className="text-[10px] text-[#666]">{course.courseCode}</div>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-xs text-[#888] hover:text-[#ccc] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const selectedIds = courses.filter((c) => c.selected).map((c) => c.canvasCourseId);
                  if (selectedIds.length === 0) return;
                  startSync(selectedIds);
                }}
                className="rounded-lg bg-[#5a8a4a] px-4 py-2 text-xs text-white hover:bg-[#4a7a3a] transition-colors"
                disabled={courses.filter((c) => c.selected).length === 0}
              >
                Import Selected ({courses.filter((c) => c.selected).length})
              </button>
            </div>
          </div>
        )}

        {/* ─── Step: Syllabus Review (Inferred Meetings) ─── */}
        {step === "syllabus_review" && (
          <div className="p-6 space-y-4">
            <h3 className="text-sm font-semibold text-[#e8e8e8]">
              Review Class Schedule
            </h3>
            <p className="text-xs text-[#888]">
              We found {meetings.length} class meeting{meetings.length !== 1 ? "s" : ""} from
              your syllabi. Review and approve the ones that look correct.
            </p>
            <div className="flex gap-2 mb-2">
              <button onClick={() => selectAllMeetings(true)} className="text-xs text-[#5a8a4a] hover:underline">
                Approve all
              </button>
              <button onClick={() => selectAllMeetings(false)} className="text-xs text-[#888] hover:underline">
                Reject all
              </button>
            </div>

            <div className="space-y-3 max-h-[50vh] overflow-y-auto">
              {meetings.map((m) => {
                const badge = confidenceBadge(m.confidence);
                const approved = meetingApprovals[m.id] ?? false;
                return (
                  <div
                    key={m.id}
                    className={`rounded-lg border p-3 transition-colors ${
                      approved ? "border-[#5a8a4a]/50 bg-[#5a8a4a]/10" : "border-[#333] bg-[#1a1a1a]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-[#e8e8e8]">
                            {m.title || `${m.courseCode} ${meetingTypeLabel(m.meetingType)}`}
                          </span>
                          <span className={`rounded px-1.5 py-0.5 text-[10px] ${badge.cls}`}>
                            {badge.label}
                          </span>
                        </div>
                        <div className="text-[10px] text-[#888] mt-1">
                          <span className="font-medium">{meetingTypeLabel(m.meetingType)}</span>
                          {" · "}
                          {m.daysOfWeek.join(", ")}
                          {" · "}
                          {formatTime(m.startTime)} – {formatTime(m.endTime)}
                        </div>
                        {m.locationRaw && (
                          <div className="text-[10px] text-[#666] mt-0.5">
                            📍 {m.locationName || m.locationRaw}
                            {m.locationMode === "remote" && " (Remote)"}
                            {m.locationRequiresReview && (
                              <span className="text-yellow-400 ml-1">(Location needs review)</span>
                            )}
                          </div>
                        )}
                        {m.instructorName && (
                          <div className="text-[10px] text-[#666] mt-0.5">
                            👤 {m.instructorName}
                          </div>
                        )}
                        {m.sourceText && (
                          <div className="mt-1 rounded bg-[#2a2a2a] px-2 py-1 text-[10px] text-[#666] italic">
                            &ldquo;{m.sourceText}&rdquo;
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => toggleMeetingApproval(m.id)}
                        className={`flex-shrink-0 rounded px-3 py-1 text-[10px] font-medium transition-colors ${
                          approved
                            ? "bg-[#5a8a4a] text-white"
                            : "bg-[#2a2a2a] text-[#888] border border-[#333] hover:border-[#5a8a4a]"
                        }`}
                      >
                        {approved ? "Approved" : "Approve"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setStep("import_summary")}
                className="rounded-lg px-4 py-2 text-xs text-[#888] hover:text-[#ccc] transition-colors"
              >
                Skip
              </button>
              <button
                onClick={handleApproveMeetings}
                className="rounded-lg bg-[#5a8a4a] px-4 py-2 text-xs text-white hover:bg-[#4a7a3a] transition-colors"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* ─── Step: Location Review ─── */}
        {step === "location_review" && (
          <div className="p-6 space-y-4">
            <h3 className="text-sm font-semibold text-[#e8e8e8]">Review Locations</h3>
            <p className="text-xs text-[#888]">
              Some locations had low geocoding confidence. Please review:
            </p>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {lowConfidenceLocations.map((m) => (
                <div key={m.id} className="rounded-lg border border-[#333] bg-[#1a1a1a] p-3">
                  <div className="text-xs text-[#e8e8e8]">{m.title}</div>
                  <div className="text-[10px] text-[#888] mt-1">
                    Original: &ldquo;{m.locationRaw}&rdquo;
                  </div>
                  {m.locationName && m.locationLat && (
                    <div className="text-[10px] text-[#5a8a4a] mt-0.5">
                      Resolved: {m.locationName} ({m.locationLat.toFixed(4)}, {m.locationLng?.toFixed(4)})
                      <span className="text-[#666] ml-1">
                        ({Math.round((m.geocodeConfidence || 0) * 100)}% confidence)
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setStep("import_summary")}
                className="rounded-lg bg-[#5a8a4a] px-4 py-2 text-xs text-white hover:bg-[#4a7a3a] transition-colors"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* ─── Step: Import Summary ─── */}
        {step === "import_summary" && (
          <div className="p-6 space-y-4">
            <h3 className="text-sm font-semibold text-[#e8e8e8]">Import Summary</h3>
            <div className="space-y-2 text-xs text-[#ccc]">
              <div className="flex justify-between">
                <span>Courses synced:</span>
                <span className="text-[#e8e8e8] font-medium">
                  {courses.filter((c) => c.selected).length}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Academic items imported:</span>
                <span className="text-[#e8e8e8] font-medium">{items.length}</span>
              </div>
              <div className="flex justify-between">
                <span>Class meetings approved:</span>
                <span className="text-[#e8e8e8] font-medium">
                  {Object.values(meetingApprovals).filter(Boolean).length}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Calendar events to add:</span>
                <span className="text-[#5a8a4a] font-medium">{importedEvents.length}</span>
              </div>
            </div>

            {/* Item type breakdown */}
            {items.length > 0 && (
              <div className="rounded-lg border border-[#333] bg-[#1a1a1a] p-3 space-y-1">
                <div className="text-[10px] text-[#888] font-medium mb-1">By type:</div>
                {Object.entries(
                  items.reduce<Record<string, number>>((acc, i) => {
                    acc[i.type] = (acc[i.type] || 0) + 1;
                    return acc;
                  }, {}),
                ).map(([type, count]) => (
                  <div key={type} className="flex justify-between text-[10px]">
                    <span className="text-[#888] capitalize">{type.replace("_", " ")}</span>
                    <span className="text-[#ccc]">{count}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-xs text-[#888] hover:text-[#ccc] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleFinalImport}
                className="rounded-lg bg-[#5a8a4a] px-4 py-2 text-xs text-white hover:bg-[#4a7a3a] transition-colors"
              >
                Import to Calendar
              </button>
            </div>
          </div>
        )}

        {/* ─── Step: Complete ─── */}
        {step === "complete" && (
          <div className="p-6 space-y-4 text-center">
            <div className="text-2xl">✅</div>
            <h3 className="text-sm font-semibold text-[#e8e8e8]">Import Complete</h3>
            <p className="text-xs text-[#888]">
              {importedEvents.length} event{importedEvents.length !== 1 ? "s" : ""} added to your
              calendar.
            </p>
            <button
              onClick={onClose}
              className="rounded-lg bg-[#5a8a4a] px-6 py-2 text-xs text-white hover:bg-[#4a7a3a] transition-colors"
            >
              Go to Calendar
            </button>
          </div>
        )}

        {/* ─── Step: Error ─── */}
        {step === "error" && (
          <div className="p-6 space-y-4">
            <h3 className="text-sm font-semibold text-red-400">Something went wrong</h3>
            <p className="text-xs text-[#888]">{error || "An unexpected error occurred."}</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-xs text-[#888] hover:text-[#ccc] transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setError(null);
                  setStep("domain_entry");
                }}
                className="rounded-lg bg-[#5a8a4a] px-4 py-2 text-xs text-white hover:bg-[#4a7a3a] transition-colors"
              >
                Try Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
