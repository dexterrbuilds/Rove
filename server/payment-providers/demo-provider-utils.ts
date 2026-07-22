import {createHash, randomBytes} from 'node:crypto';

export function demoReference(prefix: string) {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `RVE-${prefix}-${date}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

export function deterministicChoice(seed: string, values: readonly string[]) {
  const index = createHash('sha256').update(seed).digest().readUInt32BE(0) % values.length;
  return values[index];
}

export function formatNairaMinor(amountMinor: bigint) {
  const whole = amountMinor / 100n;
  const fraction = (amountMinor % 100n).toString().padStart(2, '0');
  return `NGN ${whole.toLocaleString('en-US')}.${fraction}`;
}

export function maskValue(value: string, visible = 4) {
  return value.length <= visible ? value : `${'*'.repeat(Math.min(6, value.length - visible))}${value.slice(-visible)}`;
}
