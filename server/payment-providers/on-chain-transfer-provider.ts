import {PublicKey, SystemProgram, Transaction} from '@solana/web3.js';
import {authorizationKeyProvider, privy, solana} from '../clients.js';
import {getConfig} from '../config.js';
import type {OnChainTransferRequest, PaymentProvider, PaymentResult} from './types.js';

export class OnChainTransferProvider implements PaymentProvider<OnChainTransferRequest> {
  readonly kind = 'on_chain_transfer';

  async execute(input: OnChainTransferRequest): Promise<PaymentResult> {
    const config = getConfig();
    const sender = new PublicKey(input.fromAddress);
    const recipient = new PublicKey(input.toAddress);
    const {blockhash} = await solana.getLatestBlockhash('confirmed');
    const transaction = new Transaction({feePayer: sender, recentBlockhash: blockhash}).add(
      SystemProgram.transfer({fromPubkey: sender, toPubkey: recipient, lamports: Number(input.lamports)}),
    );
    const unsignedTransaction = transaction.serialize({requireAllSignatures: false, verifySignatures: false});
    const authorizationPrivateKeys = await authorizationKeyProvider.getAuthorizationPrivateKeys();
    const result = await privy.wallets().solana().signAndSendTransaction(input.walletId, {
      caip2: config.solanaCaip2,
      transaction: unsignedTransaction,
      authorization_context: {authorization_private_keys: authorizationPrivateKeys},
      idempotency_key: input.referenceId,
      reference_id: input.referenceId,
    });
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
