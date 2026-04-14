# Noted

**You name it. Noted builds it.**

Noted is an AI-powered calendar builder designed for students. Connect your school's Canvas LMS, and Noted automatically imports your classes, labs, assignments, and deadlines — then builds a personalized schedule around your study style, productivity peaks, and personal commitments.

Instead of manually creating every time block, you describe what you need and Noted generates it. Talk to the AI assistant, upload a screenshot of your syllabus, or let Noted suggest study blocks before your deadlines.

---

## Key Features

### For Students
- **Canvas LMS integration** — Connect via Playwright browser automation. Imports courses, assignments, labs, syllabi, and deadlines from any Canvas instance
- **GT Banner 9 data** — For Georgia Tech students, automatically pulls exact class times, rooms, buildings, and instructors from the registrar
- **Lab section picker** — Detects available lab sections for your courses and lets you choose yours
- **Smart scheduling** — Generates study blocks based on your onboarding preferences (morning/night person, short/deep sessions, deadline approach)
- **Workload estimation** — Heuristic-based effort estimates per assignment with confidence scoring

### AI Assistant
- **Natural language** — "Add a meeting tomorrow at 3", "Move gym to Friday", "Build my study schedule for the week"
- **Conversation memory** — The AI remembers what you said earlier in the conversation
- **Image extraction** — Upload a screenshot of a schedule, flyer, or syllabus. Noted extracts events with confidence scoring and shows a review panel before adding
- **Voice input** — Speak to Noted using Web Speech API
- **Canvas context** — The AI knows your courses, deadlines, workload estimates, and syllabi

### Calendar
- **Weekly, daily, and monthly views** with full 24-hour grid
- **Drag-to-create and drag-to-move** events with 15-minute snapping
- **Recurring events** — Daily, weekdays, weekly, biweekly, monthly, custom days with optional end dates
- **Protected events** — Classes and non-negotiable commitments (workouts, prayer, medicine) can't be accidentally deleted
- **Event splitting** — Protected events automatically split overlapping regular events
- **Descriptions** — Add notes and details to any event
- **9 event colors** — Green, blue, orange, red, purple, gray, teal, yellow, pink

### Personalization
- **Onboarding flow** — 7-step flow that learns your user type, school, major, study habits, productivity peaks, challenges, wellness routine, and personal commitments
- **Anchor events** — Non-negotiable personal commitments (workouts, prayer, meal prep) that the schedule always respects
- **Feature settings** — Toggle auto-sync, AI calendar access, voice, workload estimates, and more

### Integrations
- **Google Calendar** — Import from and export to Google Calendar with color preservation
- **Campus map** — Mapbox map view showing class locations with walking routes between buildings
- **Canvas iCal feed** — Parse Canvas calendar feeds for accurate event times (when available)

---

## Tech Stack

| Layer | Tool |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript 5 |
| Styling | Tailwind CSS 4 |
| Auth + DB | Supabase (Row-Level Security) |
| AI | OpenAI — `gpt-4o-mini` (text), `gpt-4o` (images) |
| Maps | Mapbox GL JS |
| Browser automation | Playwright (Canvas scraping) |
| Validation | Zod |
| Animation | Framer Motion |

---

## Getting Started

### Prerequisites

- Node.js v18+
- A [Supabase](https://supabase.com/) project
- An [OpenAI](https://platform.openai.com/) API key
- (Optional) [Mapbox](https://www.mapbox.com/) access token for the map view

### Installation

```bash
git clone https://github.com/MarioEsquivelIII/Kronos.git
cd Kronos
npm install
npx playwright install chromium  # for Canvas scraping
```

### Environment

Create `.env` in the project root:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
OPENAI_API_KEY=your_openai_api_key
NEXT_PUBLIC_MAPBOX_TOKEN=your_mapbox_token
```

### Database Setup

Run these SQL migrations in your Supabase SQL Editor (in order):

1. `supabase/migrations/001_create_events_table.sql` — Events table
2. `supabase/migrations/002_canvas_integration.sql` — Canvas tables (legacy OAuth)
3. `supabase/migrations/003_user_profiles.sql` — User profiles + onboarding
4. `supabase/migrations/004_planner_items.sql` — Planner items for Canvas data
5. `supabase/migrations/005_event_enhancements.sql` — Descriptions, recurrence, series
6. `supabase/migrations/006_protected_events.sql` — Protected event flag

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## How It Works

1. **Sign up & onboard** — Create an account. The onboarding flow learns your school, study style, productivity peaks, and personal commitments.

2. **Connect Canvas** — A Playwright browser window opens for you to log into your school's Canvas. Noted scrapes your courses, assignments, and deadlines via Canvas's internal API. For GT students, it also fetches exact class times and locations from Banner 9.

3. **Review & confirm** — Choose which lab sections you're in. Toggle which data goes on your calendar vs. AI context only.

4. **Smart scheduling** — Noted generates study blocks before deadlines, respects your class schedule and non-negotiable events, and adjusts based on your preferences (morning/night, short/deep sessions).

5. **Talk to Noted** — Ask the AI to add events, move things around, build your week, or answer questions about your courses and assignments. Upload images to extract schedule data.

6. **Sync everywhere** — Import from and export to Google Calendar.

---

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── chat/route.ts              # AI conversation + calendar actions
│   │   ├── events/route.ts            # Event CRUD (with protection)
│   │   ├── extract/route.ts           # Image → structured candidates
│   │   ├── profile/route.ts           # User profile (upsert)
│   │   ├── gcal-export/route.ts       # Export to Google Calendar
│   │   └── planner/
│   │       ├── ingest/route.ts        # iCal + Canvas scrape + GT Scheduler
│   │       ├── recommend/route.ts     # Generate work block suggestions
│   │       ├── context/route.ts       # Rich AI context builder
│   │       ├── items/route.ts         # Planner items CRUD
│   │       ├── auth/route.ts          # Playwright auth state
│   │       ├── scrape/route.ts        # Canvas scrape trigger
│   │       └── expand-class/route.ts  # Class meeting → calendar events
│   ├── home/page.tsx                  # Main app (calendar, chat, map)
│   ├── onboarding/page.tsx            # 7-step personalization flow
│   ├── account/page.tsx               # Settings, Canvas, Google Calendar
│   └── auth/callback/route.ts         # OAuth callback
├── components/
│   ├── WeekCalendar.tsx               # Week/day/month grid
│   ├── MapView.tsx                    # Mapbox campus map + routes
│   ├── ChatBar.tsx                    # Chat UI with voice + images
│   ├── ExtractionReview.tsx           # Image extraction confirmation
│   ├── CanvasReviewPanel.tsx          # Canvas data review + toggle
│   ├── LabPickerModal.tsx             # Lab section selector
│   ├── RecurrencePicker.tsx           # Recurrence rule UI
│   ├── SchoolCanvasPicker.tsx         # School search dropdown
│   └── onboarding/                    # 6 onboarding step components
├── lib/
│   ├── events.ts                      # CalendarEvent type + splitAroundProtected
│   ├── recurrence.ts                  # Recurrence expansion engine
│   ├── onboarding.ts                  # Profile types + personalization prompt
│   ├── voice.ts                       # Voice state machine types
│   ├── canvas-schools.ts             # School → Canvas domain mapping
│   ├── gcalSync.ts                    # Google Calendar sync
│   └── planner/
│       ├── types.ts                   # PlannerItem, WorkBlock types
│       ├── ical-parser.ts            # Canvas iCal feed parser
│       ├── estimator.ts              # Workload estimation engine
│       ├── scheduler.ts              # Work block generator
│       ├── context-builder.ts        # AI context from planner data
│       ├── gt-scheduler.ts           # GT Banner 9 data integration
│       └── scraper/
│           ├── auth.ts               # Playwright auth management
│           ├── scraper.ts            # Canvas API scraper
│           └── selectors.ts          # Canvas CSS selectors
└── utils/supabase/                    # Client/server/middleware helpers
```

---

## Author

Built by Mario A. Esquivel III.
