'use client';

import {PrivyProvider} from '@privy-io/react-auth';

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export function AppProviders({children}: {children: React.ReactNode}) {
  if (!appId) {
    return (
      <main className="config-screen">
        <div className="config-card">
          <span className="eyebrow">Configuration needed</span>
          <h1>Add your Privy App ID</h1>
          <p>Set <code>NEXT_PUBLIC_PRIVY_APP_ID</code> in the web service environment, then rebuild.</p>
        </div>
      </main>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ['email', 'google', 'sms'],
        embeddedWallets: {
          ethereum: {createOnLogin: 'off'},
          solana: {createOnLogin: 'all-users'},
        },
        appearance: {
          theme: 'light',
          accentColor: '#6dff88',
          logo: '/rove-mark.svg',
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
