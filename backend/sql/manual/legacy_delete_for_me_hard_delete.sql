-- Manual Script: legacy_delete_for_me_hard_delete.sql
-- WARNING: This script permanently deletes messages from the database.
-- Run this script manually if you wish to clean up database space by hard-deleting
-- messages that were previously hidden by users using the retired "Delete for me" feature
-- (which wrote user UUIDs into the messages.deleted_for JSONB array).
--
-- This script should ONLY be executed after taking a full database backup.

BEGIN;

-- 1. Identify and delete messages that are flagged as deleted_for by any user.
-- Typically, if a message has any elements in its deleted_for array, it can be hard deleted.
DELETE FROM messages
WHERE deleted_for IS NOT NULL
  AND jsonb_array_length(deleted_for) > 0;

COMMIT;
