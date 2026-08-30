/*
# Hair Transplant Progress Tracking Schema

## Overview
Creates the database tables for tracking hair transplant patient progress over time.
This is a single-tenant app with no authentication — all data is intentionally shared/public.

## New Tables

### patients
- `id` (uuid, primary key)
- `name` (text, not null) — patient's full name
- `date_of_birth` (date) — patient's birth date
- `cpf` (text) — Brazilian tax ID
- `phone` (text) — contact phone
- `email` (text) — contact email
- `notes` (text) — free-form notes
- `created_at` (timestamptz)

### sessions
- `id` (uuid, primary key)
- `patient_id` (uuid, foreign key to patients, cascade delete)
- `session_date` (date, not null) — when the session/appointment occurred
- `total_hairs` (integer) — average hair count across all photos in the session
- `notes` (text) — session notes
- `created_at` (timestamptz)

### session_photos
- `id` (uuid, primary key)
- `session_id` (uuid, foreign key to sessions, cascade delete)
- `scalp_area` (text, not null) — which scalp area the photo covers
- `photo_url` (text, not null) — storage URL of the uploaded photo
- `hair_count` (integer) — estimated hair/follicle count from analysis
- `created_at` (timestamptz)

## Security
- RLS enabled on all tables.
- All tables allow anon + authenticated full CRUD — data is intentionally public (no-auth app).
- A storage bucket 'session-photos' is created with public read + anon upload.
*/

CREATE TABLE IF NOT EXISTS patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  date_of_birth date,
  cpf text,
  phone text,
  email text,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE patients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_patients" ON patients;
CREATE POLICY "anon_select_patients" ON patients FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_patients" ON patients;
CREATE POLICY "anon_insert_patients" ON patients FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_patients" ON patients;
CREATE POLICY "anon_update_patients" ON patients FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_patients" ON patients;
CREATE POLICY "anon_delete_patients" ON patients FOR DELETE
  TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  session_date date NOT NULL DEFAULT CURRENT_DATE,
  total_hairs integer,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_sessions" ON sessions;
CREATE POLICY "anon_select_sessions" ON sessions FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_sessions" ON sessions;
CREATE POLICY "anon_insert_sessions" ON sessions FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_sessions" ON sessions;
CREATE POLICY "anon_update_sessions" ON sessions FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_sessions" ON sessions;
CREATE POLICY "anon_delete_sessions" ON sessions FOR DELETE
  TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS session_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  scalp_area text NOT NULL,
  photo_url text NOT NULL,
  annotated_photo_url text,
  hair_count integer,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE session_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_session_photos" ON session_photos;
CREATE POLICY "anon_select_session_photos" ON session_photos FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_session_photos" ON session_photos;
CREATE POLICY "anon_insert_session_photos" ON session_photos FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_session_photos" ON session_photos;
CREATE POLICY "anon_update_session_photos" ON session_photos FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_session_photos" ON session_photos;
CREATE POLICY "anon_delete_session_photos" ON session_photos FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_sessions_patient_id ON sessions(patient_id);
CREATE INDEX IF NOT EXISTS idx_session_photos_session_id ON session_photos(session_id);

INSERT INTO storage.buckets (id, name, public)
VALUES ('session-photos', 'session-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "anon_read_session_photos" ON storage.objects;
CREATE POLICY "anon_read_session_photos" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'session-photos');

DROP POLICY IF EXISTS "anon_insert_session_photos" ON storage.objects;
CREATE POLICY "anon_insert_session_photos" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'session-photos');

DROP POLICY IF EXISTS "anon_update_session_photos_storage" ON storage.objects;
CREATE POLICY "anon_update_session_photos_storage" ON storage.objects
  FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'session-photos') WITH CHECK (bucket_id = 'session-photos');

DROP POLICY IF EXISTS "anon_delete_session_photos_storage" ON storage.objects;
CREATE POLICY "anon_delete_session_photos_storage" ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (bucket_id = 'session-photos');
