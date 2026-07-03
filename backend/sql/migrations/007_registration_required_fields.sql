-- Migration: Add Root-controlled required registration fields
INSERT INTO app_settings (key, value)
VALUES ('registration_required_fields', '{"lastName":false,"email":false,"phone":false}'::jsonb)
ON CONFLICT (key) DO NOTHING;
