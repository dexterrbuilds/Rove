# Rove

**Your Solana wallet, within reach—even without mobile data.**

Rove connects self-custodial Solana wallets to the mobile phones people already use. A user creates a wallet through a simple web experience, securely links their phone number, and can then check their balance or send SOL through USSD.

The project explores a practical question: what would Web3 access look like if a smartphone, banking app, or reliable internet connection were not prerequisites?

## Why Rove

Millions of mobile users rely on feature phones, intermittent connectivity, or low-cost USSD services for everyday financial activity. Most blockchain products assume the opposite: a modern smartphone, a persistent data connection, a browser wallet, and familiarity with seed phrases.

Rove bridges that gap by making a Solana wallet accessible through a familiar, session-based mobile menu while keeping wallet creation and account recovery within a self-custodial system.

## How it works

1. **Create a wallet** — The user signs in with email, Google, or SMS and receives a Privy-powered embedded Solana wallet.
2. **Link a phone** — The user chooses a six-digit transaction PIN and receives a short-lived activation code.
3. **Activate through USSD** — Dialing the Rove shortcode from the registered phone links that number to the wallet.
4. **Transact offline** — The user can redial the shortcode to check their on-chain balance or send SOL to a registered phone number or any valid Solana address.

```text
Rove Wallet
1. Check Balance
2. Receive
3. Send SOL
4. Send to Local Bank (Demo)
5. Buy Airtime (Demo)
6. Pay Bills (Demo)
7. Recent Transactions
8. Exit
```

## MVP capabilities

- Email, Google, and SMS onboarding
- Automatic self-custodial Solana wallet provisioning
- Secure phone activation with six-digit, time-limited codes
- Native SOL balance checks over USSD
- SOL transfers to wallet addresses or verified Rove phone numbers
- Six-digit offline transaction authorization
- Isolated demo previews for bank transfers, airtime, and bills
- Combined on-chain and demo transaction history
- Replaceable payment-provider interfaces for future integrations
- Delegated signing for user-approved offline wallet access
- Protection against duplicate transfers caused by webhook retries
- PIN attempt lockouts and transaction reconciliation records
- Responsive web onboarding for mobile and desktop

## Architecture

Rove is organized as four cooperating layers:

- **Next.js frontend** for authentication, wallet onboarding, phone registration, and activation guidance
- **Node.js Express API** for authenticated profile registration and the Africa's Talking USSD state machine
- **Supabase Postgres** for wallet profiles, phone-linking state, PIN hashes, and transfer records
- **Privy and Solana** for self-custodial embedded wallets, delegated authorization, balances, and native transfers

Africa's Talking sends the user's accumulated USSD choices to the API. Rove determines the current menu step, verifies the linked profile and transaction PIN, resolves the recipient's wallet, and asks Privy to sign and broadcast the Solana transaction.

## Security model

Rove is designed so sensitive server credentials and PIN hashes never reach the browser.

- Transaction PINs are peppered server-side and stored as versioned bcrypt hashes.
- Phone numbers remain pending until activated from the intended handset.
- Activation codes expire after 15 minutes and are cleared after use.
- Wallet ownership is verified against the authenticated Privy user.
- Offline signing requires explicit wallet delegation from the user.
- Each USSD session can reserve only one transfer, preventing gateway retries from sending funds twice.
- Repeated invalid PIN attempts temporarily lock offline transactions.
- Supabase tables are protected from anonymous and browser-level access.

## Project status

Rove is an MVP framework intended for development, testing, and validation of the offline Solana experience. The application includes the complete onboarding, phone-linking, balance, and transfer flows, together with a deployment blueprint and database schema.

Production operation requires infrastructure-level monitoring, transaction reconciliation, a dedicated Solana RPC provider, strict Privy transfer policies, and the request-security controls supported by the selected USSD provider.

## Technology

Next.js · React · TypeScript · Node.js · Express · Supabase · Privy · Solana · Africa's Talking

## Vision

Rove's goal is to make access to open financial networks feel as ordinary as checking airtime: available from almost any phone, understandable without crypto expertise, and secure enough for everyday use.
