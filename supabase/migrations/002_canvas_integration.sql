-- Canvas LMS Integration Schema
-- Stores OAuth connections, courses, academic items, inferred meetings, and sync logs.

-- Canvas OAuth connections (one per user per school domain)
create table public.canvas_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  canvas_domain text not null,
  access_token_encrypted text not null,
  refresh_token_encrypted text not null,
  token_expires_at timestamptz,
  canvas_user_id text,
  canvas_user_timezone text,
  connected_at timestamptz default now(),
  last_synced_at timestamptz,
  unique(user_id, canvas_domain)
);

-- Courses from Canvas [Canvas API]
create table public.canvas_courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  connection_id uuid references canvas_connections(id) on delete cascade not null,
  canvas_course_id text not null,
  name text not null,
  course_code text,
  term_name text,
  start_date date,
  end_date date,
  color text default 'blue',
  is_active boolean default true,
  syllabus_extracted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, connection_id, canvas_course_id)
);

-- Normalized academic items from Canvas [Canvas API] + [Syllabus Inferred]
create table public.canvas_academic_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  course_id uuid references canvas_courses(id) on delete cascade,
  connection_id uuid references canvas_connections(id) on delete cascade not null,
  canvas_item_id text not null,
  item_type text not null,
  title text not null,
  description text,
  due_at timestamptz,
  start_at timestamptz,
  end_at timestamptz,
  points_possible double precision,
  submission_types text[],
  is_submitted boolean default false,
  url text,
  -- Location fields [Canvas API] + [Mapbox Geocoded]
  location_raw text,
  location_mode text default 'unknown',
  location_name text,
  location_formatted_address text,
  location_lat double precision,
  location_lng double precision,
  geocode_confidence double precision,
  location_requires_review boolean default false,
  -- Source tracking
  source text default 'api',
  confidence double precision default 1.0,
  approved boolean default true,
  -- Link to CalendarEvent once converted
  event_id text,
  is_archived boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, connection_id, canvas_item_id, item_type)
);

-- Inferred recurring meetings from syllabus/homepage [Syllabus Inferred]
create table public.canvas_inferred_meetings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  course_id uuid references canvas_courses(id) on delete cascade not null,
  meeting_type text not null,
  title text,
  days_of_week text[] not null,
  start_time text not null,
  end_time text not null,
  -- Location [Syllabus Inferred] + [Mapbox Geocoded]
  location_raw text,
  location_mode text default 'unknown',
  location_name text,
  location_lat double precision,
  location_lng double precision,
  geocode_confidence double precision,
  location_requires_review boolean default false,
  instructor_name text,
  effective_start_date date,
  effective_end_date date,
  source_text text,
  confidence double precision default 0.0,
  approved boolean default false,
  events_generated boolean default false,
  created_at timestamptz default now()
);

-- Sync run logs
create table public.canvas_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  connection_id uuid references canvas_connections(id) on delete cascade not null,
  started_at timestamptz default now(),
  completed_at timestamptz,
  status text default 'running',
  courses_synced int default 0,
  items_synced int default 0,
  items_new int default 0,
  items_updated int default 0,
  error_message text
);

-- Row-Level Security
alter table canvas_connections enable row level security;
alter table canvas_courses enable row level security;
alter table canvas_academic_items enable row level security;
alter table canvas_inferred_meetings enable row level security;
alter table canvas_sync_runs enable row level security;

create policy "own_connections" on canvas_connections for all using (auth.uid() = user_id);
create policy "own_courses" on canvas_courses for all using (auth.uid() = user_id);
create policy "own_items" on canvas_academic_items for all using (auth.uid() = user_id);
create policy "own_meetings" on canvas_inferred_meetings for all using (auth.uid() = user_id);
create policy "own_sync_runs" on canvas_sync_runs for all using (auth.uid() = user_id);

-- Indexes
create index idx_canvas_items_user on canvas_academic_items(user_id);
create index idx_canvas_items_course on canvas_academic_items(course_id);
create index idx_canvas_items_due on canvas_academic_items(due_at);
create index idx_canvas_meetings_course on canvas_inferred_meetings(course_id);
create index idx_canvas_courses_connection on canvas_courses(connection_id);
create index idx_canvas_connections_user on canvas_connections(user_id);
