-- Crypto remains Rove's primary product. These tables isolate demo fintech
-- receipts and one-time authorizations from real on-chain transfer records.

alter table public.profiles
  add column if not exists display_name text null;

alter table public.profiles
  drop constraint if exists profiles_display_name_length_check,
  add constraint profiles_display_name_length_check
    check (display_name is null or char_length(display_name) between 1 and 80);

alter table public.ussd_sessions
  add column if not exists flow_type text null,
  add column if not exists recipient_kind text null,
  add column if not exists demo_provider_key text null,
  add column if not exists demo_subject text null,
  add column if not exists demo_display_name text null,
  add column if not exists demo_amount_minor bigint null,
  add column if not exists demo_metadata jsonb not null default '{}'::jsonb;

alter table public.ussd_sessions
  drop constraint if exists ussd_sessions_current_step_check,
  drop constraint if exists ussd_sessions_expected_segments_check,
  drop constraint if exists ussd_sessions_flow_type_check,
  drop constraint if exists ussd_sessions_recipient_kind_check,
  drop constraint if exists ussd_sessions_demo_amount_check,
  add constraint ussd_sessions_current_step_check check (current_step in (
    'activation', 'menu', 'send_recipient_type', 'recipient', 'recipient_confirm', 'amount', 'pin',
    'demo_bank', 'demo_account', 'demo_account_confirm', 'demo_airtime_network',
    'demo_airtime_phone', 'demo_bills_category', 'demo_customer', 'demo_amount', 'demo_pin',
    'completed'
  )),
  add constraint ussd_sessions_expected_segments_check check (expected_segments between 0 and 8),
  add constraint ussd_sessions_flow_type_check check (
    flow_type is null or flow_type in ('send_sol', 'bank_transfer', 'airtime', 'bill_payment')
  ),
  add constraint ussd_sessions_recipient_kind_check check (
    recipient_kind is null or recipient_kind in ('wallet', 'phone')
  ),
  add constraint ussd_sessions_demo_amount_check check (
    demo_amount_minor is null or (demo_amount_minor > 0 and demo_amount_minor <= 100000000)
  );

create table if not exists public.demo_payment_authorizations (
  id uuid primary key default gen_random_uuid(),
  nonce text unique not null,
  session_id uuid unique not null references public.ussd_sessions(id),
  profile_id uuid not null references public.profiles(id),
  payment_kind text not null check (payment_kind in ('bank_transfer', 'airtime', 'bill_payment')),
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 100000000),
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  created_at timestamptz not null default now(),

  constraint demo_payment_authorizations_nonce_length check (char_length(nonce) between 32 and 128)
);

create index if not exists demo_payment_authorizations_pending
  on public.demo_payment_authorizations (nonce, expires_at)
  where consumed_at is null;

create table if not exists public.demo_transactions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid unique not null references public.ussd_sessions(id),
  authorization_id uuid unique not null references public.demo_payment_authorizations(id),
  profile_id uuid not null references public.profiles(id),
  payment_kind text not null check (payment_kind in ('bank_transfer', 'airtime', 'bill_payment')),
  provider_key text not null,
  channel text not null check (channel in ('ussd', 'dashboard')),
  description text not null,
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 100000000),
  currency text not null default 'NGN' check (currency = 'NGN'),
  reference text unique not null,
  status text not null check (status in ('completed', 'failed')),
  processing_time text not null,
  receipt jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz null,

  constraint demo_transactions_provider_key_length check (char_length(provider_key) between 1 and 64),
  constraint demo_transactions_description_length check (char_length(description) between 1 and 160),
  constraint demo_transactions_reference_length check (char_length(reference) between 12 and 96)
);

create index if not exists demo_transactions_profile_history
  on public.demo_transactions (profile_id, created_at desc);

drop function if exists public.consume_demo_payment_authorization(text, uuid, uuid, text, bigint);

create function public.consume_demo_payment_authorization(
  p_nonce text,
  p_session_id uuid,
  p_profile_id uuid,
  p_payment_kind text,
  p_amount_minor bigint
)
returns table (authorization_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_authorization public.demo_payment_authorizations%rowtype;
  v_session public.ussd_sessions%rowtype;
begin
  select * into v_authorization
  from public.demo_payment_authorizations
  where nonce = p_nonce and session_id = p_session_id
  for update;

  if not found
     or v_authorization.consumed_at is not null
     or v_authorization.expires_at <= now()
     or v_authorization.profile_id <> p_profile_id
     or v_authorization.payment_kind <> p_payment_kind
     or v_authorization.amount_minor <> p_amount_minor then
    return;
  end if;

  select * into v_session
  from public.ussd_sessions
  where id = p_session_id
  for update;

  if not found
     or v_session.consumed_at is not null
     or v_session.expires_at <= now()
     or v_session.current_step <> 'demo_pin'
     or v_session.profile_id <> p_profile_id
     or v_session.flow_type <> p_payment_kind
     or v_session.demo_amount_minor <> p_amount_minor then
    return;
  end if;

  update public.demo_payment_authorizations
  set consumed_at = now()
  where id = v_authorization.id;

  update public.ussd_sessions
  set consumed_at = now(), current_step = 'completed'
  where id = v_session.id;

  return query select v_authorization.id;
end;
$$;

alter table public.demo_payment_authorizations enable row level security;
alter table public.demo_transactions enable row level security;

revoke all on table public.demo_payment_authorizations from anon, authenticated;
revoke all on table public.demo_transactions from anon, authenticated;
revoke all on function public.consume_demo_payment_authorization(text, uuid, uuid, text, bigint)
  from public, anon, authenticated;

grant execute on function public.consume_demo_payment_authorization(text, uuid, uuid, text, bigint)
  to service_role;
