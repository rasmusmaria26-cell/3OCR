export type UserRole = 'OPERATOR' | 'AUDITOR' | 'ADMIN';

export interface AuthUser {
  id: string;
  name: string;
  role: UserRole;
}

export interface AuthOptions {
  authEnabled?: boolean;
  adminApiKey?: string;
  operatorApiKey?: string;
  auditorApiKey?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

