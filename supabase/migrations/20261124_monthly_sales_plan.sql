-- Monthly sales plan per branch, and daily tasks the system writes for each receptionist from it.
-- Depends on 20261120 (inventory_sale_lines), 20261121-20261123 (employee_tasks + guard).
-- Safe to run more than once.
--
-- How it works
--   * Owner/Admin set a plan per branch per month: an amount in dinars and/or items, each either a
--     work-order service (e.g. engineOil = cars that got an oil change) or a stock item (quantity in
--     its base unit, from inventory_sale_lines).
--   * Each receptionist of the branch carries an equal share of every target.
--   * refresh_my_sales_tasks() (called by the app when the employee opens the system) writes today's
--     tasks for the calling receptionist: what is left of their share divided by the days left in the
--     month, plus one task to push stagnant stock. It updates progress and closes a task by itself when
--     today's number is reached; unfinished automatic tasks of past days are retired.
--   Sales are counted by the order's receptionist_id, by Iraq calendar day.

-- 1. Plans --------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    month DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
    target_amount NUMERIC(18,2) CHECK (target_amount IS NULL OR target_amount >= 0),
    notes TEXT,
    created_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (branch_id, month)
);

CREATE TABLE IF NOT EXISTS public.sales_plan_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES public.sales_plans(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('service','product')),
    service_key TEXT,
    inventory_id UUID REFERENCES public.inventory(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'سيارة',
    target_qty NUMERIC(18,3) NOT NULL CHECK (target_qty > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((kind = 'service' AND service_key IS NOT NULL) OR (kind = 'product' AND inventory_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS sales_plan_items_plan_idx ON public.sales_plan_items(plan_id);

ALTER TABLE public.sales_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_plan_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_plans_read ON public.sales_plans;
CREATE POLICY sales_plans_read ON public.sales_plans FOR SELECT TO authenticated USING (
    branch_id = (SELECT branch_id FROM public.staff_role_and_branch())
    OR public.staff_manages_branch(branch_id, TRUE)
);
DROP POLICY IF EXISTS sales_plans_manage ON public.sales_plans;
CREATE POLICY sales_plans_manage ON public.sales_plans FOR ALL TO authenticated
    USING (public.staff_manages_branch(branch_id, FALSE))
    WITH CHECK (public.staff_manages_branch(branch_id, FALSE));

DROP POLICY IF EXISTS sales_plan_items_read ON public.sales_plan_items;
CREATE POLICY sales_plan_items_read ON public.sales_plan_items FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.sales_plans p WHERE p.id = plan_id)
);
DROP POLICY IF EXISTS sales_plan_items_manage ON public.sales_plan_items;
CREATE POLICY sales_plan_items_manage ON public.sales_plan_items FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.sales_plans p WHERE p.id = plan_id AND public.staff_manages_branch(p.branch_id, FALSE)))
    WITH CHECK (EXISTS (SELECT 1 FROM public.sales_plans p WHERE p.id = plan_id AND public.staff_manages_branch(p.branch_id, FALSE)));

-- 2. Automatic tasks ----------------------------------------------------------------------------
ALTER TABLE public.employee_tasks ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE public.employee_tasks ADD COLUMN IF NOT EXISTS auto_key TEXT;
ALTER TABLE public.employee_tasks ADD COLUMN IF NOT EXISTS auto_target NUMERIC(18,3);
ALTER TABLE public.employee_tasks ADD COLUMN IF NOT EXISTS auto_done NUMERIC(18,3);
ALTER TABLE public.employee_tasks ADD COLUMN IF NOT EXISTS auto_unit TEXT;
DO $$ BEGIN
    ALTER TABLE public.employee_tasks ADD CONSTRAINT employee_tasks_source_chk CHECK (source IN ('manual','auto'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS employee_tasks_auto_key_uidx ON public.employee_tasks(employee_id, auto_key) WHERE auto_key IS NOT NULL;

-- The own-task guard: the employee may only change the status; the generator (which sets
-- app.sales_tasks for its own transaction) may change everything.
CREATE OR REPLACE FUNCTION public.employee_task_own_update_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF public.staff_manages_branch(OLD.branch_id, FALSE) OR current_setting('app.sales_tasks', TRUE) = 'on' THEN
        RETURN NEW;
    END IF;
    IF NEW.employee_id IS DISTINCT FROM OLD.employee_id
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.details IS DISTINCT FROM OLD.details
       OR NEW.due_date IS DISTINCT FROM OLD.due_date
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
       OR NEW.deleted_by IS DISTINCT FROM OLD.deleted_by
       OR NEW.source IS DISTINCT FROM OLD.source
       OR NEW.auto_key IS DISTINCT FROM OLD.auto_key
       OR NEW.auto_target IS DISTINCT FROM OLD.auto_target
       OR NEW.auto_done IS DISTINCT FROM OLD.auto_done
       OR NEW.auto_unit IS DISTINCT FROM OLD.auto_unit THEN
        RAISE EXCEPTION 'يمكنك تغيير حالة مهمتك فقط.';
    END IF;
    NEW.completed_at := CASE WHEN NEW.status = 'مكتملة' THEN COALESCE(OLD.completed_at, NOW()) ELSE NULL END;
    RETURN NEW;
END;
$$;

-- 3. Counting sales -----------------------------------------------------------------------------
-- Sold for one plan item (or the amount when p_kind = 'amount') in a branch between two Iraq days,
-- for one receptionist or the whole branch (p_employee NULL).
CREATE OR REPLACE FUNCTION public.sales_sold(p_branch UUID, p_employee UUID, p_kind TEXT, p_service_key TEXT, p_inventory UUID, p_from DATE, p_to DATE)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    result NUMERIC := 0;
    t_from TIMESTAMPTZ := (p_from::timestamp AT TIME ZONE 'Asia/Baghdad');
    t_to   TIMESTAMPTZ := ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Baghdad');
BEGIN
    IF p_kind = 'amount' THEN
        SELECT COALESCE(SUM(r.total_price), 0) INTO result FROM public.inspection_reports r
        WHERE r.branch_id = p_branch AND (p_employee IS NULL OR r.receptionist_id = p_employee)
          AND r.created_at >= t_from AND r.created_at < t_to;
    ELSIF p_kind = 'service' THEN
        SELECT COUNT(*) INTO result FROM public.inspection_reports r
        WHERE r.branch_id = p_branch AND (p_employee IS NULL OR r.receptionist_id = p_employee)
          AND r.created_at >= t_from AND r.created_at < t_to
          AND COALESCE(r.order_type, '') <> 'sale'
          AND (
              (CASE WHEN jsonb_typeof(r.selected_services::jsonb) = 'array' THEN r.selected_services::jsonb -> 0 ELSE r.selected_services::jsonb END)
                  -> 'services' -> p_service_key ->> 'status' = 'يحتاج تغيير'
              OR COALESCE(((CASE WHEN jsonb_typeof(r.selected_services::jsonb) = 'array' THEN r.selected_services::jsonb -> 0 ELSE r.selected_services::jsonb END)
                  -> 'freeServices' ->> p_service_key)::boolean, FALSE)
          );
    ELSE
        SELECT COALESCE(SUM(l.stock_quantity), 0) INTO result
        FROM public.inventory_sale_lines l JOIN public.inspection_reports r ON r.id = l.report_id
        WHERE l.inventory_id = p_inventory AND r.branch_id = p_branch
          AND (p_employee IS NULL OR r.receptionist_id = p_employee)
          AND r.created_at >= t_from AND r.created_at < t_to;
    END IF;
    RETURN COALESCE(result, 0);
END;
$$;
REVOKE ALL ON FUNCTION public.sales_sold(UUID, UUID, TEXT, TEXT, UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;

-- Progress of a plan for the sales plan page (Owner/Admin and the branch Supervisor only):
-- one row per item (item_id NULL = the amount) per receptionist, plus employee_id NULL for the branch.
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
        SELECT e.id FROM public.employees e WHERE e.branch_id = plan.branch_id AND e.role = 'Receptionist'
        UNION ALL SELECT NULL::uuid
    ), targets AS (
        SELECT i.id, i.kind, i.service_key, i.inventory_id FROM public.sales_plan_items i WHERE i.plan_id = plan.id
        UNION ALL SELECT NULL::uuid, 'amount', NULL, NULL::uuid WHERE plan.target_amount IS NOT NULL
    )
    SELECT t.id, p.id, public.sales_sold(plan.branch_id, p.id, t.kind, t.service_key, t.inventory_id, plan.month, month_end)
    FROM targets t CROSS JOIN people p;
END;
$$;
REVOKE ALL ON FUNCTION public.sales_plan_progress(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_plan_progress(UUID) TO authenticated;

-- 4. The generator ------------------------------------------------------------------------------
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
    SELECT e.id, e.role, e.branch_id INTO me FROM public.employees e WHERE e.auth_id = auth.uid() LIMIT 1;
    IF me.id IS NULL OR me.role <> 'Receptionist' OR me.branch_id IS NULL THEN
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
        SELECT GREATEST(COUNT(*), 1) INTO sharers FROM public.employees WHERE branch_id = me.branch_id AND role = 'Receptionist';

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
REVOKE ALL ON FUNCTION public.refresh_my_sales_tasks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_my_sales_tasks() TO authenticated;
