import {createHash, createHmac, timingSafeEqual} from 'node:crypto';

export type UssdCallbackAuthInput = {
  suppliedToken: string;
  expectedToken: string;
  suppliedServiceCode: string;
  expectedServiceCode: string;
  sourceIp: string;
  allowedIps: string[];
  edgeHmacSecret?: string;
  edgeTimestamp?: string;
  edgeSignature?: string;
  rawBody?: Buffer;
  requireNetworkProof: boolean;
  now?: number;
};

function safeDigestEqual(supplied: string, expected: string) {
  const suppliedDigest = createHash('sha256').update(supplied).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}

function hasValidEdgeSignature(input: UssdCallbackAuthInput) {
  if (!input.edgeHmacSecret || !input.edgeTimestamp || !input.edgeSignature || !input.rawBody) return false;
  const timestamp = Number(input.edgeTimestamp);
  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp * 1_000) > 60_000) return false;

  const expected = createHmac('sha256', input.edgeHmacSecret)
    .update(input.edgeTimestamp)
    .update('.')
    .update(input.rawBody)
    .digest('hex');
  const supplied = input.edgeSignature.replace(/^sha256=/, '');
  return safeDigestEqual(supplied, expected);
}

export function isAuthenticUssdCallback(input: UssdCallbackAuthInput) {
  // Hashing first gives timingSafeEqual fixed-length inputs even when an attacker
  // supplies a token with a different length.
  const tokenIsValid = safeDigestEqual(input.suppliedToken, input.expectedToken);
  const normalizedIp = input.sourceIp.replace(/^::ffff:/, '');
  const sourceIpIsValid = input.allowedIps.includes(normalizedIp);
  const edgeSignatureIsValid = hasValidEdgeSignature(input);
  const networkProofIsValid = sourceIpIsValid || edgeSignatureIsValid || !input.requireNetworkProof;

  return tokenIsValid
    && networkProofIsValid
    && input.suppliedServiceCode === input.expectedServiceCode;
}
