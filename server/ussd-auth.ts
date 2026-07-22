import {createHash, timingSafeEqual} from 'node:crypto';

export type UssdCallbackAuthInput = {
  suppliedToken: string;
  expectedToken: string;
  suppliedServiceCode: string;
  expectedServiceCode: string;
  sourceIp: string;
  allowedIps: string[];
};

export function isAuthenticUssdCallback(input: UssdCallbackAuthInput) {
  // Hashing first gives timingSafeEqual fixed-length inputs even when an attacker
  // supplies a token with a different length.
  const suppliedDigest = createHash('sha256').update(input.suppliedToken).digest();
  const expectedDigest = createHash('sha256').update(input.expectedToken).digest();
  const tokenIsValid = timingSafeEqual(suppliedDigest, expectedDigest);
  const normalizedIp = input.sourceIp.replace(/^::ffff:/, '');
  const sourceIpIsValid = input.allowedIps.length === 0 || input.allowedIps.includes(normalizedIp);

  return tokenIsValid
    && sourceIpIsValid
    && input.suppliedServiceCode === input.expectedServiceCode;
}
