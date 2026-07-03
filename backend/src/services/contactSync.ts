import { sql, joinSql, emptySql, type SqlFragment, type JsonValue, type JsonObject } from '../config/sql.js';
import type { DbExecutor } from '../config/db.js';

type TxClient = DbExecutor;

type PeerRow = {
  user_id: string;
};

export const ensureSenderContactLink = async (tx: TxClient, senderId: string, recipientId: string) => {
  if (!senderId || !recipientId || senderId === recipientId) {
    return;
  }

  // Create sender → recipient and recipient → sender contact links using RLS bypass function
  await tx.$executeRaw`SELECT app_insert_contact(${senderId}::uuid, ${recipientId}::uuid)`;
  await tx.$executeRaw`SELECT app_insert_contact(${recipientId}::uuid, ${senderId}::uuid)`;
};

export const resolvePrivateChatPeerId = async (tx: TxClient, chatId: string, actorId: string) => {
  const rows = await tx.$queryRaw<PeerRow[]>`
    SELECT cm.user_id
    FROM chat_members cm
    JOIN chats c ON c.id = cm.chat_id
    WHERE cm.chat_id = ${chatId}::uuid
      AND cm.user_id <> ${actorId}::uuid
      AND c.type = 'private'
    ORDER BY
      CASE cm.status
        WHEN 'active' THEN 0
        ELSE 1
      END,
      cm.joined_at ASC
    LIMIT 1
  `;

  return rows[0]?.user_id ?? null;
};
