import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { createClient } from "@/utils/supabase/server";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const extractRequestSchema = z.object({
  imageBase64: z.string().min(1).max(15_000_000),
  text: z.string().max(5_000).optional(),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** Structured candidate extracted from an image */
export interface ExtractedCandidate {
  id: string;
  type: "event" | "task" | "note" | "reminder";
  title: string;
  date?: string;          // YYYY-MM-DD
  startTime?: string;     // HH:MM
  endTime?: string;       // HH:MM
  location?: string;
  description?: string;
  confidence: number;     // 0-1
  needsClarification: boolean;
  clarificationQuestion?: string;
  raw?: string;           // original text from image
}

/**
 * POST /api/extract
 * Extract structured schedule/event data from an image.
 * Uses a specialized extraction prompt (different from chat).
 *
 * Input: { imageBase64: string, text?: string, today: string }
 * Output: { candidates: ExtractedCandidate[] }
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = extractRequestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.issues }, { status: 400 });
    }
    const { imageBase64, text, today } = parsed.data;

    const todayStr = today || new Date().toISOString().split("T")[0];

    const extractionPrompt = `You are a structured data extraction system. Analyze the provided image and extract any schedule-related information.

Today's date is ${todayStr}.

Extract each item as a JSON object with these fields:
- id: a unique short string (e.g., "ext_1", "ext_2")
- type: "event" | "task" | "note" | "reminder"
  - "event" = has a specific date and time (class, meeting, appointment)
  - "task" = has a deadline but no fixed time (assignment, homework)
  - "note" = informational, no date/time needed (syllabus info, contact info)
  - "reminder" = something to remember but not schedulable
- title: clear, concise title
- date: YYYY-MM-DD format if detectable (use ${todayStr} as reference for relative dates like "Monday", "next week")
- startTime: HH:MM in 24-hour format if detectable
- endTime: HH:MM in 24-hour format if detectable
- location: location/room if mentioned
- description: additional details or context
- confidence: 0.0 to 1.0 — how certain you are about this extraction
  - 1.0 = clearly stated date, time, and title
  - 0.7-0.9 = most info clear but some inferred
  - 0.4-0.6 = partial info, some guessing involved
  - 0.0-0.3 = very uncertain, mostly guessing
- needsClarification: true if you need the user to confirm or provide missing info
- clarificationQuestion: a specific question to ask the user if needsClarification is true
- raw: the exact text from the image that this item was extracted from

IMPORTANT RULES:
- Do NOT fake confidence. If a date is unclear, set confidence low and needsClarification=true.
- If the image shows a recurring schedule (like a class timetable), extract each unique class/event once and note the recurrence in the description.
- If there are multiple possible interpretations, pick the most likely one and set confidence accordingly.
- For screenshots of text conversations, extract any plans or commitments mentioned.
- For flyers, extract the event details (title, date, time, location).
- For to-do lists, extract each item as a "task".
${text ? `\nThe user also said: "${text}"\nUse their message as additional context for what to extract and how to categorize items.` : ""}

Respond with ONLY a JSON array of extracted candidates. No other text.
Example: [{"id":"ext_1","type":"event","title":"CS 2340 Lecture","date":"2026-04-14","startTime":"09:30","endTime":"10:45","location":"Klaus 1443","description":"Computer Science class","confidence":0.95,"needsClarification":false,"raw":"CS 2340 - MWF 9:30-10:45 Klaus 1443"}]`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: extractionPrompt },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageBase64, detail: "high" } },
            ...(text ? [{ type: "text" as const, text: `User context: ${text}` }] : []),
          ],
        },
      ],
      temperature: 0.2,
      max_tokens: 3000,
    });

    const responseText = completion.choices[0]?.message?.content || "[]";

    // Parse the JSON array from the response
    let candidates: ExtractedCandidate[] = [];
    try {
      // Try to extract JSON from markdown code block or raw
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/) || responseText.match(/(\[[\s\S]*\])/);
      const jsonStr = jsonMatch ? jsonMatch[1] : responseText;
      const parsed = JSON.parse(jsonStr.trim());
      if (Array.isArray(parsed)) {
        candidates = parsed.map((c: Record<string, unknown>, i: number) => ({
          id: (c.id as string) || `ext_${i + 1}`,
          type: (c.type as ExtractedCandidate["type"]) || "event",
          title: (c.title as string) || "Untitled",
          date: (c.date as string) || undefined,
          startTime: (c.startTime as string) || undefined,
          endTime: (c.endTime as string) || undefined,
          location: (c.location as string) || undefined,
          description: (c.description as string) || undefined,
          confidence: Math.max(0, Math.min(1, Number(c.confidence) || 0.5)),
          needsClarification: Boolean(c.needsClarification),
          clarificationQuestion: (c.clarificationQuestion as string) || undefined,
          raw: (c.raw as string) || undefined,
        }));
      }
    } catch {
      // If parsing fails, return empty with an error note
      return NextResponse.json({
        candidates: [],
        error: "Could not parse extraction results",
      });
    }

    return NextResponse.json({ candidates });
  } catch (error) {
    console.error("Extraction error:", error);
    return NextResponse.json(
      { error: "Extraction failed", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
