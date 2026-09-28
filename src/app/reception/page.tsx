"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthProvider";
import { supabase } from "@/lib/supabase";
import { reopenWorkOrder } from "@/lib/reopenOrder";
import {
    UserPlus, Car, Loader2,
    FileText, Printer, Edit2, X, Trash2, ShoppingCart, RefreshCcw, ClipboardList
} from "lucide-react";
import { showConfirm, showSuccess, showError } from "@/lib/alerts";
import { PrintableInspectionReport } from "@/components/PrintableInspectionReport";
import StandardReception from "./components/StandardReception";
import SectorReception from "./components/SectorReception";
import SaleForm from "./components/SaleForm";
import InspectionForm from "./components/InspectionForm";

const ORDER_SELECT = `id, report_number, status, order_type, branch_id, created_at, total_price, selected_services, vehicles (make, model, plate_number, clients (name, phone))`;
// Inner-join variant so filters on the embedded vehicle/client actually narrow the rows.
const ORDER_SELECT_INNER = `id, report_number, status, order_type, branch_id, created_at, total_price, selected_services, vehicles!inner (make, model, plate_number, clients!inner (name, phone))`;

const isAccounted = (o: any) => {
    if (o.order_type === 'sale') return true;
    const p = (Array.isArray(o.selected_services) ? o.selected_services[0] : o.selected_services)?.pricing;
    return p?.accounted === true;
};

// The fields shown for one order, derived once and rendered by both the desktop
// table and the phone card list so the two can never drift apart.
const orderView = (o: any) => {
    const vehicle = Array.isArray(o.vehicles) ? o.vehicles[0] : o.vehicles;
    const client = vehicle ? (Array.isArray(vehicle.clients) ? vehicle.clients[0] : vehicle.clients) : null;
    const isSale = o.order_type === 'sale';
    const salePayload = isSale ? (Array.isArray(o.selected_services) ? o.selected_services[0] : o.selected_services) : null;
    // Numeric DD/MM/YYYY — no month names.
    const d0 = new Date(o.created_at);
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const done = o.status === 'تم الانتهاء';

    return {
        isSale,
        name: isSale ? (salePayload?.customerName || 'عميل نقدي') : (client?.name || 'عميل نقدي'),
        phone: isSale ? (salePayload?.customerPhone || '-') : (client?.phone || '-'),
        item: isSale
            ? ((Array.isArray(salePayload?.products) && salePayload.products.length
                ? salePayload.products.map((p: any) => p?.name).filter(Boolean).join('، ')
                : '') || '—')
            : `${vehicle?.make || ''} ${vehicle?.model || ''}`.trim(),
        plate: isSale ? '—' : (vehicle?.plate_number || 'بدون لوحة'),
        date: `${pad2(d0.getDate())}/${pad2(d0.getMonth() + 1)}/${d0.getFullYear()}`,
        statusLabel: done
            ? (isAccounted(o) ? 'تم الانتهاء' : 'في انتظار المحاسبة')
            : o.status === 'قيد العمل' ? 'قيد العمل' : 'انتظار',
        statusClass: done
            ? (isAccounted(o)
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20')
            : o.status === 'قيد العمل'
                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                : 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
    };
};

function ReceptionContainer() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const { employeeBranchId, employeeRole, permissionReception, loading: authLoading } = useAuth();
    const editId = searchParams.get('edit');
    const saleParam = searchParams.get('sale');
    const inspectionParam = searchParams.get('inspection'); // vehicleId to inspect (from customer file)
    const vehicleParam = searchParams.get('vehicle'); // vehicleId to prefill a NEW work order (barcode scan flow)
    // Contract (عقد) orders are only ever started from the contracts tab, which links here with
    // ?contract=<id>. The forms read it themselves and tag the order; reception staff never pick it.
    const contractParam = searchParams.get('contract');
    const [isWizardOpen, setIsWizardOpen] = useState(false);
    // When true the wizard opens as a direct product sale ("بيع منتج") instead of a work order.
    const [wizardSaleMode, setWizardSaleMode] = useState(false);
    const [inspectionMode, setInspectionMode] = useState(false);
    // null = still loading order_type for the order being edited; true/false once known.
    const [editIsSale, setEditIsSale] = useState<boolean | null>(null);
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    // ---------- Branches ----------
    const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
    // "" is a real choice here — it means كل الفروع for the list below.
    const [selectedBranchId, setSelectedBranchId] = useState<string>("");
    // A new work order always needs one concrete branch, so remember the last real one
    // the user was on. Without it, opening the wizard from the كل الفروع view would
    // have no branch to file the order under (and no way to pick the right form variant).
    const [lastRealBranchId, setLastRealBranchId] = useState<string>("");
    // Guards the one-time initialisation below, so a late-resolving role/branch can't
    // clobber a branch the user has already picked on this screen.
    const branchInitDone = useRef(false);
    // Last branch seen from the sidebar switcher, so we can tell a genuine switch there
    // apart from this effect merely re-running.
    const sidebarBranchRef = useRef<string | null>(null);
    // Owner/Admin drive the branch from this page's own dropdown (which offers كل الفروع).
    // Everyone else stays locked to the branch on their employee record.
    const isBranchAdmin = employeeRole === 'Owner' || employeeRole === 'Admin';
    const isBranchPinned = !!employeeBranchId && !isBranchAdmin;
    // null = كل الفروع → no branch predicate on the list queries.
    const listBranchId = isBranchPinned ? employeeBranchId : (selectedBranchId || null);
    // The wizard can never run on "كل الفروع" — fall back to the last concrete branch.
    const wizardBranchId = selectedBranchId || lastRealBranchId || branches[0]?.id || "";

    // Branch picked from inside the wizard: narrow the list to it too, so coming back
    // out lands on the branch the order was just filed under rather than كل الفروع.
    const setWizardBranch = (id: string) => {
        setSelectedBranchId(id);
        if (id) setLastRealBranchId(id);
        try { localStorage.setItem("receptionBranchId", id); } catch {}
    };

    // ---------- Print Preview States ----------
    const [previewReportId, setPreviewReportId] = useState<string | null>(null);
    const [previewMode, setPreviewMode] = useState<'full' | 'short'>('full');
    const [previewReport, setPreviewReport] = useState<any>(null);
    const [previewLoading, setPreviewLoading] = useState(false);

    // ---------- Search (server-side: matches ANY order in the whole DB, not just the loaded page) ----------
    const [searchTerm, setSearchTerm] = useState("");
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [searching, setSearching] = useState(false);
    // Latest-wins: two in-flight searches can resolve out of order; only the newest may set state.
    const searchToken = useRef(0);
    const isSearching = searchTerm.trim().length > 0;
    const filteredOrders = isSearching ? searchResults : orders;

    useEffect(() => {
        if (editId) {
            // Editing: look up order_type so we open the sale form for sales, the work-order form otherwise.
            setWizardSaleMode(false);
            setEditIsSale(null);
            setIsWizardOpen(true);
            supabase.from('inspection_reports').select('order_type').eq('id', editId).single()
                .then(({ data }) => setEditIsSale((data as { order_type?: string } | null)?.order_type === 'sale'));
        } else if (saleParam) {
            // Opened from the "بيع منتج" button (dashboard or reception) -> /reception?sale=1.
            setWizardSaleMode(true);
            setEditIsSale(null);
            setIsWizardOpen(true);
        } else if (inspectionParam) {
            // Opened from a customer's file -> /reception?inspection=<vehicleId>.
            setInspectionMode(true);
            setEditIsSale(null);
            setIsWizardOpen(true);
        } else if (vehicleParam || contractParam) {
            // Barcode scan flow -> /reception?vehicle=<vehicleId>: open a NEW work order
            // with the customer's known info prefilled (the form reads the param itself).
            // Same for "إنشاء ورقة عمل" from the contracts tab -> /reception?contract=<id>.
            setWizardSaleMode(false);
            setInspectionMode(false);
            setEditIsSale(false);
            setIsWizardOpen(true);
        } else {
            setIsWizardOpen(false);
            setInspectionMode(false);
            setEditIsSale(null);
        }
    }, [editId, saleParam, inspectionParam, vehicleParam, contractParam]);

    // Fetch branches on mount
    useEffect(() => {
        const isAdmin = employeeRole === 'Owner' || employeeRole === 'Admin';
        let branchQuery = supabase.from('branches').select('id, name');
        // Branch-pinned staff only ever load their own branch. Owner/Admin load the whole
        // list even when the sidebar has a single branch active, so the كل الفروع option
        // below has something to widen back out to.
        if (employeeBranchId && !isAdmin) {
            branchQuery = branchQuery.eq('id', employeeBranchId);
        }
        branchQuery.then(({ data, error }) => {
            if (error || !data || data.length === 0) return;
            setBranches(data);
            if (branchInitDone.current) return;
            branchInitDone.current = true;
            sidebarBranchRef.current = employeeBranchId;

            // Pinned employee, or a single-branch install: no choice to make.
            if ((employeeBranchId && !isAdmin) || data.length === 1) {
                const only = employeeBranchId || data[0].id;
                setSelectedBranchId(only);
                setLastRealBranchId(only);
                return;
            }

            // Owner/Admin: restore the branch they last chose here so it survives
            // navigation/reload. A stored empty string means they chose كل الفروع.
            let restored: string | null = null;
            try { restored = localStorage.getItem("receptionBranchId"); } catch {}
            const storedBranch = restored && data.some(b => b.id === restored) ? restored : null;
            // Only Owner/Admin start wide; anyone else keeps opening on a single branch.
            const wantsAll = isAdmin && (restored === "" || (restored === null && !employeeBranchId));
            const concrete = storedBranch || employeeBranchId || data[0].id;
            setSelectedBranchId(wantsAll ? "" : concrete);
            setLastRealBranchId(concrete);
        });
    }, [employeeBranchId, employeeRole]);

    // Switching branch in the sidebar re-points this list too. Only a real change there
    // moves it, so the branch the user picks in the dropdown below is never clobbered.
    useEffect(() => {
        if (!branchInitDone.current) return;
        if (sidebarBranchRef.current === employeeBranchId) return;
        sidebarBranchRef.current = employeeBranchId;
        setSelectedBranchId(employeeBranchId || "");
        if (employeeBranchId) setLastRealBranchId(employeeBranchId);
    }, [employeeBranchId]);

    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    // Read inside async callbacks (realtime, wizard-close) where `page` would be stale.
    const pageRef = useRef(1);
    pageRef.current = page;

    // ── Scroll memory ────────────────────────────────────────────────────────
    // Opening a card swaps this whole list out for the wizard. Remember where the
    // user was standing so "رجوع" puts them back on the same row instead of at the
    // top of a freshly reloaded page.
    const listScrollY = useRef(0);
    // Set while navigating into the wizard, so the router's scroll-to-top (and any
    // scrolling done inside the wizard) can't overwrite the remembered position.
    const scrollLocked = useRef(false);
    const wasWizardOpen = useRef(false);

    const rememberScroll = () => {
        listScrollY.current = window.scrollY;
        scrollLocked.current = true;
    };

    useEffect(() => {
        const onScroll = () => {
            if (!scrollLocked.current) listScrollY.current = window.scrollY;
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    // Jump back to a remembered offset. The rows may still be painting, so keep
    // trying for a few frames until the page is actually tall enough to reach it.
    const restoreScroll = (y: number) => {
        if (y <= 0) return;
        let attempts = 0;
        const tick = () => {
            window.scrollTo(0, y);
            if (Math.abs(window.scrollY - y) > 2 && attempts++ < 20) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    };

    // Silent refresh: re-fetch every page the user has already loaded and swap the
    // rows in WITHOUT blanking the table. Used by realtime and when returning from
    // the wizard, so the list never collapses to a spinner under the user — that
    // was what threw them back to the top mid-review.
    const refreshLoadedOrders = async (restoreTo?: number) => {
        const count = Math.min(pageRef.current * 50, 1000);
        let query = supabase
            .from('inspection_reports')
            .select(ORDER_SELECT)
            .order('created_at', { ascending: false })
            .order('report_number', { ascending: false })
            .range(0, count - 1);

        if (listBranchId) {
            query = query.eq('branch_id', listBranchId);
        }

        const { data } = await query;
        if (data) {
            setOrders(data);
            setHasMore(data.length >= count);
        }
        setLoading(false);
        if (restoreTo) restoreScroll(restoreTo);
    };

    const fetchOrders = async (resetPage = false) => {
        const targetPage = resetPage ? 1 : page;
        if (resetPage) {
            setPage(1);
        }
        if (targetPage === 1) setLoading(true);
        let query = supabase
            .from('inspection_reports')
            .select(ORDER_SELECT)
            .order('created_at', { ascending: false })
            .order('report_number', { ascending: false }) // tiebreaker: newest order number first when dates tie
            .range((targetPage - 1) * 50, targetPage * 50 - 1);
        
        if (listBranchId) {
            query = query.eq('branch_id', listBranchId);
        }
        
        const { data } = await query;
        if (data) {
            if (data.length < 50) setHasMore(false);
            else setHasMore(true);

            if (targetPage === 1) setOrders(data);
            else setOrders(prev => [...prev, ...data]);
        }
        setLoading(false);
    };

    useEffect(() => {
        const returningFromWizard = wasWizardOpen.current && !isWizardOpen;
        wasWizardOpen.current = isWizardOpen;
        if (isWizardOpen) return;

        if (returningFromWizard) {
            // Capture the target before re-enabling the scroll listener, so nothing
            // can overwrite it while the rows are coming back.
            const restoreTo = listScrollY.current;
            scrollLocked.current = false;
            // Keep every page the user had loaded — resetting to the first 50 rows
            // was half of why "رجوع" never landed back on the same row.
            refreshLoadedOrders(restoreTo);
        } else {
            fetchOrders(true);
        }
    }, [isWizardOpen, employeeBranchId, selectedBranchId, listBranchId]);

    useEffect(() => {
        if (page > 1) {
            fetchOrders(false);
        }
    }, [page]);

    useEffect(() => {
        // Trailing debounce: bursts of realtime events collapse into one silent refresh.
        let timer: ReturnType<typeof setTimeout> | null = null;
        const channel = supabase.channel('reception_realtime')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'inspection_reports' }, () => {
                // Silent: any order changing anywhere in the workshop used to wipe the
                // table to a spinner and reset it to the first 50 rows mid-read.
                if (timer) clearTimeout(timer);
                timer = setTimeout(() => refreshLoadedOrders(), 500);
            })
            .subscribe();
        return () => {
            if (timer) clearTimeout(timer);
            supabase.removeChannel(channel);
        };
    }, [employeeBranchId, selectedBranchId, listBranchId]);

    // Server-side search (debounced): an order number / name / phone / plate now matches even if
    // it lives on an older, not-yet-loaded page — no need to press "تحميل المزيد" first.
    useEffect(() => {
        const term = searchTerm.trim();
        if (!term) { setSearchResults([]); setSearching(false); return; }
        setSearching(true);
        const handle = setTimeout(async () => {
            const token = ++searchToken.current;
            const branchId = listBranchId;
            const applyBranch = (q: any) => branchId ? q.eq('branch_id', branchId) : q;
            const digits = term.replace(/\D/g, "");
            const like = `%${term}%`;
            const runs: Promise<any[]>[] = [];
            // 1) exact order number — the main case
            if (/^\d+$/.test(term)) {
                runs.push(applyBranch(
                    supabase.from('inspection_reports').select(ORDER_SELECT).eq('report_number', parseInt(term, 10)).limit(50)
                ).then((r: any) => r.data || []).catch(() => []));
            }
            // 2) customer name / phone
            runs.push(applyBranch(
                supabase.from('inspection_reports').select(ORDER_SELECT_INNER)
                    .or(`name.ilike.${like}${digits ? `,phone.ilike.%${digits}%` : ""}`, { referencedTable: 'vehicles.clients' })
                    .order('created_at', { ascending: false }).limit(50)
            ).then((r: any) => r.data || []).catch(() => []));
            // 3) vehicle plate / make / model
            runs.push(applyBranch(
                supabase.from('inspection_reports').select(ORDER_SELECT_INNER)
                    .or(`plate_number.ilike.${like},make.ilike.${like},model.ilike.${like}`, { referencedTable: 'vehicles' })
                    .order('created_at', { ascending: false }).limit(50)
            ).then((r: any) => r.data || []).catch(() => []));
            const lists = await Promise.all(runs);
            if (token !== searchToken.current) return; // a newer search superseded this one
            const seen = new Set<string>();
            const merged: any[] = [];
            lists.flat().forEach((o: any) => { if (o && !seen.has(o.id)) { seen.add(o.id); merged.push(o); } });
            merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            setSearchResults(merged);
            setSearching(false);
        }, 300);
        return () => clearTimeout(handle);
    }, [searchTerm, selectedBranchId, employeeBranchId, listBranchId]);

    // Fetch preview details
    useEffect(() => {
        if (!previewReportId) {
            setPreviewReport(null);
            return;
        }
        const fetchPreview = async () => {
            setPreviewLoading(true);
            const { data } = await supabase
                .from("inspection_reports")
                .select(`
                    id, report_number, status, created_at, completed_at, odometer_reading,
                    estimated_duration, elapsed_time, start_time, selected_services, notes, branch_id,
                    branches(id, name),
                    vehicles (make, model, plate_number, engine_size, booklet_serial, clients (name, phone)),
                    receptionist:receptionist_id(name)
                `)
                .eq("id", previewReportId)
                .single();
            if (data) {
                setPreviewReport(data);
            }
            setPreviewLoading(false);
        };
        fetchPreview();
    }, [previewReportId]);

    const handleDeleteOrder = async (orderId: string, orderNumber: string) => {
        const confirm = await showConfirm(
            "حذف أمر العمل",
            `هل أنت متأكد من حذف أمر العمل رقم #${orderNumber}؟ لا يمكن التراجع عن هذا الإجراء.`
        );
        if (!confirm) return;

        try {
            const { error } = await supabase.from('inspection_reports').delete().eq('id', orderId);
            if (error) throw error;
            showSuccess("تم الحذف", `تم حذف أمر العمل #${orderNumber} بنجاح.`);
            setOrders(prev => prev.filter(o => o.id !== orderId));
        } catch (err: any) {
            console.error(err);
            showError("خطأ في الحذف", err.message || "تعذر حذف أمر العمل.");
        }
    };

    // إرجاع للعمل: send a finished order back to "قيد العمل" (same behaviour as the customers page).
    const handleReopenOrder = async (orderId: string, orderNumber: string) => {
        const confirm = await showConfirm(
            "إرجاع السيارة للعمل",
            `هل أنت متأكد من إرجاع المركبة في أمر العمل #${orderNumber} إلى ساحة العمل (قيد العمل)؟`,
            "نعم، إرجاع للعمل",
            false
        );
        if (!confirm) return;
        try {
            // Shared helper: also un-accounts an already-closed invoice so it comes
            // back to التدقيق after the new work — see src/lib/reopenOrder.ts.
            const { error } = await reopenWorkOrder(orderId);
            if (error) throw error;
            showSuccess("تمت إعادة الفتح", "تمت إعادة المركبة إلى قيد العمل بنجاح.");
            setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'قيد العمل' } : o));
        } catch (err: any) {
            console.error(err);
            showError("خطأ", err.message || "تعذر إرجاع أمر العمل.");
        }
    };

    // The row actions, shared by the desktop table and the phone cards. Buttons keep a
    // 44px touch target on phones (Apple's minimum) and shrink to the compact icon size
    // from md up, where they sit in a table cell.
    const renderActions = (o: any, isSale: boolean) => {
        const btn = "p-2.5 md:p-2 min-w-11 min-h-11 md:min-w-0 md:min-h-0 flex items-center justify-center rounded-xl border transition-all";
        return (
            <>
                {!isSale && (
                    <>
                        <button
                            onClick={() => { setPreviewReportId(o.id); setPreviewMode('full'); }}
                            className={`${btn} bg-blue-600/10 text-blue-400 border-blue-500/20 hover:bg-blue-600 hover:text-white`}
                            title="معاينة وطباعة شاملة"
                        >
                            <Printer size={16} />
                        </button>
                        <button
                            onClick={() => { setPreviewReportId(o.id); setPreviewMode('short'); }}
                            className={`${btn} bg-amber-600/10 text-amber-400 border-amber-500/20 hover:bg-amber-600 hover:text-white`}
                            title="معاينة وطباعة مختصرة للفني"
                        >
                            <FileText size={16} />
                        </button>
                    </>
                )}
                <button
                    onClick={() => {
                        rememberScroll();
                        if (o.branch_id) setSelectedBranchId(o.branch_id);
                        router.push(`/reception?edit=${o.id}`);
                    }}
                    className={`${btn} bg-rose-600/10 text-rose-400 border-rose-500/20 hover:bg-rose-600 hover:text-white`}
                    title="تعديل أمر العمل"
                >
                    <Edit2 size={16} />
                </button>
                {o.status === 'تم الانتهاء' && (
                    <button
                        onClick={() => handleReopenOrder(o.id, o.report_number)}
                        className={`${btn} bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500 hover:text-white`}
                        title="إرجاع السيارة للعمل"
                    >
                        <RefreshCcw size={16} />
                    </button>
                )}
                <button
                    onClick={() => handleDeleteOrder(o.id, o.report_number)}
                    className={`${btn} bg-rose-600/10 text-rose-400 border-rose-500/20 hover:bg-rose-600 hover:text-white`}
                    title="حذف أمر العمل"
                >
                    <Trash2 size={16} />
                </button>
            </>
        );
    };

    if (authLoading) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <Loader2 className="animate-spin text-emerald-500 w-12 h-12" />
            </div>
        );
    }

    if (employeeRole !== 'Owner' && !permissionReception) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center p-4 text-center font-ibm" dir="rtl">
                <div className="glass-card p-8 rounded-3xl border border-rose-500/20 max-w-md w-full">
                    <h2 className="text-2xl font-bold text-rose-500 mb-2">غير مصرح بالوصول</h2>
                    <p className="text-muted-foreground mb-6">ليس لديك صلاحية للوصول إلى نظام الاستقبال وأوامر العمل.</p>
                </div>
            </div>
        );
    }

    // The wizard always runs against one concrete branch, never "كل الفروع".
    const selectedBranch = branches.find(b => b.id === wizardBranchId);
    const isSectorBranch = selectedBranch?.name === 'القطاع' || selectedBranch?.name === 'فرع القطاع';

    if (isWizardOpen) {
        const onCloseWizard = () => {
            setIsWizardOpen(false);
            setWizardSaleMode(false);
            setInspectionMode(false);
            setEditIsSale(null);
            // Opened from the contracts tab: go back there, not to the reception list.
            if (contractParam) { router.push('/contracts'); return; }
            // scroll:false — we restore the remembered position ourselves once the
            // rows are back; letting the router jump to the top first would undo it.
            router.replace('/reception', { scroll: false });
        };

        // Comprehensive inspection (فحص شامل) — standalone form.
        if (inspectionMode) {
            return (
                <InspectionForm
                    branches={branches}
                    selectedBranchId={wizardBranchId}
                    setSelectedBranchId={setWizardBranch}
                    onClose={onCloseWizard}
                    initialVehicleId={inspectionParam && inspectionParam !== "1" ? inspectionParam : undefined}
                />
            );
        }

        // New sale, or editing an existing sale -> lightweight sale form.
        if (wizardSaleMode || editIsSale === true) {
            return (
                <SaleForm
                    branches={branches}
                    selectedBranchId={wizardBranchId}
                    setSelectedBranchId={setWizardBranch}
                    onClose={onCloseWizard}
                />
            );
        }

        // Editing: wait until we know whether it's a sale, so the wrong form doesn't flash.
        if (editId && editIsSale === null) {
            return (
                <div className="min-h-screen flex items-center justify-center">
                    <Loader2 className="animate-spin text-rose-500 w-10 h-10" />
                </div>
            );
        }

        return isSectorBranch ? (
            <SectorReception
                branches={branches}
                selectedBranchId={wizardBranchId}
                setSelectedBranchId={setWizardBranch}
                onClose={onCloseWizard}
            />
        ) : (
            <StandardReception
                branches={branches}
                selectedBranchId={wizardBranchId}
                setSelectedBranchId={setWizardBranch}
                onClose={onCloseWizard}
            />
        );
    }

    return (
        <div className="min-h-screen bg-background p-4 md:p-8 font-ibm" dir="rtl">
            <div className="max-w-7xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4">
                    <div>
                        <h1 className="text-2xl md:text-3xl font-display font-bold text-foreground">الاستقبال وأوامر العمل</h1>
                        <p className="text-muted-foreground text-xs md:text-sm mt-1">إدارة كروت فحص المركبات وتسجيل دخول السيارات للورشة</p>
                    </div>

                    {/* Phones: each action gets its own full-width row — wrapping left the
                        three buttons ragged and hard to hit. From sm up they sit inline. */}
                    <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:items-center">
                        {/* Branch Selector on Dashboard */}
                        {branches.length > 1 && (employeeRole === 'Owner' || employeeRole === 'Admin') && (
                            <select
                                value={selectedBranchId}
                                onChange={e => {
                                    const id = e.target.value;
                                    setSelectedBranchId(id);
                                    // "" (كل الفروع) is remembered too, but the wizard keeps
                                    // the last concrete branch to file new orders under.
                                    if (id) setLastRealBranchId(id);
                                    try { localStorage.setItem("receptionBranchId", id); } catch {}
                                    setPage(1);
                                }}
                                className="w-full sm:w-auto bg-card border border-border rounded-xl px-4 py-3 sm:py-2.5 text-sm text-foreground focus:outline-none focus:border-rose-500/50 cursor-pointer"
                            >
                                <option value="">كل الفروع</option>
                                {branches.map(b => (
                                    <option key={b.id} value={b.id}>{b.name}</option>
                                ))}
                            </select>
                        )}
                        <button
                            onClick={() => { rememberScroll(); setWizardSaleMode(false); setIsWizardOpen(true); }}
                            className="w-full sm:w-auto justify-center px-6 py-3.5 sm:py-3 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-2xl shadow-lg shadow-rose-500/20 transition-all flex items-center gap-2 text-sm"
                        >
                            <UserPlus size={18} /> إنشاء كرت فحص جديد
                        </button>
                        <button
                            onClick={() => { rememberScroll(); setWizardSaleMode(true); setIsWizardOpen(true); }}
                            className="w-full sm:w-auto justify-center px-6 py-3.5 sm:py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-2xl shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-2 text-sm"
                        >
                            <ShoppingCart size={18} /> بيع منتج
                        </button>
                        <button
                            onClick={() => { rememberScroll(); setInspectionMode(true); setIsWizardOpen(true); }}
                            className="w-full sm:w-auto justify-center px-6 py-3.5 sm:py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-2xl shadow-lg shadow-blue-500/20 transition-all flex items-center gap-2 text-sm"
                        >
                            <ClipboardList size={18} /> فحص شامل
                        </button>
                    </div>
                </div>

                {/* Orders table */}
                <div className="glass-card rounded-3xl border border-border/50 overflow-hidden">
                    <div className="p-4 md:p-6 border-b border-border/50 bg-card/30 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4">
                        <h2 className="font-bold text-lg text-foreground shrink-0">سجل أوامر العمل</h2>
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="بحث برقم الكرت، العميل، الهاتف، المركبة، أو اللوحة..."
                            className="input-field w-full sm:max-w-sm"
                        />
                    </div>

                    {(loading && !isSearching) || (isSearching && searching) ? (
                        <div className="p-20 text-center">
                            <Loader2 className="animate-spin text-rose-500 w-10 h-10 mx-auto" />
                        </div>
                    ) : filteredOrders.length === 0 ? (
                        <div className="p-20 text-center text-muted-foreground space-y-4">
                            <Car size={48} className="mx-auto text-muted-foreground/50" />
                            <p>{isSearching ? "لا توجد نتائج مطابقة للبحث." : "لا توجد أوامر عمل مسجلة حالياً."}</p>
                        </div>
                    ) : (
                        <>
                        {/* Desktop table */}
                        <div className="hidden md:block overflow-x-auto">
                            <table className="w-full text-right border-collapse">
                                <thead>
                                    <tr className="bg-muted/40 text-muted-foreground text-xs font-bold border-b border-border/50">
                                        <th className="p-4">رقم الكرت</th>
                                        <th className="p-4">العميل</th>
                                        <th className="p-4">رقم الهاتف</th>
                                        <th className="p-4">المركبة</th>
                                        <th className="p-4">لوحة السيارة</th>
                                        <th className="p-4">الحالة</th>
                                        <th className="p-4">التاريخ</th>
                                        <th className="p-4 text-center">الإجراءات</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/30 text-sm">
                                    {filteredOrders.map((o: any) => {
                                        const v = orderView(o);
                                        return (
                                            <tr key={o.id} className="hover:bg-muted/20 transition-colors">
                                                <td className="p-4 font-mono font-bold text-rose-400">
                                                    <span className="inline-flex items-center gap-2">
                                                        #{o.report_number}
                                                        {v.isSale && (
                                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">بيع منتج</span>
                                                        )}
                                                    </span>
                                                </td>
                                                <td className="p-4 font-bold">{v.name}</td>
                                                <td className="p-4 text-muted-foreground font-mono">{v.phone}</td>
                                                <td className="p-4 font-bold">
                                                    {v.isSale ? <span className="text-emerald-400">{v.item}</span> : v.item}
                                                </td>
                                                <td className="p-4 font-mono text-xs">{v.plate}</td>
                                                <td className="p-4">
                                                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap ${v.statusClass}`}>
                                                        {v.statusLabel}
                                                    </span>
                                                </td>
                                                <td className="p-4 text-muted-foreground text-xs font-mono">{v.date}</td>
                                                <td className="p-4 text-center">
                                                    <div className="flex gap-2 justify-center">{renderActions(o, v.isSale)}</div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Phone card list — the 8-column table only ever showed its first
                            three columns on a phone; the rest were cut off past the edge. */}
                        <div className="md:hidden divide-y divide-border/30">
                            {filteredOrders.map((o: any) => {
                                const v = orderView(o);
                                return (
                                    <div key={o.id} className="p-4 space-y-3">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-mono font-bold text-rose-400">#{o.report_number}</span>
                                                    {v.isSale && (
                                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">بيع منتج</span>
                                                    )}
                                                </div>
                                                <p className="font-bold text-foreground mt-1 truncate">{v.name}</p>
                                                <p className="text-muted-foreground text-xs font-mono mt-0.5" dir="ltr">{v.phone}</p>
                                            </div>
                                            <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap shrink-0 ${v.statusClass}`}>
                                                {v.statusLabel}
                                            </span>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                                            <span className={`font-bold ${v.isSale ? 'text-emerald-400' : 'text-foreground'}`}>{v.item || '—'}</span>
                                            {!v.isSale && (
                                                <span className="font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{v.plate}</span>
                                            )}
                                            <span className="font-mono text-muted-foreground">{v.date}</span>
                                        </div>

                                        <div className="flex flex-wrap gap-2">{renderActions(o, v.isSale)}</div>
                                    </div>
                                );
                            })}
                        </div>
                        </>
                    )}
                    
                    {/* Load More Button (browse only — search already spans the whole database) */}
                    {!loading && !isSearching && orders.length > 0 && hasMore && (
                        <div className="p-6 text-center border-t border-border/50">
                            <button
                                onClick={() => setPage(p => p + 1)}
                                className="px-6 py-2 bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground font-bold rounded-xl transition-all"
                            >
                                تحميل المزيد (أقدم) ...
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {previewReportId && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 z-[9998] bg-black/80 backdrop-blur-sm"
                        onClick={() => setPreviewReportId(null)}
                    />
                    {/* Center wrapper */}
                    <div
                        className="fixed inset-0 z-[9999] font-ibm"
                        style={{ display: 'grid', alignItems: 'start', justifyItems: 'center', padding: '16px', paddingTop: '24px' }}
                    >
                        <div
                            className="bg-card border border-cyan-900/30 rounded-3xl shadow-[0_0_60px_rgba(6,182,212,0.15)] animate-scale-in flex flex-col overflow-hidden w-full"
                            style={{ maxHeight: '90vh', maxWidth: '900px' }}
                            dir="rtl"
                        >
                            {/* Header — wraps on mobile so the close (X) is always reachable */}
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 px-4 sm:px-6 py-3 flex-shrink-0">
                                <div className="flex items-center gap-2 min-w-0">
                                    <button
                                        onClick={() => setPreviewReportId(null)}
                                        className="p-2 bg-rose-500/10 hover:bg-rose-600 hover:text-white text-rose-400 rounded-xl transition-all border border-rose-500/30 shrink-0"
                                        title="إغلاق"
                                    >
                                        <X size={18} />
                                    </button>
                                    <h3 className="text-base sm:text-xl font-bold text-foreground truncate">🔍 معاينة التقرير</h3>
                                    {previewReport && (
                                        <span className="text-xs bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 rounded-lg px-2 py-1 font-mono shrink-0">
                                            #{previewReport.report_number}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 flex-wrap justify-end">
                                    <div className="flex bg-muted rounded-xl p-1 border border-border/40">
                                        <button
                                            onClick={() => setPreviewMode('full')}
                                            className={`px-2.5 sm:px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${previewMode === 'full' ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-600/20' : 'text-muted-foreground hover:text-foreground'}`}
                                        >
                                            شامل (للعميل)
                                        </button>
                                        <button
                                            onClick={() => setPreviewMode('short')}
                                            className={`px-2.5 sm:px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${previewMode === 'short' ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-600/20' : 'text-muted-foreground hover:text-foreground'}`}
                                        >
                                            مختصر (للفني)
                                        </button>
                                    </div>
                                    <button
                                        onClick={() => window.open(`/print/${previewReportId}?mode=${previewMode}`, '_blank')}
                                        className="flex items-center gap-1.5 px-3 sm:px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl transition-all shadow-lg hover:shadow-emerald-600/20 text-xs"
                                    >
                                        <Printer size={16} /> <span className="hidden sm:inline">إرسال للطباعة</span> 🖨️
                                    </button>
                                </div>
                            </div>

                            {/* Scrollable preview */}
                            <div className="flex-1 overflow-auto bg-neutral-950/60 p-4 flex justify-center items-start min-h-0">
                                {previewLoading ? (
                                    <div className="flex flex-col items-center justify-center gap-3 py-20">
                                        <Loader2 className="animate-spin text-cyan-500 w-10 h-10" />
                                        <p className="text-sm text-muted-foreground">جاري تحميل تفاصيل الفاتورة...</p>
                                    </div>
                                ) : previewReport ? (
                                    <div
                                        className="bg-white rounded-2xl shadow-2xl print-preview-doc"
                                        style={{ zoom: '0.68', minWidth: '800px' }}
                                    >
                                        <PrintableInspectionReport report={previewReport} mode={previewMode} />
                                    </div>
                                ) : (
                                    <div className="text-center text-muted-foreground py-10">حدث خطأ أثناء تحميل التقرير.</div>
                                )}
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

export default function ReceptionPage() {
    return (
        <Suspense fallback={<div className="p-20 text-center"><Loader2 className="animate-spin text-rose-500 w-10 h-10 mx-auto" /></div>}>
            <ReceptionContainer />
        </Suspense>
    );
}
