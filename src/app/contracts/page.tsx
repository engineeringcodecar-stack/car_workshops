"use client";

// العقود الحكومية — e.g. عقود محافظة ميسان.
//
// This tab IS the customer registry (سجل العملاء والمركبات), same list, same customer
// file, same everything, holding only the contract's customers and orders. The only
// thing on top is the contract's balance, which is why the tab exists (نظام الآجل):
//   المستحق  = Σ net of its CLOSED invoices (lib/contracts invoiceMoney)
//   الواصل   = Σ paid when each invoice was closed + Σ payments recorded here
//   المتبقي  = المستحق − الواصل
//
// No realtime on the balance on purpose: the database recently fell over under
// realtime load, and a balance is fine with a refresh button.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { Landmark, Car, FileText, Wallet, Loader2, RefreshCcw, Download, Plus, Trash2, Clock, ShoppingCart, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthProvider";
import { useContracts, invoiceMoney, type Contract } from "@/lib/contracts";
import { withCommas, digitsOnly } from "@/lib/format";
import { showSuccess, showError, showConfirm } from "@/lib/alerts";
import CustomersRegistry from "../customers/CustomersRegistry";

type Joined<T> = T | T[] | null;

type Row = {
    id: string;
    report_number: number;
    status: string;
    order_type: string | null;
    created_at: string;
    total_price: number | null;
    vehicle_id: string | null;
    pricing: Record<string, unknown> | null;
    is_insp: string | null;
    sale_customer: string | null;
    vehicles: Joined<{ make: string | null; model: string | null; plate_number: string | null; clients: Joined<{ name: string | null }> }>;
    branches: Joined<{ name: string }>;
};

type Payment = {
    id: string;
    branch_id: string | null;
    amount: number;
    paid_at: string;
    note: string | null;
    created_by: string | null;
    branches: Joined<{ name: string }>;
};

// Only the slices of the payload the balance needs, never the whole selected_services.
const ROW_SELECT = `id, report_number, status, order_type, created_at, total_price, vehicle_id,
    pricing:selected_services->0->pricing,
    is_insp:selected_services->0->>isComprehensiveInspection,
    sale_customer:selected_services->0->>customerName,
    vehicles(make, model, plate_number, clients(name)),
    branches(name)`;

const one = <T,>(v: Joined<T> | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const fmtMoney = (n: number) => Math.round(n).toLocaleString("en-US");
const todayIraq = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
// DD/MM/YYYY in Iraq time; a bare YYYY-MM-DD date is shown as-is.
const fmtDate = (iso: string) => {
    const bare = iso.length === 10;
    const d = new Date(bare ? `${iso}T00:00:00Z` : new Date(iso).getTime() + 3 * 3600 * 1000);
    return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
};

export default function ContractsPage() {
    const { employeeRole, allowedPages, loading: authLoading } = useAuth();
    const isAdmin = employeeRole === "Owner" || employeeRole === "Admin";
    const isAuthorized = isAdmin || (Array.isArray(allowedPages) && allowedPages.includes("contracts"));
    const contracts = useContracts();
    const [pickedId, setPickedId] = useState("");
    const contract = contracts.find(c => c.id === (pickedId || contracts[0]?.id)) || null;

    // Guards live here, not in the registry: the registry must never render without a
    // contract, or it would fall back to showing the ordinary customers on this tab.
    if (authLoading || (isAuthorized && !contract)) {
        return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="animate-spin text-amber-500 w-12 h-12" /></div>;
    }
    if (!isAuthorized || !contract) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center p-4 text-center font-ibm" dir="rtl">
                <div className="glass-card p-8 rounded-3xl border border-rose-500/20 max-w-md w-full">
                    <h2 className="text-2xl font-bold text-rose-500 mb-2">غير مصرح بالوصول</h2>
                    <p className="text-muted-foreground">تبويب العقود يُمنح من الإعدادات ← صلاحيات التبويبات.</p>
                </div>
            </div>
        );
    }

    return (
        <CustomersRegistry
            key={contract.id}
            contract={contract}
            topSlot={<ContractBalance contract={contract} contracts={contracts} onPick={setPickedId} />}
        />
    );
}

function ContractBalance({ contract, contracts, onPick }: { contract: Contract; contracts: Contract[]; onPick: (id: string) => void }) {
    const { employeeRole, employeeBranchId, employeeName } = useAuth();
    const isAdmin = employeeRole === "Owner" || employeeRole === "Admin";
    // A branch-pinned employee sees their branch's share; Owner/Admin see the whole contract.
    const scopeBranch = employeeBranchId && !isAdmin ? employeeBranchId : null;

    const [rows, setRows] = useState<Row[]>([]);
    const [payments, setPayments] = useState<Payment[]>([]);
    const [loading, setLoading] = useState(true);
    const [reloadKey, setReloadKey] = useState(0);
    const [showPayments, setShowPayments] = useState(false);

    useEffect(() => {
        let alive = true;
        (async () => {
            const all: Row[] = [];
            for (let from = 0; ; from += 1000) {
                let q = supabase.from("inspection_reports").select(ROW_SELECT)
                    .eq("contract_id", contract.id)
                    .order("created_at", { ascending: false })
                    .range(from, from + 999);
                if (scopeBranch) q = q.eq("branch_id", scopeBranch);
                const { data, error } = await q;
                if (error) { showError("خطأ", error.message); break; }
                const page = (data || []) as unknown as Row[];
                all.push(...page);
                if (page.length < 1000) break;
            }
            let pq = supabase.from("contract_payments")
                .select("id, branch_id, amount, paid_at, note, created_by, branches(name)")
                .eq("contract_id", contract.id)
                .order("paid_at", { ascending: false })
                .order("created_at", { ascending: false });
            if (scopeBranch) pq = pq.eq("branch_id", scopeBranch);
            const { data: pays } = await pq;
            if (!alive) return;
            setRows(all);
            setPayments((pays || []) as unknown as Payment[]);
            setLoading(false);
        })();
        return () => { alive = false; };
    }, [contract.id, scopeBranch, reloadKey]);

    const refresh = useCallback(() => { setLoading(true); setReloadKey(k => k + 1); }, []);

    const summary = useMemo(() => {
        const cars = new Set<string>();
        let due = 0, atClose = 0, pendingCount = 0, pendingAmount = 0;
        for (const r of rows) {
            const m = invoiceMoney({ status: r.status, total_price: r.total_price, pricing: r.pricing });
            if (m.state === "cancelled") continue;
            if (r.vehicle_id) cars.add(r.vehicle_id);
            if (m.state === "closed") { due += m.net; atClose += m.received; }
            else if (m.state === "pending" && r.is_insp !== "true") { pendingCount++; pendingAmount += m.net; }
        }
        const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
        return { cars: cars.size, due, atClose, paid, received: atClose + paid, remaining: due - atClose - paid, pendingCount, pendingAmount };
    }, [rows, payments]);

    const exportStatement = () => {
        const wb = XLSX.utils.book_new();
        wb.Workbook = { Views: [{ RTL: true }] };
        const s1 = XLSX.utils.aoa_to_sheet([
            ["كشف حساب عقد", contract.name],
            ["تاريخ الكشف", fmtDate(todayIraq())],
            [],
            ["عدد السيارات", summary.cars],
            ["إجمالي المستحق (فواتير مغلقة)", summary.due],
            ["الواصل عند إغلاق الفواتير", summary.atClose],
            ["الدفعات المسجلة", summary.paid],
            ["إجمالي الواصل", summary.received],
            ["المتبقي على الجهة", summary.remaining],
            ["فواتير بانتظار المحاسبة (غير محتسبة)", `${summary.pendingCount} / ${fmtMoney(summary.pendingAmount)}`],
        ]);
        s1["!cols"] = [{ wch: 36 }, { wch: 28 }];
        XLSX.utils.book_append_sheet(wb, s1, "الملخص");
        const inv = [...rows].reverse().map((r, i) => {
            const m = invoiceMoney({ status: r.status, total_price: r.total_price, pricing: r.pricing });
            const v = one(r.vehicles);
            return {
                "التسلسل": i + 1, "رقم الأمر": r.report_number, "التاريخ": fmtDate(r.created_at),
                "الفرع": one(r.branches)?.name || "",
                "السيارة": r.order_type === "sale" ? "بيع مواد" : `${v?.make || ""} ${v?.model || ""}`.trim(),
                "رقم اللوحة": v?.plate_number || "",
                "السائق": r.order_type === "sale" ? (r.sale_customer || "") : (one(v?.clients)?.name || ""),
                "الصافي": m.state === "closed" ? m.net : "",
                "الواصل عند الإغلاق": m.state === "closed" ? m.received : "",
                "تقديري (غير مُحاسَب)": m.state === "pending" ? m.net : "",
            };
        });
        const s2 = XLSX.utils.json_to_sheet(inv);
        s2["!cols"] = [{ wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 22 }, { wch: 16 }, { wch: 20 }, { wch: 14 }, { wch: 16 }, { wch: 18 }];
        XLSX.utils.book_append_sheet(wb, s2, "الفواتير");
        const s3 = XLSX.utils.json_to_sheet([...payments].reverse().map(p => ({
            "التاريخ": fmtDate(p.paid_at), "المبلغ": Number(p.amount), "الفرع": one(p.branches)?.name || "عام",
            "ملاحظات": p.note || "", "سجّلها": p.created_by || "",
        })));
        s3["!cols"] = [{ wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 18 }];
        XLSX.utils.book_append_sheet(wb, s3, "الدفعات");
        XLSX.writeFile(wb, `كشف_حساب_${contract.name}_${todayIraq()}.xlsx`);
    };

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Card label="عدد السيارات" value={loading ? "…" : String(summary.cars)} icon={<Car size={18} />} tone="text-blue-400 bg-blue-500/10 border-blue-500/20" />
                <Card label="إجمالي المستحق" value={loading ? "…" : `${fmtMoney(summary.due)} د.ع`} sub="فواتير مغلقة في التدقيق" icon={<FileText size={18} />} tone="text-amber-400 bg-amber-500/10 border-amber-500/20" />
                <Card label="المبلغ الواصل" value={loading ? "…" : `${fmtMoney(summary.received)} د.ع`} sub={`عند الإغلاق ${fmtMoney(summary.atClose)} + دفعات ${fmtMoney(summary.paid)}`} icon={<Wallet size={18} />} tone="text-emerald-400 bg-emerald-500/10 border-emerald-500/20" />
                <Card label={summary.remaining < 0 ? "رصيد لصالح الجهة" : "المبلغ المتبقي"} value={loading ? "…" : `${fmtMoney(Math.abs(summary.remaining))} د.ع`}
                    sub={summary.pendingCount ? `${summary.pendingCount} فاتورة بانتظار المحاسبة (${fmtMoney(summary.pendingAmount)})` : undefined}
                    icon={<Landmark size={18} />} tone={summary.remaining > 0 ? "text-rose-400 bg-rose-500/10 border-rose-500/20" : "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
                {contracts.length > 1 && (
                    <select value={contract.id} onChange={e => onPick(e.target.value)}
                        className="bg-card border border-amber-500/40 rounded-xl px-3 py-2 text-sm font-bold text-amber-300 cursor-pointer">
                        {contracts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                )}
                <button onClick={() => setShowPayments(true)} className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold flex items-center gap-2">
                    <Wallet size={15} /> الدفعات ({payments.length})
                </button>
                <button onClick={exportStatement} disabled={loading} className="px-4 py-2 rounded-xl bg-card border border-border hover:bg-muted text-sm font-bold flex items-center gap-2 disabled:opacity-60">
                    <Download size={15} /> كشف حساب (Excel)
                </button>
                <Link href={`/reception?contract=${contract.id}&sale=1`} className="px-4 py-2 rounded-xl bg-card border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 text-sm font-bold flex items-center gap-2">
                    <ShoppingCart size={15} /> بيع مواد
                </Link>
                <button onClick={refresh} className="px-3 py-2 rounded-xl bg-card border border-border hover:bg-muted text-sm font-bold flex items-center gap-2" title="تحديث الرصيد">
                    <RefreshCcw size={14} className={loading ? "animate-spin" : ""} /> تحديث
                </button>
                {summary.pendingCount > 0 && (
                    <span className="text-xs text-indigo-300 flex items-center gap-1"><Clock size={13} /> الفواتير غير المُحاسَبة تُضاف للمستحق عند إغلاقها في <Link href="/audit" className="underline font-bold">التدقيق</Link></span>
                )}
            </div>
            {showPayments && (
                <PaymentsModal contract={contract} payments={payments} total={summary.paid} canDelete={isAdmin}
                    pinnedBranch={scopeBranch} employeeName={employeeName} onClose={() => setShowPayments(false)} onChanged={refresh} />
            )}
        </div>
    );
}

function Card({ label, value, sub, icon, tone }: { label: string; value: string; sub?: string; icon: React.ReactNode; tone: string }) {
    return (
        <div className="glass-card p-4 rounded-2xl border border-border">
            <div className="flex items-start justify-between gap-2 mb-1">
                <span className="text-xs md:text-sm text-muted-foreground font-bold">{label}</span>
                <span className={`w-8 h-8 rounded-xl border flex items-center justify-center shrink-0 ${tone}`}>{icon}</span>
            </div>
            <div className="text-lg md:text-2xl font-black" dir="ltr" style={{ textAlign: "right" }}>{value}</div>
            {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
        </div>
    );
}

function PaymentsModal({ contract, payments, total, canDelete, pinnedBranch, employeeName, onClose, onChanged }: {
    contract: Contract; payments: Payment[]; total: number; canDelete: boolean;
    pinnedBranch: string | null; employeeName: string | null; onClose: () => void; onChanged: () => void;
}) {
    const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
    const [amount, setAmount] = useState("");
    const [paidAt, setPaidAt] = useState(todayIraq());
    const [branchId, setBranchId] = useState("");
    const [note, setNote] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        supabase.from("branches").select("id, name").order("name").then(({ data }) => { if (data) setBranches(data); });
    }, []);

    const add = async () => {
        const n = Number(amount || 0);
        if (!n) { showError("تنبيه", "أدخل مبلغ الدفعة."); return; }
        if (!paidAt) { showError("تنبيه", "اختر تاريخ الدفعة."); return; }
        setSaving(true);
        const { error } = await supabase.from("contract_payments").insert({
            contract_id: contract.id,
            branch_id: (pinnedBranch || branchId) || null,
            amount: n, paid_at: paidAt, note: note.trim() || null, created_by: employeeName || null,
        });
        setSaving(false);
        if (error) { showError("خطأ", error.message); return; }
        showSuccess("تم تسجيل الدفعة", `${fmtMoney(n)} د.ع على عقد ${contract.name}.`);
        setAmount(""); setNote(""); setPaidAt(todayIraq());
        onChanged();
    };

    const remove = async (p: Payment) => {
        const ok = await showConfirm("حذف الدفعة", `حذف دفعة بمبلغ ${fmtMoney(Number(p.amount))} د.ع بتاريخ ${fmtDate(p.paid_at)}؟ سيرتفع المتبقي بنفس المبلغ.`, "حذف", true);
        if (!ok) return;
        const { error } = await supabase.from("contract_payments").delete().eq("id", p.id);
        if (error) { showError("خطأ", error.message); return; }
        showSuccess("تم الحذف", "حُذفت الدفعة.");
        onChanged();
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 md:p-6" dir="rtl" onClick={onClose}>
            <div className="bg-background border border-border rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-y-auto p-4 md:p-6 space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold flex items-center gap-2"><Wallet className="text-emerald-400" size={20} /> دفعات عقد {contract.name}</h2>
                    <button onClick={onClose} className="p-2 rounded-xl bg-muted hover:bg-rose-500 hover:text-white border border-border"><X size={18} /></button>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="glass-card p-4 rounded-2xl border border-emerald-500/20 space-y-3 h-max">
                        <h3 className="font-bold flex items-center gap-2 text-sm"><Plus size={15} className="text-emerald-400" /> تسجيل دفعة من الجهة</h3>
                        <input inputMode="numeric" dir="ltr" value={withCommas(amount)} onChange={e => setAmount(digitsOnly(e.target.value))} placeholder="المبلغ (د.ع)" className="input-field text-right font-bold" />
                        <input type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)} className="input-field" />
                        {!pinnedBranch && (
                            <select value={branchId} onChange={e => setBranchId(e.target.value)} className="input-field cursor-pointer">
                                <option value="">الفرع المستلِم: عام (الشركة)</option>
                                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                        )}
                        <input value={note} onChange={e => setNote(e.target.value)} placeholder="ملاحظات (رقم الصك، الفترة...)" className="input-field" />
                        <button onClick={add} disabled={saving} className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-60">
                            {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} حفظ الدفعة
                        </button>
                    </div>
                    <div className="lg:col-span-2 glass-card rounded-2xl border border-border/50 overflow-x-auto">
                        {payments.length === 0 ? (
                            <div className="p-8 text-center text-muted-foreground text-sm">لم تُسجَّل أي دفعة بعد.</div>
                        ) : (
                            <table className="w-full text-sm text-right min-w-[520px]">
                                <thead className="bg-muted/40 text-muted-foreground text-xs">
                                    <tr><th className="p-3">التاريخ</th><th className="p-3">المبلغ</th><th className="p-3">الفرع</th><th className="p-3">ملاحظات</th><th className="p-3">سجّلها</th><th className="p-3"></th></tr>
                                </thead>
                                <tbody>
                                    {payments.map(p => (
                                        <tr key={p.id} className="border-t border-border/50">
                                            <td className="p-3">{fmtDate(p.paid_at)}</td>
                                            <td className="p-3 font-bold text-emerald-400">{fmtMoney(Number(p.amount))}</td>
                                            <td className="p-3 text-muted-foreground">{one(p.branches)?.name || "عام"}</td>
                                            <td className="p-3">{p.note || "—"}</td>
                                            <td className="p-3 text-muted-foreground">{p.created_by || "—"}</td>
                                            <td className="p-3">{canDelete && (
                                                <button onClick={() => remove(p)} title="حذف الدفعة" className="p-2 rounded-lg bg-muted hover:bg-rose-500/20 border border-border text-rose-400"><Trash2 size={14} /></button>
                                            )}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot className="bg-muted/30 text-xs font-bold">
                                    <tr className="border-t border-border"><td className="p-3">المجموع</td><td className="p-3 text-emerald-400">{fmtMoney(total)}</td><td className="p-3" colSpan={4}></td></tr>
                                </tfoot>
                            </table>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
