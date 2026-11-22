-- Materials picked from stock inside the service rows (زيت المحرك → اسم المادة → التعبئة).
-- Depends on 20261129. Safe to run more than once.
--
-- A service entry may now carry stock = { "<field>": { inventory_id, name, packageUnit } } next to
-- its details. The quantity and unit price come from the same row:
--   single material  → details.qty (or liters), details.unitPrice   (empty qty = 1)
--   products list    → details.qty_N, details.price_N for field prod_N (empty qty = 1)
-- The trigger from 20261129 is unchanged: it reads every stock line through this function, so these
-- are deducted when the order is finished and given back on reopen / cancel / delete, like the rest.

CREATE OR REPLACE FUNCTION public.work_order_stock_lines(p JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
    WITH num AS (SELECT '^[0-9]+(\.[0-9]+)?$'::text AS re),
    custom AS (
        SELECT 'c:' || COALESCE(c ->> 'id', '') AS id,
               c -> 'stock' ->> 'inventory_id' AS inventory_id,
               btrim(c -> 'stock' ->> 'packageUnit') AS unit,
               c -> 'stock' ->> 'qty' AS qty,
               c -> 'stock' ->> 'unitPrice' AS unit_price,
               c ->> 'label' AS label
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p -> 'customServices') = 'array' THEN p -> 'customServices' ELSE '[]'::jsonb END) c
        WHERE c ->> 'kind' = 'stock'
    ),
    svc AS (
        SELECT 's:' || s.key || ':' || l.key AS id,
               l.value ->> 'inventory_id' AS inventory_id,
               btrim(l.value ->> 'packageUnit') AS unit,
               COALESCE(NULLIF(btrim(CASE WHEN l.key LIKE 'prod\_%' THEN s.value -> 'details' ->> ('qty_' || substr(l.key, 6))
                                          ELSE COALESCE(NULLIF(btrim(s.value -> 'details' ->> 'qty'), ''), s.value -> 'details' ->> 'liters') END), ''), '1') AS qty,
               CASE WHEN l.key LIKE 'prod\_%' THEN s.value -> 'details' ->> ('price_' || substr(l.key, 6))
                    ELSE s.value -> 'details' ->> 'unitPrice' END AS unit_price,
               s.value -> 'details' ->> l.key AS label
        FROM jsonb_each(CASE WHEN jsonb_typeof(p -> 'services') = 'object' THEN p -> 'services' ELSE '{}'::jsonb END) s,
             jsonb_each(CASE WHEN jsonb_typeof(s.value -> 'stock') = 'object' THEN s.value -> 'stock' ELSE '{}'::jsonb END) l
        WHERE jsonb_typeof(l.value) = 'object'
          AND COALESCE(btrim(s.value -> 'details' ->> l.key), '') <> ''   -- the material is still on the row
    ),
    lines AS (SELECT * FROM custom UNION ALL SELECT * FROM svc)
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'inventory_id', l.inventory_id,
               'unit', l.unit,
               'qty', l.qty::numeric,
               'unit_price', CASE WHEN COALESCE(l.unit_price, '') ~ num.re THEN l.unit_price::numeric END,
               'label', l.label)
           ORDER BY l.id), '[]'::jsonb)
    FROM lines l, num
    WHERE COALESCE(l.inventory_id, '') ~ '^[0-9a-fA-F-]{36}$'
      AND CASE WHEN COALESCE(l.qty, '') ~ num.re THEN l.qty::numeric > 0 ELSE FALSE END
$$;
