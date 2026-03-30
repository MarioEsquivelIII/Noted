"use client";

import { useState, useEffect } from "react";
import type { CalendarEvent } from "@/lib/events";
import { formatTime } from "@/lib/events";
import {
  type RangePreset,
  rangeToRFC3339Bounds,
  fetchGoogleCalendarEvents,
  fetchCalendarList,
  findConflictRows,
  applyMergeWithResolutions,
  readEventsSnapshot,
  type GcalCalendarEntry,
  type ConflictRow,
  type ConflictResolution,
} from "@/lib/gcalSync";

type Step = "range" | "loading_calendars" | "calendars" | "fetching" | "fetch_error" | "strategy" | "conflicts";

interface GoogleCalendarSyncFlowProps {
  open: boolean;
  accessToken: string;
  onClose: () => void;
  onImportComplete: (events: CalendarEvent[], strategy?: "overwrite" | "merge") => void;
}

export default function GoogleCalendarSyncFlow({
  open,
  accessToken,
  onClose,
  onImportComplete,
}: GoogleCalendarSyncFlowProps) {
  const [step, setStep] = useState<Step>("range");
  const [preset, setPreset] = useState<RangePreset>("this_week");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetched, setFetched] = useState<CalendarEvent[]>([]);
  const [conflictRows, setConflictRows] = useState<ConflictRow[]>([]);
  const [resolutions, setResolutions] = useState<Record<string, ConflictResolution>>({});
  const [lastBounds, setLastBounds] = useState<{ timeMin: string; timeMax: string } | null>(null);
  const [availableCalendars, setAvailableCalendars] = useState<GcalCalendarEntry[]>([]);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setStep("range");
    setFetchError(null);
    setFetched([]);
    setConflictRows([]);
    setResolutions({});
    setLastBounds(null);
    setAvailableCalendars([]);
    setSelectedCalendarIds(new Set());
    const t = new Date();
    const endDefault = new Date(t);
    endDefault.setDate(endDefault.getDate() + 30);
    setCustomStart(t.toISOString().slice(0, 10));
    setCustomEnd(endDefault.toISOString().slice(0, 10));
  }, [open]);

  const runFetch = async () => {
    setFetchError(null);
    let bounds: { timeMin: string; timeMax: string };
    try {
      if (preset === "custom") {
        if (!customStart || !customEnd || customStart > customEnd) {
          setFetchError("Choose a valid start and end date.");
          return;
        }
        bounds = rangeToRFC3339Bounds("custom", customStart, customEnd);
      } else {
        bounds = rangeToRFC3339Bounds(preset);
      }
    } catch {
      setFetchError("Invalid date range.");
      return;
    }

    setLastBounds(bounds);
    setStep("loading_calendars");

    try {
      const calendars = await fetchCalendarList(accessToken);
      setAvailableCalendars(calendars);
      setSelectedCalendarIds(new Set(calendars.map((c) => c.id)));
      setStep("calendars");
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to load calendar list.");
      setStep("fetch_error");
    }
  };

  const fetchSelectedEvents = async () => {
    if (selectedCalendarIds.size === 0 || !lastBounds) return;
    setStep("fetching");

    try {
      const events = await fetchGoogleCalendarEvents(
        accessToken,
        lastBounds.timeMin,
        lastBounds.timeMax,
        Array.from(selectedCalendarIds),
      );
      setFetched(events);
      setStep("strategy");
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to load calendar.");
      setStep("fetch_error");
    }
  };

  const toggleCalendar = (id: string) => {
    setSelectedCalendarIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllCalendars = () => {
    setSelectedCalendarIds(new Set(availableCalendars.map((c) => c.id)));
  };

  const deselectAllCalendars = () => {
    setSelectedCalendarIds(new Set());
  };

  const handleOverwrite = () => {
    onImportComplete(fetched, "overwrite");
    onClose();
  };

  const handleMerge = () => {
    const existing = readEventsSnapshot();
    const rows = findConflictRows(existing, fetched);
    if (rows.length === 0) {
      onImportComplete([...existing, ...fetched], "merge");
      onClose();
      return;
    }
    setConflictRows(rows);
    setResolutions({});
    setStep("conflicts");
  };

  const setResolution = (rowId: string, res: ConflictResolution) => {
    setResolutions((prev) => ({ ...prev, [rowId]: res }));
  };

  const allConflictsResolved =
    conflictRows.length > 0 && conflictRows.every((r) => resolutions[r.rowId] !== undefined);

  const applyConflicts = () => {
    if (!allConflictsResolved) return;
    const existing = readEventsSnapshot();
    const map = new Map<string, ConflictResolution>();
    for (const [k, v] of Object.entries(resolutions)) {
      map.set(k, v);
    }
    const merged = applyMergeWithResolutions(existing, fetched, conflictRows, map);
    onImportComplete(merged, "merge");
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-[#333] bg-[#242424] shadow-xl">
        {step === "range" && (
          <div className="p-6 space-y-4">
            <h3 className="text-sm font-semibold text-[#e8e8e8]">Sync from Google Calendar</h3>
            <p className="text-xs text-[#888]">Choose a date range to import from your primary calendar.</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["this_week", "This week"],
                  ["30d", "Next 30 days"],
                  ["3m", "Next 3 months"],
                  ["all", "All upcoming"],
                  ["custom", "Custom"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPreset(id)}
                  className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                    preset === id
                      ? "bg-[#5a8a4a] text-white"
                      : "bg-[#2a2a2a] text-[#ccc] border border-[#333] hover:border-[#5a8a4a]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {preset === "custom" && (
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-[#666] mb-1">Start</label>
                  <input
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="w-full rounded-lg border border-[#333] bg-[#1a1a1a] px-2 py-2 text-sm text-[#e8e8e8] [color-scheme:dark]"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-[#666] mb-1">End</label>
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="w-full rounded-lg border border-[#333] bg-[#1a1a1a] px-2 py-2 text-sm text-[#e8e8e8] [color-scheme:dark]"
                  />
                </div>
              </div>
            )}
            {fetchError && step === "range" && <p className="text-xs text-[#e87171]">{fetchError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-[#333] bg-[#2a2a2a] px-4 py-2 text-xs text-[#ccc] hover:bg-[#333]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={runFetch}
                className="rounded-lg bg-[#5a8a4a] px-4 py-2 text-xs font-medium text-white hover:bg-[#6a9a5a]"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === "loading_calendars" && (
          <div className="p-10 flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#5a8a4a] border-t-transparent" />
            <p className="text-sm text-[#999]">Loading your calendars…</p>
          </div>
        )}

        {step === "calendars" && (
          <div className="p-6 space-y-4">
            <h3 className="text-sm font-semibold text-[#e8e8e8]">Select calendars</h3>
            <p className="text-xs text-[#888]">Choose which Google Calendars to import events from.</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={selectAllCalendars}
                className="rounded-md px-2.5 py-1 text-[10px] font-medium bg-[#2a2a2a] text-[#aaa] border border-[#333] hover:border-[#5a8a4a]"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={deselectAllCalendars}
                className="rounded-md px-2.5 py-1 text-[10px] font-medium bg-[#2a2a2a] text-[#aaa] border border-[#333] hover:border-[#5a8a4a]"
              >
                Deselect All
              </button>
            </div>
            <ul className="space-y-1 max-h-60 overflow-y-auto">
              {availableCalendars.map((cal) => {
                const checked = selectedCalendarIds.has(cal.id);
                return (
                  <li key={cal.id}>
                    <label className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer hover:bg-[#2a2a2a] transition-colors">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCalendar(cal.id)}
                        className="accent-[#5a8a4a] w-3.5 h-3.5"
                      />
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: cal.backgroundColor }}
                      />
                      <span className="text-sm text-[#e8e8e8] truncate">{cal.name}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStep("range")}
                className="rounded-lg border border-[#333] bg-[#2a2a2a] px-4 py-2 text-xs text-[#ccc] hover:bg-[#333]"
              >
                Back
              </button>
              <button
                type="button"
                disabled={selectedCalendarIds.size === 0}
                onClick={fetchSelectedEvents}
                className="rounded-lg bg-[#5a8a4a] px-4 py-2 text-xs font-medium text-white hover:bg-[#6a9a5a] disabled:opacity-40"
              >
                Import {selectedCalendarIds.size} calendar{selectedCalendarIds.size === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        )}

        {step === "fetching" && (
          <div className="p-10 flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#5a8a4a] border-t-transparent" />
            <p className="text-sm text-[#999]">Loading events from Google…</p>
          </div>
        )}

        {step === "fetch_error" && (
          <div className="p-6 space-y-4">
            <h3 className="text-sm font-semibold text-[#e87171]">Couldn&apos;t load calendar</h3>
            <p className="text-xs text-[#aaa]">{fetchError}</p>
            <div className="flex justify-end gap-2 flex-wrap">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-[#333] bg-[#2a2a2a] px-4 py-2 text-xs text-[#ccc]"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep("range");
                  setFetchError(null);
                }}
                className="rounded-lg border border-[#333] bg-[#2a2a2a] px-4 py-2 text-xs text-[#ccc]"
              >
                Change range
              </button>
              <button
                type="button"
                disabled={!lastBounds}
                onClick={async () => {
                  if (!lastBounds) return;
                  setStep("fetching");
                  setFetchError(null);
                  try {
                    const ids = selectedCalendarIds.size > 0 ? Array.from(selectedCalendarIds) : undefined;
                    const events = await fetchGoogleCalendarEvents(accessToken, lastBounds.timeMin, lastBounds.timeMax, ids);
                    setFetched(events);
                    setStep("strategy");
                  } catch (e) {
                    setFetchError(e instanceof Error ? e.message : "Failed to load calendar.");
                    setStep("fetch_error");
                  }
                }}
                className="rounded-lg bg-[#5a8a4a] px-4 py-2 text-xs font-medium text-white hover:bg-[#6a9a5a] disabled:opacity-50"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {step === "strategy" && (
          <div className="p-6 space-y-4">
            <h3 className="text-sm font-semibold text-[#e8e8e8]">Import {fetched.length} event{fetched.length === 1 ? "" : "s"}</h3>
            <p className="text-xs text-[#888]">How should Noted combine these with your current schedule?</p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={handleOverwrite}
                className="rounded-lg border border-[#5a8a4a] bg-[#1e2a1e] px-4 py-3 text-left text-sm text-[#e8e8e8] hover:bg-[#253525]"
              >
                <span className="font-medium">Overwrite</span>
                <span className="block text-xs text-[#888] mt-0.5">Replace all Noted events with this import.</span>
              </button>
              <button
                type="button"
                onClick={handleMerge}
                className="rounded-lg border border-[#333] bg-[#2a2a2a] px-4 py-3 text-left text-sm text-[#e8e8e8] hover:bg-[#333]"
              >
                <span className="font-medium">Merge</span>
                <span className="block text-xs text-[#888] mt-0.5">Keep existing events and add Google events. Overlaps can be resolved next.</span>
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-lg border border-[#333] py-2 text-xs text-[#888] hover:text-[#e8e8e8]"
            >
              Cancel
            </button>
          </div>
        )}

        {step === "conflicts" && (
          <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
            <h3 className="text-sm font-semibold text-[#e8e8e8]">Resolve overlaps</h3>
            <p className="text-xs text-[#888]">Each row overlaps in time on the same day. Choose what to keep.</p>
            <ul className="space-y-4">
              {conflictRows.map((row) => {
                const k = row.noted;
                const g = row.google;
                const cur = resolutions[row.rowId];
                return (
                  <li key={row.rowId} className="rounded-xl border border-[#333] bg-[#1a1a1a] p-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div>
                        <p className="text-[#666] mb-1">Noted</p>
                        <p className="text-[#e8e8e8] font-medium">{k.title}</p>
                        <p className="text-[#888]">
                          {k.date}
                          {k.allDay ? " · All day" : ` · ${formatTime(k.startTime)}–${formatTime(k.endTime)}`}
                        </p>
                      </div>
                      <div>
                        <p className="text-[#666] mb-1">Google</p>
                        <p className="text-[#e8e8e8] font-medium">{g.title}</p>
                        <p className="text-[#888]">
                          {g.date}
                          {g.allDay ? " · All day" : ` · ${formatTime(g.startTime)}–${formatTime(g.endTime)}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(
                        [
                          ["keep_noted", "Keep Noted"],
                          ["use_google", "Use Google"],
                          ["keep_both", "Keep Both"],
                        ] as const
                      ).map(([val, label]) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setResolution(row.rowId, val)}
                          className={`rounded-md px-2.5 py-1 text-[10px] font-medium ${
                            cur === val
                              ? "bg-[#5a8a4a] text-white"
                              : "bg-[#2a2a2a] text-[#aaa] border border-[#333]"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex justify-end gap-2 pt-2 border-t border-[#333]">
              <button
                type="button"
                onClick={() => setStep("strategy")}
                className="rounded-lg border border-[#333] bg-[#2a2a2a] px-4 py-2 text-xs text-[#ccc]"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!allConflictsResolved}
                onClick={applyConflicts}
                className="rounded-lg bg-[#5a8a4a] px-4 py-2 text-xs font-medium text-white disabled:opacity-40"
              >
                Apply merge
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
