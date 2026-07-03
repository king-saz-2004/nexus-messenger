-- Migration: 005_contacts_rls_bypass.sql
-- Create SECURITY DEFINER function to insert contacts and bypass RLS constraints for direct chat initialization.

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

REVOKE ALL ON FUNCTION app_insert_contact(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_insert_contact(uuid, uuid) TO nexus_app;
