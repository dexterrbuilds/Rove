import {createHash, randomBytes} from 'node:crypto';
import {Router, type NextFunction, type Request, type Response} from 'express';
import rateLimit from 'express-rate-limit';
import {PublicKey} from '@solana/web3.js';
import {solana, supabase} from './clients.js';
import {getConfig} from './config.js';
import {createPinMaterial} from './pin-security.js';
import {
  DEMO_AIRTIME_NETWORKS,
  DEMO_BANKS,
  DEMO_BILL_CATEGORIES,
  demoBankTransferProvider,
  getDemoPaymentProvider,
  onChainTransferProvider,
  type DemoPaymentKind,
} from './payment-providers/index.js';
import {attestWalletSecurity} from './privy-security.js';
import {isDefinitiveTransferFailure, privyFailureCategory, reconcilePrivyTransaction} from './privy-transaction-reconciliation.js';
import {authorizeSessionAnswer, hashUssdHistory} from './security-state.js';
import {isAuthenticUssdCallback} from './ussd-auth.js';
import {formatNairaMinor, formatSolBalance, formatWalletAddress, parseNairaAmount, parseSolAmount, safeErrorMessage, textResponse, validatePhoneCountry, validateSolanaAddress} from './utils.js';

type Profile = {
  id: string;
  solana_wallet_address: string;
  phone_number: string | null;
  privy_wallet_id: string | null;
  privy_user_id: string | null;
  privy_owner_id: string | null;
  pin_hash_version: number | null;
  signer_policy_id: string | null;
  display_name: string | null;
};

type UssdSession = {
  id: string;
  provider_session_id: string;
  phone_number: string;
  profile_id: string | null;
  current_step: 'activation' | 'menu' | 'send_recipient_type' | 'recipient' | 'recipient_confirm'
    | 'amount' | 'pin' | 'demo_bank' | 'demo_account' | 'demo_account_confirm'
    | 'demo_airtime_network' | 'demo_airtime_phone' | 'demo_bills_category'
    | 'demo_customer' | 'demo_amount' | 'demo_pin' | 'completed';
  expected_segments: number;
  history_hash: string;
  recipient_profile_id: string | null;
  recipient_phone_number: string | null;
  recipient_wallet_address: string | null;
  amount_lamports: number | string | null;
  flow_type: 'send_sol' | DemoPaymentKind | null;
  recipient_kind: 'wallet' | 'phone' | null;
  demo_provider_key: string | null;
  demo_subject: string | null;
  demo_display_name: string | null;
  demo_amount_minor: number | string | null;
  demo_metadata: Record<string, string> | null;
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

    const invalidFields = [
      !/^[\w:.-]{1,200}$/.test(sessionId) ? 'session_id' : null,
      !phone ? 'phone_number_or_country' : null,
      !config.africasTalkingAllowedNetworkCodes.includes(networkCode) ? 'network_code' : null,
      text.length > 300 ? 'text_length' : null,
    ].filter((field): field is string => Boolean(field));

    if (!phone || invalidFields.length > 0) {
      // Network codes are provider identifiers, not user secrets. Log only the
      // rejected field names and network code—never the phone, session, or text.
      console.warn('USSD request rejected by validation:', {
        invalidFields,
        networkCode: networkCode || '[missing]',
      });
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
    .select('id, solana_wallet_address, phone_number, privy_wallet_id, privy_user_id, privy_owner_id, pin_hash_version, signer_policy_id, display_name')
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
    return textResponse('CON', walletMessage(walletAddress,
      'Rove Wallet\n1. Check Balance\n2. Receive\n3. Send SOL\n4. Send to Local Bank (Demo)\n5. Buy Airtime (Demo)\n6. Pay Bills (Demo)\n7. Recent Transactions\n8. Exit'));
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
  const reply = (prefix: 'CON' | 'END', message: string) => response.send(
    textResponse(prefix, walletMessage(profile.solana_wallet_address, message)),
  );

  if (session.current_step === 'menu') {
    if (answer === '1') {
      await consumeSession(session.id);
      const balance = await solana.getBalance(new PublicKey(profile.solana_wallet_address), 'confirmed');
      return reply('END', `Your on-chain balance is: ${formatSolBalance(balance)} SOL`);
    }
    if (answer === '2') {
      await consumeSession(session.id);
      return reply('END', `Receive SOL at:\n${profile.solana_wallet_address}`);
    }
    if (answer === '3') {
      const advanced = await advanceSession(session, 'send_recipient_type', 1, fullText, {flow_type: 'send_sol'});
      return advanced ? reply('CON', 'Send to:\n1. Wallet Address\n2. Registered Phone Number') : reply('END', 'Error: Session expired.');
    }
    if (answer === '4') {
      const advanced = await advanceSession(session, 'demo_bank', 1, fullText, {flow_type: 'bank_transfer'});
      return advanced ? reply('CON', `Choose Bank (Demo)\n${numberedOptions(DEMO_BANKS)}`) : reply('END', 'Error: Session expired.');
    }
    if (answer === '5') {
      const advanced = await advanceSession(session, 'demo_airtime_network', 1, fullText, {flow_type: 'airtime'});
      return advanced ? reply('CON', `Choose Network (Demo)\n${numberedOptions(DEMO_AIRTIME_NETWORKS)}`) : reply('END', 'Error: Session expired.');
    }
    if (answer === '6') {
      const advanced = await advanceSession(session, 'demo_bills_category', 1, fullText, {flow_type: 'bill_payment'});
      return advanced ? reply('CON', `Bill Category (Demo)\n${numberedOptions(DEMO_BILL_CATEGORIES)}`) : reply('END', 'Error: Session expired.');
    }
    if (answer === '7') {
      await consumeSession(session.id);
      return reply('END', await recentTransactionsMessage(profile.id));
    }
    await consumeSession(session.id);
    return answer === '8' ? reply('END', 'Thanks for using Rove.') : reply('END', 'Error: Invalid menu selection.');
  }

  if (['send_recipient_type', 'recipient', 'recipient_confirm', 'amount', 'pin'].includes(session.current_step)) {
    return handleSolSendFlow(profile, session, answer, fullText, response);
  }
  if (session.current_step.startsWith('demo_')) {
    return handleDemoPaymentFlow(profile, session, answer, fullText, response);
  }
  await consumeSession(session.id);
  return reply('END', 'Error: Invalid session state. Redial to start again.');
}

async function handleSolSendFlow(profile: Profile, session: UssdSession, answer: string, fullText: string, response: Response) {
  const config = getConfig();
  const reply = (prefix: 'CON' | 'END', message: string) => response.send(textResponse(prefix, walletMessage(profile.solana_wallet_address, message)));

  if (session.current_step === 'send_recipient_type') {
    if (answer !== '1' && answer !== '2') {
      await consumeSession(session.id);
      return reply('END', 'Error: Select Wallet Address or Registered Phone Number.');
    }
    const recipientKind = answer === '1' ? 'wallet' : 'phone';
    const advanced = await advanceSession(session, 'recipient', 2, fullText, {recipient_kind: recipientKind});
    return advanced
      ? reply('CON', recipientKind === 'wallet' ? 'Enter Solana Wallet Address:' : 'Enter Registered Phone Number:')
      : reply('END', 'Error: Session expired.');
  }

  if (session.current_step === 'recipient') {
    if (session.recipient_kind === 'wallet') {
      const address = validateSolanaAddress(answer);
      if (!address || address === profile.solana_wallet_address) {
        await consumeSession(session.id);
        return reply('END', 'Error: Invalid recipient wallet address.');
      }
      const advanced = await advanceSession(session, 'amount', 3, fullText, {
        recipient_profile_id: null,
        recipient_phone_number: null,
        recipient_wallet_address: address,
      });
      return advanced ? reply('CON', `To: ${formatWalletAddress(address)}\nEnter amount (SOL):`) : reply('END', 'Error: Session expired.');
    }
    if (session.recipient_kind === 'phone') {
      const phone = validatePhoneCountry(answer, config.africasTalkingAllowedCountryCodes);
      if (!phone || phone.phoneNumber === profile.phone_number) {
        await consumeSession(session.id);
        return reply('END', 'Error: Enter a valid registered recipient phone number.');
      }
      const recipient = await findLinkedProfile(phone.phoneNumber);
      if (!recipient) {
        await consumeSession(session.id);
        return reply('END', 'This phone number is not registered with Rove.');
      }
      const advanced = await advanceSession(session, 'recipient_confirm', 3, fullText, {
        recipient_profile_id: recipient.id,
        recipient_phone_number: phone.phoneNumber,
        recipient_wallet_address: recipient.solana_wallet_address,
        demo_display_name: recipient.display_name,
      });
      const name = recipient.display_name ?? 'Rove User';
      return advanced
        ? reply('CON', `Verified Rove User\n${name}\nWallet: ${formatWalletAddress(recipient.solana_wallet_address)}\n1. Confirm\n2. Cancel`)
        : reply('END', 'Error: Session expired.');
    }
    await consumeSession(session.id);
    return reply('END', 'Error: Recipient type is missing.');
  }

  if (session.current_step === 'recipient_confirm') {
    if (answer !== '1') {
      await consumeSession(session.id);
      return reply('END', answer === '2' ? 'Transfer cancelled.' : 'Error: Invalid confirmation.');
    }
    const advanced = await advanceSession(session, 'amount', 4, fullText, {});
    return advanced ? reply('CON', 'Enter amount to transfer (SOL):') : reply('END', 'Error: Session expired.');
  }

  if (session.current_step === 'amount') {
    const lamports = parseSolAmount(answer, config.maxTransferSol);
    if (!lamports || lamports > BigInt(Number.MAX_SAFE_INTEGER)) {
      await consumeSession(session.id);
      return reply('END', `Error: Enter an amount up to ${config.maxTransferSol} SOL.`);
    }
    const advanced = await advanceSession(session, 'pin', session.expected_segments + 1, fullText, {amount_lamports: lamports.toString()});
    const recipientLabel = session.recipient_phone_number ?? formatWalletAddress(session.recipient_wallet_address ?? '');
    return advanced
      ? reply('CON', `Send ${answer} SOL to ${recipientLabel}\nEnter your 6-Digit PIN:`)
      : reply('END', 'Error: Session expired.');
  }

  if (session.current_step !== 'pin' || !/^\d{6}$/.test(answer)) {
    await consumeSession(session.id);
    return reply('END', 'Error: Invalid Security PIN.');
  }
  const pinCheck = await verifyProfilePin(profile, answer);
  if (!pinCheck.ok) {
    await consumeSession(session.id);
    return reply('END', pinCheck.message);
  }
  return executeAuthorizedSolTransfer(profile, session, reply);
}

async function handleDemoPaymentFlow(profile: Profile, session: UssdSession, answer: string, fullText: string, response: Response) {
  const config = getConfig();
  const reply = (prefix: 'CON' | 'END', message: string) => response.send(textResponse(prefix, walletMessage(profile.solana_wallet_address, message)));

  if (session.current_step === 'demo_bank') {
    const bank = optionFromAnswer(answer, DEMO_BANKS);
    if (!bank) return endInvalidSession(session, reply, 'Error: Invalid bank selection.');
    const advanced = await advanceSession(session, 'demo_account', 2, fullText, {demo_provider_key: bank.key, demo_metadata: {bankName: bank.label}});
    return advanced ? reply('CON', `Enter 10-digit ${bank.label} account number:`) : reply('END', 'Error: Session expired.');
  }
  if (session.current_step === 'demo_account') {
    const resolved = demoBankTransferProvider.resolveAccount(session.demo_provider_key ?? '', answer);
    if (!resolved) return endInvalidSession(session, reply, 'Error: Enter a valid 10-digit account number.');
    const advanced = await advanceSession(session, 'demo_account_confirm', 3, fullText, {
      demo_subject: resolved.accountNumber,
      demo_display_name: resolved.accountName,
      demo_metadata: {bankName: resolved.bankName},
    });
    return advanced
      ? reply('CON', `${resolved.bankName}\n${resolved.accountName}\nAccount: ******${resolved.accountNumber.slice(-4)}\n1. Continue\n2. Cancel`)
      : reply('END', 'Error: Session expired.');
  }
  if (session.current_step === 'demo_account_confirm') {
    if (answer !== '1') return endInvalidSession(session, reply, answer === '2' ? 'Demo payment cancelled.' : 'Error: Invalid confirmation.');
    const advanced = await advanceSession(session, 'demo_amount', 4, fullText, {});
    return advanced ? reply('CON', 'Enter demo amount (NGN):') : reply('END', 'Error: Session expired.');
  }
  if (session.current_step === 'demo_airtime_network') {
    const network = optionFromAnswer(answer, DEMO_AIRTIME_NETWORKS);
    if (!network) return endInvalidSession(session, reply, 'Error: Invalid network selection.');
    const advanced = await advanceSession(session, 'demo_airtime_phone', 2, fullText, {demo_provider_key: network.key, demo_display_name: network.label});
    return advanced ? reply('CON', `Enter ${network.label} phone number:`) : reply('END', 'Error: Session expired.');
  }
  if (session.current_step === 'demo_airtime_phone') {
    const phone = validatePhoneCountry(answer, config.africasTalkingAllowedCountryCodes);
    if (!phone) return endInvalidSession(session, reply, 'Error: Enter a valid international phone number.');
    const advanced = await advanceSession(session, 'demo_amount', 3, fullText, {demo_subject: phone.phoneNumber});
    return advanced ? reply('CON', `Airtime to ${phone.phoneNumber}\nEnter demo amount (NGN):`) : reply('END', 'Error: Session expired.');
  }
  if (session.current_step === 'demo_bills_category') {
    const category = optionFromAnswer(answer, DEMO_BILL_CATEGORIES);
    if (!category) return endInvalidSession(session, reply, 'Error: Invalid bill category.');
    const advanced = await advanceSession(session, 'demo_customer', 2, fullText, {demo_provider_key: category.key, demo_display_name: category.label});
    return advanced ? reply('CON', `Enter ${category.label} Customer ID:`) : reply('END', 'Error: Session expired.');
  }
  if (session.current_step === 'demo_customer') {
    if (!/^[A-Za-z0-9-]{4,32}$/.test(answer)) return endInvalidSession(session, reply, 'Error: Invalid Customer ID.');
    const advanced = await advanceSession(session, 'demo_amount', 3, fullText, {demo_subject: answer});
    return advanced ? reply('CON', `${session.demo_display_name} payment\nEnter demo amount (NGN):`) : reply('END', 'Error: Session expired.');
  }
  if (session.current_step === 'demo_amount') {
    const amountMinor = parseNairaAmount(answer);
    if (!amountMinor) return endInvalidSession(session, reply, 'Error: Enter a demo amount up to NGN 1,000,000.');
    const advanced = await advanceSession(session, 'demo_pin', session.expected_segments + 1, fullText, {demo_amount_minor: amountMinor.toString()});
    return advanced
      ? reply('CON', `${formatNairaMinor(amountMinor)} (Demo)\nEnter your 6-Digit PIN:`)
      : reply('END', 'Error: Session expired.');
  }
  if (session.current_step !== 'demo_pin' || !/^\d{6}$/.test(answer)) return endInvalidSession(session, reply, 'Error: Invalid Security PIN.');
  const pinCheck = await verifyProfilePin(profile, answer);
  if (!pinCheck.ok) return endInvalidSession(session, reply, pinCheck.message);
  return executeAuthorizedDemoPayment(profile, session, reply);
}

async function verifyProfilePin(profile: Profile, pin: string): Promise<{ok: true} | {ok: false; message: string}> {
  const config = getConfig();
  if (!profile.privy_wallet_id || !profile.privy_user_id || !profile.privy_owner_id
      || profile.pin_hash_version !== config.pinHashVersion
      || profile.signer_policy_id !== config.privyPolicyId) {
    return {ok: false, message: 'Security upgrade required. Sign in to the Rove dashboard before transacting.'};
  }
  const pinMaterial = createPinMaterial(pin, config.pinPepper);
  const {data, error} = await supabase.rpc('verify_and_record_pin_attempt', {
    p_profile_id: profile.id,
    p_pin_material: pinMaterial,
    p_required_hash_version: config.pinHashVersion,
    p_max_failures: config.pinMaxFailures,
    p_lock_seconds: config.pinLockSeconds,
  });
  if (error || !Array.isArray(data) || !data[0]) throw error ?? new Error('PIN verification failed closed.');
  const result = data[0] as {verified: boolean; locked_until: string | null; upgrade_required: boolean};
  if (result.verified) return {ok: true};
  if (result.upgrade_required) return {ok: false, message: 'Security upgrade required. Sign in to the Rove dashboard.'};
  if (result.locked_until) return {ok: false, message: 'Error: Too many PIN attempts. Try again later.'};
  return {ok: false, message: 'Error: Invalid Security PIN.'};
}

async function executeAuthorizedSolTransfer(
  profile: Profile,
  session: UssdSession,
  reply: (prefix: 'CON' | 'END', message: string) => Response,
) {
  const config = getConfig();
  const recipientWalletAddress = validateSolanaAddress(session.recipient_wallet_address ?? '');
  const amountLamports = session.amount_lamports ? BigInt(String(session.amount_lamports)) : 0n;
  if (!recipientWalletAddress || amountLamports <= 0n
      || Boolean(session.recipient_profile_id) !== Boolean(session.recipient_phone_number)) {
    await consumeSession(session.id);
    return reply('END', 'Error: Incomplete transaction session.');
  }
  if (session.recipient_profile_id && session.recipient_phone_number) {
    const {data: recipient, error} = await supabase.from('profiles').select('id')
      .eq('id', session.recipient_profile_id)
      .eq('phone_number', session.recipient_phone_number)
      .eq('solana_wallet_address', recipientWalletAddress)
      .maybeSingle<{id: string}>();
    if (error) throw error;
    if (!recipient) {
      await consumeSession(session.id);
      return reply('END', 'Error: Recipient profile changed. Redial and verify the destination.');
    }
  }

  await attestWalletSecurity({
    walletId: profile.privy_wallet_id!,
    walletAddress: profile.solana_wallet_address,
    privyUserId: profile.privy_user_id!,
    ownerId: profile.privy_owner_id!,
  });

  const nonce = randomBytes(32).toString('hex');
  const authorizationExpiry = authorizationExpiryForSession(session, config.transactionAuthTtlSeconds);
  const {error: authInsertError} = await supabase.from('transaction_authorizations').insert({
    nonce,
    session_id: session.id,
    sender_profile_id: profile.id,
    recipient_profile_id: session.recipient_profile_id,
    recipient_wallet_address: recipientWalletAddress,
    amount_lamports: amountLamports.toString(),
    expires_at: authorizationExpiry,
  });
  if (authInsertError) throw authInsertError;

  const {data: consumedAuth, error: consumeError} = await supabase.rpc('consume_transaction_authorization', {
    p_nonce: nonce,
    p_session_id: session.id,
    p_sender_profile_id: profile.id,
    p_recipient_profile_id: session.recipient_profile_id,
    p_recipient_wallet_address: recipientWalletAddress,
    p_amount_lamports: amountLamports.toString(),
  });
  const authorizationId = Array.isArray(consumedAuth) ? consumedAuth[0]?.authorization_id as string | undefined : undefined;
  if (consumeError || !authorizationId) return reply('END', 'Error: Transaction authorization expired or was already used.');

  const referenceId = createHash('sha256').update(nonce).digest('hex').slice(0, 48);
  const {data: reservation, error: reservationError} = await supabase.from('ussd_transfers').insert({
    session_id: session.provider_session_id,
    reference_id: referenceId,
    authorization_id: authorizationId,
    sender_profile_id: profile.id,
    recipient_profile_id: session.recipient_profile_id,
    recipient_phone_number: session.recipient_phone_number,
    recipient_wallet_address: recipientWalletAddress,
    amount_lamports: amountLamports.toString(),
    status: 'processing',
  }).select('id').single<{id: string}>();
  if (reservationError || !reservation) throw reservationError ?? new Error('Could not reserve transfer.');

  try {
    const payment = await onChainTransferProvider.execute({
      walletId: profile.privy_wallet_id!,
      fromAddress: profile.solana_wallet_address,
      toAddress: recipientWalletAddress,
      lamports: amountLamports,
      referenceId,
    });
    const signature = payment.reference;
    const {error: persistenceError} = await supabase.from('ussd_transfers')
      .update({status: 'confirmed', signature}).eq('id', reservation.id);
    if (persistenceError) console.error('Could not persist confirmed transfer:', safeErrorMessage(persistenceError));
    const recipientLabel = session.recipient_phone_number ?? formatWalletAddress(recipientWalletAddress);
    return reply('END', transferSuccessMessage(formatLamportsForReceipt(amountLamports), recipientLabel, signature));
  } catch (error) {
    let reconciliation: Awaited<ReturnType<typeof reconcilePrivyTransaction>> = null;
    try {
      reconciliation = await reconcilePrivyTransaction(referenceId);
    } catch {
      // Reconciliation is best-effort here. The dashboard repeats this safe,
      // read-only lookup later, while the original idempotency key prevents a
      // duplicate operation at Privy.
    }
    if (reconciliation) {
      const {error: persistenceError} = await supabase.from('ussd_transfers').update({
        status: reconciliation.status,
        signature: reconciliation.signature,
        error_message: reconciliation.status === 'failed' ? 'privy_transaction_failed' : null,
      }).eq('id', reservation.id);
      if (persistenceError) console.error('Could not persist reconciled transfer state.');
      if (reconciliation.status === 'failed') {
        return reply('END', 'Error: Transfer failed. No SOL was delivered.');
      }
      if (reconciliation.signature) {
        const recipientLabel = session.recipient_phone_number ?? formatWalletAddress(recipientWalletAddress);
        return reply('END', transferSubmittedMessage(
          formatLamportsForReceipt(amountLamports),
          recipientLabel,
          reconciliation.signature,
        ));
      }
    }
    const definitiveFailure = isDefinitiveTransferFailure(error);
    const failureCategory = privyFailureCategory(error);
    const failureDetail = safeErrorMessage(error);
    await supabase.from('ussd_transfers')
      .update({status: definitiveFailure ? 'failed' : 'unknown', error_message: failureCategory}).eq('id', reservation.id);
    console.error('Solana transfer failed:', {category: failureCategory, detail: failureDetail});
    if (definitiveFailure) return reply('END', 'Error: Transfer rejected. No SOL was sent.');
    return reply('END', 'Error: Transfer status is uncertain. Do not retry; check your wallet.');
  }
}

async function executeAuthorizedDemoPayment(
  profile: Profile,
  session: UssdSession,
  reply: (prefix: 'CON' | 'END', message: string) => Response,
) {
  const kind = session.flow_type;
  const amountMinor = session.demo_amount_minor ? BigInt(String(session.demo_amount_minor)) : 0n;
  if (!kind || kind === 'send_sol' || !session.demo_provider_key || !session.demo_subject || amountMinor <= 0n) {
    await consumeSession(session.id);
    return reply('END', 'Error: Incomplete demo payment session.');
  }
  const nonce = randomBytes(32).toString('hex');
  const config = getConfig();
  const {error: insertError} = await supabase.from('demo_payment_authorizations').insert({
    nonce,
    session_id: session.id,
    profile_id: profile.id,
    payment_kind: kind,
    amount_minor: amountMinor.toString(),
    expires_at: authorizationExpiryForSession(session, config.transactionAuthTtlSeconds),
  });
  if (insertError) throw insertError;
  const {data, error} = await supabase.rpc('consume_demo_payment_authorization', {
    p_nonce: nonce,
    p_session_id: session.id,
    p_profile_id: profile.id,
    p_payment_kind: kind,
    p_amount_minor: amountMinor.toString(),
  });
  const authorizationId = Array.isArray(data) ? data[0]?.authorization_id as string | undefined : undefined;
  if (error || !authorizationId) return reply('END', 'Error: Demo authorization expired or was already used.');

  const details = demoPaymentDetails(session, kind);
  try {
    const payment = await getDemoPaymentProvider(kind).execute({
      profileId: profile.id,
      sessionId: session.id,
      amountMinor,
      currency: 'NGN',
      channel: 'ussd',
      details,
    });
    const {error: persistenceError} = await supabase.from('demo_transactions').insert({
      session_id: session.id,
      authorization_id: authorizationId,
      profile_id: profile.id,
      payment_kind: kind,
      provider_key: session.demo_provider_key,
      channel: 'ussd',
      description: payment.description,
      amount_minor: amountMinor.toString(),
      currency: 'NGN',
      reference: payment.reference,
      status: 'completed',
      processing_time: payment.processingTime,
      receipt: payment.receipt,
      completed_at: new Date().toISOString(),
    });
    if (persistenceError) throw persistenceError;
    return reply('END', `Demo Successful\n${payment.description}\n${formatNairaMinor(amountMinor)}\nRef: ${payment.reference}\n${payment.processingTime}`);
  } catch (error) {
    const failureReference = `RVE-FAIL-${createHash('sha256').update(nonce).digest('hex').slice(0, 16).toUpperCase()}`;
    await supabase.from('demo_transactions').insert({
      session_id: session.id,
      authorization_id: authorizationId,
      profile_id: profile.id,
      payment_kind: kind,
      provider_key: session.demo_provider_key,
      channel: 'ussd',
      description: `Demo ${kind.replaceAll('_', ' ')} failed`,
      amount_minor: amountMinor.toString(),
      currency: 'NGN',
      reference: failureReference,
      status: 'failed',
      processing_time: 'Not processed',
      receipt: {status: 'Demo Failed'},
      completed_at: new Date().toISOString(),
    });
    console.error('Demo payment failed:', safeErrorMessage(error));
    return reply('END', `Demo payment failed. Ref: ${failureReference}`);
  }
}

function demoPaymentDetails(session: UssdSession, kind: DemoPaymentKind): Record<string, string> {
  if (kind === 'bank_transfer') return {
    bankKey: session.demo_provider_key!, accountNumber: session.demo_subject!, accountName: session.demo_display_name ?? '',
  };
  if (kind === 'airtime') return {networkKey: session.demo_provider_key!, phoneNumber: session.demo_subject!};
  return {categoryKey: session.demo_provider_key!, customerId: session.demo_subject!};
}

async function recentTransactionsMessage(profileId: string) {
  const [chainResult, demoResult] = await Promise.all([
    supabase.from('ussd_transfers')
      .select('amount_lamports, status, recipient_phone_number, recipient_wallet_address, created_at')
      .eq('sender_profile_id', profileId).order('created_at', {ascending: false}).limit(4),
    supabase.from('demo_transactions')
      .select('description, amount_minor, status, created_at')
      .eq('profile_id', profileId).order('created_at', {ascending: false}).limit(4),
  ]);
  if (chainResult.error) throw chainResult.error;
  if (demoResult.error) throw demoResult.error;
  type HistoryEntry = {timestamp: number; text: string};
  const chainEntries: HistoryEntry[] = (chainResult.data ?? []).map((item) => ({
    timestamp: new Date(item.created_at).getTime(),
    text: `On-chain -${formatLamportsForReceipt(BigInt(String(item.amount_lamports)))} SOL ${item.status}`,
  }));
  const demoEntries: HistoryEntry[] = (demoResult.data ?? []).map((item) => ({
    timestamp: new Date(item.created_at).getTime(),
    text: `Demo -${formatNairaMinor(BigInt(String(item.amount_minor)))} ${item.status}`,
  }));
  const entries = [...chainEntries, ...demoEntries].sort((first, second) => second.timestamp - first.timestamp).slice(0, 4);
  return entries.length ? `Recent Transactions\n${entries.map((entry, index) => `${index + 1}. ${entry.text}`).join('\n')}` : 'No recent transactions.';
}

function numberedOptions(options: ReadonlyArray<{label: string}>) {
  return options.map((option, index) => `${index + 1}. ${option.label}`).join('\n');
}

function optionFromAnswer<T extends {key: string; label: string}>(answer: string, options: readonly T[]) {
  const index = Number(answer) - 1;
  return Number.isInteger(index) && index >= 0 ? options[index] ?? null : null;
}

async function endInvalidSession(
  session: UssdSession,
  reply: (prefix: 'CON' | 'END', message: string) => Response,
  message: string,
) {
  await consumeSession(session.id);
  return reply('END', message);
}

function authorizationExpiryForSession(session: UssdSession, ttlSeconds: number) {
  return new Date(Math.min(Date.now() + ttlSeconds * 1_000, new Date(session.expires_at).getTime())).toISOString();
}

async function advanceSession(
  session: UssdSession,
  nextStep: UssdSession['current_step'],
  expectedSegments: number,
  fullText: string,
  values: Record<string, unknown>,
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

function formatLamportsForReceipt(lamports: bigint) {
  const whole = lamports / 1_000_000_000n;
  const fraction = (lamports % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function transferSuccessMessage(amount: string, recipient: string, signature: string) {
  return `Transfer Confirmed! Sent ${amount} SOL to ${recipient}. Signature: ${signature.slice(0, 10)}...`;
}

function transferSubmittedMessage(amount: string, recipient: string, signature: string) {
  return `Transfer submitted! Sent ${amount} SOL to ${recipient}. Signature: ${signature.slice(0, 10)}...`;
}

function walletMessage(walletAddress: string | null | undefined, message: string) {
  return walletAddress ? `Wallet: ${formatWalletAddress(walletAddress)}\n${message}` : message;
}
