import {createHash} from 'node:crypto';
import {Router, type Response} from 'express';
import {PublicKey, SystemProgram, Transaction} from '@solana/web3.js';
import {getConfig} from './config.js';
import {privy, solana, supabase} from './clients.js';
import {verifyPin} from './profile-routes.js';
import {formatSolBalance, formatWalletAddress, normalizePhoneNumber, parseSolAmount, safeErrorMessage, textResponse} from './utils.js';

type Profile = {
  id: string;
  solana_wallet_address: string;
  phone_number: string | null;
  hashed_pin: string | null;
  privy_wallet_id: string | null;
  failed_pin_attempts: number;
  pin_locked_until: string | null;
};

export const ussdRouter = Router();

ussdRouter.post('/ussd-blockchain', async (request, response) => {
  response.status(200).type('text/plain');

  try {
    const sessionId = String(request.body.sessionId ?? '');
    const phoneNumber = normalizePhoneNumber(String(request.body.phoneNumber ?? ''));
    const networkCode = String(request.body.networkCode ?? '');
    const text = String(request.body.text ?? '').trim();
    void networkCode; // Accepted for Africa's Talking compatibility and future network-specific rules.

    if (!sessionId || !phoneNumber) {
      return response.send(textResponse('END', 'Error: Invalid USSD request.'));
    }

    const {data: linkedProfile, error: profileError} = await supabase
      .from('profiles')
      .select('id, solana_wallet_address, phone_number, hashed_pin, privy_wallet_id, failed_pin_attempts, pin_locked_until')
      .eq('phone_number', phoneNumber)
      .maybeSingle<Profile>();
    if (profileError) throw profileError;

    if (!linkedProfile) {
      return handlePhoneLinking(phoneNumber, text, response);
    }

    return handleLinkedMenu(linkedProfile, sessionId, text, response);
  } catch (error) {
    console.error('USSD request failed:', safeErrorMessage(error));
    return response.send(textResponse('END', 'Error: Service temporarily unavailable. Please try again.'));
  }
});

async function handlePhoneLinking(phoneNumber: string, text: string, response: Response) {
  const {data: pendingProfile} = await supabase
    .from('profiles')
    .select('solana_wallet_address')
    .eq('pending_phone_number', phoneNumber)
    .maybeSingle<{solana_wallet_address: string}>();
  const pendingWallet = pendingProfile?.solana_wallet_address;

  if (text === '') {
    return response.send(textResponse(
      'CON',
      walletMessage(pendingWallet, 'Welcome! Enter the 6-digit Activation Code from your Rove dashboard:'),
    ));
  }
  if (!/^\d{6}$/.test(text)) {
    return response.send(textResponse('END', walletMessage(pendingWallet, 'Error: Invalid or expired activation code.')));
  }

  // Binding the pending number prevents a code viewed by one user from being redeemed by another phone.
  // The update predicates also make activation atomic if the USSD gateway retries the request.
  const {data, error} = await supabase
    .from('profiles')
    .update({
      phone_number: phoneNumber,
      pending_phone_number: null,
      activation_code: null,
      activation_expires_at: null,
    })
    .eq('activation_code', text)
    .eq('pending_phone_number', phoneNumber)
    .gt('activation_expires_at', new Date().toISOString())
    .is('phone_number', null)
    .select('id, solana_wallet_address')
    .maybeSingle<{id: string; solana_wallet_address: string}>();

  if (error || !data) {
    return response.send(textResponse('END', walletMessage(pendingWallet, 'Error: Invalid or expired activation code.')));
  }
  return response.send(textResponse(
    'END',
    walletMessage(data.solana_wallet_address, 'Activation successful! Your phone is linked. Redial to transact.'),
  ));
}

async function handleLinkedMenu(profile: Profile, sessionId: string, text: string, response: Response) {
  // Africa's Talking sends the complete navigation history in `text`.
  // Index 0 = root choice, 1 = recipient phone, 2 = SOL amount, 3 = PIN.
  // Example: "2*+2348012345678*0.05*1234" becomes four screen-step segments.
  const steps = text === '' ? [] : text.split('*');
  const reply = (prefix: 'CON' | 'END', message: string) => response.send(
    textResponse(prefix, walletMessage(profile.solana_wallet_address, message)),
  );

  if (steps.length === 0) {
    return reply('CON', 'Web3 Assistant\n1. Check Balance\n2. Send SOL');
  }
  if (steps[0] === '1' && steps.length === 1) {
    const balance = await solana.getBalance(new PublicKey(profile.solana_wallet_address), 'confirmed');
    return reply('END', `Your on-chain balance is: ${formatSolBalance(balance)} SOL`);
  }
  if (steps[0] !== '2') {
    return reply('END', 'Error: Invalid menu selection.');
  }
  if (steps.length === 1) {
    return reply('CON', 'Enter Recipient Phone Number:');
  }

  const recipientPhone = normalizePhoneNumber(steps[1]);
  if (!recipientPhone) {
    return reply('END', 'Error: Enter a valid international recipient phone number.');
  }
  if (steps.length === 2) {
    return reply('CON', `To: ${recipientPhone}\nEnter amount to transfer (SOL):`);
  }

  const lamports = parseSolAmount(steps[2]);
  if (!lamports) {
    return reply('END', 'Error: Enter a valid SOL amount.');
  }
  if (steps.length === 3) {
    return reply('CON', `Send ${steps[2]} SOL to ${recipientPhone}\nEnter your 4-Digit PIN to authorize:`);
  }
  if (steps.length !== 4 || !/^\d{4}$/.test(steps[3])) {
    return reply('END', 'Error: Invalid Security PIN.');
  }
  if (profile.pin_locked_until && new Date(profile.pin_locked_until).getTime() > Date.now()) {
    return reply('END', 'Error: Too many PIN attempts. Try again in 15 minutes.');
  }
  if (!profile.hashed_pin || !(await verifyPin(steps[3], profile.hashed_pin))) {
    const failedAttempts = profile.failed_pin_attempts + 1;
    await supabase.from('profiles').update({
      failed_pin_attempts: failedAttempts >= 5 ? 0 : failedAttempts,
      pin_locked_until: failedAttempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null,
    }).eq('id', profile.id);
    return reply('END', 'Error: Invalid Security PIN.');
  }
  if (profile.failed_pin_attempts > 0 || profile.pin_locked_until) {
    await supabase.from('profiles').update({failed_pin_attempts: 0, pin_locked_until: null}).eq('id', profile.id);
  }

  const {data: recipient, error: recipientError} = await supabase
    .from('profiles')
    .select('id, solana_wallet_address')
    .eq('phone_number', recipientPhone)
    .maybeSingle<{id: string; solana_wallet_address: string}>();
  if (recipientError) throw recipientError;
  if (!recipient) {
    return reply('END', 'Error: Recipient phone number is not registered.');
  }
  if (!profile.privy_wallet_id) {
    return reply('END', 'Error: Wallet is not enabled for offline signing.');
  }

  const referenceId = createHash('sha256').update(sessionId).digest('hex').slice(0, 48);
  const {data: reservation, error: reservationError} = await supabase
    .from('ussd_transfers')
    .insert({
      session_id: sessionId,
      reference_id: referenceId,
      sender_profile_id: profile.id,
      recipient_profile_id: recipient.id,
      recipient_phone_number: recipientPhone,
      amount_lamports: lamports.toString(),
      status: 'processing',
    })
    .select('id')
    .single();

  if (reservationError?.code === '23505') {
    const {data: previous} = await supabase
      .from('ussd_transfers')
      .select('status, signature, amount_lamports, recipient_phone_number')
      .eq('session_id', sessionId)
      .maybeSingle();
    if (previous?.status === 'confirmed' && previous.signature) {
      return reply('END', transferSuccessMessage(steps[2], previous.recipient_phone_number, previous.signature));
    }
    return reply('END', 'Transfer is already being processed.');
  }
  if (reservationError || !reservation) throw reservationError ?? new Error('Could not reserve transfer');

  try {
    const signature = await sendSolTransfer({
      walletId: profile.privy_wallet_id,
      fromAddress: profile.solana_wallet_address,
      toAddress: recipient.solana_wallet_address,
      lamports,
      referenceId,
    });
    const {error: persistenceError} = await supabase
      .from('ussd_transfers')
      .update({status: 'confirmed', signature})
      .eq('id', reservation.id);
    if (persistenceError) console.error('Could not persist confirmed transfer:', persistenceError.message);
    return reply('END', transferSuccessMessage(steps[2], recipientPhone, signature));
  } catch (error) {
    await supabase
      .from('ussd_transfers')
      .update({status: 'unknown', error_message: safeErrorMessage(error).slice(0, 500)})
      .eq('id', reservation.id);
    console.error('Solana transfer failed:', safeErrorMessage(error));
    return reply('END', 'Error: Transfer status is uncertain. Do not retry; check your wallet.');
  }
}

async function sendSolTransfer(input: {
  walletId: string;
  fromAddress: string;
  toAddress: string;
  lamports: bigint;
  referenceId: string;
}) {
  const config = getConfig();
  const sender = new PublicKey(input.fromAddress);
  const recipient = new PublicKey(input.toAddress);
  const {blockhash} = await solana.getLatestBlockhash('confirmed');
  const transaction = new Transaction({feePayer: sender, recentBlockhash: blockhash}).add(
    SystemProgram.transfer({
      fromPubkey: sender,
      toPubkey: recipient,
      lamports: Number(input.lamports),
    }),
  );
  const unsignedTransaction = transaction.serialize({requireAllSignatures: false, verifySignatures: false});
  const authorizationContext = config.privyAuthorizationPrivateKey
    ? {authorization_private_keys: [config.privyAuthorizationPrivateKey]}
    : undefined;

  const result = await privy.wallets().solana().signAndSendTransaction(input.walletId, {
    caip2: config.solanaCaip2,
    transaction: unsignedTransaction,
    authorization_context: authorizationContext,
    idempotency_key: input.referenceId,
    reference_id: input.referenceId,
  });
  return result.hash;
}

function transferSuccessMessage(amount: string, recipientPhone: string, signature: string) {
  return `Transfer Confirmed! Sent ${amount} SOL to ${recipientPhone}. Signature: ${signature.slice(0, 10)}...`;
}

function walletMessage(walletAddress: string | null | undefined, message: string) {
  return walletAddress ? `Wallet: ${formatWalletAddress(walletAddress)}\n${message}` : message;
}
