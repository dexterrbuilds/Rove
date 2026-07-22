import type {Wallet} from '@privy-io/node';
import {authorizationKeyProvider, privy, solana} from './clients.js';
import {authorizationPublicKeyFromPrivateKey} from './authorization-key-provider.js';
import {getConfig, solanaCaip2MatchesGenesisHash} from './config.js';
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

export async function validatePrivyStartupSecurity() {
  const config = getConfig();
  const [policy, quorum, keys, genesisHash] = await Promise.all([
    privy.policies().get(config.privyPolicyId),
    privy.keyQuorums().get(config.privySignerId),
    authorizationKeyProvider.getAuthorizationPrivateKeys(),
    solana.getGenesisHash(),
  ]);
  if (policy.id !== config.privyPolicyId) throw new Error('Configured Privy policy could not be verified.');
  assertRestrictedSolanaTransferPolicy(policy, config.maxTransferSol);
  if (quorum.id !== config.privySignerId) throw new Error('Configured Privy signer quorum could not be verified.');
  if (keys.length === 0) throw new Error('No active Privy authorization key is available.');
  const quorumPublicKeys = new Set(quorum.authorization_keys.map((key) => key.public_key.replace(/\s/g, '')));
  const activePublicKeys = keys.map((key) => authorizationPublicKeyFromPrivateKey(key).replace(/\s/g, ''));
  if (activePublicKeys.some((key) => !quorumPublicKeys.has(key))) {
    throw new Error('An active Privy authorization private key is not registered in PRIVY_SIGNER_ID.');
  }
  if (new Set(activePublicKeys).size < (quorum.authorization_threshold ?? 1)) {
    throw new Error('Active Privy authorization keys do not satisfy the signer quorum threshold.');
  }
  if (!solanaCaip2MatchesGenesisHash(config.solanaCaip2, genesisHash)) {
    throw new Error('SOLANA_RPC_URL and SOLANA_CAIP2 refer to different Solana networks.');
  }
}
