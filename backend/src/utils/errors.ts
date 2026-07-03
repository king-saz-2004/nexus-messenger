export const createHttpError = (status: number, message: string) => {
  const err = new Error(message) as Error & { status?: number };
  err.status = status;
  return err;
};

export const getPgErrorCode = (error: unknown): string | null => {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
};

export const getPgConstraint = (error: unknown): string | null => {
  if (typeof error !== 'object' || error === null) return null;
  const constraint = (error as { constraint?: unknown }).constraint;
  return typeof constraint === 'string' ? constraint : null;
};

export const isUniqueViolation = (error: unknown) => getPgErrorCode(error) === '23505';
export const isForeignKeyViolation = (error: unknown) => getPgErrorCode(error) === '23503';
export const isCheckViolation = (error: unknown) => getPgErrorCode(error) === '23514';
