"use client";

// الرقابة الإدارية: every delete, and the edits that matter for money, stock and accounts, with
// the account that did it. Written by database triggers only (20261131_audit_log.sql) and read
// through audit_log_list / audit_log_actors, which decide who sees what (Owner/Admin: all,
// branch manager: their branch) and blank purchase prices for those not allowed to see them.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthProvider";
import { ShieldAlert, Trash2, Loader2, RefreshCw, ChevronDown, ChevronUp, UserRound } from "lucide-react";

type Entry = {
    id: number; at: string; actor_id: string | null; actor_name: string | null; actor_role: string | null;
    branch_id: string | null; branch_name: string | null; table_name: string; row_id: string | null;
    action: string; summary: string | null; changes: Record<string, unknown> | null; via: string | null;
};
type Actor = { actor_id: string | null; actor_name: string | null; actor_role: string | null; deletes: number; others: number; last_at: string };

const PAGE = 100;
const SYSTEM = "00000000-0000-0000-0000-000000000000"; // the system's own entries (no account)

const ACTIONS: Record<string, { label: string; cls: string }> = {
    delete: { label: "حذف", cls: "bg-rose-500/15 text-rose-400 border-rose-500/30" },
    cancel: { label: "إلغاء أمر", cls: "bg-rose-500/10 text-rose-300 border-rose-500/25" },
    discount: { label: "خصم", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    unclose: { label: "فتح فاتورة مغلقة", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    exclude: { label: "استبعاد من الإغلاق", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    reopen: { label: "إعادة فتح أمر", cls: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
    restore: { label: "استرجاع أمر ملغى", cls: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
    edit: { label: "تعديل", cls: "bg-violet-500/15 text-violet-400 border-violet-500/30" },
    create: { label: "حساب جديد", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
};

const TABLES: Record<string, string> = {
    inspection_reports: "أوامر العمل والفواتير", clients: "العملاء", vehicles: "المركبات", inventory: "المخزن",
    employees: "حسابات الموظفين", branches: "الفروع", contracts: "العقود", contract_payments: "دفعات العقود",
    hr_employees: "الموارد البشرية", hr_attendance: "الحضور", sales_plans: "خطة المبيعات", sales_plan_items: "بنود الخطة",
    employee_targets: "أهداف الموظفين", employee_tasks: "المهام", service_complaints: "الشكاوى",
    documents_archive: "المستندات", suggestion_lists: "قوائم الاقتراحات",
};

const ROLES: Record<string, string> = {
    Owner: "المالك", Admin: "مدير النظام", BranchManager: "مدير فرع", Supervisor: "مشرف شفت", Receptionist: "استقبال", Technician: "فني",
};

const FIELDS: Record<string, string> = {
    total_price: "المجموع", discount: "الخصم", received: "الواصل", status: "الحالة", accounted: "الفاتورة مغلقة",
    auditExcluded: "مستبعدة من الإغلاق", quantity: "الكمية", purchase_price: "سعر الشراء", last_purchase_price: "آخر سعر شراء",
    sell_price: "سعر البيع", special_price: "السعر الخاص", price_wholesale: "سعر الجملة", price_unit1: "سعر التعبئة 1",
    price_unit2: "سعر التعبئة 2", price_unit3: "سعر التعبئة 3", name: "الاسم", phone: "الهاتف", username: "اسم المستخدم",
    role: "الدور", branch_id: "الفرع", allowed_pages: "التبويبات", amount: "المبلغ", paid_at: "تاريخ الدفع", is_active: "فعّال",
    target_amount: "هدف المبيعات", target_qty: "الهدف", permission_dashboard: "صلاحية لوحة التحكم",
    permission_reception: "صلاحية الاستقبال", permission_work_orders: "صلاحية ساحة الورشة", permission_customers: "صلاحية العملاء",
    permission_reports: "صلاحية التقارير", permission_employees: "صلاحية إدارة الموظفين", permission_inventory_prices: "صلاحية أسعار الشراء",
    report_number: "رقم الأمر", order_type: "النوع", created_at: "تاريخ الإنشاء", completed_at: "تاريخ الانتهاء", notes: "ملاحظات",
    item_code: "الكود", murabba_id: "كود المربع", category: "الصنف", title: "العنوان", label: "البند", make: "الشركة", model: "الموديل",
    plate_number: "رقم اللوحة",
};
// Fields of a deleted record worth showing at a glance (the full record stays under «كل البيانات»).
const DELETED_SHOWN = ["report_number", "order_type", "status", "total_price", "created_at", "completed_at", "name", "phone", "username", "role",
    "make", "model", "plate_number", "item_code", "murabba_id", "category", "quantity", "sell_price", "purchase_price", "amount", "paid_at", "title", "label", "notes"];

const fmtTime = (iso: string) => new Date(iso).toLocaleString("ar-IQ-u-nu-latn", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const baghdadDay = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Baghdad" });
const dayStart = (day: string) => `${day}T00:00:00+03:00`;
const nextDay = (day: string) => { const d = new Date(`${day}T12:00:00+03:00`); d.setUTCDate(d.getUTCDate() + 1); return baghdadDay(d); };

function show(v: unknown, field?: string): string {
    if (v === null || v === undefined || v === "") return "—";
    if (typeof v === "boolean") return v ? "نعم" : "لا";
    if (Array.isArray(v)) return v.join("، ") || "—";
    if (typeof v === "object") return JSON.stringify(v);
    const s = String(v);
    if (field === "role") return ROLES[s] || s;
    if (field === "order_type") return s === "sale" ? "بيع مباشر" : "صيانة";
    if (/_at$/.test(field || "") && !isNaN(Date.parse(s))) return fmtTime(s);
    if (/^-?\d+(\.\d+)?$/.test(s) && !/(phone|code|murabba|username|report_number)/.test(field || "")) return Number(s).toLocaleString("en-US");
    return s;
}

function Details({ e, branches }: { e: Entry; branches: Record<string, string> }) {
    const c = e.changes || {};
    const fieldValue = (k: string, v: unknown) => (k === "branch_id" && typeof v === "string" ? branches[v] || v : show(v, k));
    if (e.action === "delete" || e.action === "create") {
        const keys = e.action === "create" ? Object.keys(c) : DELETED_SHOWN.filter(k => c[k] !== undefined && c[k] !== null && c[k] !== "");
        return <div className="space-y-2">
            {keys.length > 0 && <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
                {keys.map(k => <div key={k} className="flex gap-2"><span className="text-muted-foreground shrink-0">{FIELDS[k] || k}:</span><span className="font-bold break-all">{fieldValue(k, c[k])}</span></div>)}
            </div>}
            {e.action === "delete" && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">كل البيانات المحذوفة</summary>
                <pre dir="ltr" className="mt-2 p-3 rounded-xl bg-muted/40 overflow-auto max-h-72 text-[11px] leading-relaxed">{JSON.stringify(c, null, 2)}</pre></details>}
        </div>;
    }
    return <table className="text-xs w-full max-w-xl"><tbody>
        {Object.entries(c).map(([k, v]) => {
            const d = (v || {}) as { old?: unknown; new?: unknown };
            return <tr key={k} className="border-t border-border/50 first:border-0">
                <td className="py-1.5 pl-4 text-muted-foreground whitespace-nowrap">{FIELDS[k] || k}</td>
                <td className="py-1.5 pl-3 line-through text-rose-300/80 break-all">{fieldValue(k, d.old)}</td>
                <td className="py-1.5 pl-3 text-muted-foreground">←</td>
                <td className="py-1.5 font-bold text-emerald-300 break-all">{fieldValue(k, d.new)}</td>
            </tr>;
        })}
    </tbody></table>;
}

export default function OversightPage() {
    const { employeeRole, loading: authLoading } = useAuth();
    const isAdmin = employeeRole === "Owner" || employeeRole === "Admin";
    const canView = isAdmin || employeeRole === "BranchManager";

    const today = baghdadDay();
    const [from, setFrom] = useState(() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 6); return baghdadDay(d); });
    const [to, setTo] = useState(today);
    const [actor, setActor] = useState("");
    const [action, setAction] = useState("");
    const [table, setTable] = useState("");
    const [branch, setBranch] = useState("");
    const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
    const [actors, setActors] = useState<Actor[]>([]);
    const [entries, setEntries] = useState<Entry[]>([]);
    const [more, setMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState("");
    const [open, setOpen] = useState<Record<number, boolean>>({});

    useEffect(() => {
        if (!isAdmin) return;
        supabase.from("branches").select("id, name").order("name").then(({ data }) => setBranches(data || []));
    }, [isAdmin]);
    const branchNames = useMemo(() => Object.fromEntries(branches.map(b => [b.id, b.name])), [branches]);

    const range = useMemo(() => ({ p_from: from ? dayStart(from) : null, p_to: to ? dayStart(nextDay(to)) : null }), [from, to]);
    const listArgs = useCallback((offset: number) => ({
        ...range,
        p_actor: actor || null, p_branch: branch || null, p_action: action || null, p_table: table || null,
        p_limit: PAGE, p_offset: offset,
    }), [range, actor, branch, action, table]);

    // What is on screen belongs to fetchedKey; while it differs from the filters, show the spinner.
    const [tick, setTick] = useState(0);
    const [fetchedKey, setFetchedKey] = useState("");
    const fetchKey = JSON.stringify([listArgs(0), tick]);
    const loading = fetchedKey !== fetchKey;

    useEffect(() => {
        if (!canView) return;
        let cancelled = false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the audit functions are not in the generated types yet
        const rpc = (supabase as any).rpc.bind(supabase);
        Promise.all([
            rpc("audit_log_actors", { ...range, p_branch: branch || null }),
            rpc("audit_log_list", listArgs(0)),
        ]).then(([a, l]) => {
            if (cancelled) return;
            if (a.error || l.error) {
                const msg = (a.error || l.error).message || "";
                setError(/audit_log|function|schema cache/i.test(msg) ? "سجل الرقابة غير مفعّل بعد على قاعدة البيانات." : msg.includes("غير مصرح") ? "غير مصرح." : "تعذّر تحميل السجل.");
                setActors([]); setEntries([]); setMore(false);
            } else {
                const rows: Entry[] = l.data || [];
                setError(""); setActors(a.data || []); setEntries(rows); setMore(rows.length === PAGE);
            }
            setOpen({});
            setFetchedKey(fetchKey);
        });
        return () => { cancelled = true; };
    }, [canView, fetchKey, range, branch, listArgs]);

    const loadMore = async () => {
        setLoadingMore(true);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
        const { data, error: err } = await (supabase as any).rpc("audit_log_list", listArgs(entries.length));
        if (!err) { const rows: Entry[] = data || []; setEntries(e => [...e, ...rows]); setMore(rows.length === PAGE); }
        setLoadingMore(false);
    };

    if (authLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;
    if (!canView) return <div className="min-h-screen flex items-center justify-center" dir="rtl"><div className="glass-card p-8 rounded-2xl">غير مصرح.</div></div>;

    const totalDeletes = actors.reduce((s, a) => s + Number(a.deletes || 0), 0);
    const quick = (days: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - (days - 1)); setFrom(baghdadDay(d)); setTo(today); };

    return <main className="min-h-screen p-5 md:p-8 font-ibm" dir="rtl"><div className="max-w-6xl mx-auto space-y-5">
        <header className="glass-card p-6 rounded-2xl flex flex-wrap items-end justify-between gap-4">
            <div className="flex items-center gap-4"><div className="w-14 h-14 rounded-2xl bg-rose-500/10 text-rose-400 flex items-center justify-center shrink-0"><ShieldAlert size={28} /></div>
                <div><h1 className="text-2xl font-bold">الرقابة الإدارية</h1><p className="text-muted-foreground text-sm">كل حساب شنو حذف أو عدّل: الفواتير والخصومات، المخزن، الحسابات والصلاحيات. السجل يكتبه النظام وحده، ولا أحد يقدر يعدّله أو يمسحه.</p></div></div>
            <button onClick={() => setTick(t => t + 1)} className="px-4 py-2.5 rounded-xl bg-card border border-border flex items-center gap-2 text-sm hover:border-rose-500/40"><RefreshCw size={15} />تحديث</button>
        </header>

        <section className="glass-card p-5 rounded-2xl flex flex-wrap items-end gap-3">
            <label className="text-sm">من<input type="date" className="input-field w-full mt-1" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} /></label>
            <label className="text-sm">إلى<input type="date" className="input-field w-full mt-1" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} /></label>
            <div className="flex gap-1.5">
                {[["اليوم", 1], ["7 أيام", 7], ["30 يوم", 30]].map(([l, d]) => <button key={l} onClick={() => quick(d as number)} className="px-3 py-2.5 rounded-xl bg-card border border-border text-xs hover:border-rose-500/40">{l}</button>)}
            </div>
            {isAdmin && <label className="text-sm">الفرع<select className="input-field w-full mt-1" value={branch} onChange={e => setBranch(e.target.value)}><option value="">كل الفروع</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
            <label className="text-sm">العملية<select className="input-field w-full mt-1" value={action} onChange={e => setAction(e.target.value)}><option value="">الكل</option>{Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
            <label className="text-sm">القسم<select className="input-field w-full mt-1" value={table} onChange={e => setTable(e.target.value)}><option value="">الكل</option>{Object.entries(TABLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="text-sm">الحساب<select className="input-field w-full mt-1 min-w-40" value={actor} onChange={e => setActor(e.target.value)}><option value="">كل الحسابات</option>{actors.map(a => <option key={a.actor_id || SYSTEM} value={a.actor_id || SYSTEM}>{a.actor_name || "النظام"}</option>)}</select></label>
        </section>

        {error ? <div className="glass-card p-6 rounded-2xl text-center text-sm text-rose-300">{error}</div>
        : loading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin" /></div> : <>
            <section className="glass-card rounded-2xl overflow-hidden">
                <div className="p-5 border-b border-border flex flex-wrap justify-between gap-2"><h2 className="font-bold text-lg">الحسابات بالفترة</h2>
                    <span className="text-xs text-muted-foreground">{actors.length} حساب • {totalDeletes} عملية حذف</span></div>
                {actors.length === 0 ? <div className="text-center text-sm text-muted-foreground py-8">ماكو أي حذف أو تعديل مسجّل بهالفترة.</div>
                : <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">{actors.map(a => {
                    const key = a.actor_id || SYSTEM, sel = actor === key;
                    return <button key={key} onClick={() => setActor(sel ? "" : key)} className={`text-right p-4 rounded-xl border transition-colors ${sel ? "border-rose-500/60 bg-rose-500/10" : "border-border bg-card hover:border-rose-500/30"}`}>
                        <div className="flex items-center gap-2"><UserRound size={16} className="text-muted-foreground shrink-0" /><span className="font-bold truncate">{a.actor_name || "النظام"}</span>
                            {a.actor_role && <span className="text-[11px] text-muted-foreground">{ROLES[a.actor_role] || a.actor_role}</span>}</div>
                        <div className="flex gap-4 mt-3 text-sm">
                            <span className={Number(a.deletes) > 0 ? "text-rose-400 font-bold" : "text-muted-foreground"}><Trash2 size={13} className="inline ml-1" />{a.deletes} حذف</span>
                            <span className="text-muted-foreground">{a.others} تعديل</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-2">آخر عملية: {fmtTime(a.last_at)}</div>
                    </button>;
                })}</div>}
            </section>

            <section className="glass-card rounded-2xl overflow-hidden">
                <div className="p-5 border-b border-border"><h2 className="font-bold text-lg">السجل</h2></div>
                {entries.length === 0 ? <div className="text-center text-sm text-muted-foreground py-8">لا توجد عمليات تطابق الفلتر.</div>
                : <ul className="divide-y divide-border">{entries.map(e => {
                    const act = ACTIONS[e.action] || { label: e.action, cls: "bg-muted text-foreground border-border" };
                    const isOpen = !!open[e.id];
                    return <li key={e.id} className="p-4">
                        <button className="w-full text-right flex flex-wrap items-start gap-x-3 gap-y-1.5" onClick={() => setOpen(o => ({ ...o, [e.id]: !o[e.id] }))}>
                            <span className={`px-2 py-0.5 rounded-lg border text-xs font-bold shrink-0 ${act.cls}`}>{act.label}</span>
                            <span className="text-xs text-muted-foreground shrink-0 pt-0.5">{TABLES[e.table_name] || e.table_name}</span>
                            <span className="flex-1 min-w-[12rem] text-sm font-bold break-words">{e.summary || "—"}{e.via === "cascade" && <span className="font-normal text-xs text-muted-foreground"> (انحذف ويه حذف السجل الأصلي)</span>}</span>
                            {isOpen ? <ChevronUp size={16} className="text-muted-foreground shrink-0" /> : <ChevronDown size={16} className="text-muted-foreground shrink-0" />}
                            <span className="basis-full text-xs text-muted-foreground">
                                <b className="text-foreground">{e.actor_name || "النظام"}</b>{e.actor_role ? ` (${ROLES[e.actor_role] || e.actor_role})` : ""} • {fmtTime(e.at)}{e.branch_name ? ` • ${e.branch_name}` : ""}
                            </span>
                        </button>
                        {isOpen && <div className="mt-3 p-3 rounded-xl bg-muted/20 border border-border/60"><Details e={e} branches={branchNames} /></div>}
                    </li>;
                })}</ul>}
                {more && <div className="p-4 border-t border-border flex justify-center">
                    <button onClick={loadMore} disabled={loadingMore} className="px-5 py-2 rounded-xl bg-card border border-border text-sm flex items-center gap-2 disabled:opacity-50">{loadingMore && <Loader2 size={14} className="animate-spin" />}عرض المزيد</button></div>}
            </section>
        </>}
    </div></main>;
}
