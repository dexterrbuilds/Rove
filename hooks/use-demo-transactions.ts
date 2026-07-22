'use client';

import {useCallback, useEffect, useMemo, useState} from 'react';
import {getAccessToken} from '@privy-io/react-auth';
import type {DemoTransaction, WalletActivity} from '@/lib/dashboard-types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function useDemoTransactions(enabled: boolean) {
  const [transactions, setTransactions] = useState<DemoTransaction[]>([]);
  const [ussdTransfers, setUssdTransfers] = useState<Array<{
    id: string;
    signature: string | null;
    status: 'processing' | 'confirmed' | 'unknown';
    amountLamports: string;
    recipientPhoneNumber: string | null;
    recipientWalletAddress: string;
    createdAt: string;
  }>>([]);
  const [loading, setLoading] = useState(enabled);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const refresh = useCallback(() => setRefreshIndex((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) setLoading(true);
    });
    void getAccessToken().then(async (token) => {
      if (!token) throw new Error('Authentication unavailable');
      const response = await fetch(`${API_URL}/payments/history`, {
        headers: {Authorization: `Bearer ${token}`},
        signal: controller.signal,
        cache: 'no-store',
      });
      const payload = await response.json() as {
        transactions?: DemoTransaction[];
        ussdTransfers?: typeof ussdTransfers;
      };
      if (!response.ok) throw new Error('History unavailable');
      if (!controller.signal.aborted) {
        setTransactions(payload.transactions ?? []);
        setUssdTransfers(payload.ussdTransfers ?? []);
      }
    }).catch(() => {
      // On-chain portfolio data remains available if demo history cannot load.
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [enabled, refreshIndex]);

  const activity = useMemo<WalletActivity[]>(() => transactions.map((transaction) => ({
    signature: `demo:${transaction.id}`,
    token: transaction.currency,
    amount: Number(BigInt(transaction.amountMinor)) / 100,
    direction: 'sent',
    status: transaction.status === 'completed' ? 'confirmed' : 'failed',
    source: 'demo',
    timestamp: new Date(transaction.createdAt).getTime(),
    activityType: 'demo',
    description: transaction.description,
    reference: transaction.reference,
    currency: transaction.currency,
  })), [transactions]);

  const ussdSignatures = useMemo(() => new Set(
    ussdTransfers.flatMap((transfer) => transfer.signature ? [transfer.signature] : []),
  ), [ussdTransfers]);
  const pendingUssdActivity = useMemo<WalletActivity[]>(() => ussdTransfers
    .filter((transfer) => !transfer.signature)
    .map((transfer) => ({
      signature: `ussd:${transfer.id}`,
      token: 'SOL',
      amount: Number(BigInt(transfer.amountLamports)) / 1_000_000_000,
      direction: 'sent',
      status: 'pending',
      source: 'ussd',
      timestamp: new Date(transfer.createdAt).getTime(),
      activityType: 'onchain',
      description: transfer.status === 'unknown' ? 'USSD transfer status uncertain' : 'USSD transfer processing',
    })), [ussdTransfers]);

  return {activity, pendingUssdActivity, ussdSignatures, loading, refresh};
}
