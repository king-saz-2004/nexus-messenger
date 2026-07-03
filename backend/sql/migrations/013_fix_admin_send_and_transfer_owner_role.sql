-- Allow active group admins to send messages without requiring can_send_messages in admin permissions.
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
