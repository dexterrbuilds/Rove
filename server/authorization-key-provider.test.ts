import {describe, expect, it} from 'vitest';
import {generateP256KeyPair} from '@privy-io/node';
import {EnvironmentKeyringProvider} from './authorization-key-provider.js';
import type {AppConfig} from './config.js';

function config(overrides: Partial<AppConfig> = {}) {
  return {
    environment: 'production',
    privyAuthorizationKeyringJson: JSON.stringify({environment: 'production', keys: {current: 'key-one', next: 'key-two'}}),
    privyAuthorizationActiveKeyIds: ['current', 'next'],
    ...overrides,
  } as AppConfig;
}

describe('authorization key provider', () => {
  it('supports overlapping active keys during rotation', async () => {
    const [current, next] = await Promise.all([generateP256KeyPair(), generateP256KeyPair()]);
    const provider = new EnvironmentKeyringProvider(config({
      privyAuthorizationKeyringJson: JSON.stringify({
        environment: 'production',
        keys: {current: current.privateKey, next: next.privateKey},
      }),
    }));
    await expect(provider.getAuthorizationPrivateKeys())
      .resolves.toEqual([current.privateKey, next.privateKey]);
  });

  it('rejects staging or production keys from another environment', async () => {
    const provider = new EnvironmentKeyringProvider(config({environment: 'staging'}));
    await expect(provider.getAuthorizationPrivateKeys()).rejects.toThrow(/environment/);
  });

  it('rejects missing active key IDs', async () => {
    const provider = new EnvironmentKeyringProvider(config({privyAuthorizationActiveKeyIds: ['missing']}));
    await expect(provider.getAuthorizationPrivateKeys()).rejects.toThrow(/active/);
  });

  it('rejects IDs, public keys, and malformed values in the private-key slot', async () => {
    const provider = new EnvironmentKeyringProvider(config({
      privyAuthorizationKeyringJson: JSON.stringify({environment: 'production', keys: {current: 'cm-signing-quorum-id'}}),
      privyAuthorizationActiveKeyIds: ['current'],
    }));
    await expect(provider.getAuthorizationPrivateKeys()).rejects.toThrow(/base64 PKCS8 P-256/);
  });
});
