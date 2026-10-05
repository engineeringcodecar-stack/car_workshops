-- ============================================================================
--  CONTRACT VIEW LINK — رابط مشاهدة أوراق عمل العقد  (2026-10-05)
--
--  The contracted body (e.g. محافظة ميسان) gets a private link that shows its
--  work sheets, read-only: no edit, no add, no search.
--
--  Deliberately NOT a login account. Every signed-in account can read and write
--  every table (RLS = authenticated_all_access), so an outside party must never
--  be given one. Instead the link carries a long random token, and the page reads
--  through ONE security-definer function that returns that contract's work sheets
--  and nothing else. Anonymous visitors still have no table access at all, the
--  same model as the public QR booklet (get_public_booklet).
--
--  Revoking: set contracts.share_token to NULL (or a new token) from the
--  contracts tab; the old link stops working immediately.
--
--  Idempotent; safe to re-run.
-- ============================================================================

alter table public.contracts add column if not exists share_token text;

create unique index if not exists contracts_share_token
  on public.contracts (share_token) where share_token is not null;

create or replace function public.get_contract_worksheets(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'contract', jsonb_build_object('name', c.name),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'report_number', r.report_number,
        'status', r.status,
        'order_type', r.order_type,
        'created_at', r.created_at,
        'completed_at', r.completed_at,
        'odometer_reading', r.odometer_reading,
        'odometer_unit', r.odometer_unit,
        'total_price', r.total_price,
        'notes', r.notes,
        -- What the printed sheet shows, minus the per-technician ratings and
        -- supervisor notes, which are internal staff evaluations.
        'selected_services', case
            when jsonb_typeof(r.selected_services) = 'array' and jsonb_array_length(r.selected_services) > 0
            then jsonb_build_array((r.selected_services->0) - 'technicians') || (r.selected_services - 0)
            else coalesce(r.selected_services, '[]'::jsonb)
          end,
        'vehicles', case when v.id is null then null else jsonb_build_object(
            'make', v.make, 'model', v.model, 'plate_number', v.plate_number,
            'engine_size', v.engine_size, 'booklet_serial', v.booklet_serial,
            'clients', case when cl.id is null then null
                       else jsonb_build_object('name', cl.name, 'phone', cl.phone) end
          ) end,
        'branches', case when b.id is null then null else jsonb_build_object('name', b.name) end,
        'receptionist', case when e.id is null then null else jsonb_build_object('name', e.name) end,
        'contract', jsonb_build_object('name', c.name)
      ) order by r.created_at desc)
      from public.inspection_reports r
      left join public.vehicles  v  on v.id  = r.vehicle_id
      left join public.clients   cl on cl.id = v.client_id
      left join public.branches  b  on b.id  = r.branch_id
      left join public.employees e  on e.id  = r.receptionist_id
      where r.contract_id = c.id
        and r.order_type is distinct from 'sale'
        and r.status is distinct from 'ملغى'
        -- invoices staff removed from accounting are junk / wrong entries
        and coalesce(r.selected_services->0->'pricing'->>'auditExcluded', 'false') <> 'true'
    ), '[]'::jsonb)
  )
  from public.contracts c
  where p_token is not null
    and length(p_token) >= 24
    and c.share_token = p_token
    and c.is_active
  limit 1;
$$;

revoke all on function public.get_contract_worksheets(text) from public;
grant execute on function public.get_contract_worksheets(text) to anon, authenticated;

notify pgrst, 'reload schema';
