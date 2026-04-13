-- Planner items: Canvas data from iCal feed + Playwright scraping
CREATE TABLE planner_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('ical', 'scraper', 'manual')),
  source_uid TEXT,                    -- iCal UID or scraped item identifier
  title TEXT NOT NULL,
  description TEXT,                   -- enriched by scraper
  item_type TEXT NOT NULL DEFAULT 'assignment',
  course_name TEXT,
  course_code TEXT,
  due_at TIMESTAMPTZ,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  location_raw TEXT,
  points_possible NUMERIC,
  url TEXT,
  weight_percent NUMERIC,
  submission_types TEXT[],
  status TEXT DEFAULT 'todo',
  is_fixed_time BOOLEAN DEFAULT FALSE,
  confidence NUMERIC DEFAULT 0.8,
  workload_minutes INTEGER,
  workload_source TEXT DEFAULT 'heuristic',
  is_archived BOOLEAN DEFAULT FALSE,
  raw_ical_data JSONB,
  raw_scraper_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, source, source_uid)
);

CREATE INDEX idx_planner_items_user_due ON planner_items(user_id, due_at)
  WHERE is_archived = FALSE;

ALTER TABLE planner_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own planner items"
  ON planner_items FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own planner items"
  ON planner_items FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own planner items"
  ON planner_items FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own planner items"
  ON planner_items FOR DELETE USING (auth.uid() = user_id);

-- Add iCal + domain fields to user_profiles
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS canvas_ical_url TEXT,
  ADD COLUMN IF NOT EXISTS canvas_domain TEXT;
