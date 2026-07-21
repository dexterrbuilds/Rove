import type {Metadata} from 'next';
import {DM_Sans, Manrope} from 'next/font/google';
import {AppProviders} from '@/components/app-providers';
import './globals.css';

const sans = DM_Sans({subsets: ['latin'], variable: '--font-sans'});
const display = Manrope({subsets: ['latin'], variable: '--font-display'});

export const metadata: Metadata = {
  title: 'Rove — Your wallet, within reach',
  description: 'Securely access your Solana wallet from any phone with USSD.',
};

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${display.variable}`}>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
