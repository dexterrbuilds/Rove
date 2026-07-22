import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {hash} from 'bcryptjs';
import {Keypair} from '@solana/web3.js';
import {describe, expect, it} from 'vitest';

const url = process.env.SECURITY_TEST_SUPABASE_URL;
const key = process.env.SECURITY_TEST_SUPABASE_SERVICE_ROLE_KEY;
const run = Boolean(url && key);

describe.skipIf(!run)('security database concurrency', () => {
  const database = run
    ? createClient(url!, key!, {auth: {persistSession: false, autoRefreshToken: false}})
    : null;

  it('serializes concurrent PIN failures and locks the profile', async () => {
    const profileId = randomUUID();
    const material = 'a'.repeat(64);
    const hashedPin = (await hash('b'.repeat(64), 4)).replace(/^\$2b\$/, '$2a$');
    await database!.from('profiles').insert({
      id: profileId,
      solana_wallet_address: `test-wallet-${profileId}`,
      hashed_pin: hashedPin,
      pin_hash_version: 2,
    }).throwOnError();

    try {
      const attempts = await Promise.all(Array.from({length: 5}, () => database!.rpc('verify_and_record_pin_attempt', {
        p_profile_id: profileId,
        p_pin_material: material,
        p_required_hash_version: 2,
        p_max_failures: 5,
        p_lock_seconds: 900,
      })));
      expect(attempts.every((attempt) => !attempt.error)).toBe(true);
      const {data} = await database!.from('profiles')
        .select('pin_locked_until').eq('id', profileId).single<{pin_locked_until: string | null}>();
      expect(data?.pin_locked_until && new Date(data.pin_locked_until).getTime()).toBeGreaterThan(Date.now());
    } finally {
      await database!.from('profiles').delete().eq('id', profileId);
    }
  });

  it('atomically permits only one transaction authorization consumer', async () => {
    const senderId = randomUUID();
    const recipientId = randomUUID();
    const providerSessionId = `security-test-${randomUUID()}`;
    const phone = '+2348012345678';
    const senderWallet = Keypair.generate().publicKey.toBase58();
    const recipientWallet = Keypair.generate().publicKey.toBase58();
    await database!.from('profiles').insert([
      {id: senderId, solana_wallet_address: senderWallet, phone_number: phone},
      {id: recipientId, solana_wallet_address: recipientWallet, phone_number: '+2348098765432'},
    ]).throwOnError();
    const {data: session} = await database!.from('ussd_sessions').insert({
      provider_session_id: providerSessionId,
      phone_number: phone,
      profile_id: senderId,
      service_code: '*384*1234#', network_code: 'TEST', country_code: 'NG',
      current_step: 'pin', expected_segments: 3, history_hash: 'a'.repeat(64),
      recipient_profile_id: recipientId, recipient_phone_number: '+2348098765432',
      recipient_wallet_address: recipientWallet,
      amount_lamports: 10, expires_at: new Date(Date.now() + 60_000).toISOString(),
    }).select('id').single<{id: string}>();
    const nonce = randomUUID().replaceAll('-', '').padEnd(64, 'a');
    await database!.from('transaction_authorizations').insert({
      nonce, session_id: session!.id, sender_profile_id: senderId,
      recipient_profile_id: recipientId, recipient_wallet_address: recipientWallet, amount_lamports: 10,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    }).throwOnError();

    try {
      const consume = () => database!.rpc('consume_transaction_authorization', {
        p_nonce: nonce, p_session_id: session!.id, p_sender_profile_id: senderId,
        p_recipient_profile_id: recipientId, p_recipient_wallet_address: recipientWallet, p_amount_lamports: 10,
      });
      const results = await Promise.all([consume(), consume()]);
      expect(results.filter((result) => Array.isArray(result.data) && result.data.length === 1)).toHaveLength(1);
    } finally {
      await database!.from('transaction_authorizations').delete().eq('session_id', session!.id);
      await database!.from('ussd_sessions').delete().eq('id', session!.id);
      await database!.from('profiles').delete().in('id', [senderId, recipientId]);
    }
  });

  it('atomically binds an external recipient wallet without requiring a recipient profile', async () => {
    const senderId = randomUUID();
    const providerSessionId = `external-security-test-${randomUUID()}`;
    const phone = '+2348012345678';
    const senderWallet = Keypair.generate().publicKey.toBase58();
    const externalWallet = Keypair.generate().publicKey.toBase58();
    await database!.from('profiles').insert({
      id: senderId, solana_wallet_address: senderWallet, phone_number: phone,
    }).throwOnError();
    const {data: session} = await database!.from('ussd_sessions').insert({
      provider_session_id: providerSessionId,
      phone_number: phone,
      profile_id: senderId,
      service_code: '*384*1234#', network_code: 'TEST', country_code: 'NG',
      current_step: 'pin', expected_segments: 3, history_hash: 'b'.repeat(64),
      recipient_profile_id: null, recipient_phone_number: null,
      recipient_wallet_address: externalWallet,
      amount_lamports: 10, expires_at: new Date(Date.now() + 60_000).toISOString(),
    }).select('id').single<{id: string}>();
    const nonce = randomUUID().replaceAll('-', '').padEnd(64, 'b');
    await database!.from('transaction_authorizations').insert({
      nonce, session_id: session!.id, sender_profile_id: senderId,
      recipient_profile_id: null, recipient_wallet_address: externalWallet,
      amount_lamports: 10, expires_at: new Date(Date.now() + 60_000).toISOString(),
    }).throwOnError();

    try {
      const consume = () => database!.rpc('consume_transaction_authorization', {
        p_nonce: nonce, p_session_id: session!.id, p_sender_profile_id: senderId,
        p_recipient_profile_id: null, p_recipient_wallet_address: externalWallet,
        p_amount_lamports: 10,
      });
      const results = await Promise.all([consume(), consume()]);
      expect(results.filter((result) => Array.isArray(result.data) && result.data.length === 1)).toHaveLength(1);
    } finally {
      await database!.from('transaction_authorizations').delete().eq('session_id', session!.id);
      await database!.from('ussd_sessions').delete().eq('id', session!.id);
      await database!.from('profiles').delete().eq('id', senderId);
    }
  });
});
