-- Migration 009: Bulk message deletion and clearing history

-- 1. Create app_clear_chat_messages to clear a specific chat's history (RLS context)
CREATE OR REPLACE FUNCTION app_clear_chat_messages(p_chat_id uuid)
RETURNS TABLE (
  id uuid,
  chat_id uuid,
  sender_id uuid,
  media jsonb,
  type varchar
) LANGUAGE plpgsql AS $$
BEGIN
  -- Verify caller has permissions to clear the chat
  IF NOT EXISTS (
    SELECT 1 FROM chat_members cm
    JOIN chats c ON c.id = cm.chat_id
    WHERE cm.chat_id = p_chat_id
      AND cm.user_id = app_current_user_uuid()
      AND cm.status = 'active'
      AND (
        c.type = 'private'
        OR cm.role = 'owner'
        OR (
          cm.role = 'admin'
          AND COALESCE((cm.permissions->>'can_delete_messages')::boolean, false)
        )
      )
  ) THEN
    RAISE EXCEPTION 'Access denied: cannot clear chat history';
  END IF;

  -- Reset unread counts for this chat
  UPDATE chat_members
  SET unread_count = 0, unread_mentions = 0
  WHERE chat_id = p_chat_id;

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
) LANGUAGE plpgsql SECURITY DEFINER AS $$
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
) LANGUAGE plpgsql SECURITY DEFINER AS $$
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
      WHERE cm2.status = 'active'
        AND m2.id NOT IN (SELECT dm.id FROM deleted_messages dm)
      GROUP BY cm2.id
    ) computed
    WHERE cm.id = computed.member_id
  )
  SELECT * FROM deleted_messages;
END;
$$;
