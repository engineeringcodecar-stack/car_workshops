"use client";

// العقود الحكومية — e.g. عقود محافظة ميسان.
//
// A contracted body's cars come to our branches and go through the normal flow:
// reception → ساحة الورشة → التدقيق. Each of its orders is tagged with contract_id
// at reception, and this tab gathers everything tagged: its cars, its work orders,
// its comprehensive inspections, the payments it has made, and the running balance.
//
// Money follows the audit page exactly (see invoiceMoney in lib/contracts):
//   المستحق  = Σ net of its CLOSED invoices
//   الواصل   = Σ paid when each invoice was closed + Σ payments recorded here
//   المتبقي  = المستحق − الواصل
// Invoices not yet closed in التدقيق are shown on their own, and not yet owed.
//
// No realtime subscription on purpose: the database recently fell over under
// realtime load, and a statement page is fine with a manual refresh.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import {
    Landmark, Car, FileText, ClipboardCheck, Wallet, Loader2, RefreshCcw, Download,
    Plus, Trash2, Printer, ExternalLink, Search, X, Clock,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthProvider";
import { useContracts, invoiceMoney } from "@/lib/contracts";
import { withCommas, digitsOnly } from "@/lib/format";
import { showSuccess, showError, showConfirm } from "@/lib/alerts";

type Kind = "maintenance" | "inspection" | "sale";
type Tab = "vehicles" | "orders" | "inspections" | "payments";

type Joined<T> = T | T[] | null;

type RawRow = {
    id: string;
    report_number: number;
    status: string;
    order_type: string | null;
    created_at: string;
    completed_at: string | null;
    total_price: number | null;
    branch_id: string | null;
    vehicle_id: string | null;
    pricing: Record<string, unknown> | null;
    is_insp: string | null;
    ci_flag: string | null;
    ci_pct: string | null;
    ci_rating: string | null;
    sale_customer: string | null;
    vehicles: Joined<{
        id: string; make: string | null; model: string | null; plate_number: string | null;
        clients: Joined<{ name: string | null; phone: string | null }>;
    }>;
    branches: Joined<{ name: string }>;
};

type Row = RawRow & {
    kind: Kind;
    hasInspection: boolean;
    money: ReturnType<typeof invoiceMoney>;
    vehicleLabel: string;
    plate: string;
    driver: string;
    phone: string;
    branchName: string;
};

type Payment = {
    id: string;
    contract_id: string;
    branch_id: string | null;
    amount: number;
    paid_at: string;
    note: string | null;
    created_by: string | null;
    created_at: string;
    branches: Joined<{ name: string }>;
};

// Only the slices of the JSON payload this page needs — never the whole
// selected_services blob, which is the heaviest column in the database.
const ROW_SELECT = `id, report_number, status, order_type, created_at, completed_at, total_price, branch_id, vehicle_id,
    pricing:selected_services->0->pricing,
    is_insp:selected_services->0->>isComprehensiveInspection,
    ci_flag:selected_services->0->comprehensiveInspection->>isComprehensiveInspection,
    ci_pct:selected_services->0->comprehensiveInspection->>percentage,
    ci_rating:selected_services->0->comprehensiveInspection->>rating,
    sale_customer:selected_services->0->>customerName,
    vehicles(id, make, model, plate_number, clients(name, phone)),
    branches(name)`;

const PAGE = 1000;

const one = <T,>(v: Joined<T> | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const fmtMoney = (n: number) => Math.round(n).toLocaleString("en-US");

// DD/MM/YYYY in Iraq time (UTC+3), whatever the device clock says.
const fmtDate = (iso?: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
    if (isNaN(d.getTime())) return "—";
    const iraq = iso.length === 10 ? d : new Date(d.getTime() + 3 * 3600 * 1000);
    const dd = String(iraq.getUTCDate()).padStart(2, "0");
    const mm = String(iraq.getUTCMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${iraq.getUTCFullYear()}`;
};
const iraqDay = (iso: string) => new Date(new Date(iso).getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);
const todayIraq = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);

function enrich(r: RawRow): Row {
    const v = one(r.vehicles);
    const c = one(v?.clients);
    const kind: Kind = r.order_type === "sale" ? "sale" : r.is_insp === "true" ? "inspection" : "maintenance";
    return {
        ...r,
        kind,
        hasInspection: r.is_insp === "true" || r.ci_flag === "true",
        money: invoiceMoney({ status: r.status, total_price: r.total_price, pricing: r.pricing }),
        vehicleLabel: kind === "sale" ? "بيع مواد" : `${v?.make || ""} ${v?.model || ""}`.trim() || "—",
        plate: v?.plate_number || "",
        driver: kind === "sale" ? (r.sale_customer || "") : (c?.name || ""),
        phone: c?.phone || "",
        branchName: one(r.branches)?.name || "",
    };
}

const KIND_LABEL: Record<Kind, string> = { maintenance: "صيانة", inspection: "فحص شامل", sale: "بيع مواد" };

function statusChip(r: Row): { text: string; cls: string } {
    if (r.money.state === "cancelled") return { text: "ملغى", cls: "bg-muted text-muted-foreground border-border" };
    if (r.money.state === "excluded") return { text: "مستبعدة من المحاسبة", cls: "bg-muted text-muted-foreground border-border" };
    if (r.kind === "inspection") return { text: "فحص منجز", cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" };
    if (r.money.state === "closed") return { text: "مُحاسَبة", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" };
    if (r.status === "تم الانتهاء") return { text: "بانتظار المحاسبة", cls: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" };
    if (r.status === "قيد العمل") return { text: "قيد العمل", cls: "bg-amber-500/10 text-amber-400 border-amber-500/20" };
    return { text: "بالانتظار", cls: "bg-sky-500/10 text-sky-400 border-sky-500/20" };
}

export default function ContractsPage() {
    const { employeeRole, employeeBranchId, allowedPages, employeeName, loading: authLoading } = useAuth();
    const isAdmin = employeeRole === "Owner" || employeeRole === "Admin";
    // Credit money: Owner/Admin always; anyone else only when granted the tab in
    // الإعدادات → صلاحيات التبويبات.
    const isAuthorized = isAdmin || (Array.isArray(allowedPages) && allowedPages.includes("contracts"));
    const isBranchPinned = !!employeeBranchId && !isAdmin;

    // ---------- Which contract ----------
    const contracts = useContracts();
    const [pickedContractId, setPickedContractId] = useState("");
    const contractId = pickedContractId || contracts[0]?.id || "";
    const contract = contracts.find(c => c.id === contractId) || null;

    // ---------- Branch filter ("" = كل الفروع) ----------
    const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
    const [branchFilter, setBranchFilter] = useState("");
    const activeBranchId = isBranchPinned ? employeeBranchId : (branchFilter || null);
    const activeBranchName = activeBranchId ? (branches.find(b => b.id === activeBranchId)?.name || "") : "كل الفروع";

    useEffect(() => {
        supabase.from("branches").select("id, name").order("name")
            .then(({ data }) => { if (data) setBranches(data); });
    }, []);

    // ---------- Data ----------
    const [rows, setRows] = useState<Row[]>([]);
    const [payments, setPayments] = useState<Payment[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!contractId) return;
        setLoading(true);
        setLoadError(null);
        try {
            const all: RawRow[] = [];
            for (let from = 0; ; from += PAGE) {
                let q = supabase.from("inspection_reports").select(ROW_SELECT)
                    .eq("contract_id", contractId)
                    .order("created_at", { ascending: false })
                    .order("report_number", { ascending: false })
                    .range(from, from + PAGE - 1);
                if (activeBranchId) q = q.eq("branch_id", activeBranchId);
                const { data, error } = await q;
                if (error) throw error;
                const page = (data || []) as unknown as RawRow[];
                all.push(...page);
                if (page.length < PAGE) break;
            }

            let pq = supabase.from("contract_payments")
                .select("id, contract_id, branch_id, amount, paid_at, note, created_by, created_at, branches(name)")
                .eq("contract_id", contractId)
                .order("paid_at", { ascending: false })
                .order("created_at", { ascending: false });
            if (activeBranchId) pq = pq.eq("branch_id", activeBranchId);
            const { data: pays, error: pe } = await pq;
            if (pe) throw pe;

            setRows(all.map(enrich));
            setPayments((pays || []) as unknown as Payment[]);
        } catch (e) {
            console.error(e);
            setLoadError((e as Error).message || "تعذّر تحميل بيانات العقد.");
        } finally {
            setLoading(false);
        }
    }, [contractId, activeBranchId]);

    useEffect(() => {
        if (authLoading || !isAuthorized || !contractId) return;
        load();
    }, [authLoading, isAuthorized, contractId, load]);

    // ---------- Summary (all time, for the chosen branch scope) ----------
    // Cancelled orders vanish everywhere. An order "removed from accounting" in the
    // audit page only leaves the MONEY — it is still a real visit / inspection. (Staff
    // routinely remove zero-price standalone inspections from the audit queue.)
    const live = useMemo(() => rows.filter(r => r.money.state !== "cancelled"), [rows]);

    const summary = useMemo(() => {
        const vehicleIds = new Set<string>();
        let due = 0, receivedAtClose = 0, pendingCount = 0, pendingAmount = 0;
        let workOrders = 0, inspections = 0, sales = 0;
        for (const r of live) {
            if (r.vehicle_id) vehicleIds.add(r.vehicle_id);
            if (r.kind === "maintenance") workOrders++;
            if (r.kind === "sale") sales++;
            if (r.hasInspection) inspections++;
            if (r.money.state === "closed") {
                due += r.money.net;
                receivedAtClose += r.money.received;
            } else if (r.money.state === "pending" && r.kind !== "inspection") {
                // A standalone inspection carries no price — it isn't an unbilled invoice.
                pendingCount++;
                pendingAmount += r.money.net;
            }
        }
        const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
        const received = receivedAtClose + paid;
        return {
            cars: vehicleIds.size, workOrders, inspections, sales,
            due, receivedAtClose, paid, received, remaining: due - received,
            pendingCount, pendingAmount,
        };
    }, [live, payments]);

    // ---------- Tabs & filters ----------
    const [tab, setTab] = useState<Tab>("vehicles");
    const [search, setSearch] = useState("");
    const [vehicleFilter, setVehicleFilter] = useState<{ id: string; label: string } | null>(null);
    const [kindFilter, setKindFilter] = useState<"" | Kind>("");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");

    const q = search.trim().toLowerCase();
    const matches = (r: Row) => !q || [String(r.report_number), r.vehicleLabel, r.plate, r.driver, r.phone]
        .some(v => v && v.toLowerCase().includes(q));

    const vehicles = useMemo(() => {
        type V = {
            id: string; label: string; plate: string; driver: string; phone: string;
            visits: number; inspections: number; last: string; due: number; pending: number; branches: Set<string>;
        };
        const map = new Map<string, V>();
        // rows arrive newest-first, so the first row seen per car carries its latest driver.
        for (const r of live) {
            if (!r.vehicle_id) continue;
            let v = map.get(r.vehicle_id);
            if (!v) {
                v = {
                    id: r.vehicle_id, label: r.vehicleLabel, plate: r.plate, driver: r.driver, phone: r.phone,
                    visits: 0, inspections: 0, last: r.created_at, due: 0, pending: 0, branches: new Set(),
                };
                map.set(r.vehicle_id, v);
            }
            if (r.kind === "maintenance") v.visits++;
            if (r.hasInspection) v.inspections++;
            if (r.branchName) v.branches.add(r.branchName);
            if (r.money.state === "closed") v.due += r.money.net;
            else if (r.money.state === "pending" && r.kind !== "inspection") v.pending++;
        }
        return [...map.values()];
    }, [live]);

    const shownVehicles = vehicles.filter(v => !q || [v.label, v.plate, v.driver, v.phone].some(x => x && x.toLowerCase().includes(q)));

    const orders = useMemo(() => rows.filter(r =>
        r.kind !== "inspection"
        && (!kindFilter || r.kind === kindFilter)
        && (!vehicleFilter || r.vehicle_id === vehicleFilter.id)
        && (!dateFrom || iraqDay(r.created_at) >= dateFrom)
        && (!dateTo || iraqDay(r.created_at) <= dateTo)
    ), [rows, kindFilter, vehicleFilter, dateFrom, dateTo]);
    const shownOrders = orders.filter(matches);
    const ordersTotals = shownOrders.reduce((t, r) => {
        if (r.money.state === "closed") { t.net += r.money.net; t.received += r.money.received; }
        return t;
    }, { net: 0, received: 0 });

    const inspectionsList = live.filter(r => r.hasInspection
        && (!vehicleFilter || r.vehicle_id === vehicleFilter.id)
        && matches(r));

    const openVehicle = (id: string, label: string) => {
        setVehicleFilter({ id, label });
        setKindFilter("");
        setTab("orders");
    };

    // ---------- Payments ----------
    const [payAmount, setPayAmount] = useState("");
    const [payDate, setPayDate] = useState(todayIraq());
    const [payBranch, setPayBranch] = useState("");
    const [payNote, setPayNote] = useState("");
    const [savingPay, setSavingPay] = useState(false);

    const addPayment = async () => {
        const amount = Number(payAmount || 0);
        if (!contractId) return;
        if (!amount) { showError("تنبيه", "أدخل مبلغ الدفعة."); return; }
        if (!payDate) { showError("تنبيه", "اختر تاريخ الدفعة."); return; }
        setSavingPay(true);
        try {
            const { error } = await supabase.from("contract_payments").insert({
                contract_id: contractId,
                // A pinned employee's payment always belongs to their branch.
                branch_id: (isBranchPinned ? employeeBranchId : payBranch) || null,
                amount,
                paid_at: payDate,
                note: payNote.trim() || null,
                created_by: employeeName || null,
            });
            if (error) throw error;
            showSuccess("تم تسجيل الدفعة", `${fmtMoney(amount)} د.ع على عقد ${contract?.name || ""}.`);
            setPayAmount(""); setPayNote(""); setPayDate(todayIraq());
            load();
        } catch (e) {
            showError("خطأ", (e as Error).message || "تعذّر تسجيل الدفعة.");
        } finally {
            setSavingPay(false);
        }
    };

    const deletePayment = async (p: Payment) => {
        const ok = await showConfirm(
            "حذف الدفعة",
            `حذف دفعة بمبلغ ${fmtMoney(Number(p.amount))} د.ع بتاريخ ${fmtDate(p.paid_at)}؟ سيرتفع المتبقي على العقد بنفس المبلغ.`,
            "حذف",
            true,
        );
        if (!ok) return;
        const { error } = await supabase.from("contract_payments").delete().eq("id", p.id);
        if (error) { showError("خطأ", error.message); return; }
        showSuccess("تم الحذف", "حُذفت الدفعة.");
        load();
    };

    // ---------- Excel statement (كشف حساب) ----------
    const exportStatement = () => {
        const name = contract?.name || "العقد";
        const wb = XLSX.utils.book_new();
        wb.Workbook = { Views: [{ RTL: true }] };

        const period = dateFrom || dateTo ? `${dateFrom ? fmtDate(dateFrom) : "البداية"} — ${dateTo ? fmtDate(dateTo) : "اليوم"}` : "كل الفترات";
        const summarySheet = XLSX.utils.aoa_to_sheet([
            ["كشف حساب عقد", name],
            ["الفرع", activeBranchName],
            ["فترة الفواتير", period],
            ["تاريخ الكشف", fmtDate(todayIraq())],
            [],
            ["الرصيد الكلي للعقد (كل الفترات)"],
            ["عدد السيارات", summary.cars],
            ["أوامر العمل", summary.workOrders],
            ["الفحوصات الشاملة", summary.inspections],
            ["إجمالي المستحق (فواتير مغلقة)", summary.due],
            ["الواصل عند إغلاق الفواتير", summary.receivedAtClose],
            ["الدفعات المسجلة", summary.paid],
            ["إجمالي الواصل", summary.received],
            ["المتبقي على الجهة", summary.remaining],
            ["فواتير بانتظار المحاسبة (غير محتسبة)", `${summary.pendingCount} — ${fmtMoney(summary.pendingAmount)}`],
        ]);
        summarySheet["!cols"] = [{ wch: 36 }, { wch: 28 }];
        XLSX.utils.book_append_sheet(wb, summarySheet, "الملخص");

        const invoiceRows = [...orders].reverse().map((r, i) => ({
            "التسلسل": i + 1,
            "رقم الأمر": r.report_number,
            "التاريخ": fmtDate(r.created_at),
            "الفرع": r.branchName,
            "النوع": KIND_LABEL[r.kind],
            "السيارة": r.vehicleLabel,
            "رقم اللوحة": r.plate,
            "السائق": r.driver,
            "الحالة": statusChip(r).text,
            "الصافي": r.money.state === "closed" ? r.money.net : "",
            "الواصل عند الإغلاق": r.money.state === "closed" ? r.money.received : "",
            "المبلغ التقديري (غير مُحاسَب)": r.money.state === "pending" ? r.money.net : "",
        }));
        const invSheet = XLSX.utils.json_to_sheet(invoiceRows);
        invSheet["!cols"] = [{ wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 22 }, { wch: 14 }, { wch: 20 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 22 }];
        XLSX.utils.book_append_sheet(wb, invSheet, "الفواتير");

        const paySheet = XLSX.utils.json_to_sheet([...payments].reverse().map(p => ({
            "التاريخ": fmtDate(p.paid_at),
            "المبلغ": Number(p.amount),
            "الفرع": one(p.branches)?.name || "عام",
            "ملاحظات": p.note || "",
            "سجّلها": p.created_by || "",
        })));
        paySheet["!cols"] = [{ wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 18 }];
        XLSX.utils.book_append_sheet(wb, paySheet, "الدفعات");

        XLSX.writeFile(wb, `كشف_حساب_${name}_${todayIraq()}.xlsx`);
    };

    // ---------- Guards (after every hook) ----------
    if (authLoading) {
        return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="animate-spin text-amber-500 w-12 h-12" /></div>;
    }
    if (!isAuthorized) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center p-4 text-center font-ibm" dir="rtl">
                <div className="glass-card p-8 rounded-3xl border border-rose-500/20 max-w-md w-full">
                    <h2 className="text-2xl font-bold text-rose-500 mb-2">غير مصرح بالوصول</h2>
                    <p className="text-muted-foreground">تبويب العقود يُمنح من الإعدادات ← صلاحيات التبويبات.</p>
                </div>
            </div>
        );
    }

    const TABS: { key: Tab; label: string; icon: React.ReactNode; count: number }[] = [
        { key: "vehicles", label: "السيارات", icon: <Car size={16} />, count: vehicles.length },
        { key: "orders", label: "أوامر العمل والصيانة", icon: <FileText size={16} />, count: summary.workOrders + summary.sales },
        { key: "inspections", label: "الفحص الشامل", icon: <ClipboardCheck size={16} />, count: summary.inspections },
        { key: "payments", label: "الدفعات", icon: <Wallet size={16} />, count: payments.length },
    ];

    return (
        <div className="min-h-screen p-4 md:p-8 font-ibm" dir="rtl">
            <div className="max-w-7xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex flex-col lg:flex-row justify-between gap-4 lg:items-end">
                    <div>
                        <h1 className="text-3xl font-display font-bold text-foreground mb-2 flex items-center gap-3">
                            <Landmark className="text-amber-400" size={30} />
                            {contract ? `عقود ${contract.name}` : "العقود الحكومية"}
                        </h1>
                        <p className="text-muted-foreground text-sm">
                            سيارات الجهة وأوامر عملها وفحوصاتها ودفعاتها في مكان واحد — نظام الآجل.
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {contracts.length > 1 && (
                            <select value={contractId} onChange={e => { setPickedContractId(e.target.value); setVehicleFilter(null); }}
                                className="bg-card border border-amber-500/40 rounded-xl px-3 py-2.5 text-sm font-bold text-amber-300 cursor-pointer">
                                {contracts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        )}
                        {!isBranchPinned && branches.length > 1 && (
                            <select value={branchFilter} onChange={e => { setBranchFilter(e.target.value); setVehicleFilter(null); }}
                                className="bg-card border border-border rounded-xl px-3 py-2.5 text-sm text-foreground cursor-pointer">
                                <option value="">كل الفروع</option>
                                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                        )}
                        <button onClick={load} disabled={loading}
                            className="px-3 py-2.5 rounded-xl bg-card border border-border hover:bg-muted text-sm font-bold flex items-center gap-2 disabled:opacity-60" title="تحديث">
                            <RefreshCcw size={15} className={loading ? "animate-spin" : ""} /> تحديث
                        </button>
                        <button onClick={exportStatement} disabled={loading || !contract}
                            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-60">
                            <Download size={15} /> كشف حساب (Excel)
                        </button>
                    </div>
                </div>

                {contracts.length === 0 && !loading && (
                    <div className="glass-card p-8 rounded-3xl text-center text-muted-foreground">لا توجد عقود مفعّلة.</div>
                )}

                {loadError && (
                    <div className="glass-card p-4 rounded-2xl border border-rose-500/30 text-rose-400 text-sm">{loadError}</div>
                )}

                {/* Summary */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                    <StatCard label="عدد السيارات" value={summary.cars.toLocaleString("en-US")} sub={`${summary.workOrders} أمر عمل · ${summary.inspections} فحص شامل`} tone="blue" icon={<Car size={20} />} />
                    <StatCard label="إجمالي المستحق" value={fmtMoney(summary.due)} unit="د.ع" sub="فواتير مغلقة في التدقيق" tone="amber" icon={<FileText size={20} />} />
                    <StatCard label="المبلغ الواصل" value={fmtMoney(summary.received)} unit="د.ع" sub={`عند الإغلاق ${fmtMoney(summary.receivedAtClose)} + دفعات ${fmtMoney(summary.paid)}`} tone="emerald" icon={<Wallet size={20} />} />
                    <StatCard
                        label={summary.remaining < 0 ? "رصيد لصالح الجهة" : "المبلغ المتبقي"}
                        value={fmtMoney(Math.abs(summary.remaining))} unit="د.ع"
                        sub={summary.due > 0 ? `مسدَّد ${Math.min(100, Math.round((summary.received / summary.due) * 100))}%` : "—"}
                        tone={summary.remaining > 0 ? "rose" : "emerald"} icon={<Landmark size={20} />}
                    />
                </div>

                {summary.pendingCount > 0 && (
                    <div className="glass-card p-4 rounded-2xl border border-indigo-500/30 flex flex-wrap items-center gap-2 text-sm">
                        <Clock size={16} className="text-indigo-400" />
                        <span className="text-indigo-300 font-bold">{summary.pendingCount} فاتورة لم تُحاسَب بعد</span>
                        <span className="text-muted-foreground">بمبلغ تقديري {fmtMoney(summary.pendingAmount)} د.ع — تُضاف إلى المستحق عند إغلاقها في صفحة</span>
                        <Link href="/audit" className="text-indigo-300 underline font-bold">التدقيق والمحاسبة</Link>
                    </div>
                )}

                {/* Tabs */}
                <div className="flex gap-2 overflow-x-auto pb-1">
                    {TABS.map(t => (
                        <button key={t.key} onClick={() => setTab(t.key)}
                            className={`shrink-0 px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 border transition-colors ${tab === t.key
                                ? "bg-amber-500/15 text-amber-300 border-amber-500/40"
                                : "bg-card text-muted-foreground border-border hover:text-foreground"}`}>
                            {t.icon} {t.label}
                            <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-foreground">{t.count}</span>
                        </button>
                    ))}
                </div>

                {/* Shared search + active vehicle filter */}
                {tab !== "payments" && (
                    <div className="flex flex-col sm:flex-row gap-3">
                        <div className="relative flex-1">
                            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <input value={search} onChange={e => setSearch(e.target.value)}
                                placeholder="بحث برقم الأمر، السيارة، رقم اللوحة، أو اسم السائق..."
                                className="w-full bg-card border border-border rounded-xl py-2.5 pr-10 pl-3 text-sm focus:outline-none focus:border-amber-500/50" />
                        </div>
                        {vehicleFilter && tab !== "vehicles" && (
                            <button onClick={() => setVehicleFilter(null)}
                                className="px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm font-bold flex items-center gap-2">
                                السيارة: {vehicleFilter.label} <X size={14} />
                            </button>
                        )}
                    </div>
                )}

                {loading ? (
                    <div className="glass-card p-12 rounded-3xl flex justify-center"><Loader2 className="animate-spin text-amber-500 w-10 h-10" /></div>
                ) : (
                    <>
                        {/* ── السيارات ── */}
                        {tab === "vehicles" && (
                            shownVehicles.length === 0 ? <Empty text="لا توجد سيارات مسجلة على هذا العقد بعد. عند الاستقبال اختر «جهة التعاقد» ليظهر هنا." /> : (
                                <div className="glass-card rounded-3xl border border-border/50 overflow-x-auto">
                                    <table className="w-full text-sm text-right min-w-[760px]">
                                        <thead className="bg-muted/40 text-muted-foreground text-xs">
                                            <tr>
                                                <th className="p-3">السيارة</th>
                                                <th className="p-3">رقم اللوحة</th>
                                                <th className="p-3">السائق</th>
                                                <th className="p-3">الزيارات</th>
                                                <th className="p-3">آخر زيارة</th>
                                                <th className="p-3">المستحق</th>
                                                <th className="p-3"></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {shownVehicles.map(v => (
                                                <tr key={v.id} className="border-t border-border/50 hover:bg-muted/20">
                                                    <td className="p-3 font-bold">{v.label}{v.branches.size > 1 && <span className="mr-2 text-[10px] text-muted-foreground">({[...v.branches].join("، ")})</span>}</td>
                                                    <td className="p-3 font-mono">{v.plate || "—"}</td>
                                                    <td className="p-3">{v.driver || "—"}{v.phone && <div className="text-[11px] text-muted-foreground" dir="ltr">{v.phone}</div>}</td>
                                                    <td className="p-3">{v.visits}{v.inspections > 0 && <span className="text-[11px] text-blue-400"> · {v.inspections} فحص</span>}{v.pending > 0 && <span className="text-[11px] text-indigo-400"> · {v.pending} بانتظار المحاسبة</span>}</td>
                                                    <td className="p-3">{fmtDate(v.last)}</td>
                                                    <td className="p-3 font-bold text-amber-300">{fmtMoney(v.due)}</td>
                                                    <td className="p-3">
                                                        <button onClick={() => openVehicle(v.id, `${v.label}${v.plate ? ` (${v.plate})` : ""}`)}
                                                            className="px-3 py-1.5 rounded-lg bg-muted hover:bg-amber-500/20 border border-border text-xs font-bold">
                                                            ملف السيارة
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )
                        )}

                        {/* ── أوامر العمل ── */}
                        {tab === "orders" && (
                            <div className="space-y-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    {(["", "maintenance", "sale"] as const).map(k => (
                                        <button key={k || "all"} onClick={() => setKindFilter(k)}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${kindFilter === k ? "bg-amber-500/15 text-amber-300 border-amber-500/40" : "bg-card text-muted-foreground border-border"}`}>
                                            {k === "" ? "الكل" : KIND_LABEL[k]}
                                        </button>
                                    ))}
                                    <span className="text-xs text-muted-foreground mr-2">من</span>
                                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="bg-card border border-border rounded-lg px-2 py-1.5 text-xs" />
                                    <span className="text-xs text-muted-foreground">إلى</span>
                                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="bg-card border border-border rounded-lg px-2 py-1.5 text-xs" />
                                    {(dateFrom || dateTo) && (
                                        <button onClick={() => { setDateFrom(""); setDateTo(""); }} className="text-xs text-muted-foreground underline">مسح التاريخ</button>
                                    )}
                                </div>
                                {shownOrders.length === 0 ? <Empty text="لا توجد أوامر عمل مطابقة." /> : (
                                    <div className="glass-card rounded-3xl border border-border/50 overflow-x-auto">
                                        <table className="w-full text-sm text-right min-w-[900px]">
                                            <thead className="bg-muted/40 text-muted-foreground text-xs">
                                                <tr>
                                                    <th className="p-3">#</th>
                                                    <th className="p-3">التاريخ</th>
                                                    <th className="p-3">الفرع</th>
                                                    <th className="p-3">السيارة / السائق</th>
                                                    <th className="p-3">النوع</th>
                                                    <th className="p-3">الحالة</th>
                                                    <th className="p-3">الصافي</th>
                                                    <th className="p-3">الواصل عند الإغلاق</th>
                                                    <th className="p-3"></th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {shownOrders.map(r => {
                                                    const chip = statusChip(r);
                                                    return (
                                                        <tr key={r.id} className="border-t border-border/50 hover:bg-muted/20">
                                                            <td className="p-3 font-mono font-bold">{r.report_number}</td>
                                                            <td className="p-3">{fmtDate(r.created_at)}</td>
                                                            <td className="p-3 text-muted-foreground">{r.branchName || "—"}</td>
                                                            <td className="p-3">
                                                                <div className="font-bold">{r.vehicleLabel}{r.plate && <span className="font-mono text-muted-foreground"> · {r.plate}</span>}</div>
                                                                {r.driver && <div className="text-[11px] text-muted-foreground">{r.driver}</div>}
                                                            </td>
                                                            <td className="p-3">
                                                                {KIND_LABEL[r.kind]}
                                                                {r.hasInspection && <span className="mr-1 text-[10px] text-blue-400">+ فحص شامل</span>}
                                                            </td>
                                                            <td className="p-3"><span className={`text-[11px] font-bold px-2 py-1 rounded-lg border ${chip.cls}`}>{chip.text}</span></td>
                                                            <td className="p-3 font-bold">
                                                                {r.money.state === "closed" ? fmtMoney(r.money.net)
                                                                    : r.money.state === "pending" ? <span className="text-muted-foreground font-normal" title="لم تُحاسَب بعد — المبلغ تقديري">~{fmtMoney(r.money.net)}</span>
                                                                    : "—"}
                                                            </td>
                                                            <td className="p-3">{r.money.state === "closed" ? fmtMoney(r.money.received) : "—"}</td>
                                                            <td className="p-3">
                                                                <div className="flex gap-1.5 justify-end">
                                                                    {r.kind === "maintenance" && (
                                                                        <Link href={`/work-orders/${r.id}`} title="فتح أمر العمل"
                                                                            className="p-2 rounded-lg bg-muted hover:bg-amber-500/20 border border-border"><ExternalLink size={14} /></Link>
                                                                    )}
                                                                    {r.hasInspection && (
                                                                        <button onClick={() => window.open(`/inspection/${r.id}`, "_blank")} title="تقرير الفحص الشامل"
                                                                            className="p-2 rounded-lg bg-muted hover:bg-blue-500/20 border border-border"><ClipboardCheck size={14} /></button>
                                                                    )}
                                                                    <button onClick={() => window.open(`/print/${r.id}?mode=full`, "_blank")} title="طباعة"
                                                                        className="p-2 rounded-lg bg-muted hover:bg-emerald-500/20 border border-border"><Printer size={14} /></button>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                            <tfoot className="bg-muted/30 text-xs font-bold">
                                                <tr className="border-t border-border">
                                                    <td className="p-3" colSpan={6}>المجموع المعروض ({shownOrders.length} فاتورة) — المغلقة فقط</td>
                                                    <td className="p-3">{fmtMoney(ordersTotals.net)}</td>
                                                    <td className="p-3">{fmtMoney(ordersTotals.received)}</td>
                                                    <td className="p-3"></td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── الفحص الشامل ── */}
                        {tab === "inspections" && (
                            inspectionsList.length === 0 ? <Empty text="لا توجد فحوصات شاملة على هذا العقد." /> : (
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                    {inspectionsList.map(r => (
                                        <div key={r.id} className="glass-card p-5 rounded-2xl border border-border space-y-3">
                                            <div className="flex justify-between items-start gap-2">
                                                <div>
                                                    <div className="font-bold">{r.vehicleLabel}</div>
                                                    <div className="text-xs text-muted-foreground font-mono">{r.plate || "—"}</div>
                                                </div>
                                                <span className="font-mono text-muted-foreground text-sm">#{r.report_number}</span>
                                            </div>
                                            <div className="text-xs text-muted-foreground space-y-1">
                                                <div>السائق: <span className="text-foreground">{r.driver || "—"}</span></div>
                                                <div>التاريخ: <span className="text-foreground">{fmtDate(r.created_at)}</span> · {r.branchName || "—"}</div>
                                                <div>{r.kind === "inspection" ? "فحص مستقل" : "ضمن أمر عمل صيانة"}</div>
                                            </div>
                                            <div className="flex items-center gap-2 text-sm">
                                                {r.ci_pct && <span className="px-2 py-1 rounded-lg bg-blue-500/10 text-blue-300 border border-blue-500/20 font-bold">{r.ci_pct}%</span>}
                                                {r.ci_rating && <span className="px-2 py-1 rounded-lg bg-muted border border-border">{r.ci_rating}</span>}
                                            </div>
                                            <button onClick={() => window.open(`/inspection/${r.id}`, "_blank")}
                                                className="w-full py-2 rounded-xl bg-blue-600/90 hover:bg-blue-500 text-white text-sm font-bold flex items-center justify-center gap-2">
                                                <ClipboardCheck size={15} /> عرض تقرير الفحص
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )
                        )}

                        {/* ── الدفعات ── */}
                        {tab === "payments" && (
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                <div className="glass-card p-5 rounded-2xl border border-emerald-500/20 space-y-3 h-max">
                                    <h3 className="font-bold flex items-center gap-2"><Plus size={16} className="text-emerald-400" /> تسجيل دفعة من الجهة</h3>
                                    <div className="space-y-1">
                                        <label className="text-xs text-muted-foreground">المبلغ (د.ع)</label>
                                        <input inputMode="numeric" dir="ltr" value={withCommas(payAmount)} onChange={e => setPayAmount(digitsOnly(e.target.value))}
                                            placeholder="0" className="input-field text-right font-bold" />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs text-muted-foreground">تاريخ الاستلام</label>
                                        <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className="input-field" />
                                    </div>
                                    {!isBranchPinned && (
                                        <div className="space-y-1">
                                            <label className="text-xs text-muted-foreground">الفرع المستلِم</label>
                                            <select value={payBranch} onChange={e => setPayBranch(e.target.value)} className="input-field cursor-pointer">
                                                <option value="">عام (الشركة)</option>
                                                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                            </select>
                                        </div>
                                    )}
                                    <div className="space-y-1">
                                        <label className="text-xs text-muted-foreground">ملاحظات (رقم الصك، الفترة...)</label>
                                        <input value={payNote} onChange={e => setPayNote(e.target.value)} placeholder="—" className="input-field" />
                                    </div>
                                    <button onClick={addPayment} disabled={savingPay || !contract}
                                        className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-60">
                                        {savingPay ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} حفظ الدفعة
                                    </button>
                                    {activeBranchId && (
                                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                                            العرض الحالي لفرع {activeBranchName}: تظهر هنا دفعات هذا الفرع فقط. الدفعات «العامة» تُحتسب في عرض كل الفروع.
                                        </p>
                                    )}
                                </div>
                                <div className="lg:col-span-2">
                                    {payments.length === 0 ? <Empty text="لم تُسجَّل أي دفعة بعد." /> : (
                                        <div className="glass-card rounded-3xl border border-border/50 overflow-x-auto">
                                            <table className="w-full text-sm text-right min-w-[560px]">
                                                <thead className="bg-muted/40 text-muted-foreground text-xs">
                                                    <tr>
                                                        <th className="p-3">التاريخ</th>
                                                        <th className="p-3">المبلغ</th>
                                                        <th className="p-3">الفرع</th>
                                                        <th className="p-3">ملاحظات</th>
                                                        <th className="p-3">سجّلها</th>
                                                        <th className="p-3"></th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {payments.map(p => (
                                                        <tr key={p.id} className="border-t border-border/50">
                                                            <td className="p-3">{fmtDate(p.paid_at)}</td>
                                                            <td className="p-3 font-bold text-emerald-400">{fmtMoney(Number(p.amount))}</td>
                                                            <td className="p-3 text-muted-foreground">{one(p.branches)?.name || "عام"}</td>
                                                            <td className="p-3">{p.note || "—"}</td>
                                                            <td className="p-3 text-muted-foreground">{p.created_by || "—"}</td>
                                                            <td className="p-3">
                                                                {isAdmin && (
                                                                    <button onClick={() => deletePayment(p)} title="حذف الدفعة"
                                                                        className="p-2 rounded-lg bg-muted hover:bg-rose-500/20 border border-border text-rose-400"><Trash2 size={14} /></button>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                                <tfoot className="bg-muted/30 text-xs font-bold">
                                                    <tr className="border-t border-border">
                                                        <td className="p-3">المجموع</td>
                                                        <td className="p-3 text-emerald-400">{fmtMoney(summary.paid)}</td>
                                                        <td className="p-3" colSpan={4}></td>
                                                    </tr>
                                                </tfoot>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

const TONES = {
    blue: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    rose: "bg-rose-500/10 text-rose-400 border-rose-500/20",
} as const;

function StatCard({ label, value, unit, sub, tone, icon }: {
    label: string; value: string; unit?: string; sub?: string; tone: keyof typeof TONES; icon: React.ReactNode;
}) {
    return (
        <div className="glass-card p-4 md:p-5 rounded-2xl border border-border">
            <div className="flex items-start justify-between gap-2 mb-2">
                <span className="text-xs md:text-sm text-muted-foreground font-bold">{label}</span>
                <span className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${TONES[tone]}`}>{icon}</span>
            </div>
            <div className="text-xl md:text-2xl font-black text-foreground" dir="ltr" style={{ textAlign: "right" }}>
                {value}{unit && <span className="text-xs text-muted-foreground font-bold mr-1">{unit}</span>}
            </div>
            {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
        </div>
    );
}

function Empty({ text }: { text: string }) {
    return <div className="glass-card p-10 rounded-3xl text-center text-muted-foreground text-sm">{text}</div>;
}
