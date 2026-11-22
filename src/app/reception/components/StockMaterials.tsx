"use client";

// «مواد من المخزن» on a work order: materials picked from the branch stock by packaging.
// Each one is kept as a customServices line (kind "stock") so the invoice, the print, the audit
// and every total show it like any other line; the database deducts it from stock when the
// order is finished and gives it back if the order is reopened, cancelled or deleted
// (migration 20261129_work_order_stock.sql).
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { formatInventoryStock, packagingOptions, getBaseUnit, type InventoryPackaging } from "@/lib/inventory";
import { decimalsOnly, withCommasDecimal } from "@/lib/format";
import { Package, Plus, Trash2 } from "lucide-react";

export type StockLine = {
    id: string; kind: "stock"; label: string; status: string; qty: string; price: string; notes?: string;
    stock: { inventory_id: string; name: string; code: string | null; packageUnit: string; qty: string; unitPrice: string };
};
type Item = InventoryPackaging & { id: string; name: string; item_code: string | null; murabba_id: string | null };

export const isStockLine = (line: unknown): line is StockLine =>
    !!line && typeof line === "object" && (line as { kind?: unknown }).kind === "stock";

const newId = () => `stock-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Date.now().toString(36)}`;

function makeLine(item: { id: string; name: string; code: string | null }, unit: string, qty: string, unitPrice: number, id = newId()): StockLine {
    const q = parseFloat(qty) || 0;
    return {
        id, kind: "stock", label: `${item.name} — ${unit}`, status: "", qty, notes: "",
        price: String(Math.round(q * unitPrice)),
        stock: { inventory_id: item.id, name: item.name, code: item.code, packageUnit: unit, qty, unitPrice: String(unitPrice) },
    };
}

export default function StockMaterials({ branchId, lines, onChange }: { branchId: string; lines: StockLine[]; onChange: (lines: StockLine[]) => void }) {
    const [items, setItems] = useState<Item[]>([]);
    const [loadedFor, setLoadedFor] = useState<string | null>(null);
    const loaded = !branchId || loadedFor === branchId;
    const [search, setSearch] = useState("");
    const [pickId, setPickId] = useState("");
    const [unit, setUnit] = useState("");
    const [qty, setQty] = useState("1");

    useEffect(() => {
        if (!branchId) return;
        let cancelled = false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- packaging columns are not in the generated types yet
        (supabase as any).from("inventory")
            .select("id,item_code,murabba_id,name,quantity,sell_price,base_unit,unit1,unit2,unit3,unit1_to_unit2,unit2_to_unit3,price_unit1,price_unit2,price_unit3")
            .eq("branch_id", branchId).order("name").limit(5000)
            .then(({ data }: { data: Item[] | null }) => { if (!cancelled) { setItems(data || []); setLoadedFor(branchId); } });
        return () => { cancelled = true; };
    }, [branchId]);

    const byId = useMemo(() => new Map((branchId ? items : []).map(i => [i.id, i])), [items, branchId]);
    const matches = useMemo(() => {
        const s = search.trim().toLowerCase();
        return [...byId.values()].filter(i => Number(i.quantity || 0) > 0 && (!s || i.name.toLowerCase().includes(s) || String(i.murabba_id || i.item_code || "").toLowerCase().includes(s))).slice(0, 80);
    }, [byId, search]);
    const picked = pickId ? byId.get(pickId) : undefined;
    const options = picked ? packagingOptions(picked) : [];
    const chosen = options.find(o => o.unit === unit);

    const pick = (id: string) => {
        setPickId(id);
        const item = byId.get(id);
        setUnit(item ? getBaseUnit(item) : "");
    };
    const add = () => {
        if (!picked || !chosen || chosen.price === null || !(parseFloat(qty) > 0)) return;
        onChange([...lines, makeLine({ id: picked.id, name: picked.name, code: picked.murabba_id || picked.item_code }, unit, qty, chosen.price)]);
        setPickId(""); setUnit(""); setQty("1"); setSearch("");
    };
    const setLineQty = (line: StockLine, value: string) =>
        onChange(lines.map(l => l.id === line.id ? makeLine({ id: l.stock.inventory_id, name: l.stock.name, code: l.stock.code }, l.stock.packageUnit, value, parseFloat(l.stock.unitPrice) || 0, l.id) : l));
    const remove = (line: StockLine) => onChange(lines.filter(l => l.id !== line.id));

    return <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5">
        <div className="flex flex-wrap items-center justify-between gap-2 p-3">
            <span className="font-bold text-sm flex items-center gap-2"><Package size={16} className="text-emerald-400" />مواد من المخزن</span>
            <span className="text-[11px] text-muted-foreground">تنخصم من مخزن الفرع لما أمر العمل يخلص، وترجع إذا انحذف أو انلغى أو انفتح من جديد.</span>
        </div>

        {lines.length > 0 && <div className="px-3 pb-3 space-y-2">
            {lines.map(line => {
                const item = byId.get(line.stock.inventory_id);
                const foreign = loaded && !item;
                return <div key={line.id} className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 ${foreign ? "border-rose-500/40 bg-rose-500/5" : "border-border bg-background/40"}`}>
                    <div className="flex-1 min-w-[160px]">
                        <div className="text-sm font-bold">{line.stock.name} <span className="text-muted-foreground font-normal">— {line.stock.packageUnit}</span></div>
                        <div className="text-[11px] text-muted-foreground">{foreign ? "هذه المادة ليست من مخزن هذا الفرع — احذفها واختر من مخزن الفرع" : `${Number(line.stock.unitPrice).toLocaleString("en-US")} د.ع للـ${line.stock.packageUnit}${item ? ` • المتوفر: ${formatInventoryStock(item)}` : ""}`}</div>
                    </div>
                    <input type="text" inputMode="decimal" aria-label="الكمية" value={withCommasDecimal(line.qty)} onChange={e => setLineQty(line, decimalsOnly(e.target.value))} className="input-field text-xs py-1.5 w-20 text-center" />
                    <span className="text-sm font-bold w-28 text-left" dir="ltr">{Number(line.price || 0).toLocaleString("en-US")} د.ع</span>
                    <button type="button" onClick={() => remove(line)} className="p-1.5 text-rose-500 hover:bg-rose-500/10 rounded-lg" title="حذف"><Trash2 size={15} /></button>
                </div>;
            })}
        </div>}

        <div className="border-t border-emerald-500/20 p-3 grid gap-2 sm:grid-cols-[1fr_1.4fr_9rem_5rem_auto] items-end">
            <label className="text-[11px] text-muted-foreground">بحث (الاسم أو الرقم)
                <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="مثال: 5W30" className="input-field text-xs py-1.5 w-full mt-1" />
            </label>
            <label className="text-[11px] text-muted-foreground">المادة
                <select value={pickId} onChange={e => pick(e.target.value)} className="input-field text-xs py-1.5 w-full mt-1">
                    <option value="">{!loaded ? "جاري تحميل المخزن..." : matches.length ? "اختر مادة من مخزن الفرع" : byId.size ? "لا توجد مادة متوفرة بهذا الاسم" : "مخزن هذا الفرع فارغ"}</option>
                    {matches.map(i => <option key={i.id} value={i.id}>{i.name}{i.murabba_id || i.item_code ? ` — ${i.murabba_id || i.item_code}` : ""} (المتوفر {formatInventoryStock(i)})</option>)}
                </select>
            </label>
            <label className="text-[11px] text-muted-foreground">التعبئة
                <select value={unit} disabled={!picked} onChange={e => setUnit(e.target.value)} className="input-field text-xs py-1.5 w-full mt-1 disabled:opacity-50">
                    {!picked && <option value="">اختر المادة أولاً</option>}
                    {options.map(o => <option key={o.unit} value={o.unit} disabled={o.price === null}>{o.unit}{o.price === null ? " — بدون سعر" : ` — ${o.price.toLocaleString("en-US")}`}</option>)}
                </select>
            </label>
            <label className="text-[11px] text-muted-foreground">الكمية
                <input type="text" inputMode="decimal" value={withCommasDecimal(qty)} onChange={e => setQty(decimalsOnly(e.target.value))} className="input-field text-xs py-1.5 w-full mt-1 text-center" />
            </label>
            <button type="button" onClick={add} disabled={!picked || !chosen || chosen.price === null || !(parseFloat(qty) > 0)}
                className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold disabled:opacity-40"><Plus size={14} />إضافة</button>
            {picked && chosen && chosen.price !== null && parseFloat(qty) > chosen.available &&
                <p className="sm:col-span-5 text-[11px] text-amber-400">المتوفر {formatInventoryStock(picked)} فقط — أمر العمل ما راح يكتمل إذا الكمية ما تكفي وقت الإنجاز.</p>}
        </div>
    </div>;
}
