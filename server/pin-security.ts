import {createHmac} from 'node:crypto';
import {hash} from 'bcryptjs';

export const PIN_LENGTH = 6;

export function createPinMaterial(pin: string, pepper: string) {
  if (!/^\d{6}$/.test(pin)) throw new Error('PIN must contain exactly six digits.');
  if (pepper.length < 32) throw new Error('PIN pepper is not securely configured.');
  return createHmac('sha256', pepper).update(pin, 'utf8').digest('hex');
}

export async function hashPin(pin: string, pepper: string, cost = 12) {
  const material = createPinMaterial(pin, pepper);
  // pgcrypto's Blowfish verifier uses the $2a$ marker. The encoded hash payload is
  // compatible with bcryptjs's $2b$ output.
  return (await hash(material, cost)).replace(/^\$2b\$/, '$2a$');
}
