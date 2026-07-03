-- Migration: Add registration mode and pending user support
-- Non-destructive: checks for column/table existence before modifications.

-- 1. Check and add registration-related columns to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE users DROP CONSTRAINT IF EXISTS registration_status_values;
ALTER TABLE users ADD CONSTRAINT registration_status_values CHECK (registration_status IN ('pending', 'active', 'rejected'));

ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- 2. Create app_settings table if missing
CREATE TABLE IF NOT EXISTS app_settings (
    key          TEXT PRIMARY KEY,
    value        JSONB NOT NULL,
    updated_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_by   UUID REFERENCES users(id)
);

-- 3. Create or replace updated_at trigger helper
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_app_settings_updated_at ON app_settings;
CREATE TRIGGER trigger_app_settings_updated_at
    BEFORE UPDATE ON app_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- 4. Enable RLS on app_settings
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings FORCE ROW LEVEL SECURITY;

-- 5. Create RLS policies if missing
DROP POLICY IF EXISTS app_settings_root_policy ON app_settings;
CREATE POLICY app_settings_root_policy ON app_settings
  FOR ALL
  USING (app_current_user_is_root())
  WITH CHECK (app_current_user_is_root());

DROP POLICY IF EXISTS app_settings_select_policy ON app_settings;
CREATE POLICY app_settings_select_policy ON app_settings
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS users_root_admin_policy ON users;
CREATE POLICY users_root_admin_policy ON users
  FOR ALL
  USING (
    app_current_user_is_root()
    AND COALESCE(NULLIF(current_setting('app.root_admin', true), ''), 'off') IN ('on', 'true')
  )
  WITH CHECK (
    app_current_user_is_root()
    AND COALESCE(NULLIF(current_setting('app.root_admin', true), ''), 'off') IN ('on', 'true')
  );

-- 6. Insert default value for registration mode if not present
INSERT INTO app_settings (key, value)
VALUES ('registration_mode', '"public"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 7. Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE app_settings TO nexus_app;

-- 8. Add needed index for composite messages cursor
CREATE INDEX IF NOT EXISTS idx_messages_chat_created_id
ON messages(chat_id, created_at DESC, id DESC);
