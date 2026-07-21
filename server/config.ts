import 'dotenv/config';
import {z} from 'zod';

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  PRIVY_APP_ID: z.string().min(1),
  PRIVY_APP_SECRET: z.string().min(1),
  PRIVY_AUTHORIZATION_PRIVATE_KEY: z.string().min(1).optional(),
  SOLANA_RPC_URL: z.string().url().default('https://api.mainnet-beta.solana.com'),
  SOLANA_CAIP2: z.enum([
    'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z',
  ]).default('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
});

export type AppConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  privyAppId: string;
  privyAppSecret: string;
  privyAuthorizationPrivateKey?: string;
  solanaRpcUrl: string;
  solanaCaip2: z.infer<typeof schema>['SOLANA_CAIP2'];
  webOrigin: string;
};

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const env = schema.parse(process.env);
  cached = {
    supabaseUrl: env.SUPABASE_URL,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    privyAppId: env.PRIVY_APP_ID,
    privyAppSecret: env.PRIVY_APP_SECRET,
    privyAuthorizationPrivateKey: env.PRIVY_AUTHORIZATION_PRIVATE_KEY,
    solanaRpcUrl: env.SOLANA_RPC_URL,
    solanaCaip2: env.SOLANA_CAIP2,
    webOrigin: env.WEB_ORIGIN,
  };
  return cached;
}
