"use client";

// Picking a service's material (اسم المادة) from the branch stock, with its packaging.
// The link lives on the service entry (entry.stock[field]) — not in details, whose values are
// shown as text on the floor — and the packaging is kept in details (pack / pack_N) so it prints.
// The database deducts linked materials when the order is finished (20261130_service_stock.sql).
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { formatInventoryStock, getBaseUnit, packagingOptions, type InventoryPackaging } from "@/lib/inventory";

export type StockItem = InventoryPackaging & { id: string; name: string; item_code: string | null; murabba_id: string | null };
export type StockLink = { inventory_id: string; name: string; packageUnit: string };
type Entry = { details: Record<string, string>; price: string; stock?: Record<string, StockLink> };

/** The branch's stock (every item, including ones at 0 so an old order still finds its item). */
export function useBranchStock(branchId: string) {
    const [items, setItems] = useState<StockItem[]>([]);
    const [loadedFor, setLoadedFor] = useState<string | null>(null);
    useEffect(() => {
        if (!branchId) return;
        let cancelled = false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- packaging columns are not in the generated types yet
        (supabase as any).from("inventory")
            .select("id,item_code,murabba_id,name,quantity,sell_price,base_unit,unit1,unit2,unit3,unit1_to_unit2,unit2_to_unit3,price_unit1,price_unit2,price_unit3")
            .eq("branch_id", branchId).order("name").limit(5000)
            .then(({ data }: { data: StockItem[] | null }) => { if (!cancelled) { setItems(data || []); setLoadedFor(branchId); } });
        return () => { cancelled = true; };
    }, [branchId]);
    const list = useMemo(() => (branchId ? items : []), [items, branchId]);
    const byId = useMemo(() => new Map(list.map(i => [i.id, i])), [list]);
    return { items: list, byId, loaded: !branchId || loadedFor === branchId };
}

/** In-stock items matching what was typed (name or code). */
export function stockHits(items: StockItem[], text: string, limit = 6): StockItem[] {
    const s = text.trim().toLowerCase();
    return items.filter(i => Number(i.quantity || 0) > 0
        && (!s || i.name.toLowerCase().includes(s) || String(i.murabba_id || i.item_code || "").toLowerCase().includes(s))).slice(0, limit);
}

const packKey = (field: string) => field.startsWith("prod_") ? field.replace("prod_", "pack_") : "pack";
const unitPriceKey = (field: string) => field.startsWith("prod_") ? field.replace("prod_", "price_") : "unitPrice";

function recompute(field: string, details: Record<string, string>, fallback: string): string {
    if (field.startsWith("prod_")) {
        let sum = 0;
        for (const k of Object.keys(details)) if (k.startsWith("price_")) sum += (Number(details[k] || 0)) * ((Number(details[k.replace("price_", "qty_")] || 0)) || 1);
        return sum > 0 ? String(Math.round(sum)) : "";
    }
    const q = parseFloat(details.qty || details.liters), up = parseFloat(details.unitPrice);
    if (!isNaN(up) && up > 0) return String(Math.round(!isNaN(q) && q > 0 ? q * up : up));
    return fallback;
}

/** Link field to a stock item in a packaging (the base unit by default); fills name, packaging and price. */
export function linkStock<T extends Entry>(entry: T, field: string, item: StockItem, unit?: string): T {
    const pack = unit || getBaseUnit(item);
    const price = packagingOptions(item).find(o => o.unit === pack)?.price;
    const details = { ...entry.details, [field]: item.name, [packKey(field)]: pack, [unitPriceKey(field)]: price != null ? String(price) : "" };
    return { ...entry, details, price: recompute(field, details, entry.price), stock: { ...(entry.stock || {}), [field]: { inventory_id: item.id, name: item.name, packageUnit: pack } } };
}

/** Drop the link when the material's name was changed by hand (or the row removed). */
export function unlinkIfRenamed<T extends Entry>(entry: T, field: string): T {
    const link = entry.stock?.[field];
    if (!link || (entry.details[field] ?? "") === link.name) return entry;
    const stock = { ...entry.stock };
    delete stock[field];
    const details = { ...entry.details };
    delete details[packKey(field)];
    return { ...entry, details, stock };
}

export const hasStockLink = (entry: Entry, field?: string) =>
    field ? !!entry.stock?.[field] : !!entry.stock && Object.keys(entry.stock).length > 0;

/** Field list with a «التعبئة» pseudo-field right after a linked material name. */
export const PACK_FIELD = "__pack";
export function withPackField<F extends { key: string; label: string; listId?: string }>(fields: F[], entry: Entry): (F | { key: string; label: string; forField: string })[] {
    const out: (F | { key: string; label: string; forField: string })[] = [];
    for (const f of fields) {
        out.push(f);
        if (entry.stock?.[f.key]) out.push({ key: PACK_FIELD, label: "التعبئة", forField: f.key });
    }
    return out;
}

/** Stock matches shown at the top of a material's suggestion list. */
export function StockHitList({ hits, onPick }: { hits: StockItem[]; onPick: (item: StockItem) => void }) {
    if (!hits.length) return null;
    return <>
        <div className="px-3 pt-2 pb-1 text-[10px] font-bold text-emerald-400">من مخزن الفرع</div>
        {hits.map(it => (
            <button key={it.id} type="button" className="suggestion-item" onMouseDown={() => onPick(it)}>
                <span className="font-bold truncate text-right flex-1">{it.name}</span>
                <div className="flex items-center gap-1.5 shrink-0" dir="ltr">
                    <span className="suggestion-price">{formatInventoryStock(it)}</span>
                    {(it.murabba_id || it.item_code) && <span className="suggestion-serial">{it.murabba_id || it.item_code}</span>}
                </div>
            </button>
        ))}
    </>;
}

/** Packaging choice for a linked material, each with its own price. */
export function PackSelect({ item, value, onChange, className = "" }: { item: StockItem | undefined; value: string; onChange: (unit: string) => void; className?: string }) {
    const options = item ? packagingOptions(item) : [];
    return (
        <select aria-label="التعبئة" title="التعبئة" value={value} onChange={e => onChange(e.target.value)}
            className={`input-field text-xs py-1.5 border-emerald-500/40 ${className}`}>
            {!options.some(o => o.unit === value) && <option value={value}>{value}</option>}
            {options.map(o => <option key={o.unit} value={o.unit} disabled={o.price === null}>
                {o.unit}{o.price === null ? " — بدون سعر" : ` — ${o.price.toLocaleString("en-US")} د.ع`}
            </option>)}
        </select>
    );
}
