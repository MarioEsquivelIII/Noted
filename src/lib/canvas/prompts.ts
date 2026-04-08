/** System prompt for extracting meeting info from syllabus / homepage text */
export const SYLLABUS_EXTRACTION_SYSTEM_PROMPT = `You extract class meeting information from university course syllabi and homepages.

Given: a course name, course code, and text content from the syllabus or homepage.

Extract ALL of the following if present:
- Lecture times (days of week, start time, end time, location)
- Lab/recitation times
- Office hours (instructor name, days, times, location)
- Exam dates (midterm, final — specific dates if given)
- Support/review sessions

Return JSON:
{
  "meetings": [
    {
      "title": "descriptive title, e.g. 'CS 2340 Lecture' or 'Office Hours - Prof. Smith'",
      "meetingType": "lecture" | "lab" | "recitation" | "office_hours" | "exam" | "review_session",
      "days": ["Monday", "Wednesday", "Friday"],
      "startTime": "HH:MM",
      "endTime": "HH:MM",
      "date": "YYYY-MM-DD or null (only for one-off events like exams)",
      "locationText": "raw location string from text",
      "locationMode": "in_person" | "remote" | "hybrid" | "unknown",
      "instructorName": "name or null",
      "confidence": 0.0-1.0,
      "sourceSnippet": "the exact text excerpt you extracted this from (max 200 chars)"
    }
  ]
}

Rules:
- Use 24-hour time format (e.g. "14:30" not "2:30 PM")
- Only extract what is EXPLICITLY stated. Do NOT hallucinate or guess.
- If a time range is ambiguous, set confidence below 0.5
- If location mentions Zoom, Teams, WebEx, or a video/meeting link, set locationMode to "remote"
- If a room number or building name is given, set locationMode to "in_person"
- If both remote and in-person info are present, set locationMode to "hybrid"
- For recurring meetings, use the "days" array. For one-off events (exams), use the "date" field.
- If no meetings found, return {"meetings": []}`;

/** Build the user prompt for syllabus extraction */
export function buildSyllabusExtractionPrompt(
  courseName: string,
  courseCode: string,
  text: string,
): string {
  // Truncate to ~8000 chars to stay within token limits
  const truncated = text.length > 8000 ? text.slice(0, 8000) + "\n[...truncated]" : text;

  return `Course: ${courseName} (${courseCode})

Syllabus / Homepage content:
---
${truncated}
---

Extract all meeting information from the text above. Return JSON only.`;
}

/** System prompt addition for the chat API — academic context block */
export function buildAcademicContextPrompt(
  domain: string,
  courses: Array<{
    courseCode: string;
    name: string;
    meetingInfo?: string; // e.g. "MWF 10:00-10:50, CCB 016"
  }>,
  upcomingItems: Array<{
    courseCode: string;
    title: string;
    dueDate: string;
    points?: number;
    type: string;
  }>,
): string {
  const courseLines = courses
    .map((c) => `  - ${c.courseCode} ${c.name}${c.meetingInfo ? ` (${c.meetingInfo})` : ""}`)
    .join("\n");

  const itemLines = upcomingItems
    .map(
      (i) =>
        `  - ${i.courseCode}: ${i.title} — due ${i.dueDate}${i.points ? `, ${i.points} pts` : ""} [${i.type}]`,
    )
    .join("\n");

  return `
Academic context (from Canvas LMS — ${domain}):

Current courses:
${courseLines || "  (none synced)"}

Upcoming deadlines (next 14 days):
${itemLines || "  (none)"}

The user is a college student. When they ask about scheduling:
- Respect fixed class meeting times (do not schedule over them)
- Suggest study blocks before upcoming exams/quizzes
- For assignments, suggest work sessions 2-3 days before due dates
- Account for travel time between in-person locations
- Remote classes don't need travel time
`.trim();
}
