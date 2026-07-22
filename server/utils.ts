import {parsePhoneNumberFromString} from 'libphonenumber-js/min';

const LAMPORTS_PER_SOL_BIGINT = 1_000_000_000n;
const MAX_TRANSFER_LAMPORTS = 1_000n * LAMPORTS_PER_SOL_BIGINT;

export function normalizePhoneNumber(value: string) {
  const cleaned = value.trim().replace(/[\s()-]/g, '');
  const international = cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
  const parsed = parsePhoneNumberFromString(international);
  return parsed?.isValid() ? parsed.number : null;
}

export function parseSolAmount(value: string) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const lamports = BigInt(whole) * LAMPORTS_PER_SOL_BIGINT + BigInt(fraction.padEnd(9, '0'));
  if (lamports <= 0n || lamports > MAX_TRANSFER_LAMPORTS) return null;
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
  return error instanceof Error ? error.message : 'Unknown error';
}
