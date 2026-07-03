-- Migration: Retire Delete for Me and Add Unreferenced Media Cleanup
-- Non-destructive: creates function and comments legacy column.

COMMENT ON COLUMN messages.deleted_for IS 'Legacy: list of user IDs for whom the message is deleted individually. Retired in 003_retire_delete_for_me.sql. No longer written by app code.';

CREATE OR REPLACE FUNCTION app_delete_unreferenced_media_file(p_file_id uuid)
RETURNS TABLE(file_path text)
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
  RETURNING mf.file_path;
END;
$$;

REVOKE ALL ON FUNCTION app_delete_unreferenced_media_file(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_delete_unreferenced_media_file(uuid) TO nexus_app;
