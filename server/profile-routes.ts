import {Router} from 'express';
import {compare, hash} from 'bcryptjs';
import {z} from 'zod';
import {privy, supabase} from './clients.js';
import {normalizePhoneNumber, safeErrorMessage} from './utils.js';

const registrationSchema = z.object({
  walletAddress: z.string().min(32).max(64),
  phoneNumber: z.string(),
  pin: z.string().regex(/^\d{4}$/),
  activationCode: z.string().regex(/^\d{6}$/),
  // The client creates this timestamp for display. The server writes its own exact 15-minute TTL.
  activationExpiresAt: z.string().datetime(),
});

export const profileRouter = Router();

profileRouter.use((_request, response, next) => {
  // Profile responses can contain phone and one-time activation details.
  response.set('Cache-Control', 'no-store');
  next();
});

profileRouter.get('/me', async (request, response) => {
  try {
    const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return response.status(401).json({error: 'Missing authentication token.'});

    const claims = await privy.utils().auth().verifyAuthToken(token);
    const {data: profile, error} = await supabase
      .from('profiles')
      .select('solana_wallet_address, phone_number, pending_phone_number, activation_code, activation_expires_at')
      .eq('privy_user_id', claims.user_id)
      .maybeSingle<{
        solana_wallet_address: string;
        phone_number: string | null;
        pending_phone_number: string | null;
        activation_code: string | null;
        activation_expires_at: string | null;
      }>();
    if (error) throw error;

    if (!profile) return response.json({status: 'not_started'});
    if (profile.phone_number) {
      return response.json({
        status: 'linked',
        phoneNumber: profile.phone_number,
        walletAddress: profile.solana_wallet_address,
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

profileRouter.post('/register', async (request, response) => {
  try {
    const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return response.status(401).json({error: 'Missing authentication token.'});

    const claims = await privy.utils().auth().verifyAuthToken(token);
    const input = registrationSchema.parse(request.body);
    const normalizedPhone = normalizePhoneNumber(input.phoneNumber);
    if (!normalizedPhone) return response.status(400).json({error: 'Enter a valid international phone number.'});

    // Do not trust a wallet ID or ownership claim from the browser. Resolve the wallet
    // using the verified Privy user ID and only accept that user's Solana wallet.
    let ownedWallet: {id: string; address: string} | undefined;
    for await (const wallet of privy.wallets().list({user_id: claims.user_id, chain_type: 'solana'})) {
      if (wallet.address === input.walletAddress) {
        ownedWallet = wallet;
        break;
      }
    }
    if (!ownedWallet) {
      return response.status(403).json({error: 'The Solana wallet is not owned by this authenticated user.'});
    }

    const {data: existing, error: readError} = await supabase
      .from('profiles')
      .select('id, phone_number')
      .eq('privy_user_id', claims.user_id)
      .maybeSingle();
    if (readError) throw readError;
    if (existing?.phone_number) {
      return response.status(409).json({error: 'This wallet already has a linked phone number.'});
    }

    const activationExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const hashedPin = await hash(input.pin, 12);
    const profile = {
      solana_wallet_address: ownedWallet.address,
      privy_wallet_id: ownedWallet.id,
      privy_user_id: claims.user_id,
      pending_phone_number: normalizedPhone,
      hashed_pin: hashedPin,
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
      return response.status(400).json({error: 'Invalid registration details.'});
    }
    console.error('Profile registration failed:', safeErrorMessage(error));
    return response.status(500).json({error: 'Could not configure offline access.'});
  }
});

// Exported for targeted tests without exposing PIN hashes through an HTTP endpoint.
export async function verifyPin(pin: string, hashedPin: string) {
  return compare(pin, hashedPin);
}
