import {describe, expect, it} from 'vitest';
import {requireSinglePrivyIdentifier} from './config.js';

describe('Privy policy configuration', () => {
  it('requires exactly one signer and policy identifier', () => {
    expect(requireSinglePrivyIdentifier('policy-1', 'policy')).toBe('policy-1');
    expect(() => requireSinglePrivyIdentifier('', 'policy')).toThrow(/exactly one/);
    expect(() => requireSinglePrivyIdentifier('policy-1,policy-2', 'policy')).toThrow(/exactly one/);
  });
});
