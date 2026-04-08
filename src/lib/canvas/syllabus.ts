import OpenAI from "openai";
import { SYLLABUS_EXTRACTION_SYSTEM_PROMPT, buildSyllabusExtractionPrompt } from "./prompts";
import type { ExtractedMeeting } from "./types";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/** Strip HTML tags to plain text, preserving basic structure */
export function stripHtmlToText(html: string): string {
  return html
    // Convert block elements to newlines
    .replace(/<\/(p|div|tr|li|h[1-6]|br\s*\/?)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // Convert table cells to tabs
    .replace(/<\/td>/gi, "\t")
    .replace(/<\/th>/gi, "\t")
    // Remove remaining tags
    .replace(/<[^>]+>/g, "")
    // Decode common HTML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Collapse whitespace
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Extract meeting information from syllabus/homepage text using OpenAI */
export async function extractMeetingsFromText(
  courseName: string,
  courseCode: string,
  htmlContent: string,
): Promise<ExtractedMeeting[]> {
  const text = stripHtmlToText(htmlContent);
  if (!text || text.length < 20) return [];

  const userPrompt = buildSyllabusExtractionPrompt(courseName, courseCode, text);

  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: SYLLABUS_EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1, // low temperature for factual extraction
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return [];

    const parsed = JSON.parse(content);
    const meetings: ExtractedMeeting[] = (parsed.meetings || []).map(
      (m: Record<string, unknown>) => ({
        title: String(m.title || ""),
        meetingType: m.meetingType || "lecture",
        days: Array.isArray(m.days) ? m.days : [],
        startTime: String(m.startTime || ""),
        endTime: String(m.endTime || ""),
        date: m.date ? String(m.date) : undefined,
        locationText: m.locationText ? String(m.locationText) : undefined,
        locationMode: m.locationMode || "unknown",
        instructorName: m.instructorName ? String(m.instructorName) : undefined,
        confidence: typeof m.confidence === "number" ? m.confidence : 0.5,
        sourceSnippet: String(m.sourceSnippet || "").slice(0, 200),
      }),
    );

    return meetings;
  } catch (err) {
    console.error("Syllabus extraction failed:", err);
    return [];
  }
}
