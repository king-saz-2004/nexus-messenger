-- Migration 011: Make app_clear_chat_messages SECURITY DEFINER
-- This allows admins/members with permissions to update unread counts and delete messages bypassing standard RLS checks, while preserving authorization logic.

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
  WHERE chat_members.chat_id = p_chat_id;

  -- Delete all messages in the chat
  RETURN QUERY
  DELETE FROM messages m
  WHERE m.chat_id = p_chat_id
  RETURNING m.id, m.chat_id, m.sender_id, m.media, m.type;
END;
$$;

GRANT EXECUTE ON FUNCTION app_clear_chat_messages(uuid) TO nexus_app;
