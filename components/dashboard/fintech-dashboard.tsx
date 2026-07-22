'use client';

import {useEffect, useMemo, useState} from 'react';
import {AnimatePresence, motion} from 'framer-motion';
import {
  Activity,
  ArrowRight,
  Bell,
  ChevronRight,
  Copy,
  Home,
  KeyRound,
  LockKeyhole,
  LogOut,
  Menu,
  Moon,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sun,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react';
import type {DashboardView, PortfolioData} from '@/lib/dashboard-types';
import {
  PortfolioCard,
  QuickActions,
  ReceivePanel,
  SecurityCard,
  SendPanel,
  TokenList,
  TransactionTimeline,
  USSDCard,
  type SecurityCheck,
} from './dashboard-ui';

const navigation: Array<{view: DashboardView; label: string; icon: typeof Home}> = [
  {view: 'home', label: 'Home', icon: Home},
  {view: 'assets', label: 'Assets', icon: WalletCards},
  {view: 'activity', label: 'Activity', icon: Activity},
  {view: 'ussd', label: 'USSD', icon: Smartphone},
  {view: 'security', label: 'Security', icon: ShieldCheck},
];

function Brand() {
  return <div className="premium-brand"><span className="premium-brand-mark"><span /></span><strong>rove</strong></div>;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function PageHeading({eyebrow, title, description, action}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return <div className="dashboard-heading"><div><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function SectionTitle({title, action}: {title: string; action?: React.ReactNode}) {
  return <div className="section-title"><h2>{title}</h2>{action}</div>;
}

function ViewTransition({children, view}: {children: React.ReactNode; view: DashboardView}) {
  return <motion.div key={view} className="view-transition" initial={{opacity: 0, y: 8}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -5}} transition={{duration: 0.22}}>{children}</motion.div>;
}

export function FintechDashboard({
  walletAddress,
  phoneNumber,
  securityUpgradeRequired,
  cluster,
  shortcode,
  portfolio,
  verifiedAt,
  onLogout,
}: {
  walletAddress: string;
  phoneNumber: string;
  securityUpgradeRequired: boolean;
  cluster: 'mainnet' | 'devnet' | 'testnet';
  shortcode: string;
  portfolio: PortfolioData & {loading: boolean; error: string; refresh: () => void};
  verifiedAt: Date | null;
  onLogout: () => void;
}) {
  const [view, setView] = useState<DashboardView>('home');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const saved = window.localStorage.getItem('rove-theme');
      const preferred = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      setTheme(saved === 'light' || saved === 'dark' ? saved : preferred);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('rove-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 3600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const secure = !securityUpgradeRequired;
  const checks = useMemo<SecurityCheck[]>(() => [
    {label: 'PIN configured', detail: 'Six-digit offline authorization', ok: secure, icon: KeyRound},
    {label: 'Phone verified', detail: phoneNumber, ok: Boolean(phoneNumber), icon: Smartphone},
    {label: 'Delegated signer active', detail: 'Scoped server signer', ok: secure, icon: ShieldCheck},
    {label: 'Privy policy verified', detail: 'SOL transfer limits enforced', ok: secure, icon: LockKeyhole},
    {label: 'Wallet ownership verified', detail: 'Privy user owner confirmed', ok: secure, icon: UserRound},
    {label: 'Security migration', detail: secure ? 'Current version' : 'Upgrade required', ok: secure, icon: RefreshCw},
  ], [phoneNumber, secure]);

  const selectView = (next: DashboardView) => {
    setView(next);
    setSidebarOpen(false);
    window.scrollTo({top: 0, behavior: 'smooth'});
  };

  async function copyShortcode() {
    await navigator.clipboard.writeText(shortcode);
    setNotice('USSD code copied');
  }

  function reconnectPhone() {
    setNotice('Phone reconnection needs an authenticated unlink endpoint. Your current number remains protected.');
  }

  const selectedLabel = view === 'home' ? 'Overview' : `${view[0].toUpperCase()}${view.slice(1)}`;

  return (
    <div className="bank-app">
      <aside className={`bank-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-brand"><Brand /><button type="button" onClick={() => setSidebarOpen(false)} aria-label="Close menu"><X size={20} /></button></div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {navigation.map((item) => {
            const Icon = item.icon;
            return <button type="button" className={view === item.view ? 'active' : ''} onClick={() => selectView(item.view)} key={item.view}><Icon size={18} /><span>{item.label}</span>{view === item.view && <motion.i layoutId="active-nav" />}</button>;
          })}
        </nav>
        <div className="sidebar-wallet">
          <span className="wallet-orb"><WalletCards size={17} /></span>
          <div><small>Solana wallet</small><strong>{walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}</strong></div>
          <button type="button" onClick={() => { void navigator.clipboard.writeText(walletAddress); setNotice('Wallet address copied'); }} aria-label="Copy wallet"><Copy size={14} /></button>
        </div>
        <button className="logout-button" type="button" onClick={onLogout}><LogOut size={17} /> Log out</button>
      </aside>
      {sidebarOpen && <button className="sidebar-backdrop" type="button" aria-label="Close menu" onClick={() => setSidebarOpen(false)} />}

      <div className="bank-main">
        <header className="bank-topbar">
          <button className="mobile-menu" type="button" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Menu size={21} /></button>
          <div className="mobile-brand"><Brand /></div>
          <div className="breadcrumb"><span>Rove</span><ChevronRight size={13} /><strong>{selectedLabel}</strong></div>
          <div className="topbar-tools">
            <span className="network-status"><i /> Solana {cluster}</span>
            <button className="round-tool" type="button" onClick={() => portfolio.refresh()} aria-label="Refresh wallet data"><RefreshCw size={17} className={portfolio.loading ? 'spinning' : ''} /></button>
            <button className="round-tool" type="button" onClick={() => setTheme((value) => value === 'light' ? 'dark' : 'light')} aria-label="Toggle theme">{theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}</button>
            <button className="round-tool notification-tool" type="button" aria-label="Notifications"><Bell size={17} /><i /></button>
          </div>
        </header>

        <main className="bank-content">
          {portfolio.error && <div className="data-alert"><span>{portfolio.error}</span><button type="button" onClick={portfolio.refresh}><RefreshCw size={14} /> Retry</button></div>}
          <AnimatePresence mode="wait">
            {view === 'home' && (
              <ViewTransition view={view}>
                <PageHeading eyebrow="Your money" title={`${greeting()} 👋`} description="A clear view of your wallet, offline access, and recent activity." />
                <div className="home-layout">
                  <div className="home-primary">
                    <PortfolioCard totalUsd={portfolio.totalUsd} solBalance={portfolio.solBalance} activity={portfolio.activity} cluster={cluster} loading={portfolio.loading} />
                    <QuickActions onSelect={selectView} />
                    <section className="content-card">
                      <SectionTitle title="Recent activity" action={<button className="inline-link" type="button" onClick={() => selectView('activity')}>See all <ArrowRight size={14} /></button>} />
                      <TransactionTimeline activity={portfolio.activity} cluster={cluster} preview loading={portfolio.loading} />
                    </section>
                  </div>
                  <div className="home-secondary">
                    <section className="content-card assets-preview">
                      <SectionTitle title="Your assets" action={<button className="inline-link" type="button" onClick={() => selectView('assets')}>View all</button>} />
                      <TokenList assets={portfolio.assets.slice(0, 4)} loading={portfolio.loading} />
                    </section>
                    <USSDCard phoneNumber={phoneNumber} shortcode={shortcode} secure={secure} onCopy={() => void copyShortcode()} onReconnect={reconnectPhone} />
                  </div>
                </div>
              </ViewTransition>
            )}

            {view === 'assets' && (
              <ViewTransition view={view}>
                <PageHeading eyebrow="Portfolio" title="Assets" description="Everything held by your Solana wallet, sorted by value." action={<button className="secondary-action" type="button" onClick={portfolio.refresh}><RefreshCw size={15} /> Refresh</button>} />
                <div className="page-grid wide-main"><PortfolioCard totalUsd={portfolio.totalUsd} solBalance={portfolio.solBalance} activity={portfolio.activity} cluster={cluster} loading={portfolio.loading} /><section className="content-card"><SectionTitle title="All assets" /><TokenList assets={portfolio.assets} loading={portfolio.loading} /></section></div>
              </ViewTransition>
            )}

            {view === 'activity' && (
              <ViewTransition view={view}>
                <PageHeading eyebrow="Wallet history" title="Activity" description="Review confirmed, pending, sent, and received transactions." />
                <section className="content-card activity-page"><TransactionTimeline activity={portfolio.activity} cluster={cluster} loading={portfolio.loading} /></section>
              </ViewTransition>
            )}

            {view === 'ussd' && (
              <ViewTransition view={view}>
                <PageHeading eyebrow="Works without data" title="USSD access" description="Manage the phone connection that lets you reach Rove from any handset." />
                <div className="page-grid"><USSDCard phoneNumber={phoneNumber} shortcode={shortcode} secure={secure} onCopy={() => void copyShortcode()} onReconnect={reconnectPhone} /><section className="feature-card dial-card"><span className="feature-icon green"><Smartphone size={21} /></span><span className="card-kicker">Ready when you are</span><h2>Banking that works offline.</h2><p>Dial from your linked phone, send to a phone number or Solana address, and approve with your six-digit PIN.</p><a className="primary-action" href={`tel:${shortcode.replace('#', '%23')}`}><Smartphone size={17} /> Dial {shortcode}</a><div className="ussd-flow"><div><span>1</span><p><strong>Dial</strong><small>Open the service menu</small></p></div><div><span>2</span><p><strong>Choose</strong><small>Enter a phone or wallet</small></p></div><div><span>3</span><p><strong>Approve</strong><small>Enter your private PIN</small></p></div></div></section></div>
              </ViewTransition>
            )}

            {view === 'security' && (
              <ViewTransition view={view}>
                <PageHeading eyebrow="Protection" title="Security center" description="A transparent view of the controls protecting offline transactions." />
                <div className="page-grid"><SecurityCard checks={checks} verifiedAt={verifiedAt} /><section className="feature-card security-explainer"><span className="feature-icon amber"><LockKeyhole size={21} /></span><span className="card-kicker">How Rove protects you</span><h2>Your wallet stays yours.</h2><p>Rove stores a one-way PIN hash—not your PIN—and Privy signs only policy-approved SOL transfers. Private wallet keys never reach the Rove server.</p><div className="policy-summary"><div><span>Allowed action</span><strong>Native SOL transfer</strong></div><div><span>Approval channel</span><strong>Linked phone + PIN</strong></div><div><span>Replay protection</span><strong>One-time authorization</strong></div></div></section></div>
              </ViewTransition>
            )}

            {view === 'send' && (
              <ViewTransition view={view}>
                <PageHeading eyebrow="Transfer" title="Send SOL" description="Prepare a secure offline transfer to a Rove phone number or any Solana address." />
                <div className="single-panel"><SendPanel balance={portfolio.solBalance} shortcode={shortcode} onOpenUssd={() => selectView('ussd')} /></div>
              </ViewTransition>
            )}

            {view === 'receive' && (
              <ViewTransition view={view}>
                <PageHeading eyebrow="Deposit" title="Receive" description="Share your wallet address to receive SOL on the correct network." />
                <div className="single-panel"><ReceivePanel address={walletAddress} cluster={cluster} /></div>
              </ViewTransition>
            )}
          </AnimatePresence>
        </main>

        <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
          {navigation.slice(0, 4).map((item) => { const Icon = item.icon; return <button type="button" className={view === item.view ? 'active' : ''} onClick={() => selectView(item.view)} key={item.view}><Icon size={19} /><span>{item.label}</span></button>; })}
        </nav>
      </div>
      <AnimatePresence>{notice && <motion.div className="app-toast" role="status" initial={{opacity: 0, y: 15}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: 10}}><ShieldCheck size={16} /> {notice}</motion.div>}</AnimatePresence>
    </div>
  );
}
