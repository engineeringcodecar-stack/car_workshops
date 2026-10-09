-- ============================================================================
--  STAFF-ONLY ACCESS  (2026-10-10)
--
--  1. Every app table had `authenticated_all_access ... using (true)`, so ANY
--     signed-in session got full read/write: a self-signup, or a removed
--     employee whose auth user still exists. Access now requires a row in
--     public.employees linked to the caller (employees.auth_id = auth.uid()).
--
--  2. employees stays read-only for browsers (writes go through the guarded
--     server actions), but only staff can read it.
--
--  3. workshop_settings becomes read-only for browsers. The Google Sheets
--     webhook URL (customer data is POSTed there from every browser) is saved
--     only by the Owner/Admin-checked server action, which uses service_role.
--
--  4. assistant_query runs its query in a read-only transaction, so even a
--     function call smuggled past the keyword filter cannot write.
--
--  Unaffected: get_public_booklet / get_contract_worksheets (SECURITY DEFINER,
--  bypass RLS), server actions (service_role bypasses RLS), and the login flow
--  (a real employee reading their own employees row is staff).
--
--  Idempotent and safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. is_staff(): does the caller have an employees row?
--    SECURITY DEFINER so it reads employees without going through employees'
--    own policy (which calls it) — no recursion.
-- ----------------------------------------------------------------------------
create index if not exists employees_auth_id_idx on public.employees (auth_id);

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.employees e
    where e.auth_id is not null and e.auth_id = auth.uid()
  );
$$;

revoke all on function public.is_staff() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.is_staff() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.is_staff() to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.is_staff() to service_role';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Every table with an `authenticated_all_access` policy: staff only.
--    Found dynamically, so tables added by later migrations are covered too.
--    `(select ...)` lets Postgres evaluate is_staff() once per query, not per row.
-- ----------------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in
    select distinct schemaname, tablename
    from pg_policies
    where schemaname = 'public' and policyname = 'authenticated_all_access'
    order by tablename
  loop
    execute format('drop policy if exists authenticated_all_access on %I.%I;', t.schemaname, t.tablename);
    execute format(
      'create policy authenticated_all_access on %I.%I for all to authenticated '
      'using ((select public.is_staff())) with check ((select public.is_staff()));',
      t.schemaname, t.tablename
    );
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 3. employees: still read-only for browsers, now staff only.
--    (If 20260807 was never applied, step 2 already covered its
--    authenticated_all_access policy.)
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_policies
             where schemaname = 'public' and tablename = 'employees'
               and policyname = 'employees_read_only') then
    drop policy employees_read_only on public.employees;
    create policy employees_read_only on public.employees
      for select to authenticated using ((select public.is_staff()));
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 4. workshop_settings: staff may read, nobody writes from the browser.
-- ----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.workshop_settings') is not null then
    alter table public.workshop_settings enable row level security;
    drop policy if exists authenticated_all_access on public.workshop_settings;
    drop policy if exists workshop_settings_read_only on public.workshop_settings;
    create policy workshop_settings_read_only on public.workshop_settings
      for select to authenticated using ((select public.is_staff()));
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 5. assistant_query: same as 20260625, plus a read-only transaction.
-- ----------------------------------------------------------------------------
create or replace function public.assistant_query(query_text text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  result json;
begin
  if query_text !~* '^\s*(select|with)\s' then
    raise exception 'Only read-only SELECT/WITH queries are allowed.';
  end if;
  if query_text ~* '\m(insert|update|delete|drop|alter|truncate|grant|revoke|create|comment|merge|vacuum|refresh|call|copy|reindex|cluster|attach|detach)\M' then
    raise exception 'Only read-only queries are allowed.';
  end if;

  set local statement_timeout = '10s';
  -- Any write (e.g. through a function call) now fails, and it can't be
  -- switched back to read-write once the query has started.
  set local transaction_read_only = on;
  execute format(
    'select coalesce(json_agg(t), ''[]''::json) from (select * from (%s) sub limit 1000) t',
    query_text
  ) into result;
  return result;
end;
$$;

revoke all on function public.assistant_query(text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.assistant_query(text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.assistant_query(text) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.assistant_query(text) to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';
