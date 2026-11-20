-- Employee profile data: targets, assigned tasks, and service complaints.
-- Targets/tasks/complaints are tied to system accounts (public.employees), so
-- staff performance can be viewed beside the sales and CRM activity they own.
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS permission_inventory_prices BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS public.employee_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    metric_key TEXT NOT NULL,
    title TEXT NOT NULL,
    target_value NUMERIC NOT NULL DEFAULT 0 CHECK (target_value >= 0),
    unit TEXT NOT NULL DEFAULT 'عملية',
    period_start DATE NOT NULL DEFAULT CURRENT_DATE,
    period_end DATE NOT NULL DEFAULT (CURRENT_DATE + 30),
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
    inventory_id UUID REFERENCES public.inventory(id) ON DELETE SET NULL,
    service_filter TEXT,
    created_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (period_end >= period_start)
);

CREATE TABLE IF NOT EXISTS public.employee_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    details TEXT,
    due_date DATE,
    status TEXT NOT NULL DEFAULT 'معلقة' CHECK (status IN ('معلقة','قيد التنفيذ','مكتملة')),
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
    created_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.service_complaints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID REFERENCES public.inspection_reports(id) ON DELETE SET NULL,
    employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
    summary TEXT NOT NULL,
    details TEXT,
    status TEXT NOT NULL DEFAULT 'مفتوحة' CHECK (status IN ('مفتوحة','قيد المتابعة','تم الحل')),
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS employee_targets_employee_period_idx ON public.employee_targets(employee_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS employee_tasks_employee_status_idx ON public.employee_tasks(employee_id, status, due_date);
CREATE INDEX IF NOT EXISTS service_complaints_employee_status_idx ON public.service_complaints(employee_id, status, received_at DESC);
CREATE INDEX IF NOT EXISTS service_complaints_report_idx ON public.service_complaints(report_id);

ALTER TABLE public.employee_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_complaints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated staff access employee targets" ON public.employee_targets;
DROP POLICY IF EXISTS employee_targets_read ON public.employee_targets;
DROP POLICY IF EXISTS employee_targets_manage ON public.employee_targets;
CREATE POLICY employee_targets_read ON public.employee_targets FOR SELECT TO authenticated USING (
  employee_id IN (SELECT id FROM public.employees WHERE auth_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.employees WHERE auth_id = auth.uid() AND role IN ('Owner','Admin','Supervisor'))
);
CREATE POLICY employee_targets_manage ON public.employee_targets FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM public.employees WHERE auth_id = auth.uid() AND role IN ('Owner','Admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.employees WHERE auth_id = auth.uid() AND role IN ('Owner','Admin'))
);

DROP POLICY IF EXISTS "Authenticated staff access employee tasks" ON public.employee_tasks;
DROP POLICY IF EXISTS employee_tasks_read ON public.employee_tasks;
DROP POLICY IF EXISTS employee_tasks_manage ON public.employee_tasks;
DROP POLICY IF EXISTS employee_tasks_complete_own ON public.employee_tasks;
CREATE POLICY employee_tasks_read ON public.employee_tasks FOR SELECT TO authenticated USING (
  employee_id IN (SELECT id FROM public.employees WHERE auth_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.employees WHERE auth_id = auth.uid() AND role IN ('Owner','Admin','Supervisor'))
);
CREATE POLICY employee_tasks_manage ON public.employee_tasks FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM public.employees WHERE auth_id = auth.uid() AND role IN ('Owner','Admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.employees WHERE auth_id = auth.uid() AND role IN ('Owner','Admin'))
);
CREATE POLICY employee_tasks_complete_own ON public.employee_tasks FOR UPDATE TO authenticated USING (
  employee_id IN (SELECT id FROM public.employees WHERE auth_id = auth.uid())
) WITH CHECK (
  employee_id IN (SELECT id FROM public.employees WHERE auth_id = auth.uid())
);

DROP POLICY IF EXISTS "Authenticated staff access service complaints" ON public.service_complaints;
DROP POLICY IF EXISTS service_complaints_read ON public.service_complaints;
DROP POLICY IF EXISTS service_complaints_manage ON public.service_complaints;
CREATE POLICY service_complaints_read ON public.service_complaints FOR SELECT TO authenticated USING (
  employee_id IN (SELECT id FROM public.employees WHERE auth_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.employees WHERE auth_id = auth.uid() AND role IN ('Owner','Admin','Supervisor'))
);
CREATE POLICY service_complaints_manage ON public.service_complaints FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM public.employees WHERE auth_id = auth.uid() AND role IN ('Owner','Admin','Supervisor'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.employees WHERE auth_id = auth.uid() AND role IN ('Owner','Admin','Supervisor'))
);
