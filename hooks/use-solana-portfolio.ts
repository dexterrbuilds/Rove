'use client';

import {useCallback, useEffect, useState} from 'react';
import {clusterApiUrl, Connection, PublicKey} from '@solana/web3.js';
import type {PortfolioData, WalletActivity, WalletAsset} from '@/lib/dashboard-types';

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

type Cluster = 'mainnet' | 'devnet' | 'testnet';

function rpcUrl(cluster: Cluster) {
  const configured = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  if (configured) return configured;
  return clusterApiUrl(cluster === 'mainnet' ? 'mainnet-beta' : cluster);
}

function shortenMint(mint: string) {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

async function fetchSolPrice(cluster: Cluster, signal: AbortSignal) {
  if (cluster !== 'mainnet') return {price: 0, change: null};
  const response = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true',
    {signal, cache: 'no-store'},
  );
  if (!response.ok) throw new Error('Price service unavailable');
  const payload = await response.json() as {solana?: {usd?: number; usd_24h_change?: number}};
  return {
    price: typeof payload.solana?.usd === 'number' ? payload.solana.usd : null,
    change: typeof payload.solana?.usd_24h_change === 'number' ? payload.solana.usd_24h_change : null,
  };
}

async function fetchTokenAssets(connection: Connection, owner: PublicKey): Promise<WalletAsset[]> {
  const programs = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];
  const results = await Promise.allSettled(
    programs.map((programId) => connection.getParsedTokenAccountsByOwner(owner, {programId}, 'confirmed')),
  );
  const balances = new Map<string, {balance: number; decimals: number}>();

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const account of result.value.value) {
      const parsed = account.account.data as unknown as {
        parsed?: {info?: {mint?: string; tokenAmount?: {uiAmountString?: string; decimals?: number}}};
      };
      const mint = parsed.parsed?.info?.mint;
      const amount = Number(parsed.parsed?.info?.tokenAmount?.uiAmountString ?? 0);
      const decimals = Number(parsed.parsed?.info?.tokenAmount?.decimals ?? 0);
      if (!mint || !Number.isFinite(amount) || amount <= 0) continue;
      const current = balances.get(mint);
      balances.set(mint, {balance: (current?.balance ?? 0) + amount, decimals});
    }
  }

  return [...balances.entries()].map(([mint, token]) => ({
    mint,
    name: `Token ${shortenMint(mint)}`,
    symbol: shortenMint(mint).toUpperCase(),
    balance: token.balance,
    decimals: token.decimals,
    usdPrice: null,
    usdValue: null,
    change24h: null,
  }));
}

async function fetchActivity(connection: Connection, owner: PublicKey): Promise<WalletActivity[]> {
  const signatures = await connection.getSignaturesForAddress(owner, {limit: 18}, 'confirmed');
  if (signatures.length === 0) return [];
  const transactions = await connection.getParsedTransactions(
    signatures.map((entry) => entry.signature),
    {commitment: 'confirmed', maxSupportedTransactionVersion: 0},
  );

  return signatures.map((entry, transactionIndex) => {
    const transaction = transactions[transactionIndex];
    let direction: WalletActivity['direction'] = 'sent';
    let amount: number | null = null;
    let feeSol = 0;

    if (transaction?.meta) {
      const keys = transaction.transaction.message.accountKeys;
      const ownerIndex = keys.findIndex((key) => key.pubkey.equals(owner));
      if (ownerIndex >= 0) {
        const before = transaction.meta.preBalances[ownerIndex] ?? 0;
        const after = transaction.meta.postBalances[ownerIndex] ?? 0;
        const delta = after - before;
        direction = delta >= 0 ? 'received' : 'sent';
        feeSol = ownerIndex === 0 ? transaction.meta.fee / 1_000_000_000 : 0;
        const transferLamports = direction === 'sent' ? Math.max(0, Math.abs(delta) - transaction.meta.fee) : delta;
        amount = transferLamports / 1_000_000_000;
      }
    }

    return {
      signature: entry.signature,
      token: 'SOL',
      amount,
      direction,
      status: entry.err ? 'failed' : entry.confirmationStatus === 'processed' ? 'pending' : 'confirmed',
      source: direction === 'received' ? 'received' : 'onchain',
      timestamp: entry.blockTime ? entry.blockTime * 1_000 : null,
      feeSol,
    };
  });
}

const EMPTY_DATA: PortfolioData = {assets: [], activity: [], solBalance: 0, solPrice: null, totalUsd: null};

export function useSolanaPortfolio(address: string | undefined, cluster: Cluster) {
  const [data, setData] = useState<PortfolioData>(EMPTY_DATA);
  const [loading, setLoading] = useState(Boolean(address));
  const [error, setError] = useState('');
  const [refreshIndex, setRefreshIndex] = useState(0);

  const refresh = useCallback(() => setRefreshIndex((index) => index + 1), []);

  useEffect(() => {
    if (!address) return;
    const controller = new AbortController();
    const connection = new Connection(rpcUrl(cluster), 'confirmed');
    const owner = new PublicKey(address);
    queueMicrotask(() => {
      if (!controller.signal.aborted) setLoading(true);
    });

    void Promise.all([
      connection.getBalance(owner, 'confirmed'),
      fetchTokenAssets(connection, owner),
      fetchActivity(connection, owner),
      fetchSolPrice(cluster, controller.signal).catch(() => ({price: null, change: null})),
    ]).then(([lamports, tokens, activity, market]) => {
      if (controller.signal.aborted) return;
      const solBalance = lamports / 1_000_000_000;
      const solAsset: WalletAsset = {
        mint: 'So11111111111111111111111111111111111111112',
        name: cluster === 'mainnet' ? 'Solana' : 'Solana Devnet',
        symbol: 'SOL',
        balance: solBalance,
        decimals: 9,
        usdPrice: market.price,
        usdValue: market.price === null ? null : solBalance * market.price,
        change24h: market.change,
        isNative: true,
      };
      const assets = [solAsset, ...tokens].sort((first, second) => {
        if (first.isNative) return -1;
        if (second.isNative) return 1;
        return (second.usdValue ?? -1) - (first.usdValue ?? -1);
      });
      const knownValues = assets.filter((asset) => asset.usdValue !== null);
      const totalUsd = knownValues.length > 0
        ? knownValues.reduce((sum, asset) => sum + (asset.usdValue ?? 0), 0)
        : null;
      setData({assets, activity, solBalance, solPrice: market.price, totalUsd});
      setError('');
    }).catch(() => {
      if (!controller.signal.aborted) setError('Live wallet data is temporarily unavailable.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });

    return () => controller.abort();
  }, [address, cluster, refreshIndex]);

  if (!address) return {...EMPTY_DATA, loading: false, error: '', refresh};
  return {...data, loading, error, refresh};
}
