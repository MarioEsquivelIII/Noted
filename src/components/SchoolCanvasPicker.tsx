"use client";

import { useState, useRef, useEffect } from "react";
import { searchSchools, type CanvasSchool } from "@/lib/canvas-schools";

interface SchoolCanvasPickerProps {
  value: string; // current domain
  onChange: (domain: string) => void;
}

export default function SchoolCanvasPicker({ value, onChange }: SchoolCanvasPickerProps) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<CanvasSchool[]>([]);
  const [selectedName, setSelectedName] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Initialize: find school name from current domain
  useEffect(() => {
    if (value) {
      const match = searchSchools("").find((s) => s.domain === value);
      if (match) setSelectedName(match.name);
    }
  }, [value]);

  useEffect(() => {
    setResults(searchSchools(search));
  }, [search]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectSchool = (school: CanvasSchool) => {
    onChange(school.domain);
    setSelectedName(school.name);
    setSearch("");
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>School</label>

      {/* Selected school display / search input */}
      <div
        className="w-full px-3.5 py-2.5 rounded-xl text-sm cursor-pointer flex items-center justify-between"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
        onClick={() => setOpen(true)}
      >
        {selectedName ? (
          <div className="flex items-center justify-between w-full">
            <div>
              <span>{selectedName}</span>
              <span className="text-[10px] ml-2" style={{ color: "var(--text-muted)" }}>{value}</span>
            </div>
            <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedName(""); onChange(""); setOpen(true); }}
              className="text-xs" style={{ color: "var(--text-muted)" }}>Change</button>
          </div>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>Search your school...</span>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 w-full mt-1 rounded-xl overflow-hidden shadow-lg" style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)" }}>
          <div className="p-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (results.length > 0) {
                    selectSchool(results[0]);
                  } else if (search.trim()) {
                    // No matching school — fall back to custom domain
                    const trimmed = search.trim();
                    const domain = trimmed.includes(".") ? trimmed : `${trimmed.toLowerCase().replace(/\s+/g, "")}.instructure.com`;
                    onChange(domain);
                    setSelectedName(trimmed);
                    setOpen(false);
                    setSearch("");
                  }
                } else if (e.key === "Escape") {
                  setOpen(false);
                }
              }}
              placeholder="Search by school name (Enter to select)..."
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
              autoFocus
            />
          </div>
          <div className="max-h-48 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
            {results.map((school, idx) => (
              <button
                key={school.domain}
                type="button"
                onClick={() => selectSchool(school)}
                className={`w-full px-3.5 py-2.5 text-left transition-colors hover:bg-white/5 ${idx === 0 && search ? "bg-white/5" : ""}`}
              >
                <span className="text-xs block" style={{ color: "var(--text-primary)" }}>
                  {school.name}{idx === 0 && search ? <span className="ml-2 text-[9px]" style={{ color: "var(--accent)" }}>↵ Enter</span> : null}
                </span>
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{school.domain}</span>
              </button>
            ))}
            {results.length === 0 && search && (
              <div className="px-3.5 py-3 text-center">
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>School not found</p>
                <button type="button"
                  onClick={() => {
                    // Allow custom domain input
                    const domain = search.includes(".") ? search : `${search.toLowerCase().replace(/\s+/g, "")}.instructure.com`;
                    onChange(domain);
                    setSelectedName(search);
                    setOpen(false);
                    setSearch("");
                  }}
                  className="text-xs mt-1 px-3 py-1 rounded-lg transition-colors"
                  style={{ color: "var(--accent)", background: "rgba(124,158,108,0.1)" }}>
                  Use &ldquo;{search.includes(".") ? search : `${search.toLowerCase().replace(/\s+/g, "")}.instructure.com`}&rdquo;
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
