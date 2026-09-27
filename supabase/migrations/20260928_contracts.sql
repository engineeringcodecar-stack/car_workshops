-- ============================================================================
--  GOVERNMENT CONTRACTS — عقود محافظة ميسان  (2026-09-28)
--
--  A contract is a government body we service on credit (نظام الآجل). Its cars
--  come to our branches and go through the normal reception → floor → audit
--  flow like any customer. The only difference is that each of its orders is
--  tagged with contract_id, which gives the contract its own tab, its own
--  statement and its own payment ledger.
--
--    contracts           one row per contracted body (seeded: محافظة ميسان)
--    inspection_reports  + contract_id  (NULL = an ordinary customer)
--    contract_payments   lump-sum payments the body makes against its balance
--
--  Balance = Σ net of its closed invoices
--          − (Σ paid at the moment each invoice was closed + Σ payments)
--
--  Additive and idempotent: safe to re-run, and safe for code that does not
--  know about contracts yet (the new column is nullable with no default, so the
--  ALTER is a metadata-only change on inspection_reports).
-- ============================================================================

create table if not exists public.contracts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  notes       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- RESTRICT on purpose: a contract that has invoices against it is billing
-- history, and must never silently disappear or untag its orders.
alter table public.inspection_reports
  add column if not exists contract_id uuid references public.contracts(id) on delete restrict;

-- The contract tab filters on this. Nearly every row is NULL, so a partial
-- index stays tiny.
create index if not exists inspection_reports_contract_id
  on public.inspection_reports (contract_id, created_at desc)
  where contract_id is not null;

create table if not exists public.contract_payments (
  id           uuid primary key default gen_random_uuid(),
  contract_id  uuid not null references public.contracts(id) on delete restrict,
  -- Optional: which branch received the money. NULL = paid to the company as a
  -- whole, which only counts in the all-branches view of the contract.
  branch_id    uuid references public.branches(id) on delete set null,
  amount       numeric not null check (amount > 0),
  paid_at      date not null default current_date,
  note         text,
  created_by   text,
  created_at   timestamptz not null default now()
);

create index if not exists contract_payments_contract
  on public.contract_payments (contract_id, paid_at desc);

-- Same access model as every other app table: any signed-in employee, nothing
-- for anon. Page-level permissions decide who sees the tab.
alter table public.contracts enable row level security;
alter table public.contract_payments enable row level security;

drop policy if exists authenticated_all_access on public.contracts;
create policy authenticated_all_access on public.contracts
  for all to authenticated using (true) with check (true);

drop policy if exists authenticated_all_access on public.contract_payments;
create policy authenticated_all_access on public.contract_payments
  for all to authenticated using (true) with check (true);

insert into public.contracts (name) values ('محافظة ميسان')
  on conflict (name) do nothing;

-- Let PostgREST see the new tables and the contracts(name) embed right away.
notify pgrst, 'reload schema';
