-- Migration: Add Root-controlled media upload limits
INSERT INTO app_settings (key, value)
VALUES ('media_limits', '{"voice":0.03,"audio":0.03,"photo":0.03,"video":0.03}'::jsonb)
ON CONFLICT (key) DO NOTHING;
