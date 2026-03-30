# Noted

**You name it. Noted builds it.**

Noted is an AI-powered calendar builder: when you have an idea, you mention it to the chat — it hears you out, updates your calendar, and your answer is *Noted.* That's the name.

It turns natural-language descriptions into structured, editable weekly calendars. Instead of manually creating every time block, you describe the schedule you want and Noted generates it for you. You can then visually edit the calendar, refine it with follow-up prompts, and sync with Google Calendar.

---

## Features

- Generate weekly calendars from natural-language descriptions
- Upload an image of a schedule or timetable and have it converted to events
- Voice input via Web Speech API
- Visual weekly, daily, and monthly calendar views (full 24-hour grid, Sunday-first)
- Drag-to-create and drag-to-move events with 15-minute snapping
- Google Calendar-style overlap layout (side-by-side for same start time, indent for partial overlap)
- Inline event editing with a Notion-style detail panel and edit modal
- Right-click context menu for quick event actions
- Follow-up chat prompts to add, move, or remove events without starting over
- Recurring event support
- Google Calendar import with calendar selection, conflict resolution (merge or overwrite), and color preservation
- Interactive Mapbox map view showing event locations with walking routes
- Copy-to-clipboard for AI-drafted availability emails
- Multiple image upload support in chat
- 9 event colors: green, blue, orange, red, purple, gray, teal, yellow, pink
- Light and dark theme with glass-morphism UI
- Secure authentication with Supabase (email/password and Google OAuth)
- Event persistence in Supabase (per-user, with Row-Level Security)
- Guest fallback via localStorage when no Supabase session exists

---

## Example Prompt

> Make me a weekly schedule for college. I have classes Monday and Wednesday from 10 AM to 2 PM, want to study 2 hours a day, go to the gym 4 times a week, keep Fridays lighter, and sleep by midnight.

Noted converts that into a structured weekly calendar inside the app.

---

## Tech Stack

| Layer | Tool |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript 5 |
| Styling | Tailwind CSS 4 |
| Auth + DB | Supabase (`@supabase/supabase-js`, `@supabase/ssr`) |
| AI | OpenAI SDK — `gpt-4o-mini` (text), `gpt-4o` (image input) |
| Maps | Mapbox GL JS |
| State | React `useState` + Supabase persistence |

---

## How It Works

1. The user enters a natural-language description or uploads a schedule image.
2. The request is sent to the Next.js API route with the current event context.
3. The API route calls OpenAI and returns structured JSON calendar actions (with optional location data).
4. The frontend parses the actions (add, delete, recurring) and updates the calendar.
5. Events are persisted to Supabase in real time (or localStorage for guests).
6. The weekly schedule is rendered visually in the app.
7. The user can manually edit events, refine with another prompt, or sync from Google Calendar.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- A [Supabase](https://supabase.com/) project (for authentication and event storage)
- An [OpenAI](https://platform.openai.com/) API key
- (Optional) A [Mapbox](https://www.mapbox.com/) access token for the map view

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/MarioEsquivelIII/Kronos.git
   cd Kronos
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a `.env` file in the project root:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   OPENAI_API_KEY=your_openai_api_key
   NEXT_PUBLIC_MAPBOX_TOKEN=your_mapbox_token  # optional
   ```

4. Set up the database — run the SQL in `supabase/migrations/001_create_events_table.sql` in your Supabase SQL Editor. This creates the `events` table with Row-Level Security policies.

5. Start the development server:

   ```bash
   npm run dev
   ```

   The app will be available at [http://localhost:3000](http://localhost:3000).

### Supabase Configuration

In your Supabase Dashboard > Authentication > URL Configuration:

- **Site URL:** Your production URL (e.g. `https://noted-calendar.vercel.app/`)
- **Redirect URLs:** Add both:
  - `http://localhost:3000/auth/callback`
  - `https://your-production-domain.com/auth/callback`

For Google Calendar sync, ensure Google OAuth is configured in Supabase > Authentication > Providers > Google, with `calendar.readonly` scope enabled.

---

## Project Structure

```
Kronos/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── chat/route.ts           # OpenAI API route (AI layer)
│   │   │   └── events/route.ts         # Event CRUD API (GET/POST/PUT/DELETE)
│   │   ├── home/page.tsx               # Main experience: events state + persistence
│   │   ├── login/page.tsx              # Email/password + Google OAuth sign-in
│   │   ├── signup/page.tsx             # Registration with email verification
│   │   ├── account/page.tsx            # Profile, Google Calendar sync
│   │   └── auth/callback/route.ts      # Supabase OAuth callback
│   ├── components/
│   │   ├── WeekCalendar.tsx            # Week/day/month grid with drag/resize/create
│   │   ├── MapView.tsx                 # Mapbox map with event locations + walking routes
│   │   ├── ComingUp.tsx                # Upcoming events list (overview tab)
│   │   ├── ChatBar.tsx                 # Chat UI with voice, multi-image, copy-to-clipboard
│   │   ├── EditEventModal.tsx          # Event editing modal
│   │   ├── EventContextMenu.tsx        # Right-click event actions
│   │   ├── EventDetailPanel.tsx        # Notion-style inline event editor with meal suggestions
│   │   └── GoogleCalendarSyncFlow.tsx  # Multi-step Google Calendar import dialog
│   ├── lib/
│   │   ├── events.ts                   # CalendarEvent type + utility functions
│   │   ├── chat.ts                     # Chat types + offline parse helpers
│   │   ├── gcalSync.ts                 # Google Calendar fetch, parse, color mapping, conflicts
│   │   └── theme.tsx                   # Light/dark theme provider
│   ├── middleware.ts                   # Supabase session refresh + route guards
│   └── utils/supabase/                 # Supabase client/server/middleware helpers
├── supabase/
│   └── migrations/
│       └── 001_create_events_table.sql # Database schema + RLS policies
├── public/
├── package.json
├── next.config.ts
├── tsconfig.json
└── postcss.config.mjs
```

*(The repository folder may still be named `Kronos` on disk; the product name is **Noted**.)*

---

## Current Limitations

| Area | Status |
|---|---|
| Google Calendar sync | Import-only (read-only scope); does not push events back to Google. |
| Recurring events | Supported via AI chat (expanded to individual events), no native recurrence rules. |
| Mobile optimization | Not yet optimized for mobile viewports. |
| Mapbox | Requires access token; shows placeholder when not configured. |

---

## Security Notes

- Do not commit `.env` — it is included in `.gitignore`.
- Keep API keys private.
- Supabase handles auth with Row-Level Security; each user can only access their own events.
- The app falls back to localStorage for guest sessions.

---

## Author

Built by Mario A. Esquivel III.
