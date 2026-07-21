import {PrivyClient} from '@privy-io/node';
import {createClient} from '@supabase/supabase-js';
import {Connection} from '@solana/web3.js';
import {getConfig} from './config.js';

const config = getConfig();

export const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: {autoRefreshToken: false, persistSession: false},
});

export const privy = new PrivyClient({
  appId: config.privyAppId,
  appSecret: config.privyAppSecret,
});

export const solana = new Connection(config.solanaRpcUrl, 'confirmed');
