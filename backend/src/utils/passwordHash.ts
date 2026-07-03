const BCRYPT_HASH_REGEX = /^\$2[aby]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$/;

export const isBcryptHash = (value: unknown): value is string => {
  return typeof value === 'string' && BCRYPT_HASH_REGEX.test(value);
};

export const assertBcryptHash = (value: unknown, context: string) => {
  if (!isBcryptHash(value)) {
    throw new Error(`Invalid bcrypt hash in ${context}`);
  }
};

