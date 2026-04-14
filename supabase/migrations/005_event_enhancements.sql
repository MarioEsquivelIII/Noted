-- Add description, recurrence, and series support to events
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS recurrence_rule JSONB,
  ADD COLUMN IF NOT EXISTS series_id TEXT,
  ADD COLUMN IF NOT EXISTS is_recurrence_exception BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_events_series_id ON events(series_id) WHERE series_id IS NOT NULL;
