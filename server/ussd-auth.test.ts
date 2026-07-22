import {createHmac} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {isAuthenticUssdCallback} from './ussd-auth.js';

const validInput = {
  suppliedToken: 'a'.repeat(64),
  expectedToken: 'a'.repeat(64),
  suppliedServiceCode: '*384*1234#',
  expectedServiceCode: '*384*1234#',
  sourceIp: '203.0.113.10',
  allowedIps: [] as string[],
  requireNetworkProof: false,
};

describe('isAuthenticUssdCallback', () => {
  it('accepts the configured token and service code', () => {
    expect(isAuthenticUssdCallback(validInput)).toBe(true);
  });

  it('rejects a missing or incorrect token', () => {
    expect(isAuthenticUssdCallback({...validInput, suppliedToken: ''})).toBe(false);
    expect(isAuthenticUssdCallback({...validInput, suppliedToken: 'b'.repeat(64)})).toBe(false);
  });

  it('rejects an unexpected service code', () => {
    expect(isAuthenticUssdCallback({...validInput, suppliedServiceCode: '*123#'})).toBe(false);
  });

  it('enforces configured exact source IPs and normalizes mapped IPv4 addresses', () => {
    const allowedIps = ['203.0.113.10'];
    expect(isAuthenticUssdCallback({...validInput, allowedIps, requireNetworkProof: true})).toBe(true);
    expect(isAuthenticUssdCallback({...validInput, allowedIps, requireNetworkProof: true, sourceIp: '::ffff:203.0.113.10'})).toBe(true);
    expect(isAuthenticUssdCallback({...validInput, allowedIps, requireNetworkProof: true, sourceIp: '203.0.113.11'})).toBe(false);
  });

  it('accepts a fresh trusted-edge HMAC and rejects replayed timestamps', () => {
    const now = 1_800_000_000_000;
    const timestamp = String(now / 1_000);
    const rawBody = Buffer.from('sessionId=abc&serviceCode=*384*1234%23');
    const edgeHmacSecret = 'edge-secret-'.padEnd(40, 'x');
    const edgeSignature = createHmac('sha256', edgeHmacSecret)
      .update(timestamp).update('.').update(rawBody).digest('hex');
    const edgeInput = {
      ...validInput,
      requireNetworkProof: true,
      edgeHmacSecret,
      edgeTimestamp: timestamp,
      edgeSignature: `sha256=${edgeSignature}`,
      rawBody,
      now,
    };
    expect(isAuthenticUssdCallback(edgeInput)).toBe(true);
    expect(isAuthenticUssdCallback({...edgeInput, now: now + 61_000})).toBe(false);
  });
});
