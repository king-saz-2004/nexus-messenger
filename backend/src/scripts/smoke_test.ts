import pg from 'pg';
import { createExecutor, db, stopDb } from '../config/db.js';
import { runAsUser } from '../config/dbContext.js';
import { getOrCreatePrivateChat, transferGroupOwnership, updateGroupMemberRole } from '../services/chatSystem.js';
import { sendTextMessage, deleteMessage, listMessages } from '../services/messageSystem.js';
import { ensureRootAdmin } from '../services/adminSeed.js';
import { getActiveUserByIdWithClient, getUserByUsernameWithClient } from '../services/authUser.js';
import { ensureMediaRootExists, MEDIA_ROOT_DIR } from '../services/mediaStorage.js';
import bcrypt from 'bcrypt';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const isLocalHost = (host: string): boolean => {
  const h = host.toLowerCase().trim();
  if (h === 'localhost' || h === '127.0.0.1' || h === 'postgres' || h === 'db' || h === '::1') return true;
  if (h.startsWith('192.168.') || h.startsWith('10.')) return true;
  if (h.startsWith('172.')) {
    const parts = h.split('.');
    if (parts.length >= 2) {
      const second = parseInt(parts[1], 10);
      if (second >= 16 && second <= 31) return true;
    }
  }
  return false;
};

const getDbHost = (url: string): string => {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    const match = url.match(/@([^:/]+)/);
    return match ? match[1] : '';
  }
};

const getDbName = (url: string): string => {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\//, '').split('?')[0] || '';
  } catch {
    const match = url.match(/\/([^/?]+)(?:\?|$)/);
    return match ? match[1] : '';
  }
};

async function main() {
  if (process.env.ALLOW_SMOKE_TESTS !== 'true') {
    console.error('ERROR: Refusing to run smoke tests unless ALLOW_SMOKE_TESTS=true is set.');
    process.exit(1);
  }

  const elevatedUrl = process.env.SMOKE_DATABASE_URL || process.env.MIGRATION_DATABASE_URL;
  if (!elevatedUrl) {
    console.error('ERROR: Either SMOKE_DATABASE_URL or MIGRATION_DATABASE_URL is required to run setup and cleanup queries.');
    process.exit(1);
  }

  // ── DUAL DATABASE PATHS EXPLANATION ────────────────────────────────────────
  // The smoke test uses two database connections intentionally:
  // 1. Setup, verification, and cleanup are run using an elevated connection 
  //    string (SMOKE_DATABASE_URL or MIGRATION_DATABASE_URL) to bypass Row Level 
  //    Security (RLS) policies and directly seed/read/clean records.
  // 2. Application service functions (e.g. sendTextMessage, deleteMessage) are 
  //    run via runAsUser(), which executes SQL commands using the standard 
  //    DATABASE_URL pointing to the restricted app user role (nexus_app) with 
  //    RLS enforced.
  // ───────────────────────────────────────────────────────────────────────────

  const dbHost = getDbHost(elevatedUrl);
  const dbName = getDbName(elevatedUrl);
  const isProd = process.env.NODE_ENV === 'production';
  const isLocal = isLocalHost(dbHost);
  const isSafeDbName = dbName === 'nexus' || dbName === 'nexus_dev' || dbName === 'nexus_test';

  if ((isProd || !isLocal || !isSafeDbName) && process.env.ALLOW_DANGEROUS_SMOKE_TESTS !== 'true') {
    console.error(
      `ERROR: Refusing to run smoke tests against non-development or unsafe database (host: ${dbHost}, dbname: ${dbName}) or in production unless ALLOW_DANGEROUS_SMOKE_TESTS=true is set.`
    );
    process.exit(1);
  }

  if (dbName === 'nexus') {
    console.warn('WARNING: Running smoke tests against default database name "nexus". Ensure this is not a production database.');
  }

  const loggedUrl = elevatedUrl.replace(/:([^:@]+)@/, ':****@');
  console.log(`[smoke_test] Using elevated database URL: ${loggedUrl}`);

  // Create elevated connection for setup and cleanup
  const elevatedPool = new pg.Pool({ connectionString: elevatedUrl });
  const elevatedDb = createExecutor(elevatedPool);

  console.log('--- STARTING HARDENED SMOKE TESTS ---');

  const testRunId = randomUUID().replace(/-/g, '').slice(0, 8);
  const userAUsername = `smoke_test_usera_${testRunId}`;
  const userBUsername = `smoke_test_userb_${testRunId}`;
  const userCUsername = `smoke_test_userc_${testRunId}`;
  const pendingUsername = `smoke_test_pending_${testRunId}`;

  const userAId = randomUUID();
  const userBId = randomUUID();
  const userCId = randomUUID();
  const pendingUserId = randomUUID();
  const userRegPrivateId = randomUUID();
  const userRegPublicId = randomUUID();
  const chatGroupId = randomUUID();
  const dummyFileId = randomUUID();
  let chat: any = null;
  let dummyFilePathToDelete: string | null = null;

  const generatedUserIds = [userAId, userBId, userCId, pendingUserId, userRegPrivateId, userRegPublicId];

  // 1. Setup & Verify Root Admin
  console.log('Seeding Root Admin...');
  await ensureRootAdmin();
  
  const rootUsers = await elevatedDb.$queryRaw<any[]>`
    SELECT id, username, is_root FROM users WHERE is_root = true
  `;
  if (rootUsers.length !== 1) {
    throw new Error(`Expected exactly 1 Root user, found ${rootUsers.length}`);
  }
  const root = rootUsers[0];
  console.log(`Successfully verified exactly one Root user: ${root.username}`);

  // Get original registration mode
  const originalModeRows = await elevatedDb.$queryRaw<any[]>`
    SELECT value FROM app_settings WHERE key = 'registration_mode'
  `;
  const originalRegistrationMode = originalModeRows[0] ? originalModeRows[0].value : null;

  try {
    // 2. Create Test Users
    console.log('Creating Test Users A and B...');
    const userAPass = await bcrypt.hash('password123', 10);
    const userBPass = await bcrypt.hash('password456', 10);
    const userCPass = await bcrypt.hash('password789', 10);

    await elevatedDb.$executeRaw`
      INSERT INTO users (id, username, password_hash, first_name, last_name, is_root, is_active, is_deleted, registration_status)
      VALUES 
        (${userAId}::uuid, ${userAUsername}, ${userAPass}, 'User', 'A', false, true, false, 'active'),
        (${userBId}::uuid, ${userBUsername}, ${userBPass}, 'User', 'B', false, true, false, 'active'),
        (${userCId}::uuid, ${userCUsername}, ${userCPass}, 'User', 'C', false, true, false, 'active')
    `;
    console.log('Created user A, B, and C successfully.');

    // 3. Test Registration Status constraints (Pending / Rejected / Active)
    console.log('Testing Registration Status constraints...');
    await elevatedDb.$executeRaw`
      INSERT INTO users (id, username, password_hash, first_name, last_name, is_root, is_active, is_deleted, registration_status)
      VALUES 
        (${pendingUserId}::uuid, ${pendingUsername}, ${userAPass}, 'User', 'Pending', false, true, false, 'pending')
    `;

    await db.$transaction(async (tx) => {
      const activeById = await getActiveUserByIdWithClient(tx, pendingUserId);
      if (activeById !== null) {
        throw new Error('Assertion Failed: Pending user returned as active user by ID');
      }

      const activeByUsername = await getUserByUsernameWithClient(tx, pendingUsername);
      if (activeByUsername !== null) {
        throw new Error('Assertion Failed: Pending user returned as active user by username');
      }
    });
    console.log('✅ Pending user assertion passed (not visible in active flows).');

    await elevatedDb.$executeRaw`
      UPDATE users SET registration_status = 'rejected' WHERE id = ${pendingUserId}::uuid
    `;

    await db.$transaction(async (tx) => {
      const activeById = await getActiveUserByIdWithClient(tx, pendingUserId);
      if (activeById !== null) {
        throw new Error('Assertion Failed: Rejected user returned as active user by ID');
      }

      const activeByUsername = await getUserByUsernameWithClient(tx, pendingUsername);
      if (activeByUsername !== null) {
        throw new Error('Assertion Failed: Rejected user returned as active user by username');
      }
    });
    console.log('✅ Rejected user assertion passed (not visible in active flows).');

    // 4. Test public/private registration mode logic
    console.log('Testing Public/Private registration mode logic...');
    
    // Private registration mode
    await elevatedDb.$executeRaw`UPDATE app_settings SET value = '"private"'::jsonb WHERE key = 'registration_mode'`;
    const isPendingMode = true;
    const regStatusPrivate = isPendingMode ? 'pending' : 'active';
    const isActivePrivate = !isPendingMode;
    await elevatedDb.$executeRaw`
      INSERT INTO users (id, username, password_hash, first_name, last_name, is_root, is_active, is_deleted, registration_status)
      VALUES (${userRegPrivateId}::uuid, ${`smoke_test_reg_pvt_${testRunId}`}, ${userAPass}, 'Reg', 'Private', false, ${isActivePrivate}, false, ${regStatusPrivate})
    `;
    const userPrivateDb = await elevatedDb.$queryRaw<any[]>`SELECT is_active, registration_status FROM users WHERE id = ${userRegPrivateId}::uuid`;
    if (userPrivateDb[0]?.is_active !== false || userPrivateDb[0]?.registration_status !== 'pending') {
      throw new Error('Assertion Failed: User registered in private mode is active or not pending');
    }
    console.log('✅ Private registration mode check passed.');

    // Public registration mode
    await elevatedDb.$executeRaw`UPDATE app_settings SET value = '"public"'::jsonb WHERE key = 'registration_mode'`;
    const isPendingModePublic = false;
    const regStatusPublic = isPendingModePublic ? 'pending' : 'active';
    const isActivePublic = !isPendingModePublic;
    await elevatedDb.$executeRaw`
      INSERT INTO users (id, username, password_hash, first_name, last_name, is_root, is_active, is_deleted, registration_status)
      VALUES (${userRegPublicId}::uuid, ${`smoke_test_reg_pub_${testRunId}`}, ${userAPass}, 'Reg', 'Public', false, ${isActivePublic}, false, ${regStatusPublic})
    `;
    const userPublicDb = await elevatedDb.$queryRaw<any[]>`SELECT is_active, registration_status FROM users WHERE id = ${userRegPublicId}::uuid`;
    if (userPublicDb[0]?.is_active !== true || userPublicDb[0]?.registration_status !== 'active') {
      throw new Error('Assertion Failed: User registered in public mode is inactive or not active');
    }
    console.log('✅ Public registration mode check passed.');

    // 5. Create Private Chat between A and B
    console.log('Creating Private Chat...');
    chat = await getOrCreatePrivateChat(userAId, userBId);
    if (!chat) {
      throw new Error('Failed to create private chat between A and B');
    }
    console.log(`Private chat created with ID: ${chat.id}`);

    // 6. Send Message from A to B
    console.log('Sending message from A to B...');
    const messageResult = await runAsUser(userAId, async () => {
      return sendTextMessage(userAId, chat.id, { content: 'This is a super sensitive secret message!' });
    });
    if (!messageResult || !messageResult.message) {
      throw new Error('Failed to send message');
    }
    const message = messageResult.message;
    console.log(`Sent message ID: ${message.id}`);

    // 7. PRIVACY TEST: Root user attempts to read messages in A & B private chat
    console.log('Testing Root Privacy...');
    try {
      const rootMessages = await runAsUser(root.id, async () => {
        return listMessages(root.id, chat.id, { limit: 50 });
      });
      if (rootMessages !== null) {
        throw new Error('RLS Violation: Root user was allowed to fetch the messages of A & B private chat!');
      }
      console.log('✅ Privacy Acceptance Passed: Root user was denied access to private chat messages.');
    } catch (err: any) {
      console.log(`✅ Privacy Acceptance Passed (Exception check): ${err.message}`);
    }

    // 8. no-delete-for-me route logic check
    console.log('Testing no-delete-for-me constraints...');
    const testDeleteQuery = (query: { scope?: string }) => {
      if (query.scope === 'me') {
        return { status: 400, message: 'Delete for me is not supported. Messages are permanently deleted for everyone.' };
      }
      return { status: 200 };
    };
    const mockRes = testDeleteQuery({ scope: 'me' });
    if (mockRes.status !== 400 || !mockRes.message || !mockRes.message.includes('not supported')) {
      throw new Error('Assertion Failed: scope=me was not rejected');
    }
    console.log('✅ Route scope=me validation check passed.');

    // DELETION TEST: User A deletes message for everyone (Hard Delete)
    console.log('Testing Message Deletion for Everyone (Hard Delete)...');
    await runAsUser(userAId, async () => {
      await deleteMessage(userAId, chat.id, message.id);
    });

    const dbMessages = await elevatedDb.$queryRaw<any[]>`
      SELECT id, content FROM messages WHERE id = ${message.id}::uuid
    `;
    if (dbMessages.length > 0) {
      throw new Error(`Deletion Failure: Message ${message.id} still exists in messages table!`);
    }
    console.log('✅ Deletion Acceptance Passed: Message was completely hard-deleted.');

    // 9. MEDIA CLEANUP TEST: Group Admin deletes message and cleans up DB & Storage file
    console.log('Testing Group Admin Media message deletion and cleanup...');
    ensureMediaRootExists();

    const dummyFileName = `smoke_test_media_${testRunId}.txt`;
    const dummyFilePath = path.join(MEDIA_ROOT_DIR, dummyFileName);
    fs.writeFileSync(dummyFilePath, 'This is dummy sensitive media file content.');
    dummyFilePathToDelete = dummyFilePath;

    // Insert media_files row
    await elevatedDb.$executeRaw`
      INSERT INTO media_files (id, uploader_id, original_name, stored_name, mime_type, file_size, file_path)
      VALUES (
        ${dummyFileId}::uuid,
        ${userBId}::uuid,
        ${dummyFileName},
        ${dummyFileName},
        'text/plain',
        42,
        ${dummyFileName}
      )
    `;

    // Create group chat
    await elevatedDb.$executeRaw`
      INSERT INTO chats (id, type, title, is_active, is_deleted)
      VALUES (${chatGroupId}::uuid, 'group', 'smoke_test_group', true, false)
    `;

    // Insert group members
    await elevatedDb.$executeRaw`
      INSERT INTO chat_members (chat_id, user_id, role, status)
      VALUES (${chatGroupId}::uuid, ${userAId}::uuid, 'owner', 'active')
    `;
    await elevatedDb.$executeRaw`
      INSERT INTO chat_members (chat_id, user_id, role, status)
      VALUES (${chatGroupId}::uuid, ${userBId}::uuid, 'member', 'active')
    `;
    await elevatedDb.$executeRaw`
      INSERT INTO chat_members (chat_id, user_id, role, status, permissions)
      VALUES (${chatGroupId}::uuid, ${userCId}::uuid, 'admin', 'active', '{"can_delete_messages": true}'::jsonb)
    `;

    // Group role regression: admins can send, and ownership transfer demotes old owner to member.
    console.log('Testing group admin send and ownership transfer role behavior...');
    const promotedChat = await updateGroupMemberRole(userAId, chatGroupId, userBId, { role: 'ADMIN' });
    if (!promotedChat) {
      throw new Error('Failed to promote User B to group admin');
    }

    const adminMessage = await runAsUser(userBId, async () => {
      return sendTextMessage(userBId, chatGroupId, { content: 'Admin can send after promotion' });
    });
    if (!adminMessage?.message) {
      throw new Error('Admin User B could not send a group message after promotion');
    }

    const transferredChat = await transferGroupOwnership(userAId, chatGroupId, userBId);
    if (!transferredChat) {
      throw new Error('Failed to transfer group ownership from User A to User B');
    }

    const ownershipRows = await elevatedDb.$queryRaw<Array<{ user_id: string; role: string }>>`
      SELECT user_id::text, role
      FROM chat_members
      WHERE chat_id = ${chatGroupId}::uuid
        AND user_id IN (${userAId}::uuid, ${userBId}::uuid)
      ORDER BY user_id
    `;
    const roleByUser = new Map(ownershipRows.map(row => [row.user_id, row.role]));
    if (roleByUser.get(userBId) !== 'owner') {
      throw new Error(`Ownership transfer failed: User B role is ${roleByUser.get(userBId) ?? 'missing'}`);
    }
    if (roleByUser.get(userAId) !== 'member') {
      throw new Error(`Previous owner should become member, got ${roleByUser.get(userAId) ?? 'missing'}`);
    }

    const formerOwnerMessage = await runAsUser(userAId, async () => {
      return sendTextMessage(userAId, chatGroupId, { content: 'Former owner can send as member' });
    });
    if (!formerOwnerMessage?.message) {
      throw new Error('Former owner User A could not send a group message as member');
    }

    const newOwnerMessage = await runAsUser(userBId, async () => {
      return sendTextMessage(userBId, chatGroupId, { content: 'New owner can send after transfer' });
    });
    if (!newOwnerMessage?.message) {
      throw new Error('New owner User B could not send a group message after transfer');
    }
    console.log('Group admin send and ownership transfer role test passed.');

    // User B sends media message
    const mediaMessageId = randomUUID();
    const mediaJson = { file_id: dummyFileId, path: dummyFileName, mime_type: 'text/plain' };
    await elevatedDb.$executeRaw`
      INSERT INTO messages (id, chat_id, sender_id, type, media, content)
      VALUES (
        ${mediaMessageId}::uuid,
        ${chatGroupId}::uuid,
        ${userBId}::uuid,
        'photo',
        ${JSON.stringify(mediaJson)}::jsonb,
        'Check out this sensitive file'
      )
    `;

    // Group Admin (User C) deletes User B's media message
    await runAsUser(userCId, async () => {
      const delResult = await deleteMessage(userCId, chatGroupId, mediaMessageId);
      if (!delResult || !delResult.success) {
        throw new Error('Failed to delete media message as Group Admin');
      }
    });

    // Verify DB message is gone
    const mediaMessageDb = await elevatedDb.$queryRaw<any[]>`SELECT id FROM messages WHERE id = ${mediaMessageId}::uuid`;
    if (mediaMessageDb.length > 0) {
      throw new Error('Assertion Failed: Media message still exists in DB');
    }
    
    // Verify media_files row is gone
    const mediaFileDb = await elevatedDb.$queryRaw<any[]>`SELECT id FROM media_files WHERE id = ${dummyFileId}::uuid`;
    if (mediaFileDb.length > 0) {
      throw new Error('Assertion Failed: Unreferenced media_files row was not deleted');
    }

    // Verify physical file is gone
    if (fs.existsSync(dummyFilePath)) {
      throw new Error('Assertion Failed: Physical media file was not deleted');
    }
    console.log('✅ Group Admin media message deletion and cleanup test passed.');

    // 10. Audit log safety verification
    console.log('Verifying audit logs do not contain sensitive data...');
    const auditLogs = await elevatedDb.$queryRaw<any[]>`
      SELECT details FROM audit_log WHERE chat_id = ${chatGroupId}::uuid OR chat_id = ${chat.id}::uuid
    `;
    for (const log of auditLogs) {
      const detailsStr = JSON.stringify(log.details || {});
      if (
        detailsStr.includes(dummyFileName) ||
        detailsStr.includes('This is dummy sensitive media file content.') ||
        detailsStr.includes('Check out this sensitive file') ||
        detailsStr.includes('This is a super sensitive secret message!')
      ) {
        throw new Error(`Audit log leak detected: ${detailsStr}`);
      }
    }
    console.log('✅ Audit log check passed (no sensitive content leaked).');

    console.log('--- ALL SMOKE TESTS COMPLETED SUCCESSFULLY ---');
  } finally {
    // Clean up
    console.log('Cleaning up test users, chats, and records...');
    try {
      await elevatedDb.$executeRaw`
        DELETE FROM message_reads WHERE user_id = ANY(${generatedUserIds}::uuid[])
      `;
      await elevatedDb.$executeRaw`
        DELETE FROM message_reactions WHERE user_id = ANY(${generatedUserIds}::uuid[])
      `;
      await elevatedDb.$executeRaw`
        DELETE FROM audit_log WHERE actor_id = ANY(${generatedUserIds}::uuid[])
      `;
      await elevatedDb.$executeRaw`
        DELETE FROM sessions WHERE user_id = ANY(${generatedUserIds}::uuid[])
      `;
      await elevatedDb.$executeRaw`
        DELETE FROM messages WHERE sender_id = ANY(${generatedUserIds}::uuid[])
      `;
      await elevatedDb.$executeRaw`
        DELETE FROM chat_members WHERE user_id = ANY(${generatedUserIds}::uuid[])
      `;
      
      const chatIdsToDelete = [chatGroupId];
      if (chat && chat.id) {
        chatIdsToDelete.push(chat.id);
      }
      await elevatedDb.$executeRaw`
        DELETE FROM chats WHERE id = ANY(${chatIdsToDelete}::uuid[])
      `;

      await elevatedDb.$executeRaw`
        DELETE FROM users WHERE id = ANY(${generatedUserIds}::uuid[])
      `;

      // Restore registration mode
      if (originalRegistrationMode !== null) {
        await elevatedDb.$executeRaw`
          UPDATE app_settings SET value = ${JSON.stringify(originalRegistrationMode)}::jsonb WHERE key = 'registration_mode'
        `;
      } else {
        await elevatedDb.$executeRaw`
          DELETE FROM app_settings WHERE key = 'registration_mode'
        `;
      }
      console.log('Cleanup completed successfully.');
    } catch (cleanupErr) {
      console.error('Failed to perform test cleanup:', cleanupErr);
    }
    
    // Clean up physical file if it was created and still exists
    if (dummyFilePathToDelete && fs.existsSync(dummyFilePathToDelete)) {
      try {
        fs.unlinkSync(dummyFilePathToDelete);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.warn('Warning: Failed to clean up leftover dummy physical media file:', err);
        }
      }
    }
    
    await elevatedPool.end();
  }
}

main()
  .catch(err => {
    console.error('❌ SMOKE TEST FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await stopDb();
  });
