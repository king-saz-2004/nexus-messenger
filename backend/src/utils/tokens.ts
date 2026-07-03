import { createHash } from 'node:crypto';
import jwt, { type Secret, type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';

type SessionClaims = {
  sub: string;
  sid: string;
  role: string;
  isRoot: boolean;
};

type BaseVerifiedPayload = SessionClaims & {
  iat: number;
  exp: number;
};

export type AccessTokenPayload = BaseVerifiedPayload & { typ: 'access' };
export type RefreshTokenPayload = BaseVerifiedPayload & { typ: 'refresh' };
export type JwtPayload = AccessTokenPayload;

const signToken = (payload: SessionClaims, typ: 'access' | 'refresh', secret: string, expiresIn: string) => {
  const body = { ...payload, typ };
  return jwt.sign(body, secret as Secret, { expiresIn } as SignOptions);
};

const verifyTypedToken = (token: string, secret: string, expectedTyp: 'access' | 'refresh') => {
  const decoded = jwt.verify(token, secret) as jwt.JwtPayload | string;
  if (!decoded || typeof decoded === 'string') {
    throw new Error('Invalid token');
  }

  if (decoded.typ !== expectedTyp) {
    throw new Error('Invalid token type');
  }

  if (
    typeof decoded.sub !== 'string' ||
    typeof decoded.sid !== 'string' ||
    typeof decoded.role !== 'string' ||
    typeof decoded.isRoot !== 'boolean' ||
    typeof decoded.exp !== 'number' ||
    typeof decoded.iat !== 'number'
  ) {
    throw new Error('Invalid token payload');
  }

  return decoded as BaseVerifiedPayload & { typ: typeof expectedTyp };
};

export const signAccessToken = (payload: SessionClaims) => {
  return signToken(payload, 'access', env.jwtSecret, env.accessTokenTtl);
};

export const signRefreshToken = (payload: SessionClaims) => {
  return signToken(payload, 'refresh', env.jwtRefreshSecret, env.refreshTokenTtl);
};

export const verifyAccessToken = (token: string) => {
  return verifyTypedToken(token, env.jwtSecret, 'access');
};

export const verifyRefreshToken = (token: string) => {
  return verifyTypedToken(token, env.jwtRefreshSecret, 'refresh');
};

export const hashToken = (token: string) => {
  return createHash('sha256').update(token).digest('hex');
};
