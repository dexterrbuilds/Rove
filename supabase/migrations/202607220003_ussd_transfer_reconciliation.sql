-- Distinguish a definitive Privy rejection from an ambiguous transport failure.
-- Ambiguous `unknown` rows remain untouched and are reconciled by reference_id.

alter table public.ussd_transfers
  drop constraint if exists ussd_transfers_status_check;

alter table public.ussd_transfers
  add constraint ussd_transfers_status_check
    check (status in ('processing', 'confirmed', 'failed', 'unknown'));

-- Earlier releases stored the redacted Privy error text. Clear client-side
-- rejections are known not to have been accepted for execution.
update public.ussd_transfers
set status = 'failed'
where status = 'unknown'
  and (
    error_message ~ '^(400|401|403|404|422)([[:space:]]|$)'
    or error_message = 'Invalid wallet authorization private key'
  );

create index if not exists ussd_transfers_reconciliation_lookup
  on public.ussd_transfers (sender_profile_id, status, created_at desc)
  where signature is null and status in ('processing', 'unknown');
