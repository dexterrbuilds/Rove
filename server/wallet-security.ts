import type {Policy, Wallet} from '@privy-io/node';

export type WalletIdentity = {
  walletId: string;
  walletAddress: string;
  privyUserId: string;
  ownerId: string;
};

export type WalletControls = {
  signerId: string;
  policyId: string;
};

export function assertWalletSecurityConfiguration(
  wallet: Wallet,
  expected: WalletIdentity,
  controls: WalletControls,
) {
  if (wallet.id !== expected.walletId) throw new Error('Privy wallet ID does not match the registered wallet.');
  if (wallet.address !== expected.walletAddress) throw new Error('Privy wallet address does not match the registered wallet.');
  if (wallet.chain_type !== 'solana') throw new Error('Privy wallet is not a Solana wallet.');
  if (wallet.owner_id !== expected.ownerId) throw new Error('Privy wallet owner quorum does not match the registered wallet.');
  if (wallet.additional_signers.length !== 1) throw new Error('Privy wallet has an unexpected signer configuration.');

  const signer = wallet.additional_signers[0];
  if (signer.signer_id !== controls.signerId) throw new Error('Privy wallet signer does not match the configured signer.');
  if (signer.override_policy_ids?.length !== 1 || signer.override_policy_ids[0] !== controls.policyId) {
    throw new Error('Privy wallet signer is missing the required policy.');
  }
  return wallet;
}

export function walletRequiresSignerMigration(wallet: Wallet, expected: WalletIdentity, controls: WalletControls) {
  try {
    assertWalletSecurityConfiguration(wallet, expected, controls);
    return false;
  } catch {
    return true;
  }
}

export function assertRestrictedSolanaTransferPolicy(policy: Policy, maximumSol: string) {
  if (policy.chain_type !== 'solana' || policy.rules.length !== 1) {
    throw new Error('Privy policy must contain exactly one Solana rule.');
  }
  const rule = policy.rules[0];
  if (rule.action !== 'ALLOW' || rule.method !== 'signAndSendTransaction' || rule.conditions.length !== 2) {
    throw new Error('Privy policy must only allow restricted signAndSendTransaction requests.');
  }
  const instruction = rule.conditions.find((condition) =>
    condition.field_source === 'solana_system_program_instruction'
    && condition.field === 'instructionName');
  const limit = rule.conditions.find((condition) =>
    condition.field_source === 'solana_system_program_instruction'
    && condition.field === 'Transfer.lamports');
  if (!instruction || instruction.operator !== 'eq' || instruction.value !== 'Transfer') {
    throw new Error('Privy policy must allow only the System Program Transfer instruction.');
  }
  if (!limit || limit.operator !== 'lte' || typeof limit.value !== 'string' || !/^\d+$/.test(limit.value)) {
    throw new Error('Privy policy must enforce a lamport transfer ceiling.');
  }
  const [whole, fraction = ''] = maximumSol.split('.');
  const applicationMaximum = BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0'));
  if (BigInt(limit.value) <= 0n || BigInt(limit.value) > applicationMaximum) {
    throw new Error('Privy policy transfer ceiling exceeds MAX_TRANSFER_SOL.');
  }
  return policy;
}
