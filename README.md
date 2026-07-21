# Rove

Rove is an MVP bridge between a self-custodial Privy Solana wallet and feature-phone USSD. Users authenticate on the Next.js app, receive an embedded Solana wallet, link an international phone number with a short-lived code, and can then check balances or send SOL through Africa's Talking.

## Architecture

- **Web:** Next.js App Router + `@privy-io/react-auth`
- **API:** Node.js + Express, including the Africa's Talking state machine
- **Data:** Supabase Postgres, accessed only with the service role from the API
- **Wallets:** Privy self-custodial embedded Solana wallets with delegated server access
- **Chain:** `@solana/web3.js`, configured to mainnet by default

The browser never receives the Supabase service-role key, a PIN hash, the Privy app secret, or the authorization private key. PINs are bcrypt-hashed by the API. `phone_number` stays null until the pending number redeems its activation code over USSD.

## Local setup

Requirements: Node.js 20+, a Supabase project, a Privy app, and an Africa's Talking USSD channel.

1. Install packages:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` for Next.js and to `.env` for Express, then fill in the credentials. The default local ports are web `3000` and API `3001` when `PORT=3001` is present in `.env`.

3. Run [`supabase/migrations/202607210001_create_profiles.sql`](./supabase/migrations/202607210001_create_profiles.sql) in the Supabase SQL editor, or apply it with the Supabase CLI.

4. In Privy:

   - enable Email, Google, and SMS login methods;
   - enable Solana embedded wallets;
   - enable server-side wallet access/delegated actions;
   - create an authorization key and securely set its private key as `PRIVY_AUTHORIZATION_PRIVATE_KEY`;
   - configure a narrow policy for native Solana System Program transfers and an MVP transfer ceiling;
   - add localhost and deployed web origins as allowed app clients.

5. Start both services:

   ```bash
   npm run dev
   ```

6. Set the Africa's Talking callback URL to:

   ```text
   https://YOUR_API_HOST/ussd-blockchain
   ```

   Africa's Talking must send `application/x-www-form-urlencoded` POST fields named `sessionId`, `phoneNumber`, `networkCode`, and `text`.

## Environment variables

| Variable | Service | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Web | Public Privy app identifier |
| `NEXT_PUBLIC_API_URL` | Web | Public Express API origin |
| `NEXT_PUBLIC_USSD_SHORTCODE` | Web | Code shown after onboarding |
| `PORT` | API | Render-provided port; defaults to `3000` |
| `WEB_ORIGIN` | API | Comma-separated allowed CORS origins |
| `SUPABASE_URL` | API | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | API | Server-only administrative key |
| `PRIVY_APP_ID` / `PRIVY_APP_SECRET` | API | Server-side Privy credentials |
| `PRIVY_AUTHORIZATION_PRIVATE_KEY` | API | P-256 key authorizing delegated requests |
| `SOLANA_RPC_URL` | API | RPC endpoint used for balances and blockhashes |
| `SOLANA_CAIP2` | API | Must identify the same cluster as the RPC URL |

Supported CAIP-2 values are mainnet `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`, devnet `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`, and testnet `solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z`.

## USSD navigation

Africa's Talking accumulates each answer into the `text` field:

```text
""                              root menu
"1"                             check balance
"2"                             prompt for recipient
"2*+2348012345678"              prompt for amount
"2*+2348012345678*0.05"         prompt for PIN
"2*+2348012345678*0.05*1234"    validate and transfer
```

The API reserves a unique row per `sessionId` before it calls Privy. This is an idempotency barrier against gateway retries. Five incorrect PINs lock the profile for 15 minutes. Failed or uncertain transactions should be reconciled from `public.ussd_transfers` and Privy transaction webhooks before an operator retries them.

## Verification

```bash
npm run lint
npm test
npm run build
```

Before using mainnet, first test the full flow on devnet, configure an authenticated RPC provider, enable Africa's Talking request allowlisting/signature controls available to your account, add monitoring, and define operational reconciliation for transactions that broadcast successfully but time out before the USSD response returns.
