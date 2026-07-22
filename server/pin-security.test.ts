import {compare} from 'bcryptjs';
import {describe, expect, it} from 'vitest';
import {createPinMaterial, hashPin} from './pin-security.js';

describe('PIN hashing', () => {
  it('uses a peppered material and a version-compatible bcrypt hash', async () => {
    const pepper = 'p'.repeat(32);
    const material = createPinMaterial('123456', pepper);
    const hashed = await hashPin('123456', pepper, 4);
    expect(material).not.toContain('123456');
    expect(hashed.startsWith('$2a$')).toBe(true);
    expect(await compare(material, hashed)).toBe(true);
  });

  it('rejects legacy four-digit PINs', () => {
    expect(() => createPinMaterial('1234', 'p'.repeat(32))).toThrow();
  });
});
