-- User profiles for onboarding & personalization
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  onboarding_step INTEGER NOT NULL DEFAULT 0,

  -- Core
  user_type TEXT NOT NULL DEFAULT 'student',  -- 'student' | 'professional' | 'personal'

  -- Academic (student)
  school_name TEXT,
  major TEXT,
  num_classes INTEGER,
  study_hours_per_week INTEGER,

  -- Study preferences
  session_style TEXT,             -- 'short' | 'deep_work'
  deadline_approach TEXT,         -- 'early' | 'close_to_deadline'
  preferred_study_days TEXT[],    -- ['Monday', 'Wednesday', ...]
  preferred_study_times TEXT[],   -- ['morning', 'afternoon', 'evening']
  peak_productivity TEXT,         -- 'morning' | 'afternoon' | 'night'
  structure_level TEXT,           -- 'light' | 'moderate' | 'hands_on'

  -- Challenges
  time_struggles TEXT[],          -- ['procrastination', 'overbooking', ...]

  -- Wellness
  exercises_regularly BOOLEAN,
  exercise_frequency TEXT,        -- 'daily' | '3_4x_week' | '1_2x_week'
  include_workouts BOOLEAN,
  preferred_workout_time TEXT,    -- 'morning' | 'afternoon' | 'evening'
  balance_preference TEXT,        -- 'productivity' | 'balanced'

  -- Anchor events (personal recurring commitments — all user types)
  anchor_events JSONB DEFAULT '[]',

  -- Future extensibility (professional/personal fields)
  extra_preferences JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON user_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
  ON user_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  USING (auth.uid() = user_id);
