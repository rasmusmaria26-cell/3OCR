import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabase } from '../src/db/database.js';
import { Database as DatabaseType } from 'better-sqlite3';
import { resolveSenderIdentity } from '../src/core/linking/senderResolver.js';
import { senderMappingRepo } from '../src/db/repositories/index.js';

describe('Sender Mapping & SPF/DKIM Verification (senderResolver)', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = createDatabase(':memory:');

    // Create test customer configs
    db.prepare(`
      INSERT INTO customer_config (customer_id, default_currency, default_uom, separators_insignificant, config_version, created_at, updated_at)
      VALUES 
        ('CUST-ACME', 'USD', 'EA', 1, '1.0', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z'),
        ('CUST-BETA', 'USD', 'EA', 1, '1.0', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();

    // Create mappings: exact and domain
    senderMappingRepo.insert(db, {
      id: 'sm-exact',
      senderPattern: 'orders@acmepartner.com',
      customerId: 'CUST-ACME',
      isDomain: false,
    });

    senderMappingRepo.insert(db, {
      id: 'sm-domain',
      senderPattern: '@acme.com',
      customerId: 'CUST-ACME',
      isDomain: true,
    });
  });

  it('resolves exact match before domain fallback', () => {
    // Add domain @acmepartner.com mapping to CUST-BETA
    senderMappingRepo.insert(db, {
      id: 'sm-partner-domain',
      senderPattern: '@acmepartner.com',
      customerId: 'CUST-BETA',
      isDomain: true,
    });

    const result = resolveSenderIdentity({
      db,
      senderEmail: 'orders@acmepartner.com',
      spfStatus: 'PASS',
      dkimStatus: 'PASS',
      payloadCustomerId: 'CUST-ACME',
    });

    expect(result.mappedCustomerId).toBe('CUST-ACME');
    expect(result.matchType).toBe('EXACT');
    expect(result.isVerifiedSender).toBe(true);
    expect(result.hasIdentityConflict).toBe(false);
  });

  it('resolves domain fallback when exact match is not found', () => {
    const result = resolveSenderIdentity({
      db,
      senderEmail: 'purchasing@acme.com',
      spfStatus: 'PASS',
      dkimStatus: 'PASS',
      payloadCustomerId: 'CUST-ACME',
    });

    expect(result.mappedCustomerId).toBe('CUST-ACME');
    expect(result.matchType).toBe('DOMAIN');
    expect(result.isVerifiedSender).toBe(true);
    expect(result.hasIdentityConflict).toBe(false);
  });

  it('marks sender as unverified if SPF fails or softfails', () => {
    const failResult = resolveSenderIdentity({
      db,
      senderEmail: 'purchasing@acme.com',
      spfStatus: 'FAIL',
      dkimStatus: 'PASS',
      payloadCustomerId: 'CUST-ACME',
    });
    expect(failResult.isVerifiedSender).toBe(false);
    expect(failResult.unverifiedReason).toMatch(/SPF failed \(FAIL\)/);

    const softfailResult = resolveSenderIdentity({
      db,
      senderEmail: 'purchasing@acme.com',
      spfStatus: 'SOFTFAIL',
      dkimStatus: 'PASS',
      payloadCustomerId: 'CUST-ACME',
    });
    expect(softfailResult.isVerifiedSender).toBe(false);
    expect(softfailResult.unverifiedReason).toMatch(/SPF failed \(SOFTFAIL\)/);
  });

  it('marks sender as unverified if DKIM fails', () => {
    const result = resolveSenderIdentity({
      db,
      senderEmail: 'purchasing@acme.com',
      spfStatus: 'PASS',
      dkimStatus: 'FAIL',
      payloadCustomerId: 'CUST-ACME',
    });
    expect(result.isVerifiedSender).toBe(false);
    expect(result.unverifiedReason).toMatch(/DKIM failed \(FAIL\)/);
  });

  it('routes to IDENTITY_CONFLICT queue if document payload customer differs from mapped sender customer', () => {
    const result = resolveSenderIdentity({
      db,
      senderEmail: 'purchasing@acme.com',
      spfStatus: 'PASS',
      dkimStatus: 'PASS',
      payloadCustomerId: 'CUST-BETA', // payload claims BETA, but email domain maps to ACME
    });

    expect(result.mappedCustomerId).toBe('CUST-ACME');
    expect(result.hasIdentityConflict).toBe(true);
    expect(result.routeToQueue).toBe('IDENTITY_CONFLICT');
    expect(result.identityConflictReason).toContain('differs from mapped sender customer');
  });

  it('routes unverified sender with conflicting or unverified customer to IDENTITY_CONFLICT', () => {
    const result = resolveSenderIdentity({
      db,
      senderEmail: 'fake@acme.com',
      spfStatus: 'FAIL',
      dkimStatus: 'FAIL',
      payloadCustomerId: 'CUST-BETA',
    });

    expect(result.isVerifiedSender).toBe(false);
    expect(result.hasIdentityConflict).toBe(true);
    expect(result.routeToQueue).toBe('IDENTITY_CONFLICT');
  });

  it('returns no conflict when sender is unmapped but payload customer exists without contradiction', () => {
    const result = resolveSenderIdentity({
      db,
      senderEmail: 'someone@external-unknown.com',
      spfStatus: 'PASS',
      dkimStatus: 'PASS',
      payloadCustomerId: 'CUST-ACME',
    });

    expect(result.mappedCustomerId).toBeNull();
    expect(result.hasIdentityConflict).toBe(false);
    expect(result.routeToQueue).toBeNull();
  });
});
