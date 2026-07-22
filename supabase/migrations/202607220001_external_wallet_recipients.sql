-- Allow secure USSD transfers to either a linked Rove phone number or an
-- arbitrary Solana public address. Every authorization remains bound to the
-- exact destination address so it cannot be substituted after PIN approval.

alter table public.ussd_sessions
  add column if not exists recipient_wallet_address text null;

update public.ussd_sessions as session_record
set recipient_wallet_address = profile.solana_wallet_address
from public.profiles as profile
where session_record.recipient_profile_id = profile.id
  and session_record.recipient_wallet_address is null;

alter table public.ussd_sessions
  drop constraint if exists ussd_sessions_recipient_wallet_address_check,
  drop constraint if exists ussd_sessions_recipient_target_check,
  add constraint ussd_sessions_recipient_wallet_address_check
    check (recipient_wallet_address is null or recipient_wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  add constraint ussd_sessions_recipient_target_check check (
    (recipient_wallet_address is null and recipient_profile_id is null and recipient_phone_number is null)
    or
    (recipient_wallet_address is not null and (
      (recipient_profile_id is not null and recipient_phone_number is not null)
      or (recipient_profile_id is null and recipient_phone_number is null)
    ))
  );

alter table public.transaction_authorizations
  add column if not exists recipient_wallet_address text null,
  alter column recipient_profile_id drop not null;

update public.transaction_authorizations as auth_record
set recipient_wallet_address = profile.solana_wallet_address
from public.profiles as profile
where auth_record.recipient_profile_id = profile.id
  and auth_record.recipient_wallet_address is null;

alter table public.transaction_authorizations
  alter column recipient_wallet_address set not null,
  drop constraint if exists transaction_authorizations_recipient_wallet_address_check,
  add constraint transaction_authorizations_recipient_wallet_address_check
    check (recipient_wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$');

alter table public.ussd_transfers
  add column if not exists recipient_wallet_address text null,
  alter column recipient_profile_id drop not null,
  alter column recipient_phone_number drop not null;

update public.ussd_transfers as transfer_record
set recipient_wallet_address = profile.solana_wallet_address
from public.profiles as profile
where transfer_record.recipient_profile_id = profile.id
  and transfer_record.recipient_wallet_address is null;

alter table public.ussd_transfers
  alter column recipient_wallet_address set not null,
  drop constraint if exists ussd_transfers_recipient_wallet_address_check,
  drop constraint if exists ussd_transfers_recipient_target_check,
  add constraint ussd_transfers_recipient_wallet_address_check
    check (recipient_wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  add constraint ussd_transfers_recipient_target_check check (
    (recipient_profile_id is not null and recipient_phone_number is not null)
    or (recipient_profile_id is null and recipient_phone_number is null)
  );

drop function if exists public.consume_transaction_authorization(text, uuid, uuid, uuid, bigint);
drop function if exists public.consume_transaction_authorization(text, uuid, uuid, uuid, text, bigint);

create function public.consume_transaction_authorization(
  p_nonce text,
  p_session_id uuid,
  p_sender_profile_id uuid,
  p_recipient_profile_id uuid,
  p_recipient_wallet_address text,
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
     or v_authorization.recipient_profile_id is distinct from p_recipient_profile_id
     or v_authorization.recipient_wallet_address <> p_recipient_wallet_address
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
     or v_session.recipient_profile_id is distinct from p_recipient_profile_id
     or v_session.recipient_wallet_address <> p_recipient_wallet_address
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

revoke all on function public.consume_transaction_authorization(text, uuid, uuid, uuid, text, bigint)
  from public, anon, authenticated;
grant execute on function public.consume_transaction_authorization(text, uuid, uuid, uuid, text, bigint)
  to service_role;
