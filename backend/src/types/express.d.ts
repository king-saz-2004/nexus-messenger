import type { JwtPayload } from '../utils/tokens.js';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      requestId?: string;
    }
  }
}

export {};
