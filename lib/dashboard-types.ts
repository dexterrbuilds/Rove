export type DashboardView = 'home' | 'assets' | 'activity' | 'ussd' | 'security' | 'send' | 'receive';

export type ProfileStatus =
  | {status: 'not_started'; phoneNumber?: string | null; walletAddress?: string; activationExpired?: boolean}
  | {status: 'pending'; phoneNumber: string; walletAddress: string; activationCode: string; activationExpiresAt: string}
  | {status: 'linked'; phoneNumber: string; walletAddress: string; securityUpgradeRequired: boolean};

export type WalletAsset = {
  mint: string;
  name: string;
  symbol: string;
  balance: number;
  decimals: number;
  usdPrice: number | null;
  usdValue: number | null;
  change24h: number | null;
  logoUrl?: string;
  isNative?: boolean;
};

export type ActivityDirection = 'sent' | 'received';
export type ActivityStatus = 'confirmed' | 'pending' | 'failed';
export type ActivitySource = 'ussd' | 'dashboard' | 'received' | 'onchain';

export type WalletActivity = {
  signature: string;
  token: string;
  amount: number | null;
  direction: ActivityDirection;
  status: ActivityStatus;
  source: ActivitySource;
  timestamp: number | null;
  feeSol?: number;
};

export type PortfolioData = {
  assets: WalletAsset[];
  activity: WalletActivity[];
  solBalance: number;
  solPrice: number | null;
  totalUsd: number | null;
};
