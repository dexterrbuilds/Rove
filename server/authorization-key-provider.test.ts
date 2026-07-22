import {describe, expect, it} from 'vitest';
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
    await expect(new EnvironmentKeyringProvider(config()).getAuthorizationPrivateKeys())
      .resolves.toEqual(['key-one', 'key-two']);
  });

  it('rejects staging or production keys from another environment', async () => {
    const provider = new EnvironmentKeyringProvider(config({environment: 'staging'}));
    await expect(provider.getAuthorizationPrivateKeys()).rejects.toThrow(/environment/);
  });

  it('rejects missing active key IDs', async () => {
    const provider = new EnvironmentKeyringProvider(config({privyAuthorizationActiveKeyIds: ['missing']}));
    await expect(provider.getAuthorizationPrivateKeys()).rejects.toThrow(/active/);
  });
});
