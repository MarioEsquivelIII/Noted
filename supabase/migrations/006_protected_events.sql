-- Add protected flag to events (non-negotiable events immune to casual deletion)
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_protected BOOLEAN DEFAULT FALSE;
