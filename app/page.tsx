'use client';

import {FormEvent, useCallback, useEffect, useMemo, useState} from 'react';
import {getAccessToken, usePrivy, useSigners, type WalletWithMetadata} from '@privy-io/react-auth';
import {useWallets} from '@privy-io/react-auth/solana';
import {ArrowRight, Check, Copy, ExternalLink, LogOut, Radio, RefreshCw, ShieldCheck, Signal, Smartphone, WalletCards} from 'lucide-react';
import {parsePhoneNumberFromString} from 'libphonenumber-js/min';

type Activation = {
  activationCode: string;
  activationExpiresAt: string;
  phoneNumber: string;
};

type ProfileStatus =
  | {status: 'not_started'; phoneNumber?: string | null; walletAddress?: string; activationExpired?: boolean}
  | {status: 'pending'; phoneNumber: string; walletAddress: string; activationCode: string; activationExpiresAt: string}
  | {status: 'linked'; phoneNumber: string; walletAddress: string; securityUpgradeRequired: boolean};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const USSD_CODE = process.env.NEXT_PUBLIC_USSD_SHORTCODE ?? '*384*1234#';
const SOLANA_CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER === 'mainnet'
  ? 'mainnet'
  : process.env.NEXT_PUBLIC_SOLANA_CLUSTER === 'testnet'
    ? 'testnet'
    : 'devnet';
const PRIVY_SIGNER_ID = process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID;
const PRIVY_POLICY_IDS = (process.env.NEXT_PUBLIC_PRIVY_POLICY_IDS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const PRIVY_POLICY_CONFIG_IS_VALID = Boolean(PRIVY_SIGNER_ID) && PRIVY_POLICY_IDS.length === 1;

function createActivationCode() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(100_000 + (values[0] % 900_000));
}

function shortenAddress(address: string) {
  return `${address.slice(0, 7)}···${address.slice(-7)}`;
}

function solanaExplorerAccountUrl(address: string) {
  const cluster = SOLANA_CLUSTER === 'mainnet' ? '' : `?cluster=${SOLANA_CLUSTER}`;
  return `https://explorer.solana.com/address/${address}${cluster}`;
}

function isValidInternationalPhone(value: string) {
  if (!value.startsWith('+')) return false;
  return parsePhoneNumberFromString(value)?.isValid() === true;
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timer = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), milliseconds);
  });
  try {
    return await Promise.race([promise, timer]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export default function Home() {
  const {ready, authenticated, login, logout, user} = usePrivy();
  const {wallets, ready: walletsReady} = useWallets();
  const {addSigners, removeSigners} = useSigners();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [pin, setPin] = useState('');
  const [activation, setActivation] = useState<Activation | null>(null);
  const [submitPhase, setSubmitPhase] = useState<'delegating' | 'registering' | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [pinTouched, setPinTouched] = useState(false);
  const [profileStatus, setProfileStatus] = useState<ProfileStatus | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [statusError, setStatusError] = useState('');
  const [checkingActivation, setCheckingActivation] = useState(false);

  const embeddedAccount = useMemo(
    () => user?.linkedAccounts.find(
      (account): account is WalletWithMetadata =>
        account.type === 'wallet' && account.walletClientType === 'privy' && account.chainType === 'solana',
    ),
    [user],
  );
  const wallet = useMemo(
    () => wallets.find((candidate) => candidate.address === embeddedAccount?.address),
    [embeddedAccount, wallets],
  );
  const walletAddress = wallet?.address;
  const phoneIsValid = isValidInternationalPhone(phoneNumber);
  const pinIsValid = /^\d{6}$/.test(pin);
  const formIsValid = Boolean(wallet && phoneIsValid && pinIsValid && PRIVY_POLICY_CONFIG_IS_VALID);

  const authorizeRestrictedSigner = useCallback(async (address: string) => {
    if (!PRIVY_POLICY_CONFIG_IS_VALID) {
      throw new Error('Rove requires exactly one Privy signer ID and one signer policy ID.');
    }

    // Privy's addSigners API appends on TEE wallets. Clear legacy/unrestricted
    // delegates first so the wallet finishes with exactly one scoped signer.
    await withTimeout(
      removeSigners({address}),
      30_000,
      'Removing the legacy Privy signer timed out. Please try again.',
    );
    await withTimeout(
      addSigners({
        address,
        signers: [{signerId: PRIVY_SIGNER_ID!, policyIds: PRIVY_POLICY_IDS}],
      }),
      30_000,
      'Adding the restricted Privy signer timed out. Please try again.',
    );
  }, [addSigners, removeSigners]);

  const refreshProfile = useCallback(async (quiet = false, showChecking = false) => {
    if (!authenticated || !walletAddress) return;
    if (!quiet) setProfileLoading(true);
    if (showChecking) setCheckingActivation(true);

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Your session expired. Please sign in again.');
      const response = await fetch(`${API_URL}/profiles/me`, {
        headers: {Authorization: `Bearer ${accessToken}`},
        cache: 'no-store',
      });
      const payload = (await response.json()) as ProfileStatus & {error?: string};
      if (!response.ok) throw new Error(payload.error ?? 'Could not restore your offline access status.');

      setProfileStatus(payload);
      setStatusError('');
      if (payload.status === 'linked') {
        setPhoneNumber(payload.phoneNumber);
        setActivation(null);
      } else if (payload.status === 'pending') {
        setPhoneNumber(payload.phoneNumber);
        setActivation({
          phoneNumber: payload.phoneNumber,
          activationCode: payload.activationCode,
          activationExpiresAt: payload.activationExpiresAt,
        });
      } else {
        setActivation(null);
        if (payload.phoneNumber) setPhoneNumber(payload.phoneNumber);
      }
    } catch (caught) {
      if (!quiet) setStatusError(caught instanceof Error ? caught.message : 'Could not load your account status.');
    } finally {
      setProfileLoading(false);
      if (showChecking) setCheckingActivation(false);
    }
  }, [authenticated, walletAddress]);

  useEffect(() => {
    if (!authenticated || !walletAddress) return;
    const timeout = window.setTimeout(() => void refreshProfile(), 0);
    return () => window.clearTimeout(timeout);
  }, [authenticated, walletAddress, refreshProfile]);

  useEffect(() => {
    if (profileStatus?.status !== 'pending') return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshProfile(true);
    }, 5_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refreshProfile(true);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [profileStatus?.status, refreshProfile]);

  useEffect(() => {
    if (!authenticated) return;
    // Keeps an active dashboard session responsive. For zero-visitor uptime, point
    // an external monitor at /api/health as documented in SETUP.local.md.
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void fetch('/api/health', {cache: 'no-store'}).catch(() => undefined);
    }, 8 * 60 * 1_000);
    return () => window.clearInterval(interval);
  }, [authenticated]);

  async function submitSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (!wallet) {
      setError('Your Solana wallet is still being created. Please try again in a moment.');
      return;
    }
    if (!PRIVY_POLICY_CONFIG_IS_VALID) {
      setError('Rove requires exactly one Privy signer ID and one signer policy ID. Correct the web configuration and rebuild.');
      return;
    }
    setPhoneTouched(true);
    setPinTouched(true);
    if (!phoneIsValid) {
      setError('Enter a valid international number, including the + and country code.');
      return;
    }
    if (!pinIsValid) {
      setError('Your security PIN must contain exactly 6 digits.');
      return;
    }

    setSubmitPhase('delegating');
    try {
      // Explicit user consent adds the app's authorization-key quorum as a scoped
      // signer. The matching private key exists only on the backend.
      await authorizeRestrictedSigner(wallet.address);

      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Your session expired. Please sign in again.');

      setSubmitPhase('registering');
      const activationCode = createActivationCode();
      const activationExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const controller = new AbortController();
      const requestTimeout = window.setTimeout(() => controller.abort(), 75_000);
      const response = await fetch(`${API_URL}/profiles/register`, {
        method: 'POST',
        signal: controller.signal,
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
      }).finally(() => window.clearTimeout(requestTimeout));
      const payload = (await response.json()) as {error?: string; activationCode?: string; activationExpiresAt?: string; phoneNumber?: string};
      if (!response.ok || !payload.activationCode || !payload.activationExpiresAt) {
        throw new Error(payload.error ?? 'Could not save your offline access settings.');
      }

      setPin('');
      const normalizedPhone = payload.phoneNumber ?? phoneNumber;
      const pendingActivation = {
        activationCode: payload.activationCode,
        activationExpiresAt: payload.activationExpiresAt,
        phoneNumber: normalizedPhone,
      };
      setPhoneNumber(normalizedPhone);
      setActivation(pendingActivation);
      setProfileStatus({
        status: 'pending',
        walletAddress: wallet.address,
        ...pendingActivation,
      });
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        setError('The Rove API took too long to wake up. Open its /health URL, wait for it to respond, then try again.');
      } else {
        setError(caught instanceof Error ? caught.message : 'Something went wrong. Please try again.');
      }
    } finally {
      setSubmitPhase(null);
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
          <div className="network-pill"><i /> Solana {SOLANA_CLUSTER}</div>
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
                <strong title={wallet.address}>{shortenAddress(wallet.address)}</strong>
                <button onClick={copyAddress}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy address'}</button>
              </>
            ) : (
              <strong>Creating wallet…</strong>
            )}
          </div>

          {profileStatus?.status === 'linked' && (
            <div className="phone-status-card">
              <span><Smartphone size={16} /> USSD phone</span>
              <strong>{profileStatus.phoneNumber}</strong>
              <small><i /> Linked and ready</small>
            </div>
          )}

          <div className="security-note">
            <ShieldCheck size={20} />
            <p><strong>Self-custodial by design.</strong><br />Rove never stores your private key.</p>
          </div>
        </aside>

        <section className="setup-panel">
          {profileLoading && !profileStatus ? (
            <StatusLoading />
          ) : profileStatus?.status === 'linked' && profileStatus.securityUpgradeRequired ? (
            <SecurityUpgrade
              walletAddress={profileStatus.walletAddress}
              onAuthorizeSigner={() => authorizeRestrictedSigner(profileStatus.walletAddress)}
              onComplete={() => void refreshProfile()}
            />
          ) : profileStatus?.status === 'linked' ? (
            <OfflineAccessReady profile={profileStatus} />
          ) : activation ? (
            <ActivationSuccess
              activation={activation}
              walletAddress={wallet?.address ?? profileStatus?.walletAddress ?? ''}
              checking={checkingActivation}
              onRefresh={() => void refreshProfile(true, true)}
            />
          ) : (
            <>
              <div className="step-label"><span>01</span> OFFLINE ACCESS</div>
              <h2>Connect your phone</h2>
              <p className="lede">Your number becomes a simple address for sending and receiving SOL over USSD.</p>

              {profileStatus?.status === 'not_started' && profileStatus.activationExpired && (
                <div className="notice-card"><Radio size={17} /><p><strong>Your previous code expired.</strong><br />Confirm your number and PIN to generate a fresh one.</p></div>
              )}
              {statusError && (
                <div className="form-error status-error" role="alert">
                  <span>{statusError}</span>
                  <button type="button" onClick={() => void refreshProfile()}><RefreshCw size={14} /> Retry</button>
                </div>
              )}

              <form onSubmit={submitSetup} className="setup-form">
                <label>
                  <span>International phone number</span>
                  <div className={`input-shell ${phoneTouched && !phoneIsValid ? 'invalid' : ''}`}><Smartphone size={19} /><input type="tel" inputMode="tel" autoComplete="tel" placeholder="+234 801 234 5678" value={phoneNumber} aria-invalid={phoneTouched && !phoneIsValid} onBlur={() => setPhoneTouched(true)} onChange={(event) => { setPhoneNumber(event.target.value.replace(/[\s()-]/g, '')); setError(''); }} /></div>
                  <small className={phoneTouched && !phoneIsValid ? 'field-error' : ''}>{phoneTouched && !phoneIsValid ? 'Enter a complete international number, including country code.' : 'Use the number you will dial the USSD code from.'}</small>
                </label>
                <label>
                  <span>6-digit transaction PIN</span>
                  <div className={`input-shell pin-shell ${pinTouched && !pinIsValid ? 'invalid' : ''}`}><ShieldCheck size={19} /><input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} placeholder="••••••" value={pin} aria-invalid={pinTouched && !pinIsValid} onBlur={() => setPinTouched(true)} onChange={(event) => { setPin(event.target.value.replace(/\D/g, '').slice(0, 6)); setError(''); }} /></div>
                  <small className={pinTouched && !pinIsValid ? 'field-error' : ''}>{pinTouched && !pinIsValid ? 'Enter exactly six digits.' : 'This PIN approves offline transfers. Never share it.'}</small>
                </label>
                {error && <div className="form-error" role="alert">{error}</div>}
                {!PRIVY_POLICY_CONFIG_IS_VALID && <div className="form-error" role="alert">Privy requires exactly one signer and policy. Set <code>NEXT_PUBLIC_PRIVY_SIGNER_ID</code> and one value in <code>NEXT_PUBLIC_PRIVY_POLICY_IDS</code>, then rebuild.</div>}
                <button className="primary-button" type="submit" disabled={Boolean(submitPhase) || !formIsValid} aria-busy={Boolean(submitPhase)}>
                  {submitPhase === 'delegating' ? 'Adding secure signer…' : submitPhase === 'registering' ? 'Saving secure setup…' : 'Generate activation code'} <ArrowRight size={18} />
                </button>
              </form>
            </>
          )}
        </section>
      </section>
    </main>
  );
}

function ActivationSuccess({
  activation,
  walletAddress,
  checking,
  onRefresh,
}: {
  activation: Activation;
  walletAddress: string;
  checking: boolean;
  onRefresh: () => void;
}) {
  const [remainingSeconds, setRemainingSeconds] = useState(15 * 60);
  const [copiedItem, setCopiedItem] = useState<'code' | 'shortcode' | null>(null);
  useEffect(() => {
    const updateCountdown = () => setRemainingSeconds(Math.max(
      0,
      Math.ceil((new Date(activation.activationExpiresAt).getTime() - Date.now()) / 1_000),
    ));
    const timeout = window.setTimeout(updateCountdown, 0);
    const interval = window.setInterval(updateCountdown, 1_000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [activation.activationExpiresAt]);

  const expiration = new Date(activation.activationExpiresAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});

  async function copyValue(item: 'code' | 'shortcode', value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedItem(item);
    window.setTimeout(() => setCopiedItem(null), 1_800);
  }

  return (
    <div className="success-wrap">
      <div className="success-icon"><Check size={28} strokeWidth={2.5} /></div>
      <div className="step-label"><span>02</span> ACTIVATE</div>
      <h2>Finish on your phone</h2>
      <p className="lede">Dial <strong>{USSD_CODE}</strong> from <strong>{activation.phoneNumber}</strong>, then enter this one-time code.</p>
      <button className="activation-code" type="button" onClick={() => void copyValue('code', activation.activationCode)} aria-label={`Copy activation code ${activation.activationCode}`}>
        {activation.activationCode.split('').map((digit, index) => <span key={`${digit}-${index}`}>{digit}</span>)}
      </button>
      <div className={`expiry ${remainingSeconds === 0 ? 'expired' : ''}`}>
        <Radio size={16} /> {remainingSeconds > 0 ? `Expires in ${formatCountdown(remainingSeconds)} · ${expiration}` : 'Code expired—checking your status'}
      </div>
      {walletAddress && <div className="activation-wallet"><WalletCards size={15} /> <span>Wallet</span><code>{walletAddress}</code></div>}
      <div className="activation-actions">
        <a className="secondary-button" href={`tel:${USSD_CODE.replace('#', '%23')}`}><Smartphone size={16} /> Dial {USSD_CODE}</a>
        <button className="secondary-button" type="button" onClick={() => void copyValue('shortcode', USSD_CODE)}>
          {copiedItem === 'shortcode' ? <Check size={16} /> : <Copy size={16} />} {copiedItem === 'shortcode' ? 'Copied' : 'Copy shortcode'}
        </button>
      </div>
      {copiedItem === 'code' && <div className="copy-toast" role="status"><Check size={14} /> Activation code copied</div>}
      <div className="ussd-steps">
        <div><span>1</span><p><strong>Dial the shortcode</strong><br />Open your phone dialer and enter {USSD_CODE}</p></div>
        <div><span>2</span><p><strong>Enter the code above</strong><br />Your number will be linked instantly.</p></div>
        <div><span>3</span><p><strong>Redial to transact</strong><br />Check balances or send SOL without data.</p></div>
      </div>
      <button className="check-status-button" type="button" onClick={onRefresh} disabled={checking}>
        <RefreshCw size={15} className={checking ? 'spinning' : ''} /> {checking ? 'Checking activation…' : 'I completed activation'}
      </button>
    </div>
  );
}

function OfflineAccessReady({profile}: {profile: Extract<ProfileStatus, {status: 'linked'}>}) {
  const [copied, setCopied] = useState(false);

  async function copyShortcode() {
    await navigator.clipboard.writeText(USSD_CODE);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  }

  return (
    <div className="ready-wrap">
      <div className="success-icon"><Check size={28} strokeWidth={2.5} /></div>
      <div className="step-label"><span>✓</span> OFFLINE ACCESS ACTIVE</div>
      <h2>Your phone is ready</h2>
      <p className="lede"><strong>{profile.phoneNumber}</strong> is securely linked to your Rove wallet.</p>
      <div className="ready-summary">
        <div><Smartphone size={18} /><span>Linked phone</span><strong>{profile.phoneNumber}</strong></div>
        <div><WalletCards size={18} /><span>Solana wallet</span><code>{profile.walletAddress}</code></div>
      </div>
      <div className="ready-callout">
        <span>Dial from your linked phone</span>
        <strong>{USSD_CODE}</strong>
        <p>Check your SOL balance or send SOL to another registered number—no mobile data needed.</p>
      </div>
      <div className="activation-actions">
        <a className="primary-button" href={`tel:${USSD_CODE.replace('#', '%23')}`}><Smartphone size={17} /> Dial now</a>
        <button className="secondary-button" type="button" onClick={() => void copyShortcode()}>
          {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy code'}
        </button>
      </div>
      <a className="explorer-link" href={solanaExplorerAccountUrl(profile.walletAddress)} target="_blank" rel="noreferrer">
        View wallet on Solana Explorer <ExternalLink size={14} />
      </a>
    </div>
  );
}

function SecurityUpgrade({
  walletAddress,
  onAuthorizeSigner,
  onComplete,
}: {
  walletAddress: string;
  onAuthorizeSigner: () => Promise<void>;
  onComplete: () => void;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const valid = /^\d{6}$/.test(pin) && PRIVY_POLICY_CONFIG_IS_VALID;

  async function upgrade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid) return;
    setSaving(true);
    setError('');
    try {
      // The authenticated wallet owner explicitly replaces the legacy signer in
      // Privy's client SDK. The API independently attests the resulting controls.
      await onAuthorizeSigner();
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Your session expired. Sign in again.');
      const response = await fetch(`${API_URL}/profiles/security/upgrade`, {
        method: 'POST',
        headers: {Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({walletAddress, pin}),
      });
      const payload = await response.json() as {error?: string};
      if (!response.ok) throw new Error(payload.error ?? 'Security upgrade failed.');
      setPin('');
      onComplete();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Security upgrade failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ready-wrap">
      <div className="success-icon"><ShieldCheck size={28} strokeWidth={2.5} /></div>
      <div className="step-label"><span>!</span> SECURITY UPGRADE</div>
      <h2>Secure offline access</h2>
      <p className="lede">Before offline transactions, replace the legacy PIN and bind the delegated signer to Rove&apos;s restricted Privy policy.</p>
      <form className="setup-form security-upgrade-form" onSubmit={upgrade}>
        <label>
          <span>New 6-digit transaction PIN</span>
          <div className="input-shell pin-shell"><ShieldCheck size={19} /><input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} placeholder="••••••" value={pin} onChange={(event) => { setPin(event.target.value.replace(/\D/g, '').slice(0, 6)); setError(''); }} /></div>
          <small>The previous four-digit PIN cannot authorize another transfer.</small>
        </label>
        {error && <div className="form-error" role="alert">{error}</div>}
        {!PRIVY_POLICY_CONFIG_IS_VALID && <div className="form-error" role="alert">Rove&apos;s signer policy configuration is invalid. Contact the operator.</div>}
        <button className="primary-button" type="submit" disabled={!valid || saving} aria-busy={saving}>
          {saving ? 'Applying security controls…' : 'Complete security upgrade'} <ArrowRight size={18} />
        </button>
      </form>
    </div>
  );
}

function StatusLoading() {
  return (
    <div className="status-loading">
      <div className="loader" />
      <h2>Restoring your setup</h2>
      <p>Checking whether your phone is already linked…</p>
    </div>
  );
}

function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
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
