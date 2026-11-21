-- Technician accounts, full work history, and staff who do reception as well as supervision.
-- Depends on 20261120-20261124. Safe to run more than once.
--
-- 1. New role Technician: the account sees only «مهامي» and «حسابي الشخصي». is_staff() is false for
--    it, so every table under the generic staff policy is closed to it. It reads its own employee
--    row, the branch names, its own tasks/targets/complaints, and its own work through
--    employee_work_orders() (no prices, no customer names).
-- 2. employee_work_orders(): an employee's orders as receptionist or technician (technician by
--    account or by the name written on the work card, in the employee's branch), all time or
--    between two Iraq days. Prices only for Owner/Admin or the price permission.
-- 3. branch_monthly_sales(): month-by-month totals of a branch since its first order.
-- 4. The monthly plan counts every employee who works reception: Receptionists, and Supervisors
--    who have the reception page.

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'Technician';
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.auth_id IS NOT NULL AND e.auth_id = auth.uid() AND e.role::text <> 'Technician'
    );
$$;

DROP POLICY IF EXISTS employees_read_self ON public.employees;
CREATE POLICY employees_read_self ON public.employees FOR SELECT TO authenticated USING (auth_id = auth.uid());

DROP POLICY IF EXISTS branches_read_employees ON public.branches;
CREATE POLICY branches_read_employees ON public.branches FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.employees e WHERE e.auth_id = auth.uid())
);

-- Works reception: a Receptionist, or a Supervisor with the reception page (the per-tab list
-- when it is set, otherwise the older reception permission).
CREATE OR REPLACE FUNCTION public.sells_at_reception(p_role TEXT, p_permission BOOLEAN, p_pages JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
    SELECT p_role = 'Receptionist'
        OR (p_role = 'Supervisor' AND CASE WHEN jsonb_typeof(p_pages) = 'array' THEN p_pages ? 'reception' ELSE COALESCE(p_permission, FALSE) END)
$$;

CREATE OR REPLACE FUNCTION public.employee_work_orders(p_employee UUID, p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL)
RETURNS TABLE(
    id UUID, report_number INTEGER, status TEXT, order_type TEXT, branch_name TEXT,
    created_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, as_receptionist BOOLEAN, as_technician BOOLEAN,
    service_keys TEXT[], custom_services TEXT[], products JSONB, rating NUMERIC, total_price NUMERIC,
    client_id UUID, client_name TEXT, make TEXT, model TEXT, plate_number TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    emp RECORD; caller RECORD; prices BOOLEAN; show_client BOOLEAN; t_from TIMESTAMPTZ; t_to TIMESTAMPTZ;
BEGIN
    SELECT e.id, e.name, e.branch_id INTO emp FROM public.employees e WHERE e.id = p_employee;
    SELECT e.id, e.role::text AS role, COALESCE(e.permission_inventory_prices, FALSE) AS pp INTO caller
    FROM public.employees e WHERE e.auth_id = auth.uid() LIMIT 1;
    IF emp.id IS NULL OR caller.id IS NULL OR NOT (caller.id = emp.id OR public.staff_manages_branch(emp.branch_id, TRUE)) THEN
        RAISE EXCEPTION 'غير مصرح.';
    END IF;
    prices := caller.role IN ('Owner','Admin') OR caller.pp;
    show_client := caller.role <> 'Technician';
    t_from := CASE WHEN p_from IS NULL THEN '-infinity'::timestamptz ELSE (p_from::timestamp AT TIME ZONE 'Asia/Baghdad') END;
    t_to := CASE WHEN p_to IS NULL THEN 'infinity'::timestamptz ELSE ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Baghdad') END;

    RETURN QUERY
    WITH base AS (
        SELECT r.id AS rid, r.report_number AS rnum, r.status::text AS rstatus, r.order_type::text AS rtype, r.branch_id AS rbranch,
               r.created_at::timestamptz AS rcreated, r.completed_at::timestamptz AS rcompleted, r.receptionist_id AS rrec,
               r.technician_id AS rtech, r.technician_rating::text AS rrating, r.total_price::numeric AS rtotal, r.vehicle_id AS rvehicle,
               (CASE WHEN jsonb_typeof(r.selected_services::jsonb) = 'array' THEN r.selected_services::jsonb -> 0 ELSE r.selected_services::jsonb END) AS p
        FROM public.inspection_reports r
        WHERE r.created_at >= t_from AND r.created_at < t_to
          AND (r.receptionist_id = emp.id OR r.technician_id = emp.id OR emp.branch_id IS NULL OR r.branch_id = emp.branch_id)
    ), tagged AS (
        SELECT b.*,
            COALESCE(b.rrec = emp.id, FALSE) AS is_rec,
            (COALESCE(b.rtech = emp.id, FALSE) OR (COALESCE(b.rtype, '') <> 'sale' AND trim(emp.name) <> '' AND (
                trim(COALESCE(b.p ->> 'technicianName', '')) = trim(emp.name)
                OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(b.p -> 'technicians') = 'array' THEN b.p -> 'technicians' ELSE '[]'::jsonb END) tx
                           WHERE trim(COALESCE(tx ->> 'name', '')) = trim(emp.name))
            ))) AS is_tech
        FROM base b
    )
    SELECT t.rid, t.rnum::integer, t.rstatus, t.rtype, br.name::text, t.rcreated, t.rcompleted, t.is_rec, t.is_tech,
        ARRAY(
            SELECT sx.key FROM jsonb_each(CASE WHEN jsonb_typeof(t.p -> 'services') = 'object' THEN t.p -> 'services' ELSE '{}'::jsonb END) sx
            WHERE sx.value ->> 'status' = 'يحتاج تغيير'
            UNION ALL
            SELECT fx.key FROM jsonb_each_text(CASE WHEN jsonb_typeof(t.p -> 'freeServices') = 'object' THEN t.p -> 'freeServices' ELSE '{}'::jsonb END) fx
            WHERE fx.value = 'true'),
        ARRAY(
            SELECT COALESCE(cx ->> 'label', cx ->> 'name')
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.p -> 'customServices') = 'array' THEN t.p -> 'customServices' ELSE '[]'::jsonb END) cx
            WHERE COALESCE(cx ->> 'label', cx ->> 'name', '') <> ''),
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('inventory_id', px ->> 'inventory_id', 'qty', px -> 'qty')), '[]'::jsonb)
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.p -> 'products') = 'array' THEN t.p -> 'products' ELSE '[]'::jsonb END) px),
        COALESCE(
            (SELECT (tx ->> 'rating')::numeric FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.p -> 'technicians') = 'array' THEN t.p -> 'technicians' ELSE '[]'::jsonb END) tx
             WHERE trim(COALESCE(tx ->> 'name', '')) = trim(emp.name) AND COALESCE(tx ->> 'rating', '') ~ '^[0-9]+(\.[0-9]+)?$' LIMIT 1),
            CASE WHEN COALESCE(t.rrating, '') ~ '^[0-9]+(\.[0-9]+)?$' THEN t.rrating::numeric END),
        CASE WHEN prices THEN t.rtotal END,
        CASE WHEN show_client THEN v.client_id END,
        CASE WHEN show_client THEN cl.name::text END,
        v.make::text, v.model::text, v.plate_number::text
    FROM tagged t
    LEFT JOIN public.branches br ON br.id = t.rbranch
    LEFT JOIN public.vehicles v ON v.id = t.rvehicle
    LEFT JOIN public.clients cl ON cl.id = v.client_id
    WHERE t.is_rec OR t.is_tech
    ORDER BY t.rcreated DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.employee_work_orders(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_work_orders(UUID, DATE, DATE) TO authenticated;

CREATE OR REPLACE FUNCTION public.branch_monthly_sales(p_branch UUID)
RETURNS TABLE(month DATE, orders BIGINT, sales BIGINT, amount NUMERIC, oil_changes BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE caller RECORD; prices BOOLEAN;
BEGIN
    IF NOT public.staff_manages_branch(p_branch, TRUE) THEN RAISE EXCEPTION 'غير مصرح.'; END IF;
    SELECT e.role::text AS role, COALESCE(e.permission_inventory_prices, FALSE) AS pp INTO caller FROM public.employees e WHERE e.auth_id = auth.uid() LIMIT 1;
    prices := caller.role IN ('Owner','Admin') OR caller.pp;
    RETURN QUERY
    SELECT date_trunc('month', r.created_at AT TIME ZONE 'Asia/Baghdad')::date,
        COUNT(*) FILTER (WHERE COALESCE(r.order_type::text, '') <> 'sale'),
        COUNT(*) FILTER (WHERE r.order_type::text = 'sale'),
        CASE WHEN prices THEN COALESCE(SUM(r.total_price::numeric), 0) END,
        COUNT(*) FILTER (WHERE (CASE WHEN jsonb_typeof(r.selected_services::jsonb) = 'array' THEN r.selected_services::jsonb -> 0 ELSE r.selected_services::jsonb END)
                               -> 'services' -> 'engineOil' ->> 'status' = 'يحتاج تغيير')
    FROM public.inspection_reports r
    WHERE r.branch_id = p_branch
    GROUP BY 1
    ORDER BY 1 DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.branch_monthly_sales(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.branch_monthly_sales(UUID) TO authenticated;

-- 4. Monthly plan: count every employee who works reception (re-created from 20261124).
CREATE OR REPLACE FUNCTION public.sales_plan_progress(p_plan UUID)
RETURNS TABLE(item_id UUID, employee_id UUID, sold NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    plan public.sales_plans%ROWTYPE;
    month_end DATE;
BEGIN
    SELECT * INTO plan FROM public.sales_plans WHERE id = p_plan;
    IF NOT FOUND OR NOT public.staff_manages_branch(plan.branch_id, TRUE) THEN
        RAISE EXCEPTION 'غير مصرح بعرض هذه الخطة.';
    END IF;
    month_end := (plan.month + INTERVAL '1 month' - INTERVAL '1 day')::date;
    RETURN QUERY
    WITH people AS (
        SELECT e.id FROM public.employees e WHERE e.branch_id = plan.branch_id AND public.sells_at_reception(e.role::text, e.permission_reception, e.allowed_pages)
        UNION ALL SELECT NULL::uuid
    ), targets AS (
        SELECT i.id, i.kind, i.service_key, i.inventory_id FROM public.sales_plan_items i WHERE i.plan_id = plan.id
        UNION ALL SELECT NULL::uuid, 'amount', NULL, NULL::uuid WHERE plan.target_amount IS NOT NULL
    )
    SELECT t.id, p.id, public.sales_sold(plan.branch_id, p.id, t.kind, t.service_key, t.inventory_id, plan.month, month_end)
    FROM targets t CROSS JOIN people p;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_my_sales_tasks()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    me RECORD;
    today DATE := (NOW() AT TIME ZONE 'Asia/Baghdad')::date;
    month_start DATE := date_trunc('month', (NOW() AT TIME ZONE 'Asia/Baghdad'))::date;
    month_end DATE;
    days_left INTEGER;
    plan public.sales_plans%ROWTYPE;
    item RECORD;
    sharers INTEGER;
    my_target NUMERIC; sold_before NUMERIC; sold_today NUMERIC; need NUMERIC;
    stagnant TEXT; stagnant_ids UUID[]; stagnant_sold NUMERIC;
    written INTEGER := 0;
BEGIN
    SELECT e.id, e.role::text AS role, e.branch_id, e.permission_reception, e.allowed_pages INTO me FROM public.employees e WHERE e.auth_id = auth.uid() LIMIT 1;
    IF me.id IS NULL OR me.branch_id IS NULL OR NOT public.sells_at_reception(me.role, me.permission_reception, me.allowed_pages) THEN
        RETURN 0;
    END IF;
    PERFORM set_config('app.sales_tasks', 'on', TRUE);

    -- Retire unfinished automatic tasks of past days.
    UPDATE public.employee_tasks SET deleted_at = NOW()
    WHERE employee_id = me.id AND source = 'auto' AND deleted_at IS NULL AND status <> 'مكتملة' AND due_date < today;

    SELECT * INTO plan FROM public.sales_plans WHERE branch_id = me.branch_id AND month = month_start;
    IF FOUND THEN
        month_end := (month_start + INTERVAL '1 month' - INTERVAL '1 day')::date;
        days_left := month_end - today + 1;
        SELECT GREATEST(COUNT(*), 1) INTO sharers FROM public.employees WHERE branch_id = me.branch_id AND public.sells_at_reception(role::text, permission_reception, allowed_pages);

        FOR item IN
            SELECT i.id::text AS key, i.kind, i.service_key, i.inventory_id, i.label, i.unit, i.target_qty AS target FROM public.sales_plan_items i WHERE i.plan_id = plan.id
            UNION ALL
            SELECT 'amount', 'amount', NULL, NULL, 'مبيعات', 'د.ع', plan.target_amount WHERE plan.target_amount IS NOT NULL AND plan.target_amount > 0
        LOOP
            my_target := item.target / sharers;
            sold_before := CASE WHEN today > month_start THEN public.sales_sold(me.branch_id, me.id, item.kind, item.service_key, item.inventory_id, month_start, today - 1) ELSE 0 END;
            sold_today := public.sales_sold(me.branch_id, me.id, item.kind, item.service_key, item.inventory_id, today, today);
            need := CEIL(GREATEST(my_target - sold_before, 0) / days_left);
            IF item.kind = 'amount' THEN need := CEIL(need / 1000) * 1000; END IF;
            IF need <= 0 THEN CONTINUE; END IF;
            INSERT INTO public.employee_tasks AS t (employee_id, branch_id, title, details, due_date, source, auto_key, auto_target, auto_done, auto_unit, status, completed_at)
            VALUES (me.id, me.branch_id,
                    CASE WHEN item.kind = 'amount' THEN 'مبيعات اليوم ' || to_char(need, 'FM999,999,999,990') || ' د.ع'
                         ELSE 'اليوم: ' || trim_scale(need)::text || ' ' || item.unit || ' — ' || item.label END,
                    'خطة الشهر: حصتك ' || to_char(CEIL(my_target), 'FM999,999,999,990') || ' • المنجز قبل اليوم ' || trim_scale(ROUND(sold_before, 3))::text
                        || ' • الأيام الباقية ' || days_left,
                    today, 'auto', 'plan:' || item.key || ':' || today, need, sold_today, item.unit,
                    CASE WHEN sold_today >= need THEN 'مكتملة' ELSE 'معلقة' END,
                    CASE WHEN sold_today >= need THEN NOW() END)
            ON CONFLICT (employee_id, auto_key) WHERE auto_key IS NOT NULL DO UPDATE
                SET auto_done = EXCLUDED.auto_done,
                    status = CASE WHEN EXCLUDED.auto_done >= t.auto_target THEN 'مكتملة' ELSE t.status END,
                    completed_at = CASE WHEN EXCLUDED.auto_done >= t.auto_target THEN COALESCE(t.completed_at, NOW()) ELSE t.completed_at END;
            written := written + 1;
        END LOOP;
    END IF;

    -- Stagnant stock: up to 3 items of the branch with stock and no sale in the last 30 days.
    SELECT string_agg(name, '، '), array_agg(id) INTO stagnant, stagnant_ids FROM (
        SELECT inv.id, inv.name FROM public.inventory inv
        WHERE inv.branch_id = me.branch_id AND COALESCE(inv.quantity, 0) > 0
          AND NOT EXISTS (SELECT 1 FROM public.inventory_sale_lines l WHERE l.inventory_id = inv.id AND l.created_at >= NOW() - INTERVAL '30 days')
        ORDER BY inv.quantity DESC LIMIT 3
    ) s;
    IF stagnant IS NOT NULL THEN
        SELECT COALESCE(SUM(l.stock_quantity), 0) INTO stagnant_sold
        FROM public.inventory_sale_lines l JOIN public.inspection_reports r ON r.id = l.report_id
        WHERE l.inventory_id = ANY(stagnant_ids) AND r.receptionist_id = me.id
          AND r.created_at >= (today::timestamp AT TIME ZONE 'Asia/Baghdad');
        INSERT INTO public.employee_tasks AS t (employee_id, branch_id, title, details, due_date, source, auto_key, auto_target, auto_done, auto_unit, status, completed_at)
        VALUES (me.id, me.branch_id, 'روّج للمواد الراكدة', 'لم تُبع منذ 30 يوماً: ' || stagnant, today, 'auto', 'stagnant:' || today, 1, stagnant_sold, 'قطعة',
                CASE WHEN stagnant_sold >= 1 THEN 'مكتملة' ELSE 'معلقة' END, CASE WHEN stagnant_sold >= 1 THEN NOW() END)
        ON CONFLICT (employee_id, auto_key) WHERE auto_key IS NOT NULL DO UPDATE
            SET auto_done = EXCLUDED.auto_done,
                status = CASE WHEN EXCLUDED.auto_done >= 1 THEN 'مكتملة' ELSE t.status END,
                completed_at = CASE WHEN EXCLUDED.auto_done >= 1 THEN COALESCE(t.completed_at, NOW()) ELSE t.completed_at END;
        written := written + 1;
    END IF;
    RETURN written;
END;
$$;
