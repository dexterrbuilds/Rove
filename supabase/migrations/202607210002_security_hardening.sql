-- Production security controls for Rove's USSD transaction flow.
-- Apply this migration before deploying the matching API version; the API fails
-- closed when these tables/functions or the current PIN hash version are absent.

alter table public.profiles
  add column if not exists pin_hash_version smallint null,
  add column if not exists privy_owner_id text null,
  add column if not exists signer_policy_id text null,
  add column if not exists signer_verified_at timestamptz null;

update public.profiles
set pin_hash_version = 1
where hashed_pin is not null and pin_hash_version is null;

alter table public.profiles
  drop constraint if exists profiles_failed_pin_attempts_check;

alter table public.profiles
  add constraint profiles_failed_pin_attempts_check
  check (failed_pin_attempts between 0 and 100);

alter table public.profiles
  add constraint profiles_pin_hash_version_check
  check (pin_hash_version is null or pin_hash_version between 1 and 32767);

create table if not exists public.ussd_sessions (
  id uuid primary key default gen_random_uuid(),
  provider_session_id text unique not null,
  phone_number text not null,
  profile_id uuid null references public.profiles(id),
  service_code text not null,
  network_code text not null,
  country_code text not null,
  current_step text not null check (current_step in ('activation', 'menu', 'recipient', 'amount', 'pin', 'completed')),
  expected_segments smallint not null default 0 check (expected_segments between 0 and 4),
  history_hash text not null check (history_hash ~ '^[0-9a-f]{64}$'),
  recipient_profile_id uuid null references public.profiles(id),
  recipient_phone_number text null,
  amount_lamports bigint null check (amount_lamports is null or amount_lamports > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz null,

  constraint ussd_sessions_provider_id_length check (char_length(provider_session_id) between 1 and 200),
  constraint ussd_sessions_phone_e164 check (phone_number ~ '^\+[1-9][0-9]{7,14}$'),
  constraint ussd_sessions_recipient_phone_e164 check (
    recipient_phone_number is null or recipient_phone_number ~ '^\+[1-9][0-9]{7,14}$'
  )
);

create index if not exists ussd_sessions_active_lookup
  on public.ussd_sessions (provider_session_id, phone_number, expires_at)
  where consumed_at is null;

create table if not exists public.transaction_authorizations (
  id uuid primary key default gen_random_uuid(),
  nonce text unique not null,
  session_id uuid unique not null references public.ussd_sessions(id),
  sender_profile_id uuid not null references public.profiles(id),
  recipient_profile_id uuid not null references public.profiles(id),
  amount_lamports bigint not null check (amount_lamports > 0),
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  created_at timestamptz not null default now(),

  constraint transaction_authorizations_nonce_length check (char_length(nonce) between 32 and 128)
);

create index if not exists transaction_authorizations_pending
  on public.transaction_authorizations (nonce, expires_at)
  where consumed_at is null;

alter table public.ussd_transfers
  add column if not exists authorization_id uuid unique null
  references public.transaction_authorizations(id);

-- The server submits an HMAC of the PIN using a server-only pepper. The raw PIN
-- and pepper never enter PostgreSQL. crypt() verifies the bcrypt hash while the
-- profile row is locked, so concurrent attempts cannot overwrite one another.
create or replace function public.verify_and_record_pin_attempt(
  p_profile_id uuid,
  p_pin_material text,
  p_required_hash_version smallint,
  p_max_failures integer,
  p_lock_seconds integer
)
returns table (
  verified boolean,
  locked_until timestamptz,
  failure_count integer,
  upgrade_required boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_failures integer;
  v_candidate_hash text;
begin
  if p_max_failures < 2 or p_max_failures > 20
     or p_lock_seconds < 60 or p_lock_seconds > 86400
     or char_length(p_pin_material) < 32 then
    raise exception 'invalid PIN verification configuration';
  end if;

  select * into v_profile
  from public.profiles
  where id = p_profile_id
  for update;

  if not found then
    raise exception 'profile not found';
  end if;

  if v_profile.pin_hash_version is distinct from p_required_hash_version
     or v_profile.hashed_pin is null then
    return query select false, v_profile.pin_locked_until, v_profile.failed_pin_attempts, true;
    return;
  end if;

  if v_profile.pin_locked_until is not null and v_profile.pin_locked_until > now() then
    return query select false, v_profile.pin_locked_until, v_profile.failed_pin_attempts, false;
    return;
  end if;

  -- Supabase commonly installs pgcrypto in `extensions`, while plain PostgreSQL
  -- may install it in `public`. Resolve only those two fixed trusted locations.
  if pg_catalog.to_regprocedure('extensions.crypt(text,text)') is not null then
    execute 'select extensions.crypt($1, $2)'
      into v_candidate_hash using p_pin_material, v_profile.hashed_pin;
  elsif pg_catalog.to_regprocedure('public.crypt(text,text)') is not null then
    execute 'select public.crypt($1, $2)'
      into v_candidate_hash using p_pin_material, v_profile.hashed_pin;
  else
    raise exception 'pgcrypto crypt function is unavailable';
  end if;

  if v_candidate_hash = v_profile.hashed_pin then
    update public.profiles
    set failed_pin_attempts = 0, pin_locked_until = null
    where id = p_profile_id;
    return query select true, null::timestamptz, 0, false;
    return;
  end if;

  v_failures := v_profile.failed_pin_attempts + 1;
  if v_failures >= p_max_failures then
    update public.profiles
    set failed_pin_attempts = 0,
        pin_locked_until = now() + make_interval(secs => p_lock_seconds)
    where id = p_profile_id;
    return query
      select false, now() + make_interval(secs => p_lock_seconds), 0, false;
  else
    update public.profiles
    set failed_pin_attempts = v_failures, pin_locked_until = null
    where id = p_profile_id;
    return query select false, null::timestamptz, v_failures, false;
  end if;
end;
$$;

-- Atomically consumes both the one-time authorization and its USSD session.
-- Any mismatch, expiry, duplicate request, or skipped state returns no row.
create or replace function public.consume_transaction_authorization(
  p_nonce text,
  p_session_id uuid,
  p_sender_profile_id uuid,
  p_recipient_profile_id uuid,
  p_amount_lamports bigint
)
returns table (authorization_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_authorization public.transaction_authorizations%rowtype;
  v_session public.ussd_sessions%rowtype;
begin
  select * into v_authorization
  from public.transaction_authorizations
  where nonce = p_nonce and session_id = p_session_id
  for update;

  if not found
     or v_authorization.consumed_at is not null
     or v_authorization.expires_at <= now()
     or v_authorization.sender_profile_id <> p_sender_profile_id
     or v_authorization.recipient_profile_id <> p_recipient_profile_id
     or v_authorization.amount_lamports <> p_amount_lamports then
    return;
  end if;

  select * into v_session
  from public.ussd_sessions
  where id = p_session_id
  for update;

  if not found
     or v_session.consumed_at is not null
     or v_session.expires_at <= now()
     or v_session.current_step <> 'pin'
     or v_session.profile_id <> p_sender_profile_id
     or v_session.recipient_profile_id <> p_recipient_profile_id
     or v_session.amount_lamports <> p_amount_lamports then
    return;
  end if;

  update public.transaction_authorizations
  set consumed_at = now()
  where id = v_authorization.id;

  update public.ussd_sessions
  set consumed_at = now(), current_step = 'completed'
  where id = v_session.id;

  return query select v_authorization.id;
end;
$$;

alter table public.ussd_sessions enable row level security;
alter table public.transaction_authorizations enable row level security;

revoke all on table public.ussd_sessions from anon, authenticated;
revoke all on table public.transaction_authorizations from anon, authenticated;
revoke all on function public.verify_and_record_pin_attempt(uuid, text, smallint, integer, integer) from public, anon, authenticated;
revoke all on function public.consume_transaction_authorization(text, uuid, uuid, uuid, bigint) from public, anon, authenticated;

grant execute on function public.verify_and_record_pin_attempt(uuid, text, smallint, integer, integer) to service_role;
grant execute on function public.consume_transaction_authorization(text, uuid, uuid, uuid, bigint) to service_role;

drop trigger if exists ussd_sessions_set_updated_at on public.ussd_sessions;
drop trigger if exists transaction_authorizations_set_updated_at on public.transaction_authorizations;
