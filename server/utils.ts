import {parsePhoneNumberFromString} from 'libphonenumber-js/min';

const LAMPORTS_PER_SOL_BIGINT = 1_000_000_000n;
const MAX_TRANSFER_LAMPORTS = 1_000n * LAMPORTS_PER_SOL_BIGINT;

export function normalizePhoneNumber(value: string) {
  const cleaned = value.trim().replace(/[\s()-]/g, '');
  const international = cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
  const parsed = parsePhoneNumberFromString(international);
  return parsed?.isValid() ? parsed.number : null;
}

export function validatePhoneCountry(value: string, allowedCountryCodes: string[]) {
  const normalized = normalizePhoneNumber(value);
  if (!normalized) return null;
  const parsed = parsePhoneNumberFromString(normalized);
  if (!parsed?.country || !allowedCountryCodes.includes(parsed.country)) return null;
  return {phoneNumber: parsed.number, countryCode: parsed.country};
}

export function parseSolAmount(value: string, configuredMaximumSol?: string) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const lamports = BigInt(whole) * LAMPORTS_PER_SOL_BIGINT + BigInt(fraction.padEnd(9, '0'));
  let maximum = MAX_TRANSFER_LAMPORTS;
  if (configuredMaximumSol) {
    const [maxWhole, maxFraction = ''] = configuredMaximumSol.split('.');
    maximum = BigInt(maxWhole) * LAMPORTS_PER_SOL_BIGINT + BigInt(maxFraction.padEnd(9, '0'));
  }
  if (lamports <= 0n || lamports > maximum) return null;
  return lamports;
}

export function formatSolBalance(lamports: number) {
  return (lamports / Number(LAMPORTS_PER_SOL_BIGINT)).toFixed(9).replace(/\.?0+$/, '');
}

export function formatWalletAddress(address: string) {
  if (address.length <= 13) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function textResponse(prefix: 'CON' | 'END', message: string) {
  return `${prefix} ${message}`;
}

export function safeErrorMessage(error: unknown) {
  return redactSensitive(error instanceof Error ? error.message : 'Unknown error');
}

export function redactSensitive(value: string) {
  return value
    .replace(/((?:[?&]|\b)(?:at_token|token|authorization)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(bearer\s+)[a-z0-9._~+\/-]+/gi, '$1[REDACTED]')
    .replace(/((?:pin|activation[_ -]?code|private[_ -]?key|secret)\s*[:=]\s*)[^,;\s]+/gi, '$1[REDACTED]')
    .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]');
}
