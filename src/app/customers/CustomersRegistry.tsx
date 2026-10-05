"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { useAuth } from "@/lib/AuthProvider";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { reopenWorkOrder } from "@/lib/reopenOrder";
import { 
    Users, User, Search, Download, Plus, MapPin, Phone,
    Car, FileText, ChevronLeft, ChevronRight, ShieldAlert,
    Trash2, Edit2, FolderOpen, Calendar, Save, X, Wrench, Loader2,
    CheckCircle2, ShieldCheck, Droplets, Gauge, RefreshCcw, Landmark, ArrowLeftRight
} from "lucide-react";
import { showConfirm, showError, showSuccess } from "@/lib/alerts";
import { INSPECTION_SECTIONS } from "@/lib/comprehensiveInspection";
import { normalizeBookletCode } from "@/lib/booklet";
import { useContracts } from "@/lib/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as XLSX from 'xlsx';

type ClientWithVehicles = {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    created_at: string;
    vehicles: any[];
    latestStatus: string;
    branchIds: string[];
    branchNames: string[];
    allReports: any[];
    driverRoute: string;
};

const isAccounted = (o: any) => {
    if (o.order_type === 'sale') return true;
    const p = (Array.isArray(o.selected_services) ? o.selected_services[0] : o.selected_services)?.pricing;
    return p?.accounted === true;
};

/**
 * سجل العملاء والمركبات — used by two tabs that must look and behave identically:
 *
 *  - /customers  (no `contract`): ordinary customers. Contract orders are left out,
 *    and so are customers whose every order is a contract order.
 *  - /contracts  (`contract` given): the same registry, holding ONLY that contract's
 *    orders and the customers who have them.
 *
 * One component on purpose: every fix to the customer file lands in both tabs.
 */
export default function CustomersRegistry({ contract = null, topSlot = null }: {
    contract?: { id: string; name: string } | null;
    /** Extra block shown under the header (the contracts tab puts its balance here). */
    topSlot?: React.ReactNode;
} = {}) {
    const cid = contract?.id || null;
    const { t } = useLanguage();
    const router = useRouter();
    const { employeeRole, employeeBranchId, permissionCustomers, allowedPages, loading: authLoading } = useAuth();
    const isOwnerOrAdmin = employeeRole === 'Owner' || employeeRole === 'Admin';
    // Hooks must run unconditionally on every render (Rules of Hooks). The access
    // guards that early-return live below, after all hooks/handlers are declared.
    const isAuthorized = cid
        ? (isOwnerOrAdmin || (Array.isArray(allowedPages) && allowedPages.includes('contracts')))
        : (employeeRole === 'Owner' || permissionCustomers);
    // Every orders query below stays on this tab's side of the split:
    // contract tab → contract_id = cid; customers tab → contract_id IS NULL.

    const [clients, setClients] = useState<ClientWithVehicles[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
    const [branchFilter, setBranchFilter] = useState("");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    // فلتر الزائر: متكرر (أكثر من زيارة) / زار أكثر من فرع — يُحسب على كل قاعدة البيانات.
    const [visitFilter, setVisitFilter] = useState<"" | "repeat" | "multibranch">("");
    // فلتر سواق الخطوط (فرع الكراج): "" = الكل، "__any__" = كل السواق، أو خط محدد.
    const [routeFilter, setRouteFilter] = useState("");
    const [driverRoutes, setDriverRoutes] = useState<string[]>([]);
    const [branches, setBranches] = useState<{id:string, name:string}[]>([]);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    // Marks the next fetch as a background one (realtime), so the list refreshes in
    // place instead of blanking to "جاري تحميل البيانات..." while the user is reading.
    const silentRefresh = useRef(false);
    // Stale-response guard: each fetch gets an incrementing id; a slow older
    // response is ignored so it can't overwrite the results of a newer filter.
    const fetchIdRef = useRef(0);
    // Cache for the visitor-type filter's qualified client ids — computing them
    // downloads ALL vehicles + reports, so don't redo it on every page click.
    const visitFilterCache = useRef<{ key: string; ids: string[]; counts: Record<string, number> } | null>(null);
    // (vehicle_id → خط السائق) pairs from فرع الكراج orders. driverRoute is only ever
    // saved on garage-branch orders, so "has a route" = "line driver". Cached per
    // refreshTrigger so page clicks don't re-scan.
    const routePairsCache = useRef<{ key: number; pairs: { vehicle_id: string; route: string }[] } | null>(null);
    const PAGE_SIZE = 25;

    // driverRoute lives inside selected_services, which no index can reach — so this
    // query MUST stay bounded. It is scoped to the garage branch (the only one that
    // writes a route) and to the newest orders. It used to page through the whole of
    // inspection_reports, dragging every order's full JSON payload across the wire on
    // every visit to this page; that alone could saturate the database.
    const GARAGE_BRANCH_NAMES = ['الكراج', 'فرع الكراج'];
    const ROUTE_SCAN_LIMIT = 2000;

    const getRoutePairs = async () => {
        if (routePairsCache.current?.key === refreshTrigger) return routePairsCache.current.pairs;
        const garageIds = branches.filter(b => GARAGE_BRANCH_NAMES.includes(b.name)).map(b => b.id);
        // Branches not loaded yet (or no garage branch): don't cache an empty result,
        // so the next call can still fill the dropdown.
        if (garageIds.length === 0) return [];
        let routeQuery = supabase
            .from('inspection_reports')
            .select('vehicle_id, route:selected_services->0->>driverRoute')
            .in('branch_id', garageIds);
        routeQuery = cid ? routeQuery.eq('contract_id', cid) : routeQuery.is('contract_id', null);
        const { data } = await routeQuery
            .not('selected_services->0->>driverRoute', 'is', null)
            .neq('selected_services->0->>driverRoute', '')
            .order('created_at', { ascending: false })
            .limit(ROUTE_SCAN_LIMIT);
        const pairs: { vehicle_id: string; route: string }[] = [];
        (data || []).forEach((r: any) => {
            const route = String(r.route || '').trim();
            if (r.vehicle_id && route) pairs.push({ vehicle_id: r.vehicle_id, route });
        });
        routePairsCache.current = { key: refreshTrigger, pairs };
        return pairs;
    };

    // Customers tab only: customers whose EVERY order is a contract order live in the
    // contracts tab, not here. Government drivers are few, so this stays a short list;
    // a customer who also brings a private car keeps appearing here for that car.
    const contractOnlyCache = useRef<{ key: number; ids: string[] } | null>(null);
    const getContractOnlyClientIds = async (): Promise<string[]> => {
        if (contractOnlyCache.current?.key === refreshTrigger) return contractOnlyCache.current.ids;
        const vehicleIds = new Set<string>();
        for (let from = 0; from < 20000; from += 1000) {
            const { data } = await supabase.from('inspection_reports').select('vehicle_id')
                .not('contract_id', 'is', null).not('vehicle_id', 'is', null).range(from, from + 999);
            (data || []).forEach(r => { if (r.vehicle_id) vehicleIds.add(r.vehicle_id); });
            if (!data || data.length < 1000) break;
        }
        const contractClients = new Set<string>();
        const vIds = [...vehicleIds];
        for (let i = 0; i < vIds.length; i += 200) {
            const { data } = await supabase.from('vehicles').select('client_id').in('id', vIds.slice(i, i + 200));
            (data || []).forEach(v => { if (v.client_id) contractClients.add(v.client_id); });
        }
        // Of those, who ALSO has an ordinary order (on any of their vehicles)?
        const cIds = [...contractClients];
        const allVehicles: { id: string; client_id: string | null }[] = [];
        for (let i = 0; i < cIds.length; i += 200) {
            const { data } = await supabase.from('vehicles').select('id, client_id').in('client_id', cIds.slice(i, i + 200));
            allVehicles.push(...(data || []));
        }
        const hasOrdinary = new Set<string>();
        for (let i = 0; i < allVehicles.length; i += 200) {
            const chunk = allVehicles.slice(i, i + 200);
            const { data } = await supabase.from('inspection_reports').select('vehicle_id')
                .is('contract_id', null).in('vehicle_id', chunk.map(v => v.id)).limit(1000);
            const withOrdinary = new Set((data || []).map(r => r.vehicle_id));
            chunk.forEach(v => { if (v.client_id && withOrdinary.has(v.id)) hasOrdinary.add(v.client_id); });
        }
        let ids = cIds.filter(id => !hasOrdinary.has(id));
        // Guard the request URL (ids go into a NOT IN list): past this size, show them
        // rather than break the whole list.
        if (ids.length > 400) ids = [];
        contractOnlyCache.current = { key: refreshTrigger, ids };
        return ids;
    };

    // Modals & Tabbed Profile
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [selectedProfile, setSelectedProfile] = useState<ClientWithVehicles | null>(null);
    const [activeProfileTab, setActiveProfileTab] = useState<string>("summary");
    const [profileBranchFilter, setProfileBranchFilter] = useState<string>(""); // filter a customer's visits by branch
    const [loadedReports, setLoadedReports] = useState<Record<string, any>>({});
    const [loadingDetails, setLoadingDetails] = useState(false);

    // Form fields (Add)
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [email, setEmail] = useState("");

    // Form fields (Edit Profile)
    const [editName, setEditName] = useState("");
    const [editPhone, setEditPhone] = useState("");
    const [editEmail, setEditEmail] = useState("");
    const [isEditingInfo, setIsEditingInfo] = useState(false);

    const [backingUp, setBackingUp] = useState(false);

    useEffect(() => {
        fetchBranches();
    }, []);

    // Populate the سواق الخطوط dropdown with the distinct routes seen on garage orders.
    // Waits for branches, since the scan is scoped to the garage branch.
    useEffect(() => {
        if (branches.length === 0) return;
        (async () => {
            const pairs = await getRoutePairs();
            setDriverRoutes([...new Set(pairs.map(p => p.route))].sort((a, b) => a.localeCompare(b, 'ar')));
        })();
    }, [refreshTrigger, branches]);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
            setCurrentPage(1);
        }, 400);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    useEffect(() => {
        setCurrentPage(1);
    }, [branchFilter, dateFrom, dateTo, visitFilter, routeFilter]);

    useEffect(() => {
        // Throttle realtime refreshes: the customer list is heavy (25 clients + all their
        // reports/payloads), so refetching on EVERY order change across the workshop caused
        // a refetch storm and slowness. Collapse bursts into one refetch every 30s.
        let timer: ReturnType<typeof setTimeout> | null = null;
        const channel = supabase.channel(cid ? 'contract_customers_realtime' : 'customers_realtime')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'inspection_reports' }, () => {
                if (timer) return;
                timer = setTimeout(() => {
                    timer = null;
                    silentRefresh.current = true;
                    setRefreshTrigger(t => t + 1);
                }, 30000);
            })
            .subscribe();
        return () => { if (timer) clearTimeout(timer); supabase.removeChannel(channel); };
    }, [cid]);

    useEffect(() => {
        if (authLoading || !isAuthorized) return;
        fetchClients();
    }, [debouncedSearchTerm, branchFilter, dateFrom, dateTo, visitFilter, routeFilter, currentPage, employeeBranchId, employeeRole, authLoading, isAuthorized, refreshTrigger]);

    const fetchBranches = async () => {
        const { data } = await supabase.from('branches').select('id, name');
        if (data) setBranches(data);
    };

    const fetchClients = async () => {
        const reqId = ++fetchIdRef.current;
        const stale = () => reqId !== fetchIdRef.current;
        const silent = silentRefresh.current;
        silentRefresh.current = false;
        if (!silent) setLoading(true);
        try {
            const activeBranchId = employeeBranchId || branchFilter;
            const hasReportFilter = !!(activeBranchId || dateFrom || dateTo || cid);

            // Search term -> a (usually small) set of matching client ids, applied via .in().
            let searchClientIds: Set<string> | null = null;
            if (debouncedSearchTerm) {
                // A laser scanner types the whole booklet URL; reduce it to the serial
                // so scanning into this box still finds the customer. Strip characters
                // that are part of the PostgREST .or() filter grammar — a comma or
                // parenthesis in the raw term corrupts the whole filter expression.
                const term = normalizeBookletCode(debouncedSearchTerm).replace(/[,()]/g, "");
                // .limit(500): a 1-char term can match thousands of rows, and every id
                // ends up in the .in('id', ...) below — past ~500 the URL gets too long.
                const { data: matchedClients } = await supabase
                    .from('clients')
                    .select('id')
                    .or(`name.ilike.%${term}%,phone.ilike.%${term}%`)
                    .limit(500);
                const { data: matchedVehicles } = await supabase
                    .from('vehicles')
                    .select('client_id')
                    .or(`plate_number.ilike.%${term}%,make.ilike.%${term}%,booklet_serial.ilike.%${term}%`)
                    .limit(500);

                if (stale()) return;

                searchClientIds = new Set<string>();
                matchedClients?.forEach(c => searchClientIds!.add(c.id));
                matchedVehicles?.forEach(v => { if (v.client_id) searchClientIds!.add(v.client_id); });

                if (searchClientIds.size === 0) {
                    setClients([]);
                    setTotalCount(0);
                    setLoading(false);
                    return;
                }
            }

            // فلتر سواق الخطوط: خط السائق محفوظ داخل payload طلبات الكراج، فلا يمكن
            // فلترته بالـ join المباشر — نحوّل (خط ← مركبات ← عملاء) إلى مجموعة ids.
            let routeClientIds: Set<string> | null = null;
            if (routeFilter) {
                const pairs = await getRoutePairs();
                const wanted = routeFilter === '__any__' ? pairs : pairs.filter(p => p.route === routeFilter);
                const vehicleIds = [...new Set(wanted.map(p => p.vehicle_id))];
                routeClientIds = new Set<string>();
                // Chunked .in() — a long id list would blow past PostgREST's URL limit.
                for (let i = 0; i < vehicleIds.length; i += 200) {
                    const { data: vs } = await supabase
                        .from('vehicles')
                        .select('id, client_id')
                        .in('id', vehicleIds.slice(i, i + 200));
                    (vs || []).forEach((v: any) => { if (v.client_id) routeClientIds!.add(v.client_id); });
                }
                if (stale()) return;
                if (routeClientIds.size === 0) {
                    setClients([]);
                    setTotalCount(0);
                    setLoading(false);
                    return;
                }
            }

            const offset = (currentPage - 1) * PAGE_SIZE;

            // Branch/date filtering is done DB-side via an inner join on the client's
            // vehicles' reports. The previous approach collected every matching vehicle
            // and client id and passed them to .in(...), which on a busy branch produced
            // a request URL too long for PostgREST (Bad Request) and showed zero customers.
            const vehiclesSelect = hasReportFilter
                ? `vehicles!inner (
                        id, make, model, plate_number, engine_size, booklet_serial,
                        inspection_reports!inner (id, report_number, status, order_type, branch_id, created_at, total_price, selected_services, branches(name))
                    )`
                : `vehicles (
                        id, make, model, plate_number, engine_size, booklet_serial,
                        inspection_reports (id, report_number, status, order_type, branch_id, created_at, total_price, selected_services, branches(name))
                    )`;

            let query = supabase
                .from('clients')
                .select(`id, name, phone, email, created_at, ${vehiclesSelect}`, { count: 'exact' });

            if (cid) query = query.eq('vehicles.inspection_reports.contract_id', cid);
            else query = query.is('vehicles.inspection_reports.contract_id', null);
            const contractOnly = cid ? [] : await getContractOnlyClientIds();
            if (stale()) return;
            if (contractOnly.length) query = query.not('id', 'in', `(${contractOnly.join(',')})`);
            if (activeBranchId) query = query.eq('vehicles.inspection_reports.branch_id', activeBranchId);
            if (dateFrom) query = query.gte('vehicles.inspection_reports.created_at', `${dateFrom}T00:00:00`);
            if (dateTo) query = query.lte('vehicles.inspection_reports.created_at', `${dateTo}T23:59:59`);
            if (searchClientIds) query = query.in('id', Array.from(searchClientIds));
            if (routeClientIds) query = query.in('id', Array.from(routeClientIds));

            // فلتر الزائر المتكرر / متعدد الفروع — يُحسب على كل قاعدة البيانات (كل الفروع)،
            // ثم يُقسَّم لصفحات محلياً حتى لا يطول رابط الطلب. الترتيب: الأكثر زيارات أولاً.
            let filterCount: number | null = null;
            if (visitFilter) {
                // The full vehicles+reports scan below is expensive, so its result is
                // cached and reused for page clicks — the key only changes when the
                // filter itself or a realtime refresh invalidates it.
                const cacheKey = JSON.stringify({ visitFilter, refreshTrigger });
                let qualified: string[];
                if (visitFilterCache.current?.key === cacheKey) {
                    qualified = visitFilterCache.current.ids;
                } else {
                    const PAGE = 1000;
                    const vehToClient = new Map<string, string>();
                    for (let from = 0; from < 100000; from += PAGE) {
                        const { data: vs } = await supabase.from('vehicles').select('id, client_id').range(from, from + PAGE - 1);
                        (vs || []).forEach((v: any) => { if (v.client_id) vehToClient.set(v.id, v.client_id); });
                        if (!vs || vs.length < PAGE) break;
                    }
                    const visitsByClient = new Map<string, number>();
                    const branchesByClient = new Map<string, Set<string>>();
                    for (let from = 0; from < 200000; from += PAGE) {
                        let rq = supabase.from('inspection_reports').select('vehicle_id, branch_id');
                        rq = cid ? rq.eq('contract_id', cid) : rq.is('contract_id', null);
                        const { data: rs } = await rq.range(from, from + PAGE - 1);
                        (rs || []).forEach((r: any) => {
                            const cid = r.vehicle_id ? vehToClient.get(r.vehicle_id) : null;
                            if (!cid) return;
                            visitsByClient.set(cid, (visitsByClient.get(cid) || 0) + 1);
                            if (r.branch_id) {
                                if (!branchesByClient.has(cid)) branchesByClient.set(cid, new Set());
                                branchesByClient.get(cid)!.add(r.branch_id);
                            }
                        });
                        if (!rs || rs.length < PAGE) break;
                    }
                    if (stale()) return;
                    qualified = visitFilter === 'repeat'
                        ? [...visitsByClient.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).map(([id]) => id)
                        : [...branchesByClient.entries()].filter(([, s]) => s.size > 1).sort((a, b) => b[1].size - a[1].size).map(([id]) => id);
                    const counts: Record<string, number> = {};
                    if (visitFilter === 'repeat') visitsByClient.forEach((n, id) => { counts[id] = n; });
                    else branchesByClient.forEach((s, id) => { counts[id] = s.size; });
                    visitFilterCache.current = { key: cacheKey, ids: qualified, counts };
                }
                if (searchClientIds) qualified = qualified.filter(id => searchClientIds!.has(id));
                if (routeClientIds) qualified = qualified.filter(id => routeClientIds!.has(id));
                if (contractOnly.length) qualified = qualified.filter(id => !contractOnly.includes(id));
                filterCount = qualified.length;
                const pageIds = qualified.slice(offset, offset + PAGE_SIZE);
                if (pageIds.length === 0) {
                    setClients([]);
                    setTotalCount(filterCount);
                    setLoading(false);
                    return;
                }
                query = query.in('id', pageIds);
            }

            let finalQuery = query.order('created_at', { ascending: false });
            if (!visitFilter) finalQuery = finalQuery.range(offset, offset + PAGE_SIZE - 1);
            const { data, count, error } = await finalQuery;
            if (stale()) return;

            if (error) throw error;

            if (data) {
                setTotalCount(filterCount ?? (count || 0));
                const mapped = data.map((c: any) => {
                    const allReports: any[] = [];
                    const branchIdSet = new Set<string>();
                    const branchNameSet = new Set<string>();

                    c.vehicles?.forEach((v: any) => {
                        v.inspection_reports?.forEach((r: any) => {
                            allReports.push({...r, vehicle: v});
                            if (r.branch_id) branchIdSet.add(r.branch_id);
                            if (r.branches?.name) branchNameSet.add(r.branches.name);
                        });
                    });

                    allReports.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

                    // خط السائق (فرع الكراج): أحدث خط مسجّل على أي من طلبات هذا العميل.
                    const driverRoute = allReports.map((r: any) => {
                        const p = Array.isArray(r.selected_services) ? r.selected_services[0] : r.selected_services;
                        return String(p?.driverRoute || '').trim();
                    }).find(Boolean) || '';

                    let latestStatus = 'لا توجد طلبات';
                    if (allReports.length > 0) {
                        const r = allReports[0];
                        const st = r.status;
                        if (st === 'completed' || st === 'تم الانتهاء') {
                            latestStatus = isAccounted(r) ? 'تم الانتهاء' : 'في انتظار المحاسبة';
                        } else if (st === 'ملغي' || st === 'cancelled') {
                            latestStatus = 'ملغى';
                        } else if (st === 'pending' || st === 'قيد الانتظار' || st === 'قيد العمل' || st === 'in_progress') {
                            latestStatus = 'قيد العمل';
                        } else {
                            latestStatus = 'انتظار';
                        }
                    }

                    const uniqueVehicles: any[] = [];
                    const seenVehKeys = new Set<string>();
                    c.vehicles?.forEach((v: any) => {
                        const makeKey = (v.make || "").trim().toLowerCase();
                        const modelKey = (v.model || "").trim().toLowerCase();
                        const plateKey = (v.plate_number || "").trim().toLowerCase();
                        const key = `${makeKey}_${modelKey}_${plateKey}`;
                        if (!seenVehKeys.has(key)) {
                            seenVehKeys.add(key);
                            uniqueVehicles.push(v);
                        }
                    });

                    return {
                        id: c.id,
                        name: c.name,
                        phone: c.phone,
                        email: c.email,
                        created_at: c.created_at,
                        vehicles: uniqueVehicles,
                        latestStatus,
                        branchIds: Array.from(branchIdSet),
                        branchNames: Array.from(branchNameSet),
                        allReports,
                        driverRoute
                    };
                });

                setClients(mapped);
            }
        } catch (err: any) {
            console.error("Error fetching clients:", err);
            if (stale()) return;
            // Show what actually failed. The generic message hid real causes — a
            // statement timeout on a busy branch reads very differently from a bad
            // filter, and neither could be told apart from the old wording.
            const detail = err?.message || err?.hint || "";
            const isTimeout = /timeout|canceling statement|57014/i.test(detail);
            showError(
                "خطأ",
                isTimeout
                    ? "استغرق تحميل بيانات العملاء وقتاً طويلاً. جرّب تضييق المدة الزمنية أو اختيار فرع واحد."
                    : `حدث خطأ أثناء تحميل بيانات العملاء.${detail ? ` (${detail})` : ""}`
            );
        } finally {
            if (!stale()) setLoading(false);
        }
    };

    const handleAddClient = async (e: React.FormEvent) => {
        e.preventDefault();
        const { error } = await supabase.from('clients').insert([{ name, phone, email }]);
        if (!error) {
            setIsAddModalOpen(false);
            setName(""); setPhone(""); setEmail("");
            fetchClients();
            showSuccess("تم الإضافة", "تم إضافة العميل بنجاح.");
        } else if (error.code === '23505') {
            // clients.phone is UNIQUE. Say so plainly instead of a generic failure —
            // here the user explicitly asked to ADD a customer, so silently attaching
            // them to the existing record would be the wrong call.
            showError("الرقم مسجّل مسبقاً", "يوجد عميل مسجّل بنفس رقم الهاتف. ابحث عنه في السجل بدلاً من إضافته من جديد.");
        } else {
            showError("خطأ", error.message || "حدث خطأ أثناء إضافة العميل.");
        }
    };

    const handleDeleteClient = async (id: string) => {
        const isConfirmed = await showConfirm(
            "حذف العميل",
            "هل أنت متأكد من حذف هذا العميل؟ سيتم حذف جميع البيانات المرتبطة به.",
            "نعم، احذف",
            true
        );
        if (!isConfirmed) return;
        const { error } = await supabase.from('clients').delete().eq('id', id);
        if (!error) {
            setSelectedProfile(null);
            fetchClients();
            showSuccess("تم الحذف", "تم حذف العميل بنجاح.");
        } else {
            showError("خطأ", "حدث خطأ أثناء حذف العميل.");
        }
    };

    const handleUpdateInfo = async () => {
        if (!selectedProfile) return;
        const { error } = await supabase
            .from('clients')
            .update({ name: editName, phone: editPhone, email: editEmail })
            .eq('id', selectedProfile.id);
            
        if (!error) {
            setIsEditingInfo(false);
            fetchClients();
            setSelectedProfile({
                ...selectedProfile,
                name: editName,
                phone: editPhone,
                email: editEmail
            });
            showSuccess("تم التحديث", "تم تحديث بيانات العميل بنجاح.");
        } else {
            showError("خطأ", "حدث خطأ أثناء تحديث البيانات.");
        }
    };

    const handleDeleteReport = async (reportId: string, reportNumber: number) => {
        const isConfirmed = await showConfirm(
            "حذف الفاتورة",
            `هل أنت متأكد من حذف الفاتورة #${reportNumber}؟\nهذا الإجراء لا يمكن التراجع عنه.`,
            "نعم، احذف",
            true
        );
        if (!isConfirmed) return;
        const { error } = await supabase.from('inspection_reports').delete().eq('id', reportId);
        if (!error) {
            fetchClients();
            if (selectedProfile) {
                setSelectedProfile({
                    ...selectedProfile,
                    allReports: selectedProfile.allReports.filter((r: any) => r.id !== reportId)
                });
            }
            // Drop the per-visit cache entry and leave its tab, otherwise the open
            // VisitDetailsView keeps rendering the deleted invoice.
            setLoadedReports(prev => {
                const next = { ...prev };
                delete next[reportId];
                return next;
            });
            setActiveProfileTab(prev => prev === reportId ? "summary" : prev);
            showSuccess("تم الحذف", "تم حذف الفاتورة بنجاح.");
        } else {
            showError("خطأ", `خطأ أثناء الحذف: ${error.message}`);
        }
    };

    // Move a car (and every past visit of it) between the customers tab and a
    // contract: for government cars registered as ordinary customers before the
    // contracts tab existed, or to undo a car moved by mistake. Only the contract
    // tag changes; closed invoices keep their recorded amounts.
    const contracts = useContracts();
    const [movingVehicleId, setMovingVehicleId] = useState<string | null>(null);
    const moveVehicle = async (v: { id: string; make?: string; model?: string; plate_number?: string }, target: { id: string; name: string } | null) => {
        const label = `${v.make || ""} ${v.model || ""}`.trim() + (v.plate_number ? ` (${v.plate_number})` : "");
        const ok = await showConfirm(
            target ? `نقل إلى عقد ${target.name}` : "إرجاع إلى العملاء",
            target
                ? `نقل السيارة ${label} وكل أوراق عملها السابقة إلى عقد ${target.name}؟ ستظهر في تبويب العقود بدل سجل العملاء. مبالغ الفواتير المغلقة لا تتغير.`
                : `إرجاع السيارة ${label} وأوراق عملها من عقد ${contract?.name || ""} إلى سجل العملاء العادي؟`,
            target ? "نقل" : "إرجاع",
            false,
        );
        if (!ok) return;
        setMovingVehicleId(v.id);
        let q = supabase.from('inspection_reports').update({ contract_id: target ? target.id : null }).eq('vehicle_id', v.id);
        q = target ? q.is('contract_id', null) : q.eq('contract_id', cid as string);
        const { data, error } = await q.select('id');
        setMovingVehicleId(null);
        if (error) { showError("خطأ", error.message); return; }
        const n = data?.length || 0;
        showSuccess("تم النقل", target ? `نُقلت ${n} ورقة عمل إلى عقد ${target.name}.` : `أُعيدت ${n} ورقة عمل إلى سجل العملاء.`);
        contractOnlyCache.current = null;
        setRefreshTrigger(t => t + 1);
        // The car's visits left this tab: close the file if nothing is left in it.
        if (selectedProfile) {
            const left = selectedProfile.allReports.filter(r => r.vehicle?.id !== v.id);
            if (left.length === 0) setSelectedProfile(null);
            else openProfile(selectedProfile);
        }
    };

    const handleReopenReport = async (reportId: string, reportNumber: number) => {
        const isConfirmed = await showConfirm(
            "إرجاع السيارة للعمل",
            `هل أنت متأكد من رغبتك في إرجاع المركبة في الفاتورة #${reportNumber} إلى ساحة العمل (قيد العمل)؟`,
            "نعم، إرجاع للعمل",
            false
        );
        if (!isConfirmed) return;

        // Shared helper: also un-accounts an already-closed invoice so it comes
        // back to التدقيق after the new work — see src/lib/reopenOrder.ts.
        const { error } = await reopenWorkOrder(reportId);

        if (!error) {
            fetchClients();
            if (selectedProfile) {
                setSelectedProfile({
                    ...selectedProfile,
                    allReports: selectedProfile.allReports.map((r: any) =>
                        r.id === reportId
                            ? { ...r, status: 'قيد العمل' }
                            : r
                    )
                });
            }
            // Patch the per-visit cache too — the open VisitDetailsView renders from
            // loadedReports, so without this it kept showing "تم الانتهاء".
            setLoadedReports(prev => prev[reportId]
                ? { ...prev, [reportId]: { ...prev[reportId], status: 'قيد العمل' } }
                : prev);
            showSuccess("تمت إعادة الفتح", "تمت إعادة المركبة إلى قيد العمل بنجاح.");
        } else {
            showError("خطأ", `حدث خطأ: ${error.message}`);
        }
    };



    // Filter Logic is fully processed on server-side
    const filteredClients = clients;

    const exportExcel = async () => {
        // The branch and date filters are applied by the DATABASE, and the result is
        // paged. This used to be one unpaged query filtered in JS afterwards — but a
        // single Supabase response is capped at 1000 rows, so the export only ever saw
        // the newest ~1000 orders. Picking any older date range then filtered them all
        // away and the button produced nothing at all (it also returned silently on
        // error). Same fix already applied to the tire report below.
        let baseQuery = () => {
            let q = supabase
                .from("inspection_reports")
                .select(`id, report_number, created_at, total_price, status, order_type, selected_services, odometer_reading, branch_id,
                     receptionist:receptionist_id(name),
                     vehicles(make, model, plate_number, booklet_serial, clients(name, phone)), branches(name)`)
                .order("created_at", { ascending: false });
            q = cid ? q.eq("contract_id", cid) : q.is("contract_id", null);
            const activeBranch = employeeBranchId || branchFilter;
            if (activeBranch) q = q.eq("branch_id", activeBranch);
            if (dateFrom) q = q.gte("created_at", `${dateFrom}T00:00:00`);
            if (dateTo) q = q.lte("created_at", `${dateTo}T23:59:59.999`);
            return q;
        };

        let filteredReports: any[] = [];
        const PAGE = 1000;
        for (let from = 0; from < 100000; from += PAGE) {
            const { data, error } = await baseQuery().range(from, from + PAGE - 1);
            if (error) {
                showError("تعذّر التصدير", error.message || "حدث خطأ أثناء تحميل البيانات للتصدير.");
                return;
            }
            filteredReports.push(...(data || []));
            if (!data || data.length < PAGE) break;
        }

        if (filteredReports.length === 0) {
            showError("لا توجد بيانات", "لا توجد سجلات ضمن الفلاتر المحددة (الفرع/التاريخ). جرّب توسيع المدة.");
            return;
        }

        // 4. Apply searchTerm selected in UI
        const term = (searchTerm || "").toLowerCase().trim();
        if (term) {
            filteredReports = filteredReports.filter((r: any) => {
                const vehicle = Array.isArray(r.vehicles) ? r.vehicles[0] : r.vehicles;
                const client  = vehicle ? (Array.isArray(vehicle.clients) ? vehicle.clients[0] : vehicle.clients) : null;
                
                const clientNameMatch = client?.name ? client.name.toLowerCase().includes(term) : false;
                const clientPhoneMatch = client?.phone ? client.phone.toLowerCase().includes(term) : false;
                const carMakeMatch = vehicle?.make ? vehicle.make.toLowerCase().includes(term) : false;
                const plateMatch = vehicle?.plate_number ? vehicle.plate_number.toLowerCase().includes(term) : false;
                
                return clientNameMatch || clientPhoneMatch || carMakeMatch || plateMatch;
            });
        }

        const STATUS_MAP: Record<string, string> = {
            "pending": "قيد الانتظار", "قيد الانتظار": "قيد الانتظار",
            "in_progress": "قيد العمل", "قيد العمل": "قيد العمل",
            "completed": "تم الانتهاء", "تم الانتهاء": "تم الانتهاء",
            "cancelled": "ملغي", "ملغي": "ملغي"
        };

        const SERVICE_LABELS: Record<string, string> = {
            engineOil: 'زيت المحرك', oilFilter: 'فلتر زيت المحرك',
            airFilter: 'فلتر الهواء', acFilter: 'فلتر التبريد',
            brakeFluid: 'زيت المكابح', coolant: 'ماء الراديتر',
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

        // Export oldest → newest so التسلسل (seq) counts up with the date (1-7, 2-7, 3-7 …).
        const sortedReports = [...filteredReports].sort((a: any, b: any) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

        const mapped = sortedReports.map((r: any, idx: number) => {
            const vehicle = Array.isArray(r.vehicles) ? r.vehicles[0] : r.vehicles;
            const client  = vehicle ? (Array.isArray(vehicle.clients) ? vehicle.clients[0] : vehicle.clients) : null;
            const payload = Array.isArray(r.selected_services) ? r.selected_services[0] : r.selected_services;
            
            const services   = payload?.services  || {};
            const customs    = payload?.customServices || [];
            const bookletObj = payload?.booklet   || {};

            // "بيع منتج" order: no inspection services. نوع الخدمة = "بيع منتج", and each
            // product is sorted into the right report column — oils into the oil columns,
            // filters/others into "الخدمات الإضافية" — instead of dumping everything in one cell.
            const isSale = r.order_type === 'sale' || payload?.is_sale === true;
            let saleOilType = "", saleOilVisc = "", saleOilLiters = "", saleExtra = "";
            if (isSale) {
                const oils: { name: string; qty: number; visc: string }[] = [];
                const others: { name: string; qty: number }[] = [];
                (Array.isArray(payload?.products) ? payload.products : []).forEach((p: any) => {
                    const name = String(p?.name || '').trim();
                    if (!name) return;
                    const qty = Number(p?.qty || 0);
                    const isFilter = /فلتر|filter/i.test(name);
                    const visc = (name.match(/\d+\s*w\s*[-_ ]?\s*\d+/i) || [''])[0].replace(/\s+/g, '');
                    const isOil = !isFilter && (visc !== '' || /زيت|oil/i.test(name));
                    if (isOil) oils.push({ name, qty, visc });
                    else others.push({ name, qty });
                });
                saleOilType = oils.map(o => o.name).join('، ');
                saleOilVisc = oils.map(o => o.visc).filter(Boolean).join('، ');
                saleOilLiters = oils.map(o => o.qty).filter(Boolean).join('، ');
                saleExtra = others.map(o => (o.qty > 1 ? `${o.name} ×${o.qty}` : o.name)).join('، ');
            }

            const oilSvc  = services.engineOil || {};
            const oilType = oilSvc.details?.type || oilSvc.details?.brand || "";
            const oilVisc = oilSvc.details?.viscosity || "";
            const oilLiters = oilSvc.details?.liters || oilSvc.details?.qty || "";

            const needChange = Object.entries(services as Record<string, any>)
                .filter(([, v]) => v?.status === "يحتاج تغيير")
                .map(([k, v]) => {
                    const label = SERVICE_LABELS[k] || k;
                    const det = v?.details || {};
                    const parts = [];
                    if (k === 'additives' || k === 'cleaners') {
                        for (let i = 0; i < 10; i++) {
                            if (det[`prod_${i}`]) {
                                let s = String(det[`prod_${i}`]);
                                if (det[`notes_${i}`]) s += ` (ملاحظات: ${det[`notes_${i}`]})`;
                                parts.push(s);
                            }
                        }
                    } else if (k !== 'engineOil') {
                        for (const [dk, dval] of Object.entries(det)) {
                            if (dk === 'unitPrice' || !dval) continue;
                            if (dk === 'notes') parts.push(`ملاحظات: ${dval}`);
                            else if (dk === 'qty' || dk === 'liters') parts.push(`العدد/اللترات: ${dval}`);
                            else parts.push(String(dval));
                        }
                    }
                    return parts.length ? `${label}: ${parts.join(' - ')}` : label;
                });

            const customLabels = customs.filter((c: any) => c.label).map((c: any) => c.label);
            const bookletStr   = bookletObj.type
                ? `${bookletObj.type}${bookletObj.changes ? ` (${bookletObj.changes})` : ""}`
                : "";

            // New fields
            const odometer = r.odometer_reading || "";
            const receptionistName = r.receptionist?.name || payload?.receptionistName || "";
            const supervisorName = payload?.shiftSupervisor || "";
            const technicianName = payload?.technicianName || "";
            const shiftName = payload?.shiftName || "";

            return {
                seq: idx + 1,
                branch_name: r.branches?.name || "—",
                client_name:  isSale ? (payload?.customerName || "عميل نقدي") : (client?.name  || "—"),
                client_phone: isSale ? (payload?.customerPhone || "—") : (client?.phone || "—"),
                car_make:  isSale ? "—" : (vehicle?.make  || "—"),
                car_model: isSale ? "—" : (vehicle?.model || "—"),
                plate: isSale ? "—" : (vehicle?.plate_number || "—"),
                booklet_serial: vehicle?.booklet_serial || "—",
                created_at: new Date(r.created_at).toLocaleDateString("en-US"),
                shift_name: shiftName || "—",
                receptionist_name: receptionistName || "—",
                supervisor_name: supervisorName || "—",
                technician_name: isSale ? "—" : (technicianName || "—"),
                odometer: isSale ? "—" : (odometer || "—"),
                service_type: isSale ? "بيع منتج" : (needChange.join("، ") || "فحص"),
                oil_type: isSale ? (saleOilType || "—") : oilType,
                oil_viscosity: isSale ? (saleOilVisc || "—") : oilVisc,
                oil_liters: isSale ? (saleOilLiters || "—") : oilLiters,
                extra_services: isSale ? saleExtra : customLabels.join("، "),
                booklet: bookletStr,
                total_price: r.total_price || 0,
                status: STATUS_MAP[r.status] || r.status || "",
                // Fields shaped to match the team's database Google Sheet layout.
                created_ymd: (() => { const d = new Date(r.created_at); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; })(),
                // نوع الخدمة for the DB sheet: the actual services performed — for category
                // services (المضافات/المنظفات) the products INSIDE are listed, not the heading.
                db_service: isSale ? "بيع منتج" : (() => {
                    const performed = Object.entries(services as Record<string, any>)
                        .filter(([, v]) => v?.status === "يحتاج تغيير")
                        .flatMap(([k, v]) => {
                            if (k === 'additives' || k === 'cleaners') {
                                const prods = Object.keys(v?.details || {})
                                    .filter(dk => dk.startsWith('prod_') && v.details[dk])
                                    .map(dk => String(v.details[dk]).trim());
                                return prods.length ? prods : [SERVICE_LABELS[k] || k];
                            }
                            return [SERVICE_LABELS[k] || k];
                        });
                    return [...performed, ...customLabels].join("، ") || "فحص بالجهاز";
                })(),
                db_technician: isSale ? "" : (technicianName || ""),
                db_car: isSale ? "" : `${vehicle?.make || ""} ${vehicle?.model || ""}`.trim(),
                // Join type + viscosity, but skip the viscosity when the type string already
                // contains it (e.g. "شل 5W30 HX8" + "5W30" would duplicate the viscosity).
                db_oil_type_visc: (() => {
                    const t = (isSale ? saleOilType : oilType) || "";
                    const vsc = (isSale ? saleOilVisc : oilVisc) || "";
                    const norm = (s: string) => s.toLowerCase().replace(/[\s\-_]/g, "");
                    return (vsc && !norm(t).includes(norm(vsc))) ? `${t} ${vsc}`.trim() : t.trim();
                })(),
                db_liters: isSale ? saleOilLiters : (oilLiters || ""),
                db_odometer: isSale ? "" : (odometer || ""),
                db_future: payload?.futureOdometer || "",
                db_booklet_type: bookletObj.type || "",
                db_booklet_changes: bookletObj.changes || "",
            };
        });

        const wsData = [
            ["#", "الفرع", "اسم الزبون", "رقم الهاتف", "السيارة", "الموديل", "رقم اللوحة", "التاريخ", "الشفت",
             "موظف الاستقبال", "المشرف", "الفني", "العداد (كم)",
             "نوع الخدمة", "نوع الزيت", "درجة اللزوجة", "عدد اللترات",
             "الخدمات الإضافية", "دفتر الزيت", "السعر (د.ع)", "الحالة"],
            ...mapped.map(r => [
                r.seq, r.branch_name, r.client_name, r.client_phone, r.car_make, r.car_model, r.plate, r.created_at, r.shift_name,
                r.receptionist_name, r.supervisor_name, r.technician_name, r.odometer,
                r.service_type, r.oil_type, r.oil_viscosity, r.oil_liters,
                r.extra_services, r.booklet, r.total_price, r.status
            ])
        ];

        const ws = XLSX.utils.aoa_to_sheet(wsData);
        ws["!cols"] = [
            {wch:5}, {wch:16}, {wch:22}, {wch:16}, {wch:14}, {wch:14}, {wch:14}, {wch:14}, {wch:12},
            {wch:18}, {wch:18}, {wch:18}, {wch:14},
            {wch:28}, {wch:18}, {wch:14}, {wch:10}, {wch:28}, {wch:14}, {wch:12}, {wch:12},
        ];
        if (!ws["!opts"]) ws["!opts"] = {};
        (ws as any)["!opts"].RTL = true;

        // Second sheet: exact 16-column layout matching the team's database Google Sheet,
        // so rows can be pasted/uploaded straight into it.
        const dbData = [
            ["التسلسل", "اسم الزبون", "رقم الهاتف", "نوع السيارة", "التاريخ", "نوع الخدمة",
             "نوع الزيت واللزوجة", "عدد اللترات", "العداد الحالي", "العداد المستقبلي", "السعر",
             "دفتر الخدمة", "عدد التبديلات", "الشفت", "اسم موظف الاستقبال", "مشرف الشفت", "اسم الفني"],
            ...mapped.map(r => [
                r.seq, r.client_name, r.client_phone, r.db_car, r.created_ymd, r.db_service,
                r.db_oil_type_visc, r.db_liters, r.db_odometer, r.db_future, r.total_price,
                r.db_booklet_type, r.db_booklet_changes, r.shift_name === "—" ? "" : r.shift_name,
                r.receptionist_name === "—" ? "" : r.receptionist_name,
                r.supervisor_name === "—" ? "" : r.supervisor_name,
                r.db_technician,
            ])
        ];
        const wsDb = XLSX.utils.aoa_to_sheet(dbData);
        wsDb["!cols"] = [
            {wch:7}, {wch:22}, {wch:16}, {wch:18}, {wch:13}, {wch:20},
            {wch:22}, {wch:11}, {wch:13}, {wch:15}, {wch:12},
            {wch:12}, {wch:12}, {wch:10}, {wch:18}, {wch:18}, {wch:18},
        ];
        if (!wsDb["!opts"]) wsDb["!opts"] = {};
        (wsDb as any)["!opts"].RTL = true;

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, wsDb, "قاعدة البيانات");
        XLSX.utils.book_append_sheet(wb, ws, "تفاصيل كاملة");
        XLSX.writeFile(wb, `reports_${new Date().toISOString().slice(0,10)}.xlsx`);
    };

    // Standalone TIRE report — separate file, isolated from the customer/invoice
    // export (per Abbas: a تقرير خاص للإطارات, temporary, to prepare a tire order).
    // Columns: اسم الزبون · نوع السيارة · الموديل · حجم الإطار.
    const exportTireReport = async () => {
        // Branch/date filters are applied by the DATABASE (same as exportExcel) and
        // the result is paged — a single query is capped at 1000 rows (~last couple
        // weeks), and filtering in JS afterwards made older exports come back empty.
        const baseQuery = () => {
            let q = supabase
                .from("inspection_reports")
                .select(`id, created_at, order_type, branch_id, selected_services,
                         vehicles(make, model, clients(name))`)
                .order("created_at", { ascending: false });
            q = cid ? q.eq("contract_id", cid) : q.is("contract_id", null);
            const activeBranch = employeeBranchId || branchFilter;
            if (activeBranch) q = q.eq("branch_id", activeBranch);
            if (dateFrom) q = q.gte("created_at", `${dateFrom}T00:00:00`);
            if (dateTo) q = q.lte("created_at", `${dateTo}T23:59:59.999`);
            return q;
        };

        const rows: any[] = [];
        const PAGE = 1000;
        for (let from = 0; from < 100000; from += PAGE) {
            const { data, error } = await baseQuery().range(from, from + PAGE - 1);
            if (error) {
                showError("تعذّر التصدير", error.message || "حدث خطأ أثناء تحميل البيانات للتصدير.");
                return;
            }
            rows.push(...(data || []));
            if (!data || data.length < PAGE) break;
        }

        const tireRows = rows.map(r => {
            const payload = Array.isArray(r.selected_services) ? r.selected_services[0] : r.selected_services;
            const t = payload?.tireSize;
            const tire = t && (t.width || t.aspect || t.diameter)
                ? [t.width, t.aspect, t.diameter].filter(Boolean).join(" / ") : "";
            if (!tire) return null;
            const v = Array.isArray(r.vehicles) ? r.vehicles[0] : r.vehicles;
            const c = v && (Array.isArray(v.clients) ? v.clients[0] : v.clients);
            return [c?.name || "—", v?.make || "—", v?.model || "—", tire];
        }).filter(Boolean) as string[][];

        const wsTire = XLSX.utils.aoa_to_sheet([
            ["اسم الزبون", "نوع السيارة", "الموديل", "حجم الإطار"],
            ...tireRows,
        ]);
        wsTire["!cols"] = [{wch:24}, {wch:16}, {wch:16}, {wch:16}];
        if (!wsTire["!opts"]) wsTire["!opts"] = {};
        (wsTire as any)["!opts"].RTL = true;

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, wsTire, "الإطارات");
        XLSX.writeFile(wb, `tires_${new Date().toISOString().slice(0,10)}.xlsx`);
    };

    const openProfile = async (client: ClientWithVehicles) => {
        setSelectedProfile(client);
        setEditName(client.name);
        setEditPhone(client.phone);
        setEditEmail(client.email || "");
        setIsEditingInfo(false);
        setActiveProfileTab("summary");
        setProfileBranchFilter("");
        setLoadedReports({}); // clear per-visit cache so freshly-saved inspections/edits show
        // Re-fetch ALL of this client's reports across EVERY branch → one unified profile,
        // regardless of any branch filter applied to the customer list.
        const { data } = await supabase
            .from('vehicles')
            .select(`id, make, model, plate_number, engine_size, booklet_serial,
                     inspection_reports(id, report_number, status, order_type, branch_id, created_at, total_price, selected_services, branches(name))`)
            .eq('client_id', client.id)
            .filter('inspection_reports.contract_id', cid ? 'eq' : 'is', cid ?? 'null');
        if (data) {
            const allReports: any[] = [];
            const branchNameSet = new Set<string>();
            data.forEach((v: any) => v.inspection_reports?.forEach((r: any) => {
                allReports.push({ ...r, vehicle: v });
                if (r.branches?.name) branchNameSet.add(r.branches.name);
            }));
            allReports.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            setSelectedProfile(prev => prev ? { ...prev, allReports, branchNames: Array.from(branchNameSet) } : prev);
        }
    };

    const handleSelectVisitTab = async (reportId: string) => {
        setActiveProfileTab(reportId);
        {
            // Always refetch so a freshly-saved inspection/edit shows (no stale cache).
            setLoadingDetails(true);
            try {
                const { data, error } = await supabase
                    .from('inspection_reports')
                    .select(`
                        id, report_number, status, order_type, total_price, selected_services, odometer_reading, created_at,
                        branches (name),
                        receptionist:receptionist_id (name)
                    `)
                    .eq('id', reportId)
                    .single();
                
                if (!error && data) {
                    const basicRep = selectedProfile?.allReports.find((r: any) => r.id === reportId);
                    const reportWithVehicle = {
                        ...data,
                        vehicle: basicRep?.vehicle
                    };
                    setLoadedReports(prev => ({ ...prev, [reportId]: reportWithVehicle }));
                }
            } catch (e) {
                console.error("Error loading report details:", e);
            } finally {
                setLoadingDetails(false);
            }
        }
    };

    const backupDatabase = async () => {
        setBackingUp(true);
        try {
            showSuccess("جاري التحضير", "بدأت عملية النسخ الاحتياطي للبيانات. يرجى الانتظار...");

            // Page through every table — a single select('*') is capped at 1000 rows,
            // so the old backup silently truncated the big tables (and ignored fetch
            // errors), producing a "successful" but incomplete backup file.
            const fetchAllRows = async (table: 'clients' | 'vehicles' | 'inspection_reports' | 'branches' | 'employees', select: string) => {
                const rows: any[] = [];
                const PAGE = 1000;
                for (let from = 0; from < 1000000; from += PAGE) {
                    const { data, error } = await supabase.from(table).select(select).range(from, from + PAGE - 1);
                    if (error) throw new Error(`فشل تحميل جدول ${table}: ${error.message}`);
                    rows.push(...(data || []));
                    if (!data || data.length < PAGE) break;
                }
                return rows;
            };

            const [clientsRows, vehiclesRows, reportsRows, branchesRows, employeesRows] = await Promise.all([
                fetchAllRows('clients', '*'),
                fetchAllRows('vehicles', '*'),
                fetchAllRows('inspection_reports', '*'),
                fetchAllRows('branches', 'id, name, address, created_at'),
                fetchAllRows('employees', 'id, name, username, role, branch_id, phone, created_at')
            ]);

            const backupObj = {
                backup_version: "1.0",
                backup_date: new Date().toISOString(),
                data: {
                    clients: clientsRows,
                    vehicles: vehiclesRows,
                    inspection_reports: reportsRows,
                    branches: branchesRows,
                    employees: employeesRows
                }
            };

            const jsonString = JSON.stringify(backupObj, null, 2);
            const blob = new Blob([jsonString], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `auto_workshop_backup_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            showSuccess("مكتمل", "تم تحميل نسخة احتياطية كاملة من البيانات بنجاح!");
        } catch (err: any) {
            console.error("Backup error:", err);
            showError("خطأ", err?.message || "فشلت عملية النسخ الاحتياطي للبيانات.");
        } finally {
            setBackingUp(false);
        }
    };

    // Access guards (placed after all hooks so the Rules of Hooks are respected).
    if (authLoading) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <Loader2 className="animate-spin text-emerald-500 w-12 h-12" />
            </div>
        );
    }

    if (!isAuthorized) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center p-4 text-center font-ibm" dir="rtl">
                <div className="glass-card p-8 rounded-3xl border border-rose-500/20 max-w-md w-full">
                    <h2 className="text-2xl font-bold text-rose-500 mb-2">غير مصرح بالوصول</h2>
                    <p className="text-muted-foreground mb-6">ليس لديك صلاحية للوصول إلى سجل العملاء والمركبات.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen p-4 md:p-8 font-ibm" dir="rtl">
            <div className="max-w-[1400px] mx-auto space-y-8 animate-fade-in">

                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div>
                        <h1 className="text-3xl font-display font-bold text-foreground mb-2 flex items-center gap-3">
                            {contract ? <Landmark className="text-amber-400" size={32} /> : <User className="text-rose-500" size={32} />}
                            {contract ? `عقود ${contract.name}` : "سجل العملاء والمركبات الشامل"}
                        </h1>
                        <p className="text-muted-foreground">
                            {contract
                                ? "عملاء ومركبات العقد، وتاريخ صيانتها من مكان واحد (نظام الآجل)."
                                : "إدارة بيانات العملاء، المركبات المرتبطة، وتاريخ الصيانة من مكان واحد."}
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                        {contract ? (
                            // Contract orders are only ever started from here (reception never asks).
                            <Link
                                href={`/reception?contract=${contract.id}`}
                                className="bg-amber-500 hover:bg-amber-400 text-black px-5 py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center gap-2"
                            >
                                <Plus size={18} /> إنشاء ورقة عمل
                            </Link>
                        ) : (
                            <button 
                                onClick={() => setIsAddModalOpen(true)}
                                className="bg-rose-600 hover:bg-rose-500 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center gap-2"
                            >
                                <Plus size={18} /> <span className="hidden sm:inline">إضافة عميل</span>
                            </button>
                        )}
                        <button 
                            onClick={exportExcel}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center gap-2"
                        >
                            <Download size={18} /> <span className="hidden sm:inline">تصدير الفواتير</span>
                        </button>
                        <button
                            onClick={exportTireReport}
                            className="bg-amber-600 hover:bg-amber-500 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center gap-2"
                        >
                            <Download size={18} /> <span className="hidden sm:inline">تقرير الإطارات</span>
                        </button>
                        <button
                            onClick={backupDatabase}
                            disabled={backingUp}
                            className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center gap-2"
                            title="نسخة احتياطية كاملة للموقع بصيغة JSON"
                        >
                            {backingUp ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                            <span className="hidden sm:inline">نسخة احتياطية كاملة</span>
                        </button>
                    </div>
                </div>

                {topSlot}

                {/* Filters */}
                <div className="glass-card p-4 rounded-2xl flex flex-wrap gap-4 items-end">
                    <div className="relative flex-1 min-w-[200px]">
                        <label className="block text-xs font-bold text-muted-foreground mb-1.5">بحث شامل</label>
                        <Search className="absolute right-3 top-9 text-muted-foreground" size={18} />
                        <input 
                            type="text" 
                            placeholder="الاسم، الرقم، أو رقم اللوحة..." 
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-background border border-border rounded-xl py-2.5 pr-10 pl-4 text-foreground placeholder-slate-500 text-sm focus:outline-none focus:border-rose-500/50"
                        />
                    </div>
                    <div className="w-full sm:w-auto">
                        <label className="block text-xs font-bold text-muted-foreground mb-1.5">الفرع</label>
                        <select 
                            value={branchFilter}
                            onChange={(e) => setBranchFilter(e.target.value)}
                            className="bg-background border border-border rounded-xl py-2.5 px-4 min-w-[150px] text-foreground text-sm focus:outline-none focus:border-rose-500/50"
                        >
                            <option value="">كل الفروع</option>
                            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                    </div>
                    <div className="w-full sm:w-auto">
                        <label className="block text-xs font-bold text-muted-foreground mb-1.5">نوع الزائر</label>
                        <select
                            value={visitFilter}
                            onChange={(e) => setVisitFilter(e.target.value as "" | "repeat" | "multibranch")}
                            className="bg-background border border-border rounded-xl py-2.5 px-4 min-w-[170px] text-foreground text-sm focus:outline-none focus:border-rose-500/50"
                        >
                            <option value="">كل العملاء</option>
                            <option value="repeat">زائر متكرر (أكثر من زيارة)</option>
                            <option value="multibranch">زار أكثر من فرع</option>
                        </select>
                    </div>
                    <div className="w-full sm:w-auto">
                        <label className="block text-xs font-bold text-muted-foreground mb-1.5">سواق الخطوط (فرع الكراج)</label>
                        <select
                            value={routeFilter}
                            onChange={(e) => setRouteFilter(e.target.value)}
                            className="bg-background border border-border rounded-xl py-2.5 px-4 min-w-[170px] text-foreground text-sm focus:outline-none focus:border-rose-500/50"
                        >
                            <option value="">الكل</option>
                            <option value="__any__">كل سواق الخطوط</option>
                            {driverRoutes.map(r => <option key={r} value={r}>خط: {r}</option>)}
                        </select>
                    </div>
                    <div className="w-full sm:w-auto">
                        <label className="block text-xs font-bold text-muted-foreground mb-1.5">من تاريخ</label>
                        <div className="relative">
                            <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                            <input 
                                type="date" 
                                value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                                className="bg-background border border-border rounded-xl py-2.5 pr-10 pl-3 text-foreground text-sm focus:outline-none focus:border-rose-500/50"
                            />
                        </div>
                    </div>
                    <div className="w-full sm:w-auto">
                        <label className="block text-xs font-bold text-muted-foreground mb-1.5">إلى تاريخ</label>
                        <div className="relative">
                            <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                            <input 
                                type="date" 
                                value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                                className="bg-background border border-border rounded-xl py-2.5 pr-10 pl-3 text-foreground text-sm focus:outline-none focus:border-rose-500/50"
                            />
                        </div>
                    </div>
                </div>

                {/* Main Table */}
                <div className="glass-card rounded-2xl border-border overflow-hidden">
                    <div className="overflow-x-auto custom-scrollbar hidden md:block">
                        <table className="w-full text-right border-collapse">
                            <thead>
                                <tr className="bg-card border-b border-border">
                                    <th className="p-4 text-muted-foreground font-bold text-sm whitespace-nowrap">العميل</th>
                                    <th className="p-4 text-muted-foreground font-bold text-sm whitespace-nowrap">معلومات التواصل</th>
                                    <th className="p-4 text-muted-foreground font-bold text-sm whitespace-nowrap">المركبات المسجلة</th>
                                    <th className="p-4 text-muted-foreground font-bold text-sm whitespace-nowrap">حالة العميل / الفرع</th>
                                    <th className="p-4 text-muted-foreground font-bold text-sm whitespace-nowrap text-left">العمليات</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading && (
                                    <tr>
                                        <td colSpan={5} className="p-12 text-center text-muted-foreground">جاري تحميل البيانات...</td>
                                    </tr>
                                )}
                                {!loading && filteredClients.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="p-12 text-center text-muted-foreground">
                                            <div className="flex flex-col items-center gap-3">
                                                <ShieldAlert size={48} className="text-slate-700 mx-auto" />
                                                لا يوجد عملاء يطابقون الفلاتر.
                                            </div>
                                        </td>
                                    </tr>
                                )}
                                {!loading && filteredClients.map((client) => (
                                    <tr key={client.id} onClick={() => openProfile(client)} className="border-b border-border hover:bg-muted/30 transition-colors group cursor-pointer">
                                        <td className="p-4 align-top">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-rose-400 font-bold text-lg shrink-0">
                                                    {client.name.charAt(0)}
                                                </div>
                                                <div>
                                                    <span className="font-bold text-foreground text-base group-hover:text-rose-400 transition-colors">
                                                        {client.name}
                                                    </span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4 align-top space-y-2">
                                            <div className="flex items-center gap-2 text-muted-foreground text-sm">
                                                <Phone size={14} className="text-muted-foreground" /> <span dir="ltr">{client.phone}</span>
                                            </div>
                                        </td>
                                        <td className="p-4 align-top w-1/3">
                                            {client.vehicles && client.vehicles.length > 0 ? (
                                                <div className="flex flex-wrap gap-2">
                                                    {client.vehicles.map((v, i) => (
                                                        <div key={i} className="flex flex-col gap-1 items-start px-3 py-1.5 bg-background border border-border rounded-lg text-xs font-medium text-foreground shadow-sm">
                                                            <div className="flex items-center gap-2">
                                                                <Car size={14} className="text-blue-500" />
                                                                <span>{v.make} {v.model}</span>
                                                                <span className="text-[10px] text-muted-foreground font-mono px-1.5 py-0.5 bg-muted rounded">{v.plate_number}</span>
                                                            </div>
                                                            {false && v.booklet_serial && (
                                                                <span className="text-[10px] font-bold text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20 w-full text-center font-mono">
                                                                    دفتر: {v.booklet_serial}
                                                                </span>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <span className="text-muted-foreground text-xs px-2 py-1 bg-card rounded">لا توجد مركبات</span>
                                            )}
                                        </td>
                                        <td className="p-4 align-top">
                                            <div className="flex flex-col gap-2">
                                                <span className={`inline-flex w-fit px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                                                    client.latestStatus === "تم الانتهاء" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" :
                                                    client.latestStatus === "في انتظار المحاسبة" ? "bg-indigo-500/10 text-indigo-500 border-indigo-500/20" :
                                                    client.latestStatus === "قيد العمل" ? "bg-amber-500/10 text-amber-500 border-amber-500/20" :
                                                    "bg-muted text-muted-foreground border-border"
                                                }`}>
                                                    {client.latestStatus}
                                                </span>
                                                {client.driverRoute && (
                                                    <span className="inline-flex w-fit items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border bg-sky-500/10 text-sky-500 border-sky-500/20">
                                                        <MapPin size={11} /> خط: {client.driverRoute}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="p-4 align-top text-left">
                                            <button className="px-4 py-2 bg-muted hover:bg-rose-500 hover:text-white text-muted-foreground rounded-xl text-sm font-bold transition-all inline-flex items-center gap-2">
                                                <FolderOpen size={16} /> الملف الشامل
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile card list (replaces the wide table on phones) */}
                    <div className="md:hidden divide-y divide-border">
                        {loading && (
                            <div className="p-12 text-center text-muted-foreground">جاري تحميل البيانات...</div>
                        )}
                        {!loading && filteredClients.length === 0 && (
                            <div className="p-12 text-center text-muted-foreground flex flex-col items-center gap-3">
                                <ShieldAlert size={40} className="text-slate-700" />
                                لا يوجد عملاء يطابقون الفلاتر.
                            </div>
                        )}
                        {!loading && filteredClients.map((client) => (
                            <div
                                key={client.id}
                                onClick={() => openProfile(client)}
                                className="p-4 active:bg-muted/40 transition-colors cursor-pointer"
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-rose-400 font-bold text-lg shrink-0">
                                            {client.name.charAt(0)}
                                        </div>
                                        <div className="min-w-0">
                                            <span className="font-bold text-foreground text-base block truncate">{client.name}</span>
                                            <span className="flex items-center gap-1.5 text-muted-foreground text-xs mt-0.5">
                                                <Phone size={12} className="shrink-0" /> <span dir="ltr">{client.phone}</span>
                                            </span>
                                        </div>
                                    </div>
                                    <span className={`inline-flex shrink-0 px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                                        client.latestStatus === "تم الانتهاء" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" :
                                        client.latestStatus === "في انتظار المحاسبة" ? "bg-indigo-500/10 text-indigo-500 border-indigo-500/20" :
                                        client.latestStatus === "قيد العمل" ? "bg-amber-500/10 text-amber-500 border-amber-500/20" :
                                        "bg-muted text-muted-foreground border-border"
                                    }`}>
                                        {client.latestStatus}
                                    </span>
                                </div>

                                {client.vehicles && client.vehicles.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mt-3">
                                        {client.vehicles.map((v, i) => (
                                            <div key={i} className="flex items-center gap-2 px-2.5 py-1 bg-background border border-border rounded-lg text-xs font-medium">
                                                <Car size={13} className="text-blue-500 shrink-0" />
                                                <span>{v.make} {v.model}</span>
                                                <span className="text-[10px] text-muted-foreground font-mono px-1.5 py-0.5 bg-muted rounded">{v.plate_number}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {client.driverRoute && (
                                    <span className="inline-flex items-center gap-1 mt-3 px-2.5 py-1 rounded-full text-[11px] font-bold border bg-sky-500/10 text-sky-500 border-sky-500/20">
                                        <MapPin size={11} /> خط: {client.driverRoute}
                                    </span>
                                )}

                                <div className="mt-3 flex items-center gap-1.5 text-rose-400 text-xs font-bold">
                                    <FolderOpen size={14} /> عرض الملف الشامل
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Pagination Controls */}
                    {!loading && totalCount > PAGE_SIZE && (
                        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-5 bg-card/50 border-t border-border/60">
                            <span className="text-xs text-muted-foreground font-medium">
                                عرض {((currentPage - 1) * PAGE_SIZE) + 1} - {Math.min(currentPage * PAGE_SIZE, totalCount)} من إجمالي {totalCount} عميل
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    disabled={currentPage === 1}
                                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                    className="p-2 bg-muted hover:bg-muted/80 text-foreground disabled:opacity-50 border border-border rounded-xl transition-all font-bold text-xs flex items-center gap-1"
                                >
                                    <ChevronRight size={14} /> السابق
                                </button>
                                <span className="text-xs text-foreground font-bold px-3">
                                    صفحة {currentPage} من {Math.ceil(totalCount / PAGE_SIZE)}
                                </span>
                                <button
                                    disabled={currentPage >= Math.ceil(totalCount / PAGE_SIZE)}
                                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, Math.ceil(totalCount / PAGE_SIZE)))}
                                    className="p-2 bg-muted hover:bg-muted/80 text-foreground disabled:opacity-50 border border-border rounded-xl transition-all font-bold text-xs flex items-center gap-1"
                                >
                                    التالي <ChevronLeft size={14} />
                                </button>
                            </div>
                        </div>
                    )}
                </div>

            </div>

            {/* Profile Modal */}
            {selectedProfile && (
                <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-0 sm:p-4">
                    <div className="bg-card border border-border rounded-none sm:rounded-2xl w-full max-w-5xl h-full sm:h-auto max-h-full sm:max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200 shadow-2xl">

                        {/* Modal Header */}
                        <div className="p-4 sm:p-6 border-b border-border flex justify-between items-center bg-muted/30">
                            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                                <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-full bg-rose-500/20 flex items-center justify-center text-rose-500 font-bold text-xl sm:text-2xl shrink-0">
                                    {selectedProfile.name.charAt(0)}
                                </div>
                                <div className="min-w-0">
                                    <h2 className="text-lg sm:text-2xl font-bold text-foreground truncate">
                                        {selectedProfile.name}
                                    </h2>
                                    <p className="text-muted-foreground text-xs sm:text-sm flex items-center gap-2 mt-0.5 sm:mt-1">
                                        <Phone size={14} className="shrink-0"/> <span dir="ltr">{selectedProfile.phone}</span>
                                    </p>
                                </div>
                            </div>
                            <button onClick={() => setSelectedProfile(null)} className="p-2 bg-background hover:bg-rose-500 text-muted-foreground hover:text-white rounded-xl transition-colors border border-border shrink-0">
                                <X size={24} />
                            </button>
                        </div>

                        {/* Modal Body: Split view */}
                        <div className="flex flex-col md:flex-row overflow-hidden flex-1 min-h-0">
                            
                            {/* Right Sidebar - Visit Tabs (capped height on phones so content stays visible) */}
                            <div className="w-full md:w-80 max-h-52 md:max-h-none shrink-0 md:shrink border-b md:border-b-0 md:border-l border-border bg-muted/10 flex flex-col overflow-y-auto custom-scrollbar">
                                <div className="p-4 space-y-2">
                                    {/* Summary Tab */}
                                    <button
                                        onClick={() => setActiveProfileTab("summary")}
                                        className={`w-full text-right px-4 py-3 rounded-xl text-xs font-bold transition-all flex items-center justify-between border ${
                                            activeProfileTab === "summary"
                                                ? "bg-rose-600 text-white border-rose-600 shadow-md shadow-rose-950/20"
                                                : "bg-background hover:bg-muted text-foreground border-border"
                                        }`}
                                    >
                                        <span>الملخص الشامل للعميل</span>
                                        <User size={16} />
                                    </button>

                                    {(() => {
                                        const branchNames: string[] = selectedProfile.branchNames || [];
                                        const visits = selectedProfile.allReports.filter((r: any) => !profileBranchFilter || r.branches?.name === profileBranchFilter);
                                        return (
                                    <>
                                    <div className="border-t border-border/40 my-2 pt-2">
                                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block px-2 mb-2">تاريخ الزيارات ({visits.length})</span>
                                        {branchNames.length > 1 && (
                                            <select value={profileBranchFilter} onChange={e => setProfileBranchFilter(e.target.value)}
                                                className="w-full bg-background border border-border rounded-lg px-2 py-1.5 text-xs mb-2 focus:outline-none focus:border-rose-500/50">
                                                <option value="">كل الفروع ({selectedProfile.allReports.length})</option>
                                                {branchNames.map((bn: string) => (
                                                    <option key={bn} value={bn}>{bn} ({selectedProfile.allReports.filter((r: any) => r.branches?.name === bn).length})</option>
                                                ))}
                                            </select>
                                        )}
                                    </div>

                                    {/* Visits Tabs */}
                                    {visits.length === 0 ? (
                                        <span className="text-xs text-muted-foreground block text-center py-4">لا توجد زيارات{profileBranchFilter ? ` في فرع ${profileBranchFilter}` : " سابقة"}</span>
                                    ) : (
                                        visits.map((r: any) => {
                                            const isSelected = activeProfileTab === r.id;
                                            const dateStr = new Date(r.created_at).toLocaleDateString("en-GB", {
                                                year: 'numeric',
                                                month: '2-digit',
                                                day: '2-digit'
                                            });
                                            return (
                                                <button
                                                    key={r.id}
                                                    onClick={() => handleSelectVisitTab(r.id)}
                                                    className={`w-full text-right px-4 py-3 rounded-xl text-xs font-bold transition-all flex flex-col gap-1 border ${
                                                        isSelected
                                                            ? "bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-950/20"
                                                            : "bg-background hover:bg-muted text-foreground border-border"
                                                    }`}
                                                >
                                                    <div className="flex justify-between items-center w-full">
                                                        <span className="font-mono">فاتورة #{r.report_number}</span>
                                                         <span className={`text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap ${
                                                            isSelected 
                                                                ? "bg-white/20 text-white" 
                                                                : r.status === "completed" || r.status === "تم الانتهاء" 
                                                                    ? (isAccounted(r) ? "bg-emerald-500/10 text-emerald-400" : "bg-indigo-500/10 text-indigo-400") 
                                                                    : r.status === "قيد العمل" ? "bg-amber-500/10 text-amber-400" : "bg-blue-500/10 text-blue-400"
                                                        }`}>
                                                            {r.status === "completed" || r.status === "تم الانتهاء" 
                                                                ? (isAccounted(r) ? "تم الانتهاء" : "في انتظار المحاسبة") 
                                                                : r.status === "قيد العمل" ? "قيد العمل" : "انتظار"}
                                                        </span>
                                                    </div>
                                                    <div className="flex justify-between items-center text-[10px] opacity-80 mt-1 font-normal">
                                                        <span>{r.vehicle?.make} {r.vehicle?.model}</span>
                                                        <span>{r.branches?.name ? `${r.branches.name} • ` : ""}{dateStr}</span>
                                                    </div>
                                                </button>
                                            );
                                        })
                                    )}
                                    </>
                                    );
                                    })()}
                                </div>
                            </div>

                            {/* Left Panel - Tab Content */}
                            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 bg-background">
                                {activeProfileTab === "summary" ? (
                                    /* Summary Tab Content */
                                    <div className="space-y-8">
                                        {/* Basic Info */}
                                        <div className="space-y-4">
                                            <div className="flex justify-between items-end">
                                                <h3 className="text-lg font-bold text-foreground flex items-center gap-2 border-b border-rose-500/30 pb-2 inline-flex">
                                                    <Users size={20} className="text-rose-500"/> بيانات العميل الأساسية
                                                </h3>
                                                {!isEditingInfo ? (
                                                    <button onClick={() => setIsEditingInfo(true)} className="text-xs font-bold text-blue-500 hover:text-blue-400 flex items-center gap-1 bg-blue-500/10 px-3 py-1.5 rounded-lg">
                                                        <Edit2 size={14}/> تعديل البيانات
                                                    </button>
                                                ) : (
                                                    isOwnerOrAdmin && (
                                                        <button onClick={() => handleDeleteClient(selectedProfile.id)} className="text-xs font-bold text-rose-500 hover:text-rose-400 flex items-center gap-1 bg-rose-500/10 px-3 py-1.5 rounded-lg">
                                                            <Trash2 size={14}/> حذف العميل نهائياً
                                                        </button>
                                                    )
                                                )}
                                            </div>

                                            {isEditingInfo ? (
                                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-muted/50 p-4 rounded-xl border border-border">
                                                    <div>
                                                        <label className="text-xs text-muted-foreground block mb-1">الاسم</label>
                                                        <input type="text" value={editName} onChange={e=>setEditName(e.target.value)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs focus:border-rose-500 outline-none" />
                                                    </div>
                                                    <div>
                                                        <label className="text-xs text-muted-foreground block mb-1">رقم الهاتف</label>
                                                        <input type="text" dir="ltr" value={editPhone} onChange={e=>setEditPhone(e.target.value)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs focus:border-rose-500 outline-none text-right" />
                                                    </div>
                                                    <div>
                                                        <label className="text-xs text-muted-foreground block mb-1">البريد الإلكتروني</label>
                                                        <input type="email" dir="ltr" value={editEmail} onChange={e=>setEditEmail(e.target.value)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs focus:border-rose-500 outline-none text-right" />
                                                    </div>
                                                    <div className="sm:col-span-3 flex gap-2 justify-end mt-2">
                                                        <button onClick={() => setIsEditingInfo(false)} className="px-3 py-1.5 rounded-lg text-xs bg-background border border-border font-bold">إلغاء</button>
                                                        <button onClick={handleUpdateInfo} className="px-3 py-1.5 rounded-lg text-xs bg-rose-600 text-white font-bold flex items-center gap-1"><Save size={14}/> حفظ التعديلات</button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                                    <div className="bg-muted/20 border border-border/40 p-3 rounded-xl">
                                                        <p className="text-[10px] text-muted-foreground mb-1">الاسم الكامل</p>
                                                        <p className="font-bold text-xs">{selectedProfile.name}</p>
                                                    </div>
                                                    <div className="bg-muted/20 border border-border/40 p-3 rounded-xl">
                                                        <p className="text-[10px] text-muted-foreground mb-1">رقم الهاتف</p>
                                                        <p className="font-bold text-xs" dir="ltr">{selectedProfile.phone}</p>
                                                    </div>
                                                    <div className="bg-muted/20 border border-border/40 p-3 rounded-xl">
                                                        <p className="text-[10px] text-muted-foreground mb-1">البريد الإلكتروني</p>
                                                        <p className="font-bold text-xs">{selectedProfile.email || "—"}</p>
                                                    </div>
                                                    {(() => {
                                                        // خط السائق (فرع الكراج): أحدث خط من طلبات العميل المعاد جلبها في openProfile.
                                                        const route = selectedProfile.allReports.map((r: any) => {
                                                            const p = Array.isArray(r.selected_services) ? r.selected_services[0] : r.selected_services;
                                                            return String(p?.driverRoute || '').trim();
                                                        }).find(Boolean) || selectedProfile.driverRoute;
                                                        return route ? (
                                                            <div className="bg-sky-500/5 border border-sky-500/20 p-3 rounded-xl">
                                                                <p className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1"><MapPin size={11} className="text-sky-500" /> خط السائق (فرع الكراج)</p>
                                                                <p className="font-bold text-xs text-sky-500">{route}</p>
                                                            </div>
                                                        ) : null;
                                                    })()}
                                                </div>
                                            )}
                                        </div>

                                        {/* Statistics Overview */}
                                        <div className="space-y-4">
                                            <h3 className="text-sm font-bold text-foreground flex items-center gap-2 border-b border-border/40 pb-2">
                                                <Gauge size={18} className="text-rose-500" />
                                                إحصائيات الملف الشخصي للعميل
                                            </h3>
                                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                                <div className="bg-gradient-to-br from-rose-500/5 to-rose-600/5 border border-rose-500/10 p-4 rounded-2xl flex flex-col justify-center items-center text-center">
                                                    <Car className="text-rose-400 mb-1.5" size={22} />
                                                    <span className="text-[11px] text-muted-foreground font-medium">المركبات المسجلة</span>
                                                    <span className="text-base font-black mt-1">{selectedProfile.vehicles.length} سيارات</span>
                                                </div>
                                                <div className="bg-gradient-to-br from-blue-500/5 to-blue-600/5 border border-blue-500/10 p-4 rounded-2xl flex flex-col justify-center items-center text-center">
                                                    <Wrench className="text-blue-400 mb-1.5" size={22} />
                                                    <span className="text-[11px] text-muted-foreground font-medium">عدد زيارات الصيانة</span>
                                                    <span className="text-base font-black mt-1">{selectedProfile.allReports.length} زيارة</span>
                                                </div>
                                                <div className="bg-gradient-to-br from-emerald-500/5 to-emerald-600/5 border border-emerald-500/10 p-4 rounded-2xl flex flex-col justify-center items-center text-center">
                                                    <Download className="text-emerald-400 mb-1.5" size={22} />
                                                    <span className="text-[11px] text-muted-foreground font-medium">إجمالي المبالغ المدفوعة</span>
                                                    <span className="text-base font-black mt-1 text-emerald-400 font-mono" dir="ltr">
                                                        {selectedProfile.allReports.reduce((acc, r) => acc + (r.total_price || 0), 0).toLocaleString()} <span className="text-[10px] font-sans">IQD</span>
                                                    </span>
                                                </div>
                                                {(() => {
                                                    const nextOil = selectedProfile.allReports.map((r: any) => {
                                                        const p = Array.isArray(r.selected_services) ? r.selected_services[0] : r.selected_services;
                                                        const v = parseInt(String(p?.futureOdometer || "").replace(/[^\d]/g, "")) || 0;
                                                        // Reject garbage/bad entries — a real next-oil odometer is well under 2,000,000 km.
                                                        return v > 0 && v <= 2_000_000 ? v : 0;
                                                    }).find((v: number) => v > 0);
                                                    return (
                                                        <div className="bg-gradient-to-br from-amber-500/5 to-amber-600/5 border border-amber-500/10 p-4 rounded-2xl flex flex-col justify-center items-center text-center">
                                                            <Droplets className="text-amber-400 mb-1.5" size={22} />
                                                            <span className="text-[11px] text-muted-foreground font-medium">تبديل الزيت القادم</span>
                                                            <span className="text-base font-black mt-1 font-mono">{nextOil ? <><span dir="ltr">{nextOil.toLocaleString()}</span> كم</> : "—"}</span>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        </div>

                                        {/* Vehicles List */}
                                        <div className="space-y-4">
                                            <h3 className="text-sm font-bold text-foreground flex items-center gap-2 border-b border-blue-500/30 pb-2 inline-flex">
                                                <Car size={18} className="text-blue-500"/> المركبات المسجلة في الحساب
                                            </h3>
                                            {selectedProfile.vehicles.length === 0 ? (
                                                <div className="p-4 border border-dashed border-border rounded-xl text-center text-muted-foreground text-xs">
                                                    لا توجد مركبات مسجلة في هذا الملف. (يمكنك تسجيل سيارة جديدة من شاشة الاستقبال)
                                                </div>
                                            ) : (
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                    {selectedProfile.vehicles.map((v: any, idx) => (
                                                        <div key={idx} className="bg-muted/10 border border-border/40 p-4 rounded-2xl flex flex-wrap items-center gap-4">
                                                            <div className="w-10 h-10 bg-blue-500/10 text-blue-500 rounded-xl flex items-center justify-center shrink-0">
                                                                <Car size={20}/>
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <h4 className="font-bold text-sm truncate">{v.make} {v.model} <span className="text-[10px] text-muted-foreground">({v.engine_size || "—"})</span></h4>
                                                                <div className="flex flex-wrap items-center gap-2 mt-1">
                                                                    <span className="text-[11px] font-mono text-muted-foreground">اللوحة: <span className="bg-muted px-1.5 py-0.5 rounded text-foreground font-sans">{v.plate_number || "—"}</span></span>
                                                                </div>
                                                                {(() => {
                                                                    // لون المحرك عند الاستلام (مسجَّل مرة واحدة لهذه المركبة) — شريحة واضحة على سطر خاص
                                                                    let engColor: string | null = null;
                                                                    for (const r of (selectedProfile.allReports || [])) {
                                                                        if (r.vehicle?.id !== v.id) continue;
                                                                        const pay = Array.isArray(r.selected_services) ? r.selected_services[0] : r.selected_services;
                                                                        if (pay?.engineColorOnReceipt) { engColor = pay.engineColorOnReceipt; break; }
                                                                    }
                                                                    if (!engColor) return null;
                                                                    const tone = engColor === 'نظيف'
                                                                        ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20'
                                                                        : engColor === 'أسود'
                                                                            ? 'text-slate-300 bg-slate-500/15 border-slate-500/30'
                                                                            : 'text-amber-500 bg-amber-500/10 border-amber-500/20';
                                                                    return (
                                                                        <div className={`mt-2 inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg border ${tone}`}>
                                                                            <Droplets size={12} className="shrink-0" />
                                                                            <span className="font-medium opacity-70">لون المحرك عند الاستلام:</span> {engColor}
                                                                        </div>
                                                                    );
                                                                })()}
                                                            </div>
                                                            {v.booklet_serial && (
                                                                <button onClick={() => router.push(`/sticker/${encodeURIComponent(v.booklet_serial)}`)}
                                                                    className="shrink-0 px-3 py-2 bg-rose-600/10 hover:bg-rose-600 hover:text-white text-rose-400 border border-rose-500/30 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5"
                                                                    title="طباعة ملصق الدفتر">
                                                                    <FileText size={14} /> ملصق الدفتر
                                                                </button>
                                                            )}
                                                            {isOwnerOrAdmin && selectedProfile.allReports.some(r => r.vehicle?.id === v.id) && (
                                                                <div className="basis-full flex">{cid ? (
                                                                    <button onClick={() => moveVehicle(v, null)} disabled={movingVehicleId === v.id}
                                                                        className="px-3 py-2 bg-muted hover:bg-muted/70 border border-border rounded-xl text-xs font-bold flex items-center gap-1.5 disabled:opacity-60"
                                                                        title="إرجاع السيارة وأوراقها إلى سجل العملاء">
                                                                        {movingVehicleId === v.id ? <Loader2 size={14} className="animate-spin" /> : <ArrowLeftRight size={14} />} إرجاع إلى العملاء
                                                                    </button>
                                                                ) : contracts.length === 1 ? (
                                                                    <button onClick={() => moveVehicle(v, contracts[0])} disabled={movingVehicleId === v.id}
                                                                        className="px-3 py-2 bg-amber-500/10 hover:bg-amber-500 hover:text-black text-amber-400 border border-amber-500/30 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 disabled:opacity-60"
                                                                        title="نقل السيارة وكل أوراقها السابقة إلى تبويب العقود">
                                                                        {movingVehicleId === v.id ? <Loader2 size={14} className="animate-spin" /> : <Landmark size={14} />} نقل إلى عقد {contracts[0].name}
                                                                    </button>
                                                                ) : contracts.length > 1 ? (
                                                                    <select value="" disabled={movingVehicleId === v.id}
                                                                        onChange={e => { const t = contracts.find(c => c.id === e.target.value); if (t) moveVehicle(v, t); }}
                                                                        className="px-2 py-2 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-xl text-xs font-bold cursor-pointer">
                                                                        <option value="">نقل إلى عقد…</option>
                                                                        {contracts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                                                    </select>
                                                                ) : null}</div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        {/* الفحص الشامل — organized list of the customer's inspections */}
                                        {(() => {
                                            const inspections = selectedProfile.allReports.filter((r: any) => (Array.isArray(r.selected_services) ? r.selected_services[0] : r.selected_services)?.comprehensiveInspection);
                                            if (!inspections.length) return null;
                                            return (
                                                <div className="space-y-4">
                                                    <h3 className="text-sm font-bold text-foreground flex items-center gap-2 border-b border-blue-500/30 pb-2 inline-flex">
                                                        <FileText size={18} className="text-blue-500" /> الفحص الشامل ({inspections.length})
                                                    </h3>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                        {inspections.map((r: any) => (
                                                            <button key={r.id} onClick={() => handleSelectVisitTab(r.id)}
                                                                className="bg-blue-500/5 border border-blue-500/20 hover:bg-blue-500 hover:text-white text-blue-400 p-3.5 rounded-2xl flex items-center justify-between gap-2 transition-colors text-right">
                                                                <div>
                                                                    <div className="font-bold text-sm">فحص شامل — فاتورة #{r.report_number}</div>
                                                                    <div className="text-[11px] opacity-80">{r.branches?.name || ""} • {new Date(r.created_at).toLocaleDateString("en-GB")}</div>
                                                                </div>
                                                                <FileText size={18} className="shrink-0" />
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                ) : (
                                    /* Visit Details Tab Content */
                                    <div className="space-y-6">
                                        {loadingDetails ? (
                                            <div className="flex flex-col items-center justify-center py-20 gap-3">
                                                <Loader2 className="animate-spin text-emerald-500 w-10 h-10" />
                                                <span className="text-xs text-muted-foreground font-bold">جاري تحميل تفاصيل الزيارة...</span>
                                            </div>
                                        ) : loadedReports[activeProfileTab] ? (
                                            <VisitDetailsView 
                                                report={loadedReports[activeProfileTab]}
                                                isOwnerOrAdmin={isOwnerOrAdmin}
                                                onDeleteReport={handleDeleteReport}
                                                onReopenReport={handleReopenReport}
                                                router={router}
                                                contractId={cid}
                                            />
                                        ) : (
                                            <div className="text-center text-muted-foreground py-20 text-xs">عذراً، فشل تحميل تفاصيل هذه الفاتورة.</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                    </div>
                </div>
            )}

            {/* Add Client Modal */}
            {isAddModalOpen && (
                <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-card border border-border rounded-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                        <div className="p-6 border-b border-border">
                            <h2 className="text-xl font-bold text-foreground">إضافة عميل جديد</h2>
                        </div>
                        <form onSubmit={handleAddClient} className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-muted-foreground mb-1.5">اسم العميل *</label>
                                <input 
                                    type="text" required
                                    value={name} onChange={e => setName(e.target.value)}
                                    className="w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:border-rose-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-muted-foreground mb-1.5">رقم الهاتف *</label>
                                <input 
                                    type="tel" required dir="ltr"
                                    value={phone} onChange={e => setPhone(e.target.value)}
                                    className="w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:border-rose-500 text-right"
                                />
                            </div>
                            <div className="pt-4 flex gap-3">
                                <button type="submit" className="flex-1 bg-rose-600 hover:bg-rose-500 text-white py-2.5 rounded-xl font-bold transition-colors">
                                    حفظ
                                </button>
                                <button type="button" onClick={() => setIsAddModalOpen(false)} className="flex-1 bg-muted hover:bg-muted/70 text-foreground py-2.5 rounded-xl font-bold transition-colors">
                                    إلغاء
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

function VisitDetailsView({ report, isOwnerOrAdmin, onDeleteReport, onReopenReport, router, contractId = null }: {
    report: any;
    isOwnerOrAdmin: boolean;
    onDeleteReport: (id: string, num: number) => Promise<void>;
    onReopenReport: (id: string, num: number) => Promise<void>;
    router: any;
    contractId?: string | null;
}) {
    const isPaperV2 = report.selected_services?.[0]?.is_paper_v2_format === true;
    const servicePayload = isPaperV2 ? report.selected_services[0] : null;
    const inspPayload = Array.isArray(report.selected_services) ? report.selected_services[0] : report.selected_services;
    const isComprehensiveInspection = !!inspPayload?.comprehensiveInspection;

    const services = servicePayload?.services || {};
    const freeServices = servicePayload?.freeServices || {};
    const oldServicesList = !isPaperV2 && Array.isArray(report.selected_services) ? report.selected_services : [];
    
    const oilSvc = services.engineOil || {};
    const oilDetails = oilSvc.details || {};

    const replacedItems: string[] = [];
    const inspectedItems: string[] = [];

    const SERVICE_LABELS: Record<string, string> = {
        engineOil: 'زيت المحرك', oilFilter: 'فلتر زيت المحرك',
        airFilter: 'فلتر الهواء', acFilter: 'فلتر التبريد',
        brakeFluid: 'زيت المكابح', coolant: 'ماء الراديتر',
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

    const FREE_SERVICES_MAP: Record<string, string> = {
        windshieldWater: "ماء المساحات",
        tirePressure: "ضغط الإطارات",
        engineClean: "تنظيف محرك بالبخار",
    };

    if (isPaperV2) {
        Object.entries(services).forEach(([key, val]: [string, any]) => {
            const label = SERVICE_LABELS[key] || key;
            if (val?.status === "يحتاج تغيير") {
                let detailStr = "";
                if (key === 'engineOil') {
                    const brand = oilDetails.type || oilDetails.brand || "";
                    const visc = oilDetails.viscosity || "";
                    const qty = oilDetails.liters || oilDetails.qty || "";
                    detailStr = [brand, visc, qty ? `${qty}L` : ""].filter(Boolean).join(" - ");
                } else if (key === 'additives' || key === 'cleaners') {
                    const added: string[] = [];
                    for (let i = 0; i < 10; i++) {
                        if (val.details?.[`prod_${i}`]) added.push(val.details[`prod_${i}`]);
                    }
                    detailStr = added.join(" + ");
                } else {
                    const specs: string[] = [];
                    if (val.details?.qty || val.details?.liters) specs.push(`العدد: ${val.details?.qty || val.details?.liters}`);
                    if (val.details?.type || val.details?.brand) specs.push(val.details?.type || val.details?.brand);
                    detailStr = specs.join(" - ");
                }
                replacedItems.push(label + (detailStr ? ` (${detailStr})` : ""));
            } else if (val?.status === "جيد") {
                inspectedItems.push(label);
            }
        });

        const customServices = servicePayload?.customServices || [];
        customServices.forEach((c: any) => {
            if (c.label) replacedItems.push(c.label);
        });
    } else {
        oldServicesList.forEach((s: any) => {
            const lbl = typeof s === 'string' ? s : (s.label || s.service || 'خدمة صيانة');
            if (s.status === 'يحتاج تغيير' || typeof s === 'string') {
                replacedItems.push(SERVICE_LABELS[lbl] || lbl);
            } else if (s.status === 'جيد') {
                inspectedItems.push(SERVICE_LABELS[lbl] || lbl);
            }
        });
    }

    const activeFreeServices: string[] = [];
    Object.entries(freeServices).forEach(([key, val]) => {
        if (val === true && FREE_SERVICES_MAP[key]) {
            activeFreeServices.push(FREE_SERVICES_MAP[key]);
        }
    });

    const dateObj = new Date(report.created_at);
    const formattedDate = dateObj.toLocaleDateString("en-GB", {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const formattedTime = dateObj.toLocaleTimeString("ar-IQ", {
        hour: '2-digit',
        minute: '2-digit'
    });

    return (
        <div className="space-y-6">
            {/* Visit Details Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/40 pb-4">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-xs bg-muted px-2.5 py-1 rounded-lg font-bold border border-border">زيارة #{report.report_number}</span>
                        <span className="text-[11px] text-muted-foreground">{formattedDate} ({formattedTime})</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${
                            report.status === "completed" || report.status === "تم الانتهاء"
                                ? (isAccounted(report)
                                    ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                                    : "bg-indigo-500/10 text-indigo-500 border-indigo-500/20")
                                : report.status === "قيد العمل"
                                    ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                    : "bg-blue-500/10 text-blue-500 border-blue-500/20"
                        }`}>
                            {report.status === "completed" || report.status === "تم الانتهاء"
                                ? (isAccounted(report) ? "تم الانتهاء" : "في انتظار المحاسبة")
                                : report.status === "قيد العمل" ? "قيد العمل" : "انتظار"}
                        </span>
                    </div>
                    {report.vehicle && (
                        <p className="text-xs font-bold text-foreground">
                            المركبة: <span className="text-muted-foreground font-normal">{report.vehicle.make} {report.vehicle.model} ({report.vehicle.plate_number})</span>
                        </p>
                    )}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                    <p className="h-9 flex items-center text-sm font-bold text-emerald-500 bg-emerald-500/10 px-3 rounded-lg border border-emerald-500/20" dir="ltr">
                        {report.total_price ? report.total_price.toLocaleString() : 0} <span className="text-[10px] mr-1">IQD</span>
                    </p>
                    {(report.status === "completed" || report.status === "تم الانتهاء") && (
                        <button onClick={() => onReopenReport(report.id, report.report_number)} className="h-9 px-3 flex items-center gap-1.5 bg-amber-500/10 hover:bg-amber-500 hover:text-white rounded-lg text-amber-500 font-bold text-xs transition-colors border border-amber-500/30" title="إرجاع السيارة للعمل">
                            <RefreshCcw size={15}/> إرجاع للعمل
                        </button>
                    )}
                    {isComprehensiveInspection && (
                        <button onClick={() => window.open(`/inspection/${report.id}`, "_blank")} className="h-9 px-3 flex items-center gap-1.5 bg-blue-500/10 hover:bg-blue-500 hover:text-white rounded-lg text-blue-400 font-bold text-xs transition-colors border border-blue-500/30" title="طباعة الفحص الشامل">
                            <FileText size={15}/> فحص شامل
                        </button>
                    )}
                    <Link href={`/reception?edit=${report.id}${contractId ? `&contract=${contractId}` : ''}`} className="h-9 w-9 flex items-center justify-center bg-muted hover:bg-blue-500 hover:text-white rounded-lg text-muted-foreground transition-colors border border-border" title="تعديل الفاتورة بالكامل">
                        <Edit2 size={15}/>
                    </Link>
                    <button onClick={() => router.push(`/print/${report.id}?mode=full`)} className="h-9 w-9 flex items-center justify-center bg-muted hover:bg-emerald-500 hover:text-white rounded-lg text-muted-foreground transition-colors border border-border" title="طباعة الفاتورة">
                        <FileText size={15}/>
                    </button>
                    {isOwnerOrAdmin && (
                        <button onClick={() => onDeleteReport(report.id, report.report_number)} className="h-9 w-9 flex items-center justify-center bg-muted hover:bg-rose-600 hover:text-white rounded-lg text-muted-foreground transition-colors border border-border" title="حذف الفاتورة">
                            <Trash2 size={15}/>
                        </button>
                    )}
                </div>
            </div>

            {/* Visit Details Stats */}
            <div className="grid grid-cols-2 gap-4">
                <div className="bg-muted/20 p-3.5 rounded-2xl border border-border/40 flex flex-col justify-center items-center text-center">
                    <Gauge className="text-rose-400 mb-1" size={18} />
                    <span className="text-[10px] text-muted-foreground font-medium">قراءة العداد</span>
                    <span className="text-xs font-bold text-foreground mt-1 font-mono">{report.odometer_reading ? report.odometer_reading.toLocaleString() : "—"} كم</span>
                </div>
                <div className="bg-muted/20 p-3.5 rounded-2xl border border-border/40 flex flex-col justify-center items-center text-center">
                    <MapPin className="text-blue-400 mb-1" size={18} />
                    <span className="text-[10px] text-muted-foreground font-medium">الفرع</span>
                    <span className="text-xs font-bold text-foreground mt-1">{report.branches?.name || "فرع رئيسي"}</span>
                </div>
            </div>

            {/* Comprehensive inspection RESULT (shown in the customer file) */}
            {isComprehensiveInspection && inspPayload?.comprehensiveInspection && (() => {
                const ci = inspPayload.comprehensiveInspection;
                const badge = (s: string) => s === "سليم" ? "bg-emerald-500/15 text-emerald-400" : s === "صيانة" ? "bg-amber-500/15 text-amber-400" : s === "تالف" ? "bg-rose-500/15 text-rose-400" : "bg-muted text-muted-foreground";
                return (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                            <h5 className="text-sm font-bold text-blue-400 flex items-center gap-2"><FileText size={15} /> نتيجة الفحص الشامل</h5>
                            {ci.rating && <span className={`text-xs font-bold px-2.5 py-1 rounded-lg ${badge(ci.rating)}`}>التقييم: {ci.rating}{ci.percentage ? ` (${ci.percentage}%)` : ""}</span>}
                        </div>
                        {INSPECTION_SECTIONS.map((sec) => {
                            const items = sec.items.filter((it) => ci.items?.[it.key]?.status || ci.items?.[it.key]?.note);
                            if (!items.length) return null;
                            return (
                                <div key={sec.key} className="bg-muted/10 border border-border/40 rounded-xl p-3">
                                    <div className="text-xs font-bold text-foreground mb-2 border-b border-border/40 pb-1">{sec.title}</div>
                                    <div className="space-y-1.5">
                                        {items.map((it) => {
                                            const d = ci.items[it.key];
                                            return (
                                                <div key={it.key} className="flex items-center gap-2 text-[11px]">
                                                    <span className="flex-1 font-medium">{it.label}</span>
                                                    {d.status && <span className={`px-2 py-0.5 rounded font-bold ${badge(d.status)}`}>{d.status}</span>}
                                                    {d.note && <span className="text-muted-foreground">— {d.note}</span>}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                        {ci.finalNotes && (
                            <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 text-xs">
                                <span className="font-bold text-amber-400">الملاحظات النهائية: </span>{ci.finalNotes}
                            </div>
                        )}
                        <button onClick={() => window.open(`/inspection/${report.id}`, "_blank")}
                            className="w-full py-2.5 bg-blue-600/10 hover:bg-blue-600 hover:text-white text-blue-400 border border-blue-500/30 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-2">
                            <FileText size={14} /> طباعة الفحص الشامل (PDF)
                        </button>
                    </div>
                );
            })()}

            {/* Replaced Parts / Completed Services List */}
            {replacedItems.length > 0 && (
                <div className="space-y-3">
                    <h5 className="text-xs font-bold text-foreground flex items-center gap-2 border-b border-border/40 pb-2">
                        <Wrench size={12} className="text-amber-500" />
                        القطع المستبدلة والخدمات المنجزة
                    </h5>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {replacedItems.map((item, idx) => (
                            <div key={idx} className="flex items-start gap-2 text-[11px] font-semibold text-foreground bg-muted/10 border border-border/20 p-2.5 rounded-xl">
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                                <span>{item}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Free services list */}
            {activeFreeServices.length > 0 && (
                <div className="space-y-3">
                    <h5 className="text-xs font-bold text-foreground flex items-center gap-2 border-b border-border/40 pb-2">
                        <CheckCircle2 size={12} className="text-emerald-500" />
                        خدمات مجانية إضافية منجزة
                    </h5>
                    <div className="flex flex-wrap gap-2">
                        {activeFreeServices.map((fs, idx) => (
                            <span key={idx} className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-xl">
                                ✓ {fs}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Checked items list (Good status) */}
            {inspectedItems.length > 0 && (
                <div className="space-y-3">
                    <h5 className="text-xs font-bold text-foreground flex items-center gap-2 border-b border-border/40 pb-2">
                        <ShieldCheck size={12} className="text-blue-400" />
                        أجزاء تم فحصها وحالتها جيدة
                    </h5>
                    <div className="flex flex-wrap gap-2">
                        {inspectedItems.map((item, idx) => (
                            <span key={idx} className="text-[10px] font-medium text-muted-foreground bg-muted/20 border border-border/30 px-2 py-1.5 rounded-xl">
                                {item}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Visit footer (Staff info) */}
            {(report.receptionist?.name || servicePayload?.shiftSupervisor || servicePayload?.technicianName) && (
                <div className="flex flex-wrap justify-between items-center gap-2 text-[10px] text-muted-foreground bg-muted/10 p-2.5 rounded-xl border border-border/20">
                    {report.receptionist?.name && (
                        <span>موظف الاستقبال: <strong className="text-foreground">{report.receptionist.name}</strong></span>
                    )}
                    {servicePayload?.shiftSupervisor && (
                        <span>مشرف الشفت: <strong className="text-foreground">{servicePayload.shiftSupervisor}</strong></span>
                    )}
                    {servicePayload?.technicianName && (
                        <span>الفني المختص: <strong className="text-foreground">{servicePayload.technicianName}</strong></span>
                    )}
                </div>
            )}
        </div>
    );
}
