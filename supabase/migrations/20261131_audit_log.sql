-- الرقابة الإدارية: who deleted or changed what, and when.
-- Depends on 20261120-20261130. Safe to run more than once.
--
-- Every delete in the system is written to public.audit_log with the account that did it and a
-- copy of what was deleted. So are the edits that matter for money, stock and accounts:
--   work orders  → cancel / bring back / reopen a finished order, price change on a finished
--                  order, discount, editing or un-closing an accounted invoice, excluding it
--                  from the daily closing
--   stock        → quantity, prices, name (changes made by the system itself, like a sale
--                  deducting stock, are not edits by a person and are not logged)
--   accounts     → new account, role, branch, permissions, archive
--   and a few more (customer name/phone, contract payment amount, branch name, sales target).
-- Removing a customer also removes their cars and orders; those are logged too, marked as part
-- of that delete.
--
-- Nobody can write, edit or delete the log from the app: it is written only by these triggers.
-- It is read through audit_log_list() / audit_log_actors(): Owner/Admin see everything, a branch
-- manager sees their own branch. Purchase prices are blanked for anyone not allowed to see them.
-- Account changes made from the settings page go through the server with the service key; the
-- server names the signed-in manager in the x-audit-actor header, which is trusted only on
-- service-key requests.

CREATE TABLE IF NOT EXISTS public.audit_log (
    id          BIGSERIAL PRIMARY KEY,
    at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_id    UUID,          -- employees.id (no FK: the entry outlives the account)
    actor_name  TEXT,
    actor_role  TEXT,
    branch_id   UUID,
    table_name  TEXT NOT NULL,
    row_id      TEXT,
    action      TEXT NOT NULL, -- delete | edit | create | cancel | restore | reopen | discount | unclose | exclude
    summary     TEXT,
    changes     JSONB,         -- edit: { field: { old, new } }; delete: the deleted row
    via         TEXT           -- 'cascade' when removed together with another record
);
CREATE INDEX IF NOT EXISTS audit_log_at_idx ON public.audit_log (at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON public.audit_log (actor_id, at DESC);
CREATE INDEX IF NOT EXISTS audit_log_branch_idx ON public.audit_log (branch_id, at DESC);

-- No policies: the table is closed to the API roles; reading is through the functions below.
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.audit_log_id_seq FROM PUBLIC, anon, authenticated;

-- Writes one entry, naming the signed-in employee (or the manager the server names).
CREATE OR REPLACE FUNCTION public.audit_write(p_table TEXT, p_row_id TEXT, p_branch UUID, p_action TEXT,
                                              p_summary TEXT, p_changes JSONB, p_via TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    uid UUID := auth.uid();
    claims JSONB := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
    hdr TEXT;
    e_id UUID; e_name TEXT; e_role TEXT;
BEGIN
    IF uid IS NULL AND (COALESCE(claims ->> 'role', '') = 'service_role' OR current_setting('role', true) = 'service_role') THEN
        hdr := NULLIF(current_setting('request.headers', true), '')::jsonb ->> 'x-audit-actor';
        IF hdr ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN uid := hdr::uuid; END IF;
    END IF;
    IF uid IS NOT NULL THEN
        SELECT e.id, e.name, e.role::text INTO e_id, e_name, e_role FROM public.employees e WHERE e.auth_id = uid LIMIT 1;
    END IF;
    INSERT INTO public.audit_log (actor_id, actor_name, actor_role, branch_id, table_name, row_id, action, summary, changes, via)
    VALUES (e_id, COALESCE(e_name, CASE WHEN uid IS NULL THEN 'النظام' ELSE 'حساب غير معروف' END), e_role,
            p_branch, p_table, p_row_id, p_action, p_summary, p_changes, p_via);
END $$;
REVOKE ALL ON FUNCTION public.audit_write(TEXT, TEXT, UUID, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.audit_money(v TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN v ~ '^-?[0-9]+(\.[0-9]+)?$' THEN to_char(v::numeric, 'FM999,999,999,990') ELSE COALESCE(v, '') END
$$;

-- One readable line for the record (shown in the log next to the action).
CREATE OR REPLACE FUNCTION public.audit_summary(p_table TEXT, r JSONB)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    s TEXT; who TEXT;
    uuid_re CONSTANT TEXT := '^[0-9a-fA-F-]{36}$';
BEGIN
    IF p_table = 'inspection_reports' THEN
        SELECT concat_ws(' — ', NULLIF(c.name, ''), NULLIF(btrim(concat_ws(' ', v.make, v.model, v.plate_number)), ''))
          INTO who FROM public.vehicles v LEFT JOIN public.clients c ON c.id = v.client_id
         WHERE (r ->> 'vehicle_id') ~ uuid_re AND v.id = (r ->> 'vehicle_id')::uuid;
        s := concat_ws(' — ',
            CASE WHEN r ->> 'order_type' = 'sale' THEN 'بيع مباشر' ELSE 'أمر عمل' END || ' #' || COALESCE(r ->> 'report_number', '?'),
            who, r ->> 'status', public.audit_money(r ->> 'total_price') || ' د.ع');
    ELSIF p_table = 'clients' THEN
        s := concat_ws(' — ', r ->> 'name', r ->> 'phone');
    ELSIF p_table = 'vehicles' THEN
        s := btrim(concat_ws(' ', r ->> 'make', r ->> 'model', r ->> 'plate_number'));
    ELSIF p_table = 'inventory' THEN
        s := concat_ws(' — ', r ->> 'name', NULLIF(COALESCE(r ->> 'murabba_id', r ->> 'item_code'), ''));
    ELSIF p_table = 'employees' THEN
        s := concat_ws(' — ', r ->> 'name', r ->> 'username', CASE r ->> 'role' WHEN 'Owner' THEN 'المالك' WHEN 'Admin' THEN 'مدير النظام' WHEN 'BranchManager' THEN 'مدير فرع' WHEN 'Supervisor' THEN 'مشرف شفت' WHEN 'Receptionist' THEN 'استقبال' WHEN 'Technician' THEN 'فني' ELSE r ->> 'role' END);
    ELSIF p_table = 'contract_payments' THEN
        SELECT concat_ws(' — ', 'دفعة ' || public.audit_money(r ->> 'amount') || ' د.ع', ct.name, r ->> 'note')
          INTO s FROM (SELECT 1) one LEFT JOIN public.contracts ct ON (r ->> 'contract_id') ~ uuid_re AND ct.id = (r ->> 'contract_id')::uuid;
    ELSE
        s := COALESCE(r ->> 'name', r ->> 'title', r ->> 'label', r ->> 'description', r ->> 'note', r ->> 'notes', '');
    END IF;
    -- Records about an employee (tasks, targets, complaints, attendance…): add whose.
    IF p_table <> 'employees' AND (r ->> 'employee_id') ~ uuid_re THEN
        SELECT concat_ws(' — ', NULLIF(s, ''), e.name) INTO s FROM public.employees e WHERE e.id = (r ->> 'employee_id')::uuid;
    END IF;
    RETURN left(COALESCE(NULLIF(s, ''), r ->> 'id', ''), 300);
END $$;
REVOKE ALL ON FUNCTION public.audit_summary(TEXT, JSONB) FROM PUBLIC, anon, authenticated;

-- Generic: every delete; on update, a soft delete (deleted_at / archived_at set) or a change in
-- one of the watched columns (TG_ARGV[0], comma separated); on insert (employees), a new account.
CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    o JSONB := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
    n JSONB := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
    watched TEXT[] := CASE WHEN TG_NARGS > 0 AND TG_ARGV[0] <> '' THEN string_to_array(TG_ARGV[0], ',') ELSE '{}'::text[] END;
    diff JSONB := '{}'::jsonb;
    k TEXT; act TEXT; via TEXT; r JSONB; br TEXT; fk RECORD; gone BOOLEAN;
BEGIN
    IF TG_OP = 'DELETE' THEN
        act := 'delete'; diff := o;
        -- Removed because its parent was (a customer's cars and orders): the parent row is gone.
        FOR fk IN SELECT a.attname AS col, c.confrelid::regclass AS ref, ra.attname AS refcol
                  FROM pg_constraint c
                  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
                  JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = c.confkey[1]
                  WHERE c.conrelid = TG_RELID AND c.contype = 'f' AND c.confdeltype = 'c' AND array_length(c.conkey, 1) = 1 LOOP
            CONTINUE WHEN o ->> fk.col IS NULL;
            EXECUTE format('SELECT NOT EXISTS (SELECT 1 FROM %s WHERE %I::text = $1)', fk.ref, fk.refcol) INTO gone USING o ->> fk.col;
            IF gone THEN via := 'cascade'; EXIT; END IF;
        END LOOP;
    ELSE
        -- Changes the system makes from its own triggers (stock deducted by a sale…) are not edits by a person.
        IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
        IF TG_OP = 'INSERT' THEN
            act := 'create';
            FOREACH k IN ARRAY watched LOOP
                IF n ? k AND n -> k <> 'null'::jsonb THEN diff := diff || jsonb_build_object(k, n -> k); END IF;
            END LOOP;
        ELSIF (o ? 'deleted_at' AND o ->> 'deleted_at' IS NULL AND n ->> 'deleted_at' IS NOT NULL)
           OR (o ? 'archived_at' AND o ->> 'archived_at' IS NULL AND n ->> 'archived_at' IS NOT NULL) THEN
            act := 'delete'; diff := o;
        ELSE
            FOREACH k IN ARRAY watched LOOP
                IF (o -> k) IS DISTINCT FROM (n -> k) THEN
                    diff := diff || jsonb_build_object(k, jsonb_build_object('old', o -> k, 'new', n -> k));
                END IF;
            END LOOP;
            IF diff = '{}'::jsonb THEN RETURN NULL; END IF;
            act := 'edit';
        END IF;
    END IF;
    r := COALESCE(n, o);
    br := COALESCE(r ->> 'branch_id', o ->> 'branch_id');
    PERFORM public.audit_write(TG_TABLE_NAME, r ->> 'id',
        CASE WHEN br ~ '^[0-9a-fA-F-]{36}$' THEN br::uuid END,
        act, public.audit_summary(TG_TABLE_NAME, CASE WHEN TG_OP = 'DELETE' THEN o ELSE r END), diff, via);
    RETURN NULL;
END $$;

-- Work orders: the money and status moves that matter (the floor's own updates are not logged).
CREATE OR REPLACE FUNCTION public.audit_work_order_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    op JSONB := COALESCE((CASE WHEN jsonb_typeof(to_jsonb(OLD.selected_services)) = 'array' THEN to_jsonb(OLD.selected_services) -> 0 ELSE to_jsonb(OLD.selected_services) END) -> 'pricing', '{}'::jsonb);
    np JSONB := COALESCE((CASE WHEN jsonb_typeof(to_jsonb(NEW.selected_services)) = 'array' THEN to_jsonb(NEW.selected_services) -> 0 ELSE to_jsonb(NEW.selected_services) END) -> 'pricing', '{}'::jsonb);
    os TEXT := OLD.status::text; ns TEXT := NEW.status::text;
    was_closed BOOLEAN; diff JSONB := '{}'::jsonb; act TEXT;
BEGIN
    IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
    IF jsonb_typeof(op) <> 'object' THEN op := '{}'::jsonb; END IF;
    IF jsonb_typeof(np) <> 'object' THEN np := '{}'::jsonb; END IF;
    was_closed := COALESCE(op ->> 'accounted', '') = 'true';

    IF os IS DISTINCT FROM ns THEN
        IF ns = 'ملغى' THEN act := 'cancel';
        ELSIF os = 'ملغى' THEN act := 'restore';
        ELSIF os = 'تم الانتهاء' THEN act := 'reopen';
        END IF;
        IF act IS NOT NULL THEN diff := jsonb_build_object('status', jsonb_build_object('old', os, 'new', ns)); END IF;
    END IF;
    IF OLD.total_price IS DISTINCT FROM NEW.total_price AND (os = 'تم الانتهاء' OR was_closed) THEN
        diff := diff || jsonb_build_object('total_price', jsonb_build_object('old', OLD.total_price, 'new', NEW.total_price));
    END IF;
    IF COALESCE(NULLIF(op ->> 'discount', ''), '0') IS DISTINCT FROM COALESCE(NULLIF(np ->> 'discount', ''), '0') THEN
        diff := diff || jsonb_build_object('discount', jsonb_build_object('old', op -> 'discount', 'new', np -> 'discount'));
        act := COALESCE(act, 'discount');
    END IF;
    IF was_closed AND (op -> 'received') IS DISTINCT FROM (np -> 'received') THEN
        diff := diff || jsonb_build_object('received', jsonb_build_object('old', op -> 'received', 'new', np -> 'received'));
    END IF;
    IF was_closed AND COALESCE(np ->> 'accounted', '') <> 'true' THEN
        diff := diff || jsonb_build_object('accounted', jsonb_build_object('old', TRUE, 'new', FALSE));
        act := COALESCE(act, 'unclose');
    END IF;
    IF COALESCE(op ->> 'auditExcluded', 'false') IS DISTINCT FROM COALESCE(np ->> 'auditExcluded', 'false') THEN
        diff := diff || jsonb_build_object('auditExcluded', jsonb_build_object('old', COALESCE(op -> 'auditExcluded', 'false'::jsonb), 'new', COALESCE(np -> 'auditExcluded', 'false'::jsonb)));
        act := COALESCE(act, 'exclude');
    END IF;
    IF diff = '{}'::jsonb THEN RETURN NULL; END IF;
    PERFORM public.audit_write('inspection_reports', NEW.id::text, NEW.branch_id, COALESCE(act, 'edit'),
        public.audit_summary('inspection_reports', to_jsonb(NEW)), diff, NULL);
    RETURN NULL;
END $$;

-- Attach. Tables that do not exist in this database are skipped.
DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN SELECT * FROM (VALUES
        ('inspection_reports', NULL),
        ('clients',            'name,phone'),
        ('vehicles',           ''),
        ('inventory',          'name,branch_id,quantity,purchase_price,last_purchase_price,sell_price,special_price,price_wholesale,price_unit1,price_unit2,price_unit3'),
        ('employees',          'name,username,role,branch_id,permission_dashboard,permission_reception,permission_work_orders,permission_customers,permission_reports,permission_employees,permission_inventory_prices,allowed_pages'),
        ('branches',           'name'),
        ('contracts',          'name,is_active'),
        ('contract_payments',  'amount,paid_at'),
        ('hr_employees',       ''),
        ('hr_attendance',      ''),
        ('sales_plans',        'target_amount'),
        ('sales_plan_items',   'target_qty'),
        ('employee_targets',   ''),
        ('employee_tasks',     ''),
        ('service_complaints', ''),
        ('documents_archive',  ''),
        ('suggestion_lists',   '')
    ) AS x(tbl, cols) LOOP
        CONTINUE WHEN to_regclass('public.' || t.tbl) IS NULL;
        EXECUTE format('DROP TRIGGER IF EXISTS audit_delete ON public.%I', t.tbl);
        EXECUTE format('DROP TRIGGER IF EXISTS audit_update ON public.%I', t.tbl);
        EXECUTE format('DROP TRIGGER IF EXISTS audit_insert ON public.%I', t.tbl);
        EXECUTE format('CREATE TRIGGER audit_delete AFTER DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()', t.tbl);
        IF t.tbl = 'inspection_reports' THEN
            EXECUTE 'CREATE TRIGGER audit_update AFTER UPDATE ON public.inspection_reports FOR EACH ROW EXECUTE FUNCTION public.audit_work_order_change()';
        ELSIF t.cols <> '' OR EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = t.tbl AND c.column_name IN ('deleted_at', 'archived_at')) THEN
            EXECUTE format('CREATE TRIGGER audit_update AFTER UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_row_change(%L)', t.tbl, t.cols);
        END IF;
        IF t.tbl = 'employees' THEN
            EXECUTE format('CREATE TRIGGER audit_insert AFTER INSERT ON public.employees FOR EACH ROW EXECUTE FUNCTION public.audit_row_change(%L)', 'role,branch_id,username');
        END IF;
    END LOOP;
END $$;

-- Who may read, and whether purchase prices are shown to them.
CREATE OR REPLACE FUNCTION public.audit_log_scope(OUT allowed BOOLEAN, OUT all_branches BOOLEAN, OUT branch UUID, OUT prices BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE(bool_or(e.role::text IN ('Owner','Admin') OR (e.role::text = 'BranchManager' AND e.branch_id IS NOT NULL)), FALSE),
           COALESCE(bool_or(e.role::text IN ('Owner','Admin')), FALSE),
           (array_agg(e.branch_id))[1],
           COALESCE(bool_or(e.role::text IN ('Owner','Admin') OR COALESCE(e.permission_inventory_prices, FALSE)), FALSE)
    FROM public.employees e WHERE e.auth_id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.audit_log_scope() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.audit_log_list(
    p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL, p_actor UUID DEFAULT NULL,
    p_branch UUID DEFAULT NULL, p_action TEXT DEFAULT NULL, p_table TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 200, p_offset INTEGER DEFAULT 0)
RETURNS TABLE(id BIGINT, at TIMESTAMPTZ, actor_id UUID, actor_name TEXT, actor_role TEXT, branch_id UUID, branch_name TEXT,
              table_name TEXT, row_id TEXT, action TEXT, summary TEXT, changes JSONB, via TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE s RECORD;
BEGIN
    SELECT * INTO s FROM public.audit_log_scope();
    IF NOT s.allowed THEN RAISE EXCEPTION 'غير مصرح.'; END IF;
    RETURN QUERY
    SELECT l.id, l.at, l.actor_id, l.actor_name, l.actor_role, l.branch_id, b.name::text, l.table_name, l.row_id, l.action, l.summary,
           CASE WHEN s.prices OR l.changes IS NULL THEN l.changes
                ELSE l.changes - 'purchase_price' - 'last_purchase_price' END,
           l.via
    FROM public.audit_log l LEFT JOIN public.branches b ON b.id = l.branch_id
    WHERE (s.all_branches OR l.branch_id = s.branch)
      AND (p_from IS NULL OR l.at >= p_from) AND (p_to IS NULL OR l.at < p_to)
      -- the all-zero id asks for the system's own entries (no account)
      AND (p_actor IS NULL OR l.actor_id = p_actor OR (p_actor = '00000000-0000-0000-0000-000000000000'::uuid AND l.actor_id IS NULL))
      AND (p_branch IS NULL OR l.branch_id = p_branch)
      AND (p_action IS NULL OR l.action = p_action)
      AND (p_table IS NULL OR l.table_name = p_table)
      -- an edit that only touched purchase prices is hidden from someone who may not see them
      AND (s.prices OR l.action <> 'edit' OR l.changes IS NULL OR (l.changes - 'purchase_price' - 'last_purchase_price') <> '{}'::jsonb)
    ORDER BY l.at DESC, l.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000) OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END $$;
REVOKE ALL ON FUNCTION public.audit_log_list(TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_log_list(TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;

-- Per account: how many deletes / edits in the period.
CREATE OR REPLACE FUNCTION public.audit_log_actors(p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL, p_branch UUID DEFAULT NULL)
RETURNS TABLE(actor_id UUID, actor_name TEXT, actor_role TEXT, deletes BIGINT, others BIGINT, last_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE s RECORD;
BEGIN
    SELECT * INTO s FROM public.audit_log_scope();
    IF NOT s.allowed THEN RAISE EXCEPTION 'غير مصرح.'; END IF;
    RETURN QUERY
    SELECT l.actor_id, max(l.actor_name), max(l.actor_role),
           count(*) FILTER (WHERE l.action = 'delete' AND l.via IS NULL),
           count(*) FILTER (WHERE l.action <> 'delete'
                             AND (s.prices OR l.action <> 'edit' OR l.changes IS NULL OR (l.changes - 'purchase_price' - 'last_purchase_price') <> '{}'::jsonb)),
           max(l.at)
    FROM public.audit_log l
    WHERE (s.all_branches OR l.branch_id = s.branch)
      AND (p_from IS NULL OR l.at >= p_from) AND (p_to IS NULL OR l.at < p_to)
      AND (p_branch IS NULL OR l.branch_id = p_branch)
    GROUP BY l.actor_id
    ORDER BY 4 DESC, 5 DESC;
END $$;
REVOKE ALL ON FUNCTION public.audit_log_actors(TIMESTAMPTZ, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_log_actors(TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated;
