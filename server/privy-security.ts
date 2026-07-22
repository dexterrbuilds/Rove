import type {Wallet} from '@privy-io/node';
import {authorizationKeyProvider, privy} from './clients.js';
import {getConfig} from './config.js';
import {assertRestrictedSolanaTransferPolicy, assertWalletSecurityConfiguration, type WalletIdentity} from './wallet-security.js';

export function assertWalletSecurity(wallet: Wallet, expected: WalletIdentity) {
  const config = getConfig();
  return assertWalletSecurityConfiguration(wallet, expected, {
    signerId: config.privySignerId,
    policyId: config.privyPolicyId,
  });
}

export async function attestWalletSecurity(expected: WalletIdentity) {
  const config = getConfig();
  const [wallet, policy] = await Promise.all([
    privy.wallets().get(expected.walletId),
    privy.policies().get(config.privyPolicyId),
  ]);
  assertRestrictedSolanaTransferPolicy(policy, config.maxTransferSol);
  assertWalletSecurity(wallet, expected);
  await assertUserOwnsWallet(wallet, expected.privyUserId);
  return wallet;
}

async function assertUserOwnsWallet(wallet: Wallet, privyUserId: string) {
  if (!wallet.owner_id) throw new Error('Privy wallet has no owner quorum.');
  const owner = await privy.keyQuorums().get(wallet.owner_id);
  if (!owner.user_ids?.includes(privyUserId)) {
    throw new Error('Registered Privy user is not a member of the wallet owner quorum.');
  }
  return owner;
}

export async function findOwnedSolanaWallet(privyUserId: string, walletAddress: string) {
  for await (const wallet of privy.wallets().list({user_id: privyUserId, chain_type: 'solana'})) {
    if (wallet.address === walletAddress) return wallet;
  }
  return null;
}

export async function migrateAndVerifyWalletSigner(input: {
  wallet: Wallet;
  privyUserId: string;
  userJwt: string;
}) {
  const config = getConfig();
  await assertUserOwnsWallet(input.wallet, input.privyUserId);
  if (!input.wallet.owner_id) throw new Error('Privy wallet has no owner quorum.');
  const expected = {
    walletId: input.wallet.id,
    walletAddress: input.wallet.address,
    privyUserId: input.privyUserId,
    ownerId: input.wallet.owner_id,
  };

  try {
    return assertWalletSecurity(input.wallet, expected);
  } catch {
    // The live user-owner quorum was verified above; only that user JWT is used
    // to authorize the signer replacement.
  }

  await privy.wallets().update(input.wallet.id, {
    additional_signers: [{
      signer_id: config.privySignerId,
      override_policy_ids: [config.privyPolicyId],
    }],
    authorization_context: {user_jwts: [input.userJwt]},
  });

  return attestWalletSecurity(expected);
}

export async function validatePrivyStartupSecurity() {
  const config = getConfig();
  const [policy, quorum, keys] = await Promise.all([
    privy.policies().get(config.privyPolicyId),
    privy.keyQuorums().get(config.privySignerId),
    authorizationKeyProvider.getAuthorizationPrivateKeys(),
  ]);
  if (policy.id !== config.privyPolicyId) throw new Error('Configured Privy policy could not be verified.');
  assertRestrictedSolanaTransferPolicy(policy, config.maxTransferSol);
  if (quorum.id !== config.privySignerId) throw new Error('Configured Privy signer quorum could not be verified.');
  if (keys.length === 0) throw new Error('No active Privy authorization key is available.');
}
