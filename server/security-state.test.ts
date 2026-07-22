import {describe, expect, it} from 'vitest';
import {authorizeSessionAnswer, hashUssdHistory, transactionBindingMatches} from './security-state.js';

const now = 1_800_000_000_000;
const session = {
  provider_session_id: 'session-1',
  phone_number: '+2348012345678',
  expected_segments: 1,
  history_hash: hashUssdHistory('2'),
  expires_at: new Date(now + 60_000).toISOString(),
  consumed_at: null,
};

describe('authoritative USSD sessions', () => {
  it('accepts only the expected next answer', () => {
    expect(authorizeSessionAnswer(session, {
      providerSessionId: 'session-1', phoneNumber: session.phone_number, text: '2*+2348099999999', now,
    })).toBe('+2348099999999');
  });

  it('rejects expired, consumed, mismatched, replayed, and skipped sessions', () => {
    const input = {providerSessionId: 'session-1', phoneNumber: session.phone_number, text: '2*answer', now};
    expect(authorizeSessionAnswer({...session, expires_at: new Date(now).toISOString()}, input)).toBeNull();
    expect(authorizeSessionAnswer({...session, consumed_at: new Date(now).toISOString()}, input)).toBeNull();
    expect(authorizeSessionAnswer(session, {...input, phoneNumber: '+2348011111111'})).toBeNull();
    expect(authorizeSessionAnswer(session, {...input, providerSessionId: 'attacker-session'})).toBeNull();
    expect(authorizeSessionAnswer(session, {...input, text: '2*recipient*amount'})).toBeNull();
    expect(authorizeSessionAnswer(session, {...input, text: '1*answer'})).toBeNull();
  });
});

it('rejects transaction authorization replay and binding changes', () => {
  const authorization = {sessionId: 's1', senderId: 'a', recipientId: 'b', amountLamports: 10n, expiresAt: now + 1_000, consumed: false};
  const request = {sessionId: 's1', senderId: 'a', recipientId: 'b', amountLamports: 10n, now};
  expect(transactionBindingMatches({authorization, request})).toBe(true);
  expect(transactionBindingMatches({authorization: {...authorization, consumed: true}, request})).toBe(false);
  expect(transactionBindingMatches({authorization, request: {...request, amountLamports: 11n}})).toBe(false);
  expect(transactionBindingMatches({authorization, request: {...request, now: now + 2_000}})).toBe(false);
});
