import {getConfig} from './config.js';

export type TransferPersistenceStatus = 'processing' | 'confirmed' | 'failed';

export type PrivyTransactionReconciliation = {
  status: TransferPersistenceStatus;
  signature: string | null;
  transactionId: string;
};

export class TransferNotSubmittedError extends Error {
  constructor(readonly category: string) {
    super(category);
    this.name = 'TransferNotSubmittedError';
  }
}

type PrivyTransaction = {
  id: string;
  status: string;
  transaction_hash: string | null;
  reference_id?: string | null;
};

const definitiveFailureStatuses = new Set(['execution_reverted', 'failed', 'provider_error']);
const completedStatuses = new Set(['confirmed', 'finalized']);
const inFlightStatuses = new Set(['broadcasted', 'pending']);

/**
 * Looks up the transaction Privy associated with Rove's unique reference ID.
 * This is intentionally a read, never a resend: an ambiguous HTTP timeout must
 * not turn into a duplicate transfer.
 */
export async function reconcilePrivyTransaction(referenceId: string): Promise<PrivyTransactionReconciliation | null> {
  const config = getConfig();
  const response = await fetch(
    `https://api.privy.io/v1/transactions?reference_id=${encodeURIComponent(referenceId)}`,
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.privyAppId}:${config.privyAppSecret}`).toString('base64')}`,
        'privy-app-id': config.privyAppId,
      },
      signal: AbortSignal.timeout(4_000),
    },
  );
  if (!response.ok) throw new Error(`Privy reconciliation unavailable (${response.status}).`);
  const body = await response.json() as {transactions?: unknown};
  if (!Array.isArray(body.transactions)) return null;
  const transaction = body.transactions.find((candidate): candidate is PrivyTransaction => {
    if (!candidate || typeof candidate !== 'object') return false;
    const value = candidate as Partial<PrivyTransaction>;
    return typeof value.id === 'string'
      && typeof value.status === 'string'
      && value.reference_id === referenceId
      && (typeof value.transaction_hash === 'string' || value.transaction_hash === null);
  });
  if (!transaction) return null;

  if (definitiveFailureStatuses.has(transaction.status)) {
    return {status: 'failed', signature: transaction.transaction_hash, transactionId: transaction.id};
  }
  if (completedStatuses.has(transaction.status)) {
    return {status: 'confirmed', signature: transaction.transaction_hash, transactionId: transaction.id};
  }
  if (inFlightStatuses.has(transaction.status)) {
    return {status: 'processing', signature: transaction.transaction_hash, transactionId: transaction.id};
  }
  return null;
}

/** Clear 4xx rejections mean Privy did not accept this request for execution. */
export function isDefinitiveTransferFailure(error: unknown) {
  if (error instanceof TransferNotSubmittedError) return true;
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as {status?: unknown}).status)
    : Number.NaN;
  return [400, 401, 403, 404, 422].includes(status);
}

export function privyFailureCategory(error: unknown) {
  if (error instanceof TransferNotSubmittedError) return error.category;
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as {status?: unknown}).status)
    : Number.NaN;
  if ([400, 401, 403, 404, 422].includes(status)) return `privy_rejected_${status}`;
  if (status === 429) return 'privy_rate_limited';
  if (status >= 500) return 'privy_unavailable';
  if (error instanceof Error && /timed?\s*out|timeout|connection/i.test(error.message)) return 'privy_connection_error';
  return 'transfer_error';
}
