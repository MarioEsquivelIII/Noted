"use client";

import { useState, useRef, useEffect } from "react";
import { OnboardingStepProps } from "@/lib/onboarding";

// ─── Top US universities (searchable, user can also type custom) ───
const UNIVERSITIES = [
  "Georgia Institute of Technology", "Massachusetts Institute of Technology", "Stanford University",
  "Harvard University", "Carnegie Mellon University", "University of California, Berkeley",
  "California Institute of Technology", "Princeton University", "Cornell University",
  "University of Michigan", "University of Illinois Urbana-Champaign", "University of Texas at Austin",
  "Columbia University", "University of Pennsylvania", "Yale University", "Duke University",
  "Northwestern University", "University of Washington", "University of Wisconsin-Madison",
  "University of California, Los Angeles", "University of Southern California", "New York University",
  "Rice University", "Purdue University", "University of Maryland", "Virginia Tech",
  "University of Florida", "Penn State University", "Ohio State University", "Texas A&M University",
  "University of North Carolina at Chapel Hill", "Boston University", "University of Minnesota",
  "Arizona State University", "University of Colorado Boulder", "University of Virginia",
  "Georgia State University", "Emory University", "Vanderbilt University", "Washington University in St. Louis",
  "Johns Hopkins University", "Brown University", "Dartmouth College", "University of Notre Dame",
  "University of California, San Diego", "University of California, Davis", "University of California, Irvine",
  "University of California, Santa Barbara", "Rutgers University", "University of Pittsburgh",
  "Indiana University", "University of Iowa", "University of Oregon", "University of Arizona",
  "Michigan State University", "North Carolina State University", "Clemson University",
  "University of Georgia", "Auburn University", "University of Alabama", "University of Tennessee",
  "Florida State University", "University of Central Florida", "University of South Florida",
  "University of Connecticut", "University of Massachusetts Amherst", "Northeastern University",
  "George Washington University", "Georgetown University", "American University",
  "Drexel University", "Temple University", "Tulane University", "University of Miami",
  "Brigham Young University", "University of Utah", "Colorado School of Mines",
  "Rensselaer Polytechnic Institute", "Rochester Institute of Technology", "Worcester Polytechnic Institute",
  "Stevens Institute of Technology", "Illinois Institute of Technology", "Florida International University",
  "University of Houston", "University of Cincinnati", "University of Kentucky",
  "University of Oklahoma", "University of Kansas", "University of Nebraska-Lincoln",
  "University of South Carolina", "Louisiana State University", "University of Arkansas",
  "Mississippi State University", "Iowa State University", "Kansas State University",
  "Oregon State University", "Washington State University", "University of New Mexico",
  "San Diego State University", "San Jose State University", "Cal Poly San Luis Obispo",
  "Stony Brook University", "University at Buffalo", "Binghamton University",
];

// ─── Common majors ───
const MAJORS = [
  "Computer Science", "Computer Engineering", "Software Engineering", "Electrical Engineering",
  "Mechanical Engineering", "Civil Engineering", "Chemical Engineering", "Biomedical Engineering",
  "Aerospace Engineering", "Industrial Engineering", "Materials Science", "Environmental Engineering",
  "Biology", "Chemistry", "Physics", "Mathematics", "Statistics",
  "Data Science", "Information Technology", "Cybersecurity", "Information Systems",
  "Business Administration", "Finance", "Accounting", "Marketing", "Economics",
  "Management", "Entrepreneurship", "Supply Chain Management", "International Business",
  "Psychology", "Sociology", "Political Science", "History", "English",
  "Philosophy", "Communications", "Journalism", "Public Relations",
  "Nursing", "Pre-Med", "Public Health", "Kinesiology", "Neuroscience",
  "Architecture", "Graphic Design", "Industrial Design", "Film", "Music",
  "Education", "Criminal Justice", "Social Work", "International Relations",
  "Linguistics", "Anthropology", "Environmental Science", "Geology",
  "Biochemistry", "Genetics", "Microbiology", "Pre-Law", "Pre-Dental",
  "Undeclared / Exploratory",
];

function SearchableDropdown({
  value,
  onChange,
  options,
  placeholder,
  label,
}: {
  value: string;
  onChange: (val: string) => void;
  options: string[];
  placeholder: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync search with external value
  useEffect(() => { setSearch(value); }, [value]);

  const filtered = search
    ? options.filter((o) => o.toLowerCase().includes(search.toLowerCase())).slice(0, 8)
    : options.slice(0, 8);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>{label}</label>
      <input
        ref={inputRef}
        type="text"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-full px-3.5 py-2.5 rounded-xl text-sm transition-colors"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
      />
      {open && filtered.length > 0 && (
        <div
          className="absolute z-50 w-full mt-1 rounded-xl overflow-hidden shadow-lg max-h-48 overflow-y-auto"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)", scrollbarWidth: "thin" }}
        >
          {filtered.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setSearch(option);
                onChange(option);
                setOpen(false);
              }}
              className="w-full px-3.5 py-2 text-xs text-left transition-colors hover:bg-white/5"
              style={{ color: "var(--text-primary)" }}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AcademicInfoStep({ data, onUpdate, onNext, onBack, onSkip }: OnboardingStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
          About your academics
        </h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          This helps us understand your workload and tailor study recommendations.
        </p>
      </div>

      <div className="space-y-4">
        <SearchableDropdown
          value={data.school_name || ""}
          onChange={(val) => onUpdate({ school_name: val || null })}
          options={UNIVERSITIES}
          placeholder="Search or type your school..."
          label="School"
        />

        <SearchableDropdown
          value={data.major || ""}
          onChange={(val) => onUpdate({ major: val || null })}
          options={MAJORS}
          placeholder="Search or type your major..."
          label="Major / Program"
        />

        <div>
          <label className="block text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>
            How many classes are you taking?
          </label>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onUpdate({ num_classes: Math.max(1, (data.num_classes || 4) - 1) })}
              className="w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-colors"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
            >
              -
            </button>
            <span className="text-lg font-medium w-8 text-center" style={{ color: "var(--text-primary)" }}>
              {data.num_classes || 4}
            </span>
            <button
              onClick={() => onUpdate({ num_classes: Math.min(10, (data.num_classes || 4) + 1) })}
              className="w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-colors"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
            >
              +
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>
            How many hours do you study per week?
          </label>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={0}
              max={60}
              step={2}
              value={data.study_hours_per_week || 10}
              onChange={(e) => onUpdate({ study_hours_per_week: Number(e.target.value) })}
              className="flex-1 accent-[var(--accent)]"
            />
            <span className="text-sm font-medium w-14 text-right" style={{ color: "var(--text-primary)" }}>
              {data.study_hours_per_week || 10}h/wk
            </span>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }}
        >
          Back
        </button>
        <button
          onClick={onNext}
          className="flex-1 px-4 py-2.5 rounded-xl text-white text-sm font-medium transition-all hover:scale-[1.02]"
          style={{ background: "var(--accent)" }}
        >
          Continue
        </button>
      </div>
      <button
        onClick={onSkip}
        className="w-full text-xs text-center transition-colors"
        style={{ color: "var(--text-muted)" }}
      >
        Skip this step
      </button>
    </div>
  );
}
