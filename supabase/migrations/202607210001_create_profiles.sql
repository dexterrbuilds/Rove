create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  solana_wallet_address text unique not null,
  phone_number text unique null,
  hashed_pin text null,
  activation_code text null,
  activation_expires_at timestamptz null,

  -- Privy requires its wallet ID (not only the public address) for delegated signing.
  privy_wallet_id text unique null,
  privy_user_id text unique null,
  pending_phone_number text unique null,
  failed_pin_attempts integer not null default 0 check (failed_pin_attempts between 0 and 4),
  pin_locked_until timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_phone_e164 check (phone_number is null or phone_number ~ '^\+[1-9][0-9]{7,14}$'),
  constraint profiles_pending_phone_e164 check (pending_phone_number is null or pending_phone_number ~ '^\+[1-9][0-9]{7,14}$'),
  constraint profiles_activation_six_digits check (activation_code is null or activation_code ~ '^[0-9]{6}$')
);

create unique index if not exists profiles_activation_code_unique
  on public.profiles (activation_code)
  where activation_code is not null;

create index if not exists profiles_activation_lookup
  on public.profiles (activation_code, activation_expires_at)
  where activation_code is not null;

create table if not exists public.ussd_transfers (
  id uuid primary key default gen_random_uuid(),
  session_id text unique not null,
  reference_id text unique not null,
  sender_profile_id uuid not null references public.profiles(id),
  recipient_profile_id uuid not null references public.profiles(id),
  recipient_phone_number text not null,
  amount_lamports bigint not null check (amount_lamports > 0),
  status text not null check (status in ('processing', 'confirmed', 'unknown')),
  signature text unique null,
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists ussd_transfers_set_updated_at on public.ussd_transfers;
create trigger ussd_transfers_set_updated_at before update on public.ussd_transfers
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.ussd_transfers enable row level security;

-- Browser clients cannot read PIN hashes or mutate wallets. All access goes through
-- the Privy-authenticated API or Africa's Talking webhook using the service role.
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.ussd_transfers from anon, authenticated;
