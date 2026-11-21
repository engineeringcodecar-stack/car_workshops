-- Staff profile records (targets, tasks, complaints): deleting keeps the row, branch
-- supervisors only reach their own branch, and an employee can only tick off their own task.
-- Depends on 20261121_staff_profiles_and_sales_analytics.sql. Safe to run more than once.

-- 1. Soft delete. "حذف" in the profile page sets these instead of removing the row, so a
--    complaint or a target that was removed by mistake can still be traced and restored.
ALTER TABLE public.employee_targets   ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.employee_targets   ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.employees(id) ON DELETE SET NULL;
ALTER TABLE public.employee_tasks     ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.employee_tasks     ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.employees(id) ON DELETE SET NULL;
ALTER TABLE public.service_complaints ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.service_complaints ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.employees(id) ON DELETE SET NULL;

-- 2. Who is calling. SECURITY DEFINER so the policies below do not depend on the caller's
--    own access to public.employees.
CREATE OR REPLACE FUNCTION public.staff_role_and_branch(OUT role TEXT, OUT branch_id UUID, OUT employee_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT e.role::text, e.branch_id, e.id FROM public.employees e WHERE e.auth_id = auth.uid() LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.staff_role_and_branch() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_role_and_branch() TO authenticated;

-- True for Owner/Admin anywhere, and for a Supervisor on a row of their own branch
-- (a Supervisor with no branch on record covers every branch, like Owner/Admin).
CREATE OR REPLACE FUNCTION public.staff_manages_branch(p_branch UUID, p_include_supervisor BOOLEAN)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.auth_id = auth.uid()
          AND (e.role IN ('Owner','Admin')
               OR (p_include_supervisor AND e.role = 'Supervisor'
                   AND (e.branch_id IS NULL OR p_branch IS NULL OR e.branch_id = p_branch)))
    )
$$;
REVOKE ALL ON FUNCTION public.staff_manages_branch(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_manages_branch(UUID, BOOLEAN) TO authenticated;

-- 3. Policies. Reading: your own rows, or rows of a branch you supervise. Managing targets
--    and tasks stays Owner/Admin; complaints also the branch's Supervisor.
DROP POLICY IF EXISTS employee_targets_read ON public.employee_targets;
CREATE POLICY employee_targets_read ON public.employee_targets FOR SELECT TO authenticated USING (
    employee_id = (SELECT employee_id FROM public.staff_role_and_branch())
    OR public.staff_manages_branch(branch_id, TRUE)
);

DROP POLICY IF EXISTS employee_tasks_read ON public.employee_tasks;
CREATE POLICY employee_tasks_read ON public.employee_tasks FOR SELECT TO authenticated USING (
    employee_id = (SELECT employee_id FROM public.staff_role_and_branch())
    OR public.staff_manages_branch(branch_id, TRUE)
);

DROP POLICY IF EXISTS service_complaints_read ON public.service_complaints;
CREATE POLICY service_complaints_read ON public.service_complaints FOR SELECT TO authenticated USING (
    employee_id = (SELECT employee_id FROM public.staff_role_and_branch())
    OR public.staff_manages_branch(branch_id, TRUE)
);
DROP POLICY IF EXISTS service_complaints_manage ON public.service_complaints;
CREATE POLICY service_complaints_manage ON public.service_complaints FOR ALL TO authenticated
    USING (public.staff_manages_branch(branch_id, TRUE))
    WITH CHECK (public.staff_manages_branch(branch_id, TRUE));

-- 4. An employee may mark their own task done, nothing more. The old policy let them change
--    any column of it (title, due date, or "delete" it once soft delete exists).
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
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS employee_task_own_update_guard ON public.employee_tasks;
CREATE TRIGGER employee_task_own_update_guard BEFORE UPDATE ON public.employee_tasks
    FOR EACH ROW EXECUTE FUNCTION public.employee_task_own_update_guard();
