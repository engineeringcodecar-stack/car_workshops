-- Archive an employee instead of deleting them when they have history.
-- Depends on 20261120-20261127. Safe to run more than once.
--
-- Work orders, tasks and targets point at the employee, so a hard delete either fails (work
-- orders) or wipes their history (tasks/targets). «حذف» in Settings now closes the login and
-- archives the employee: the row stays with archived_at set and no login, so old orders keep the
-- name, while lists, dropdowns and the monthly plan shares leave the archived employee out.

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS employees_active_branch_idx ON public.employees(branch_id) WHERE archived_at IS NULL;

-- Plan shares count active employees only (re-created from 20261125 with archived_at IS NULL).
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
        SELECT e.id FROM public.employees e WHERE e.branch_id = plan.branch_id AND e.archived_at IS NULL AND public.sells_at_reception(e.role::text, e.permission_reception, e.allowed_pages)
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
        SELECT GREATEST(COUNT(*), 1) INTO sharers FROM public.employees WHERE branch_id = me.branch_id AND archived_at IS NULL AND public.sells_at_reception(role::text, permission_reception, allowed_pages);

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
