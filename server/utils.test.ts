import {describe, expect, it} from 'vitest';
import {formatSolBalance, formatWalletAddress, normalizePhoneNumber, parseSolAmount, redactSensitive, textResponse, validatePhoneCountry} from './utils.js';

describe('normalizePhoneNumber', () => {
  it('normalizes safe international formatting', () => {
    expect(normalizePhoneNumber('+234 (801) 234-5678')).toBe('+2348012345678');
    expect(normalizePhoneNumber('254712345678')).toBe('+254712345678');
  });

  it('rejects local, short, and malformed numbers', () => {
    expect(normalizePhoneNumber('08012345678')).toBeNull();
    expect(normalizePhoneNumber('+12abc')).toBeNull();
  });
});

it('enforces configured phone countries', () => {
  expect(validatePhoneCountry('+2348012345678', ['NG'])?.countryCode).toBe('NG');
  expect(validatePhoneCountry('+254712345678', ['NG'])).toBeNull();
});

describe('parseSolAmount', () => {
  it('converts decimal SOL to exact integer lamports', () => {
    expect(parseSolAmount('0.000000001')).toBe(1n);
    expect(parseSolAmount('1.25')).toBe(1_250_000_000n);
  });

  it('enforces a deployment-specific transfer ceiling', () => {
    expect(parseSolAmount('1.01', '1')).toBeNull();
    expect(parseSolAmount('1', '1')).toBe(1_000_000_000n);
  });

  it('rejects zero, excess precision, negative values, and the safety cap', () => {
    expect(parseSolAmount('0')).toBeNull();
    expect(parseSolAmount('1.0000000001')).toBeNull();
    expect(parseSolAmount('-1')).toBeNull();
    expect(parseSolAmount('1001')).toBeNull();
  });
});

it('redacts authentication and key material from errors', () => {
  expect(redactSensitive('Bearer abc.def pin=123456 at_token=secret')).toBe('Bearer [REDACTED] pin=[REDACTED] at_token=[REDACTED]');
});

it('formats balances and USSD prefixes', () => {
  expect(formatSolBalance(1_250_000_000)).toBe('1.25');
  expect(textResponse('CON', 'Continue')).toBe('CON Continue');
});

it('shortens wallet addresses for narrow USSD screens', () => {
  expect(formatWalletAddress('7YWHMfk9JZe0LMvHL5vRqywaHgQuAW2vTxx2NRwqkL9a')).toBe('7YWHMf...kL9a');
  expect(formatWalletAddress('short-wallet')).toBe('short-wallet');
});
