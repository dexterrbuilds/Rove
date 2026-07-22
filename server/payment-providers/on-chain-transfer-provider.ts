import {PublicKey, SystemProgram, Transaction} from '@solana/web3.js';
import {authorizationKeyProvider, privy, solana} from '../clients.js';
import {getConfig} from '../config.js';
import {TransferNotSubmittedError} from '../privy-transaction-reconciliation.js';
import type {OnChainTransferRequest, PaymentProvider, PaymentResult} from './types.js';

export class OnChainTransferProvider implements PaymentProvider<OnChainTransferRequest> {
  readonly kind = 'on_chain_transfer';

  async execute(input: OnChainTransferRequest): Promise<PaymentResult> {
    const config = getConfig();
    let sender: PublicKey;
    let recipient: PublicKey;
    try {
      sender = new PublicKey(input.fromAddress);
      recipient = new PublicKey(input.toAddress);
    } catch {
      throw new TransferNotSubmittedError('invalid_transfer_input');
    }
    let blockhash: string;
    try {
      // Privy broadcasts through a different RPC provider. A finalized hash is
      // slightly older but is recognized cluster-wide, avoiding cross-provider
      // `Blockhash not found` simulation failures on devnet.
      ({blockhash} = await solana.getLatestBlockhash('finalized'));
    } catch {
      throw new TransferNotSubmittedError('solana_rpc_unavailable');
    }
    const transaction = new Transaction({feePayer: sender, recentBlockhash: blockhash}).add(
      SystemProgram.transfer({fromPubkey: sender, toPubkey: recipient, lamports: Number(input.lamports)}),
    );
    const unsignedTransaction = transaction.serialize({requireAllSignatures: false, verifySignatures: false});
    let authorizationPrivateKeys: string[];
    try {
      authorizationPrivateKeys = await authorizationKeyProvider.getAuthorizationPrivateKeys();
    } catch {
      throw new TransferNotSubmittedError('authorization_key_unavailable');
    }
    const result = await privy.wallets().solana().signAndSendTransaction(input.walletId, {
      caip2: config.solanaCaip2,
      transaction: unsignedTransaction,
      authorization_context: {authorization_private_keys: authorizationPrivateKeys},
      idempotency_key: input.referenceId,
      reference_id: input.referenceId,
    });
    if (!/^[1-9A-HJ-NP-Za-km-z]{80,100}$/.test(result.hash)) {
      throw new Error('Privy did not return a valid Solana transaction signature.');
    }
    return {
      status: 'completed',
      reference: result.hash,
      processingTime: 'On-chain confirmation submitted',
      description: 'SOL transfer',
      receipt: {signature: result.hash},
    };
  }
}

export const onChainTransferProvider = new OnChainTransferProvider();
