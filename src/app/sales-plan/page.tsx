"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Target, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthProvider";
import { showConfirm, showError, showSuccess } from "@/lib/alerts";

type Plan = { id: string; branch_id: string; month: string; target_amount: number | null; notes: string | null };
type Item = { id: string; kind: "service" | "product"; service_key: string | null; inventory_id: string | null; label: string; unit: string; target_qty: number };
type Progress = { item_id: string | null; employee_id: string | null; sold: number };

// Work-order services that can carry a monthly target (cars that got the service).
const SERVICES: Record<string, string> = { engineOil: "تبديل زيت المحرك", oilFilter: "فلتر زيت المحرك", airFilter: "فلتر الهواء", acFilter: "فلتر التبريد", brakeFluid: "زيت المكابح", coolant: "ماء الراديتر", battery: "البطارية", engineBelts: "قايش المحرك", brakePads: "دسكات السيارة", sparkPlugs: "شمعات الاحتراق", gearboxHydraulic: "هايدروليك الكير", differentialOil: "زيت الدفرنس", tires: "الإطارات", carWash: "غسل السيارة" };
const errorText = (e: any) => String(e?.message || e || "حدث خطأ غير معروف");
const fmt = (n: number) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

export default function SalesPlanPage() {
    const { employeeRole, employeeBranchId, loading: authLoading } = useAuth();
    const isAdmin = employeeRole === "Owner" || employeeRole === "Admin";
    const canView = isAdmin || employeeRole === "Supervisor";
    const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
    const [branchId, setBranchId] = useState("");
    const [month, setMonth] = useState(thisMonth());
    const [plan, setPlan] = useState<Plan | null>(null);
    const [items, setItems] = useState<Item[]>([]);
    const [progress, setProgress] = useState<Progress[]>([]);
    const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);
    const [stock, setStock] = useState<{ id: string; name: string; base_unit: string | null }[]>([]);
    const [loading, setLoading] = useState(true);
    const [amountDraft, setAmountDraft] = useState("");
    const [form, setForm] = useState({ kind: "service" as "service" | "product", service_key: "engineOil", inventory_id: "", target_qty: "", unit: "سيارة" });
    const [stockSearch, setStockSearch] = useState("");

    useEffect(() => {
        if (authLoading || !canView) return;
        supabase.from("branches").select("id,name").order("name").then(({ data }) => {
            const list = (data || []) as { id: string; name: string }[];
            setBranches(list);
            setBranchId(b => b || (employeeBranchId && list.some(x => x.id === employeeBranchId) ? employeeBranchId : list[0]?.id || ""));
        });
    }, [authLoading, canView, employeeBranchId]);

    const load = useCallback(async () => {
        if (!branchId) return;
        setLoading(true);
        try {
            const monthDate = `${month}-01`;
            const [planRow, staffRows, stockRows] = await Promise.all([
                (supabase as any).from("sales_plans").select("id,branch_id,month,target_amount,notes").eq("branch_id", branchId).eq("month", monthDate).maybeSingle(),
                supabase.from("employees").select("id,name").eq("branch_id", branchId).eq("role", "Receptionist").order("name"),
                isAdmin ? (supabase as any).from("inventory").select("id,name,base_unit").eq("branch_id", branchId).order("name").limit(2000) : Promise.resolve({ data: [] }),
            ]);
            if (planRow.error) throw planRow.error;
            const p = planRow.data as Plan | null;
            setPlan(p); setAmountDraft(p?.target_amount != null ? String(p.target_amount) : "");
            setStaff((staffRows.data || []) as { id: string; name: string }[]);
            setStock((stockRows.data || []) as { id: string; name: string; base_unit: string | null }[]);
            if (p) {
                const [itemRows, prog] = await Promise.all([
                    (supabase as any).from("sales_plan_items").select("id,kind,service_key,inventory_id,label,unit,target_qty").eq("plan_id", p.id).order("created_at"),
                    (supabase as any).rpc("sales_plan_progress", { p_plan: p.id }),
                ]);
                if (itemRows.error) throw itemRows.error;
                if (prog.error) throw prog.error;
                setItems((itemRows.data || []) as Item[]); setProgress((prog.data || []) as Progress[]);
            } else { setItems([]); setProgress([]); }
        } catch (e) { showError("تعذر تحميل الخطة", errorText(e)); }
        finally { setLoading(false); }
    }, [branchId, month, isAdmin]);
    useEffect(() => { load(); }, [load]);

    const soldOf = (itemId: string | null, employeeId: string | null) => Number(progress.find(p => p.item_id === itemId && p.employee_id === employeeId)?.sold || 0);
    const monthInfo = useMemo(() => {
        const [y, m] = month.split("-").map(Number);
        const days = new Date(y, m, 0).getDate();
        const now = new Date();
        const isCurrent = now.getFullYear() === y && now.getMonth() + 1 === m;
        const passed = isCurrent ? now.getDate() : (new Date(y, m - 1, 1) < now ? days : 0);
        return { days, passed, expected: days ? passed / days : 0 };
    }, [month]);

    const savePlan = async () => {
        const amount = amountDraft.trim() === "" ? null : Number(amountDraft.replace(/,/g, ""));
        if (amount != null && (!Number.isFinite(amount) || amount < 0)) return showError("تحقق من المبلغ", "أدخل مبلغاً صحيحاً.");
        const { error } = plan
            ? await (supabase as any).from("sales_plans").update({ target_amount: amount }).eq("id", plan.id)
            : await (supabase as any).from("sales_plans").insert({ branch_id: branchId, month: `${month}-01`, target_amount: amount });
        if (error) return showError("لم يتم حفظ الخطة", errorText(error));
        showSuccess("تم الحفظ", plan ? "تم تحديث هدف المبيعات." : "تم إنشاء خطة الشهر.");
        await load();
    };
    const addItem = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!plan) return;
        const qty = Number(form.target_qty);
        if (!qty || qty <= 0) return showError("تحقق من الهدف", "أدخل عدداً أكبر من صفر.");
        const product = stock.find(s => s.id === form.inventory_id);
        if (form.kind === "product" && !product) return showError("اختر المادة", "اختر مادة من مخزن الفرع.");
        const row = form.kind === "service"
            ? { plan_id: plan.id, kind: "service", service_key: form.service_key, label: SERVICES[form.service_key], unit: form.unit.trim() || "سيارة", target_qty: qty }
            : { plan_id: plan.id, kind: "product", inventory_id: product!.id, label: product!.name, unit: form.unit.trim() || product!.base_unit || "قطعة", target_qty: qty };
        const { error } = await (supabase as any).from("sales_plan_items").insert(row);
        if (error) return showError("لم تتم الإضافة", errorText(error));
        setForm(f => ({ ...f, target_qty: "", inventory_id: "" })); setStockSearch("");
        await load();
    };
    const removeItem = async (item: Item) => {
        if (!(await showConfirm("حذف من الخطة", `سيتم حذف «${item.label}» من خطة هذا الشهر.`, "حذف", true))) return;
        const { error } = await (supabase as any).from("sales_plan_items").delete().eq("id", item.id);
        if (error) return showError("تعذر الحذف", errorText(error));
        await load();
    };

    if (authLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;
    if (!canView) return <div className="min-h-screen flex items-center justify-center" dir="rtl"><div className="glass-card p-8 rounded-2xl">غير مصرح.</div></div>;

    const rows: { id: string | null; label: string; unit: string; target: number; removable?: Item }[] = [
        ...(plan?.target_amount ? [{ id: null, label: "المبيعات", unit: "د.ع", target: Number(plan.target_amount) }] : []),
        ...items.map(i => ({ id: i.id, label: i.label, unit: i.unit, target: Number(i.target_qty), removable: i })),
    ];
    const share = staff.length ? 1 / staff.length : 1;
    const stockMatches = stockSearch.trim() ? stock.filter(s => s.name.includes(stockSearch.trim())).slice(0, 30) : stock.slice(0, 30);

    return <main className="min-h-screen p-5 md:p-8 font-ibm" dir="rtl"><div className="max-w-6xl mx-auto space-y-5">
        <header className="glass-card p-6 rounded-2xl flex flex-wrap items-end justify-between gap-4">
            <div className="flex items-center gap-4"><div className="w-14 h-14 rounded-2xl bg-violet-500/10 text-violet-400 flex items-center justify-center"><Target size={28} /></div>
                <div><h1 className="text-2xl font-bold">خطة المبيعات الشهرية</h1><p className="text-muted-foreground text-sm">الهدف يتقسم بالتساوي على موظفي الاستقبال بالفرع، والسستم يكتب لكل واحد مهامه اليومية تلقائياً.</p></div></div>
            <div className="flex flex-wrap gap-2">
                <select className="input-field" value={branchId} onChange={e => setBranchId(e.target.value)} disabled={!isAdmin && !!employeeBranchId}>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                <input type="month" className="input-field" value={month} onChange={e => e.target.value && setMonth(e.target.value)} />
            </div>
        </header>

        {loading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin" /></div> : <>
            {isAdmin && <section className="glass-card p-5 rounded-2xl flex flex-wrap items-end gap-3">
                <label className="text-sm">هدف المبيعات للشهر (د.ع) — اختياري<input inputMode="numeric" className="input-field w-full mt-1 min-w-56" value={amountDraft} onChange={e => setAmountDraft(e.target.value)} placeholder="مثال: 25000000" /></label>
                <button onClick={savePlan} className="px-5 py-2.5 rounded-xl bg-violet-600 text-white font-bold">{plan ? "حفظ الهدف" : "إنشاء خطة الشهر"}</button>
                {!plan && <span className="text-xs text-muted-foreground">لا توجد خطة لهذا الفرع في هذا الشهر.</span>}
            </section>}

            {plan && isAdmin && <form onSubmit={addItem} className="glass-card p-5 rounded-2xl grid md:grid-cols-[auto_1fr_8rem_8rem_auto] gap-3 items-end">
                <label className="text-sm">النوع<select className="input-field w-full mt-1" value={form.kind} onChange={e => { const kind = e.target.value as "service" | "product"; setForm(f => ({ ...f, kind, unit: kind === "service" ? "سيارة" : "" })); }}><option value="service">خدمة (عدد سيارات)</option><option value="product">مادة من المخزن</option></select></label>
                {form.kind === "service"
                    ? <label className="text-sm">الخدمة<select className="input-field w-full mt-1" value={form.service_key} onChange={e => setForm(f => ({ ...f, service_key: e.target.value }))}>{Object.entries(SERVICES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                    : <label className="text-sm">المادة<div className="flex gap-2 mt-1"><input className="input-field w-40" placeholder="بحث" value={stockSearch} onChange={e => setStockSearch(e.target.value)} /><select className="input-field flex-1" value={form.inventory_id} onChange={e => { const s = stock.find(x => x.id === e.target.value); setForm(f => ({ ...f, inventory_id: e.target.value, unit: s?.base_unit || "قطعة" })); }}><option value="">— اختر ({stock.length} مادة) —</option>{stockMatches.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div></label>}
                <label className="text-sm">الهدف الشهري<input type="number" min="0" step="any" className="input-field w-full mt-1" value={form.target_qty} onChange={e => setForm(f => ({ ...f, target_qty: e.target.value }))} /></label>
                <label className="text-sm">الوحدة<input className="input-field w-full mt-1" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} /></label>
                <button className="px-4 py-2.5 rounded-xl bg-cyan-600 text-white font-bold flex items-center gap-1"><Plus size={16} />إضافة</button>
            </form>}

            {plan && <section className="glass-card rounded-2xl overflow-hidden">
                <div className="p-5 border-b border-border flex flex-wrap justify-between gap-2"><h2 className="font-bold text-lg">التقدم</h2>
                    <span className="text-xs text-muted-foreground">مضى {monthInfo.passed} من {monthInfo.days} يوم • المتوقع حتى الآن {Math.round(monthInfo.expected * 100)}% • موظفو الاستقبال: {staff.length || "لا يوجد"}</span></div>
                <div className="overflow-auto"><table className="w-full min-w-[760px] text-sm text-right">
                    <thead className="bg-muted/40"><tr><th className="p-3">البند</th><th className="p-3">الهدف</th><th className="p-3">المنجز (الفرع)</th><th className="p-3 w-48">النسبة</th>{staff.map(s => <th key={s.id} className="p-3">{s.name}<div className="text-[10px] text-muted-foreground font-normal">المنجز / الحصة</div></th>)}{isAdmin && <th className="p-3"></th>}</tr></thead>
                    <tbody>{rows.map(r => { const sold = soldOf(r.id, null); const pct = r.target ? Math.round(sold / r.target * 100) : 0; const behind = pct / 100 < monthInfo.expected - 0.05; return <tr key={r.id || "amount"} className="border-t border-border">
                        <td className="p-3 font-bold">{r.label}</td>
                        <td className="p-3 whitespace-nowrap">{fmt(r.target)} {r.unit}</td>
                        <td className="p-3 whitespace-nowrap">{fmt(sold)}</td>
                        <td className="p-3"><div className="h-2 bg-muted rounded-full overflow-hidden"><div className={`h-full ${behind ? "bg-rose-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, pct)}%` }} /></div><div className={`text-xs mt-1 ${behind ? "text-rose-400" : "text-emerald-400"}`}>{pct}%{behind ? " • متأخر عن الخطة" : ""}</div></td>
                        {staff.map(s => <td key={s.id} className="p-3 whitespace-nowrap">{fmt(soldOf(r.id, s.id))} / {fmt(Math.ceil(r.target * share))}</td>)}
                        {isAdmin && <td className="p-3">{r.removable ? <button onClick={() => removeItem(r.removable!)} className="text-muted-foreground hover:text-rose-400"><Trash2 size={15} /></button> : null}</td>}
                    </tr>; })}</tbody>
                </table>{rows.length === 0 && <div className="text-center text-sm text-muted-foreground py-8">أضف هدف المبيعات أو بنود الخطة.</div>}</div>
            </section>}
        </>}
    </div></main>;
}
