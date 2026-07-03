-- Phase 2: Exact Telegram-style schema (destructive, in-place replacement)
-- Target: PostgreSQL 15+
-- Apply with:
--   Get-Content -Raw .\backend\sql\phase2_telegram_schema.sql |
--     docker exec -i nexus-pg psql -U nexus -d nexus -v ON_ERROR_STOP=1

BEGIN;

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO public;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE users (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username              VARCHAR(32) UNIQUE NOT NULL,
    email                 VARCHAR(255) UNIQUE,
    phone                 VARCHAR(20) UNIQUE,
    password_hash         VARCHAR(255) NOT NULL,
    first_name            VARCHAR(64) NOT NULL,
    last_name             VARCHAR(64),
    bio                   VARCHAR(512),
    avatar_url            VARCHAR(500),
    avatar_color          SMALLINT DEFAULT 0,
    status                VARCHAR(20) DEFAULT 'offline',
    last_seen             TIMESTAMP WITH TIME ZONE,
    custom_status         VARCHAR(70),
    privacy_last_seen     VARCHAR(20) DEFAULT 'everyone',
    privacy_avatar        VARCHAR(20) DEFAULT 'everyone',
    privacy_phone         VARCHAR(20) DEFAULT 'nobody',
    privacy_forwards      VARCHAR(20) DEFAULT 'everyone',
    privacy_groups        VARCHAR(20) DEFAULT 'everyone',
    notification_sound    BOOLEAN DEFAULT true,
    notification_preview  BOOLEAN DEFAULT true,
    is_active             BOOLEAN DEFAULT true,
    is_verified           BOOLEAN DEFAULT false,
    is_premium            BOOLEAN DEFAULT false,
    is_bot                BOOLEAN DEFAULT false,
    is_root               BOOLEAN DEFAULT false,
    is_deleted            BOOLEAN DEFAULT false,
    registration_status   VARCHAR(20) NOT NULL DEFAULT 'active',
    approved_at           TIMESTAMP WITH TIME ZONE,
    approved_by           UUID REFERENCES users(id),
    rejected_at           TIMESTAMP WITH TIME ZONE,
    rejected_by           UUID REFERENCES users(id),
    rejection_reason      TEXT,
    created_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at            TIMESTAMP WITH TIME ZONE,
    CONSTRAINT username_format CHECK (username ~ '^[a-zA-Z][a-zA-Z0-9_]{3,31}$'),
    CONSTRAINT bio_length CHECK (LENGTH(bio) <= 512),
    CONSTRAINT avatar_color_range CHECK (avatar_color BETWEEN 0 AND 7),
    CONSTRAINT status_values CHECK (status IN ('online', 'offline', 'recently', 'away')),
    CONSTRAINT registration_status_values CHECK (registration_status IN ('pending', 'active', 'rejected'))
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_last_seen ON users(last_seen);
CREATE INDEX idx_users_created_at ON users(created_at);
CREATE INDEX idx_users_is_root ON users(is_root);
CREATE INDEX idx_users_username_lower ON users((LOWER(username)));

CREATE TRIGGER trigger_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TABLE sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash          VARCHAR(255) NOT NULL UNIQUE,
    refresh_token_hash  VARCHAR(255) UNIQUE,
    device_name         VARCHAR(100),
    device_type         VARCHAR(20),
    ip_address          INET,
    user_agent          TEXT,
    is_active           BOOLEAN DEFAULT true,
    last_activity       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at          TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT device_type_values CHECK (device_type IN ('web', 'desktop', 'mobile', 'unknown'))
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_token ON sessions(token_hash);
CREATE INDEX idx_sessions_active ON sessions(is_active, expires_at);

CREATE TABLE contacts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    custom_name         VARCHAR(64),
    is_blocked          BOOLEAN DEFAULT false,
    is_favorite         BOOLEAN DEFAULT false,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    blocked_at          TIMESTAMP WITH TIME ZONE,
    CONSTRAINT unique_contact UNIQUE (user_id, contact_user_id),
    CONSTRAINT no_self_contact CHECK (user_id != contact_user_id)
);

CREATE INDEX idx_contacts_user_id ON contacts(user_id);
CREATE INDEX idx_contacts_contact_user_id ON contacts(contact_user_id);
CREATE INDEX idx_contacts_blocked ON contacts(user_id, is_blocked);

CREATE TABLE chats (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type                  VARCHAR(20) NOT NULL,
    title                 VARCHAR(255),
    description           VARCHAR(2048),
    avatar_url            VARCHAR(500),
    avatar_color          SMALLINT DEFAULT 0,
    is_public             BOOLEAN DEFAULT false,
    join_by_link          BOOLEAN DEFAULT true,
    members_can_invite    BOOLEAN DEFAULT false,
    slow_mode_seconds     INTEGER DEFAULT 0,
    default_permissions   JSONB DEFAULT '{
        "can_send_messages": true,
        "can_send_media": true,
        "can_send_stickers": true,
        "can_send_links": true,
        "can_send_polls": true,
        "can_add_members": false,
        "can_pin_messages": true,
        "can_change_info": false
    }'::jsonb,
    pinned_message_id     UUID,
    is_active             BOOLEAN DEFAULT true,
    is_deleted            BOOLEAN DEFAULT false,
    member_count          INTEGER DEFAULT 0,
    created_by            UUID REFERENCES users(id),
    created_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at            TIMESTAMP WITH TIME ZONE,
    CONSTRAINT chat_type_values CHECK (type IN ('private', 'group', 'supergroup', 'channel')),
    CONSTRAINT group_must_have_title CHECK (
        (type = 'private') OR (title IS NOT NULL AND LENGTH(title) > 0)
    ),
    CONSTRAINT slow_mode_values CHECK (slow_mode_seconds IN (0, 10, 30, 60, 300, 900, 3600)),
    CONSTRAINT avatar_color_range CHECK (avatar_color BETWEEN 0 AND 7),
    CONSTRAINT member_count_positive CHECK (member_count >= 0)
);

CREATE INDEX idx_chats_type ON chats(type);
CREATE INDEX idx_chats_created_by ON chats(created_by);
CREATE INDEX idx_chats_public ON chats(is_public) WHERE is_public = true;
CREATE INDEX idx_chats_active ON chats(is_active) WHERE is_active = true;

CREATE TRIGGER trigger_chats_updated_at
    BEFORE UPDATE ON chats
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TABLE chat_members (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id                 UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role                    VARCHAR(20) NOT NULL DEFAULT 'member',
    custom_title            VARCHAR(64),
    permissions             JSONB DEFAULT '{
        "can_change_info": false,
        "can_delete_messages": false,
        "can_ban_users": false,
        "can_invite_users": true,
        "can_pin_messages": false,
        "can_promote_members": false,
        "can_manage_calls": false,
        "can_manage_chat": false,
        "is_anonymous": false
    }'::jsonb,
    status                  VARCHAR(20) NOT NULL DEFAULT 'active',
    is_muted                BOOLEAN DEFAULT false,
    mute_until              TIMESTAMP WITH TIME ZONE,
    notification_sound      VARCHAR(50) DEFAULT 'default',
    last_read_message_id    UUID,
    last_read_at            TIMESTAMP WITH TIME ZONE,
    unread_count            INTEGER DEFAULT 0,
    unread_mentions         INTEGER DEFAULT 0,
    is_pinned               BOOLEAN DEFAULT false,
    pin_order               INTEGER DEFAULT 0,
    is_archived             BOOLEAN DEFAULT false,
    draft_message           TEXT,
    draft_reply_to          UUID,
    draft_updated_at        TIMESTAMP WITH TIME ZONE,
    restricted_until        TIMESTAMP WITH TIME ZONE,
    restricted_permissions  JSONB,
    joined_at               TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    promoted_at             TIMESTAMP WITH TIME ZONE,
    promoted_by             UUID REFERENCES users(id),
    banned_at               TIMESTAMP WITH TIME ZONE,
    banned_by               UUID REFERENCES users(id),
    kicked_at               TIMESTAMP WITH TIME ZONE,
    kicked_by               UUID REFERENCES users(id),
    left_at                 TIMESTAMP WITH TIME ZONE,
    last_message_at         TIMESTAMP WITH TIME ZONE,
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_chat_member UNIQUE (chat_id, user_id),
    CONSTRAINT role_values CHECK (role IN ('owner', 'admin', 'member', 'restricted', 'banned', 'left')),
    CONSTRAINT status_values CHECK (status IN ('active', 'banned', 'kicked', 'left', 'restricted')),
    CONSTRAINT unread_count_positive CHECK (unread_count >= 0),
    CONSTRAINT unread_mentions_positive CHECK (unread_mentions >= 0)
);

CREATE INDEX idx_chat_members_chat_id ON chat_members(chat_id);
CREATE INDEX idx_chat_members_user_id ON chat_members(user_id);
CREATE INDEX idx_chat_members_chat_user ON chat_members(chat_id, user_id);
CREATE INDEX idx_chat_members_role ON chat_members(chat_id, role);
CREATE INDEX idx_chat_members_active ON chat_members(user_id, status) WHERE status = 'active';
CREATE INDEX idx_chat_members_pinned ON chat_members(user_id, is_pinned) WHERE is_pinned = true;
CREATE INDEX idx_chat_members_unread ON chat_members(user_id, unread_count) WHERE unread_count > 0;

CREATE TRIGGER trigger_chat_members_updated_at
    BEFORE UPDATE ON chat_members
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TABLE messages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id             UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender_id           UUID NOT NULL REFERENCES users(id),
    type                VARCHAR(20) NOT NULL DEFAULT 'text',
    content             TEXT,
    media               JSONB,
    reply_to_id         UUID REFERENCES messages(id) ON DELETE SET NULL,
    forward_from_id     UUID REFERENCES messages(id) ON DELETE SET NULL,
    forward_from_chat   UUID REFERENCES chats(id) ON DELETE SET NULL,
    forward_from_user   UUID REFERENCES users(id) ON DELETE SET NULL,
    forward_date        TIMESTAMP WITH TIME ZONE,
    thread_id           UUID REFERENCES messages(id) ON DELETE SET NULL,
    is_edited           BOOLEAN DEFAULT false,
    edited_at           TIMESTAMP WITH TIME ZONE,
    edit_history        JSONB DEFAULT '[]'::jsonb,
    entities            JSONB DEFAULT '[]'::jsonb,
    is_pinned           BOOLEAN DEFAULT false,
    pinned_at           TIMESTAMP WITH TIME ZONE,
    pinned_by           UUID REFERENCES users(id),
    is_deleted          BOOLEAN DEFAULT false,
    deleted_at          TIMESTAMP WITH TIME ZONE,
    deleted_by          UUID REFERENCES users(id),
    deleted_for         JSONB DEFAULT '[]'::jsonb,
    is_deleted_for_all  BOOLEAN DEFAULT false,
    system_event        JSONB,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT message_type_values CHECK (type IN (
        'text', 'photo', 'video', 'audio', 'voice', 'document',
        'sticker', 'animation', 'video_note', 'location',
        'contact', 'poll', 'system'
    )),
    CONSTRAINT message_has_content CHECK (
        content IS NOT NULL OR media IS NOT NULL OR system_event IS NOT NULL
    )
);

CREATE INDEX idx_messages_chat_id ON messages(chat_id);
CREATE INDEX idx_messages_sender_id ON messages(sender_id);
CREATE INDEX idx_messages_chat_created ON messages(chat_id, created_at DESC);
CREATE INDEX idx_messages_reply_to ON messages(reply_to_id) WHERE reply_to_id IS NOT NULL;
CREATE INDEX idx_messages_thread ON messages(thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX idx_messages_pinned ON messages(chat_id, is_pinned) WHERE is_pinned = true;
CREATE INDEX idx_messages_not_deleted ON messages(chat_id, created_at DESC) WHERE is_deleted = false;
CREATE INDEX idx_messages_search ON messages USING gin(to_tsvector('english', content)) WHERE content IS NOT NULL;
CREATE INDEX idx_messages_forward ON messages(forward_from_id) WHERE forward_from_id IS NOT NULL;

COMMENT ON COLUMN messages.deleted_for IS 'Legacy: list of user IDs for whom the message is deleted individually. Retired in 003_retire_delete_for_me.sql. No longer written by app code.';

CREATE TRIGGER trigger_messages_updated_at
    BEFORE UPDATE ON messages
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TABLE message_reads (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat_id     UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    read_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_message_read UNIQUE (message_id, user_id)
);

CREATE INDEX idx_message_reads_message ON message_reads(message_id);
CREATE INDEX idx_message_reads_user_chat ON message_reads(user_id, chat_id);
CREATE INDEX idx_message_reads_chat ON message_reads(chat_id, read_at DESC);

CREATE TABLE message_reactions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji       VARCHAR(10) NOT NULL,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_reaction UNIQUE (message_id, user_id, emoji),
    CONSTRAINT valid_emoji CHECK (
        emoji = ANY (ARRAY[
            chr(128077),              -- ðŸ‘
            chr(128078),              -- ðŸ‘Ž
            chr(10084) || chr(65039), -- heart emoji
            chr(128293),              -- ðŸ”¥
            chr(129392),              -- ðŸ¥°
            chr(128079),              -- ðŸ‘
            chr(128513),              -- ðŸ˜
            chr(129300),              -- ðŸ¤”
            chr(129327),              -- ðŸ¤¯
            chr(128561),              -- ðŸ˜±
            chr(129324),              -- ðŸ¤¬
            chr(128546),              -- ðŸ˜¢
            chr(127881),              -- ðŸŽ‰
            chr(129321),              -- ðŸ¤©
            chr(129326),              -- ðŸ¤®
            chr(128169),              -- ðŸ’©
            chr(128591)               -- ðŸ™
        ]::text[])
    )
);

CREATE INDEX idx_reactions_message ON message_reactions(message_id);
CREATE INDEX idx_reactions_user ON message_reactions(user_id);

CREATE TABLE media_files (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uploader_id       UUID NOT NULL REFERENCES users(id),
    original_name     VARCHAR(255) NOT NULL,
    stored_name       VARCHAR(255) NOT NULL UNIQUE,
    mime_type         VARCHAR(100) NOT NULL,
    file_size         BIGINT NOT NULL,
    file_path         VARCHAR(500) NOT NULL,
    width             INTEGER,
    height            INTEGER,
    duration          INTEGER,
    thumbnail_path    VARCHAR(500),
    thumbnail_width   INTEGER,
    thumbnail_height  INTEGER,
    is_processed      BOOLEAN DEFAULT false,
    processing_error  TEXT,
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT file_size_positive CHECK (file_size > 0),
    CONSTRAINT file_size_limit CHECK (file_size <= 2147483648)
);

CREATE INDEX idx_media_uploader ON media_files(uploader_id);
CREATE INDEX idx_media_mime ON media_files(mime_type);

CREATE TABLE notifications (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type          VARCHAR(30) NOT NULL,
    chat_id       UUID REFERENCES chats(id) ON DELETE CASCADE,
    message_id    UUID REFERENCES messages(id) ON DELETE CASCADE,
    from_user_id  UUID REFERENCES users(id),
    title         VARCHAR(255),
    body          TEXT,
    is_read       BOOLEAN DEFAULT false,
    is_delivered  BOOLEAN DEFAULT false,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    read_at       TIMESTAMP WITH TIME ZONE,
    CONSTRAINT notification_type_values CHECK (type IN (
        'new_message', 'mention', 'reply',
        'promoted', 'demoted', 'kicked', 'banned', 'contact_joined'
    ))
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id, is_read) WHERE is_read = false;
CREATE INDEX idx_notifications_created ON notifications(user_id, created_at DESC);

CREATE TABLE typing_indicators (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat_id     UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    started_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at  TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '6 seconds'),
    PRIMARY KEY (user_id, chat_id)
);

CREATE INDEX idx_typing_chat ON typing_indicators(chat_id);
CREATE INDEX idx_typing_expires ON typing_indicators(expires_at);

CREATE TABLE user_settings (
    user_id                      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme                        VARCHAR(10) DEFAULT 'light',
    chat_wallpaper               VARCHAR(500),
    font_size                    SMALLINT DEFAULT 16,
    message_corner               SMALLINT DEFAULT 12,
    send_with_enter              BOOLEAN DEFAULT true,
    show_stickers_tab            BOOLEAN DEFAULT true,
    auto_download_photo          BOOLEAN DEFAULT true,
    auto_download_video          BOOLEAN DEFAULT false,
    auto_download_doc            BOOLEAN DEFAULT false,
    auto_play_gif                BOOLEAN DEFAULT true,
    notification_enabled         BOOLEAN DEFAULT true,
    notification_sound           BOOLEAN DEFAULT true,
    notification_preview         BOOLEAN DEFAULT true,
    notification_count_badge     BOOLEAN DEFAULT true,
    language                     VARCHAR(10) DEFAULT 'en',
    time_format                  VARCHAR(5) DEFAULT '12h',
    updated_at                   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TRIGGER trigger_settings_updated_at
    BEFORE UPDATE ON user_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TABLE audit_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id     UUID REFERENCES chats(id) ON DELETE SET NULL,
    actor_id    UUID NOT NULL REFERENCES users(id),
    target_id   UUID REFERENCES users(id),
    action      VARCHAR(50) NOT NULL,
    details     JSONB,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_audit_chat ON audit_log(chat_id);
CREATE INDEX idx_audit_actor ON audit_log(actor_id);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);

ALTER TABLE chats
    ADD CONSTRAINT fk_chats_pinned_message_id
    FOREIGN KEY (pinned_message_id) REFERENCES messages(id) ON DELETE SET NULL;

ALTER TABLE chat_members
    ADD CONSTRAINT fk_chat_members_last_read_message_id
    FOREIGN KEY (last_read_message_id) REFERENCES messages(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION check_permission(
    p_user_id UUID,
    p_chat_id UUID,
    p_permission TEXT
) RETURNS BOOLEAN AS $$
DECLARE
    v_member RECORD;
    v_chat RECORD;
BEGIN
    SELECT * INTO v_member
    FROM chat_members
    WHERE chat_id = p_chat_id AND user_id = p_user_id;

    IF v_member IS NULL THEN RETURN false; END IF;
    IF v_member.status != 'active' THEN RETURN false; END IF;
    IF v_member.role = 'owner' THEN RETURN true; END IF;

    IF v_member.role = 'admin' THEN
        IF p_permission = 'can_send_messages' THEN
            RETURN true;
        END IF;

        RETURN COALESCE((v_member.permissions->>p_permission)::boolean, false);
    END IF;

    IF v_member.role = 'restricted' THEN
        IF v_member.restricted_until IS NOT NULL AND v_member.restricted_until < NOW() THEN
            SELECT * INTO v_chat FROM chats WHERE id = p_chat_id;
            RETURN COALESCE((v_chat.default_permissions->>p_permission)::boolean, false);
        END IF;
        RETURN COALESCE((v_member.restricted_permissions->>p_permission)::boolean, false);
    END IF;

    SELECT * INTO v_chat FROM chats WHERE id = p_chat_id;
    RETURN COALESCE((v_chat.default_permissions->>p_permission)::boolean, false);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION is_active_chat_member(
    p_user_id UUID,
    p_chat_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM chat_members cm
        WHERE cm.chat_id = p_chat_id
          AND cm.user_id = p_user_id
          AND cm.status = 'active'
    );
$$;

CREATE OR REPLACE FUNCTION can_send_message_in_chat(
    p_user_id UUID,
    p_chat_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM chat_members cm
        WHERE cm.chat_id = p_chat_id
          AND cm.user_id = p_user_id
          AND cm.status = 'active'
          AND cm.role NOT IN ('banned', 'left')
    );
$$;

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY messages_select_policy ON messages
    FOR SELECT
    USING (
        is_active_chat_member(current_setting('app.current_user_id')::uuid, messages.chat_id)
        AND (
            messages.is_deleted_for_all = false
            AND NOT (messages.deleted_for ? current_setting('app.current_user_id'))
        )
    );

CREATE POLICY messages_insert_policy ON messages
    FOR INSERT
    WITH CHECK (
        can_send_message_in_chat(current_setting('app.current_user_id')::uuid, messages.chat_id)
    );

CREATE POLICY messages_update_policy ON messages
    FOR UPDATE
    USING (
        sender_id = current_setting('app.current_user_id')::uuid
    );

ALTER TABLE chat_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_members_select_policy ON chat_members
    FOR SELECT
    USING (
        user_id = current_setting('app.current_user_id', true)::uuid
        OR is_active_chat_member(current_setting('app.current_user_id', true)::uuid, chat_id)
    );

COMMIT;
BEGIN;

DO $$
DECLARE
  db_user TEXT;
  db_password TEXT;
BEGIN
  db_user := current_setting('app.db_user', true);
  db_password := current_setting('app.db_password', true);

  IF db_user IS NULL OR db_user = '' OR db_password IS NULL OR db_password = '' THEN
    RAISE EXCEPTION 'Database user and password must be configured via app.db_user and app.db_password settings';
  END IF;

  IF db_user = 'nexus_app' THEN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexus_app') THEN
      EXECUTE format('CREATE ROLE nexus_app WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT', db_password);
    ELSE
      EXECUTE format('ALTER ROLE nexus_app WITH LOGIN PASSWORD %L', db_password);
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = db_user) THEN
      EXECUTE format('CREATE ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT', db_user, db_password);
    ELSE
      EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', db_user, db_password);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexus_app') THEN
      CREATE ROLE nexus_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
    EXECUTE format('GRANT nexus_app TO %I', db_user);
  END IF;
END
$$;

GRANT CONNECT ON DATABASE nexus TO nexus_app;
GRANT USAGE ON SCHEMA public TO nexus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE users TO nexus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE sessions TO nexus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE contacts TO nexus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE user_settings TO nexus_app;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE user_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_self_select_policy ON users;
DROP POLICY IF EXISTS users_self_update_policy ON users;
DROP POLICY IF EXISTS users_self_insert_policy ON users;
DROP POLICY IF EXISTS users_auth_lookup_policy ON users;
DROP POLICY IF EXISTS users_directory_policy ON users;

CREATE POLICY users_self_select_policy ON users
  FOR SELECT
  USING (
    NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
    AND id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  );

CREATE POLICY users_self_update_policy ON users
  FOR UPDATE
  USING (
    NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
    AND id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
    AND id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  );

CREATE POLICY users_self_insert_policy ON users
  FOR INSERT
  WITH CHECK (
    NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
    AND id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  );

CREATE POLICY users_auth_lookup_policy ON users
  FOR SELECT
  USING (
    current_setting('app.auth_lookup', true) = 'on'
    AND is_deleted = false
  );

CREATE OR REPLACE FUNCTION app_current_user_uuid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_current_user_is_root()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.current_user_is_root', true), ''), 'false')::boolean
$$;

CREATE OR REPLACE FUNCTION app_is_root_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM users u
    WHERE u.id = p_user_id
      AND u.is_root = true
      AND u.is_active = true
      AND u.is_deleted = false
  )
$$;

CREATE OR REPLACE FUNCTION app_users_share_active_chat(p_user_id uuid, p_other_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM chat_members cm_self
    JOIN chat_members cm_other
      ON cm_other.chat_id = cm_self.chat_id
    JOIN chats c
      ON c.id = cm_self.chat_id
    WHERE cm_self.user_id = p_user_id
      AND cm_other.user_id = p_other_user_id
      AND cm_self.status = 'active'
      AND cm_other.status = 'active'
      AND c.is_active = true
      AND c.is_deleted = false
  )
$$;

CREATE OR REPLACE FUNCTION app_users_have_contact_relation(p_user_id uuid, p_other_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM contacts c
    WHERE (c.user_id = p_user_id AND c.contact_user_id = p_other_user_id)
       OR (c.user_id = p_other_user_id AND c.contact_user_id = p_user_id)
  )
$$;

CREATE OR REPLACE FUNCTION app_user_lookup_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.user_lookup', true), ''), 'off') = 'on'
$$;

CREATE OR REPLACE FUNCTION app_lookup_userid()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(LOWER(BTRIM(current_setting('app.lookup_userid', true))), '')
$$;

REVOKE ALL ON FUNCTION app_is_root_user(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_current_user_is_root() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_users_share_active_chat(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_users_have_contact_relation(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app_current_user_uuid() TO nexus_app;
GRANT EXECUTE ON FUNCTION app_is_root_user(uuid) TO nexus_app;
GRANT EXECUTE ON FUNCTION app_current_user_is_root() TO nexus_app;
GRANT EXECUTE ON FUNCTION app_users_share_active_chat(uuid, uuid) TO nexus_app;
GRANT EXECUTE ON FUNCTION app_users_have_contact_relation(uuid, uuid) TO nexus_app;
GRANT EXECUTE ON FUNCTION app_user_lookup_enabled() TO nexus_app;
GRANT EXECUTE ON FUNCTION app_lookup_userid() TO nexus_app;

CREATE POLICY users_directory_policy ON users
  FOR SELECT
  USING (
    app_current_user_uuid() IS NOT NULL
    AND users.is_active = true
    AND users.is_deleted = false
    AND (
      users.id = app_current_user_uuid()
      OR
      app_current_user_is_root()
      OR (
        current_setting('app.user_directory', true) = 'on'
        AND (
          app_users_share_active_chat(app_current_user_uuid(), users.id)
          OR app_users_have_contact_relation(app_current_user_uuid(), users.id)
        )
      )
      OR (
        app_user_lookup_enabled()
        AND app_lookup_userid() IS NOT NULL
        AND LOWER(users.username) = app_lookup_userid()
      )
    )
  );

DROP POLICY IF EXISTS sessions_owner_select_policy ON sessions;
DROP POLICY IF EXISTS sessions_owner_insert_policy ON sessions;
DROP POLICY IF EXISTS sessions_owner_update_policy ON sessions;
DROP POLICY IF EXISTS sessions_owner_delete_policy ON sessions;

CREATE POLICY sessions_owner_select_policy ON sessions
  FOR SELECT
  USING (
    NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
    AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  );

CREATE POLICY sessions_owner_insert_policy ON sessions
  FOR INSERT
  WITH CHECK (
    NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
    AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  );

CREATE POLICY sessions_owner_update_policy ON sessions
  FOR UPDATE
  USING (
    NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
    AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
    AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  );

CREATE POLICY sessions_owner_delete_policy ON sessions
  FOR DELETE
  USING (
    NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
    AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  );

DROP POLICY IF EXISTS contacts_owner_select_policy ON contacts;
DROP POLICY IF EXISTS contacts_owner_insert_policy ON contacts;
DROP POLICY IF EXISTS contacts_owner_update_policy ON contacts;
DROP POLICY IF EXISTS contacts_owner_delete_policy ON contacts;

CREATE POLICY contacts_owner_select_policy ON contacts
  FOR SELECT
  USING (
    NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
    AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  );

CREATE POLICY contacts_owner_insert_policy ON contacts
  FOR INSERT
  WITH CHECK (
    NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
    AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  );

CREATE POLICY contacts_owner_update_policy ON contacts
  FOR UPDATE
  USING (
    NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
    AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
    AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  );

CREATE POLICY contacts_owner_delete_policy ON contacts
  FOR DELETE
  USING (
    NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
    AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  );

DROP POLICY IF EXISTS user_settings_owner_select_policy ON user_settings;
DROP POLICY IF EXISTS user_settings_owner_insert_policy ON user_settings;
DROP POLICY IF EXISTS user_settings_owner_update_policy ON user_settings;
DROP POLICY IF EXISTS user_settings_owner_delete_policy ON user_settings;

CREATE POLICY user_settings_owner_select_policy ON user_settings
  FOR SELECT
  USING (
    NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
    AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  );

CREATE POLICY user_settings_owner_insert_policy ON user_settings
  FOR INSERT
  WITH CHECK (
    NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
    AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  );

CREATE POLICY user_settings_owner_update_policy ON user_settings
  FOR UPDATE
  USING (
    NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
    AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
    AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  );

CREATE POLICY user_settings_owner_delete_policy ON user_settings
  FOR DELETE
  USING (
    NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
    AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  );

COMMIT;
BEGIN;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE chats TO nexus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE chat_members TO nexus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE messages TO nexus_app;

CREATE OR REPLACE FUNCTION app_current_user_uuid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_is_chat_owner(p_chat_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM chat_members cm
    WHERE cm.chat_id = p_chat_id
      AND cm.user_id = app_current_user_uuid()
      AND cm.status = 'active'
      AND cm.role = 'owner'
  )
$$;

GRANT EXECUTE ON FUNCTION app_current_user_uuid() TO nexus_app;
GRANT EXECUTE ON FUNCTION app_is_chat_owner(uuid) TO nexus_app;

ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE chats FORCE ROW LEVEL SECURITY;
ALTER TABLE chat_members FORCE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chats_select_policy ON chats;
DROP POLICY IF EXISTS chats_insert_policy ON chats;
DROP POLICY IF EXISTS chats_update_policy ON chats;
DROP POLICY IF EXISTS chats_delete_policy ON chats;

CREATE POLICY chats_select_policy ON chats
  FOR SELECT
  USING (
    app_current_user_uuid() IS NOT NULL
    AND (
      created_by = app_current_user_uuid()
      OR is_active_chat_member(app_current_user_uuid(), chats.id)
    )
  );

CREATE POLICY chats_insert_policy ON chats
  FOR INSERT
  WITH CHECK (
    app_current_user_uuid() IS NOT NULL
    AND created_by = app_current_user_uuid()
  );

CREATE POLICY chats_update_policy ON chats
  FOR UPDATE
  USING (
    app_current_user_uuid() IS NOT NULL
    AND (
      (
        chats.type = 'private'
        AND is_active_chat_member(app_current_user_uuid(), chats.id)
      )
      OR app_is_chat_owner(chats.id)
    )
  )
  WITH CHECK (
    app_current_user_uuid() IS NOT NULL
    AND (
      (
        chats.type = 'private'
        AND is_active_chat_member(app_current_user_uuid(), chats.id)
      )
      OR app_is_chat_owner(chats.id)
    )
  );

CREATE POLICY chats_delete_policy ON chats
  FOR DELETE
  USING (
    app_current_user_uuid() IS NOT NULL
    AND chats.type <> 'private'
    AND app_is_chat_owner(chats.id)
  );

DROP POLICY IF EXISTS chat_members_select_policy ON chat_members;
DROP POLICY IF EXISTS chat_members_insert_policy ON chat_members;
DROP POLICY IF EXISTS chat_members_update_policy ON chat_members;
DROP POLICY IF EXISTS chat_members_delete_policy ON chat_members;

CREATE POLICY chat_members_select_policy ON chat_members
  FOR SELECT
  USING (
    app_current_user_uuid() IS NOT NULL
    AND (
      chat_members.user_id = app_current_user_uuid()
      OR is_active_chat_member(app_current_user_uuid(), chat_members.chat_id)
    )
  );

CREATE POLICY chat_members_insert_policy ON chat_members
  FOR INSERT
  WITH CHECK (
    app_current_user_uuid() IS NOT NULL
    AND (
      chat_members.user_id = app_current_user_uuid()
      OR app_is_chat_owner(chat_members.chat_id)
    )
  );

CREATE POLICY chat_members_update_policy ON chat_members
  FOR UPDATE
  USING (
    app_current_user_uuid() IS NOT NULL
    AND (
      chat_members.user_id = app_current_user_uuid()
      OR app_is_chat_owner(chat_members.chat_id)
    )
  )
  WITH CHECK (
    app_current_user_uuid() IS NOT NULL
    AND (
      chat_members.user_id = app_current_user_uuid()
      OR app_is_chat_owner(chat_members.chat_id)
    )
  );

CREATE POLICY chat_members_delete_policy ON chat_members
  FOR DELETE
  USING (
    app_current_user_uuid() IS NOT NULL
    AND (
      chat_members.user_id = app_current_user_uuid()
      OR app_is_chat_owner(chat_members.chat_id)
    )
  );

DROP POLICY IF EXISTS messages_select_policy ON messages;
DROP POLICY IF EXISTS messages_insert_policy ON messages;
DROP POLICY IF EXISTS messages_update_policy ON messages;

CREATE POLICY messages_select_policy ON messages
  FOR SELECT
  USING (
    app_current_user_uuid() IS NOT NULL
    AND is_active_chat_member(app_current_user_uuid(), messages.chat_id)
    AND messages.is_deleted_for_all = false
    AND NOT (messages.deleted_for ? app_current_user_uuid()::text)
  );

CREATE POLICY messages_insert_policy ON messages
  FOR INSERT
  WITH CHECK (
    app_current_user_uuid() IS NOT NULL
    AND messages.sender_id = app_current_user_uuid()
    AND can_send_message_in_chat(app_current_user_uuid(), messages.chat_id)
  );

CREATE POLICY messages_update_policy ON messages
  FOR UPDATE
  USING (
    app_current_user_uuid() IS NOT NULL
    AND messages.sender_id = app_current_user_uuid()
  )
  WITH CHECK (
    app_current_user_uuid() IS NOT NULL
    AND messages.sender_id = app_current_user_uuid()
  );

COMMIT;
BEGIN;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE chats TO nexus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE chat_members TO nexus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE messages TO nexus_app;
GRANT INSERT ON TABLE audit_log TO nexus_app;

CREATE OR REPLACE FUNCTION app_current_user_uuid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_is_chat_owner(p_chat_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM chat_members cm
    WHERE cm.chat_id = p_chat_id
      AND cm.user_id = app_current_user_uuid()
      AND cm.status = 'active'
      AND cm.role = 'owner'
  )
$$;

CREATE OR REPLACE FUNCTION app_admin_has_permission(p_chat_id uuid, p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM chat_members cm
    WHERE cm.chat_id = p_chat_id
      AND cm.user_id = app_current_user_uuid()
      AND cm.status = 'active'
      AND (
        cm.role = 'owner'
        OR (
          cm.role = 'admin'
          AND COALESCE((cm.permissions->>p_permission)::boolean, false)
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION app_can_manage_member(
  p_chat_id uuid,
  p_target_user_id uuid,
  p_action text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_actor RECORD;
  v_target RECORD;
BEGIN
  IF app_current_user_uuid() IS NULL THEN
    RETURN false;
  END IF;

  SELECT role, status, permissions
  INTO v_actor
  FROM chat_members
  WHERE chat_id = p_chat_id
    AND user_id = app_current_user_uuid()
    AND status = 'active'
  LIMIT 1;

  IF v_actor IS NULL THEN
    RETURN false;
  END IF;

  IF p_action = 'invite' THEN
    SELECT role, status
    INTO v_target
    FROM chat_members
    WHERE chat_id = p_chat_id
      AND user_id = p_target_user_id
    LIMIT 1;

    IF v_actor.role = 'owner' THEN
      RETURN p_target_user_id <> app_current_user_uuid()
        AND (v_target IS NULL OR v_target.role <> 'owner');
    END IF;

    IF v_actor.role = 'admin' THEN
      RETURN app_admin_has_permission(p_chat_id, 'can_invite_users')
        AND (
          v_target IS NULL
          OR v_target.role IN ('member', 'restricted', 'left', 'banned')
        );
    END IF;

    RETURN false;
  END IF;

  SELECT role, status
  INTO v_target
  FROM chat_members
  WHERE chat_id = p_chat_id
    AND user_id = p_target_user_id
  LIMIT 1;

  IF v_target IS NULL THEN
    RETURN false;
  END IF;

  IF v_target.role = 'owner' THEN
    RETURN false;
  END IF;

  IF p_action IN ('kick', 'ban', 'unban') THEN
    IF v_actor.role = 'owner' THEN
      RETURN true;
    END IF;

    IF v_actor.role = 'admin' THEN
      RETURN app_admin_has_permission(p_chat_id, 'can_ban_users')
        AND v_target.role IN ('member', 'restricted', 'banned', 'left');
    END IF;

    RETURN false;
  END IF;

  IF p_action IN ('promote', 'demote', 'set_permissions', 'transfer') THEN
    IF v_actor.role = 'owner' THEN
      RETURN true;
    END IF;

    IF v_actor.role = 'admin' THEN
      RETURN app_admin_has_permission(p_chat_id, 'can_promote_members')
        AND v_target.role IN ('member', 'admin');
    END IF;

    RETURN false;
  END IF;

  IF p_action = 'manage' THEN
    RETURN app_is_chat_owner(p_chat_id)
      OR (
        v_actor.role = 'admin'
        AND (
          app_admin_has_permission(p_chat_id, 'can_ban_users')
          OR app_admin_has_permission(p_chat_id, 'can_promote_members')
          OR app_admin_has_permission(p_chat_id, 'can_invite_users')
        )
      );
  END IF;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION app_current_user_uuid() TO nexus_app;
GRANT EXECUTE ON FUNCTION app_is_chat_owner(uuid) TO nexus_app;
GRANT EXECUTE ON FUNCTION app_admin_has_permission(uuid, text) TO nexus_app;
GRANT EXECUTE ON FUNCTION app_can_manage_member(uuid, uuid, text) TO nexus_app;

ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE chats FORCE ROW LEVEL SECURITY;
ALTER TABLE chat_members FORCE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chats_select_policy ON chats;
DROP POLICY IF EXISTS chats_insert_policy ON chats;
DROP POLICY IF EXISTS chats_update_policy ON chats;
DROP POLICY IF EXISTS chats_delete_policy ON chats;

CREATE POLICY chats_select_policy ON chats
  FOR SELECT
  USING (
    app_current_user_uuid() IS NOT NULL
    AND (
      created_by = app_current_user_uuid()
      OR is_active_chat_member(app_current_user_uuid(), chats.id)
    )
  );

CREATE POLICY chats_insert_policy ON chats
  FOR INSERT
  WITH CHECK (
    app_current_user_uuid() IS NOT NULL
    AND created_by = app_current_user_uuid()
  );

CREATE POLICY chats_update_policy ON chats
  FOR UPDATE
  USING (
    app_current_user_uuid() IS NOT NULL
    AND (
      (
        chats.type = 'private'
        AND is_active_chat_member(app_current_user_uuid(), chats.id)
      )
      OR app_is_chat_owner(chats.id)
    )
  )
  WITH CHECK (
    app_current_user_uuid() IS NOT NULL
    AND (
      (
        chats.type = 'private'
        AND is_active_chat_member(app_current_user_uuid(), chats.id)
      )
      OR app_is_chat_owner(chats.id)
    )
  );

CREATE POLICY chats_delete_policy ON chats
  FOR DELETE
  USING (
    app_current_user_uuid() IS NOT NULL
    AND chats.type <> 'private'
    AND app_is_chat_owner(chats.id)
  );

DROP POLICY IF EXISTS chat_members_select_policy ON chat_members;
DROP POLICY IF EXISTS chat_members_insert_policy ON chat_members;
DROP POLICY IF EXISTS chat_members_update_policy ON chat_members;
DROP POLICY IF EXISTS chat_members_delete_policy ON chat_members;

CREATE POLICY chat_members_select_policy ON chat_members
  FOR SELECT
  USING (
    app_current_user_uuid() IS NOT NULL
    AND (
      chat_members.user_id = app_current_user_uuid()
      OR is_active_chat_member(app_current_user_uuid(), chat_members.chat_id)
    )
  );

CREATE POLICY chat_members_insert_policy ON chat_members
  FOR INSERT
  WITH CHECK (
    app_current_user_uuid() IS NOT NULL
    AND (
      chat_members.user_id = app_current_user_uuid()
      OR app_can_manage_member(chat_members.chat_id, chat_members.user_id, 'invite')
    )
  );

CREATE POLICY chat_members_update_policy ON chat_members
  FOR UPDATE
  USING (
    app_current_user_uuid() IS NOT NULL
    AND (
      chat_members.user_id = app_current_user_uuid()
      OR app_can_manage_member(chat_members.chat_id, chat_members.user_id, 'kick')
      OR app_can_manage_member(chat_members.chat_id, chat_members.user_id, 'ban')
      OR app_can_manage_member(chat_members.chat_id, chat_members.user_id, 'unban')
      OR app_can_manage_member(chat_members.chat_id, chat_members.user_id, 'promote')
      OR app_can_manage_member(chat_members.chat_id, chat_members.user_id, 'demote')
      OR app_can_manage_member(chat_members.chat_id, chat_members.user_id, 'set_permissions')
      OR app_can_manage_member(chat_members.chat_id, chat_members.user_id, 'transfer')
    )
  )
  WITH CHECK (
    app_current_user_uuid() IS NOT NULL
    AND (
      chat_members.user_id = app_current_user_uuid()
      OR app_can_manage_member(chat_members.chat_id, chat_members.user_id, 'kick')
      OR app_can_manage_member(chat_members.chat_id, chat_members.user_id, 'ban')
      OR app_can_manage_member(chat_members.chat_id, chat_members.user_id, 'unban')
      OR app_can_manage_member(chat_members.chat_id, chat_members.user_id, 'promote')
      OR app_can_manage_member(chat_members.chat_id, chat_members.user_id, 'demote')
      OR app_can_manage_member(chat_members.chat_id, chat_members.user_id, 'set_permissions')
      OR app_can_manage_member(chat_members.chat_id, chat_members.user_id, 'transfer')
    )
  );

CREATE POLICY chat_members_delete_policy ON chat_members
  FOR DELETE
  USING (
    app_current_user_uuid() IS NOT NULL
    AND (
      chat_members.user_id = app_current_user_uuid()
      OR app_can_manage_member(chat_members.chat_id, chat_members.user_id, 'kick')
    )
  );

DROP POLICY IF EXISTS messages_select_policy ON messages;
DROP POLICY IF EXISTS messages_insert_policy ON messages;
DROP POLICY IF EXISTS messages_update_policy ON messages;

CREATE POLICY messages_select_policy ON messages
  FOR SELECT
  USING (
    app_current_user_uuid() IS NOT NULL
    AND is_active_chat_member(app_current_user_uuid(), messages.chat_id)
    AND messages.is_deleted_for_all = false
    AND NOT (messages.deleted_for ? app_current_user_uuid()::text)
  );

CREATE POLICY messages_insert_policy ON messages
  FOR INSERT
  WITH CHECK (
    app_current_user_uuid() IS NOT NULL
    AND messages.sender_id = app_current_user_uuid()
    AND can_send_message_in_chat(app_current_user_uuid(), messages.chat_id)
  );

CREATE POLICY messages_update_policy ON messages
  FOR UPDATE
  USING (
    app_current_user_uuid() IS NOT NULL
    AND messages.sender_id = app_current_user_uuid()
  )
  WITH CHECK (
    app_current_user_uuid() IS NOT NULL
    AND messages.sender_id = app_current_user_uuid()
  );

COMMIT;
BEGIN;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE chats TO nexus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE chat_members TO nexus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE messages TO nexus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE message_reads TO nexus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE message_reactions TO nexus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE media_files TO nexus_app;
GRANT INSERT ON TABLE audit_log TO nexus_app;

CREATE OR REPLACE FUNCTION app_current_user_uuid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_can_edit_message(
  p_chat_id uuid,
  p_sender_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    app_current_user_uuid() IS NOT NULL
    AND p_sender_id = app_current_user_uuid()
    AND is_active_chat_member(app_current_user_uuid(), p_chat_id)
$$;

CREATE OR REPLACE FUNCTION app_can_delete_message_for_all(
  p_chat_id uuid,
  p_sender_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM chat_members cm
    JOIN chats c ON c.id = cm.chat_id
    WHERE cm.chat_id = p_chat_id
      AND cm.user_id = app_current_user_uuid()
      AND cm.status = 'active'
      AND (
        c.type = 'private'
        OR cm.user_id = p_sender_id
        OR cm.role = 'owner'
        OR (
          cm.role = 'admin'
          AND COALESCE((cm.permissions->>'can_delete_messages')::boolean, false)
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION app_can_pin_message(p_chat_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM chats c
    JOIN chat_members cm
      ON cm.chat_id = c.id
     AND cm.user_id = app_current_user_uuid()
    WHERE c.id = p_chat_id
      AND cm.status = 'active'
      AND (
        -- Private chat (normal or saved)
        (c.type = 'private' AND (c.title IS DISTINCT FROM 'Saved Messages' OR c.created_by = app_current_user_uuid()))
        -- Group chat
        OR (
          c.type = 'group'
          AND (
            cm.role = 'owner'
            OR cm.role = 'admin'
            OR COALESCE((c.default_permissions->>'can_pin_messages')::boolean, true)
          )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION app_message_visibility_bypass()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.message_visibility_bypass', true), ''), 'off') = 'on'
$$;

CREATE OR REPLACE FUNCTION app_delete_unreferenced_media_file(p_file_id uuid)
RETURNS TABLE(file_path text, thumbnail_path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_file_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM messages m
    WHERE m.media->>'file_id' = p_file_id::text
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  DELETE FROM media_files mf
  WHERE mf.id = p_file_id
  RETURNING mf.file_path::text, mf.thumbnail_path::text;
END;
$$;

CREATE OR REPLACE FUNCTION app_recount_unread_counts(p_chat_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF app_current_user_uuid() IS NULL THEN
    RETURN;
  END IF;

  IF NOT is_active_chat_member(app_current_user_uuid(), p_chat_id) THEN
    RETURN;
  END IF;

  WITH computed AS (
    SELECT
      cm.id AS member_id,
      COUNT(m.id)::int AS unread_count
    FROM chat_members cm
    LEFT JOIN messages lr ON lr.id = cm.last_read_message_id
    LEFT JOIN messages m
      ON m.chat_id = cm.chat_id
     AND m.is_deleted_for_all = false
     AND NOT (m.deleted_for ? cm.user_id::text)
     AND m.sender_id <> cm.user_id
     AND (
       lr.id IS NULL
       OR (m.created_at, m.id) > (lr.created_at, lr.id)
     )
    WHERE cm.chat_id = p_chat_id
      AND cm.status = 'active'
    GROUP BY cm.id
  )
  UPDATE chat_members cm
  SET
    unread_count = computed.unread_count,
    unread_mentions = 0
  FROM computed
  WHERE cm.id = computed.member_id;
END;
$$;

-- 1. Create app_clear_chat_messages to clear a specific chat's history (SECURITY DEFINER context)
CREATE OR REPLACE FUNCTION app_clear_chat_messages(p_chat_id uuid)
RETURNS TABLE (
  id uuid,
  chat_id uuid,
  sender_id uuid,
  media jsonb,
  type varchar
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Verify caller has permissions to clear the chat
  IF NOT EXISTS (
    SELECT 1 FROM chat_members cm
    JOIN chats c ON c.id = cm.chat_id
    WHERE cm.chat_id = p_chat_id
      AND cm.user_id = app_current_user_uuid()
      AND cm.status = 'active'
      AND (
        -- Saved Messages: only owner/creator
        (c.type = 'private' AND c.title = 'Saved Messages' AND c.created_by = app_current_user_uuid())
        -- Group chats: owner or admin with can_delete_messages permission
        OR (
          c.type = 'group'
          AND (
            cm.role = 'owner'
            OR (
              cm.role = 'admin'
              AND COALESCE((cm.permissions->>'can_delete_messages')::boolean, false)
            )
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'Access denied: cannot clear chat history';
  END IF;

  -- Reset unread counts for this chat
  UPDATE chat_members
  SET unread_count = 0, unread_mentions = 0
  WHERE chat_members.chat_id = p_chat_id;

  -- Delete all messages in the chat
  RETURN QUERY
  DELETE FROM messages m
  WHERE m.chat_id = p_chat_id
  RETURNING m.id, m.chat_id, m.sender_id, m.media, m.type;
END;
$$;

-- 2. Create app_root_clear_all_messages to clear all messages platform-wide (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION app_root_clear_all_messages()
RETURNS TABLE (
  id uuid,
  chat_id uuid,
  sender_id uuid,
  media jsonb,
  type varchar
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Reset all unread counts
  UPDATE chat_members
  SET unread_count = 0, unread_mentions = 0;

  -- Delete all messages
  RETURN QUERY
  DELETE FROM messages m
  RETURNING m.id, m.chat_id, m.sender_id, m.media, m.type;
END;
$$;

-- 3. Create app_root_clear_all_media to clear all media messages platform-wide (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION app_root_clear_all_media()
RETURNS TABLE (
  id uuid,
  chat_id uuid,
  sender_id uuid,
  media jsonb,
  type varchar
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- We delete messages where media is not null
  -- And we return the deleted rows while updating unread counts.
  -- We do this using a single query with CTEs.
  RETURN QUERY
  WITH deleted_messages AS (
    DELETE FROM messages m
    WHERE m.media IS NOT NULL
    RETURNING m.id, m.chat_id, m.sender_id, m.media, m.type
  ),
  updated_unreads AS (
    UPDATE chat_members cm
    SET
      unread_count = computed.unread_count,
      unread_mentions = 0
    FROM (
      SELECT
        cm2.id AS member_id,
        COUNT(m2.id)::int AS unread_count
      FROM chat_members cm2
      JOIN (SELECT DISTINCT dm.chat_id FROM deleted_messages dm) d ON d.chat_id = cm2.chat_id
      LEFT JOIN messages lr ON lr.id = cm2.last_read_message_id
      LEFT JOIN messages m2
        ON m2.chat_id = cm2.chat_id
        AND m2.is_deleted_for_all = false
        AND NOT (m2.deleted_for ? cm2.user_id::text)
        AND m2.sender_id <> cm2.user_id
        AND (
          lr.id IS NULL
          OR (m2.created_at, m2.id) > (lr.created_at, lr.id)
        )
        AND m2.media IS NULL
      WHERE cm2.status = 'active'
      GROUP BY cm2.id
    ) computed
    WHERE cm.id = computed.member_id
  )
  SELECT * FROM deleted_messages;
END;
$$;

GRANT EXECUTE ON FUNCTION app_clear_chat_messages(uuid) TO nexus_app;

REVOKE ALL ON FUNCTION app_root_clear_all_messages() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_root_clear_all_messages() TO nexus_app;

REVOKE ALL ON FUNCTION app_root_clear_all_media() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_root_clear_all_media() TO nexus_app;

GRANT EXECUTE ON FUNCTION app_current_user_uuid() TO nexus_app;
GRANT EXECUTE ON FUNCTION app_can_edit_message(uuid, uuid) TO nexus_app;
GRANT EXECUTE ON FUNCTION app_can_delete_message_for_all(uuid, uuid) TO nexus_app;
GRANT EXECUTE ON FUNCTION app_can_pin_message(uuid) TO nexus_app;
GRANT EXECUTE ON FUNCTION app_message_visibility_bypass() TO nexus_app;
REVOKE ALL ON FUNCTION app_delete_unreferenced_media_file(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_delete_unreferenced_media_file(uuid) TO nexus_app;
REVOKE ALL ON FUNCTION app_recount_unread_counts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_recount_unread_counts(uuid) TO nexus_app;

ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_files ENABLE ROW LEVEL SECURITY;

ALTER TABLE chats FORCE ROW LEVEL SECURITY;
ALTER TABLE chat_members FORCE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
ALTER TABLE message_reads FORCE ROW LEVEL SECURITY;
ALTER TABLE message_reactions FORCE ROW LEVEL SECURITY;
ALTER TABLE media_files FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chats_update_policy ON chats;
CREATE POLICY chats_update_policy ON chats
  FOR UPDATE
  USING (
    app_current_user_uuid() IS NOT NULL
    AND (
      (
        chats.type = 'private'
        AND is_active_chat_member(app_current_user_uuid(), chats.id)
      )
      OR app_is_chat_owner(chats.id)
      OR app_can_pin_message(chats.id)
    )
  )
  WITH CHECK (
    app_current_user_uuid() IS NOT NULL
    AND (
      (
        chats.type = 'private'
        AND is_active_chat_member(app_current_user_uuid(), chats.id)
      )
      OR app_is_chat_owner(chats.id)
      OR app_can_pin_message(chats.id)
    )
  );

DROP POLICY IF EXISTS messages_select_policy ON messages;
DROP POLICY IF EXISTS messages_insert_policy ON messages;
DROP POLICY IF EXISTS messages_update_policy ON messages;
DROP POLICY IF EXISTS messages_delete_policy ON messages;

CREATE POLICY messages_select_policy ON messages
  FOR SELECT
  USING (
    app_current_user_uuid() IS NOT NULL
    AND is_active_chat_member(app_current_user_uuid(), messages.chat_id)
    AND messages.is_deleted_for_all = false
    AND (
      app_message_visibility_bypass()
      OR NOT (messages.deleted_for ? app_current_user_uuid()::text)
    )
  );

CREATE POLICY messages_insert_policy ON messages
  FOR INSERT
  WITH CHECK (
    app_current_user_uuid() IS NOT NULL
    AND messages.sender_id = app_current_user_uuid()
    AND can_send_message_in_chat(app_current_user_uuid(), messages.chat_id)
    AND check_permission(app_current_user_uuid(), messages.chat_id, 'can_send_messages')
  );

CREATE POLICY messages_update_policy ON messages
  FOR UPDATE
  USING (
    app_current_user_uuid() IS NOT NULL
    AND is_active_chat_member(app_current_user_uuid(), messages.chat_id)
    AND (
      app_can_edit_message(messages.chat_id, messages.sender_id)
      OR app_can_pin_message(messages.chat_id)
    )
  )
  WITH CHECK (
    app_current_user_uuid() IS NOT NULL
    AND is_active_chat_member(app_current_user_uuid(), messages.chat_id)
  );

CREATE POLICY messages_delete_policy ON messages
  FOR DELETE
  USING (
    app_current_user_uuid() IS NOT NULL
    AND app_can_delete_message_for_all(messages.chat_id, messages.sender_id)
  );

DROP POLICY IF EXISTS message_reads_select_policy ON message_reads;
DROP POLICY IF EXISTS message_reads_insert_policy ON message_reads;
DROP POLICY IF EXISTS message_reads_update_policy ON message_reads;
DROP POLICY IF EXISTS message_reads_delete_policy ON message_reads;

CREATE POLICY message_reads_select_policy ON message_reads
  FOR SELECT
  USING (
    app_current_user_uuid() IS NOT NULL
    AND (
      message_reads.user_id = app_current_user_uuid()
      OR is_active_chat_member(app_current_user_uuid(), message_reads.chat_id)
    )
  );

CREATE POLICY message_reads_insert_policy ON message_reads
  FOR INSERT
  WITH CHECK (
    app_current_user_uuid() IS NOT NULL
    AND message_reads.user_id = app_current_user_uuid()
    AND is_active_chat_member(app_current_user_uuid(), message_reads.chat_id)
  );

CREATE POLICY message_reads_update_policy ON message_reads
  FOR UPDATE
  USING (
    app_current_user_uuid() IS NOT NULL
    AND message_reads.user_id = app_current_user_uuid()
  )
  WITH CHECK (
    app_current_user_uuid() IS NOT NULL
    AND message_reads.user_id = app_current_user_uuid()
  );

CREATE POLICY message_reads_delete_policy ON message_reads
  FOR DELETE
  USING (
    app_current_user_uuid() IS NOT NULL
    AND message_reads.user_id = app_current_user_uuid()
  );

DROP POLICY IF EXISTS message_reactions_select_policy ON message_reactions;
DROP POLICY IF EXISTS message_reactions_insert_policy ON message_reactions;
DROP POLICY IF EXISTS message_reactions_delete_policy ON message_reactions;

CREATE POLICY message_reactions_select_policy ON message_reactions
  FOR SELECT
  USING (
    app_current_user_uuid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM messages m
      WHERE m.id = message_reactions.message_id
        AND is_active_chat_member(app_current_user_uuid(), m.chat_id)
        AND m.is_deleted_for_all = false
        AND NOT (m.deleted_for ? app_current_user_uuid()::text)
    )
  );

CREATE POLICY message_reactions_insert_policy ON message_reactions
  FOR INSERT
  WITH CHECK (
    app_current_user_uuid() IS NOT NULL
    AND message_reactions.user_id = app_current_user_uuid()
    AND EXISTS (
      SELECT 1
      FROM messages m
      WHERE m.id = message_reactions.message_id
        AND is_active_chat_member(app_current_user_uuid(), m.chat_id)
        AND m.is_deleted_for_all = false
        AND NOT (m.deleted_for ? app_current_user_uuid()::text)
    )
  );

CREATE POLICY message_reactions_delete_policy ON message_reactions
  FOR DELETE
  USING (
    app_current_user_uuid() IS NOT NULL
    AND message_reactions.user_id = app_current_user_uuid()
  );

DROP POLICY IF EXISTS media_files_select_policy ON media_files;
DROP POLICY IF EXISTS media_files_insert_policy ON media_files;
DROP POLICY IF EXISTS media_files_update_policy ON media_files;
DROP POLICY IF EXISTS media_files_delete_policy ON media_files;

CREATE POLICY media_files_select_policy ON media_files
  FOR SELECT
  USING (
    app_current_user_uuid() IS NOT NULL
    AND (
      media_files.uploader_id = app_current_user_uuid()
      OR EXISTS (
        SELECT 1
        FROM messages m
        WHERE m.media->>'file_id' = media_files.id::text
          AND m.is_deleted_for_all = false
          AND NOT (m.deleted_for ? app_current_user_uuid()::text)
          AND is_active_chat_member(app_current_user_uuid(), m.chat_id)
      )
    )
  );

CREATE POLICY media_files_insert_policy ON media_files
  FOR INSERT
  WITH CHECK (
    app_current_user_uuid() IS NOT NULL
    AND media_files.uploader_id = app_current_user_uuid()
  );

CREATE POLICY media_files_update_policy ON media_files
  FOR UPDATE
  USING (
    app_current_user_uuid() IS NOT NULL
    AND media_files.uploader_id = app_current_user_uuid()
  )
  WITH CHECK (
    app_current_user_uuid() IS NOT NULL
    AND media_files.uploader_id = app_current_user_uuid()
  );

CREATE POLICY media_files_delete_policy ON media_files
  FOR DELETE
  USING (
    app_current_user_uuid() IS NOT NULL
    AND media_files.uploader_id = app_current_user_uuid()
  );

COMMIT;
BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_root BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_users_is_root ON users(is_root);
CREATE INDEX IF NOT EXISTS idx_users_username_lower ON users((LOWER(username)));

-- Root is created and managed from env in adminSeed.ts, do not hardcode it in SQL.

DO $$
BEGIN
  IF to_regclass('public.chat_invites') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS chat_invites_select_policy ON chat_invites';
    EXECUTE 'DROP POLICY IF EXISTS chat_invites_insert_policy ON chat_invites';
    EXECUTE 'DROP POLICY IF EXISTS chat_invites_update_policy ON chat_invites';
    EXECUTE 'DROP POLICY IF EXISTS chat_invites_delete_policy ON chat_invites';
  END IF;

  IF to_regclass('public.chat_invite_uses') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS chat_invite_uses_select_policy ON chat_invite_uses';
    EXECUTE 'DROP POLICY IF EXISTS chat_invite_uses_insert_policy ON chat_invite_uses';
    EXECUTE 'DROP POLICY IF EXISTS chat_invite_uses_update_policy ON chat_invite_uses';
    EXECUTE 'DROP POLICY IF EXISTS chat_invite_uses_delete_policy ON chat_invite_uses';
  END IF;
END
$$;

DROP TABLE IF EXISTS chat_invite_uses CASCADE;
DROP TABLE IF EXISTS chat_invites CASCADE;

ALTER TABLE chats
  DROP COLUMN IF EXISTS invite_link;

DROP INDEX IF EXISTS idx_chats_invite_link;
DROP INDEX IF EXISTS idx_invites_chat;
DROP INDEX IF EXISTS idx_invites_code;
DROP INDEX IF EXISTS idx_invites_active;
DROP INDEX IF EXISTS idx_invite_uses_invite;
DROP INDEX IF EXISTS idx_invite_uses_user;
DROP INDEX IF EXISTS idx_invite_uses_pending;

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notification_type_values;

ALTER TABLE notifications
  ADD CONSTRAINT notification_type_values CHECK (type IN (
    'new_message',
    'mention',
    'reply',
    'promoted',
    'demoted',
    'kicked',
    'banned',
    'contact_joined'
  ));

DROP FUNCTION IF EXISTS app_invite_lookup_enabled();
DROP FUNCTION IF EXISTS app_can_manage_invites(uuid);
DROP FUNCTION IF EXISTS app_invite_is_active(uuid);
DROP FUNCTION IF EXISTS app_can_user_join_chat(uuid, uuid);

CREATE OR REPLACE FUNCTION app_current_user_uuid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_current_user_is_root()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.current_user_is_root', true), ''), 'false')::boolean
$$;

CREATE OR REPLACE FUNCTION app_is_root_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM users u
    WHERE u.id = p_user_id
      AND u.is_root = true
      AND u.is_active = true
      AND u.is_deleted = false
  )
$$;

CREATE OR REPLACE FUNCTION app_users_share_active_chat(p_user_id uuid, p_other_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM chat_members cm_self
    JOIN chat_members cm_other
      ON cm_other.chat_id = cm_self.chat_id
    JOIN chats c
      ON c.id = cm_self.chat_id
    WHERE cm_self.user_id = p_user_id
      AND cm_other.user_id = p_other_user_id
      AND cm_self.status = 'active'
      AND cm_other.status = 'active'
      AND c.is_active = true
      AND c.is_deleted = false
  )
$$;

CREATE OR REPLACE FUNCTION app_users_have_contact_relation(p_user_id uuid, p_other_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM contacts c
    WHERE (c.user_id = p_user_id AND c.contact_user_id = p_other_user_id)
       OR (c.user_id = p_other_user_id AND c.contact_user_id = p_user_id)
  )
$$;

CREATE OR REPLACE FUNCTION app_insert_contact(p_user_id uuid, p_contact_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO contacts (user_id, contact_user_id, custom_name, is_blocked, is_favorite)
  VALUES (p_user_id, p_contact_user_id, NULL, false, false)
  ON CONFLICT (user_id, contact_user_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION app_user_lookup_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.user_lookup', true), ''), 'off') = 'on'
$$;

CREATE OR REPLACE FUNCTION app_lookup_userid()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(LOWER(BTRIM(current_setting('app.lookup_userid', true))), '')
$$;

REVOKE ALL ON FUNCTION app_is_root_user(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_current_user_is_root() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_users_share_active_chat(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_users_have_contact_relation(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_insert_contact(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app_current_user_uuid() TO nexus_app;
GRANT EXECUTE ON FUNCTION app_is_root_user(uuid) TO nexus_app;
GRANT EXECUTE ON FUNCTION app_current_user_is_root() TO nexus_app;
GRANT EXECUTE ON FUNCTION app_users_share_active_chat(uuid, uuid) TO nexus_app;
GRANT EXECUTE ON FUNCTION app_users_have_contact_relation(uuid, uuid) TO nexus_app;
GRANT EXECUTE ON FUNCTION app_insert_contact(uuid, uuid) TO nexus_app;
GRANT EXECUTE ON FUNCTION app_user_lookup_enabled() TO nexus_app;
GRANT EXECUTE ON FUNCTION app_lookup_userid() TO nexus_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE users TO nexus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE contacts TO nexus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE chats TO nexus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE chat_members TO nexus_app;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_directory_policy ON users;
CREATE POLICY users_directory_policy ON users
  FOR SELECT
  USING (
    app_current_user_uuid() IS NOT NULL
    AND users.is_active = true
    AND users.is_deleted = false
    AND (
      users.id = app_current_user_uuid()
      OR
      app_current_user_is_root()
      OR (
        current_setting('app.user_directory', true) = 'on'
        AND (
          app_users_share_active_chat(app_current_user_uuid(), users.id)
          OR app_users_have_contact_relation(app_current_user_uuid(), users.id)
        )
      )
      OR (
        app_user_lookup_enabled()
        AND app_lookup_userid() IS NOT NULL
        AND LOWER(users.username) = app_lookup_userid()
      )
    )
  );

DROP POLICY IF EXISTS chats_select_policy ON chats;
CREATE POLICY chats_select_policy ON chats
  FOR SELECT
  USING (
    app_current_user_uuid() IS NOT NULL
    AND (
      created_by = app_current_user_uuid()
      OR is_active_chat_member(app_current_user_uuid(), chats.id)
    )
  );

COMMIT;
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexus_app') THEN
    RAISE EXCEPTION 'Role nexus_app does not exist';
  END IF;
END
$$;

REVOKE CONNECT ON DATABASE nexus FROM PUBLIC;
GRANT CONNECT ON DATABASE nexus TO nexus_app;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM nexus_app;
GRANT USAGE ON SCHEMA public TO nexus_app;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nexus_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nexus_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO nexus_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM PUBLIC;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nexus_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO nexus_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO nexus_app;

ALTER ROLE nexus_app SET statement_timeout = '15s';
ALTER ROLE nexus_app SET lock_timeout = '5s';
ALTER ROLE nexus_app SET idle_in_transaction_session_timeout = '30s';

DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT
      n.nspname AS schema_name,
      p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS identity_args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'app\_%' ESCAPE '\'
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC',
      fn.schema_name,
      fn.function_name,
      fn.identity_args
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %I.%I(%s) TO nexus_app',
      fn.schema_name,
      fn.function_name,
      fn.identity_args
    );
  END LOOP;
END
$$;

COMMIT;
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_sessions_user_created_desc
  ON sessions (user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_chat_members_user_status_pin_chat
  ON chat_members (user_id, status, is_pinned DESC, pin_order ASC, chat_id);

CREATE INDEX IF NOT EXISTS idx_chat_members_chat_status_role_joined
  ON chat_members (chat_id, status, role, joined_at ASC, user_id);

CREATE INDEX IF NOT EXISTS idx_contacts_user_favorite_name_user
  ON contacts (user_id, is_favorite DESC, custom_name, contact_user_id);

CREATE INDEX IF NOT EXISTS idx_users_active_created_id
  ON users (created_at DESC, id DESC)
  WHERE is_active = true AND is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_users_first_name_lower
  ON users ((LOWER(first_name)));

CREATE INDEX IF NOT EXISTS idx_users_last_name_lower
  ON users ((LOWER(COALESCE(last_name, ''))));

CREATE INDEX IF NOT EXISTS idx_users_username_trgm
  ON users USING gin (LOWER(username) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_users_first_name_trgm
  ON users USING gin (LOWER(first_name) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_users_last_name_trgm
  ON users USING gin (LOWER(COALESCE(last_name, '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_contacts_custom_name_trgm
  ON contacts USING gin (LOWER(custom_name) gin_trgm_ops)
  WHERE custom_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_chat_visible_created
  ON messages (chat_id, created_at DESC, id DESC)
  WHERE is_deleted_for_all = false;

CREATE INDEX IF NOT EXISTS idx_messages_content_trgm
  ON messages USING gin (content gin_trgm_ops)
  WHERE content IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_reads_message_read_at
  ON message_reads (message_id, read_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message_emoji_created
  ON message_reactions (message_id, emoji, created_at DESC);

COMMIT;
BEGIN;

DO $$
DECLARE
  username_dups text[];
  email_dups text[];
  phone_dups text[];
BEGIN
  SELECT ARRAY_AGG(format('%s (%s rows)', norm_username, row_count) ORDER BY norm_username)
  INTO username_dups
  FROM (
    SELECT
      lower(trim(regexp_replace(username, '[\x00-\x1F\x7F]', '', 'g'))) AS norm_username,
      COUNT(*)::int AS row_count
    FROM users
    GROUP BY 1
    HAVING COUNT(*) > 1
  ) q;

  IF username_dups IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 15 blocked: case-insensitive username duplicates exist: %', array_to_string(username_dups, ', ');
  END IF;

  SELECT ARRAY_AGG(format('%s (%s rows)', norm_email, row_count) ORDER BY norm_email)
  INTO email_dups
  FROM (
    SELECT
      lower(trim(regexp_replace(email, '[\x00-\x1F\x7F]', '', 'g'))) AS norm_email,
      COUNT(*)::int AS row_count
    FROM users
    WHERE email IS NOT NULL AND trim(email) <> ''
    GROUP BY 1
    HAVING COUNT(*) > 1
  ) q;

  IF email_dups IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 15 blocked: case-insensitive email duplicates exist: %', array_to_string(email_dups, ', ');
  END IF;

  SELECT ARRAY_AGG(format('%s (%s rows)', norm_phone, row_count) ORDER BY norm_phone)
  INTO phone_dups
  FROM (
    SELECT
      trim(regexp_replace(phone, '[\x00-\x1F\x7F]', '', 'g')) AS norm_phone,
      COUNT(*)::int AS row_count
    FROM users
    WHERE phone IS NOT NULL AND trim(phone) <> ''
    GROUP BY 1
    HAVING COUNT(*) > 1
  ) q;

  IF phone_dups IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 15 blocked: phone duplicates exist: %', array_to_string(phone_dups, ', ');
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION app_normalize_user_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.username := lower(trim(regexp_replace(COALESCE(NEW.username, ''), '[\x00-\x1F\x7F]', '', 'g')));
  IF NEW.username = '' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'username is required',
      CONSTRAINT = 'users_username_required';
  END IF;

  NEW.email := NULLIF(
    lower(trim(regexp_replace(COALESCE(NEW.email, ''), '[\x00-\x1F\x7F]', '', 'g'))),
    ''
  );

  NEW.phone := NULLIF(
    trim(regexp_replace(COALESCE(NEW.phone, ''), '[\x00-\x1F\x7F]', '', 'g')),
    ''
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.app_normalize_user_identity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_normalize_user_identity() TO nexus_app;

DROP TRIGGER IF EXISTS trigger_users_identity_normalize ON users;
CREATE TRIGGER trigger_users_identity_normalize
  BEFORE INSERT OR UPDATE OF username, email, phone
  ON users
  FOR EACH ROW
  EXECUTE FUNCTION app_normalize_user_identity();

UPDATE users
SET
  username = lower(trim(regexp_replace(username, '[\x00-\x1F\x7F]', '', 'g'))),
  email = NULLIF(lower(trim(regexp_replace(COALESCE(email, ''), '[\x00-\x1F\x7F]', '', 'g'))), ''),
  phone = NULLIF(trim(regexp_replace(COALESCE(phone, ''), '[\x00-\x1F\x7F]', '', 'g')), '');

CREATE UNIQUE INDEX IF NOT EXISTS users_username_ci_uniq
  ON users ((lower(username)));

CREATE UNIQUE INDEX IF NOT EXISTS users_email_ci_uniq
  ON users ((lower(email)))
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_phone_nonnull_uniq
  ON users (phone)
  WHERE phone IS NOT NULL;

COMMIT;
BEGIN;

CREATE OR REPLACE FUNCTION app_validate_voice_message()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_duration_text text;
  v_duration_ms integer;
BEGIN
  IF NEW.type <> 'voice' THEN
    RETURN NEW;
  END IF;

  IF NEW.media IS NULL OR jsonb_typeof(NEW.media) <> 'object' THEN
    RAISE EXCEPTION 'voice messages require a media JSON object';
  END IF;

  IF COALESCE(NEW.media->>'file_id', '') = '' THEN
    RAISE EXCEPTION 'voice messages require media.file_id';
  END IF;

  IF COALESCE(NEW.media->>'mime', '') = '' THEN
    RAISE EXCEPTION 'voice messages require media.mime';
  END IF;

  NEW.media = jsonb_set(COALESCE(NEW.media, '{}'::jsonb), '{is_voice}', 'true'::jsonb, true);

  v_duration_text := NEW.media->>'duration_ms';
  IF v_duration_text IS NULL OR v_duration_text !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'voice messages require numeric media.duration_ms';
  END IF;

  v_duration_ms := v_duration_text::integer;
  IF v_duration_ms < 300 OR v_duration_ms > 900000 THEN
    RAISE EXCEPTION 'voice duration must be between 300 and 900000 ms';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_validate_voice_message() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_validate_voice_message() TO nexus_app;

DROP TRIGGER IF EXISTS trigger_messages_validate_voice ON messages;
CREATE TRIGGER trigger_messages_validate_voice
  BEFORE INSERT OR UPDATE OF type, media
  ON messages
  FOR EACH ROW
  EXECUTE FUNCTION app_validate_voice_message();

CREATE INDEX IF NOT EXISTS idx_messages_voice_chat_created
  ON messages(chat_id, created_at DESC)
  WHERE type = 'voice' AND is_deleted_for_all = false;

COMMIT;
\set ON_ERROR_STOP on

DO $$
DECLARE
  invalid_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO invalid_count
  FROM users
  WHERE password_hash IS NULL
     OR password_hash !~ '^\$2[aby]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$';

  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'Cannot enforce bcrypt password_hash constraint: % invalid rows found', invalid_count;
  END IF;
END
$$;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_password_hash_bcrypt_format;

ALTER TABLE users
  ADD CONSTRAINT users_password_hash_bcrypt_format
  CHECK (password_hash ~ '^\$2[aby]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$');

COMMENT ON CONSTRAINT users_password_hash_bcrypt_format ON users
  IS 'Phase 16.2: enforce bcrypt hash format for users.password_hash';

\set ON_ERROR_STOP on

WITH computed AS (
  SELECT
    cm.id AS member_id,
    COUNT(m.id)::int AS unread_count
  FROM chat_members cm
  LEFT JOIN messages lr
    ON lr.id = cm.last_read_message_id
   AND lr.chat_id = cm.chat_id
  LEFT JOIN messages m
    ON m.chat_id = cm.chat_id
   AND m.is_deleted_for_all = false
   AND NOT (m.deleted_for ? cm.user_id::text)
   AND m.sender_id <> cm.user_id
   AND (
     lr.id IS NULL
     OR (m.created_at, m.id) > (lr.created_at, lr.id)
   )
  WHERE cm.status = 'active'
  GROUP BY cm.id
)
UPDATE chat_members cm
SET
  unread_count = computed.unread_count,
  unread_mentions = 0
FROM computed
WHERE cm.id = computed.member_id;

BEGIN;

CREATE OR REPLACE FUNCTION app_root_user_delete_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.root_user_delete', true), ''), 'off') = 'on'
$$;

CREATE OR REPLACE FUNCTION app_root_delete_target_user_uuid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.root_delete_target_user_id', true), '')::uuid
$$;

REVOKE ALL ON FUNCTION app_root_user_delete_enabled() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_root_delete_target_user_uuid() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app_root_user_delete_enabled() TO nexus_app;
GRANT EXECUTE ON FUNCTION app_root_delete_target_user_uuid() TO nexus_app;

DROP POLICY IF EXISTS users_root_delete_select_policy ON users;
CREATE POLICY users_root_delete_select_policy ON users
  FOR SELECT
  USING (
    app_root_user_delete_enabled()
    AND app_current_user_is_root()
    AND app_root_delete_target_user_uuid() IS NOT NULL
    AND app_root_delete_target_user_uuid() <> app_current_user_uuid()
    AND id = app_root_delete_target_user_uuid()
  );

DROP POLICY IF EXISTS users_root_delete_policy ON users;
CREATE POLICY users_root_delete_policy ON users
  FOR UPDATE
  USING (
    app_root_user_delete_enabled()
    AND app_current_user_is_root()
    AND app_root_delete_target_user_uuid() IS NOT NULL
    AND app_root_delete_target_user_uuid() <> app_current_user_uuid()
    AND id = app_root_delete_target_user_uuid()
    AND is_root = false
  )
  WITH CHECK (
    app_root_user_delete_enabled()
    AND app_current_user_is_root()
    AND app_root_delete_target_user_uuid() IS NOT NULL
    AND app_root_delete_target_user_uuid() <> app_current_user_uuid()
    AND id = app_root_delete_target_user_uuid()
    AND is_root = false
    AND is_active = false
    AND is_deleted = true
    AND deleted_at IS NOT NULL
  );

DROP POLICY IF EXISTS sessions_root_delete_policy ON sessions;
CREATE POLICY sessions_root_delete_policy ON sessions
  FOR UPDATE
  USING (
    app_root_user_delete_enabled()
    AND app_current_user_is_root()
    AND app_root_delete_target_user_uuid() IS NOT NULL
    AND app_root_delete_target_user_uuid() <> app_current_user_uuid()
    AND user_id = app_root_delete_target_user_uuid()
  )
  WITH CHECK (
    app_root_user_delete_enabled()
    AND app_current_user_is_root()
    AND app_root_delete_target_user_uuid() IS NOT NULL
    AND app_root_delete_target_user_uuid() <> app_current_user_uuid()
    AND user_id = app_root_delete_target_user_uuid()
  );

DROP POLICY IF EXISTS contacts_root_delete_policy ON contacts;
CREATE POLICY contacts_root_delete_policy ON contacts
  FOR DELETE
  USING (
    app_root_user_delete_enabled()
    AND app_current_user_is_root()
    AND app_root_delete_target_user_uuid() IS NOT NULL
    AND app_root_delete_target_user_uuid() <> app_current_user_uuid()
    AND (
      user_id = app_root_delete_target_user_uuid()
      OR contact_user_id = app_root_delete_target_user_uuid()
    )
  );

COMMIT;
BEGIN;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS client_message_id VARCHAR(128);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'messages_client_message_id_format'
      AND conrelid = 'messages'::regclass
  ) THEN
    ALTER TABLE messages
      ADD CONSTRAINT messages_client_message_id_format
      CHECK (
        client_message_id IS NULL
        OR client_message_id ~ '^[A-Za-z0-9._:-]{8,128}$'
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_sender_chat_client_message_id
  ON messages(sender_id, chat_id, client_message_id);

COMMIT;
BEGIN;

ALTER TABLE message_reactions
  DROP CONSTRAINT IF EXISTS valid_emoji;

ALTER TABLE message_reactions
  ALTER COLUMN emoji TYPE VARCHAR(64);

ALTER TABLE message_reactions
  DROP CONSTRAINT IF EXISTS message_reactions_emoji_not_blank;

ALTER TABLE message_reactions
  ADD CONSTRAINT message_reactions_emoji_not_blank
  CHECK (char_length(btrim(emoji)) > 0);

COMMIT;

BEGIN;

CREATE TABLE IF NOT EXISTS app_settings (
    key          TEXT PRIMARY KEY,
    value        JSONB NOT NULL,
    updated_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_by   UUID REFERENCES users(id)
);

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

-- Enable RLS on app_settings
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_settings_root_policy ON app_settings;
CREATE POLICY app_settings_root_policy ON app_settings
  FOR ALL
  USING (
    app_current_user_is_root()
  )
  WITH CHECK (
    app_current_user_is_root()
  );

DROP POLICY IF EXISTS app_settings_select_policy ON app_settings;
CREATE POLICY app_settings_select_policy ON app_settings
  FOR SELECT
  USING (true);

-- Root admin policy on users
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

-- Insert default value for registration mode if not present
INSERT INTO app_settings (key, value)
VALUES ('registration_mode', '"public"'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value)
VALUES ('registration_required_fields', '{"lastName":false,"email":false,"phone":false}'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value)
VALUES ('media_limits', '{"voice":0.03,"audio":0.03,"photo":0.03,"video":0.03}'::jsonb)
ON CONFLICT (key) DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE app_settings TO nexus_app;

COMMIT;

