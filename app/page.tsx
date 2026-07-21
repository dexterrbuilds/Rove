'use client';

import {FormEvent, useMemo, useState} from 'react';
import {getAccessToken, useHeadlessDelegatedActions, usePrivy, type WalletWithMetadata} from '@privy-io/react-auth';
import {useWallets} from '@privy-io/react-auth/solana';
import {ArrowRight, Check, Copy, LogOut, Radio, ShieldCheck, Signal, Smartphone, WalletCards} from 'lucide-react';

type Activation = {
  activationCode: string;
  activationExpiresAt: string;
  phoneNumber: string;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const USSD_CODE = process.env.NEXT_PUBLIC_USSD_SHORTCODE ?? '*384*1234#';

function createActivationCode() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(100_000 + (values[0] % 900_000));
}

function shortenAddress(address: string) {
  return `${address.slice(0, 7)}···${address.slice(-7)}`;
}

export default function Home() {
  const {ready, authenticated, login, logout, user} = usePrivy();
  const {wallets, ready: walletsReady} = useWallets();
  const {delegateWallet} = useHeadlessDelegatedActions();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [pin, setPin] = useState('');
  const [activation, setActivation] = useState<Activation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const wallet = useMemo(() => {
    const embeddedAddress = user?.linkedAccounts.find(
      (account): account is WalletWithMetadata =>
        account.type === 'wallet' && account.walletClientType === 'privy' && account.chainType === 'solana',
    )?.address;
    return wallets.find((candidate) => candidate.address === embeddedAddress);
  }, [user, wallets]);

  async function submitSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (!wallet) {
      setError('Your Solana wallet is still being created. Please try again in a moment.');
      return;
    }
    if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) {
      setError('Enter a valid international number, including the + and country code.');
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setError('Your security PIN must contain exactly 4 digits.');
      return;
    }

    setSubmitting(true);
    try {
      // Explicit consent is required before the server can sign while the user is offline.
      await delegateWallet({address: wallet.address, chainType: 'solana'});

      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Your session expired. Please sign in again.');

      const activationCode = createActivationCode();
      const activationExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const response = await fetch(`${API_URL}/profiles/register`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          walletAddress: wallet.address,
          phoneNumber,
          pin,
          activationCode,
          activationExpiresAt,
        }),
      });
      const payload = (await response.json()) as {error?: string; activationCode?: string; activationExpiresAt?: string};
      if (!response.ok || !payload.activationCode || !payload.activationExpiresAt) {
        throw new Error(payload.error ?? 'Could not save your offline access settings.');
      }

      setPin('');
      setActivation({
        activationCode: payload.activationCode,
        activationExpiresAt: payload.activationExpiresAt,
        phoneNumber,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function copyAddress() {
    if (!wallet) return;
    await navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  if (!ready || (authenticated && !walletsReady)) {
    return <LoadingScreen />;
  }

  if (!authenticated) {
    return <Onboarding onLogin={login} />;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Brand />
        <div className="topbar-actions">
          <div className="network-pill"><i /> Solana mainnet</div>
          <button className="icon-button" onClick={logout} aria-label="Log out"><LogOut size={18} /></button>
        </div>
      </header>

      <section className="dashboard-grid">
        <aside className="account-panel">
          <div>
            <span className="eyebrow muted">Your account</span>
            <h1>Good to see you.</h1>
            <p>Set up secure offline access to move SOL from any mobile phone.</p>
          </div>

          <div className="wallet-card">
            <div className="wallet-card-head">
              <span><WalletCards size={17} /> Embedded wallet</span>
              <span className="live-badge">Active</span>
            </div>
            {wallet ? (
              <>
                <strong>{shortenAddress(wallet.address)}</strong>
                <button onClick={copyAddress}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy address'}</button>
              </>
            ) : (
              <strong>Creating wallet…</strong>
            )}
          </div>

          <div className="security-note">
            <ShieldCheck size={20} />
            <p><strong>Self-custodial by design.</strong><br />Rove never stores your private key.</p>
          </div>
        </aside>

        <section className="setup-panel">
          {activation ? (
            <ActivationSuccess activation={activation} />
          ) : (
            <>
              <div className="step-label"><span>01</span> OFFLINE ACCESS</div>
              <h2>Connect your phone</h2>
              <p className="lede">Your number becomes a simple address for sending and receiving SOL over USSD.</p>

              <form onSubmit={submitSetup} className="setup-form">
                <label>
                  <span>International phone number</span>
                  <div className="input-shell"><Smartphone size={19} /><input type="tel" inputMode="tel" autoComplete="tel" placeholder="+234 801 234 5678" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value.replace(/[\s()-]/g, ''))} /></div>
                  <small>Use the number you will dial the USSD code from.</small>
                </label>
                <label>
                  <span>4-digit transaction PIN</span>
                  <div className="input-shell pin-shell"><ShieldCheck size={19} /><input type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} placeholder="••••" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))} /></div>
                  <small>This PIN approves offline transfers. Never share it.</small>
                </label>
                {error && <div className="form-error" role="alert">{error}</div>}
                <button className="primary-button" type="submit" disabled={submitting || !wallet}>
                  {submitting ? 'Securing access…' : 'Generate activation code'} <ArrowRight size={18} />
                </button>
              </form>
            </>
          )}
        </section>
      </section>
    </main>
  );
}

function ActivationSuccess({activation}: {activation: Activation}) {
  const expiration = new Date(activation.activationExpiresAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  return (
    <div className="success-wrap">
      <div className="success-icon"><Check size={28} strokeWidth={2.5} /></div>
      <div className="step-label"><span>02</span> ACTIVATE</div>
      <h2>Finish on your phone</h2>
      <p className="lede">Dial <strong>{USSD_CODE}</strong> from <strong>{activation.phoneNumber}</strong>, then enter this one-time code.</p>
      <div className="activation-code" aria-label={`Activation code ${activation.activationCode}`}>
        {activation.activationCode.split('').map((digit, index) => <span key={`${digit}-${index}`}>{digit}</span>)}
      </div>
      <div className="expiry"><Radio size={16} /> Code expires at {expiration}</div>
      <div className="ussd-steps">
        <div><span>1</span><p><strong>Dial the shortcode</strong><br />Open your phone dialer and enter {USSD_CODE}</p></div>
        <div><span>2</span><p><strong>Enter the code above</strong><br />Your number will be linked instantly.</p></div>
        <div><span>3</span><p><strong>Redial to transact</strong><br />Check balances or send SOL without data.</p></div>
      </div>
    </div>
  );
}

function Onboarding({onLogin}: {onLogin: () => void}) {
  return (
    <main className="landing">
      <nav><Brand /><button className="nav-button" onClick={onLogin}>Sign in</button></nav>
      <section className="hero">
        <div className="hero-copy">
          <div className="availability"><i /> BUILT FOR EVERY PHONE</div>
          <h1>Your wallet.<br /><em>Within reach.</em></h1>
          <p>Send SOL, check your balance, and stay connected to Web3—even when the internet isn’t.</p>
          <button className="primary-button hero-button" onClick={onLogin}>Create your wallet <ArrowRight size={19} /></button>
          <small>No seed phrase to start. Your keys remain yours.</small>
        </div>
        <div className="phone-scene" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="phone">
            <div className="speaker" />
            <div className="phone-screen">
              <Signal size={17} />
              <span className="ussd-label">ROVE · USSD</span>
              <h3>Web3 Assistant</h3>
              <p>1. Check Balance</p>
              <p>2. Send SOL</p>
              <div className="ussd-input">Reply…</div>
            </div>
          </div>
          <div className="float-card card-one"><ShieldCheck size={18} /> Secure by Privy</div>
          <div className="float-card card-two"><i /> Online on Solana</div>
        </div>
      </section>
      <footer className="trust-row"><span>POWERED BY</span><strong>Solana</strong><strong>Privy</strong><strong>Supabase</strong><strong>Africa&apos;s Talking</strong></footer>
    </main>
  );
}

function LoadingScreen() {
  return <main className="loading"><Brand /><div className="loader" /><p>Preparing your wallet</p></main>;
}

function Brand() {
  return <div className="brand"><span className="brand-mark"><span /></span><strong>rove</strong></div>;
}
