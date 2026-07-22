import type {AppConfig} from './config.js';

export interface AuthorizationKeyProvider {
  getAuthorizationPrivateKeys(): Promise<string[]>;
}

type EnvironmentKeyring = {
  environment: AppConfig['environment'];
  keys: Record<string, string>;
};

export class EnvironmentKeyringProvider implements AuthorizationKeyProvider {
  constructor(private readonly config: AppConfig) {}

  async getAuthorizationPrivateKeys() {
    if (!this.config.privyAuthorizationKeyringJson) {
      if (this.config.environment !== 'development' && this.config.environment !== 'test') {
        throw new Error('Legacy Privy authorization keys are disabled outside development and test.');
      }
      if (!this.config.privyAuthorizationPrivateKey) {
        throw new Error('No Privy authorization key is configured.');
      }
      return [this.config.privyAuthorizationPrivateKey];
    }

    let keyring: EnvironmentKeyring;
    try {
      keyring = JSON.parse(this.config.privyAuthorizationKeyringJson) as EnvironmentKeyring;
    } catch {
      throw new Error('PRIVY_AUTHORIZATION_KEYRING_JSON is not valid JSON.');
    }
    if (keyring.environment !== this.config.environment || !keyring.keys || typeof keyring.keys !== 'object') {
      throw new Error('Privy authorization keyring environment does not match ROVE_ENVIRONMENT.');
    }

    const keys = this.config.privyAuthorizationActiveKeyIds.map((id) => keyring.keys[id]);
    if (keys.length === 0 || keys.some((key) => typeof key !== 'string' || key.length === 0)) {
      throw new Error('Every active Privy authorization key ID must exist in the environment keyring.');
    }
    return keys;
  }
}
