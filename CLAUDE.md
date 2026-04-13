# CLAUDE.md — Noted

> AI-powered calendar builder for students. "You mention it. Noted builds it."
> Author: Mario A. Esquivel III

---

## Scope rule — STRICT

Only touch files and logic directly related to what was asked. Do not refactor nearby code, rename things, reorganize imports, or "clean up" anything that wasn't part of the request.

---

## Project overview

Noted is an AI calendar builder that learns who you are through onboarding, connects to your school's Canvas LMS, and uses that context to create personalized schedules. It supports natural language, image extraction, voice input, and smart scheduling that respects your study style, class times, and personal commitments.

---

## Architecture

```
Landing (/) → Signup → Onboarding (7 steps) → Home (/home)
                                                  ├── Calendar tab (AI chat + events)
                                                  ├── Overview tab (upcoming events)
                                                  ├── Map tab (campus locations + routes)
                                                  └── Home tab (about)

Data flow:
  Canvas Scraper → planner_items table → AI context
  GT Scheduler (Banner 9) → class events with locations → events table
  iCal feed → planner_items → merged with scraper data
  Onboarding profile → personalContext → AI system prompt
  User chat → /api/chat → JSON actions → calendar updates
```

---

## Tech stack

| Layer | Tool |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript 5 |
| Styling | Tailwind CSS 4 |
| Auth + DB | Supabase (RLS, per-user data) |
| AI | OpenAI — `gpt-4o-mini` (text), `gpt-4o` (images) |
| Maps | Mapbox GL JS |
| Browser automation | Playwright (Canvas scraping) |
| Validation | Zod |

---

## Core data model

### CalendarEvent (`src/lib/events.ts`)
```ts
interface CalendarEvent {
  id: string;
  title: string;
  date: string;               // YYYY-MM-DD
  startTime: string;          // HH:MM (24h)
  endTime: string;
  color: EventColor;
  allDay?: boolean;
  location?: { name: string; lat: number; lng: number };
  description?: string;
  recurrenceRule?: RecurrenceRule;
  seriesId?: string;
  isRecurrenceException?: boolean;
  isProtected?: boolean;      // non-negotiable — immune to casual deletion
}
```

### OnboardingProfile (`src/lib/onboarding.ts`)
Stores: user_type, school, major, study preferences, session style, peak productivity, time struggles, exercise habits, anchor events, and feature settings.

### PlannerItem (`src/lib/planner/types.ts`)
Canvas data normalized for scheduling: assignments, exams, class meetings with workload estimates and confidence scores.

---

## Key systems

### Onboarding (`src/app/onboarding/page.tsx`)
- 7 steps for students: Welcome → Anchor Events → Academic Info → Study Preferences → Challenges → Wellness → Canvas
- 3 steps for non-students: Welcome → Anchor Events → Wellness
- Auto-saves progress per step (survives tab close)
- Stored in `user_profiles` table

### Canvas Integration (`src/lib/planner/`)
- **Playwright scraper** (`scraper/scraper.ts`): Uses Canvas internal JSON API with session cookies
- **iCal parser** (`ical-parser.ts`): Parses Canvas calendar feed for accurate event times
- **GT Scheduler** (`gt-scheduler.ts`): Fetches Banner 9 data for exact class locations/rooms/times (GT only)
- **Lab picker** (`LabPickerModal.tsx`): Shows lab options for user to select their section
- **Workload estimator** (`estimator.ts`): Heuristic-based effort estimation per assignment
- **Scheduler** (`scheduler.ts`): Generates study blocks respecting preferences and protected events

### Protected Events
- Classes, anchor events, and user-marked events are `isProtected: true`
- Cannot be deleted via AI chat or "delete all"
- Protected events split overlapping regular events (`splitAroundProtected`)

### AI Chat (`src/app/api/chat/route.ts`)
- Conversation memory (last 20 messages)
- Action types: add, delete, delete_all_unprotected, protect, unprotect, anchor_add, anchor_remove
- recurrenceRule on add actions (expanded client-side)
- Never shows raw JSON to user

### Image Extraction (`src/app/api/extract/route.ts`)
- Specialized GPT-4o prompt for structured data extraction
- Returns candidates with confidence scores
- ExtractionReview component for user confirmation

### Recurrence (`src/lib/recurrence.ts`)
- Rules stored on master events, expanded at render time
- Frequencies: daily, weekdays, weekly, biweekly, monthly, custom

### Settings (`src/lib/onboarding.ts` → UserSettings)
Toggles: autoSyncCanvas, aiDirectCalendarAccess, showAnchorEventsOnCalendar, aiCanManageAnchors, includeWorkloadEstimates, voiceEnabled, voiceAutoSend

---

## Database tables

| Table | Purpose |
|---|---|
| `events` | Calendar events with RLS |
| `user_profiles` | Onboarding, settings, anchor events, Canvas config |
| `planner_items` | Canvas assignments, class meetings, syllabi |

---

## API routes

| Route | Method | Purpose |
|---|---|---|
| `/api/chat` | POST | AI conversation with calendar actions |
| `/api/events` | CRUD | Event operations (respects protection) |
| `/api/extract` | POST | Image → structured candidates |
| `/api/profile` | GET/POST/PUT | User profile (upsert) |
| `/api/planner/ingest` | POST | iCal + Canvas scrape + GT Scheduler |
| `/api/planner/recommend` | POST | Generate work block suggestions |
| `/api/planner/context` | GET | Rich AI context from planner data |
| `/api/planner/expand-class` | POST | Expand class meeting into events |
| `/api/gcal-export` | POST | Export to Google Calendar |

---

## Environment variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
OPENAI_API_KEY=
NEXT_PUBLIC_MAPBOX_TOKEN=
```

---

## Development

```bash
npm install
npx playwright install chromium
npm run dev
npm run build
```

---

## Conventions

- TypeScript, no `any`
- Tailwind + CSS variables for theming
- `YYYY-MM-DD` dates, `HH:MM` 24h times
- Protected events: never delete without user confirmation
- Event IDs via `generateId()`
