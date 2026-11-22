-- Work orders take materials from the branch stock, by packaging.
-- Depends on 20261120 (inventory packaging, inventory_sale_lines). Safe to run more than once.
--
-- Reception adds stock lines to a work order: a customServices entry with kind = 'stock' and
--   stock = { inventory_id, packageUnit, qty, unitPrice }
-- so the invoice, the print, the audit and every total show it like any other line.
-- The database keeps the stock right (Abbas: a work order is a sale list):
--   * finished (تم الانتهاء)            → the lines are deducted, through inventory_sale_lines
--   * edited while finished             → what changed is given back and taken again
--   * reopened, cancelled or deleted    → everything it took goes back to stock
-- Finishing is refused with a clear message when a material is short, unknown, or belongs to
-- another branch, so stock never goes negative.

-- Stock units (in the item's base unit) in one package of p_unit; NULL when the unit is not one
-- of the item's packagings. Same arithmetic as save_inventory_sale() and src/lib/inventory.ts.
CREATE OR REPLACE FUNCTION public.inventory_stock_per_package(item public.inventory, p_unit TEXT)
RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    base TEXT := COALESCE(NULLIF(btrim(item.base_unit), ''), NULLIF(btrim(item.unit1), ''), 'قطعة');
    has2 BOOLEAN := COALESCE(btrim(item.unit2), '') <> '';
    has3 BOOLEAN := COALESCE(btrim(item.unit3), '') <> '';
    f1 NUMERIC := COALESCE(NULLIF(item.unit1_to_unit2, 0), 1);
    f2 NUMERIC := COALESCE(NULLIF(item.unit2_to_unit3, 0), 1);
    small_per_u1 NUMERIC; small_per_u2 NUMERIC; small_per_unit NUMERIC; small_per_base NUMERIC;
BEGIN
    p_unit := NULLIF(btrim(p_unit), '');
    IF p_unit IS NULL THEN RETURN NULL; END IF;
    small_per_u1 := CASE WHEN has3 THEN f1 * f2 WHEN has2 THEN f1 ELSE 1 END;
    small_per_u2 := CASE WHEN has3 THEN f2 ELSE 1 END;
    small_per_base := CASE WHEN base = item.unit1 THEN small_per_u1 WHEN base = item.unit2 THEN small_per_u2 ELSE 1 END;
    small_per_unit := CASE
        WHEN p_unit = item.unit1 THEN small_per_u1
        WHEN p_unit = item.unit2 THEN small_per_u2
        WHEN p_unit = item.unit3 THEN 1
        WHEN p_unit = base THEN small_per_base
        ELSE NULL END;
    IF small_per_unit IS NULL OR small_per_base <= 0 THEN RETURN NULL; END IF;
    RETURN small_per_unit / small_per_base;
END;
$$;

-- Selling price of one package of p_unit (its own price, else the base price scaled).
CREATE OR REPLACE FUNCTION public.inventory_package_price(item public.inventory, p_unit TEXT)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_unit = COALESCE(NULLIF(btrim(item.base_unit), ''), NULLIF(btrim(item.unit1), ''), 'قطعة') THEN item.sell_price
        WHEN p_unit = item.unit1 AND item.price_unit1 IS NOT NULL THEN item.price_unit1
        WHEN p_unit = item.unit2 AND item.price_unit2 IS NOT NULL THEN item.price_unit2
        WHEN p_unit = item.unit3 AND item.price_unit3 IS NOT NULL THEN item.price_unit3
        ELSE round(item.sell_price * public.inventory_stock_per_package(item, p_unit), 2)
    END
$$;

-- The stock lines of a work-order payload, normalised and in a stable order (for comparing).
CREATE OR REPLACE FUNCTION public.work_order_stock_lines(p JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'inventory_id', c -> 'stock' ->> 'inventory_id',
               'unit', btrim(c -> 'stock' ->> 'packageUnit'),
               'qty', (c -> 'stock' ->> 'qty')::numeric,
               'unit_price', CASE WHEN COALESCE(c -> 'stock' ->> 'unitPrice', '') ~ '^[0-9]+(\.[0-9]+)?$' THEN (c -> 'stock' ->> 'unitPrice')::numeric END,
               'label', c ->> 'label')
           ORDER BY c ->> 'id'), '[]'::jsonb)
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p -> 'customServices') = 'array' THEN p -> 'customServices' ELSE '[]'::jsonb END) c
    WHERE c ->> 'kind' = 'stock'
      AND COALESCE(c -> 'stock' ->> 'inventory_id', '') ~ '^[0-9a-fA-F-]{36}$'
      AND COALESCE(c -> 'stock' ->> 'qty', '') ~ '^[0-9]+(\.[0-9]+)?$'
      AND (c -> 'stock' ->> 'qty')::numeric > 0
$$;

CREATE OR REPLACE FUNCTION public.sync_work_order_stock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    lines JSONB; old_lines JSONB; done BOOLEAN; was_done BOOLEAN := FALSE;
    line JSONB; item public.inventory%ROWTYPE; per NUMERIC; price NUMERIC; qty NUMERIC;
BEGIN
    -- Direct sales keep their own path (save_inventory_sale).
    IF COALESCE(NEW.order_type::text, '') = 'sale' THEN RETURN NEW; END IF;
    lines := public.work_order_stock_lines(CASE WHEN jsonb_typeof(NEW.selected_services::jsonb) = 'array' THEN NEW.selected_services::jsonb -> 0 ELSE NEW.selected_services::jsonb END);
    done := NEW.status::text = 'تم الانتهاء';
    IF TG_OP = 'UPDATE' THEN
        was_done := OLD.status::text = 'تم الانتهاء';
        old_lines := public.work_order_stock_lines(CASE WHEN jsonb_typeof(OLD.selected_services::jsonb) = 'array' THEN OLD.selected_services::jsonb -> 0 ELSE OLD.selected_services::jsonb END);
        IF NOT done AND NOT was_done THEN RETURN NEW; END IF;
        IF done AND was_done AND lines = old_lines AND NEW.branch_id IS NOT DISTINCT FROM OLD.branch_id THEN RETURN NEW; END IF;
    ELSIF NOT done THEN
        RETURN NEW;
    END IF;

    -- Give back what this order took (the sale-line trigger returns it to stock) ...
    DELETE FROM public.inventory_sale_lines WHERE report_id = NEW.id;
    IF NOT done THEN RETURN NEW; END IF;

    -- ... and take what it holds now.
    FOR line IN SELECT value FROM jsonb_array_elements(lines) LOOP
        SELECT * INTO item FROM public.inventory WHERE id = (line ->> 'inventory_id')::uuid FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'المادة «%» لم تعد موجودة في المخزن. احذفها من أمر العمل أو اختر غيرها.', COALESCE(line ->> 'label', '');
        END IF;
        per := public.inventory_stock_per_package(item, line ->> 'unit');
        IF per IS NULL OR per <= 0 THEN
            RAISE EXCEPTION 'التعبئة «%» غير معرفة للمادة «%».', line ->> 'unit', item.name;
        END IF;
        qty := (line ->> 'qty')::numeric;
        price := COALESCE((line ->> 'unit_price')::numeric, public.inventory_package_price(item, line ->> 'unit'), 0);
        INSERT INTO public.inventory_sale_lines (report_id, inventory_id, branch_id, item_code, item_name, package_unit, quantity, stock_quantity, unit_price, total_price)
        VALUES (NEW.id, item.id, NEW.branch_id, item.item_code, item.name, line ->> 'unit', qty, round(qty * per, 6), price, round(qty * price, 2));
    END LOOP;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_order_stock ON public.inspection_reports;
CREATE TRIGGER work_order_stock
    AFTER INSERT OR UPDATE OF status, selected_services, branch_id ON public.inspection_reports
    FOR EACH ROW EXECUTE FUNCTION public.sync_work_order_stock();

-- Fix: direct sale from stock failed every time with «column reference "id" is ambiguous» (the
-- function's output column id clashed with inventory.id). Same function as 20261120, with the
-- column winning name clashes.
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
#variable_conflict use_column
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
