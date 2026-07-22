import {Router} from 'express';
import rateLimit from 'express-rate-limit';
import {z} from 'zod';
import {privy, supabase} from './clients.js';
import {getConfig} from './config.js';
import {hashPin} from './pin-security.js';
import {attestWalletSecurity, findOwnedSolanaWallet} from './privy-security.js';
import {formatWalletAddress, normalizePhoneNumber, safeErrorMessage} from './utils.js';

const registrationSchema = z.object({
  walletAddress: z.string().min(32).max(64),
  phoneNumber: z.string(),
  pin: z.string().regex(/^\d{6}$/),
  activationCode: z.string().regex(/^\d{6}$/),
  // The client creates this timestamp for display. The server writes its own exact 15-minute TTL.
  activationExpiresAt: z.string().datetime(),
});

const securityUpgradeSchema = z.object({
  walletAddress: z.string().min(32).max(64),
  pin: z.string().regex(/^\d{6}$/),
});

export const profileRouter = Router();

profileRouter.use((_request, response, next) => {
  response.set('Cache-Control', 'no-store');
  next();
});

export async function authenticateRequest(authorization: string | undefined) {
  const token = authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return null;
  const claims = await privy.utils().auth().verifyAuthToken(token);
  return {token, privyUserId: claims.user_id};
}

const recipientLookupLimit = rateLimit({
  windowMs: 5 * 60 * 1_000,
  limit: 40,
  standardHeaders: false,
  legacyHeaders: false,
  handler: (_request, response) => response.status(429).json({error: 'Too many recipient lookups. Try again later.'}),
});

profileRouter.get('/me', async (request, response) => {
  try {
    const auth = await authenticateRequest(request.headers.authorization);
    if (!auth) return response.status(401).json({error: 'Missing authentication token.'});
    const config = getConfig();
    const {data: profile, error} = await supabase
      .from('profiles')
      .select('solana_wallet_address, phone_number, pending_phone_number, activation_code, activation_expires_at, pin_hash_version, signer_policy_id, privy_wallet_id, privy_owner_id')
      .eq('privy_user_id', auth.privyUserId)
      .maybeSingle<{
        solana_wallet_address: string;
        phone_number: string | null;
        pending_phone_number: string | null;
        activation_code: string | null;
        activation_expires_at: string | null;
        pin_hash_version: number | null;
        signer_policy_id: string | null;
        privy_wallet_id: string | null;
        privy_owner_id: string | null;
      }>();
    if (error) throw error;

    if (!profile) return response.json({status: 'not_started'});
    let signerIsSecure = false;
    if (profile.phone_number && profile.privy_wallet_id && profile.privy_owner_id) {
      try {
        await attestWalletSecurity({
          walletId: profile.privy_wallet_id,
          walletAddress: profile.solana_wallet_address,
          privyUserId: auth.privyUserId,
          ownerId: profile.privy_owner_id,
        });
        signerIsSecure = true;
      } catch {
        // Fail closed without exposing Privy configuration details to the browser.
      }
    }
    const securityUpgradeRequired = profile.pin_hash_version !== config.pinHashVersion
      || profile.signer_policy_id !== config.privyPolicyId
      || !signerIsSecure;
    if (profile.phone_number) {
      return response.json({
        status: 'linked',
        phoneNumber: profile.phone_number,
        walletAddress: profile.solana_wallet_address,
        securityUpgradeRequired,
      });
    }

    const activationIsCurrent = Boolean(
      profile.activation_code
      && profile.activation_expires_at
      && profile.pending_phone_number
      && new Date(profile.activation_expires_at).getTime() > Date.now(),
    );
    if (activationIsCurrent) {
      return response.json({
        status: 'pending',
        phoneNumber: profile.pending_phone_number,
        walletAddress: profile.solana_wallet_address,
        activationCode: profile.activation_code,
        activationExpiresAt: profile.activation_expires_at,
      });
    }

    return response.json({
      status: 'not_started',
      phoneNumber: profile.pending_phone_number,
      walletAddress: profile.solana_wallet_address,
      activationExpired: Boolean(profile.activation_code),
    });
  } catch (error) {
    console.error('Profile status lookup failed:', safeErrorMessage(error));
    return response.status(500).json({error: 'Could not load your offline access status.'});
  }
});

profileRouter.get('/resolve-recipient', recipientLookupLimit, async (request, response) => {
  try {
    const auth = await authenticateRequest(request.headers.authorization);
    if (!auth) return response.status(401).json({error: 'Missing authentication token.'});
    const phoneNumber = normalizePhoneNumber(String(request.query.phoneNumber ?? ''));
    if (!phoneNumber) return response.status(400).json({error: 'Enter a valid international phone number.'});

    const {data: sender, error: senderError} = await supabase.from('profiles')
      .select('id, phone_number').eq('privy_user_id', auth.privyUserId)
      .maybeSingle<{id: string; phone_number: string | null}>();
    if (senderError) throw senderError;
    if (!sender) return response.status(404).json({error: 'Your Rove profile was not found.'});
    if (sender.phone_number === phoneNumber) return response.status(400).json({error: 'You cannot send to your own linked phone number.'});

    const {data: recipient, error} = await supabase.from('profiles')
      .select('display_name, solana_wallet_address').eq('phone_number', phoneNumber)
      .maybeSingle<{display_name: string | null; solana_wallet_address: string}>();
    if (error) throw error;
    if (!recipient) return response.json({registered: false});
    return response.json({
      registered: true,
      displayName: recipient.display_name,
      walletAddress: recipient.solana_wallet_address,
      walletPreview: formatWalletAddress(recipient.solana_wallet_address),
    });
  } catch (error) {
    console.error('Recipient resolution failed:', safeErrorMessage(error));
    return response.status(500).json({error: 'Could not verify this recipient.'});
  }
});

profileRouter.post('/register', async (request, response) => {
  try {
    const auth = await authenticateRequest(request.headers.authorization);
    if (!auth) return response.status(401).json({error: 'Missing authentication token.'});
    const config = getConfig();
    const input = registrationSchema.parse(request.body);
    const normalizedPhone = normalizePhoneNumber(input.phoneNumber);
    if (!normalizedPhone) return response.status(400).json({error: 'Enter a valid international phone number.'});

    const ownedWallet = await findOwnedSolanaWallet(auth.privyUserId, input.walletAddress);
    if (!ownedWallet) {
      return response.status(403).json({error: 'The Solana wallet is not owned by this authenticated user.'});
    }
    if (!ownedWallet.owner_id) throw new Error('Privy wallet has no owner quorum.');
    await attestWalletSecurity({
      walletId: ownedWallet.id,
      walletAddress: ownedWallet.address,
      privyUserId: auth.privyUserId,
      ownerId: ownedWallet.owner_id,
    });

    const {data: existing, error: readError} = await supabase
      .from('profiles')
      .select('id, phone_number')
      .eq('privy_user_id', auth.privyUserId)
      .maybeSingle<{id: string; phone_number: string | null}>();
    if (readError) throw readError;
    if (existing?.phone_number) {
      return response.status(409).json({error: 'This wallet already has a linked phone number.'});
    }

    const activationExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const hashedPin = await hashPin(input.pin, config.pinPepper);
    const profile = {
      solana_wallet_address: ownedWallet.address,
      privy_wallet_id: ownedWallet.id,
      privy_owner_id: ownedWallet.owner_id,
      privy_user_id: auth.privyUserId,
      pending_phone_number: normalizedPhone,
      hashed_pin: hashedPin,
      pin_hash_version: config.pinHashVersion,
      signer_policy_id: config.privyPolicyId,
      signer_verified_at: new Date().toISOString(),
      failed_pin_attempts: 0,
      pin_locked_until: null,
      activation_code: input.activationCode,
      activation_expires_at: activationExpiresAt,
    };

    const operation = existing
      ? supabase.from('profiles').update(profile).eq('id', existing.id)
      : supabase.from('profiles').insert(profile);
    const {error: writeError} = await operation;
    if (writeError) {
      if (writeError.code === '23505') {
        return response.status(409).json({error: 'That phone number or activation code is already in use. Generate another code.'});
      }
      throw writeError;
    }

    return response.status(201).json({
      activationCode: input.activationCode,
      activationExpiresAt,
      phoneNumber: normalizedPhone,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return response.status(400).json({error: 'Invalid registration details. Use a six-digit PIN.'});
    }
    console.error('Profile registration failed:', safeErrorMessage(error));
    return response.status(500).json({error: 'Could not configure offline access securely.'});
  }
});

// Existing four-digit/unrestricted profiles must be upgraded by their authenticated
// Privy owner. This both replaces the signer configuration and rotates the PIN hash.
profileRouter.post('/security/upgrade', async (request, response) => {
  try {
    const auth = await authenticateRequest(request.headers.authorization);
    if (!auth) return response.status(401).json({error: 'Missing authentication token.'});
    const config = getConfig();
    const input = securityUpgradeSchema.parse(request.body);
    const {data: profile, error: profileError} = await supabase
      .from('profiles')
      .select('id, solana_wallet_address, privy_wallet_id, privy_owner_id')
      .eq('privy_user_id', auth.privyUserId)
      .maybeSingle<{id: string; solana_wallet_address: string; privy_wallet_id: string | null; privy_owner_id: string | null}>();
    if (profileError) throw profileError;
    if (!profile || profile.solana_wallet_address !== input.walletAddress || !profile.privy_wallet_id) {
      return response.status(404).json({error: 'Registered wallet was not found.'});
    }

    const wallet = await findOwnedSolanaWallet(auth.privyUserId, input.walletAddress);
    if (!wallet || wallet.id !== profile.privy_wallet_id) {
      return response.status(403).json({error: 'Wallet ownership verification failed.'});
    }
    if (!wallet.owner_id) throw new Error('Privy wallet has no owner quorum.');
    await attestWalletSecurity({
      walletId: wallet.id,
      walletAddress: wallet.address,
      privyUserId: auth.privyUserId,
      ownerId: wallet.owner_id,
    });
    const hashedPin = await hashPin(input.pin, config.pinPepper);
    const {error: updateError} = await supabase.from('profiles').update({
      hashed_pin: hashedPin,
      pin_hash_version: config.pinHashVersion,
      signer_policy_id: config.privyPolicyId,
      privy_owner_id: wallet.owner_id,
      signer_verified_at: new Date().toISOString(),
      failed_pin_attempts: 0,
      pin_locked_until: null,
    }).eq('id', profile.id);
    if (updateError) throw updateError;
    return response.json({ok: true});
  } catch (error) {
    if (error instanceof z.ZodError) {
      return response.status(400).json({error: 'Enter a valid six-digit PIN.'});
    }
    console.error('Profile security upgrade failed:', safeErrorMessage(error));
    return response.status(500).json({error: 'Could not complete the security upgrade.'});
  }
});
