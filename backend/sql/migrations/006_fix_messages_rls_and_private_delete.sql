-- Migration 006: Fix messages update RLS policy and symmetric private message delete

-- 1. Recreate app_can_delete_message_for_all function to support private chat symmetric deletions
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

-- 2. Drop and recreate messages_update_policy to remove RLS update bypass
DROP POLICY IF EXISTS messages_update_policy ON messages;

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
