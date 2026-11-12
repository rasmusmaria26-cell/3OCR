import { Request, Response, NextFunction } from 'express';
import { TokenRegistry } from './tokenRegistry.js';
import { AuthOptions, UserRole, AuthUser } from './types.js';

export function createAuthMiddleware(options?: AuthOptions) {
  const isAuthEnabled = options?.authEnabled ?? (process.env.ENABLE_AUTH === 'true');
  const registry = new TokenRegistry(options);

  function authenticate(req: Request, res: Response, next: NextFunction): void {
    if (!isAuthEnabled) {
      // Dev / Test bypass: inject default operator user if not present
      if (!req.user) {
        req.user = {
          id: 'usr-default-dev',
          name: 'Developer Bypass',
          role: 'ADMIN',
        };
      }
      next();
      return;
    }

    let token: string | null = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.headers['x-api-key']) {
      const apiKeyHeader = req.headers['x-api-key'];
      token = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
    } else if (typeof req.query.api_key === 'string') {
      token = req.query.api_key;
    }

    if (!token) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required. Please provide a valid Bearer token in Authorization header or x-api-key.',
      });
      return;
    }

    const user = registry.resolveToken(token);
    if (!user) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Invalid or expired authentication credentials.',
      });
      return;
    }

    req.user = user;
    next();
  }

  function requireRole(...allowedRoles: UserRole[]) {
    return (req: Request, res: Response, next: NextFunction): void => {
      if (!isAuthEnabled) {
        next();
        return;
      }

      if (!req.user) {
        res.status(401).json({
          error: 'UNAUTHORIZED',
          message: 'Authentication required prior to authorization check.',
        });
        return;
      }

      if (!allowedRoles.includes(req.user.role)) {
        res.status(403).json({
          error: 'FORBIDDEN',
          message: `Insufficient permissions. Role '${req.user.role}' is not authorized. Required: [${allowedRoles.join(', ')}].`,
          userRole: req.user.role,
          requiredRoles: allowedRoles,
        });
        return;
      }

      next();
    };
  }

  return {
    authenticate,
    requireRole,
    registry,
    isAuthEnabled,
  };
}

