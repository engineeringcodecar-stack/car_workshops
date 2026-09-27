"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthProvider";
import { showSuccess, showError, showConfirm } from "@/lib/alerts";
import { withCommas, digitsOnly } from "@/lib/format";
import {
    ClipboardCheck, Loader2, Car, User, Receipt, ChevronDown, ChevronUp,
    CheckCircle2, Wallet, Percent, HandCoins, Plus, Printer, Trash2, Clock, RotateCcw,
} from "lucide-react";

// Service key → Arabic label (mirrors the reception/customers service set).
const SERVICE_LABELS: Record<string, string> = {
    engineOil: 'زيت المحرك', oilFilter: 'فلتر زيت المحرك', airFilter: 'فلتر الهواء',
    acFilter: 'فلتر التبريد', brakeFluid: 'زيت المكابح', coolant: 'ماء الراديتر',
    battery: 'البطارية', engineBelts: 'قايش المحرك',
    brakePads: 'دسكات السيارة', sparkPlugs: 'شمعات الاحتراق',
    gearboxOil: 'زيت كير', gearboxHydraulic: 'هايدروليك الكير', gearboxFilter: 'فلتر الكير',
    wipers: 'مساحات زجاج', windshieldFluid: 'سائل غسيل جام',
    battery2: 'البطارية فحص دوري', batteryFilter: 'فلتر البطارية',
    engineFlash: 'فلاش المحرك', engineCeramic: 'سيراميك محرك',
    linerCleaner: 'منظف بطانة (جكجكة)', oilLeakPreventer: 'مانع تسريب زيت',
    smokePreventer: 'مانع دخان', gearboxFlash: 'فلاش كير',
    gearboxCeramic: 'سيراميك كير', gearboxAntiSlip: 'مانع انزلاق كير',
    acCleaner: 'منظف دورة تبريد', injectorCleaner: 'منظف بخاخات',
    fuelSystemCleaner: 'منظف نظام وقود', octaneBooster: 'محسن أوكتان',
    additives: 'معالجات ومحسنات', cleaners: 'منظفات وأساسيات',
    transOil: 'زيت ناقل الحركة', differentialOil: 'زيت الدبل / البكك',
    maintenanceUnits: 'وحدات الصيانة'
};

type Order = any;

const num = (v: any) => parseFloat(String(v ?? "").replace(/[^\d.]/g, "")) || 0;

// An invoice manually removed from the accounting page (excluded from pending, closed, income).
const isAuditExcluded = (o: any) =>
    (Array.isArray(o.selected_services) ? o.selected_services[0] : o.selected_services)?.pricing?.auditExcluded === true;

// Format an ISO timestamp as "DD/MM/YYYY H:MM ص/م" in Iraq time (UTC+3), en digits.
const fmtDateTime = (iso?: string) => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    const iraq = new Date(d.getTime() + 3 * 3600 * 1000);
    const dd = String(iraq.getUTCDate()).padStart(2, '0');
    const mm = String(iraq.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = iraq.getUTCFullYear();
    let h = iraq.getUTCHours();
    const min = String(iraq.getUTCMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'م' : 'ص';
    h = h % 12 || 12;
    return `${dd}/${mm}/${yyyy} ${h}:${min} ${ampm}`;
};

const getLocalDateString = (date = new Date()) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

export default function AuditPage() {
    const { employeeBranchId, employeeRole, loading: authLoading } = useAuth();
    const [selectedDate, setSelectedDate] = useState(getLocalDateString());
    const [pendingOrders, setPendingOrders] = useState<Order[]>([]);
    const [closedOrders, setClosedOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<'pending' | 'closed'>('pending');
    const [showDeleted, setShowDeleted] = useState(false);
    const [expanded, setExpanded] = useState<string | null>(null);
    const [savingId, setSavingId] = useState<string | null>(null);
    // Per-order accounting inputs, keyed by order id.
    const [inputs, setInputs] = useState<Record<string, { discount: string; received: string }>>({});
    const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState<string>("");
    // Monotonic fetch token: a fetch for the OLD date/branch that resolves late must not
    // overwrite the state written by a newer fetch (latest-wins).
    const fetchToken = useRef(0);

    useEffect(() => {
        const fetchBranches = async () => {
            const { data } = await supabase.from('branches').select('id, name');
            if (data) setBranches(data);
        };
        fetchBranches();
    }, []);

    // `silent` keeps the current list on screen while the data refreshes underneath.
    // Without it every realtime event (any order changing anywhere in the workshop)
    // blanked the whole page to a spinner — collapsing the invoice the accountant had
    // open and throwing them back to the top of the list mid-audit.
    const fetchOrders = async (silent = false) => {
        const token = ++fetchToken.current;
        if (!silent) setLoading(true);
        try {
            // 1. Fetch pending orders (status = 'تم الانتهاء', order_type !== 'sale', and accounted is not true)
            let qPending = supabase.from('inspection_reports')
                .select(`id, report_number, status, order_type, created_at, completed_at, total_price, odometer_reading, selected_services, branch_id, contract_id, contract:contracts(name), vehicles(make, model, plate_number, clients(name, phone)), branches(name), receptionist:receptionist_id(name)`)
                .eq('status', 'تم الانتهاء')
                .neq('order_type', 'sale')
                // Not yet accounted = accounted is missing (NULL, a freshly finished order) OR not 'true'.
                // A plain .not(...eq.true) would drop NULL rows, so newly finished orders never showed here.
                .or('selected_services->0->pricing->>accounted.is.null,selected_services->0->pricing->>accounted.neq.true')
                .order('completed_at', { ascending: false });

            const activeBranchId = (employeeBranchId && employeeRole !== 'Owner') ? employeeBranchId : selectedBranchId;
            if (activeBranchId) {
                qPending = qPending.eq('branch_id', activeBranchId);
            }

            // 2. Fetch closed orders for the selected date (status = 'تم الانتهاء', and accountedAt is on the selected date)
            // Calculate UTC range matching Iraq timezone (UTC+3) explicitly, independent of client device timezone
            const startDateLocal = new Date(`${selectedDate}T00:00:00Z`);
            startDateLocal.setUTCHours(startDateLocal.getUTCHours() - 3);
            const startUTC = startDateLocal.toISOString();

            const endDateLocal = new Date(`${selectedDate}T23:59:59.999Z`);
            endDateLocal.setUTCHours(endDateLocal.getUTCHours() - 3);
            const endUTC = endDateLocal.toISOString();

            // Closed = only invoices actually accounted (pricing.accounted = true), filtered by the
            // ACCOUNTING date (pricing.accountedAt) — one day at a time — because the money enters
            // the income on the day it was collected/accounted, not the day the car was received.
            let qClosed = supabase.from('inspection_reports')
                .select(`id, report_number, status, order_type, created_at, completed_at, total_price, odometer_reading, selected_services, branch_id, contract_id, contract:contracts(name), vehicles(make, model, plate_number, clients(name, phone)), branches(name), receptionist:receptionist_id(name)`)
                .eq('status', 'تم الانتهاء')
                .eq('selected_services->0->pricing->>accounted', 'true')
                .gte('selected_services->0->pricing->>accountedAt', startUTC)
                .lte('selected_services->0->pricing->>accountedAt', endUTC)
                .order('completed_at', { ascending: false });

            if (activeBranchId) {
                qClosed = qClosed.eq('branch_id', activeBranchId);
            }

            // Product sales (بيع منتج) are cash-settled at the point of sale, so they count as
            // income on their SALE date (created_at) — included in the daily "closed" income.
            let qSales = supabase.from('inspection_reports')
                .select(`id, report_number, status, order_type, created_at, completed_at, total_price, odometer_reading, selected_services, branch_id, contract_id, contract:contracts(name), vehicles(make, model, plate_number, clients(name, phone)), branches(name), receptionist:receptionist_id(name)`)
                .eq('order_type', 'sale')
                .gte('created_at', startUTC)
                .lte('created_at', endUTC)
                .order('created_at', { ascending: false });

            if (activeBranchId) {
                qSales = qSales.eq('branch_id', activeBranchId);
            }

            const [resPending, resClosed, resSales] = await Promise.all([qPending, qClosed, qSales]);

            // Stale response: a newer fetch (different date/branch) started after this one — bail
            // out before any setState so the wrong day's data can never land on screen.
            if (token !== fetchToken.current) return;

            if (resPending.error) throw resPending.error;
            if (resClosed.error) throw resClosed.error;
            if (resSales.error) throw resSales.error;

            // De-duplicate by id: an order can match more than one query (e.g. an accounted sale
            // shows in both the closed and the sales query), which would render — and delete — twice.
            const dedupe = (arr: Order[]) => {
                const seen = new Set<string>();
                return arr.filter(o => (seen.has(o.id) ? false : (seen.add(o.id), true)));
            };
            // Keep excluded invoices in state (so they can be shown + restored); they are hidden
            // from the normal view and the income totals, but surfaced under the "المحذوفة" toggle.
            setPendingOrders(dedupe(resPending.data || []));
            // Daily income = accounted maintenance invoices + product sales for the day.
            setClosedOrders(dedupe([...(resClosed.data || []), ...(resSales.data || [])]));
        } catch (err: any) {
            if (token !== fetchToken.current) return; // stale fetch — a newer one owns the UI now
            console.error("Error fetching orders:", err);
            showError("خطأ", err.message || "تعذر جلب البيانات.");
        } finally {
            if (token === fetchToken.current) setLoading(false);
        }
    };

    useEffect(() => {
        if (authLoading) return;
        fetchOrders();

        // Throttled refresh. This page's pending query is the heaviest in the app — it
        // scans every completed unaccounted order and carries each one's full
        // selected_services payload — and it was re-run 500ms after ANY order changing
        // in ANY branch. On a busy day that is a constant, workshop-wide amplification
        // on the database. Collapse those bursts into one refresh every 30s instead;
        // the accountant's own actions still refresh immediately below.
        let timer: ReturnType<typeof setTimeout> | null = null;
        const channel = supabase.channel('audit_realtime')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'inspection_reports' }, () => {
                if (timer) return;
                timer = setTimeout(() => { timer = null; fetchOrders(true); }, 30000);
            })
            .subscribe();

        return () => {
            if (timer) clearTimeout(timer);
            supabase.removeChannel(channel);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authLoading, employeeBranchId, selectedDate, selectedBranchId]);

    useEffect(() => {
        const handleMessage = (e: MessageEvent) => {
            if (e.data?.type === 'print_complete') {
                const el = document.getElementById('print-iframe');
                if (el) {
                    try {
                        document.body.removeChild(el);
                    } catch (err) {
                        console.error("Error removing print iframe:", err);
                    }
                }
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    // Split into pending (not yet accounted) vs closed (accounted).
    const isAccounted = (o: Order) => {
        if (o.order_type === 'sale') return true;
        const p = (Array.isArray(o.selected_services) ? o.selected_services[0] : o.selected_services)?.pricing;
        return p?.accounted === true;
    };
    
    const rawList = tab === 'pending' ? pendingOrders : closedOrders;
    // Normal view hides excluded ("محذوفة") invoices; the "المحذوفة" toggle shows only those (to restore).
    const list = showDeleted ? rawList.filter(isAuditExcluded) : rawList.filter(o => !isAuditExcluded(o));
    const pendingCount = pendingOrders.filter(o => !isAuditExcluded(o)).length;
    const closedCount = closedOrders.filter(o => !isAuditExcluded(o)).length;
    const deletedCount = rawList.filter(isAuditExcluded).length;

    // Financial summary for the closed orders (المحاسبة): totals + collected vs discounted.
    const summary = useMemo(() => {
        let grand = 0, discount = 0, received = 0;
        closedOrders.filter(o => !isAuditExcluded(o)).forEach(o => {
            const p = (Array.isArray(o.selected_services) ? o.selected_services[0] : o.selected_services)?.pricing || {};
            grand += num(p.grandTotal ?? o.total_price);
            discount += num(p.discount);
            received += num(p.amountReceived ?? (o.order_type === 'sale' ? o.total_price : 0));
        });
        // ذمم intentionally excluded from the daily summary — it produced misleading readings
        // (a discount is a discount, not a debt), per the client's request.
        return { grand, discount, received, net: grand - discount };
    }, [closedOrders]);

    // Build the invoice line-items for an order (original services + services added during work).
    const invoiceLines = (o: Order): { label: string; price: number; added: boolean; note?: string }[] => {
        const payload = Array.isArray(o.selected_services) ? o.selected_services[0] : o.selected_services;
        const lines: { label: string; price: number; added: boolean; note?: string }[] = [];
        const services = payload?.services || {};
        Object.entries(services as Record<string, any>).forEach(([k, v]) => {
            if (!v || v.status === 'جيد' || v.status === 'سليم' || num(v.price) === 0) return;
            lines.push({ label: SERVICE_LABELS[k] || k, price: num(v.price), added: v.addedDuringWork === true });
        });
        (payload?.customServices || []).forEach((c: any) => {
            if (!c?.label && !c?.name || num(c.price) === 0) return;
            lines.push({ label: c.label || c.name, price: num(c.price), added: c.addedDuringWork === true });
        });
        // Extra service entries appended to selected_services (custom services added live).
        (Array.isArray(o.selected_services) ? o.selected_services.slice(1) : []).forEach((s: any) => {
            if (s?.is_paper_v2_format) return;
            if (!s?.name || num(s.price) === 0) return;
            lines.push({ label: s.name, price: num(s.price), added: s.addedDuringWork === true, note: s.details });
        });
        return lines;
    };

    const vehicleOf = (o: Order) => (Array.isArray(o.vehicles) ? o.vehicles[0] : o.vehicles);
    const clientOf = (o: Order) => { const v = vehicleOf(o); return v ? (Array.isArray(v.clients) ? v.clients[0] : v.clients) : null; };
    const pricingOf = (o: Order) => (Array.isArray(o.selected_services) ? o.selected_services[0] : o.selected_services)?.pricing || {};

    const getInput = (o: Order) => {
        const p = pricingOf(o);
        // NOTE: do NOT prefill the discount from reception's pricing.discount — total_price is
        // already net of that discount, so prefilling deducted it a second time and the phantom
        // difference showed up as fake ذمم. The accountant enters an extra discount only if any.
        return inputs[o.id] ?? { discount: "", received: String(p.amountReceived ?? "") };
    };
    const setInput = (id: string, field: 'discount' | 'received', value: string) =>
        setInputs(prev => ({ ...prev, [id]: { ...(prev[id] ?? { discount: "", received: "" }), [field]: value } }));

    // Read the freshest selected_services (and total_price) right before a write, so a stale
    // list row (the order may have been edited elsewhere since this page fetched) can never
    // overwrite newer data.
    const freshRowOf = async (o: Order): Promise<{ services: any[]; totalPrice: number | null }> => {
        const { data } = await supabase.from('inspection_reports').select('selected_services, total_price').eq('id', o.id).single();
        const raw = data?.selected_services ?? o.selected_services;
        const arr = [...(Array.isArray(raw) ? raw : [raw])].filter(Boolean);
        if (arr.length === 0) arr.push({ is_paper_v2_format: true, services: {} });
        return { services: arr, totalPrice: data ? num(data.total_price) : null };
    };
    const freshServicesOf = async (o: Order): Promise<any[]> => (await freshRowOf(o)).services;

    const closeAccounting = async (o: Order) => {
        setSavingId(o.id);
        try {
            // Base every figure on the FRESH row, not the rendered one — the list row can
            // lag behind (silent refresh in flight, realtime throttled), and closing on a
            // stale total wrote a grandTotal that contradicted the stored total_price.
            const { services, totalPrice: freshTotal } = await freshRowOf(o);

            // Money is only ever closed against a CONFIRMED fresh read — on a network
            // blip the fallback inside freshRowOf is the stale row, and closing on that
            // is exactly the hazard this path exists to remove.
            if (freshTotal === null) {
                showError("خطأ", "تعذّر قراءة أحدث نسخة من الفاتورة. تحقق من الاتصال وحاول مجدداً.");
                return;
            }

            // Already closed from another device/tab? Never account twice.
            if (services[0]?.pricing?.accounted === true) {
                showError("مُحاسَبة مسبقاً", `الفاتورة #${o.report_number} تم إغلاقها بالفعل (ربما من جهاز آخر). حدّثت القائمة.`);
                fetchOrders(true);
                return;
            }

            const grand = (freshTotal ?? 0) || num(o.total_price) || invoiceLines(o).reduce((s, l) => s + l.price, 0);
            const inp = getInput(o);
            const discount = num(inp.discount);
            // A contract (آجل) invoice is closed onto the contract's balance: nothing is
            // collected at the desk unless the accountant types an amount. Everyone else
            // defaults to paying the full net, as before.
            const received = inp.received === "" ? (o.contract_id ? 0 : grand - discount) : num(inp.received);
            if (discount > grand) { showError("خطأ", "الخصم أكبر من المجموع الكلي."); return; }
            if (received > (grand - discount)) { showError("خطأ", "المبلغ الواصل أكبر من الصافي المطلوب."); return; }
            const net = grand - discount;

            services[0] = {
                ...services[0],
                pricing: {
                    ...(services[0]?.pricing || {}),
                    grandTotal: String(grand),
                    discount: String(discount),
                    amountReceived: String(received),
                    accounted: true,
                    // Actual moment of accounting — the daily "closed" view filters on this.
                    accountedAt: new Date().toISOString(),
                },
            };
            // The not-yet-accounted condition rides ON the update itself (same filter
            // string the pending query uses), so two devices racing to close the same
            // invoice can't both win — the loser matches 0 rows instead of silently
            // overwriting the first closing's figures and accountedAt.
            const { data: updatedRows, error } = await supabase.from('inspection_reports')
                .update({ selected_services: services, total_price: net })
                .eq('id', o.id)
                .or('selected_services->0->pricing->>accounted.is.null,selected_services->0->pricing->>accounted.neq.true')
                .select('id');
            if (error) throw error;
            if (!updatedRows || updatedRows.length === 0) {
                showError("مُحاسَبة مسبقاً", `الفاتورة #${o.report_number} أُغلقت للتو من جهاز آخر — لم يتم الحفظ مرتين.`);
                fetchOrders(true);
                return;
            }
            showSuccess("تمت المحاسبة", `تم إغلاق الفاتورة #${o.report_number}. الصافي ${net.toLocaleString('en-US')} د.ع.`);
            // Silent: the success toast is the feedback — no need to blank the list and
            // lose the accountant's place in it.
            fetchOrders(true);
        } catch (err: any) {
            console.error(err);
            showError("خطأ", err.message || "تعذر حفظ المحاسبة.");
        } finally {
            setSavingId(null);
        }
    };

    // Remove an invoice from the accounting page (junk / wrong entries). Non-destructive: the work
    // order itself is kept — it's just flagged so it drops out of pending, closed, and the income.
    const removeFromAudit = async (o: Order) => {
        const ok = await showConfirm(
            "حذف من المحاسبة",
            `حذف الفاتورة #${o.report_number} من صفحة المحاسبة؟ (لن تُحذف السيارة أو أمر العمل — فقط تُستبعد من التدقيق والدخل)`,
            "نعم، حذف",
            false
        );
        if (!ok) return;
        setSavingId(o.id);
        try {
            const services = await freshServicesOf(o);
            services[0] = { ...services[0], pricing: { ...(services[0]?.pricing || {}), auditExcluded: true } };
            const { error } = await supabase.from('inspection_reports').update({ selected_services: services }).eq('id', o.id);
            if (error) throw error;
            showSuccess("تم الحذف", `تم حذف الفاتورة #${o.report_number} من المحاسبة.`);
            fetchOrders(true);
        } catch (err: any) {
            console.error(err);
            showError("خطأ", err.message || "تعذر حذف الفاتورة من المحاسبة.");
        } finally {
            setSavingId(null);
        }
    };

    // Undo a "حذف من المحاسبة": bring the invoice back into the accounting page + income.
    const restoreToAudit = async (o: Order) => {
        setSavingId(o.id);
        try {
            const services = await freshServicesOf(o);
            const pricing = { ...(services[0]?.pricing || {}) };
            delete pricing.auditExcluded;
            services[0] = { ...services[0], pricing };
            const { error } = await supabase.from('inspection_reports').update({ selected_services: services }).eq('id', o.id);
            if (error) throw error;
            showSuccess("تم الاسترجاع", `تم إرجاع الفاتورة #${o.report_number} إلى المحاسبة.`);
            fetchOrders(true);
        } catch (err: any) {
            console.error(err);
            showError("خطأ", err.message || "تعذر استرجاع الفاتورة.");
        } finally {
            setSavingId(null);
        }
    };

    const printReport = (id: string, mode: 'short' | 'full' = 'short') => {
        const existing = document.getElementById('print-iframe');
        if (existing) {
            try {
                document.body.removeChild(existing);
            } catch (err) {
                console.error(err);
            }
        }

        const iframe = document.createElement('iframe');
        iframe.id = 'print-iframe';
        iframe.style.position = 'fixed';
        iframe.style.left = '-9999px';
        iframe.style.top = '-9999px';
        iframe.style.width = '1024px';
        iframe.style.height = '768px';
        iframe.style.border = '0';
        iframe.src = `/print/${id}?mode=${mode}`;
        
        document.body.appendChild(iframe);

        // Fallback cleanup
        setTimeout(() => {
            const el = document.getElementById('print-iframe');
            if (el) {
                try {
                    document.body.removeChild(el);
                } catch (err) {
                    console.error(err);
                }
            }
        }, 45000);
    };

    if (authLoading || loading) {
        return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-emerald-500" size={40} /></div>;
    }

    return (
        <div className="p-4 md:p-8 font-ibm" dir="rtl">
        <div className="space-y-6 print:hidden">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-display font-bold text-foreground mb-1 flex items-center gap-3">
                        <ClipboardCheck className="text-emerald-500" size={30} /> التدقيق والمحاسبة
                    </h1>
                    <p className="text-muted-foreground text-sm">المركبات المنتهية بانتظار التدقيق والمحاسبة، مع تفاصيل الفواتير والمبالغ.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    {/* Branch Dropdown */}
                    {branches.length > 0 && (employeeRole === 'Owner' || !employeeBranchId) && (
                        <div className="flex items-center gap-2 bg-card border border-border rounded-xl px-4 py-2">
                            <span className="text-xs font-bold text-muted-foreground">الفرع:</span>
                            <select
                                value={selectedBranchId}
                                onChange={(e) => setSelectedBranchId(e.target.value)}
                                className="bg-transparent text-sm text-foreground focus:outline-none font-bold cursor-pointer"
                            >
                                <option value="" className="bg-card text-foreground">كل الفروع</option>
                                {branches.map(b => (
                                    <option key={b.id} value={b.id} className="bg-card text-foreground">{b.name}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div className="flex items-center gap-2 bg-card border border-border rounded-xl px-4 py-2">
                        <span className="text-xs font-bold text-muted-foreground">تاريخ المحاسبة:</span>
                        <input
                            type="date"
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                            className="bg-transparent text-sm text-foreground focus:outline-none font-bold"
                        />
                    </div>
                    <button onClick={() => window.print()} className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold flex items-center gap-2 transition-colors" title="طباعة تقرير إغلاق اليوم">
                        <Printer size={15} /> تقرير اليوم
                    </button>
                </div>
            </div>

            {/* Financial summary (closed orders) — ذمم removed per client request (misleading readings) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <SummaryCard icon={<Wallet size={18} />} label="المجموع الكلي (المُحاسَب)" value={summary.grand} color="text-blue-400" />
                <SummaryCard icon={<Percent size={18} />} label="إجمالي الخصم" value={summary.discount} color="text-amber-400" />
                <SummaryCard icon={<HandCoins size={18} />} label="إجمالي الواصل" value={summary.received} color="text-emerald-400" />
            </div>

            {/* Tabs */}
            <div className="flex flex-wrap gap-2">
                <button onClick={() => { setTab('pending'); setShowDeleted(false); }} className={`px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${tab === 'pending' && !showDeleted ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-card border-border text-muted-foreground hover:bg-muted'}`}>
                    بانتظار المحاسبة ({pendingCount})
                </button>
                <button onClick={() => { setTab('closed'); setShowDeleted(false); }} className={`px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${tab === 'closed' && !showDeleted ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-card border-border text-muted-foreground hover:bg-muted'}`}>
                    مُحاسَبة ومغلقة ({closedCount})
                </button>
                <button onClick={() => setShowDeleted(v => !v)} className={`px-4 py-2 rounded-xl text-sm font-bold border transition-colors flex items-center gap-1.5 ${showDeleted ? 'bg-rose-600 border-rose-500 text-white' : 'bg-card border-border text-muted-foreground hover:bg-muted'}`} title="عرض الفواتير المحذوفة من المحاسبة لاسترجاعها">
                    <Trash2 size={14} /> المحذوفة ({deletedCount})
                </button>
            </div>

            {/* Orders */}
            {list.length === 0 ? (
                <div className="text-center text-muted-foreground py-16 glass-card rounded-2xl">لا توجد فواتير في هذه القائمة.</div>
            ) : (
                <div className="space-y-3">
                    {list.map(o => {
                        const v = vehicleOf(o); const c = clientOf(o);
                        const lines = invoiceLines(o);
                        const p = pricingOf(o);
                        const accounted = isAccounted(o);
                        const lineSum = lines.reduce((s, l) => s + l.price, 0);
                        // A CLOSED invoice derives every figure from the accountant's own
                        // snapshot (grandTotal/discount) so المجموع/الخصم/الصافي always agree.
                        // total_price alone is NOT trusted for closed rows: it is the NET, and
                        // an edit after closing could have rewritten it — which is exactly how
                        // cards ended up showing مجموع 95,000, خصم 0, صافي 80,000 at once.
                        const grand = accounted
                            ? (num(p.grandTotal) || num(o.total_price) || lineSum)
                            : (num(o.total_price) || lineSum);
                        const inp = getInput(o);
                        const net = grand - num(inp.discount);
                        const open = expanded === o.id;
                        return (
                            <div key={o.id} className="glass-card rounded-2xl border border-border overflow-hidden">
                                {/* Row header */}
                                <div className="p-4 flex flex-wrap items-center gap-4">
                                    <div className="flex flex-col gap-1 shrink-0">
                                        <span className="text-xs font-mono bg-muted px-2 py-1 rounded-lg text-muted-foreground text-center">#{o.report_number}</span>
                                        {(() => {
                                            const stampIso = o.order_type === 'sale' ? o.created_at
                                                : accounted ? (p.accountedAt || o.completed_at)
                                                : (o.completed_at || o.created_at);
                                            const stampLabel = o.order_type === 'sale' ? 'وقت البيع'
                                                : accounted ? 'وقت المحاسبة' : 'وقت الإنهاء';
                                            return (
                                                <span className="text-[10px] text-muted-foreground whitespace-nowrap flex items-center gap-1" title={stampLabel}>
                                                    <Clock size={10} /> {fmtDateTime(stampIso)}
                                                </span>
                                            );
                                        })()}
                                    </div>
                                    <div className="flex items-center gap-2 min-w-[140px] flex-1">
                                        <User size={16} className="text-blue-400 shrink-0" />
                                        <span className="font-bold text-sm truncate">{c?.name || "عميل نقدي"}</span>
                                        {o.contract_id && (
                                            <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30" title="فاتورة آجلة على العقد">
                                                عقد {o.contract?.name || ""} · آجل
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 min-w-[140px] flex-1">
                                        <Car size={16} className="text-rose-400 shrink-0" />
                                        <span className="text-sm text-muted-foreground truncate">{o.order_type === 'sale' ? 'بيع منتج' : `${v?.make || ''} ${v?.model || ''}`}</span>
                                    </div>
                                    <div className="text-left shrink-0">
                                        <div className="text-[10px] text-muted-foreground">المبلغ المستحق</div>
                                        <div className="font-black text-emerald-500">{(accounted ? grand - num(p.discount) : net).toLocaleString('en-US')} د.ع</div>
                                    </div>
                                    <button onClick={() => setExpanded(open ? null : o.id)} className="px-3 py-2 rounded-xl bg-muted hover:bg-muted/70 text-sm font-bold flex items-center gap-1 border border-border">
                                        <Receipt size={15} /> تفاصيل الفاتورة {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                                    </button>
                                    {isAuditExcluded(o) ? (
                                        <button onClick={() => restoreToAudit(o)} disabled={savingId === o.id} title="استرجاع إلى المحاسبة" className="px-3 py-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500 hover:text-white transition-all disabled:opacity-60 text-sm font-bold flex items-center gap-1">
                                            <RotateCcw size={14} /> استرجاع
                                        </button>
                                    ) : (
                                        <button onClick={() => removeFromAudit(o)} disabled={savingId === o.id} title="حذف من المحاسبة" className="p-2 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500 hover:text-white transition-all disabled:opacity-60">
                                            <Trash2 size={15} />
                                        </button>
                                    )}
                                </div>

                                {/* Expanded invoice details + accounting */}
                                {open && (
                                    <div className="border-t border-border p-4 space-y-4 bg-background/40">
                                        {/* Line items */}
                                        <div className="space-y-1.5">
                                            <h4 className="text-xs font-bold text-muted-foreground mb-2">الخدمات المنفّذة</h4>
                                            {lines.length === 0 && <div className="text-xs text-muted-foreground">لا توجد خدمات مسجّلة.</div>}
                                            {lines.map((l, i) => (
                                                <div key={i} className="flex items-center justify-between text-sm py-1 border-b border-border/40">
                                                    <span className="flex items-center gap-2">
                                                        {l.label}
                                                        {l.added && <span className="text-[10px] bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded px-1.5 py-0.5 flex items-center gap-1"><Plus size={10} /> أُضيفت أثناء العمل</span>}
                                                        {l.note && <span className="text-[10px] text-muted-foreground">({l.note})</span>}
                                                    </span>
                                                    <span className="font-mono text-muted-foreground">{l.price.toLocaleString('en-US')} د.ع</span>
                                                </div>
                                            ))}
                                        </div>

                                        {/* Accounting */}
                                        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                                            <div className="flex items-center justify-between text-sm">
                                                <span className="text-muted-foreground">المجموع الكلي</span>
                                                <span className="font-black text-blue-400">{grand.toLocaleString('en-US')} د.ع</span>
                                            </div>
                                            {accounted ? (
                                                <>
                                                    <Row label={o.order_type === 'sale' ? 'وقت البيع' : 'وقت المحاسبة'} value={fmtDateTime(o.order_type === 'sale' ? o.created_at : (p.accountedAt || o.completed_at))} />
                                                    <Row label="الخصم" value={`${num(p.discount).toLocaleString('en-US')} د.ع`} />
                                                    <Row label="الواصل" value={`${num(p.amountReceived).toLocaleString('en-US')} د.ع`} />
                                                    <Row label="الصافي" value={`${(grand - num(p.discount)).toLocaleString('en-US')} د.ع`} strong />
                                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-border/40">
                                                        <div className="flex items-center gap-2 text-emerald-400 text-sm font-bold"><CheckCircle2 size={16} /> تمت المحاسبة والإغلاق</div>
                                                        <button
                                                            onClick={() => printReport(o.id, 'short')}
                                                            className="px-3.5 py-1.5 bg-blue-600/10 hover:bg-blue-600 hover:text-white text-blue-400 rounded-xl text-xs font-bold transition-all border border-blue-500/20 flex items-center justify-center gap-1.5"
                                                        >
                                                            <Printer size={13} /> طباعة ورقة العمل
                                                        </button>
                                                    </div>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <div>
                                                            <label className="text-xs text-muted-foreground block mb-1">الخصم (د.ع)</label>
                                                            <input inputMode="numeric" dir="ltr" value={withCommas(inp.discount)} onChange={e => setInput(o.id, 'discount', digitsOnly(e.target.value))} placeholder="0" className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-sm text-right focus:outline-none focus:border-amber-500 font-bold" />
                                                        </div>
                                                        <div>
                                                            <label className="text-xs text-muted-foreground block mb-1">المبلغ الواصل (د.ع)</label>
                                                            <input inputMode="numeric" dir="ltr" value={withCommas(inp.received)} onChange={e => setInput(o.id, 'received', digitsOnly(e.target.value))} placeholder={o.contract_id ? "0" : withCommas(net)} className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-sm text-right focus:outline-none focus:border-emerald-500 font-bold" />
                                                        </div>
                                                    </div>
                                                    {o.contract_id && (
                                                        <p className="text-[11px] text-amber-400 leading-relaxed">
                                                            فاتورة آجلة على عقد {o.contract?.name || ""}: تُغلق بصفر واصل ويُضاف صافيها إلى رصيد العقد. اكتب مبلغاً فقط إذا دُفع شيء الآن.
                                                        </p>
                                                    )}
                                                    <div className="flex items-center justify-between text-sm pt-1 border-t border-border/60">
                                                        <span className="text-muted-foreground">الصافي بعد الخصم</span>
                                                        <span className="font-bold text-foreground">{net.toLocaleString('en-US')} د.ع</span>
                                                    </div>
                                                    <button disabled={savingId === o.id} onClick={() => closeAccounting(o)} className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-60">
                                                        {savingId === o.id ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} إغلاق ومحاسبة الفاتورة
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>

        {/* ── Daily closing report (print only) ── */}
        <div className="hidden print:block text-black bg-white p-6" dir="rtl" style={{ fontFamily: "'IBM Plex Sans Arabic', sans-serif" }}>
            {(() => {
                const rows = closedOrders.filter(o => !isAuditExcluded(o));
                const branchName = selectedBranchId ? (branches.find(b => b.id === selectedBranchId)?.name || '') : 'كل الفروع';
                const [yy, mm, dd] = selectedDate.split('-');
                return (
                    <>
                        <div className="flex items-center justify-between border-b-2 border-black pb-3 mb-4">
                            <div>
                                <h1 className="text-xl font-black">هندسة السيارات — تقرير الإغلاق اليومي</h1>
                                <p className="text-xs mt-1">الفرع: {branchName}</p>
                            </div>
                            <div className="text-left text-xs">
                                <p>تاريخ المحاسبة: <b>{dd}/{mm}/{yy}</b></p>
                                <p>عدد الفواتير: <b>{rows.length}</b></p>
                            </div>
                        </div>
                        <table className="w-full text-right border-collapse text-[11px]">
                            <thead>
                                <tr className="bg-gray-200">
                                    <th className="p-1.5 border border-gray-500">#</th>
                                    <th className="p-1.5 border border-gray-500">الوقت</th>
                                    <th className="p-1.5 border border-gray-500">الزبون</th>
                                    <th className="p-1.5 border border-gray-500">السيارة</th>
                                    <th className="p-1.5 border border-gray-500">المجموع</th>
                                    <th className="p-1.5 border border-gray-500">الخصم</th>
                                    <th className="p-1.5 border border-gray-500">الواصل</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(o => {
                                    const v = vehicleOf(o); const c = clientOf(o); const p = pricingOf(o);
                                    const g = num(p.grandTotal ?? o.total_price);
                                    const disc = num(p.discount);
                                    const rec = num(p.amountReceived ?? (o.order_type === 'sale' ? o.total_price : 0));
                                    const stamp = o.order_type === 'sale' ? o.created_at : (p.accountedAt || o.completed_at);
                                    return (
                                        <tr key={o.id}>
                                            <td className="p-1.5 border border-gray-500 font-bold">#{o.report_number}</td>
                                            <td className="p-1.5 border border-gray-500" dir="ltr">{fmtDateTime(stamp).split(' ').slice(1).join(' ')}</td>
                                            <td className="p-1.5 border border-gray-500">{c?.name || (o.order_type === 'sale' ? 'عميل نقدي' : '—')}</td>
                                            <td className="p-1.5 border border-gray-500">{o.order_type === 'sale' ? 'بيع منتج' : `${v?.make || ''} ${v?.model || ''}`.trim()}</td>
                                            <td className="p-1.5 border border-gray-500 text-center" dir="ltr">{g.toLocaleString('en-US')}</td>
                                            <td className="p-1.5 border border-gray-500 text-center" dir="ltr">{disc.toLocaleString('en-US')}</td>
                                            <td className="p-1.5 border border-gray-500 text-center" dir="ltr">{rec.toLocaleString('en-US')}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot>
                                <tr className="bg-gray-200 font-black">
                                    <td className="p-1.5 border border-gray-500" colSpan={4}>المجموع الكلي لليوم</td>
                                    <td className="p-1.5 border border-gray-500 text-center" dir="ltr">{summary.grand.toLocaleString('en-US')}</td>
                                    <td className="p-1.5 border border-gray-500 text-center" dir="ltr">{summary.discount.toLocaleString('en-US')}</td>
                                    <td className="p-1.5 border border-gray-500 text-center" dir="ltr">{summary.received.toLocaleString('en-US')}</td>
                                </tr>
                            </tfoot>
                        </table>
                        <div className="flex justify-between mt-10 text-xs font-bold">
                            <div>توقيع المحاسب: ______________________</div>
                            <div>توقيع الإدارة: ______________________</div>
                        </div>
                    </>
                );
            })()}
        </div>
        </div>
    );
}

function SummaryCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
    return (
        <div className="glass-card rounded-2xl border border-border p-4">
            <div className={`flex items-center gap-2 mb-1 ${color}`}>{icon}<span className="text-[11px] text-muted-foreground font-bold">{label}</span></div>
            <div className={`text-xl font-black ${color}`}>{value.toLocaleString('en-US')} <span className="text-xs">د.ع</span></div>
        </div>
    );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
    return (
        <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className={strong ? "font-black text-foreground" : "font-mono text-muted-foreground"}>{value}</span>
        </div>
    );
}
