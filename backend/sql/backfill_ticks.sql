-- backfill_ticks.sql
-- Run this on the Nexus Postgres database to backfill message_reads for old messages.
-- This ensures that messages sent before the fix will show double ticks (delivered/read).

INSERT INTO message_reads (message_id, user_id, chat_id, read_at)
SELECT
  m.id,
  cm.user_id,
  cm.chat_id,
  COALESCE(cm.last_read_at, NOW())
FROM chat_members cm
JOIN messages pointer
  ON pointer.id = cm.last_read_message_id
 AND pointer.chat_id = cm.chat_id
JOIN messages m
  ON m.chat_id = cm.chat_id
WHERE m.is_deleted_for_all = false
  AND (m.created_at, m.id) <= (pointer.created_at, pointer.id)
ON CONFLICT (message_id, user_id) DO NOTHING;
