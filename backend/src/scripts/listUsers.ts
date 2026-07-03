import { connectDb, stopDb } from '../config/db.js';
import { runForAuthLookup } from '../config/dbContext.js';

const main = async () => {
  await connectDb();
  try {
    const users = await runForAuthLookup(tx =>
      tx.$queryRaw`
        SELECT id, username, first_name, last_name, is_root, is_active, is_deleted
        FROM users
      `
    );
    console.log(JSON.stringify(users, null, 2));
  } finally {
    await stopDb();
  }
};

void main().catch(async error => {
  console.error(error);
  await stopDb().catch(() => {});
  process.exit(1);
});
