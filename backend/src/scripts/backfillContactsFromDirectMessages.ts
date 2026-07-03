import { sql, joinSql, emptySql, type SqlFragment, type JsonValue, type JsonObject } from '../config/sql.js';
import { connectDb, stopDb } from '../config/db.js';
import { runAsUser, runForAuthLookup } from '../config/dbContext.js';

type PairRow = {
  sender_id: string;
  recipient_id: string;
};

type InsertedRow = {
  id: string;
};

const loadSenderRecipientPairs = async () => {
  return runForAuthLookup(tx =>
    tx.$queryRaw<PairRow[]>(
      sql`
        SELECT DISTINCT
          m.sender_id,
          cm.user_id AS recipient_id
        FROM messages m
        JOIN chats c
          ON c.id = m.chat_id
         AND c.type = 'private'
         AND c.is_active = true
         AND c.is_deleted = false
        JOIN chat_members cm
          ON cm.chat_id = c.id
         AND cm.user_id <> m.sender_id
        JOIN users us
          ON us.id = m.sender_id
         AND us.is_active = true
         AND us.is_deleted = false
        JOIN users ur
          ON ur.id = cm.user_id
         AND ur.is_active = true
         AND ur.is_deleted = false
        WHERE m.is_deleted_for_all = false
          AND m.sender_id <> cm.user_id
      `
    )
  );
};

const main = async () => {
  await connectDb();
  try {
    const pairs = await loadSenderRecipientPairs();
    const grouped = new Map<string, Set<string>>();

    for (const pair of pairs) {
      if (pair.sender_id === pair.recipient_id) {
        continue;
      }
      const recipients = grouped.get(pair.sender_id) ?? new Set<string>();
      recipients.add(pair.recipient_id);
      grouped.set(pair.sender_id, recipients);
    }

    let insertedContacts = 0;
    for (const [senderId, recipients] of grouped.entries()) {
      await runAsUser(senderId, async tx => {
        for (const recipientId of recipients) {
          const inserted = await tx.$queryRaw<InsertedRow[]>(
            sql`
              INSERT INTO contacts (
                user_id,
                contact_user_id,
                custom_name,
                is_blocked,
                is_favorite
              )
              SELECT
                ${senderId}::uuid,
                u.id,
                NULL,
                false,
                false
              FROM users u
              WHERE u.id = ${recipientId}::uuid
                AND u.is_active = true
                AND u.is_deleted = false
              ON CONFLICT (user_id, contact_user_id) DO NOTHING
              RETURNING id
            `
          );
          insertedContacts += inserted.length;
        }
      });
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          senderCount: grouped.size,
          pairCount: pairs.length,
          insertedContacts
        },
        null,
        2
      )
    );
  } finally {
    await stopDb();
  }
};

void main().catch(async error => {
  console.error('CONTACTS_BACKFILL_FAILED');
  console.error(error instanceof Error ? error.message : String(error));
  try {
    await stopDb();
  } catch {
    // ignore cleanup failures
  }
  process.exit(1);
});
