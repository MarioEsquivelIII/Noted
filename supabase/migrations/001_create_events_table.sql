-- Create the events table for per-user event persistence
create table if not exists public.events (
  id          text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  date        text not null,          -- YYYY-MM-DD
  start_time  text not null,          -- HH:MM (24h)
  end_time    text not null,          -- HH:MM (24h)
  color       text not null default 'green',
  all_day     boolean default false,
  location_name text,
  location_lat  double precision,
  location_lng  double precision,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Index for fast per-user queries
create index if not exists idx_events_user_id on public.events(user_id);
create index if not exists idx_events_user_date on public.events(user_id, date);

-- Enable Row-Level Security
alter table public.events enable row level security;

-- RLS policies: users can only CRUD their own events
create policy "Users can view their own events"
  on public.events for select
  using (auth.uid() = user_id);

create policy "Users can insert their own events"
  on public.events for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own events"
  on public.events for update
  using (auth.uid() = user_id);

create policy "Users can delete their own events"
  on public.events for delete
  using (auth.uid() = user_id);

-- Auto-update updated_at on row change
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger on_events_updated
  before update on public.events
  for each row execute function public.handle_updated_at();
