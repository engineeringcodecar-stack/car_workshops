-- Follow-up to 20261122_staff_records_branch_scope_and_soft_delete.sql. Safe to run more than once.
--   1. Deleted targets/tasks/complaints are hidden from employees through the API too, not only
--      in the page; Owner/Admin (and a branch Supervisor for complaints) still see them to restore.
--   2. A Supervisor can no longer edit, close or delete a complaint filed against themselves.
--   3. When an employee ticks off their own task, completed_at is set by the database, so it
--      cannot be back- or forward-dated from the browser.

DROP POLICY IF EXISTS employee_targets_read ON public.employee_targets;
CREATE POLICY employee_targets_read ON public.employee_targets FOR SELECT TO authenticated USING (
    (deleted_at IS NULL AND employee_id = (SELECT employee_id FROM public.staff_role_and_branch()))
    OR public.staff_manages_branch(branch_id, TRUE)
);

DROP POLICY IF EXISTS employee_tasks_read ON public.employee_tasks;
CREATE POLICY employee_tasks_read ON public.employee_tasks FOR SELECT TO authenticated USING (
    (deleted_at IS NULL AND employee_id = (SELECT employee_id FROM public.staff_role_and_branch()))
    OR public.staff_manages_branch(branch_id, TRUE)
);

DROP POLICY IF EXISTS service_complaints_read ON public.service_complaints;
CREATE POLICY service_complaints_read ON public.service_complaints FOR SELECT TO authenticated USING (
    (deleted_at IS NULL AND employee_id = (SELECT employee_id FROM public.staff_role_and_branch()))
    OR public.staff_manages_branch(branch_id, TRUE)
);

DROP POLICY IF EXISTS service_complaints_manage ON public.service_complaints;
CREATE POLICY service_complaints_manage ON public.service_complaints FOR ALL TO authenticated
    USING (
        public.staff_manages_branch(branch_id, FALSE)
        OR (public.staff_manages_branch(branch_id, TRUE)
            AND employee_id IS DISTINCT FROM (SELECT employee_id FROM public.staff_role_and_branch()))
    )
    WITH CHECK (
        public.staff_manages_branch(branch_id, FALSE)
        OR (public.staff_manages_branch(branch_id, TRUE)
            AND employee_id IS DISTINCT FROM (SELECT employee_id FROM public.staff_role_and_branch()))
    );

CREATE OR REPLACE FUNCTION public.employee_task_own_update_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF public.staff_manages_branch(OLD.branch_id, FALSE) THEN
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
       OR NEW.deleted_by IS DISTINCT FROM OLD.deleted_by THEN
        RAISE EXCEPTION 'يمكنك تغيير حالة مهمتك فقط.';
    END IF;
    NEW.completed_at := CASE WHEN NEW.status = 'مكتملة' THEN COALESCE(OLD.completed_at, NOW()) ELSE NULL END;
    RETURN NEW;
END;
$$;
