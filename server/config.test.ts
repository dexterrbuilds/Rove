import {describe, expect, it} from 'vitest';
import {requireSinglePrivyIdentifier, solanaCaip2MatchesGenesisHash} from './config.js';

describe('Privy policy configuration', () => {
  it('requires exactly one signer and policy identifier', () => {
    expect(requireSinglePrivyIdentifier('policy-1', 'policy')).toBe('policy-1');
    expect(() => requireSinglePrivyIdentifier('', 'policy')).toThrow(/exactly one/);
    expect(() => requireSinglePrivyIdentifier('policy-1,policy-2', 'policy')).toThrow(/exactly one/);
  });
});

describe('Solana network configuration', () => {
  it('matches a CAIP-2 reference to the full RPC genesis hash', () => {
    expect(solanaCaip2MatchesGenesisHash(
      'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
      'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
    )).toBe(true);
  });

  it('rejects a CAIP-2 reference for another Solana cluster', () => {
    expect(solanaCaip2MatchesGenesisHash(
      'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
    )).toBe(false);
  });
});
