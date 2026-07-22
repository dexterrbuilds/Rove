import 'dotenv/config';
import {z} from 'zod';

const csv = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);
const optionalSecret = (minimumLength: number) => z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string().min(minimumLength).optional(),
);

export function requireSinglePrivyIdentifier(value: string | undefined, label: string) {
  const identifiers = csv(value ?? '');
  if (identifiers.length !== 1) throw new Error(`${label} must contain exactly one ID.`);
  return identifiers[0];
}

const schema = z.object({
  ROVE_ENVIRONMENT: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  PRIVY_APP_ID: z.string().min(1),
  PRIVY_APP_SECRET: z.string().min(1),
  PRIVY_SIGNER_ID: z.string().min(1).refine((value) => !value.includes(',')),
  PRIVY_POLICY_ID: z.string().min(1).refine((value) => !value.includes(',')),
  PRIVY_AUTHORIZATION_KEYRING_JSON: optionalSecret(2),
  PRIVY_AUTHORIZATION_ACTIVE_KEY_IDS: z.string().default(''),
  // Legacy development fallback. Production/staging require the environment-bound keyring.
  PRIVY_AUTHORIZATION_PRIVATE_KEY: optionalSecret(1),
  PIN_PEPPER: z.string().min(32),
  PIN_HASH_VERSION: z.coerce.number().int().min(2).max(32767).default(2),
  PIN_MAX_FAILURES: z.coerce.number().int().min(2).max(20).default(5),
  PIN_LOCK_SECONDS: z.coerce.number().int().min(60).max(86400).default(900),
  AFRICASTALKING_USSD_CALLBACK_TOKEN: z.string().min(32),
  AFRICASTALKING_USSD_SERVICE_CODE: z.string().min(3),
  AFRICASTALKING_USSD_ALLOWED_IPS: z.string().default(''),
  USSD_EDGE_HMAC_SECRET: optionalSecret(32),
  AFRICASTALKING_ALLOWED_COUNTRY_CODES: z.string().min(2),
  AFRICASTALKING_ALLOWED_NETWORK_CODES: z.string().min(1),
  USSD_SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(600).default(180),
  TRANSACTION_AUTH_TTL_SECONDS: z.coerce.number().int().min(15).max(120).default(60),
  MAX_TRANSFER_SOL: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/).default('1'),
  SOLANA_RPC_URL: z.string().url().default('https://api.mainnet-beta.solana.com'),
  SOLANA_CAIP2: z.enum([
    'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z',
  ]).default('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
});

export type AppConfig = {
  environment: z.infer<typeof schema>['ROVE_ENVIRONMENT'];
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  privyAppId: string;
  privyAppSecret: string;
  privySignerId: string;
  privyPolicyId: string;
  privyAuthorizationKeyringJson?: string;
  privyAuthorizationActiveKeyIds: string[];
  privyAuthorizationPrivateKey?: string;
  pinPepper: string;
  pinHashVersion: number;
  pinMaxFailures: number;
  pinLockSeconds: number;
  africasTalkingUssdCallbackToken: string;
  africasTalkingUssdServiceCode: string;
  africasTalkingUssdAllowedIps: string[];
  ussdEdgeHmacSecret?: string;
  africasTalkingAllowedCountryCodes: string[];
  africasTalkingAllowedNetworkCodes: string[];
  ussdSessionTtlSeconds: number;
  transactionAuthTtlSeconds: number;
  maxTransferSol: string;
  solanaRpcUrl: string;
  solanaCaip2: z.infer<typeof schema>['SOLANA_CAIP2'];
  webOrigin: string;
};

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const env = schema.parse(process.env);
  const allowedIps = csv(env.AFRICASTALKING_USSD_ALLOWED_IPS)
    .map((ip) => ip.replace(/^::ffff:/, ''));
  const activeKeyIds = csv(env.PRIVY_AUTHORIZATION_ACTIVE_KEY_IDS);
  const countries = csv(env.AFRICASTALKING_ALLOWED_COUNTRY_CODES).map((code) => code.toUpperCase());
  const networks = csv(env.AFRICASTALKING_ALLOWED_NETWORK_CODES);

  if (countries.length === 0 || networks.length === 0) {
    throw new Error('At least one allowed USSD country and network code is required.');
  }
  if (env.ROVE_ENVIRONMENT === 'production' && allowedIps.length === 0 && !env.USSD_EDGE_HMAC_SECRET) {
    throw new Error('Production USSD requires a source-IP allowlist or trusted-edge HMAC verification.');
  }
  if (['staging', 'production'].includes(env.ROVE_ENVIRONMENT)
      && (!env.PRIVY_AUTHORIZATION_KEYRING_JSON || activeKeyIds.length === 0)) {
    throw new Error('Staging and production require an environment-bound Privy authorization keyring.');
  }

  cached = {
    environment: env.ROVE_ENVIRONMENT,
    supabaseUrl: env.SUPABASE_URL,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    privyAppId: env.PRIVY_APP_ID,
    privyAppSecret: env.PRIVY_APP_SECRET,
    privySignerId: env.PRIVY_SIGNER_ID,
    privyPolicyId: env.PRIVY_POLICY_ID,
    privyAuthorizationKeyringJson: env.PRIVY_AUTHORIZATION_KEYRING_JSON,
    privyAuthorizationActiveKeyIds: activeKeyIds,
    privyAuthorizationPrivateKey: env.PRIVY_AUTHORIZATION_PRIVATE_KEY,
    pinPepper: env.PIN_PEPPER,
    pinHashVersion: env.PIN_HASH_VERSION,
    pinMaxFailures: env.PIN_MAX_FAILURES,
    pinLockSeconds: env.PIN_LOCK_SECONDS,
    africasTalkingUssdCallbackToken: env.AFRICASTALKING_USSD_CALLBACK_TOKEN,
    africasTalkingUssdServiceCode: env.AFRICASTALKING_USSD_SERVICE_CODE,
    africasTalkingUssdAllowedIps: allowedIps,
    ussdEdgeHmacSecret: env.USSD_EDGE_HMAC_SECRET,
    africasTalkingAllowedCountryCodes: countries,
    africasTalkingAllowedNetworkCodes: networks,
    ussdSessionTtlSeconds: env.USSD_SESSION_TTL_SECONDS,
    transactionAuthTtlSeconds: env.TRANSACTION_AUTH_TTL_SECONDS,
    maxTransferSol: env.MAX_TRANSFER_SOL,
    solanaRpcUrl: env.SOLANA_RPC_URL,
    solanaCaip2: env.SOLANA_CAIP2,
    webOrigin: env.WEB_ORIGIN,
  };
  return cached;
}

export function resetConfigForTests() {
  cached = undefined;
}
