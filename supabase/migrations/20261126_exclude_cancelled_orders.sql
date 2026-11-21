-- Cancelled orders (status ملغى) no longer count toward the monthly plan, the automatic daily
-- tasks or the branch monthly totals. Re-creates sales_sold() and branch_monthly_sales().
-- Depends on 20261124 and 20261125. Safe to run more than once.

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
          AND r.created_at >= t_from AND r.created_at < t_to AND r.status::text NOT IN ('ملغى', 'ملغي', 'cancelled');
    ELSIF p_kind = 'service' THEN
        SELECT COUNT(*) INTO result FROM public.inspection_reports r
        WHERE r.branch_id = p_branch AND (p_employee IS NULL OR r.receptionist_id = p_employee)
          AND r.created_at >= t_from AND r.created_at < t_to AND r.status::text NOT IN ('ملغى', 'ملغي', 'cancelled')
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
          AND r.created_at >= t_from AND r.created_at < t_to AND r.status::text NOT IN ('ملغى', 'ملغي', 'cancelled');
    END IF;
    RETURN COALESCE(result, 0);
END;
$$;
REVOKE ALL ON FUNCTION public.sales_sold(UUID, UUID, TEXT, TEXT, UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;

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
    WHERE r.branch_id = p_branch AND r.status::text NOT IN ('ملغى', 'ملغي', 'cancelled')
    GROUP BY 1
    ORDER BY 1 DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.branch_monthly_sales(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.branch_monthly_sales(UUID) TO authenticated;
