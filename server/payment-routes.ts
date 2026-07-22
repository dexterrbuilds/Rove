import {Router} from 'express';
import rateLimit from 'express-rate-limit';
import {supabase} from './clients.js';
import {authenticateRequest} from './profile-routes.js';
import {safeErrorMessage} from './utils.js';

export const paymentRouter = Router();

paymentRouter.use((_request, response, next) => {
  response.set('Cache-Control', 'no-store');
  next();
});

paymentRouter.get('/history', rateLimit({
  windowMs: 60 * 1_000,
  limit: 60,
  standardHeaders: false,
  legacyHeaders: false,
}), async (request, response) => {
  try {
    const auth = await authenticateRequest(request.headers.authorization);
    if (!auth) return response.status(401).json({error: 'Missing authentication token.'});
    const {data: profile, error: profileError} = await supabase.from('profiles')
      .select('id').eq('privy_user_id', auth.privyUserId).maybeSingle<{id: string}>();
    if (profileError) throw profileError;
    if (!profile) return response.json({transactions: []});

    const [demoResult, ussdResult] = await Promise.all([
      supabase.from('demo_transactions')
        .select('id, payment_kind, description, amount_minor, currency, reference, status, channel, processing_time, created_at, completed_at')
        .eq('profile_id', profile.id).order('created_at', {ascending: false}).limit(50),
      supabase.from('ussd_transfers')
        .select('id, signature, status, amount_lamports, recipient_phone_number, recipient_wallet_address, created_at')
        .eq('sender_profile_id', profile.id).order('created_at', {ascending: false}).limit(50),
    ]);
    if (demoResult.error) throw demoResult.error;
    if (ussdResult.error) throw ussdResult.error;
    return response.json({transactions: (demoResult.data ?? []).map((transaction) => ({
      id: transaction.id,
      paymentKind: transaction.payment_kind,
      description: transaction.description,
      amountMinor: String(transaction.amount_minor),
      currency: transaction.currency,
      reference: transaction.reference,
      status: transaction.status,
      channel: transaction.channel,
      processingTime: transaction.processing_time,
      createdAt: transaction.created_at,
      completedAt: transaction.completed_at,
    })), ussdTransfers: (ussdResult.data ?? []).map((transfer) => ({
      id: transfer.id,
      signature: transfer.signature,
      status: transfer.status,
      amountLamports: String(transfer.amount_lamports),
      recipientPhoneNumber: transfer.recipient_phone_number,
      recipientWalletAddress: transfer.recipient_wallet_address,
      createdAt: transfer.created_at,
    }))});
  } catch (error) {
    console.error('Payment history lookup failed:', safeErrorMessage(error));
    return response.status(500).json({error: 'Could not load payment history.'});
  }
});
