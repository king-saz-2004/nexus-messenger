import { db, stopDb } from './config/db.js';
import bcrypt from 'bcrypt';
import { getUserByUsernameWithClient } from './services/authUser.js';
import { runForAuthLookup, runAsUser } from './config/dbContext.js';
import { randomUUID } from 'node:crypto';

async function test() {
  if (process.env.ALLOW_DEV_LOGIN_TEST !== 'true') {
    console.error('ERROR: ALLOW_DEV_LOGIN_TEST is not set to "true". Refusing to run login smoke test.');
    process.exit(1);
  }

  const username = process.env.TEST_USER_USERNAME;
  const password = process.env.TEST_USER_PASSWORD;

  if (!username || !password) {
    console.error('ERROR: TEST_USER_USERNAME or TEST_USER_PASSWORD environment variables are not set.');
    process.exit(1);
  }

  console.log(`Starting login smoke test for user: ${username}...`);
  try {
    const user = await runForAuthLookup(tx => getUserByUsernameWithClient(tx, username));
    console.log("User fetched:", user ? { id: user.id, username: user.username, is_root: user.is_root } : "not found");
    
    if (!user) {
      console.error('ERROR: Test user not found in the database.');
      return;
    }
    
    const passwordOk = await bcrypt.compare(password, user.password_hash);
    console.log("Password verification status:", passwordOk ? "SUCCESS" : "FAILED");
    
    if (!passwordOk) return;
    
    console.log("Attempting session insert...");
    const sessionId = randomUUID();
    
    await runAsUser(user.id, async tx => {
      // 1. Update user status
      await tx.$executeRaw`
        UPDATE users
        SET status = 'online', last_seen = NOW()
        WHERE id = ${user.id}::uuid
      `;
      console.log("User status updated successfully");

      // 2. Insert test session
      await tx.$executeRaw`
        INSERT INTO sessions (
          id,
          user_id,
          token_hash,
          refresh_token_hash,
          device_name,
          device_type,
          ip_address,
          user_agent,
          is_active,
          last_activity,
          expires_at
        )
        VALUES (
          ${sessionId}::uuid,
          ${user.id}::uuid,
          'token_hash_test_example',
          'refresh_hash_test_example',
          'test_device_example',
          'web',
          '127.0.0.1'::inet,
          'test_agent_example',
          true,
          NOW(),
          NOW() + interval '7 days'
        )
      `;
      console.log("Session inserted successfully. Login smoke test complete.");
    });
  } catch (err: any) {
    console.error("Test failed with error:");
    console.error(err);
    if (err.meta) {
      console.error("Error meta:", JSON.stringify(err.meta));
    }
  } finally {
    await stopDb();
  }
}

test();
