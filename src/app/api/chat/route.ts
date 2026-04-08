import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: NextRequest) {
  try {
    const { message, events, imageBase64, today: clientToday, academicContext } = await req.json();

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
When the user wants events that repeat (e.g. "every Wednesday for 4 weeks", "gym every weekday", "daily standup"), use type "recurring" instead of creating individual add actions:
  {"type": "recurring", "title": "Event Name", "daysOfWeek": ["Wednesday"], "weeks": 4, "startTime": "HH:MM", "endTime": "HH:MM", "color": "green"}
- daysOfWeek: array of day names. E.g. ["Monday","Wednesday","Friday"] for MWF, or ["Monday","Tuesday","Wednesday","Thursday","Friday"] for weekdays.
- weeks: how many weeks to create events for (starting from this week).
The system will automatically compute the correct dates — do NOT try to calculate dates yourself.

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

Keep responses concise and friendly. Use bullet points for listing events. Always include the JSON action block when creating/modifying events — the app parses it automatically. If no action is needed, just respond conversationally without a JSON block.${
  academicContext
    ? `\n\n${academicContext}`
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

    const completion = await openai.chat.completions.create({
      model: imageBase64 ? "gpt-4o" : "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent.length > 0 ? userContent : message },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    });

    let responseText = completion.choices[0]?.message?.content || "Sorry, I couldn't process that. Try again?";

    // Post-process: expand "recurring" actions into individual "add" actions
    // using real JavaScript date math so dates are always correct.
    const jsonPatterns = [
      /```json\s*([\s\S]*?)```/,
      /```\s*([\s\S]*?\{"actions"[\s\S]*?)```/,
      /(\{"actions"\s*:\s*\[[\s\S]*\]\s*\})/,
    ];

    for (const pattern of jsonPatterns) {
      const match = responseText.match(pattern);
      if (match) {
        try {
          const parsed = JSON.parse(match[1] || match[0]);
          if (parsed?.actions) {
            const expandedActions = [];
            for (const action of parsed.actions) {
              if (action.type === "recurring") {
                const daysRequested: string[] = action.daysOfWeek || [];
                const weeks: number = action.weeks || 4;
                const dayNameToIndex: Record<string, number> = {
                  "Sunday": 0, "Monday": 1, "Tuesday": 2, "Wednesday": 3,
                  "Thursday": 4, "Friday": 5, "Saturday": 6,
                };
                // Collect all matching dates in the next N weeks
                const totalDays = weeks * 7;
                for (let i = 0; i < totalDays; i++) {
                  const d = new Date(todayDate);
                  d.setDate(d.getDate() + i);
                  const dayIndex = d.getDay();
                  const matchesDay = daysRequested.some(
                    (name: string) => dayNameToIndex[name] === dayIndex
                  );
                  if (matchesDay) {
                    expandedActions.push({
                      type: "add",
                      title: action.title,
                      date: d.toISOString().split("T")[0],
                      startTime: action.startTime,
                      endTime: action.endTime,
                      color: action.color || "green",
                    });
                  }
                }
              } else {
                expandedActions.push(action);
              }
            }
            // Replace the JSON block in the response with expanded actions
            const expandedJson = JSON.stringify({ actions: expandedActions }, null, 2);
            responseText = responseText.replace(match[0], "```json\n" + expandedJson + "\n```");
          }
        } catch {
          // JSON parse failed, leave response as-is
        }
        break;
      }
    }

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
