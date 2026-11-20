-- Packaging-aware inventory for the private warehouse pilot.
-- Quantity remains the on-hand amount, expressed in the row's base_unit.
alter table public.inventory
  alter column quantity type numeric(18,6) using quantity::numeric,
  alter column min_quantity type numeric(18,6) using min_quantity::numeric;

alter table public.inventory
  add column if not exists murabba_id text,
  add column if not exists base_unit text,
  add column if not exists unit1 text,
  add column if not exists unit2 text,
  add column if not exists unit3 text,
  add column if not exists unit1_to_unit2 numeric(18,6),
  add column if not exists unit2_to_unit3 numeric(18,6),
  add column if not exists price_unit1 numeric(18,2),
  add column if not exists price_unit2 numeric(18,2),
  add column if not exists price_unit3 numeric(18,2),
  add column if not exists price_wholesale numeric(18,2),
  add column if not exists last_purchase_price numeric(18,2),
  add column if not exists supplier text,
  add column if not exists store text,
  add column if not exists location text,
  add column if not exists special_price numeric(18,2);

alter table public.inventory alter column purchase_price drop not null;
update public.inventory set base_unit = coalesce(nullif(base_unit, ''), nullif(unit1, ''), 'قطعة');
update public.inventory set murabba_id = item_code where murabba_id is null and item_code is not null and branch_id is not null;
do $$
begin
  if exists (
    select 1 from public.inventory
    where branch_id is not null and murabba_id is not null and murabba_id <> ''
    group by branch_id, murabba_id having count(*) > 1
  ) then
    raise exception 'لا يمكن تفعيل مفتاح المخزن: يوجد رقم مادة مكرر داخل الفرع. عالج التكرارات ثم أعد تطبيق الترحيل.';
  end if;
end $$;
create unique index if not exists inventory_branch_murabba_id_uidx
  on public.inventory(branch_id, murabba_id)
  where murabba_id is not null and murabba_id <> '';

alter table public.used_parts
  alter column quantity type numeric(18,6) using quantity::numeric;

create table if not exists public.inventory_sale_lines (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.inspection_reports(id) on delete cascade,
  inventory_id uuid references public.inventory(id) on delete set null,
  branch_id uuid references public.branches(id),
  item_code text,
  item_name text not null,
  package_unit text not null,
  quantity numeric(18,6) not null check (quantity > 0),
  stock_quantity numeric(18,6) not null check (stock_quantity > 0),
  unit_price numeric(18,2) not null check (unit_price >= 0),
  total_price numeric(18,2) not null check (total_price >= 0),
  created_at timestamptz not null default now()
);

create index if not exists inventory_sale_lines_report_id_idx
  on public.inventory_sale_lines(report_id);

alter table public.inventory_sale_lines enable row level security;
drop policy if exists "Authenticated users can read inventory sale lines" on public.inventory_sale_lines;
create policy "Authenticated users can read inventory sale lines"
  on public.inventory_sale_lines for select to authenticated using (true);

create table if not exists public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches(id),
  inventory_id uuid references public.inventory(id) on delete set null,
  item_code text,
  item_name text not null,
  transaction_type text not null,
  quantity_changed numeric(18,6) not null,
  quantity_before numeric(18,6) not null,
  quantity_after numeric(18,6) not null,
  reference_id uuid,
  user_name text,
  created_at timestamptz not null default now()
);

alter table public.inventory_transactions
  add column if not exists reference_id uuid;

alter table public.inventory_transactions enable row level security;
drop policy if exists "Authenticated users can read inventory transactions" on public.inventory_transactions;
create policy "Authenticated users can read inventory transactions"
  on public.inventory_transactions for select to authenticated using (true);

create or replace function public.apply_inventory_sale_line()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  item public.inventory%rowtype;
  before_qty numeric(18,6);
  after_qty numeric(18,6);
begin
  if tg_op = 'INSERT' then
    select * into item from public.inventory where id = new.inventory_id for update;
    if not found then
      raise exception 'المادة المخزنية لم تعد موجودة.';
    end if;
    if item.branch_id is distinct from new.branch_id then
      raise exception 'المادة المحددة لا تتبع فرع الفاتورة.';
    end if;
    before_qty := coalesce(item.quantity, 0);
    if before_qty < new.stock_quantity then
      raise exception 'الكمية غير كافية للمادة "%". المتوفر: %، المطلوب: % %.',
        item.name, before_qty, new.stock_quantity, coalesce(nullif(item.base_unit, ''), nullif(item.unit1, ''), 'وحدة');
    end if;
    after_qty := before_qty - new.stock_quantity;
    update public.inventory set quantity = after_qty where id = item.id;
    insert into public.inventory_transactions (
      branch_id, inventory_id, item_code, item_name, transaction_type,
      quantity_changed, quantity_before, quantity_after, reference_id, user_name
    ) values (
      new.branch_id, item.id, item.item_code, item.name, 'بيع منتج',
      -new.stock_quantity, before_qty, after_qty, new.report_id, 'نظام المبيعات'
    );
    return new;
  end if;

  if tg_op = 'DELETE' and old.inventory_id is not null then
    select * into item from public.inventory where id = old.inventory_id for update;
    if found then
      before_qty := coalesce(item.quantity, 0);
      after_qty := before_qty + old.stock_quantity;
      update public.inventory set quantity = after_qty where id = item.id;
      insert into public.inventory_transactions (
        branch_id, inventory_id, item_code, item_name, transaction_type,
        quantity_changed, quantity_before, quantity_after, reference_id, user_name
      ) values (
        old.branch_id, item.id, old.item_code, old.item_name, 'إرجاع بيع محذوف',
        old.stock_quantity, before_qty, after_qty, old.report_id, 'نظام المبيعات'
      );
    end if;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists inventory_sale_line_stock on public.inventory_sale_lines;
create trigger inventory_sale_line_stock
  before insert or delete on public.inventory_sale_lines
  for each row execute function public.apply_inventory_sale_line();

create or replace function public.save_inventory_sale(
  p_report_id uuid,
  p_branch_id uuid,
  p_receptionist_id uuid,
  p_contract_id uuid,
  p_total_price numeric,
  p_selected_services jsonb,
  p_lines jsonb
)
returns table(id uuid, report_number integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  report_row public.inspection_reports%rowtype;
  line jsonb;
  item public.inventory%rowtype;
  selected_unit text;
  base_unit text;
  f1 numeric(18,6);
  f2 numeric(18,6);
  smallest_per_unit numeric(18,6);
  smallest_per_base numeric(18,6);
  stock_qty numeric(18,6);
  sale_qty numeric(18,6);
  sale_price numeric(18,2);
  line_total numeric(18,2);
  gross_total numeric(18,2) := 0;
  discount_amount numeric(18,2) := 0;
  expected_total numeric(18,2) := 0;
  line_index integer := 0;
  product_data jsonb;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول لتسجيل البيع.';
  end if;
  if p_branch_id is null or p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'اختر الفرع وأرسل قائمة المواد المخزنية.';
  end if;
  if jsonb_typeof(p_selected_services) is distinct from 'array'
     or jsonb_typeof(p_selected_services->0->'products') is distinct from 'array' then
    raise exception 'تفاصيل المنتجات ناقصة.';
  end if;
  if jsonb_array_length(p_selected_services->0->'products') <> jsonb_array_length(p_lines) then
    raise exception 'تفاصيل المنتجات لا تطابق أسطر المخزن.';
  end if;

  if p_report_id is null then
    insert into public.inspection_reports (
      branch_id, vehicle_id, receptionist_id, order_type, contract_id,
      status, odometer_reading, total_price, selected_services
    ) values (
      p_branch_id, null, p_receptionist_id, 'sale', p_contract_id,
      'تم الانتهاء', 0, coalesce(p_total_price, 0), coalesce(p_selected_services, '[]'::jsonb)
    ) returning * into report_row;
  else
    select * into report_row from public.inspection_reports where inspection_reports.id = p_report_id for update;
    if not found or report_row.order_type <> 'sale' then
      raise exception 'فاتورة البيع غير موجودة.';
    end if;
    if report_row.branch_id is distinct from p_branch_id then
      raise exception 'لا يمكن تغيير فرع فاتورة البيع.';
    end if;
    delete from public.inventory_sale_lines where report_id = p_report_id;
    update public.inspection_reports
      set contract_id = p_contract_id,
          total_price = coalesce(p_total_price, 0),
          selected_services = coalesce(p_selected_services, '[]'::jsonb)
      where inspection_reports.id = p_report_id
      returning * into report_row;
  end if;

  for line in select value from jsonb_array_elements(p_lines) with ordinality as lines(value, ord) order by ord
  loop
    line_index := line_index + 1;
    select * into item
      from public.inventory
      where id = nullif(line->>'inventory_id', '')::uuid
      for update;
    if not found then
      raise exception 'إحدى المواد المختارة غير موجودة في المخزن.';
    end if;
    if item.branch_id is distinct from p_branch_id then
      raise exception 'المادة "%" لا تتبع الفرع المحدد.', item.name;
    end if;

    sale_qty := nullif(line->>'quantity', '')::numeric;
    selected_unit := nullif(btrim(line->>'package_unit'), '');
    base_unit := coalesce(nullif(btrim(item.base_unit), ''), nullif(btrim(item.unit1), ''), 'قطعة');
    if sale_qty is null or sale_qty <= 0 or selected_unit is null then
      raise exception 'الكمية ووحدة التعبئة مطلوبة للمادة "%".', item.name;
    end if;
    if selected_unit <> base_unit and selected_unit is distinct from item.unit1
       and selected_unit is distinct from item.unit2 and selected_unit is distinct from item.unit3 then
      raise exception 'وحدة التعبئة المحددة غير معرفة للمادة "%".', item.name;
    end if;

    f1 := coalesce(nullif(item.unit1_to_unit2, 0), 1);
    f2 := coalesce(nullif(item.unit2_to_unit3, 0), 1);
    smallest_per_unit := case
      when selected_unit is not null and selected_unit = item.unit1 then case when item.unit3 is not null and item.unit3 <> '' then f1 * f2 when item.unit2 is not null and item.unit2 <> '' then f1 else 1 end
      when selected_unit is not null and selected_unit = item.unit2 then case when item.unit3 is not null and item.unit3 <> '' then f2 else 1 end
      when selected_unit is not null and selected_unit = item.unit3 then 1
      when selected_unit = base_unit then case
        when base_unit = item.unit1 then case when item.unit3 is not null and item.unit3 <> '' then f1 * f2 when item.unit2 is not null and item.unit2 <> '' then f1 else 1 end
        when base_unit = item.unit2 then case when item.unit3 is not null and item.unit3 <> '' then f2 else 1 end
        else 1
      end
      else 0
    end;
    smallest_per_base := case
      when base_unit = item.unit1 then case when item.unit3 is not null and item.unit3 <> '' then f1 * f2 when item.unit2 is not null and item.unit2 <> '' then f1 else 1 end
      when base_unit = item.unit2 then case when item.unit3 is not null and item.unit3 <> '' then f2 else 1 end
      else 1
    end;
    if smallest_per_unit <= 0 or smallest_per_base <= 0 then
      raise exception 'معاملات التعبئة غير صالحة للمادة "%".', item.name;
    end if;
    stock_qty := round(sale_qty * smallest_per_unit / smallest_per_base, 6);

    sale_price := case
      when selected_unit = base_unit then item.sell_price
      when selected_unit = item.unit1 then coalesce(item.price_unit1, round(item.sell_price * smallest_per_unit / smallest_per_base, 2))
      when selected_unit = item.unit2 then coalesce(item.price_unit2, round(item.sell_price * smallest_per_unit / smallest_per_base, 2))
      when selected_unit = item.unit3 then coalesce(item.price_unit3, round(item.sell_price * smallest_per_unit / smallest_per_base, 2))
      else null
    end;
    if sale_price is null then
      raise exception 'سعر وحدة "%" غير محدد للمادة "%".', selected_unit, item.name;
    end if;
    line_total := round(sale_qty * sale_price, 2);
    gross_total := gross_total + line_total;
    product_data := p_selected_services->0->'products'->(line_index-1);
    if nullif(product_data->>'inventory_id','')::uuid is distinct from item.id
       or product_data->>'packageUnit' is distinct from selected_unit
       or round((product_data->>'qty')::numeric,6) is distinct from round(sale_qty,6)
       or round((product_data->>'price')::numeric,2) is distinct from sale_price then
      raise exception 'تفاصيل المنتج لا تطابق المادة وسعر التعبئة الحاليين للمادة "%".', item.name;
    end if;

    insert into public.inventory_sale_lines (
      report_id, inventory_id, branch_id, item_code, item_name,
      package_unit, quantity, stock_quantity, unit_price, total_price
    ) values (
      report_row.id, item.id, item.branch_id, item.item_code, item.name,
      selected_unit, sale_qty, stock_qty, sale_price, line_total
    );
  end loop;

  discount_amount := greatest(0, coalesce(nullif(p_selected_services->0->'pricing'->>'discount','')::numeric,0));
  expected_total := greatest(0, gross_total-discount_amount);
  if round(coalesce(p_total_price,0),2) is distinct from expected_total then
    raise exception 'إجمالي الفاتورة لا يطابق أسعار التعبئة والكميات. أعد مراجعة البيع.';
  end if;
  update public.inspection_reports set total_price = expected_total where inspection_reports.id = report_row.id;

  return query select report_row.id, report_row.report_number;
end;
$$;

revoke all on function public.save_inventory_sale(uuid, uuid, uuid, uuid, numeric, jsonb, jsonb) from public;
grant execute on function public.save_inventory_sale(uuid, uuid, uuid, uuid, numeric, jsonb, jsonb) to authenticated;

create or replace function public.import_inventory_rows(p_mode text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_data jsonb;
  branch_key uuid;
  item_key text;
  existing public.inventory%rowtype;
  existed_before boolean;
  before_qty numeric(18,6);
  after_qty numeric(18,6);
  inserted_count integer := 0;
  updated_count integer := 0;
  missing_count integer := 0;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول.'; end if;
  if not exists (select 1 from public.employees where auth_id = auth.uid() and role in ('Owner','Admin')) then
    raise exception 'استيراد المخزن متاح للمالك أو المدير فقط.';
  end if;
  if p_mode not in ('full','new','quantities','prices') then raise exception 'نوع الاستيراد غير معروف.'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'لا توجد صفوف صالحة للاستيراد.';
  end if;
  if jsonb_array_length(p_rows) > 10000 then raise exception 'الملف يتجاوز حد 10,000 صف في الدفعة الواحدة.'; end if;

  if exists (
    select 1 from jsonb_to_recordset(p_rows) as x(branch_id uuid, murabba_id text)
    group by x.branch_id, btrim(x.murabba_id) having count(*) > 1
  ) then raise exception 'يوجد مفتاح فرع + ت مكرر داخل الملف.'; end if;

  for row_data in select value from jsonb_array_elements(p_rows)
  loop
    branch_key := nullif(row_data->>'branch_id','')::uuid;
    item_key := nullif(btrim(row_data->>'murabba_id'),'');
    if branch_key is null or item_key is null then raise exception 'كل صف يحتاج الفرع ورقم ت.'; end if;
    if not exists (select 1 from public.branches where id = branch_key) then raise exception 'الفرع المحدد غير موجود.'; end if;
    select * into existing from public.inventory where branch_id = branch_key and murabba_id = item_key for update;
    existed_before := found;

    if p_mode = 'quantities' then
      if not found then raise exception 'المادة رقم % غير موجودة في الفرع المحدد.', item_key; end if;
      if nullif(row_data->>'quantity','') is null then raise exception 'الكمية الجديدة فارغة للمادة رقم %.', item_key; end if;
      before_qty := coalesce(existing.quantity,0);
      after_qty := (row_data->>'quantity')::numeric;
      if after_qty < 0 then raise exception 'الكمية لا يمكن أن تكون سالبة (ت=%).', item_key; end if;
      update public.inventory set quantity = after_qty where id = existing.id;
      insert into public.inventory_transactions (branch_id, inventory_id, item_code, item_name, transaction_type, quantity_changed, quantity_before, quantity_after, user_name)
      values (branch_key, existing.id, existing.item_code, existing.name, 'تحديث كمية', after_qty-before_qty, before_qty, after_qty, auth.uid()::text);
      updated_count := updated_count + 1;
      continue;
    end if;

    if p_mode = 'prices' then
      if not found then raise exception 'المادة رقم % غير موجودة في الفرع المحدد.', item_key; end if;
      update public.inventory set
        sell_price = coalesce(nullif(row_data->>'sell_price','')::numeric, sell_price),
        special_price = coalesce(nullif(row_data->>'special_price','')::numeric, special_price),
        purchase_price = coalesce(nullif(row_data->>'purchase_price','')::numeric, purchase_price),
        price_wholesale = coalesce(nullif(row_data->>'price_wholesale','')::numeric, price_wholesale),
        last_purchase_price = coalesce(nullif(row_data->>'last_purchase_price','')::numeric, last_purchase_price),
        price_unit1 = coalesce(nullif(row_data->>'price_unit1','')::numeric, price_unit1),
        price_unit2 = coalesce(nullif(row_data->>'price_unit2','')::numeric, price_unit2),
        price_unit3 = coalesce(nullif(row_data->>'price_unit3','')::numeric, price_unit3)
      where id = existing.id;
      updated_count := updated_count + 1;
      continue;
    end if;

    if nullif(btrim(row_data->>'name'),'') is null or nullif(row_data->>'sell_price','') is null then
      raise exception 'اسم المادة وسعر العام إلزاميان (ت=%).', item_key;
    end if;
    if nullif(row_data->>'quantity','') is null or (row_data->>'quantity')::numeric < 0 then
      raise exception 'العدد مطلوب ولا يمكن أن يكون سالباً (ت=%).', item_key;
    end if;
    if (nullif(row_data->>'unit1_to_unit2','') is not null and (row_data->>'unit1_to_unit2')::numeric <= 0)
       or (nullif(row_data->>'unit2_to_unit3','') is not null and (row_data->>'unit2_to_unit3')::numeric <= 0)
       or (nullif(btrim(row_data->>'unit2'),'') is not null and nullif(row_data->>'unit1_to_unit2','') is null)
       or (nullif(btrim(row_data->>'unit3'),'') is not null and (nullif(btrim(row_data->>'unit2'),'') is null or nullif(row_data->>'unit2_to_unit3','') is null)) then
      raise exception 'عوامل التعبئة يجب أن تكون أكبر من صفر (ت=%).', item_key;
    end if;
    if nullif(btrim(row_data->>'unit1'),'') is null then raise exception 'تعبئة1 مطلوبة للمادة (ت=%).', item_key; end if;
    if coalesce(nullif(btrim(row_data->>'base_unit'),''),nullif(btrim(row_data->>'unit1'),'')) is distinct from nullif(btrim(row_data->>'unit1'),'')
       and coalesce(nullif(btrim(row_data->>'base_unit'),''),nullif(btrim(row_data->>'unit1'),'')) is distinct from nullif(btrim(row_data->>'unit2'),'')
       and coalesce(nullif(btrim(row_data->>'base_unit'),''),nullif(btrim(row_data->>'unit1'),'')) is distinct from nullif(btrim(row_data->>'unit3'),'') then
      raise exception 'التعبئة الأساسية يجب أن تطابق إحدى وحدات المادة (ت=%).', item_key;
    end if;

    insert into public.inventory (
      branch_id, murabba_id, item_code, name, category, purchase_price, sell_price,
      quantity, min_quantity, base_unit, unit1, unit2, unit3, unit1_to_unit2, unit2_to_unit3,
      price_unit1, price_unit2, price_unit3, price_wholesale, last_purchase_price,
      supplier, store, location, special_price, notes, created_at
    ) values (
      branch_key, item_key, item_key, btrim(row_data->>'name'), coalesce(nullif(btrim(row_data->>'category'),''),'غير مصنف'),
      nullif(row_data->>'purchase_price','')::numeric, (row_data->>'sell_price')::numeric,
      (row_data->>'quantity')::numeric, coalesce(nullif(row_data->>'min_quantity','')::numeric,5),
      coalesce(nullif(btrim(row_data->>'base_unit'),''),nullif(btrim(row_data->>'unit1'),''),'قطعة'),
      nullif(btrim(row_data->>'unit1'),''), nullif(btrim(row_data->>'unit2'),''), nullif(btrim(row_data->>'unit3'),''),
      nullif(row_data->>'unit1_to_unit2','')::numeric, nullif(row_data->>'unit2_to_unit3','')::numeric,
      nullif(row_data->>'price_unit1','')::numeric, nullif(row_data->>'price_unit2','')::numeric, nullif(row_data->>'price_unit3','')::numeric,
      nullif(row_data->>'price_wholesale','')::numeric, nullif(row_data->>'last_purchase_price','')::numeric,
      nullif(btrim(row_data->>'supplier'),''), nullif(btrim(row_data->>'store'),''), nullif(btrim(row_data->>'location'),''),
      nullif(row_data->>'special_price','')::numeric, nullif(btrim(row_data->>'notes'),''), nullif(row_data->>'created_at','')::timestamptz
    ) on conflict (branch_id, murabba_id) where murabba_id is not null and murabba_id <> '' do update set
      item_code = excluded.item_code, name = excluded.name, category = excluded.category,
      purchase_price = excluded.purchase_price, sell_price = excluded.sell_price, quantity = excluded.quantity,
      min_quantity = excluded.min_quantity, base_unit = excluded.base_unit, unit1 = excluded.unit1,
      unit2 = excluded.unit2, unit3 = excluded.unit3, unit1_to_unit2 = excluded.unit1_to_unit2,
      unit2_to_unit3 = excluded.unit2_to_unit3, price_unit1 = excluded.price_unit1,
      price_unit2 = excluded.price_unit2, price_unit3 = excluded.price_unit3,
      price_wholesale = excluded.price_wholesale, last_purchase_price = excluded.last_purchase_price,
      supplier = excluded.supplier, store = excluded.store, location = excluded.location,
      special_price = excluded.special_price, notes = excluded.notes,
      created_at = coalesce(excluded.created_at, public.inventory.created_at);
    if existed_before then
      updated_count := updated_count + 1;
      if coalesce(existing.quantity,0) <> (row_data->>'quantity')::numeric then
        insert into public.inventory_transactions (branch_id, inventory_id, item_code, item_name, transaction_type, quantity_changed, quantity_before, quantity_after, user_name)
        select branch_key, i.id, i.item_code, i.name, 'استيراد رصيد', i.quantity-existing.quantity, existing.quantity, i.quantity, auth.uid()::text
          from public.inventory i where i.branch_id = branch_key and i.murabba_id = item_key;
      end if;
    else
      inserted_count := inserted_count + 1;
      insert into public.inventory_transactions (branch_id, inventory_id, item_code, item_name, transaction_type, quantity_changed, quantity_before, quantity_after, user_name)
      select branch_key, i.id, i.item_code, i.name, 'رصيد افتتاحي', i.quantity, 0, i.quantity, auth.uid()::text
        from public.inventory i where i.branch_id = branch_key and i.murabba_id = item_key;
    end if;
  end loop;

  return jsonb_build_object('inserted', inserted_count, 'updated', updated_count, 'missing', missing_count);
end;
$$;

revoke all on function public.import_inventory_rows(text, jsonb) from public;
grant execute on function public.import_inventory_rows(text, jsonb) to authenticated;
