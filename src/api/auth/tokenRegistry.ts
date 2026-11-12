import { AuthUser, UserRole, AuthOptions } from './types.js';

export class TokenRegistry {
  private tokenMap: Map<string, AuthUser> = new Map();

  constructor(options?: AuthOptions) {
    const adminKey = options?.adminApiKey || process.env.ADMIN_API_KEY || '3ocr-admin-secret-key';
    const operatorKey = options?.operatorApiKey || process.env.OPERATOR_API_KEY || '3ocr-operator-secret-key';
    const auditorKey = options?.auditorApiKey || process.env.AUDITOR_API_KEY || '3ocr-auditor-secret-key';

    this.tokenMap.set(adminKey, {
      id: 'usr-admin-01',
      name: 'System Administrator',
      role: 'ADMIN',
    });

    this.tokenMap.set(operatorKey, {
      id: 'usr-op-01',
      name: 'Reconciliation Operator',
      role: 'OPERATOR',
    });

    this.tokenMap.set(auditorKey, {
      id: 'usr-audit-01',
      name: 'Compliance Auditor',
      role: 'AUDITOR',
    });
  }

  public registerToken(token: string, user: AuthUser): void {
    this.tokenMap.set(token, user);
  }

  public resolveToken(rawToken: string): AuthUser | null {
    if (!rawToken) return null;
    return this.tokenMap.get(rawToken.trim()) || null;
  }
}

