-- Branch manager role, and the shift supervisor's orders in the employee history.
-- Depends on 20261120-20261126. Safe to run more than once.
--
-- 1. New role BranchManager (مدير فرع): runs one branch like an admin — targets, tasks, complaints
--    and the monthly plan of their own branch only. Account management for their branch is done
--    in the server actions (src/app/actions/admin.ts). The branch manager runs the plan and does
--    not share it. The new value is only compared as text below, so this file works in a single
--    transaction.
-- 2. Managing a target, task or complaint now also requires that the employee really belongs to
--    the row's branch, and nobody but Owner/Admin manages records about themselves.
-- 3. employee_work_orders() also returns the orders where the employee is the shift supervisor
--    written on the work card (as_supervisor) and whether the order ran late (is_delayed).

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'BranchManager';
    END IF;
END $$;

-- Owner/Admin anywhere; a BranchManager on their own branch; a Supervisor on their own branch
-- (or every branch when they have none) when p_include_supervisor.
CREATE OR REPLACE FUNCTION public.staff_manages_branch(p_branch UUID, p_include_supervisor BOOLEAN)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.auth_id = auth.uid()
          AND (e.role::text IN ('Owner','Admin')
               OR (e.role::text = 'BranchManager' AND e.branch_id IS NOT NULL AND e.branch_id = p_branch)
               OR (p_include_supervisor AND e.role::text = 'Supervisor'
                   AND (e.branch_id IS NULL OR p_branch IS NULL OR e.branch_id = p_branch)))
    )
$$;
REVOKE ALL ON FUNCTION public.staff_manages_branch(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_manages_branch(UUID, BOOLEAN) TO authenticated;

-- May the caller add/edit/delete a target, task or complaint about p_employee on a row of p_branch?
CREATE OR REPLACE FUNCTION public.staff_manages_record(p_branch UUID, p_employee UUID, p_include_supervisor BOOLEAN)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM public.employees me WHERE me.auth_id = auth.uid() AND me.role::text IN ('Owner','Admin'))
        OR (public.staff_manages_branch(p_branch, p_include_supervisor)
            AND p_employee IS NOT NULL
            AND p_employee IS DISTINCT FROM (SELECT me.id FROM public.employees me WHERE me.auth_id = auth.uid() LIMIT 1)
            AND EXISTS (SELECT 1 FROM public.employees x WHERE x.id = p_employee AND x.branch_id IS NOT DISTINCT FROM p_branch))
$$;
REVOKE ALL ON FUNCTION public.staff_manages_record(UUID, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_manages_record(UUID, UUID, BOOLEAN) TO authenticated;

DROP POLICY IF EXISTS employee_targets_manage ON public.employee_targets;
CREATE POLICY employee_targets_manage ON public.employee_targets FOR ALL TO authenticated
    USING (public.staff_manages_record(branch_id, employee_id, FALSE))
    WITH CHECK (public.staff_manages_record(branch_id, employee_id, FALSE));

DROP POLICY IF EXISTS employee_tasks_manage ON public.employee_tasks;
CREATE POLICY employee_tasks_manage ON public.employee_tasks FOR ALL TO authenticated
    USING (public.staff_manages_record(branch_id, employee_id, FALSE))
    WITH CHECK (public.staff_manages_record(branch_id, employee_id, FALSE));

DROP POLICY IF EXISTS service_complaints_manage ON public.service_complaints;
CREATE POLICY service_complaints_manage ON public.service_complaints FOR ALL TO authenticated
    USING (public.staff_manages_record(branch_id, employee_id, TRUE))
    WITH CHECK (public.staff_manages_record(branch_id, employee_id, TRUE));

-- The employee's own task: only the status changes, unless a manager of the task (not the
-- employee themselves) or the system's automatic tasks is writing.
CREATE OR REPLACE FUNCTION public.employee_task_own_update_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF public.staff_manages_record(OLD.branch_id, OLD.employee_id, FALSE) OR current_setting('app.sales_tasks', TRUE) = 'on' THEN
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

DROP FUNCTION IF EXISTS public.employee_work_orders(UUID, DATE, DATE);
CREATE FUNCTION public.employee_work_orders(p_employee UUID, p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL)
RETURNS TABLE(
    id UUID, report_number INTEGER, status TEXT, order_type TEXT, branch_name TEXT,
    created_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, as_receptionist BOOLEAN, as_technician BOOLEAN,
    as_supervisor BOOLEAN, is_delayed BOOLEAN,
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
               (COALESCE(r.is_delayed, FALSE) OR r.status::text = 'متأخر') AS rlate,
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
            ))) AS is_tech,
            (COALESCE(b.rtype, '') <> 'sale' AND trim(emp.name) <> '' AND trim(COALESCE(b.p ->> 'shiftSupervisor', '')) = trim(emp.name)) AS is_sup
        FROM base b
    )
    SELECT t.rid, t.rnum::integer, t.rstatus, t.rtype, br.name::text, t.rcreated, t.rcompleted, t.is_rec, t.is_tech, t.is_sup, t.rlate,
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
    WHERE t.is_rec OR t.is_tech OR t.is_sup
    ORDER BY t.rcreated DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.employee_work_orders(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_work_orders(UUID, DATE, DATE) TO authenticated;
