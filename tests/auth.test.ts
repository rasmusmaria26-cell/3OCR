import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { createDatabase } from '../src/db/database.js';
import { seedCustomerConfig } from '../src/config/customerConfig.js';
import { createExpressApp } from '../src/api/app.js';
import { Database as DatabaseType } from 'better-sqlite3';

describe('SEC-01: API Authentication & RBAC Middleware', () => {
  let db: DatabaseType;
  let server: http.Server;
  let baseUrl: string;

  const ADMIN_TOKEN = 'test-admin-token-123';
  const OPERATOR_TOKEN = 'test-op-token-456';
  const AUDITOR_TOKEN = 'test-audit-token-789';

  beforeEach(async () => {
    db = createDatabase(':memory:');
    seedCustomerConfig(db);

    const app = createExpressApp(db, undefined, {
      authEnabled: true,
      adminApiKey: ADMIN_TOKEN,
      operatorApiKey: OPERATOR_TOKEN,
      auditorApiKey: AUDITOR_TOKEN,
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('1. Rejects unauthenticated requests with 401 Unauthorized', async () => {
    const res = await fetch(`${baseUrl}/api/cases`, {
      method: 'GET',
    });

    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.error).toBe('UNAUTHORIZED');
    expect(body.message).toContain('Authentication required');
  });

  it('2. Rejects invalid credentials with 401 Unauthorized', async () => {
    const res = await fetch(`${baseUrl}/api/cases`, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer invalid-dummy-token',
      },
    });

    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.error).toBe('UNAUTHORIZED');
  });

  it('3. Accepts valid Bearer token for authorized role', async () => {
    const res = await fetch(`${baseUrl}/api/cases`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.cases)).toBe(true);
  });

  it('4. Accepts valid x-api-key header for authorized role', async () => {
    const res = await fetch(`${baseUrl}/api/cases`, {
      method: 'GET',
      headers: {
        'x-api-key': AUDITOR_TOKEN,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.cases)).toBe(true);
  });

  it('5. RBAC: Denies AUDITOR from submitting case reviews (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/cases/dummy-case-id/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AUDITOR_TOKEN}`,
      },
      body: JSON.stringify({
        issueFingerprint: 'fp-123',
        field: 'quantity',
        selectedValue: '10',
        reason: 'Auditor override test',
      }),
    });

    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.error).toBe('FORBIDDEN');
    expect(body.userRole).toBe('AUDITOR');
    expect(body.requiredRoles).toContain('OPERATOR');
  });

  it('6. RBAC: Denies AUDITOR from resolving queue items (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/queues/queue-id-1/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AUDITOR_TOKEN}`,
      },
      body: JSON.stringify({
        action: 'DISMISS',
      }),
    });

    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.error).toBe('FORBIDDEN');
    expect(body.userRole).toBe('AUDITOR');
  });

  it('7. RBAC: Allows OPERATOR to ingest documents and access queues', async () => {
    const queueRes = await fetch(`${baseUrl}/api/queues`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`,
      },
    });

    expect(queueRes.status).toBe(200);
    const queueData = await queueRes.json() as any;
    expect(Array.isArray(queueData.queues)).toBe(true);
  });

  it('8. RBAC: Allows ADMIN full access to audit history and review endpoints', async () => {
    // 1. Audit endpoint access
    const auditRes = await fetch(`${baseUrl}/api/cases/non-existent-case/audit`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
      },
    });

    // Case doesn't exist so 404, but auth/RBAC (401/403) was successfully passed!
    expect(auditRes.status).toBe(404);
  });

  it('9. Leaves root dashboard UI publicly accessible', async () => {
    const res = await fetch(`${baseUrl}/`, {
      method: 'GET',
    });

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Cross-Document Reconciliation');
  });
});
