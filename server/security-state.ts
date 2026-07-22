import {createHash} from 'node:crypto';

export type SessionEnvelope = {
  provider_session_id: string;
  phone_number: string;
  expected_segments: number;
  history_hash: string;
  expires_at: string;
  consumed_at: string | null;
};

export function hashUssdHistory(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function authorizeSessionAnswer(
  session: SessionEnvelope,
  input: {providerSessionId: string; phoneNumber: string; text: string; now?: number},
) {
  const now = input.now ?? Date.now();
  if (session.provider_session_id !== input.providerSessionId
      || session.phone_number !== input.phoneNumber
      || session.consumed_at
      || new Date(session.expires_at).getTime() <= now) return null;
  const segments = input.text.split('*');
  if (segments.length !== session.expected_segments + 1) return null;
  if (hashUssdHistory(segments.slice(0, -1).join('*')) !== session.history_hash) return null;
  return segments.at(-1) ?? null;
}

export function transactionBindingMatches(input: {
  authorization: {sessionId: string; senderId: string; recipientProfileId: string | null; recipientWalletAddress: string; amountLamports: bigint; expiresAt: number; consumed: boolean};
  request: {sessionId: string; senderId: string; recipientProfileId: string | null; recipientWalletAddress: string; amountLamports: bigint; now?: number};
}) {
  const now = input.request.now ?? Date.now();
  const auth = input.authorization;
  return !auth.consumed
    && auth.expiresAt > now
    && auth.sessionId === input.request.sessionId
    && auth.senderId === input.request.senderId
    && auth.recipientProfileId === input.request.recipientProfileId
    && auth.recipientWalletAddress === input.request.recipientWalletAddress
    && auth.amountLamports === input.request.amountLamports;
}
