import type { NextFunction, Request, Response } from 'express';
import type { DeviceStore } from '../core/store.js';
import type { ApiPrincipal, TokenSigner } from '../core/tokens.js';

declare module 'express-serve-static-core' {
  interface Request {
    principal?: ApiPrincipal;
  }
}

/** Express middleware: require a valid, non-revoked bearer token. */
export function requireAuth(signer: TokenSigner, store: DeviceStore, roles: ApiPrincipal['role'][] = ['tv', 'remote']) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const principal = token ? signer.verifyApiToken(token) : null;
    if (!principal || !roles.includes(principal.role) || !isStillValid(principal, store)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    req.principal = principal;
    next();
  };
}

export function isStillValid(p: ApiPrincipal, store: DeviceStore): boolean {
  if (!store.getTv(p.tvId)) return false;
  if (p.role === 'remote') return store.findRemote(p.tvId, p.subject) !== null;
  return p.subject === p.tvId;
}
