import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";

/**
 * POST /api/gcal-export
 * Export Noted events to Google Calendar.
 *
 * Body: { events: CalendarEvent[], calendarId?: string }
 * Uses the Google OAuth token from the noted_google_token cookie.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get Google token from cookie
  const cookieStore = await cookies();
  const tokenCookie = cookieStore.get("noted_google_token");
  if (!tokenCookie?.value) {
    return NextResponse.json({ error: "google_auth_required", message: "Please connect Google Calendar first." }, { status: 401 });
  }
  const googleToken = decodeURIComponent(tokenCookie.value);

  const { events, calendarId = "primary" } = await req.json();
  if (!Array.isArray(events) || events.length === 0) {
    return NextResponse.json({ error: "No events to export" }, { status: 400 });
  }

  let exported = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const event of events) {
    try {
      // Build Google Calendar event object
      const startDate = event.date; // YYYY-MM-DD
      const startTime = event.startTime; // HH:MM
      const endTime = event.endTime; // HH:MM

      const gcalEvent: Record<string, unknown> = {
        summary: event.title,
        start: {
          dateTime: `${startDate}T${startTime}:00`,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
        },
        end: {
          dateTime: `${startDate}T${endTime}:00`,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
        },
      };

      if (event.description) {
        gcalEvent.description = event.description;
      }

      if (event.location?.name) {
        gcalEvent.location = event.location.name;
      }

      // Set color based on Noted color
      const colorMap: Record<string, string> = {
        blue: "1", green: "2", purple: "3", red: "4",
        yellow: "5", orange: "6", teal: "7", gray: "8", pink: "9",
      };
      if (event.color && colorMap[event.color]) {
        gcalEvent.colorId = colorMap[event.color];
      }

      // Check for duplicate — search by summary + start time
      const existingRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?` +
        `timeMin=${startDate}T00:00:00Z&timeMax=${startDate}T23:59:59Z&q=${encodeURIComponent(event.title)}&maxResults=5`,
        { headers: { Authorization: `Bearer ${googleToken}` } }
      );

      if (existingRes.ok) {
        const existingData = await existingRes.json();
        const isDuplicate = (existingData.items || []).some((item: { summary?: string; start?: { dateTime?: string } }) => {
          if (item.summary !== event.title) return false;
          if (item.start?.dateTime?.includes(startTime)) return true;
          return false;
        });

        if (isDuplicate) {
          skipped++;
          continue;
        }
      }

      // Create the event
      const createRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${googleToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(gcalEvent),
        }
      );

      if (createRes.ok) {
        exported++;
      } else {
        const err = await createRes.json();
        failed++;
        if (errors.length < 3) {
          errors.push(`${event.title}: ${err.error?.message || createRes.statusText}`);
        }
      }
    } catch (err) {
      failed++;
      if (errors.length < 3) {
        errors.push(`${event.title}: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    }
  }

  return NextResponse.json({
    exported,
    skipped,
    failed,
    total: events.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}
