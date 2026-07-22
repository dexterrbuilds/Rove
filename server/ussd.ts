import {createHash, randomBytes} from 'node:crypto';
import {Router, type NextFunction, type Request, type Response} from 'express';
import rateLimit from 'express-rate-limit';
import {PublicKey, SystemProgram, Transaction} from '@solana/web3.js';
import {authorizationKeyProvider, privy, solana, supabase} from './clients.js';
import {getConfig} from './config.js';
import {createPinMaterial} from './pin-security.js';
import {attestWalletSecurity} from './privy-security.js';
import {authorizeSessionAnswer, hashUssdHistory} from './security-state.js';
import {isAuthenticUssdCallback} from './ussd-auth.js';
import {formatSolBalance, formatWalletAddress, parseSolAmount, safeErrorMessage, textResponse, validatePhoneCountry} from './utils.js';

type Profile = {
  id: string;
  solana_wallet_address: string;
  phone_number: string | null;
  privy_wallet_id: string | null;
  privy_user_id: string | null;
  privy_owner_id: string | null;
  pin_hash_version: number | null;
  signer_policy_id: string | null;
};

type UssdSession = {
  id: string;
  provider_session_id: string;
  phone_number: string;
  profile_id: string | null;
  current_step: 'activation' | 'menu' | 'recipient' | 'amount' | 'pin' | 'completed';
  expected_segments: number;
  history_hash: string;
  recipient_profile_id: string | null;
  recipient_phone_number: string | null;
  amount_lamports: number | string | null;
  expires_at: string;
  consumed_at: string | null;
};

type AuthenticatedUssdRequest = Request & {rawBody?: Buffer};

export const ussdRouter = Router();

function authenticateUssdCallback(request: AuthenticatedUssdRequest, response: Response, next: NextFunction) {
  const config = getConfig();
  const suppliedToken = typeof request.query.at_token === 'string' ? request.query.at_token : '';
  const sourceIp = String(request.ip || request.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (!isAuthenticUssdCallback({
    suppliedToken,
    expectedToken: config.africasTalkingUssdCallbackToken,
    suppliedServiceCode: String(request.body.serviceCode ?? ''),
    expectedServiceCode: config.africasTalkingUssdServiceCode,
    sourceIp,
    allowedIps: config.africasTalkingUssdAllowedIps,
    edgeHmacSecret: config.ussdEdgeHmacSecret,
    edgeTimestamp: request.get('x-rove-edge-timestamp'),
    edgeSignature: request.get('x-rove-edge-signature'),
    rawBody: request.rawBody,
    requireNetworkProof: config.environment === 'production',
  })) {
    return response.status(403).type('text/plain').send('END Unauthorized USSD request.');
  }
  return next();
}

const authenticatedUssdRateLimit = rateLimit({
  windowMs: 5 * 60 * 1_000,
  limit: 90,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (request) => createHash('sha256')
    .update(String(request.body.phoneNumber ?? 'missing'))
    .digest('hex'),
  handler: (_request, response) => response.status(429).type('text/plain').send('END Too many requests. Try again later.'),
});

ussdRouter.post('/ussd-blockchain', authenticateUssdCallback, authenticatedUssdRateLimit, async (request, response) => {
  response.status(200).type('text/plain');
  try {
    const config = getConfig();
    const sessionId = String(request.body.sessionId ?? '');
    const phone = validatePhoneCountry(String(request.body.phoneNumber ?? ''), config.africasTalkingAllowedCountryCodes);
    const networkCode = String(request.body.networkCode ?? '');
    const text = String(request.body.text ?? '').trim();

    if (!/^[\w:.-]{1,200}$/.test(sessionId)
        || !phone
        || !config.africasTalkingAllowedNetworkCodes.includes(networkCode)
        || text.length > 300) {
      return response.send(textResponse('END', 'Error: Invalid USSD request.'));
    }

    const profile = await findLinkedProfile(phone.phoneNumber);
    if (text === '') {
      const session = await createOrLoadSession({
        sessionId,
        phoneNumber: phone.phoneNumber,
        countryCode: phone.countryCode,
        networkCode,
        profile,
      });
      if (!session || session.phone_number !== phone.phoneNumber || session.consumed_at
          || new Date(session.expires_at).getTime() <= Date.now()) {
        return response.send(textResponse('END', 'Error: Invalid or expired USSD session.'));
      }
      return response.send(initialSessionPrompt(session, profile?.solana_wallet_address));
    }

    const session = await loadActiveSession(sessionId, phone.phoneNumber);
    if (!session) return response.send(textResponse('END', 'Error: Invalid or expired USSD session. Redial to start again.'));

    const answer = authorizeSessionAnswer(session, {
      providerSessionId: sessionId,
      phoneNumber: phone.phoneNumber,
      text,
    });
    if (answer === null) {
      return response.send(textResponse('END', walletMessage(profile?.solana_wallet_address, 'Error: Invalid, changed, or replayed USSD step. Redial to start again.')));
    }

    if (session.current_step === 'activation') {
      return handleActivationSession(session, answer, phone.phoneNumber, response);
    }
    if (!profile || session.profile_id !== profile.id) {
      await consumeSession(session.id);
      return response.send(textResponse('END', 'Error: Phone link changed. Redial to start again.'));
    }
    return handleLinkedSession(profile, session, answer, text, response);
  } catch (error) {
    console.error('USSD request failed:', safeErrorMessage(error));
    return response.send(textResponse('END', 'Error: Service temporarily unavailable. Please try again.'));
  }
});

async function findLinkedProfile(phoneNumber: string) {
  const {data, error} = await supabase
    .from('profiles')
    .select('id, solana_wallet_address, phone_number, privy_wallet_id, privy_user_id, privy_owner_id, pin_hash_version, signer_policy_id')
    .eq('phone_number', phoneNumber)
    .maybeSingle<Profile>();
  if (error) throw error;
  return data;
}

async function createOrLoadSession(input: {
  sessionId: string;
  phoneNumber: string;
  countryCode: string;
  networkCode: string;
  profile: Profile | null;
}) {
  const config = getConfig();
  const {data, error} = await supabase.from('ussd_sessions').insert({
    provider_session_id: input.sessionId,
    phone_number: input.phoneNumber,
    profile_id: input.profile?.id ?? null,
    service_code: config.africasTalkingUssdServiceCode,
    network_code: input.networkCode,
    country_code: input.countryCode,
    current_step: input.profile ? 'menu' : 'activation',
    expected_segments: 0,
    history_hash: hashUssdHistory(''),
    expires_at: new Date(Date.now() + config.ussdSessionTtlSeconds * 1_000).toISOString(),
  }).select('*').maybeSingle<UssdSession>();
  if (!error && data) return data;
  if (error?.code !== '23505') throw error ?? new Error('Could not create USSD session.');
  const {data: existing, error: existingError} = await supabase
    .from('ussd_sessions').select('*').eq('provider_session_id', input.sessionId).maybeSingle<UssdSession>();
  if (existingError) throw existingError;
  return existing;
}

async function loadActiveSession(providerSessionId: string, phoneNumber: string) {
  const {data, error} = await supabase
    .from('ussd_sessions')
    .select('*')
    .eq('provider_session_id', providerSessionId)
    .eq('phone_number', phoneNumber)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle<UssdSession>();
  if (error) throw error;
  return data;
}

function initialSessionPrompt(session: UssdSession, walletAddress?: string) {
  if (session.current_step === 'activation') {
    return textResponse('CON', 'Welcome! Enter the 6-digit Activation Code from your Rove dashboard:');
  }
  if (session.current_step === 'menu') {
    return textResponse('CON', walletMessage(walletAddress, 'Web3 Assistant\n1. Check Balance\n2. Send SOL'));
  }
  return textResponse('END', walletMessage(walletAddress, 'A session is already in progress. Continue on your phone or redial after it expires.'));
}

async function handleActivationSession(session: UssdSession, activationCode: string, phoneNumber: string, response: Response) {
  if (!/^\d{6}$/.test(activationCode)) {
    await consumeSession(session.id);
    return response.send(textResponse('END', 'Error: Invalid or expired activation code.'));
  }
  const {data, error} = await supabase
    .from('profiles')
    .update({phone_number: phoneNumber, pending_phone_number: null, activation_code: null, activation_expires_at: null})
    .eq('activation_code', activationCode)
    .eq('pending_phone_number', phoneNumber)
    .gt('activation_expires_at', new Date().toISOString())
    .is('phone_number', null)
    .select('solana_wallet_address')
    .maybeSingle<{solana_wallet_address: string}>();
  await consumeSession(session.id);
  if (error || !data) return response.send(textResponse('END', 'Error: Invalid or expired activation code.'));
  return response.send(textResponse('END', walletMessage(data.solana_wallet_address, 'Activation successful! Your phone is linked. Redial to transact.')));
}

async function handleLinkedSession(profile: Profile, session: UssdSession, answer: string, fullText: string, response: Response) {
  const config = getConfig();
  const reply = (prefix: 'CON' | 'END', message: string) => response.send(
    textResponse(prefix, walletMessage(profile.solana_wallet_address, message)),
  );

  if (session.current_step === 'menu') {
    if (answer === '1') {
      await consumeSession(session.id);
      const balance = await solana.getBalance(new PublicKey(profile.solana_wallet_address), 'confirmed');
      return reply('END', `Your on-chain balance is: ${formatSolBalance(balance)} SOL`);
    }
    if (answer !== '2') {
      await consumeSession(session.id);
      return reply('END', 'Error: Invalid menu selection.');
    }
    const advanced = await advanceSession(session, 'recipient', 1, fullText, {});
    return advanced ? reply('CON', 'Enter Recipient Phone Number:') : reply('END', 'Error: Session expired. Redial to start again.');
  }

  if (session.current_step === 'recipient') {
    const recipientPhone = validatePhoneCountry(answer, config.africasTalkingAllowedCountryCodes);
    if (!recipientPhone || recipientPhone.phoneNumber === profile.phone_number) {
      await consumeSession(session.id);
      return reply('END', 'Error: Enter a valid registered recipient phone number.');
    }
    const recipient = await findLinkedProfile(recipientPhone.phoneNumber);
    if (!recipient) {
      await consumeSession(session.id);
      return reply('END', 'Error: Recipient phone number is not registered.');
    }
    const advanced = await advanceSession(session, 'amount', 2, fullText, {
      recipient_profile_id: recipient.id,
      recipient_phone_number: recipientPhone.phoneNumber,
    });
    return advanced
      ? reply('CON', `To: ${recipientPhone.phoneNumber}\nEnter amount to transfer (SOL):`)
      : reply('END', 'Error: Session expired. Redial to start again.');
  }

  if (session.current_step === 'amount') {
    const lamports = parseSolAmount(answer, config.maxTransferSol);
    if (!lamports || lamports > BigInt(Number.MAX_SAFE_INTEGER)) {
      await consumeSession(session.id);
      return reply('END', `Error: Enter an amount up to ${config.maxTransferSol} SOL.`);
    }
    const advanced = await advanceSession(session, 'pin', 3, fullText, {amount_lamports: lamports.toString()});
    return advanced
      ? reply('CON', `Send ${answer} SOL to ${session.recipient_phone_number}\nEnter your 6-Digit PIN to authorize:`)
      : reply('END', 'Error: Session expired. Redial to start again.');
  }

  if (session.current_step !== 'pin' || !/^\d{6}$/.test(answer)) {
    await consumeSession(session.id);
    return reply('END', 'Error: Invalid Security PIN.');
  }
  if (!profile.privy_wallet_id || !profile.privy_user_id || !profile.privy_owner_id
      || profile.pin_hash_version !== config.pinHashVersion
      || profile.signer_policy_id !== config.privyPolicyId) {
    await consumeSession(session.id);
    return reply('END', 'Security upgrade required. Sign in to the Rove dashboard before transacting.');
  }

  const pinMaterial = createPinMaterial(answer, config.pinPepper);
  const {data: pinResult, error: pinError} = await supabase.rpc('verify_and_record_pin_attempt', {
    p_profile_id: profile.id,
    p_pin_material: pinMaterial,
    p_required_hash_version: config.pinHashVersion,
    p_max_failures: config.pinMaxFailures,
    p_lock_seconds: config.pinLockSeconds,
  });
  if (pinError || !Array.isArray(pinResult) || !pinResult[0]) {
    throw pinError ?? new Error('PIN verification failed closed.');
  }
  const result = pinResult[0] as {verified: boolean; locked_until: string | null; upgrade_required: boolean};
  if (!result.verified) {
    await consumeSession(session.id);
    if (result.upgrade_required) return reply('END', 'Security upgrade required. Sign in to the Rove dashboard.');
    if (result.locked_until) return reply('END', 'Error: Too many PIN attempts. Try again later.');
    return reply('END', 'Error: Invalid Security PIN.');
  }

  const amountLamports = BigInt(String(session.amount_lamports));
  if (!session.recipient_profile_id || !session.recipient_phone_number || amountLamports <= 0n) {
    await consumeSession(session.id);
    return reply('END', 'Error: Incomplete transaction session.');
  }
  const {data: recipient, error: recipientError} = await supabase
    .from('profiles')
    .select('id, solana_wallet_address')
    .eq('id', session.recipient_profile_id)
    .eq('phone_number', session.recipient_phone_number)
    .maybeSingle<{id: string; solana_wallet_address: string}>();
  if (recipientError) throw recipientError;
  if (!recipient) {
    await consumeSession(session.id);
    return reply('END', 'Error: Recipient phone number is no longer registered.');
  }

  await attestWalletSecurity({
    walletId: profile.privy_wallet_id,
    walletAddress: profile.solana_wallet_address,
    privyUserId: profile.privy_user_id,
    ownerId: profile.privy_owner_id,
  });

  const nonce = randomBytes(32).toString('hex');
  const authorizationExpiry = new Date(Math.min(
    Date.now() + config.transactionAuthTtlSeconds * 1_000,
    new Date(session.expires_at).getTime(),
  )).toISOString();
  const {error: authInsertError} = await supabase.from('transaction_authorizations').insert({
    nonce,
    session_id: session.id,
    sender_profile_id: profile.id,
    recipient_profile_id: recipient.id,
    amount_lamports: amountLamports.toString(),
    expires_at: authorizationExpiry,
  });
  if (authInsertError) throw authInsertError;

  const {data: consumedAuth, error: consumeError} = await supabase.rpc('consume_transaction_authorization', {
    p_nonce: nonce,
    p_session_id: session.id,
    p_sender_profile_id: profile.id,
    p_recipient_profile_id: recipient.id,
    p_amount_lamports: amountLamports.toString(),
  });
  const authorizationId = Array.isArray(consumedAuth) ? consumedAuth[0]?.authorization_id as string | undefined : undefined;
  if (consumeError || !authorizationId) {
    return reply('END', 'Error: Transaction authorization expired or was already used.');
  }

  const referenceId = createHash('sha256').update(nonce).digest('hex').slice(0, 48);
  const {data: reservation, error: reservationError} = await supabase.from('ussd_transfers').insert({
    session_id: session.provider_session_id,
    reference_id: referenceId,
    authorization_id: authorizationId,
    sender_profile_id: profile.id,
    recipient_profile_id: recipient.id,
    recipient_phone_number: session.recipient_phone_number,
    amount_lamports: amountLamports.toString(),
    status: 'processing',
  }).select('id').single<{id: string}>();
  if (reservationError || !reservation) throw reservationError ?? new Error('Could not reserve transfer.');

  try {
    const signature = await sendSolTransfer({
      walletId: profile.privy_wallet_id,
      fromAddress: profile.solana_wallet_address,
      toAddress: recipient.solana_wallet_address,
      lamports: amountLamports,
      referenceId,
    });
    const {error: persistenceError} = await supabase.from('ussd_transfers')
      .update({status: 'confirmed', signature}).eq('id', reservation.id);
    if (persistenceError) console.error('Could not persist confirmed transfer:', safeErrorMessage(persistenceError));
    return reply('END', transferSuccessMessage(formatLamportsForReceipt(amountLamports), session.recipient_phone_number, signature));
  } catch (error) {
    await supabase.from('ussd_transfers')
      .update({status: 'unknown', error_message: safeErrorMessage(error).slice(0, 500)})
      .eq('id', reservation.id);
    console.error('Solana transfer failed:', safeErrorMessage(error));
    return reply('END', 'Error: Transfer status is uncertain. Do not retry; check your wallet.');
  }
}

async function advanceSession(
  session: UssdSession,
  nextStep: UssdSession['current_step'],
  expectedSegments: number,
  fullText: string,
  values: Record<string, string>,
) {
  const {data, error} = await supabase.from('ussd_sessions').update({
    current_step: nextStep,
    expected_segments: expectedSegments,
    history_hash: hashUssdHistory(fullText),
    ...values,
  }).eq('id', session.id)
    .eq('current_step', session.current_step)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function consumeSession(sessionId: string) {
  const {error} = await supabase.from('ussd_sessions')
    .update({consumed_at: new Date().toISOString(), current_step: 'completed'})
    .eq('id', sessionId)
    .is('consumed_at', null);
  if (error) throw error;
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
    SystemProgram.transfer({fromPubkey: sender, toPubkey: recipient, lamports: Number(input.lamports)}),
  );
  const unsignedTransaction = transaction.serialize({requireAllSignatures: false, verifySignatures: false});
  const authorizationPrivateKeys = await authorizationKeyProvider.getAuthorizationPrivateKeys();
  const result = await privy.wallets().solana().signAndSendTransaction(input.walletId, {
    caip2: config.solanaCaip2,
    transaction: unsignedTransaction,
    authorization_context: {authorization_private_keys: authorizationPrivateKeys},
    idempotency_key: input.referenceId,
    reference_id: input.referenceId,
  });
  return result.hash;
}

function formatLamportsForReceipt(lamports: bigint) {
  const whole = lamports / 1_000_000_000n;
  const fraction = (lamports % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function transferSuccessMessage(amount: string, recipientPhone: string, signature: string) {
  return `Transfer Confirmed! Sent ${amount} SOL to ${recipientPhone}. Signature: ${signature.slice(0, 10)}...`;
}

function walletMessage(walletAddress: string | null | undefined, message: string) {
  return walletAddress ? `Wallet: ${formatWalletAddress(walletAddress)}\n${message}` : message;
}
