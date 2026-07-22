'use client';

import {useEffect, useMemo, useState} from 'react';
import {AnimatePresence, motion} from 'framer-motion';
import {QRCodeSVG} from 'qrcode.react';
import {PublicKey} from '@solana/web3.js';
import {getAccessToken} from '@privy-io/react-auth';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Landmark,
  Phone,
  QrCode,
  RefreshCw,
  Send,
  Share2,
  ShieldCheck,
  Smartphone,
  ReceiptText,
  WalletCards,
  WifiOff,
  Zap,
} from 'lucide-react';
import type {DashboardView, WalletActivity, WalletAsset} from '@/lib/dashboard-types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const cardMotion = {
  initial: {opacity: 0, y: 12},
  animate: {opacity: 1, y: 0},
  transition: {duration: 0.32, ease: [0.22, 1, 0.36, 1] as const},
};

export function formatCurrency(value: number | null) {
  if (value === null) return '—';
  return new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'}).format(value);
}

export function formatTokenAmount(value: number, maximumFractionDigits = 6) {
  return new Intl.NumberFormat('en-US', {maximumFractionDigits}).format(value);
}

export function LoadingSkeleton({rows = 3}: {rows?: number}) {
  return (
    <div className="skeleton-stack" aria-label="Loading wallet data" aria-busy="true">
      {Array.from({length: rows}, (_, index) => (
        <div className="skeleton-row" key={index}>
          <span className="skeleton-circle" />
          <span className="skeleton-lines"><i /><i /></span>
          <span className="skeleton-value" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({icon = 'activity', title, description}: {
  icon?: 'activity' | 'assets';
  title: string;
  description: string;
}) {
  return (
    <div className="empty-state">
      <span>{icon === 'activity' ? <RefreshCw size={20} /> : <WalletCards size={20} />}</span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

export function BalanceChart({activity}: {activity: WalletActivity[]}) {
  const points = useMemo(() => {
    const history = [...activity].reverse().slice(-8).reduce<{value: number; points: string[]}>((chart, entry, index) => {
      const movement = Math.min(entry.amount ?? 0, 1) * 16;
      const value = chart.value + (entry.direction === 'received' ? movement : -movement);
      return {
        value,
        points: [...chart.points, `${(index / 7) * 100},${Math.max(14, Math.min(84, 100 - value))}`],
      };
    }, {value: 52, points: []});
    return history.points.length > 1 ? history.points.join(' ') : '0,56 20,52 40,58 60,43 80,47 100,35';
  }, [activity]);

  return (
    <div className="balance-chart" aria-label="Recent balance movement">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img">
        <defs>
          <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity=".28" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
        <polygon points={`0,100 ${points} 100,100`} fill="url(#chart-fill)" />
      </svg>
    </div>
  );
}

export function PortfolioCard({
  totalUsd,
  solBalance,
  activity,
  cluster,
  loading,
}: {
  totalUsd: number | null;
  solBalance: number;
  activity: WalletActivity[];
  cluster: string;
  loading: boolean;
}) {
  const [hidden, setHidden] = useState(false);
  return (
    <motion.section className="portfolio-card" {...cardMotion}>
      <div className="portfolio-card-top">
        <div>
          <span className="card-kicker">Total portfolio</span>
          <div className="portfolio-value-row">
            <h2>{loading ? <span className="value-placeholder" /> : hidden ? '••••••' : formatCurrency(totalUsd)}</h2>
            <button className="ghost-icon" type="button" onClick={() => setHidden((value) => !value)} aria-label={hidden ? 'Show balance' : 'Hide balance'}>
              {hidden ? <Eye size={17} /> : <EyeOff size={17} />}
            </button>
          </div>
          <p>{hidden ? '≈ •••• SOL' : `≈ ${formatTokenAmount(solBalance, 5)} SOL`}</p>
        </div>
        <span className="cluster-chip"><i /> {cluster === 'mainnet' ? 'Mainnet' : `${cluster[0].toUpperCase()}${cluster.slice(1)} funds`}</span>
      </div>
      <BalanceChart activity={activity} />
      <div className="portfolio-foot">
        <span>{cluster === 'mainnet' ? 'Live market value' : 'Reference value at the live SOL price'}</span>
        <strong>{cluster === 'mainnet' ? 'Portfolio synced' : 'Devnet SOL has no cash value'}</strong>
      </div>
    </motion.section>
  );
}

const actionDefinitions: Array<{view: DashboardView; label: string; icon: typeof Send; tone: string}> = [
  {view: 'send', label: 'Send', icon: Send, tone: 'green'},
  {view: 'receive', label: 'Receive', icon: QrCode, tone: 'blue'},
  {view: 'ussd', label: 'USSD', icon: Smartphone, tone: 'violet'},
  {view: 'security', label: 'Security', icon: ShieldCheck, tone: 'amber'},
];

export function QuickActions({onSelect}: {onSelect: (view: DashboardView) => void}) {
  return (
    <div className="quick-actions" aria-label="Quick actions">
      {actionDefinitions.map((action, index) => {
        const Icon = action.icon;
        return (
          <motion.button
            key={action.view}
            className={`quick-action ${action.tone}`}
            type="button"
            onClick={() => onSelect(action.view)}
            initial={{opacity: 0, y: 10}}
            animate={{opacity: 1, y: 0}}
            transition={{delay: index * 0.05, duration: 0.25}}
            whileHover={{y: -3}}
            whileTap={{scale: 0.98}}
          >
            <span><Icon size={20} /></span>
            <strong>{action.label}</strong>
          </motion.button>
        );
      })}
    </div>
  );
}

function AssetLogo({asset}: {asset: WalletAsset}) {
  if (asset.logoUrl) return <span className="asset-logo-image" aria-hidden="true" style={{backgroundImage: `url(${JSON.stringify(asset.logoUrl)})`}} />;
  return <span className={asset.isNative ? 'sol-logo' : 'token-logo'}>{asset.isNative ? 'S' : asset.symbol.slice(0, 1)}</span>;
}

export function AssetCard({asset}: {asset: WalletAsset}) {
  return (
    <motion.div className="asset-card" layout whileHover={{x: 3}}>
      <div className="asset-identity"><AssetLogo asset={asset} /><div><strong>{asset.name}</strong><span>{asset.symbol}</span></div></div>
      <div className="asset-market">
        <strong>{asset.usdValue === null ? 'Price unavailable' : formatCurrency(asset.usdValue)}</strong>
        <span className={asset.change24h !== null && asset.change24h < 0 ? 'negative' : 'positive'}>
          {asset.change24h === null ? '—' : `${asset.change24h >= 0 ? '+' : ''}${asset.change24h.toFixed(2)}%`}
        </span>
      </div>
      <div className="asset-balance"><strong>{formatTokenAmount(asset.balance)}</strong><span>{asset.symbol}</span></div>
    </motion.div>
  );
}

export function TokenList({assets, loading}: {assets: WalletAsset[]; loading: boolean}) {
  const [showDust, setShowDust] = useState(false);
  const visible = assets.filter((asset) => showDust || asset.usdValue === null || asset.usdValue >= 1 || asset.isNative);
  const hiddenCount = assets.length - visible.length;
  if (loading) return <LoadingSkeleton rows={3} />;
  if (assets.length === 0) return <EmptyState icon="assets" title="No assets yet" description="Fund this wallet to see assets here." />;
  return (
    <div className="token-list">
      {visible.map((asset) => <AssetCard asset={asset} key={asset.mint} />)}
      {hiddenCount > 0 && (
        <button className="text-button" type="button" onClick={() => setShowDust((value) => !value)}>
          <ChevronDown size={15} className={showDust ? 'rotated' : ''} /> {showDust ? 'Hide' : 'Show'} {hiddenCount} dust asset{hiddenCount === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
}

function activityBadges(activity: WalletActivity) {
  const badges: Array<{label: string; tone: string}> = [];
  if (activity.activityType === 'demo' || activity.source === 'demo') {
    badges.push({label: 'Demo', tone: 'demo'});
  } else {
    badges.push({label: 'On-chain', tone: 'onchain'});
    if (activity.source === 'ussd') badges.push({label: 'USSD', tone: 'ussd'});
    else if (activity.source === 'dashboard') badges.push({label: 'Dashboard', tone: 'dashboard'});
    else badges.push({label: activity.direction === 'received' ? 'Received' : 'Sent', tone: activity.direction});
  }
  if (activity.status === 'pending') badges.push({label: 'Pending', tone: 'pending'});
  if (activity.status === 'failed') badges.push({label: 'Failed', tone: 'failed'});
  return badges;
}

function explorerTransactionUrl(signature: string, cluster: string) {
  const query = cluster === 'mainnet' ? '' : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${signature}${query}`;
}

export function TransactionCard({activity, cluster}: {activity: WalletActivity; cluster: string}) {
  const received = activity.direction === 'received';
  const demo = activity.activityType === 'demo' || activity.source === 'demo';
  const amount = activity.amount === null
    ? '—'
    : demo
      ? `${activity.currency ?? activity.token} ${formatTokenAmount(activity.amount, 2)}`
      : `${formatTokenAmount(activity.amount, 6)} SOL`;
  return (
    <motion.article className="transaction-card" layout initial={{opacity: 0}} animate={{opacity: 1}}>
      <span className={`transaction-icon ${demo ? 'demo' : received ? 'received' : 'sent'}`}>{demo ? <ReceiptText size={18} /> : received ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}</span>
      <div className="transaction-main">
        <strong>{activity.description ?? (received ? 'Received SOL' : 'Sent SOL')}</strong>
        <span>{activity.timestamp ? new Intl.DateTimeFormat('en', {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}).format(activity.timestamp) : 'Time unavailable'}</span>
        {demo
          ? <small className="transaction-reference">Ref: {activity.reference}</small>
          : <a href={explorerTransactionUrl(activity.signature, cluster)} target="_blank" rel="noreferrer">{activity.signature.slice(0, 6)}…{activity.signature.slice(-5)} <ExternalLink size={11} /></a>}
      </div>
      <div className="transaction-amount">
        <strong>{received ? '+' : '-'}{amount}</strong>
        <div className="transaction-badges">{activityBadges(activity).map((badge) => <span className={`status-badge ${badge.tone}`} key={badge.label}>{badge.label}</span>)}</div>
      </div>
    </motion.article>
  );
}

export type ActivityFilter = 'all' | 'onchain' | 'ussd' | 'dashboard' | 'demo' | 'received' | 'sent' | 'pending';
const activityFilters: Array<{value: ActivityFilter; label: string}> = [
  {value: 'all', label: 'All'},
  {value: 'onchain', label: 'On-chain'},
  {value: 'ussd', label: 'USSD'},
  {value: 'dashboard', label: 'Dashboard'},
  {value: 'demo', label: 'Demo'},
  {value: 'received', label: 'Received'},
  {value: 'sent', label: 'Sent'},
  {value: 'pending', label: 'Pending'},
];

export function TransactionTimeline({activity, cluster, preview = false, loading = false}: {
  activity: WalletActivity[];
  cluster: string;
  preview?: boolean;
  loading?: boolean;
}) {
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const filtered = activity.filter((entry) => {
    if (filter === 'all') return true;
    if (filter === 'received' || filter === 'sent') return entry.direction === filter;
    if (filter === 'pending') return entry.status === 'pending';
    if (filter === 'onchain') return entry.activityType !== 'demo' && entry.source !== 'demo';
    return entry.source === filter;
  });
  const shown = preview ? filtered.slice(0, 4) : filtered;
  return (
    <div className="transaction-timeline">
      {!preview && <div className="filter-row">{activityFilters.map((item) => <button type="button" className={filter === item.value ? 'active' : ''} onClick={() => setFilter(item.value)} key={item.value}>{item.label}</button>)}</div>}
      {loading ? <LoadingSkeleton rows={4} /> : shown.length > 0
        ? shown.map((entry) => <TransactionCard activity={entry} cluster={cluster} key={entry.signature} />)
        : <EmptyState title="No matching activity" description={filter === 'ussd' || filter === 'dashboard' ? 'Source attribution will appear after the activity API is connected.' : 'New wallet activity will appear here.'} />}
    </div>
  );
}

export function USSDCard({phoneNumber, shortcode, secure, onCopy, onReconnect}: {
  phoneNumber: string;
  shortcode: string;
  secure: boolean;
  onCopy: () => void;
  onReconnect: () => void;
}) {
  return (
    <motion.section className="feature-card ussd-card" {...cardMotion}>
      <div className="feature-card-head"><span className="feature-icon violet"><WifiOff size={20} /></span><div><span className="card-kicker">Offline access</span><h3>USSD wallet</h3></div><span className="status-badge confirmed"><i /> Active</span></div>
      <div className="ussd-number"><span>Linked phone</span><strong>{phoneNumber}</strong><small>Verified and ready</small></div>
      <button className="shortcode-button" type="button" onClick={onCopy}><span>Dial from your linked phone</span><strong>{shortcode}</strong><Copy size={16} /></button>
      <div className="status-list compact">
        <div><Phone size={15} /><span>Activation status</span><strong>Complete</strong></div>
        <div><ShieldCheck size={15} /><span>Security status</span><strong>{secure ? 'Protected' : 'Action needed'}</strong></div>
        <div><RefreshCw size={15} /><span>Last USSD transaction</span><strong>Not classified yet</strong></div>
      </div>
      <button className="secondary-action" type="button" onClick={onReconnect}><RefreshCw size={15} /> Reconnect number</button>
    </motion.section>
  );
}

export type SecurityCheck = {label: string; detail: string; ok: boolean; icon: typeof ShieldCheck};

export function SecurityCard({checks, verifiedAt}: {checks: SecurityCheck[]; verifiedAt: Date | null}) {
  const complete = checks.every((check) => check.ok);
  return (
    <motion.section className="feature-card security-card" {...cardMotion}>
      <div className="security-score">
        <div className={complete ? 'complete' : 'attention'}><ShieldCheck size={26} /></div>
        <div><span className="card-kicker">Security health</span><h3>{complete ? 'Everything looks good' : 'Action required'}</h3><p>{complete ? 'Your wallet is protected for offline use.' : 'Complete the remaining security checks.'}</p></div>
      </div>
      <div className="security-checks">
        {checks.map((check) => {
          const Icon = check.icon;
          return <div key={check.label}><span><Icon size={17} /></span><div><strong>{check.label}</strong><small>{check.detail}</small></div><i className={check.ok ? 'ok' : 'pending'}>{check.ok ? <Check size={14} /> : '!'}</i></div>;
        })}
      </div>
      <div className="verified-time"><LockKeyhole size={14} /> Last verified {verifiedAt ? new Intl.DateTimeFormat('en', {hour: 'numeric', minute: '2-digit'}).format(verifiedAt) : 'this session'}</div>
    </motion.section>
  );
}

export function ReceivePanel({address, cluster}: {address: string; cluster: string}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }
  async function share() {
    if (navigator.share) await navigator.share({title: 'My Rove wallet', text: `Send SOL on ${cluster} to ${address}`});
    else await copy();
  }
  return (
    <motion.section className="receive-panel feature-card" {...cardMotion}>
      <div className="panel-heading"><span className="feature-icon blue"><ArrowDownLeft size={21} /></span><div><span className="card-kicker">Receive funds</span><h2>Your Solana address</h2><p>Only send assets on Solana {cluster}.</p></div></div>
      <div className="qr-shell"><QRCodeSVG value={address} size={190} level="M" bgColor="transparent" fgColor="currentColor" /></div>
      <div className="address-box"><WalletCards size={17} /><code>{address}</code></div>
      <div className="panel-actions"><button className="primary-action" type="button" onClick={() => void copy()}>{copied ? <Check size={17} /> : <Copy size={17} />} {copied ? 'Copied' : 'Copy address'}</button><button className="secondary-action" type="button" onClick={() => void share()}><Share2 size={17} /> Share</button></div>
      <div className="warning-note"><ShieldCheck size={16} /><p>Verify the network before sending. Test SOL has no monetary value.</p></div>
    </motion.section>
  );
}

export type EverydayPaymentKind = 'bank_transfer' | 'airtime' | 'bill_payment';

const everydayPayments: Array<{
  kind: EverydayPaymentKind;
  title: string;
  description: string;
  icon: typeof Landmark;
  tone: string;
}> = [
  {kind: 'bank_transfer', title: 'Send to Local Bank', description: 'Preview a local account transfer receipt.', icon: Landmark, tone: 'blue'},
  {kind: 'airtime', title: 'Buy Airtime', description: 'Try instant airtime for major networks.', icon: Smartphone, tone: 'green'},
  {kind: 'bill_payment', title: 'Pay Bills', description: 'Explore everyday bill categories.', icon: Zap, tone: 'amber'},
];

export function EverydayPayments({onPreview}: {onPreview: (kind: EverydayPaymentKind) => void}) {
  return (
    <div className="everyday-payment-grid">
      {everydayPayments.map((payment) => {
        const Icon = payment.icon;
        return (
          <motion.button className="everyday-payment-card" type="button" key={payment.kind} onClick={() => onPreview(payment.kind)} whileHover={{y: -3}} whileTap={{scale: .99}}>
            <span className={`feature-icon ${payment.tone}`}><Icon size={19} /></span>
            <span className="demo-label">Demo Preview</span>
            <strong>{payment.title}</strong>
            <p>{payment.description}</p>
            <span className="card-arrow">Explore <ArrowUpRight size={14} /></span>
          </motion.button>
        );
      })}
    </div>
  );
}

const paymentPreviewContent: Record<EverydayPaymentKind, {title: string; description: string; steps: string[]; icon: typeof Landmark; tone: string}> = {
  bank_transfer: {title: 'Send to Local Bank', description: 'Resolve a demo bank account and generate a realistic receipt.', steps: ['Choose bank', 'Enter account number', 'Confirm demo account name', 'Enter amount and approve with PIN'], icon: Landmark, tone: 'blue'},
  airtime: {title: 'Buy Airtime', description: 'Preview airtime delivery across MTN, Airtel, Glo, and 9mobile.', steps: ['Choose network', 'Enter phone number', 'Enter amount', 'Approve with PIN and receive receipt'], icon: Smartphone, tone: 'green'},
  bill_payment: {title: 'Pay Bills', description: 'Preview electricity, TV, internet, water, and education payments.', steps: ['Choose bill category', 'Enter customer ID', 'Enter amount', 'Approve with PIN and receive receipt'], icon: Zap, tone: 'amber'},
};

export function PaymentPreviewPanel({kind, shortcode}: {kind: EverydayPaymentKind; shortcode: string}) {
  const content = paymentPreviewContent[kind];
  const Icon = content.icon;
  return (
    <motion.section className="feature-card payment-preview-panel" {...cardMotion}>
      <div className="panel-heading"><span className={`feature-icon ${content.tone}`}><Icon size={21} /></span><div><span className="card-kicker">Demo Preview</span><h2>{content.title}</h2><p>{content.description}</p></div></div>
      <div className="demo-disclaimer"><ShieldCheck size={16} /><p>No real fiat, airtime, or bill payment is processed. Your existing Rove PIN and server-side USSD protections still authorize the demo.</p></div>
      <div className="preview-steps">{content.steps.map((step, index) => <div key={step}><span>{index + 1}</span><strong>{step}</strong></div>)}</div>
      <a className="primary-action full" href={`tel:${shortcode.replace('#', '%23')}`}><Smartphone size={17} /> Continue securely with {shortcode}</a>
    </motion.section>
  );
}

export function SendPanel({balance, shortcode, onOpenUssd}: {balance: number; shortcode: string; onOpenUssd: () => void}) {
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [resolution, setResolution] = useState<
    | {state: 'idle' | 'loading' | 'unregistered' | 'error'}
    | {state: 'registered'; displayName: string | null; walletAddress: string; walletPreview: string}
  >({state: 'idle'});
  const amountNumber = Number(amount);
  const phoneRecipient = /^\+[1-9]\d{7,14}$/.test(recipient);
  let walletAddressIsValid = false;
  try {
    walletAddressIsValid = new PublicKey(recipient).toBase58() === recipient;
  } catch {
    walletAddressIsValid = false;
  }
  useEffect(() => {
    const controller = new AbortController();
    if (!phoneRecipient) {
      queueMicrotask(() => {
        if (!controller.signal.aborted) setResolution({state: 'idle'});
      });
      return () => controller.abort();
    }
    const timeout = window.setTimeout(() => {
      setResolution({state: 'loading'});
      void getAccessToken().then(async (token) => {
        if (!token) throw new Error('Authentication unavailable');
        const query = new URLSearchParams({phoneNumber: recipient});
        const response = await fetch(`${API_URL}/profiles/resolve-recipient?${query}`, {
          headers: {Authorization: `Bearer ${token}`}, signal: controller.signal, cache: 'no-store',
        });
        const payload = await response.json() as {
          registered?: boolean;
          displayName?: string | null;
          walletAddress?: string;
          walletPreview?: string;
        };
        if (!response.ok) throw new Error('Recipient lookup failed');
        if (controller.signal.aborted) return;
        if (!payload.registered || !payload.walletAddress || !payload.walletPreview) {
          setResolution({state: 'unregistered'});
          return;
        }
        setResolution({state: 'registered', displayName: payload.displayName ?? null, walletAddress: payload.walletAddress, walletPreview: payload.walletPreview});
      }).catch(() => {
        if (!controller.signal.aborted) setResolution({state: 'error'});
      });
    }, 450);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [phoneRecipient, recipient]);

  const recipientIsValid = walletAddressIsValid || (phoneRecipient && resolution.state === 'registered');
  const valid = recipientIsValid && Number.isFinite(amountNumber) && amountNumber > 0 && amountNumber < balance;
  return (
    <motion.section className="send-panel feature-card" {...cardMotion}>
      <div className="panel-heading"><span className="feature-icon green"><Send size={21} /></span><div><span className="card-kicker">Send securely</span><h2>Prepare a SOL transfer</h2><p>Rove authorizes transfers with your PIN over USSD.</p></div></div>
      <AnimatePresence mode="wait" initial={false}>
        {reviewing ? (
          <motion.div className="send-review" key="review" initial={{opacity: 0, x: 12}} animate={{opacity: 1, x: 0}} exit={{opacity: 0, x: -10}}>
            <div className="review-mark"><ShieldCheck size={24} /></div>
            <div className="review-heading"><span className="card-kicker">Review transfer</span><h3>{formatTokenAmount(amountNumber)} SOL</h3><p>Confirm these details before continuing on your linked phone.</p></div>
            <div className="review-details">
              <div><span>Recipient</span><strong>{resolution.state === 'registered' ? resolution.displayName ?? 'Verified Rove User' : recipient}</strong></div>
              {resolution.state === 'registered' && <div><span>Resolved wallet</span><strong>{resolution.walletPreview}</strong></div>}
              <div><span>Asset</span><strong>Solana (SOL)</strong></div>
              <div><span>Amount</span><strong>{formatTokenAmount(amountNumber)} SOL</strong></div>
              <div><span>Estimated fee</span><strong>≈ 0.000005 SOL</strong></div>
              <div><span>Final approval</span><strong>6-digit PIN via USSD</strong></div>
            </div>
            <div className="review-actions"><button className="secondary-action" type="button" onClick={() => setReviewing(false)}>Back</button><button className="primary-action" type="button" onClick={onOpenUssd}><Smartphone size={17} /> Continue with {shortcode}</button></div>
            <p className="form-helper"><KeyRound size={14} /> Rove never asks for your transaction PIN in the browser.</p>
          </motion.div>
        ) : (
          <motion.div className="send-form" key="form" initial={{opacity: 0, x: -12}} animate={{opacity: 1, x: 0}} exit={{opacity: 0, x: 10}}>
            <label><span>Recipient phone or wallet address</span><div className="premium-input"><Phone size={17} /><input value={recipient} onChange={(event) => setRecipient(event.target.value.replace(/[\s()-]/g, ''))} placeholder="+234… or Solana address" inputMode="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} /></div>
              {phoneRecipient && resolution.state === 'loading' && <span className="recipient-resolution checking"><RefreshCw size={14} className="spinning" /> Verifying Rove recipient…</span>}
              {phoneRecipient && resolution.state === 'registered' && <span className="recipient-resolution verified"><ShieldCheck size={15} /><span><strong>Verified Rove User</strong><small>{resolution.displayName ?? 'Rove User'} · Wallet {resolution.walletPreview}</small></span></span>}
              {phoneRecipient && resolution.state === 'unregistered' && <span className="recipient-resolution unregistered"><span><strong>This phone number is not registered with Rove.</strong><small>Use a Solana wallet address instead.</small></span><button type="button" onClick={() => setRecipient('')}>Enter address</button></span>}
              {phoneRecipient && resolution.state === 'error' && <span className="recipient-resolution unregistered"><span><strong>Recipient verification is unavailable.</strong><small>Try again or use a wallet address.</small></span></span>}
            </label>
            <label><span>Token</span><div className="premium-input token-selector"><span className="mini-sol-logo">S</span><select aria-label="Token" value="SOL" disabled><option value="SOL">Solana (SOL)</option></select><small>USSD supported</small></div></label>
            <label><span>Amount</span><div className="premium-input amount-input"><input value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ''))} placeholder="0.00" inputMode="decimal" /><strong>SOL</strong></div></label>
            <div className="send-details"><div><span>Available</span><strong>{formatTokenAmount(balance)} SOL</strong></div><div><span>Estimated network fee</span><strong>≈ 0.000005 SOL</strong></div><div><span>Authorization</span><strong>6-digit PIN via USSD</strong></div></div>
            <button className="primary-action full" type="button" disabled={!valid} onClick={() => setReviewing(true)}><ShieldCheck size={17} /> Review transfer</button>
            <p className="form-helper"><KeyRound size={14} /> For your security, the web dashboard never collects the transaction PIN during a transfer.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
