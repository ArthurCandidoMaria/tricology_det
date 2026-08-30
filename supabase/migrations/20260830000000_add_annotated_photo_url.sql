ALTER TABLE session_photos
  ADD COLUMN IF NOT EXISTS annotated_photo_url text;

CREATE INDEX IF NOT EXISTS idx_session_photos_annotated_photo_url
  ON session_photos(annotated_photo_url);
