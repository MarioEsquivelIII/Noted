/**
 * GT Scheduler data integration.
 *
 * GT Scheduler's crawler publishes pre-crawled Banner 9 data as public JSON
 * at https://gt-scheduler.github.io/crawler-v2/{term}.json
 *
 * This gives us exact: building, room, meeting days, times, instructor, CRN
 * for every course section at Georgia Tech — no auth needed.
 *
 * We match Canvas course codes (e.g., "CHEM 1310 B") to GT Scheduler sections
 * to get accurate class locations and meeting times.
 */

// GT term codes: Spring=02, Summer=05, Fall=08 (e.g., 202602 = Spring 2026)
function getCurrentTermCode(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  // Spring: Jan-May, Summer: Jun-Jul, Fall: Aug-Dec
  if (month <= 5) return `${year}02`;
  if (month <= 7) return `${year}05`;
  return `${year}08`;
}

export interface GTSection {
  courseId: string;     // "CHEM 1310"
  courseName: string;  // "Prin of Gen Chem for Engr"
  section: string;     // "B" or "B04" (lab)
  crn: string;         // "31408"
  meetings: GTMeeting[];
  isLab?: boolean;     // true for lab/studio/recitation sections
}

export interface GTMeeting {
  days: string;        // "MWF", "TR", "MW"
  startTime: string;   // "12:30" (24h)
  endTime: string;     // "13:20" (24h)
  location: string;    // "Klaus Advanced Computing 2443"
  instructors: string[]; // ["Michael Evans", "Andrew Hill (P)"]
}

let cachedData: { term: string; courses: Record<string, unknown> | null; periods: string[] } | null = null;

/**
 * Fetch GT Scheduler data for the current term.
 * Caches in memory to avoid repeated fetches.
 */
async function fetchGTSchedulerData(): Promise<{ courses: Record<string, unknown>; periods: string[] } | null> {
  const term = getCurrentTermCode();

  if (cachedData && cachedData.term === term && cachedData.courses) {
    return { courses: cachedData.courses, periods: cachedData.periods };
  }

  try {
    const url = `https://gt-scheduler.github.io/crawler-v2/${term}.json`;
    const res = await fetch(url, { next: { revalidate: 86400 } }); // cache 24h
    if (!res.ok) return null;

    const data = await res.json();
    const courses = data.courses || {};
    const periods = data.caches?.periods || [];

    cachedData = { term, courses, periods };
    return { courses, periods };
  } catch {
    return null;
  }
}

/**
 * Parse a Canvas course code into subject + number + section.
 * Examples:
 *   "CHEM 1310 B"     → { subject: "CHEM", number: "1310", section: "B", isLab: false }
 *   "CS-3451-A"       → { subject: "CS", number: "3451", section: "A", isLab: false }
 *   "ISYE-3770-M09"   → { subject: "ISYE", number: "3770", section: "M09", isLab: false }
 *   "CHEM-1310L S26"  → { subject: "CHEM", number: "1310", section: "S26", isLab: true }
 *   "CHEM 1310L S26"  → { subject: "CHEM", number: "1310", section: "S26", isLab: true }
 */
function parseCanvasCourseCode(code: string): { subject: string; number: string; section: string; isLab: boolean } | null {
  // Normalize separators
  const clean = code.replace(/-/g, " ").replace(/\s+/g, " ").trim();
  // Match with optional L suffix on the number (e.g., "1310L")
  const match = clean.match(/^([A-Z]+)\s*(\d{4})L?\s*(.*)$/i);
  if (!match) return null;

  const hasLabSuffix = /\d{4}L/i.test(clean);
  return {
    subject: match[1].toUpperCase(),
    number: match[2],
    section: match[3].trim().toUpperCase(),
    isLab: hasLabSuffix,
  };
}

/**
 * Format a Banner time string "1230" to "12:30".
 */
function formatBannerTime(t: string): string {
  if (!t || t.length < 4) return t;
  return `${t.slice(0, 2)}:${t.slice(2)}`;
}

/**
 * Expand day codes to full day names.
 * "MWF" → ["Monday", "Wednesday", "Friday"]
 * "TR" → ["Tuesday", "Thursday"]
 */
function expandDays(days: string): string[] {
  const map: Record<string, string> = {
    M: "Monday", T: "Tuesday", W: "Wednesday", R: "Thursday", F: "Friday", S: "Saturday", U: "Sunday",
  };
  return days.split("").map((c) => map[c]).filter(Boolean);
}

/**
 * Look up a Canvas course in GT Scheduler data.
 * Returns the main section AND related lab/studio/recitation sections.
 *
 * Convention: if student is in section "B", related labs are "B01", "B04", "B07" etc.
 * (same letter prefix + numeric suffix). The lecture is the one without suffix.
 */
export async function lookupCourse(canvasCourseCode: string): Promise<GTSection[]> {
  const parsed = parseCanvasCourseCode(canvasCourseCode);
  if (!parsed) return [];

  const data = await fetchGTSchedulerData();
  if (!data) return [];

  const courseKey = `${parsed.subject} ${parsed.number}`;
  const course = data.courses[courseKey] as [string, Record<string, unknown[]>, ...unknown[]] | undefined;
  if (!course) return [];

  const [courseName, sections] = course;
  const results: GTSection[] = [];

  // Find the main section AND all related sections (labs, studios, recitations)
  // Main section: exact match (e.g., "B")
  // Related: starts with the section letter + has digits (e.g., "B04", "B07")
  //
  // Special case: if the Canvas course IS a lab (e.g., CHEM-1310L S26),
  // we return ALL lab sections (ones with digits) since we can't map Canvas
  // section names to Banner section names directly. User picks in the review.
  const sectionLetter = parsed.section.charAt(0);
  const isLabCourse = parsed.isLab;

  for (const [secName, secData] of Object.entries(sections)) {
    const isMainSection = !isLabCourse && secName === parsed.section;
    const isRelatedLab = !isLabCourse && secName.startsWith(sectionLetter) && secName.length > parsed.section.length && /\d/.test(secName);
    const isAnyLab = isLabCourse && /\d/.test(secName); // for lab courses, match any section with digits

    if (!isMainSection && !isRelatedLab && !isAnyLab) continue;

    const [crn, meetingsRaw] = secData as [string, unknown[][]];
    const meetings: GTMeeting[] = (meetingsRaw || []).map((m: unknown[]) => {
      const timeSlotIdx = m[0] as number;
      const days = m[1] as string;
      const location = m[2] as string;
      const instructors = m[4] as string[];

      const period = data.periods[timeSlotIdx] || "TBA";
      let startTime = "";
      let endTime = "";
      if (period !== "TBA") {
        const parts = period.split(" - ");
        startTime = formatBannerTime(parts[0]);
        endTime = formatBannerTime(parts[1]);
      }

      return { days, startTime, endTime, location, instructors: instructors || [] };
    });

    // Skip TBA sections
    if (meetings.every((m) => !m.startTime)) continue;

    results.push({
      courseId: courseKey,
      courseName: String(courseName),
      section: secName,
      crn: String(crn),
      meetings,
      isLab: isRelatedLab || isAnyLab,
    });
  }

  return results;
}

/**
 * Look up multiple Canvas course codes and return all matches.
 * Smart lab handling: when both "CHEM 1310 B" and "CHEM-1310L S26" exist,
 * only return B-prefix labs (not A-prefix) since we know the student's section.
 */
export async function lookupCourses(canvasCourseCodes: string[]): Promise<GTSection[]> {
  // Build a map of course → lecture section letter (e.g., "CHEM 1310" → "B")
  const lectureLetters: Record<string, string> = {};
  for (const code of canvasCourseCodes) {
    const parsed = parseCanvasCourseCode(code);
    if (parsed && !parsed.isLab && parsed.section) {
      const key = `${parsed.subject} ${parsed.number}`;
      // Only set if it's a single letter (actual section, not a compound code)
      const letter = parsed.section.charAt(0);
      if (/^[A-Z]$/.test(letter)) {
        lectureLetters[key] = letter;
      }
    }
  }

  const results: GTSection[] = [];
  const seen = new Set<string>(); // dedup by courseId + section

  for (const code of canvasCourseCodes) {
    const sections = await lookupCourse(code);
    for (const sec of sections) {
      const key = `${sec.courseId}-${sec.section}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // For lab sections, only keep ones matching the student's lecture section letter
      if (sec.isLab) {
        // Check all possible key formats for this course
        const lectureLetter = lectureLetters[sec.courseId]
          || lectureLetters[sec.courseId.replace(/ /g, "-")]
          || lectureLetters[sec.courseId.replace(/-/g, " ")];
        if (lectureLetter && !sec.section.toUpperCase().startsWith(lectureLetter.toUpperCase())) {
          continue; // skip — this lab belongs to a different lecture section
        }
      }

      results.push(sec);
    }
  }

  return results;
}

/**
 * Enrich planner items with GT Scheduler location + time data.
 * Also creates class meeting planner items for recurring lectures.
 */
export async function enrichWithGTScheduler(
  courseCodes: string[],
): Promise<{
  sections: GTSection[];
  classMeetings: Array<{
    title: string;
    courseCode: string;
    days: string[];
    startTime: string;
    endTime: string;
    location: string;
    instructor: string;
    isLab: boolean;
  }>;
}> {
  const sections = await lookupCourses(courseCodes);
  const classMeetings: Array<{
    title: string;
    courseCode: string;
    days: string[];
    startTime: string;
    endTime: string;
    location: string;
    instructor: string;
    isLab: boolean;
  }> = [];

  for (const sec of sections) {
    for (const meeting of sec.meetings) {
      if (!meeting.startTime || meeting.startTime === "TBA") continue;
      const typeLabel = sec.isLab ? "Lab" : "Lecture";
      classMeetings.push({
        title: sec.isLab
          ? `${sec.courseId} ${sec.section} Lab — ${sec.courseName}`
          : `${sec.courseId} ${sec.section} — ${sec.courseName}`,
        courseCode: `${sec.courseId} ${sec.section}`,
        days: expandDays(meeting.days),
        startTime: meeting.startTime,
        endTime: meeting.endTime,
        location: meeting.location,
        instructor: meeting.instructors.join(", "),
        isLab: sec.isLab || false,
      });
    }
  }

  return { sections, classMeetings };
}
