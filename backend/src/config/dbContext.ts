import { db } from './db.js';
import type { DbExecutor } from './db.js';
export type { DbExecutor };

type TxHandler<T> = (tx: DbExecutor) => Promise<T>;

const setLocalConfig = async (tx: DbExecutor, key: string, value: string) => {
  await tx.$executeRaw`SELECT set_config(${key}, ${value}, true)`;
};

const runWithContext = async <T>(settings: Array<{ key: string; value: string }>, handler: TxHandler<T>) => {
  return db.$transaction(async tx => {
    for (const setting of settings) {
      await setLocalConfig(tx, setting.key, setting.value);
    }
    return handler(tx);
  });
};

export const runAsUser = async <T>(userId: string, handler: TxHandler<T>) => {
  return runWithContext([{ key: 'app.current_user_id', value: userId }], handler);
};

export const runForAuthLookup = async <T>(handler: TxHandler<T>) => {
  return runWithContext(
    [
      { key: 'app.auth_lookup', value: 'on' },
      { key: 'app.current_user_id', value: '00000000-0000-0000-0000-000000000000' }
    ],
    handler
  );
};

export const runForUserDirectory = async <T>(userId: string, isRoot: boolean, handler: TxHandler<T>) => {
  return runWithContext(
    [
      { key: 'app.current_user_id', value: userId },
      { key: 'app.current_user_is_root', value: isRoot ? 'true' : 'false' },
      { key: 'app.user_directory', value: 'on' }
    ],
    handler
  );
};

export const runForExactUserLookup = async <T>(userId: string, userid: string, isRoot: boolean, handler: TxHandler<T>) => {
  const normalizedUserid = userid.trim().toLowerCase();
  return runWithContext(
    [
      { key: 'app.current_user_id', value: userId },
      { key: 'app.current_user_is_root', value: isRoot ? 'true' : 'false' },
      { key: 'app.user_lookup', value: 'on' },
      { key: 'app.lookup_userid', value: normalizedUserid }
    ],
    handler
  );
};

export const runForRootUserDelete = async <T>(actorUserId: string, targetUserId: string, handler: TxHandler<T>) => {
  return runWithContext(
    [
      { key: 'app.current_user_id', value: actorUserId },
      { key: 'app.current_user_is_root', value: 'true' },
      { key: 'app.root_user_delete', value: 'on' },
      { key: 'app.root_delete_target_user_id', value: targetUserId }
    ],
    handler
  );
};

export const runForRootAdmin = async <T>(actorUserId: string, handler: TxHandler<T>) => {
  return runWithContext(
    [
      { key: 'app.current_user_id', value: actorUserId },
      { key: 'app.current_user_is_root', value: 'true' },
      { key: 'app.root_admin', value: 'on' }
    ],
    handler
  );
};
