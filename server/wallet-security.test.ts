import type {Policy, Wallet} from '@privy-io/node';
import {describe, expect, it} from 'vitest';
import {assertRestrictedSolanaTransferPolicy, assertWalletSecurityConfiguration, walletRequiresSignerMigration} from './wallet-security.js';

const expected = {walletId: 'wallet-1', walletAddress: 'SolanaAddress', privyUserId: 'did:privy:user-1', ownerId: 'owner-quorum-1'};
const controls = {signerId: 'quorum-1', policyId: 'policy-1'};
const secureWallet = {
  id: expected.walletId,
  address: expected.walletAddress,
  chain_type: 'solana',
  owner_id: expected.ownerId,
  additional_signers: [{signer_id: controls.signerId, override_policy_ids: [controls.policyId]}],
  policy_ids: [], created_at: 0, exported_at: null, imported_at: null,
} as Wallet;

describe('Privy wallet attestation', () => {
  it('accepts exactly one expected signer with exactly one policy', () => {
    expect(assertWalletSecurityConfiguration(secureWallet, expected, controls)).toBe(secureWallet);
    expect(walletRequiresSignerMigration(secureWallet, expected, controls)).toBe(false);
  });

  it('detects an unrestricted delegated signer', () => {
    const wallet = {...secureWallet, additional_signers: [{signer_id: controls.signerId, override_policy_ids: []}]} as Wallet;
    expect(() => assertWalletSecurityConfiguration(wallet, expected, controls)).toThrow(/required policy/);
    expect(walletRequiresSignerMigration(wallet, expected, controls)).toBe(true);
  });

  it('detects wrong owners, signers, policies, IDs, and addresses', () => {
    expect(() => assertWalletSecurityConfiguration({...secureWallet, owner_id: 'attacker'} as Wallet, expected, controls)).toThrow(/owner/);
    expect(() => assertWalletSecurityConfiguration({...secureWallet, additional_signers: []} as Wallet, expected, controls)).toThrow(/signer/);
    expect(() => assertWalletSecurityConfiguration(secureWallet, {...expected, walletId: 'wrong'}, controls)).toThrow(/ID/);
    expect(() => assertWalletSecurityConfiguration(secureWallet, {...expected, walletAddress: 'wrong'}, controls)).toThrow(/address/);
  });
});

describe('Privy Solana policy attestation', () => {
  const policy = {
    id: 'policy-1', chain_type: 'solana', version: '1.0', name: 'Rove transfers', owner_id: 'owner', created_at: 0,
    rules: [{
      id: 'rule-1', name: 'Restricted transfers', action: 'ALLOW', method: 'signAndSendTransaction',
      conditions: [
        {field_source: 'solana_system_program_instruction', field: 'instructionName', operator: 'eq', value: 'Transfer'},
        {field_source: 'solana_system_program_instruction', field: 'Transfer.lamports', operator: 'lte', value: '1000000000'},
      ],
    }],
  } as Policy;

  it('accepts one capped System Program transfer rule', () => {
    expect(assertRestrictedSolanaTransferPolicy(policy, '1')).toBe(policy);
  });

  it('rejects wildcard, uncapped, extra-rule, and excessive policies', () => {
    expect(() => assertRestrictedSolanaTransferPolicy({...policy, rules: [{...policy.rules[0], method: '*'}]} as Policy, '1')).toThrow();
    expect(() => assertRestrictedSolanaTransferPolicy({...policy, rules: [{...policy.rules[0], conditions: []}]} as Policy, '1')).toThrow();
    expect(() => assertRestrictedSolanaTransferPolicy({...policy, rules: [...policy.rules, policy.rules[0]]} as Policy, '1')).toThrow();
    expect(() => assertRestrictedSolanaTransferPolicy(policy, '0.5')).toThrow(/exceeds/);
  });
});
