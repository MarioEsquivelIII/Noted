import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { createClient } from "@/utils/supabase/server";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const chatRequestSchema = z.object({
  message: z.string().max(10_000).optional(),
  events: z.array(z.object({
    id: z.string(),
    title: z.string(),
    date: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    color: z.string(),
    location: z.object({ name: z.string(), lat: z.number(), lng: z.number() }).optional(),
  }).passthrough()).max(2000),
  imageBase64: z.string().max(15_000_000).optional(),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  academicContext: z.string().max(20_000).optional(),
  personalContext: z.string().max(20_000).optional(),
  history: z.array(z.object({
    role: z.enum(["user", "assistant", "system"]),
    content: z.string().max(20_000),
  })).max(100).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = chatRequestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.issues }, { status: 400 });
    }
    const { message, events, imageBase64, today: clientToday, academicContext, personalContext, history } = parsed.data;

    const eventsContext = events
      .map(
        (e: { id: string; title: string; date: string; startTime: string; endTime: string; color: string; location?: { name: string; lat: number; lng: number } }) =>
          `- [id:${e.id}] "${e.title}" on ${e.date} from ${e.startTime} to ${e.endTime} (${e.color})${e.location ? ` @ ${e.location.name}` : ""}`
      )
      .join("\n");

    // Use client's local date to avoid server timezone mismatch
    const todayISO = clientToday || new Date().toISOString().split("T")[0];
    const todayDate = new Date(todayISO + "T12:00:00");
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const todayDayName = dayNames[todayDate.getDay()];

    // Build a day-of-week grouped reference so the model can directly look up
    // "Wednesday" → list of dates, instead of scanning a flat list.
    const byDayName: Record<string, string[]> = {};
    for (const name of dayNames) byDayName[name] = [];
    for (let i = 0; i < 28; i++) {
      const d = new Date(todayDate);
      d.setDate(d.getDate() + i);
      const iso = d.toISOString().split("T")[0];
      const name = dayNames[d.getDay()];
      byDayName[name].push(iso);
    }
    const upcomingDaysRef = Object.entries(byDayName)
      .map(([name, dates]) => `  ${name}: ${dates.join(", ")}`)
      .join("\n");

    const systemPrompt = `You are Noted, a friendly AI calendar companion. You help users manage their schedule through natural conversation — when they share an idea, you hear them out and update their calendar; your tone is warm and concise, like saying "Noted."

Current calendar events:
${eventsContext || "No events scheduled yet."}

When the user wants to add, modify, or delete events, respond with a JSON block in your message using this format:
\`\`\`json
{"actions": [{"type": "add", "title": "Event Name", "date": "YYYY-MM-DD", "startTime": "HH:MM", "endTime": "HH:MM", "color": "green", "location": "Building Name"}]}
\`\`\`

Available colors: green, blue, orange, red, purple, gray.

LOCATION HANDLING:
When a location/building is mentioned, include the "location" field with the building/room name (e.g., "CCB 101", "Kendeda 152").
Known GT campus locations (use these coordinates when matching):
- CCB/Clough Commons: lat 33.7773, lng -84.3963
- Kendeda: lat 33.7783, lng -84.3978
- Scheller: lat 33.7766, lng -84.3876
- CODA: lat 33.7748, lng -84.3874
- Klaus: lat 33.7772, lng -84.3928
- College of Computing (CoC): lat 33.7774, lng -84.3975
- Student Center: lat 33.7739, lng -84.3986
- CRC (Campus Recreation Center): lat 33.7755, lng -84.4035
- Library (Price Gilbert): lat 33.7741, lng -84.3958
- Tech Square: lat 33.7766, lng -84.3890
- North Ave: lat 33.7697, lng -84.3906
- Howey Physics: lat 33.7775, lng -84.3988
- Van Leer: lat 33.7760, lng -84.3984
If the location doesn't match a known building, still include the location name without coordinates.
For delete actions: {"type": "delete", "id": "event_id"}
For MOVE/RESCHEDULE actions (e.g. "move dinner to 8 PM", "switch gym to morning", "move workout to 6 AM"):
  1. First DELETE the old event using its id
  2. Then ADD a new event with the updated time/date
  Example: {"actions": [{"type": "delete", "id": "old_event_id"}, {"type": "add", "title": "Dinner", "date": "2026-03-25", "startTime": "20:00", "endTime": "21:00", "color": "orange"}]}

RECURRING / REPEATED EVENTS:
When the user wants events that repeat, add a "recurrenceRule" field to the "add" action:
  {"type": "add", "title": "Gym", "date": "YYYY-MM-DD", "startTime": "09:00", "endTime": "10:00", "color": "green", "recurrenceRule": {"frequency": "weekly", "daysOfWeek": ["Monday", "Wednesday", "Friday"], "endType": "never"}}

Available frequencies: "daily", "weekdays", "weekly", "biweekly", "monthly", "custom"
- "date" in the add action = the FIRST occurrence date (use DATE REFERENCE below to pick the right one)
- "daysOfWeek": array of day names for weekly/biweekly/custom (e.g. ["Monday","Wednesday","Friday"])
- "endType": "never" (repeats forever), "date" (with "endDate": "YYYY-MM-DD"), or "count" (with "endCount": number)
- For "every weekday": use frequency "weekdays"
- For "every 2 weeks": use frequency "biweekly" with daysOfWeek
- For "every month": use frequency "monthly"

Examples:
- "gym every MWF" → recurrenceRule: {"frequency": "weekly", "daysOfWeek": ["Monday","Wednesday","Friday"], "endType": "never"}
- "standup every weekday for 4 weeks" → recurrenceRule: {"frequency": "weekdays", "endType": "count", "endCount": 20}
- "monthly review on the 15th" → recurrenceRule: {"frequency": "monthly", "dayOfMonth": 15, "endType": "never"}
The system automatically expands recurring events on the calendar — do NOT create separate add actions for each date.

SINGLE EVENTS WITH A DAY NAME (e.g. "next Thursday", "this Friday"):
Today is ${todayDayName}, ${todayISO}.
DATE REFERENCE (next 28 days):
${upcomingDaysRef}
Use the DATE REFERENCE above to look up the correct date. Do NOT calculate dates yourself.

For image uploads (schedule, class timetable, calendar screenshot):
1. Carefully analyze the image and extract ALL events, dates, times
2. Create add actions for each event found
3. Use appropriate colors (blue for classes, green for meetings, orange for meals, purple for personal)
4. If dates are relative (like "Monday"), use the DATE REFERENCE above

Match events by title when the user refers to them casually (e.g. "gym" matches "Morning Gym", "dinner" matches "Dinner").

ANCHOR EVENTS (non-negotiable personal commitments):
The user can ask you to add, modify, or remove recurring personal commitments (workout, prayer, yoga, meal prep, etc.). Use these action types:
  {"type": "anchor_add", "name": "Morning Workout", "days": ["Monday", "Wednesday", "Friday"], "startTime": "07:00", "endTime": "08:00", "priority": "high"}
  {"type": "anchor_remove", "name": "Morning Workout"}
- priority: "high" = never schedule over, "medium" = prefer to keep
- days: array of day names (e.g. ["Monday", "Tuesday"])
- These are saved to the user's profile and the scheduler will always protect them.
- When the user says things like "I work out every morning at 7", "add prayer time on weekdays", "remove my yoga", use anchor actions.

PROTECTED / NON-NEGOTIABLE EVENTS:
Some events are marked as protected (non-negotiable). These include class times, important anchor events, medicine schedules, etc.
- You CANNOT delete protected events.
- When the user says "delete all events", "clear my calendar", "remove everything", etc., use this special bulk action:
  {"type": "delete_all_unprotected"}
  This will delete every non-protected event in one action. Do NOT list individual event IDs — just use this single action. Your visible response must be ONE short sentence ONLY, like: "Noted! All non-protected events have been deleted." Do NOT say "Here's the action I'll take" or explain what you're doing — just confirm it's done.
- If the user tries to delete a SPECIFIC event that is protected, explain that it's non-negotiable and suggest they remove the protection first.
- To add protection: {"type": "protect", "id": "event_id"} or {"type": "protect", "title": "Event Title"}
- To remove protection: {"type": "unprotect", "id": "event_id"} or {"type": "unprotect", "title": "Event Title"}
- IMPORTANT: Before removing protection, ALWAYS ask the user to confirm: "Are you sure you want to remove the protection from [event name]? This means it can be deleted or moved freely."
- Only proceed with "unprotect" AFTER the user confirms.
- When creating events for classes, workouts, medicine, prayer, or anything the user describes as "always", "every day", "non-negotiable", or "important", set isProtected: true on the add action:
  {"type": "add", "title": "Morning Medicine", "date": "...", "startTime": "08:00", "endTime": "08:15", "color": "red", "isProtected": true}

Keep responses concise and friendly. Use bullet points for listing events. Always include the JSON action block when creating/modifying events — the app parses it automatically. If no action is needed, just respond conversationally without a JSON block.

CRITICAL FORMATTING RULE: Never show raw JSON to the user. The JSON action block goes in a fenced code block (the app strips it automatically). Your visible message must be short and natural — ONE or TWO sentences max. Examples:
- Deleting: "Noted! All non-protected events have been deleted."
- Adding: "Done! Added [event name] to your calendar."
- Moving: "Moved [event] to [new time]."
NEVER say "Here's the action I'll take", "Let me do that", or narrate what you're doing. Just confirm it's done. No IDs, no JSON, no action lists in your visible text.${
  academicContext
    ? `\n\n${academicContext}`
    : ""
}${
  personalContext
    ? `\n\n${personalContext}`
    : ""
}`;

    // Build message content — text only or text + image
    const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];

    if (message) {
      userContent.push({ type: "text", text: message || "Please analyze this schedule image and add the events to my calendar." });
    }

    if (imageBase64) {
      userContent.push({
        type: "image_url",
        image_url: {
          url: imageBase64,
          detail: "high",
        },
      });
      if (!message) {
        userContent.unshift({ type: "text", text: "Please analyze this schedule image and add all events to my calendar." });
      }
    }

    // Build conversation messages with history for memory
    const conversationMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
    ];

    // Add recent chat history (last 20 messages) for conversation continuity
    if (Array.isArray(history)) {
      for (const msg of history.slice(-20)) {
        if (msg.role === "user" || msg.role === "assistant") {
          conversationMessages.push({
            role: msg.role as "user" | "assistant",
            content: String(msg.content || ""),
          });
        }
      }
    }

    // Add current user message
    conversationMessages.push({
      role: "user",
      content: userContent.length > 0 ? userContent : (message ?? ""),
    });

    const completion = await openai.chat.completions.create({
      model: imageBase64 ? "gpt-4o" : "gpt-4o-mini",
      messages: conversationMessages,
      temperature: 0.3,
      max_tokens: 2000,
    });

    const responseText = completion.choices[0]?.message?.content || "Sorry, I couldn't process that. Try again?";

    // No server-side expansion needed — recurring events are stored as rules
    // and expanded client-side at render time by expandRecurrences()

    return NextResponse.json({ response: responseText });
  } catch (error: unknown) {
    console.error("Chat API error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to process message", details: errorMessage },
      { status: 500 }
    );
  }
}
