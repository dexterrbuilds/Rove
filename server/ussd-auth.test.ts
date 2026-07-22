import {describe, expect, it} from 'vitest';
import {isAuthenticUssdCallback} from './ussd-auth.js';

const validInput = {
  suppliedToken: 'a'.repeat(64),
  expectedToken: 'a'.repeat(64),
  suppliedServiceCode: '*384*1234#',
  expectedServiceCode: '*384*1234#',
  sourceIp: '203.0.113.10',
  allowedIps: [] as string[],
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
    expect(isAuthenticUssdCallback({...validInput, allowedIps})).toBe(true);
    expect(isAuthenticUssdCallback({...validInput, allowedIps, sourceIp: '::ffff:203.0.113.10'})).toBe(true);
    expect(isAuthenticUssdCallback({...validInput, allowedIps, sourceIp: '203.0.113.11'})).toBe(false);
  });
});
