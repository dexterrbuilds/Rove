import {describe, expect, it} from 'vitest';
import {
  isDefinitiveTransferFailure,
  privyFailureCategory,
  TransferNotSubmittedError,
} from './privy-transaction-reconciliation.js';

describe('Privy transfer failure classification', () => {
  it('marks pre-submission and clear API rejections as definitive', () => {
    expect(isDefinitiveTransferFailure(new TransferNotSubmittedError('solana_rpc_unavailable'))).toBe(true);
    expect(isDefinitiveTransferFailure({status: 403})).toBe(true);
    expect(privyFailureCategory({status: 403})).toBe('privy_rejected_403');
  });

  it('keeps timeouts, rate limits, and server failures uncertain', () => {
    expect(isDefinitiveTransferFailure(new Error('Connection timed out'))).toBe(false);
    expect(isDefinitiveTransferFailure({status: 429})).toBe(false);
    expect(isDefinitiveTransferFailure({status: 503})).toBe(false);
    expect(privyFailureCategory({status: 429})).toBe('privy_rate_limited');
    expect(privyFailureCategory({status: 503})).toBe('privy_unavailable');
  });
});
