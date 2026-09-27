"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { reopenWorkOrder } from "@/lib/reopenOrder";
import { Clock, CheckCircle2, Play, AlertTriangle, Plus, Printer, Activity, Wrench, StopCircle, ArrowRight, Loader2, Eye, X, RefreshCcw, Droplet } from "lucide-react";

// حالة المحرك عند الاستلام — لون المحرك من الداخل قبل تبديل الزيت (يُسجَّل مرة واحدة لكل مركبة)
const ENGINE_COLORS = ["نظيف", "نصف نظيف", "أسود"];
import catalogRaw from '@/lib/data/servicesCatalog.json';
import Link from "next/link";
import { useAuth } from "@/lib/AuthProvider";
import { PrintableInspectionReport } from "@/components/PrintableInspectionReport";
import InspectionChecklist from "@/components/InspectionChecklist";
import { emptyInspection } from "@/lib/comprehensiveInspection";
import { showSuccess, showError } from "@/lib/alerts";
import { syncOrderToGoogleSheets } from "@/lib/googleSheetsSync";

// Format a duration in seconds as H:MM:SS (or MM:SS when under an hour).
function fmtHMS(totalSeconds: number): string {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n: number) => n.toString().padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
// Format a duration in minutes as "1س 30د" / "45د" / "2س".
function fmtDurationMin(minutes: number): string {
    const m = Math.max(0, Math.floor(minutes || 0));
    const h = Math.floor(m / 60);
    const mm = m % 60;
    if (h > 0 && mm > 0) return `${h}س ${mm}د`;
    if (h > 0) return `${h}س`;
    return `${mm}د`;
}

// One technician's entry on a work order: name + their own performance rating + notes.
type TechEntry = { name: string; rating: string; notes: string };

// Split an old joined technician-name string ("أحمد + علي"، "أحمد، علي"، "أحمد / علي")
// into individual names — used only to migrate legacy orders into the per-technician list.
function splitTechNames(raw: string): string[] {
    return (raw || "").split(/[+،,\n/]/).map(s => s.trim()).filter(Boolean);
}

type WorkOrder = {
    id: string;
    report_number: number;
    contract_id?: string | null;
    contract?: { name: string } | null;
    status: string;
    order_type?: string;
    estimated_duration: number;
    elapsed_time: number;
    start_time: string | null;
    completed_at?: string | null;
    is_delayed: boolean;
    total_price: number;
    selected_services: any[];
    receptionist: { name: string } | null;
    branches?: { id: string; name: string } | null;
    vehicles: { make: string; model: string; plate_number: string; booklet_serial?: string | null; clients?: { name: string; phone: string } };
    bay_number: string | null;
    odometer_reading: number;
    odometer_unit?: string;
    technician_id: string | null;
    technician_rating?: string | null;
    technician_rating_notes?: string | null;
    branch_id: string | null;
    notes: string | null;
};

type ReportServiceResult = {
    id: string;
    category: string;
    status: string;
    notes: string | null;
    service_price: number | null;
};

const PAPER_V2_SERVICE_DEFS: Record<string, { name: string; estimatedMinutes: number }> = {
    engineOil: { name: "زيت المحرك", estimatedMinutes: 30 },
    oilFilter: { name: "فلتر زيت المحرك", estimatedMinutes: 20 },
    airFilter: { name: "فلتر الهواء", estimatedMinutes: 20 },
    acFilter: { name: "فلتر التبريد", estimatedMinutes: 20 },
    brakeFluid: { name: "زيت المكابح", estimatedMinutes: 25 },
    coolant: { name: "ماء الراديتر", estimatedMinutes: 30 },
    battery: { name: "البطارية", estimatedMinutes: 20 },
    engineBelts: { name: "قايش المحرك", estimatedMinutes: 30 },
    brakePads: { name: "دسكات السيارة", estimatedMinutes: 30 },
    sparkPlugs: { name: "شمعات الاحتراق", estimatedMinutes: 30 },
    gearboxHydraulic: { name: "هايدروليك الكير", estimatedMinutes: 45 },
    gearboxFilter: { name: "فلتر الكير", estimatedMinutes: 30 },
    wipers: { name: "الماسحات", estimatedMinutes: 15 },
    additives: { name: "المضافات والمحسنات", estimatedMinutes: 10 },
    // Sector Branch new service keys mapping
    engineFlash: { name: "فلاش محرك", estimatedMinutes: 20 },
    engineCeramic: { name: "سيراميك محرك", estimatedMinutes: 15 },
    linerCleaner: { name: "منظف بطانة (جكجكة)", estimatedMinutes: 15 },
    oilLeakPreventer: { name: "مانع تسريب زيت", estimatedMinutes: 15 },
    smokePreventer: { name: "مانع دخان / نقص زيت", estimatedMinutes: 15 },
    gearboxFlash: { name: "فلاش كير", estimatedMinutes: 25 },
    gearboxOil: { name: "زيت كير", estimatedMinutes: 35 },
    gearboxCeramic: { name: "سيراميك كير", estimatedMinutes: 15 },
    gearboxAntiSlip: { name: "مانع انزلاق الكير", estimatedMinutes: 15 },
    acCleaner: { name: "منظف دورة التبريد", estimatedMinutes: 20 },
    injectorCleaner: { name: "منظف بخاخات", estimatedMinutes: 20 },
    fuelSystemCleaner: { name: "منظف نظام الوقود", estimatedMinutes: 20 },
    octaneBooster: { name: "أوكتان بنزين", estimatedMinutes: 10 },
    batteryFilter: { name: "فلتر البطارية", estimatedMinutes: 15 },
    windshieldFluid: { name: "سائل غسيل جام", estimatedMinutes: 10 },
    // legacy support
    transOil: { name: "زيت الفتيس (ناقل الحركة)", estimatedMinutes: 45 },
    brakeCable: { name: "تيل الفرامل", estimatedMinutes: 30 },
    shockAbsorbers: { name: "المساعدين", estimatedMinutes: 40 },
    hydraulics: { name: "الهيدروليك والمصمات", estimatedMinutes: 40 },
    workshopNotes: { name: "ملاحظة الصيانة", estimatedMinutes: 15 },
};

const PAPER_V2_FREE_SERVICES: Record<string, string> = {
    windshieldWater: "ماء المساحات",
    tirePressure: "ضغط الإطارات",
    engineClean: "تنظيف محرك بالبخار",
};

export default function WorkOrderDetailPage() {
    const params = useParams();
    const router = useRouter();
    const id = params.id as string;
    const { employeeRole, employeeBranchId, permissionWorkOrders, loading: authLoading } = useAuth();

    const [order, setOrder] = useState<WorkOrder | null>(null);
    const [loading, setLoading] = useState(true);
    const [unauthorized, setUnauthorized] = useState(false);
    const [liveSeconds, setLiveSeconds] = useState(0);
    const [isAddingSvc, setIsAddingSvc] = useState(false);
    const [inspectedServices, setInspectedServices] = useState<ReportServiceResult[]>([]);
    // الفحص الشامل (comprehensive inspection) — opened as a section on the floor.
    const [showInspection, setShowInspection] = useState(false);
    const [inspection, setInspection] = useState(emptyInspection());
    const [savingInspection, setSavingInspection] = useState(false);
    // حالة المحرك عند الاستلام — لون المحرك قبل تبديل الزيت. يُسجَّل مرة واحدة لكل مركبة؛
    // بعد أول تسجيل يظهر للقراءة فقط ولا يُطلب من الزبون مجدداً.
    const [engineColor, setEngineColor] = useState("");
    const [existingEngineColor, setExistingEngineColor] = useState<string | null>(null);
    const [savingEngineColor, setSavingEngineColor] = useState(false);
    const engineColorLoadedRef = useRef(false);
    const suggestionsLoadedRef = useRef(false);

    // Diagnostic Modal States
    const [isDiagnosing, setIsDiagnosing] = useState(false);
    const [diagName, setDiagName] = useState("");
    const [diagStatus, setDiagStatus] = useState("يحتاج صيانة");
    const [diagNotes, setDiagNotes] = useState("");
    
    // Print Preview States
    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewMode, setPreviewMode] = useState<'full' | 'short'>('short');

    // Technician & Bay Details States
    const [supervisorName, setSupervisorName] = useState("");
    const [bayNum, setBayNum] = useState("");
    const [odometer, setOdometer] = useState("");
    const [odometerUnit, setOdometerUnit] = useState<'km' | 'mi'>('km');
    // Future odometer = current reading + a service interval (km auto-converted to miles).
    const [futureOdometer, setFutureOdometer] = useState("");
    const FUTURE_INTERVALS = [3000, 5000, 8000, 10000];
    const addFutureKm = (km: number) => {
        const base = parseInt(odometer || "0") || 0;
        const inc = odometerUnit === 'mi' ? Math.round(km * 0.6214) : km;
        setFutureOdometer(String(base + inc));
    };
    const [maintNotes, setMaintNotes] = useState("");
    const [isSavingDetails, setIsSavingDetails] = useState(false);

    // Technician performance rating (by the supervisor).
    // Several technicians can work the SAME car; each keeps its OWN rating + notes.
    const RATING_OPTIONS = ['رديء', 'متوسط', 'جيد', 'جيد جداً', 'ممتاز'];
    const [technicians, setTechnicians] = useState<TechEntry[]>([{ name: "", rating: "", notes: "" }]);
    const addTechnician = () => setTechnicians(prev => [...prev, { name: "", rating: "", notes: "" }]);
    const removeTechnician = (i: number) => setTechnicians(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev);
    const updateTechnician = (i: number, field: keyof TechEntry, value: string) =>
        setTechnicians(prev => prev.map((t, idx) => idx === i ? { ...t, [field]: value } : t));
    // Derived: only technicians that actually have a name, and their joined label for legacy displays.
    const validTechs = technicians.filter(t => t.name.trim());
    const techNameJoined = validTechs.map(t => t.name.trim()).join(' + ');
    // Merge the technician list into selected_services[0]: keeps a joined technicianName for
    // backward-compatible displays (lists, print, booklet) plus the structured per-technician array.
    const withTechnicians = (base: any[]): any[] => {
        const arr = [...(base || [])];
        const techArr = validTechs.map(t => ({ name: t.name.trim(), rating: t.rating || "", notes: t.notes || "" }));
        const merged = { technicianName: techNameJoined, shiftSupervisor: supervisorName, technicians: techArr, futureOdometer: futureOdometer || "" };
        if (arr.length > 0) arr[0] = { ...arr[0], ...merged };
        else arr.push({ is_paper_v2_format: true, ...merged, services: {} });
        return arr;
    };

    // Read the freshest selected_services right before a save, so a stale `order` (realtime refetch
    // or a concurrent edit) can never overwrite/wipe the services stored in the DB.
    const freshSelectedServices = async (): Promise<any[]> => {
        const { data } = await supabase.from('inspection_reports').select('selected_services').eq('id', id).single();
        return (data?.selected_services as any[]) || order?.selected_services || [];
    };

    // "بدء الخدمة" flow: pick an estimated duration (hours + minutes) before the timer starts.
    const [showStartModal, setShowStartModal] = useState(false);
    const [estHours, setEstHours] = useState("0");
    const [estMinutes, setEstMinutes] = useState("30");
    const [startError, setStartError] = useState("");

    // Add Dynamic Service States
    const [selectedCatalogId, setSelectedCatalogId] = useState("");
    const [dynamicSvcName, setDynamicSvcName] = useState("");
    const [dynamicSvcPrice, setDynamicSvcPrice] = useState("");
    const [dynamicSvcDuration, setDynamicSvcDuration] = useState("30");
    const [dynamicSvcDetails, setDynamicSvcDetails] = useState("");
    const [dynamicSvcCategory, setDynamicSvcCategory] = useState("إضافة لاحقة");
    // "خدمة إضافية" using the same reception service set + fields (standard services).
    const [selectedSvcKey, setSelectedSvcKey] = useState("");
    const [svcBrand, setSvcBrand] = useState("");
    const [svcViscosity, setSvcViscosity] = useState("");
    const [svcLiters, setSvcLiters] = useState("");
    const [svcType, setSvcType] = useState("");
    const [svcFilterNum, setSvcFilterNum] = useState("");
    const [svcNum, setSvcNum] = useState("");
    const [svcQty, setSvcQty] = useState("1");
    const [svcSize, setSvcSize] = useState("");
    const [svcPrice, setSvcPrice] = useState("");
    const [svcNotes, setSvcNotes] = useState("");
    const [wipersList, setWipersList] = useState<{ id: string; type: string; size: string; qty: string; price: string; notes: string }[]>([
        { id: "1", type: "", size: "", qty: "1", price: "", notes: "" }
    ]);
    const [additivesList, setAdditivesList] = useState<{ id: string; name: string; qty: string; price: string; notes: string }[]>([
        { id: "1", name: "", qty: "1", price: "", notes: "" }
    ]);

    // Suggestion lists (technicians, supervisors, bay numbers)
    const [suggLists, setSuggLists] = useState<Record<string, string[]>>({
        technicianNames: [], supervisorNames: [], bayNumbers: []
    });
    // The editable form fields are initialized from the DB only ONCE (first load). Realtime/refetch
    // must not overwrite what the supervisor is currently typing, or unsaved details vanish.
    const formInitializedRef = useRef(false);
    
    // Fetch
    useEffect(() => {
        if (authLoading) return;
        // Reset per-vehicle engine-color state so navigating between work orders without a
        // remount doesn't carry the previous vehicle's recorded color into this one.
        engineColorLoadedRef.current = false;
        suggestionsLoadedRef.current = false;
        setEngineColor("");
        setExistingEngineColor(null);
        fetchOrder();
        
        // Subscription for live mid-air updates
        const channel = supabase.channel(`work_order_${id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'inspection_reports', filter: `id=eq.${id}` }, () => {
                fetchOrder();
            }).subscribe();
            
        return () => { supabase.removeChannel(channel); };
    }, [id, authLoading]);

    // Load the engine color already recorded for THIS vehicle (across all its visits), once.
    // If it exists, the section shows read-only so the customer isn't asked to record it again.
    useEffect(() => {
        const vid = (order as any)?.vehicle_id;
        if (!vid || engineColorLoadedRef.current) return;
        engineColorLoadedRef.current = true;
        (async () => {
            // One scalar via a JSON-path select — the old query downloaded every visit's
            // full selected_services payload just to find this string.
            const { data } = await (supabase as any)
                .from('inspection_reports')
                .select('color:selected_services->0->>engineColorOnReceipt')
                .eq('vehicle_id', vid)
                .not('selected_services->0->>engineColorOnReceipt', 'is', null)
                .neq('selected_services->0->>engineColorOnReceipt', '')
                .limit(1);
            const found = (data?.[0] as any)?.color || null;
            if (found) { setExistingEngineColor(found); setEngineColor(found); }
        })();
    }, [order]);

    const fetchOrder = async () => {
        const { data } = await supabase
            .from('inspection_reports')
            .select(`id, report_number, status, order_type, estimated_duration, elapsed_time, start_time, completed_at, is_delayed, odometer_reading, odometer_unit, technician_rating, technician_rating_notes, total_price, bay_number, notes, selected_services, branch_id, vehicle_id, contract_id, contract:contracts(name), branches(id, name), vehicles (make, model, plate_number, engine_size, booklet_serial, clients (name, phone)), receptionist:receptionist_id(name)`)
            .eq('id', id)
            .single();

        if (data) {
            if (employeeBranchId && employeeRole !== 'Owner' && data.branch_id && data.branch_id !== employeeBranchId) {
                setUnauthorized(true);
                setLoading(false);
                return;
            }
            setOrder(data as any as WorkOrder);

            // Initialize the editable form fields ONLY on the first load. Subsequent refetches
            // (realtime, or after a save) update `order` for the timer/services grid but must NOT
            // reset these inputs — otherwise details the supervisor is typing suddenly disappear.
            if (!formInitializedRef.current) {
                formInitializedRef.current = true;
                const firstSvc = data.selected_services?.[0];
                // Multi-technician: prefer the structured array; fall back to the old single name + rating.
                if (Array.isArray(firstSvc?.technicians) && firstSvc.technicians.length > 0) {
                    setTechnicians(firstSvc.technicians.map((t: any) => ({
                        name: t?.name || "", rating: t?.rating || "", notes: t?.notes || ""
                    })));
                } else {
                    const names = splitTechNames(firstSvc?.technicianName || "");
                    const r0 = (data as { technician_rating?: string }).technician_rating || "";
                    const n0 = (data as { technician_rating_notes?: string }).technician_rating_notes || "";
                    setTechnicians(names.length > 0
                        ? names.map((nm, i) => ({ name: nm, rating: i === 0 ? r0 : "", notes: i === 0 ? n0 : "" }))
                        : [{ name: "", rating: "", notes: "" }]);
                }
                setSupervisorName(firstSvc?.shiftSupervisor || "");
                setFutureOdometer(firstSvc?.futureOdometer || "");
                setBayNum(data.bay_number || "");
                setOdometer(data.odometer_reading?.toString() || "");
                setOdometerUnit((data as { odometer_unit?: string }).odometer_unit === 'mi' ? 'mi' : 'km');
                setMaintNotes(data.notes || "");
            }

            // Fetch suggestions for this order's branch (static lists — once, not on every realtime tick)
            if (!suggestionsLoadedRef.current) {
                suggestionsLoadedRef.current = true;
            (supabase as any).from('suggestion_lists').select('key, items')
                .in('key', ['technicianNames', 'supervisorNames', 'bayNumbers'])
                .eq('branch_id', data.branch_id)
                .then(({ data: suggData }: { data: any[] | null }) => {
                    if (suggData) {
                        const m: Record<string, string[]> = {};
                        suggData.forEach(r => { m[r.key] = Array.isArray(r.items) ? r.items : []; });
                        setSuggLists(prev => ({ ...prev, ...m }));
                    }
                });
            }
            
            let currentLiveSeconds = (data.elapsed_time || 0) * 60;
            if (data.status === 'قيد العمل' && data.start_time) {
                const startMs = new Date(data.start_time).getTime();
                currentLiveSeconds += Math.floor((Date.now() - startMs) / 1000);
            }
            setLiveSeconds(currentLiveSeconds);
            
            // Fetch inspected services (The actual health check)
            const { data: svcs } = await supabase.from('report_services').select('*').eq('report_id', id);
            if (svcs) setInspectedServices(svcs as any);
        }
        setLoading(false);
    };

    // Live Timer Engine
    useEffect(() => {
        if (!order || order.status !== 'قيد العمل' || !order.start_time) return;

        const interval = setInterval(() => {
            const startMs = new Date(order.start_time!).getTime();
            const nowMs = Date.now();
            setLiveSeconds((order.elapsed_time || 0) * 60 + Math.floor((nowMs - startMs) / 1000));
        }, 1000); // Check every second

        return () => clearInterval(interval);
    }, [order]);

    const handleSaveDetailsOnly = async () => {
        if (!order) return;
        setIsSavingDetails(true);
        try {
            const updatedServices = withTechnicians(await freshSelectedServices());

            const { error } = await supabase
                .from('inspection_reports')
                .update({
                    bay_number: bayNum || null,
                    notes: maintNotes || null,
                    odometer_reading: odometer ? parseInt(odometer) : 0,
                    odometer_unit: odometerUnit,
                    technician_rating: validTechs[0]?.rating || null,
                    technician_rating_notes: validTechs[0]?.notes || null,
                    selected_services: updatedServices
                })
                .eq('id', id);

            if (error) throw error;
            showSuccess("تم الحفظ", "تم تحديث تفاصيل الصيانة بنجاح!");
            fetchOrder();
        } catch (err) {
            console.error(err);
            showError("خطأ", "فشل حفظ التفاصيل");
        } finally {
            setIsSavingDetails(false);
        }
    };

    // Step 1: open the mandatory "estimated service time" modal. The timer does NOT start yet.
    const handleStart = () => {
        if (!order) return;
        if (validTechs.length === 0) {
            showError("تنبيه", "يرجى إضافة اسم فني واحد على الأقل للبدء بالعمل!");
            return;
        }
        // Pre-fill the modal with any estimate carried from reception; the supervisor adjusts it.
        const est = order.estimated_duration || 0;
        setEstHours(String(Math.floor(est / 60)));
        setEstMinutes(String(est % 60));
        setStartError("");
        setShowStartModal(true);
    };

    // Step 2: confirm the estimate → set estimated_duration and start the timer.
    const confirmStartService = async () => {
        if (!order) return;
        const h = parseInt(estHours || "0") || 0;
        const m = parseInt(estMinutes || "0") || 0;
        const totalMinutes = h * 60 + m;
        if (totalMinutes <= 0) {
            setStartError("يجب تحديد وقت الخدمة المتوقع (ساعة و/أو دقائق).");
            return;
        }

        try {
            const updatedServices = withTechnicians(await freshSelectedServices());

            // Conditional on the current status so a second device with a stale
            // "بدء الخدمة" button can't reset start_time and wipe the elapsed timer.
            const { data: started, error } = await supabase
                .from('inspection_reports')
                .update({
                    status: 'قيد العمل',
                    start_time: new Date().toISOString(),
                    estimated_duration: totalMinutes,
                    bay_number: bayNum || null,
                    notes: maintNotes || null,
                    odometer_reading: odometer ? parseInt(odometer) : 0,
                    odometer_unit: odometerUnit,
                    selected_services: updatedServices
                })
                .eq('id', id)
                .eq('status', 'تم الاستلام')
                .select('id');

            if (error) throw error;
            if (!started || started.length === 0) {
                setShowStartModal(false);
                showError("تنبيه", "تم بدء العمل من جهاز آخر بالفعل.");
                fetchOrder();
                return;
            }
            setShowStartModal(false);
            showSuccess("تم البدء", "تم بدء الخدمة والعداد يعمل الآن!");
            fetchOrder();
        } catch (err) {
            console.error(err);
            showError("خطأ", "فشل بدء العمل");
        }
    };

    const handleReopen = async () => {
        if (!order) return;
        try {
            // Shared helper: also un-accounts an already-closed invoice so it comes
            // back to التدقيق after the new work — see src/lib/reopenOrder.ts.
            const { error } = await reopenWorkOrder(id as string);

            if (error) throw error;
            showSuccess("تمت إعادة الفتح", "تم إعادة المركبة إلى قيد العمل بنجاح!");
            fetchOrder();
        } catch (err) {
            console.error(err);
            showError("خطأ", "فشل إعادة فتح المركبة");
        }
    };

    const handleComplete = async () => {
        // Sale orders ("بيع منتج") have no technician, so they are exempt from this lock.
        // For maintenance orders: at least one technician + a supervisor, and EVERY technician
        // must have a rating (notes stay optional).
        if (order?.order_type !== 'sale') {
            if (validTechs.length === 0 || !supervisorName.trim()) {
                showError("لا يمكن إنهاء المهمة", "يجب إضافة فني واحد على الأقل واسم المشرف قبل إنهاء الصيانة.");
                return;
            }
            if (!validTechs.every(t => t.rating)) {
                showError("لا يمكن إنهاء المهمة", "يجب اختيار تقييم أداء لكل فني قبل إنهاء الصيانة. (الملاحظات اختيارية)");
                return;
            }
        }
        let finalElapsed = order?.elapsed_time || 0;
        if (order?.start_time) {
            const startMs = new Date(order.start_time).getTime();
            finalElapsed += Math.floor((Date.now() - startMs) / 60000);
        }
        const isDelayed = finalElapsed > (order?.estimated_duration || 0);

        // Persist the technician/supervisor names on finish so the daily technician
        // report always has the data, even if "حفظ التفاصيل فقط" was never pressed.
        const freshBase = await freshSelectedServices();
        const updatedServices = order?.order_type !== 'sale'
            ? withTechnicians(freshBase)
            : [...freshBase];

        const { error: finishError } = await supabase.from('inspection_reports')
            .update({
                status: 'تم الانتهاء',
                elapsed_time: finalElapsed,
                is_delayed: isDelayed,
                completed_at: new Date().toISOString(),
                // Persist the current form details on finish too, so the rating/notes/unit
                // aren't lost when the supervisor finishes without pressing "حفظ التفاصيل فقط".
                bay_number: bayNum || null,
                notes: maintNotes || null,
                odometer_reading: odometer ? parseInt(odometer) : (order?.odometer_reading || 0),
                odometer_unit: odometerUnit,
                technician_rating: validTechs[0]?.rating || null,
                technician_rating_notes: validTechs[0]?.notes || null,
                selected_services: updatedServices
            })
            .eq('id', id);

        if (finishError) {
            showError("تعذّر إنهاء الخدمة", finishError.message || "حدث خطأ أثناء حفظ الفاتورة.");
            return;
        }

        // Finishing NEVER auto-prints — printing is a separate, manual action (طباعة الفاتورة)
        // done whenever the user wants it, on whichever device. Auto-print slowed the workflow.
        // After finishing, hand the order over to the accountant (تدقيق والمحاسب).
        showSuccess("تم إنهاء الخدمة", "المركبة جاهزة للتدقيق والمحاسبة.");
        router.push('/work-orders');
    };

    const handleAddDynamicService = async (svcKey: string, customSvc?: any) => {
        if (!order) return;
        // Read the freshest row right before merging so a stale `order` (after a realtime refetch,
        // or a concurrent edit elsewhere) can't overwrite/lose existing services.
        const { data: fresh, error: freshErr } = await supabase.from('inspection_reports')
            .select('selected_services, estimated_duration, total_price')
            .eq('id', id).single();
        if (freshErr) {
            showError("خطأ", "تعذّر قراءة بيانات الفاتورة الحالية — لم تُضف الخدمة. حاول مجدداً.");
            return;
        }
        const baseServices = (fresh?.selected_services as any[]) || order.selected_services || [];
        // Money freeze: an accounted (closed) invoice must never be modified from here.
        // The only path back is «إرجاع للعمل», which un-accounts it properly.
        if ((baseServices[0] as any)?.pricing?.accounted === true) {
            showError("الفاتورة محاسَبة ومغلقة", "لا يمكن إضافة خدمة لفاتورة تمت محاسبتها. اضغط «إرجاع للعمل» أولاً ثم أضف الخدمة.");
            setIsAddingSvc(false);
            return;
        }
        const baseEstimated = (fresh?.estimated_duration ?? order.estimated_duration) || 0;
        const baseTotal = (fresh?.total_price ?? order.total_price) || 0;
        let updatedServices = [...(baseServices || [])];
        let priceToAdd = 0;
        let durationToAdd = 30;
        // Services added while the car is already on the floor are flagged so the
        // accountant (تدقيق والمحاسب) can see what was added after the service started.
        const addedDuringWork = order.status === 'قيد العمل';

        if (svcKey === 'custom') {
            if (!customSvc) return;
            updatedServices.push({ ...customSvc, addedDuringWork });
            priceToAdd = customSvc.price || 0;
            durationToAdd = customSvc.estimatedMinutes || 30;
        } else {
            const payload = { ...updatedServices[0] };
            if (!payload.services) payload.services = {};

            let svcPriceVal = "0";
            let svcDetails: any = {};

            if (svcKey === 'wipers') {
                const wipersDetails: any = {};
                wipersList.forEach((w, idx) => {
                    const suf = idx === 0 ? "1" : `extra_${Date.now()}_${idx}`;
                    wipersDetails[`type_${suf}`] = w.type;
                    wipersDetails[`size_${suf}`] = w.size;
                    wipersDetails[`qty_${suf}`] = w.qty;
                    wipersDetails[`price_${suf}`] = w.price;
                    wipersDetails[`notes_${suf}`] = w.notes;
                });
                const totalWipersPrice = wipersList.reduce((sum, w) => sum + (parseFloat(w.price) || 0) * (parseFloat(w.qty) || 1), 0);
                svcPriceVal = String(totalWipersPrice);
                svcDetails = wipersDetails;
                priceToAdd = totalWipersPrice;
                durationToAdd = 15;
            } else if (svcKey === 'additives') {
                const additivesDetails: any = {};
                additivesList.forEach((a, idx) => {
                    const suf = idx === 0 ? "1" : `extra_${Date.now()}_${idx}`;
                    additivesDetails[`prod_${suf}`] = a.name;
                    additivesDetails[`qty_${suf}`] = a.qty;
                    additivesDetails[`price_${suf}`] = a.price;
                    additivesDetails[`notes_prod_${suf}`] = a.notes;
                });
                const totalAdditivesPrice = additivesList.reduce((sum, a) => sum + (parseFloat(a.price) || 0) * (parseFloat(a.qty) || 1), 0);
                svcPriceVal = String(totalAdditivesPrice);
                svcDetails = additivesDetails;
                priceToAdd = totalAdditivesPrice;
                durationToAdd = 10;
            } else {
                svcDetails = {
                    brand: svcBrand || undefined,
                    viscosity: svcViscosity || undefined,
                    liters: svcLiters || undefined,
                    type: svcType || undefined,
                    filterNum: svcFilterNum || undefined,
                    num: svcNum || undefined,
                    qty: svcQty || undefined,
                    size: svcSize || undefined,
                    notes: svcNotes || undefined
                };
                Object.keys(svcDetails).forEach(k => svcDetails[k] === undefined && delete svcDetails[k]);
                svcPriceVal = svcPrice || "0";

                // engineOil has a liters field instead of a qty field; svcQty defaults to "1"
                // (truthy), so without this the liters count never multiplied the unit price.
                const qVal = parseFloat((svcKey === 'engineOil' ? svcLiters : svcQty) || "1") || 1;
                priceToAdd = (parseFloat(svcPriceVal) || 0) * qVal;
                durationToAdd = 30;
            }

            // Overwriting an already-priced entry would keep its old price baked into
            // total_price while the line itself vanishes. Refuse instead of corrupting the total.
            const prevEntry = (payload.services as any)[svcKey];
            if (prevEntry && (parseFloat(prevEntry.price) || 0) > 0) {
                showError("الخدمة موجودة مسبقاً", "هذه الخدمة مسجلة بسعر في الفاتورة. أضفها كـ«خدمة مخصصة» لتظهر كسطر إضافي مستقل.");
                return;
            }

            payload.services[svcKey] = {
                status: 'يحتاج تغيير',
                price: svcPriceVal,
                details: svcDetails,
                addedDuringWork
            };
            updatedServices[0] = payload;
        }

        const newEstimated = baseEstimated + durationToAdd;
        const newTotalPrice = baseTotal + priceToAdd;

        await supabase.from('inspection_reports').update({
            selected_services: updatedServices,
            estimated_duration: newEstimated,
            total_price: newTotalPrice
        }).eq('id', id);

        setIsAddingSvc(false);
        fetchOrder();
        syncOrderToGoogleSheets(id);
    };

    const handleAddDiagnosis = async () => {
        if (!diagName) return;
        await supabase.from('report_services').insert([{
            report_id: id,
            category: diagName,
            status: diagStatus as any,
            notes: diagNotes,
            service_price: 0
        }]);
        setIsDiagnosing(false);
        setDiagName("");
        setDiagNotes("");
        fetchOrder();
    };

    const openInspection = () => {
        if (!showInspection) {
            const p = Array.isArray(order?.selected_services) ? order?.selected_services[0] : order?.selected_services;
            setInspection(p?.comprehensiveInspection ? { ...emptyInspection(), ...p.comprehensiveInspection } : emptyInspection());
        }
        setShowInspection(v => !v);
    };

    const handleSaveInspection = async () => {
        if (!order) return;
        setSavingInspection(true);
        try {
            const updatedServices = [...(await freshSelectedServices())];
            updatedServices[0] = { ...(updatedServices[0] || {}), comprehensiveInspection: inspection };
            const { error } = await supabase.from('inspection_reports').update({ selected_services: updatedServices }).eq('id', id);
            if (error) throw error;
            showSuccess("تم الحفظ", "تم حفظ الفحص الشامل.");
            fetchOrder();
        } catch (e: any) {
            showError("خطأ", e.message || "تعذّر حفظ الفحص الشامل.");
        } finally {
            setSavingInspection(false);
        }
    };

    // Record the engine color ONCE for this vehicle. Stored in the current report payload;
    // future visits detect it (via the effect above) and show it read-only.
    const handleSaveEngineColor = async () => {
        if (!order || !engineColor || existingEngineColor) return;
        setSavingEngineColor(true);
        try {
            const updatedServices = [...(await freshSelectedServices())];
            updatedServices[0] = { ...(updatedServices[0] || {}), engineColorOnReceipt: engineColor };
            const { error } = await supabase.from('inspection_reports').update({ selected_services: updatedServices }).eq('id', id);
            if (error) throw error;
            setExistingEngineColor(engineColor);
            showSuccess("تم الحفظ", "تم تسجيل لون المحرك عند الاستلام.");
            fetchOrder();
        } catch (e: any) {
            showError("خطأ", e.message || "تعذّر حفظ لون المحرك.");
        } finally {
            setSavingEngineColor(false);
        }
    };

    const handleEditTime = async () => {
        const newTime = prompt('أدخل الوقت المقدر الجديد بالدقائق:', order?.estimated_duration.toString());
        if (newTime && !isNaN(Number(newTime))) {
            await supabase.from('inspection_reports').update({ estimated_duration: Number(newTime) }).eq('id', id);
            fetchOrder();
        }
    };

    if (authLoading) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <Loader2 className="animate-spin text-emerald-500 w-12 h-12" />
            </div>
        );
    }

    if (employeeRole !== 'Owner' && !permissionWorkOrders) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center p-4 text-center font-ibm" dir="rtl">
                <div className="glass-card p-8 rounded-3xl border border-rose-500/20 max-w-md w-full">
                    <h2 className="text-2xl font-bold text-rose-500 mb-2">غير مصرح بالوصول</h2>
                    <p className="text-muted-foreground mb-6">ليس لديك صلاحية للوصول إلى ساحة الورشة والعمل الحي.</p>
                </div>
            </div>
        );
    }

    if (unauthorized) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center p-4 text-center font-ibm" dir="rtl">
                <div className="glass-card p-8 rounded-3xl border border-rose-500/20 max-w-md w-full">
                    <h2 className="text-2xl font-bold text-rose-500 mb-2">غير مصرح بالوصول</h2>
                    <p className="text-muted-foreground mb-6">أمر العمل هذا ينتمي لفرع آخر، لا يمكنك الاطلاع على تفاصيله.</p>
                </div>
            </div>
        );
    }

    if (loading) return <div className="p-12 text-center text-foreground"><Clock className="animate-spin inline mr-2"/> جاري تحميل البيانات الحية...</div>;
    
    if (!order) return (
        <div className="p-12 text-center" dir="rtl">
            <AlertTriangle className="mx-auto text-rose-500 mb-4" size={48}/>
            <h2 className="text-xl font-bold text-foreground mb-2">أمر العمل غير موجود</h2>
            <p className="text-muted-foreground mb-6">هذا المعرف (ID) غير مسجل في قاعدة البيانات، تأكد أنك أنشأت أمر عمل حقيقي من قسم الصيانة.</p>
            <Link href="/work-orders" className="px-6 py-2 bg-blue-600 text-white rounded-xl font-bold">العودة للساحة</Link>
        </div>
    );

    const totalEstimatedSeconds = order.estimated_duration * 60;
    const isOverdue = order.status !== 'تم الانتهاء' && liveSeconds > totalEstimatedSeconds;

    const liveTimeString = fmtHMS(liveSeconds);
    const remainingSeconds = totalEstimatedSeconds - liveSeconds; // negative => overtime
    const progressPct = totalEstimatedSeconds > 0 ? Math.min(100, (liveSeconds / totalEstimatedSeconds) * 100) : 0;

    return (
        <div className="p-4 md:p-8 space-y-6 max-w-5xl mx-auto" dir="rtl">
            {/* Header */}
            <div className="print:hidden flex flex-col md:flex-row justify-between gap-4 items-start md:items-center bg-card p-6 rounded-3xl border border-border shadow-sm">
                <div>
                    <div className="flex items-center gap-2 mb-2">
                        <button onClick={() => router.back()} className="text-muted-foreground hover:text-foreground transition-colors p-1 bg-muted rounded-md border border-border" title="رجوع خطوة"><ArrowRight size={16}/></button>
                        <h1 className="text-3xl font-display font-bold text-foreground flex items-center gap-3">
                            تفاصيل أمر العمل <span className="bg-rose-500/10 text-rose-500 border border-rose-500/20 px-3 py-1 rounded-xl text-lg flex items-center font-mono font-black">#{order.report_number}</span>
                        </h1>
                    </div>
                    <p className="text-muted-foreground font-bold text-sm bg-muted inline-block px-3 py-1 rounded-lg border border-border">{order.vehicles?.clients?.name} - {order.vehicles?.make} {order.vehicles?.model}</p>
                    {order.contract_id && (
                        <p className="mt-2 mr-2 text-amber-400 font-bold text-sm bg-amber-500/10 inline-block px-3 py-1 rounded-lg border border-amber-500/30">
                            عقد {order.contract?.name || ""} · آجل
                        </p>
                    )}
                    {(order.selected_services?.[0] as any)?.driverRoute && (
                        <p className="mt-2 text-muted-foreground font-bold text-sm bg-muted inline-block px-3 py-1 rounded-lg border border-border">
                            خط السائق: {(order.selected_services?.[0] as any)?.driverRoute}
                        </p>
                    )}
                </div>

                <div className="flex flex-wrap gap-3">
                    <button
                        onClick={() => { setPreviewOpen(true); setPreviewMode('short'); }}
                        className="px-4 py-2.5 bg-cyan-600/10 hover:bg-cyan-600/20 border border-cyan-500/20 text-cyan-400 font-bold transition-all flex items-center gap-2 rounded-xl text-xs md:text-sm shadow-sm shadow-cyan-950/20"
                    >
                        <Eye size={16} /> معاينة التقرير 🔍
                    </button>
                    <div className="flex bg-background border border-border rounded-xl shadow-sm overflow-hidden">
                        <button 
                            onClick={() => router.push(`/print/${id}?mode=short`)}
                            className="px-4 py-2.5 hover:bg-muted font-bold transition-colors flex items-center gap-2 border-l border-border text-xs md:text-sm"
                        >
                            <Printer size={16} /> طباعة للفني (مختصر)
                        </button>
                        <button 
                            onClick={() => router.push(`/print/${id}?mode=full`)}
                            className="px-4 py-2.5 hover:bg-muted font-bold transition-colors flex items-center gap-2 text-xs md:text-sm text-rose-500"
                        >
                            <Printer size={16} /> طباعة كامل (للعميل)
                        </button>
                    </div>
                    {false && order?.vehicles?.booklet_serial && (
                        <button
                            onClick={() => window.open(`/print/${id}?mode=sticker`, '_blank')}
                            className="px-4 py-2.5 bg-amber-600/10 hover:bg-amber-600/20 border border-amber-500/20 text-amber-400 font-bold transition-all flex items-center gap-2 rounded-xl text-xs md:text-sm shadow-sm"
                        >
                            🏷️ ملصق الدفتر (Sticker)
                        </button>
                    )}
                    {order.status === 'تم الاستلام' && (
                        <button onClick={handleStart} className="px-6 py-2.5 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-500 transition-colors flex items-center gap-2 shadow-lg shadow-blue-500/20">
                            <Play size={18} /> بدء الخدمة
                        </button>
                    )}
                    {order.status === 'قيد العمل' && (
                        <button onClick={handleComplete} className="px-6 py-2.5 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-500 transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/30">
                            <StopCircle size={18} /> إنهاء الصيانة (Finish)
                        </button>
                    )}
                    {order.status === 'تم الانتهاء' && (
                        <div className="flex items-center gap-3">
                            <span className="px-6 py-2.5 rounded-xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 font-bold flex items-center gap-2">
                                <CheckCircle2 size={18} /> المركبة جاهزة
                            </span>
                            {(employeeRole === 'Admin' || employeeRole === 'Supervisor' || employeeRole === 'Owner') && (
                                <button onClick={handleReopen} className="px-4 py-2.5 rounded-xl bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border border-amber-500/30 font-bold transition-all flex items-center gap-2" title="إرجاع السيارة للعمل">
                                    <RefreshCcw size={16} /> إرجاع للعمل
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div className="print:hidden grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Right Column */}
                <div className="lg:col-span-1 space-y-6 flex flex-col">
                    {/* Live Timer Status */}
                    <div className={`glass-card p-8 rounded-3xl border-2 flex flex-col items-center justify-center text-center relative overflow-hidden transition-colors ${order.status === 'تم الانتهاء' ? 'border-emerald-500/50 bg-emerald-500/5' : isOverdue ? 'border-rose-500/50 bg-rose-500/5' : 'border-blue-500/30 bg-blue-500/5'}`}>
                        <div className="mb-4">
                            <Activity className={order.status === 'تم الانتهاء' ? 'text-emerald-500' : isOverdue ? 'text-rose-500 animate-pulse' : 'text-blue-500'} size={48} />
                        </div>
                        <p className="text-muted-foreground font-bold mb-2 uppercase text-xs tracking-wider">الزمن المستغرق (Live Timing)</p>
                        <p className={`text-6xl font-display font-black font-mono mb-2 ${order.status === 'تم الانتهاء' ? 'text-emerald-500' : isOverdue ? 'text-rose-500' : 'text-blue-500'}`}>
                            {order.status === 'تم الانتهاء' ? fmtHMS((order.elapsed_time || 0) * 60) : liveTimeString}
                        </p>
                        <p className="text-muted-foreground text-sm font-medium flex items-center justify-center gap-2">
                            من أصل <span className="text-foreground font-bold bg-muted px-2 py-0.5 rounded border border-border">{fmtDurationMin(order.estimated_duration)}</span> مقدرة
                            {order.status !== 'تم الانتهاء' && (
                                <button onClick={handleEditTime} className="text-blue-500 hover:text-blue-400 p-1 bg-blue-500/10 rounded">تعديل</button>
                            )}
                        </p>

                        {/* Remaining time + progress (while in progress) */}
                        {order.status === 'قيد العمل' && (
                            <div className="w-full mt-3">
                                <p className={`text-sm font-bold mb-1.5 ${isOverdue ? 'text-rose-500' : 'text-emerald-500'}`}>
                                    {isOverdue ? `تجاوز الوقت بـ ${fmtHMS(-remainingSeconds)}` : `المتبقي ${fmtHMS(remainingSeconds)}`}
                                </p>
                                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full transition-all ${isOverdue ? 'bg-rose-500' : 'bg-blue-500'}`} style={{ width: `${progressPct}%` }} />
                                </div>
                            </div>
                        )}

                        {isOverdue && order.status !== 'تم الانتهاء' && (
                            <div className="absolute top-0 w-full bg-rose-500 text-white text-xs font-bold py-1">⚠️ تأخير عن الموعد!</div>
                        )}
                        {order.status === 'قيد العمل' && !isOverdue && (
                            <div className="absolute top-0 w-full bg-blue-500 text-white text-xs font-bold py-1">العداد يعمل الآن...</div>
                        )}
                    </div>

                    {/* Technician Details & Start Card */}
                    <div className="glass-card p-6 rounded-3xl border border-border shadow-sm space-y-4">
                        <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                            <Wrench className="text-blue-500" size={18} /> تفاصيل الصيانة والفني
                        </h3>
                        <hr className="border-border" />
                        
                        <div className="space-y-3">
                            <div>
                                <label className="text-xs font-bold text-muted-foreground block mb-1">اسم المشرف</label>
                                <input
                                    type="text"
                                    list="wo-supervisor-list"
                                    value={supervisorName}
                                    onChange={(e) => setSupervisorName(e.target.value)}
                                    placeholder="أدخل اسم المشرف..."
                                    className="w-full bg-card border border-border rounded-xl p-2.5 text-sm text-foreground focus:border-blue-500 focus:outline-none transition-colors font-ibm"
                                />
                                <datalist id="wo-supervisor-list">
                                    {suggLists.supervisorNames.map((n, i) => <option key={i} value={typeof n === 'object' && n !== null ? (n as any).name : n} />)}
                                </datalist>
                            </div>
                            
                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="text-xs font-bold text-muted-foreground">الفنيون وتقييماتهم</label>
                                    <button type="button" onClick={addTechnician}
                                        className="text-[11px] font-bold text-blue-500 hover:text-blue-400 flex items-center gap-1">
                                        <Plus size={13} /> إضافة فني
                                    </button>
                                </div>
                                <div className="space-y-2.5">
                                    {technicians.map((t, i) => (
                                        <div key={i} className="bg-muted/40 border border-border rounded-xl p-2.5 space-y-2">
                                            <div className="flex gap-2 items-center">
                                                <input
                                                    type="text"
                                                    list="wo-tech-list"
                                                    value={t.name}
                                                    onChange={(e) => updateTechnician(i, 'name', e.target.value)}
                                                    placeholder={`اسم الفني ${i + 1}...`}
                                                    className="flex-1 bg-card border border-border rounded-xl p-2.5 text-sm text-foreground focus:border-blue-500 focus:outline-none transition-colors font-ibm"
                                                />
                                                {technicians.length > 1 && (
                                                    <button type="button" onClick={() => removeTechnician(i)}
                                                        className="shrink-0 p-2 rounded-lg bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 transition-colors" title="إزالة الفني">
                                                        <X size={15} />
                                                    </button>
                                                )}
                                            </div>
                                            <div className="flex flex-wrap gap-1.5">
                                                {RATING_OPTIONS.map(opt => (
                                                    <button key={opt} type="button" onClick={() => updateTechnician(i, 'rating', t.rating === opt ? "" : opt)}
                                                        className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all ${t.rating === opt ? 'bg-amber-500 border-amber-400 text-white' : 'bg-card border-border text-muted-foreground hover:border-amber-500/50'}`}>
                                                        {opt}
                                                    </button>
                                                ))}
                                            </div>
                                            <input
                                                type="text"
                                                value={t.notes}
                                                onChange={(e) => updateTechnician(i, 'notes', e.target.value)}
                                                placeholder="ملاحظات أداء هذا الفني (اختياري)..."
                                                className="w-full bg-card border border-border rounded-xl p-2 text-xs text-foreground focus:border-amber-500 focus:outline-none transition-colors font-ibm"
                                            />
                                        </div>
                                    ))}
                                </div>
                                <datalist id="wo-tech-list">
                                    {suggLists.technicianNames.map((n, i) => <option key={i} value={typeof n === 'object' && n !== null ? (n as any).name : n} />)}
                                </datalist>
                                <p className="text-[10px] text-muted-foreground mt-1">لكل فني تقييم أداء خاص به. اضغط "حفظ التفاصيل فقط" لحفظ التغييرات.</p>
                            </div>
                            
                            <div>
                                <label className="text-xs font-bold text-muted-foreground block mb-1">رقم الخانة (Bay Number)</label>
                                <input
                                    type="text"
                                    list="wo-bay-list"
                                    value={bayNum}
                                    onChange={(e) => setBayNum(e.target.value)}
                                    placeholder="مثال: الخانة 1..."
                                    className="w-full bg-card border border-border rounded-xl p-2.5 text-sm text-foreground focus:border-blue-500 focus:outline-none transition-colors font-ibm"
                                />
                                <datalist id="wo-bay-list">
                                    {suggLists.bayNumbers.map((n, i) => <option key={i} value={typeof n === 'object' && n !== null ? (n as any).name : n} />)}
                                </datalist>
                            </div>

                            <div>
                                <label className="text-xs font-bold text-muted-foreground block mb-1">عداد السيارة (Odometer)</label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        dir="ltr"
                                        value={odometer}
                                        onChange={(e) => setOdometer(e.target.value.replace(/[^\d]/g, ''))}
                                        placeholder="0"
                                        className="w-full bg-card border border-border rounded-xl p-2.5 text-sm text-foreground text-right focus:border-blue-500 focus:outline-none transition-colors font-ibm"
                                    />
                                    <div className="flex rounded-xl border border-border overflow-hidden shrink-0">
                                        <button type="button" onClick={() => setOdometerUnit('km')} className={`px-3 text-sm font-bold transition-colors ${odometerUnit === 'km' ? 'bg-blue-600 text-white' : 'bg-card text-muted-foreground hover:bg-muted'}`}>كم</button>
                                        <button type="button" onClick={() => setOdometerUnit('mi')} className={`px-3 text-sm font-bold transition-colors ${odometerUnit === 'mi' ? 'bg-blue-600 text-white' : 'bg-card text-muted-foreground hover:bg-muted'}`}>ميل</button>
                                    </div>
                                </div>
                                {/* Future odometer: current reading + a service interval (km auto-converted to miles). */}
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    {FUTURE_INTERVALS.map(km => (
                                        <button type="button" key={km} onClick={() => addFutureKm(km)}
                                            className="px-3 py-1.5 rounded-lg text-xs font-bold border border-border bg-card text-muted-foreground hover:border-blue-500/60 hover:text-blue-400 transition-colors">
                                            +{km.toLocaleString('en-US')}
                                        </button>
                                    ))}
                                </div>
                                <div className="flex gap-2 items-center mt-2">
                                    <label className="text-xs font-bold text-muted-foreground whitespace-nowrap">العداد المستقبلي</label>
                                    <input
                                        type="text" inputMode="numeric" dir="ltr"
                                        value={futureOdometer}
                                        onChange={(e) => setFutureOdometer(e.target.value.replace(/[^\d]/g, ''))}
                                        placeholder="0"
                                        className="flex-1 bg-card border border-border rounded-xl p-2.5 text-sm text-foreground text-right focus:border-blue-500 focus:outline-none transition-colors font-ibm"
                                    />
                                    <span className="text-xs text-muted-foreground shrink-0 w-8 text-center">{odometerUnit === 'mi' ? 'ميل' : 'كم'}</span>
                                </div>
                            </div>

                            <div>
                                <label className="text-xs font-bold text-muted-foreground block mb-1">ملاحظات الصيانة العامة</label>
                                <textarea
                                    value={maintNotes}
                                    onChange={(e) => setMaintNotes(e.target.value)}
                                    placeholder="اكتب أي ملاحظات صيانة هنا..."
                                    rows={3}
                                    className="w-full bg-card border border-border rounded-xl p-2.5 text-sm text-foreground focus:border-blue-500 focus:outline-none transition-colors resize-none font-ibm"
                                />
                            </div>

                        </div>
                        
                        {order.status === 'تم الاستلام' && (
                            <button
                                onClick={handleStart}
                                className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-xl transition-all shadow-lg hover:shadow-blue-500/20 flex items-center justify-center gap-2 font-ibm"
                            >
                                <Play size={16} /> بدء الخدمة
                            </button>
                        )}
                        
                        {order.status !== 'تم الاستلام' && (
                            <button
                                onClick={handleSaveDetailsOnly}
                                disabled={isSavingDetails}
                                className="w-full py-3 bg-muted border border-border hover:bg-muted/80 text-foreground font-bold rounded-xl transition-all flex items-center justify-center gap-2 font-ibm"
                            >
                                {isSavingDetails ? (
                                    <>
                                        <Loader2 className="animate-spin w-4 h-4" /> جاري الحفظ...
                                    </>
                                ) : (
                                    <>حفظ التفاصيل فقط</>
                                )}
                            </button>
                        )}
                    </div>
                </div>

                {/* Left: Services List & Inspected items */}
                <div className="lg:col-span-2 glass-card p-6 rounded-3xl border border-border shadow-sm flex flex-col gap-6">
                    
                    {/* Part 1: Requested Services */}
                    <div>
                        <div className="flex justify-between items-center mb-4 pb-3 border-b border-rose-500/10">
                            <h2 className="text-lg font-bold text-foreground flex items-center gap-2"><Wrench className="text-rose-500" size={20}/> الخدمات المطلوبة (Services)</h2>
                        <button onClick={() => setIsAddingSvc(!isAddingSvc)} className="text-blue-600 hover:text-blue-500 text-sm font-bold flex items-center gap-1 bg-blue-500/10 border border-blue-500/20 px-3 py-1.5 rounded-lg transition-colors font-ibm">
                            <Plus size={16} /> إضافة خدمة إضافية
                        </button>
                        </div>

                        {isAddingSvc && (
                            <div className="mb-4 p-5 bg-muted/60 rounded-2xl border border-border space-y-4 font-ibm text-right" dir="rtl">
                                <h3 className="text-sm font-bold text-foreground mb-2">إضافة خدمة جديدة من الكتالوج، الخدمات القياسية، أو مخصصة:</h3>
                                
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs text-muted-foreground block mb-1">اختر الخدمة:</label>
                                        <select
                                            value={selectedSvcKey}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                setSelectedSvcKey(val);
                                                // Reset standard states
                                                setSvcBrand(""); setSvcViscosity(""); setSvcLiters(""); setSvcType("");
                                                setSvcFilterNum(""); setSvcNum(""); setSvcQty("1"); setSvcSize(""); setSvcPrice(""); setSvcNotes("");
                                                setWipersList([{ id: "1", type: "", size: "", qty: "1", price: "", notes: "" }]);
                                                setAdditivesList([{ id: "1", name: "", qty: "1", price: "", notes: "" }]);
                                                setSelectedCatalogId("");

                                                if (val === "custom") {
                                                    setDynamicSvcName("");
                                                    setDynamicSvcPrice("");
                                                    setDynamicSvcDuration("30");
                                                    setDynamicSvcCategory("خدمة مخصصة");
                                                } else if (val.startsWith("catalog_")) {
                                                    const catId = val.replace("catalog_", "");
                                                    setSelectedCatalogId(catId);
                                                    const catalog = [...(catalogRaw.services || []), ...(catalogRaw.inspections || [])];
                                                    const selected = catalog.find(item => item.id === catId);
                                                    if (selected) {
                                                        setDynamicSvcName(selected.name);
                                                        setDynamicSvcPrice(selected.defaultPrice?.toString() || "");
                                                        setDynamicSvcDuration(selected.estimatedMinutes?.toString() || "30");
                                                        setDynamicSvcCategory(selected.category || "إضافة لاحقة");
                                                    }
                                                    setSelectedSvcKey("custom");
                                                } else {
                                                    // Standard service mapping
                                                    const standardNames: Record<string, string> = {
                                                        engineOil: "زيت المحرك", oilFilter: "فلتر زيت المحرك",
                                                        airFilter: "فلتر الهواء", acFilter: "فلتر التبريد",
                                                        brakeFluid: "زيت المكابح", coolant: "ماء الراديتر",
                                                        battery: "البطارية", engineBelts: "قايش المحرك",
                                                        brakePads: "دسكات السيارة", sparkPlugs: "شمعات الاحتراق",
                                                        gearboxOil: "هايدروليك الكير", gearboxFilter: "فلتر الكير",
                                                        wipers: "الماسحات", additives: "المضافات والمحسنات"
                                                    };
                                                    setDynamicSvcName(standardNames[val] || val);
                                                }
                                            }}
                                            className="w-full bg-card border border-border rounded-xl p-2.5 text-sm text-foreground focus:border-blue-500 focus:outline-none"
                                        >
                                            <option value="">-- اختر خدمة --</option>
                                            <option value="custom">✍️ خدمة مخصصة (كتابة يدوية)</option>
                                            <optgroup label="الخدمات القياسية (أصلية)">
                                                <option value="engineOil">🛢️ زيت المحرك</option>
                                                <option value="oilFilter">⚙️ فلتر زيت المحرك</option>
                                                <option value="airFilter">🌪️ فلتر الهواء</option>
                                                <option value="acFilter">❄️ فلتر التبريد</option>
                                                <option value="brakeFluid">🛑 زيت المكابح</option>
                                                <option value="coolant">💧 ماء الراديتر</option>
                                                <option value="battery">🔋 البطارية</option>
                                                <option value="engineBelts">⛓️ قايش المحرك</option>
                                                <option value="brakePads">💿 دسكات السيارة</option>
                                                <option value="sparkPlugs">🔌 شمعات الاحتراق</option>
                                                <option value="gearboxOil">⚙️ هايدروليك الكير</option>
                                                <option value="gearboxFilter">⚙️ فلتر الكير</option>
                                                <option value="wipers">🧹 الماسحات</option>
                                                <option value="additives">🧪 المضافات والمحسنات</option>
                                            </optgroup>
                                            <optgroup label="خدمات الكتالوج">
                                                {(catalogRaw.services || []).map(s => <option key={s.id} value={`catalog_${s.id}`}>{s.name}</option>)}
                                            </optgroup>
                                            <optgroup label="الفحوصات والتشخيص بالكتالوج">
                                                {(catalogRaw.inspections || []).map(i => <option key={i.id} value={`catalog_${i.id}`}>{i.name}</option>)}
                                            </optgroup>
                                        </select>
                                    </div>

                                    {selectedSvcKey === "custom" && (
                                        <div>
                                            <label className="text-xs text-muted-foreground block mb-1">اسم الخدمة:</label>
                                            <input
                                                type="text"
                                                value={dynamicSvcName}
                                                onChange={e => setDynamicSvcName(e.target.value)}
                                                placeholder="اكتب اسم الخدمة..."
                                                className="w-full bg-card border border-border rounded-xl p-2.5 text-sm text-foreground focus:border-blue-500 focus:outline-none"
                                            />
                                        </div>
                                    )}
                                </div>

                                {selectedSvcKey && selectedSvcKey !== "custom" && (
                                    <div className="p-4 bg-card rounded-2xl border border-border/80 space-y-4 animate-fade-in">
                                        <h4 className="text-xs font-bold text-blue-500">حقول الخدمة القياسية:</h4>
                                        
                                        {selectedSvcKey === "engineOil" && (
                                            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                                                <div>
                                                    <label className="text-xs text-muted-foreground block mb-1">الماركة/النوع:</label>
                                                    <input type="text" value={svcBrand} onChange={e=>setSvcBrand(e.target.value)} className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-xs focus:outline-none focus:border-blue-500" placeholder="مثال: ليكوي مولي"/>
                                                </div>
                                                <div>
                                                    <label className="text-xs text-muted-foreground block mb-1">اللزوجة:</label>
                                                    <input type="text" value={svcViscosity} onChange={e=>setSvcViscosity(e.target.value)} className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-xs focus:outline-none focus:border-blue-500" placeholder="مثال: 5W-30"/>
                                                </div>
                                                <div>
                                                    <label className="text-xs text-muted-foreground block mb-1">عدد اللترات:</label>
                                                    <input type="text" value={svcLiters} onChange={e=>setSvcLiters(e.target.value)} className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-xs focus:outline-none focus:border-blue-500" placeholder="4.5"/>
                                                </div>
                                                <div>
                                                    <label className="text-xs text-muted-foreground block mb-1">السعر المفرد (د.ع):</label>
                                                    <input type="text" value={svcPrice} onChange={e=>setSvcPrice(e.target.value)} className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-xs focus:outline-none focus:border-blue-500" placeholder="0"/>
                                                </div>
                                            </div>
                                        )}

                                        {["oilFilter", "airFilter", "acFilter", "gearboxFilter"].includes(selectedSvcKey) && (
                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                                <div>
                                                    <label className="text-xs text-muted-foreground block mb-1">النوع/الماركة:</label>
                                                    <input type="text" value={svcType} onChange={e=>setSvcType(e.target.value)} className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-xs focus:outline-none focus:border-blue-500"/>
                                                </div>
                                                <div>
                                                    <label className="text-xs text-muted-foreground block mb-1">رقم الفلتر:</label>
                                                    <input type="text" value={svcFilterNum} onChange={e=>setSvcFilterNum(e.target.value)} className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-xs focus:outline-none focus:border-blue-500"/>
                                                </div>
                                                <div>
                                                    <label className="text-xs text-muted-foreground block mb-1">السعر (د.ع):</label>
                                                    <input type="text" value={svcPrice} onChange={e=>setSvcPrice(e.target.value)} className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-xs focus:outline-none focus:border-blue-500" placeholder="0"/>
                                                </div>
                                            </div>
                                        )}

                                        {["brakeFluid", "gearboxOil"].includes(selectedSvcKey) && (
                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                                <div>
                                                    <label className="text-xs text-muted-foreground block mb-1">النوع/الماركة:</label>
                                                    <input type="text" value={svcType} onChange={e=>setSvcType(e.target.value)} className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-xs focus:outline-none focus:border-blue-500"/>
                                                </div>
                                                <div>
                                                    <label className="text-xs text-muted-foreground block mb-1">الكمية/العدد:</label>
                                                    <input type="text" value={svcQty} onChange={e=>setSvcQty(e.target.value)} className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-xs focus:outline-none focus:border-blue-500" placeholder="1"/>
                                                </div>
                                                <div>
                                                    <label className="text-xs text-muted-foreground block mb-1">السعر المفرد (د.ع):</label>
                                                    <input type="text" value={svcPrice} onChange={e=>setSvcPrice(e.target.value)} className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-xs focus:outline-none focus:border-blue-500" placeholder="0"/>
                                                </div>
                                            </div>
                                        )}

                                        {selectedSvcKey === "coolant" && (
                                            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                                                <div>
                                                    <label className="text-xs text-muted-foreground block mb-1">النوع/الماركة:</label>
                                                    <input type="text" value={svcType} onChange={e=>setSvcType(e.target.value)} className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-xs focus:outline-none focus:border-blue-500"/>
                                                </div>
                                                <div>
                                                    <label className="text-xs text-muted-foreground block mb-1">الحجم:</label>
                                                    <select value={svcSize} onChange={e=>setSvcSize(e.target.value)} className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-xs focus:outline-none focus:border-blue-500 bg-card">
                                                        <option value="">اختر الحجم</option>
                                                        <option value="دبة 1 لتر">دبة 1 لتر</option>
                                                        <option value="دبة 4 لتر">دبة 4 لتر</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="text-xs text-muted-foreground block mb-1">العدد:</label>
                                                    <input type="text" value={svcQty} onChange={e=>setSvcQty(e.target.value)} className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-xs focus:outline-none focus:border-blue-500" placeholder="1"/>
                                                </div>
                                                <div>
                                                    <label className="text-xs text-muted-foreground block mb-1">السعر المفرد (د.ع):</label>
                                                    <input type="text" value={svcPrice} onChange={e=>setSvcPrice(e.target.value)} className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-xs focus:outline-none focus:border-blue-500" placeholder="0"/>
                                                </div>
                                            </div>
                                        )}

                                        {selectedSvcKey === "battery" && (
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                <div>
                                                    <label className="text-xs text-muted-foreground block mb-1">النوع والسعة:</label>
                                                    <input type="text" value={svcType} onChange={e=>setSvcType(e.target.value)} className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-xs focus:outline-none focus:border-blue-500" placeholder="مثال: 60 أمبير كوريا"/>
                                                </div>
                                                <div>
                                                    <label className="text-xs text-muted-foreground block mb-1">السعر (د.ع):</label>
                                                    <input type="text" value={svcPrice} onChange={e=>setSvcPrice(e.target.value)} className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-xs focus:outline-none focus:border-blue-500" placeholder="0"/>
                                                </div>
                                            </div>
                                        )}

                                        {["engineBelts", "brakePads", "sparkPlugs"].includes(selectedSvcKey) && (
                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                                <div>
                                                    <label className="text-xs text-muted-foreground block mb-1">النوع/الماركة:</label>
                                                    <input type="text" value={svcType} onChange={e=>setSvcType(e.target.value)} className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-xs focus:outline-none focus:border-blue-500"/>
                                                </div>
                                                <div>
                                                    <label className="text-xs text-muted-foreground block mb-1">الرقم/التسلسل:</label>
                                                    <input type="text" value={svcNum} onChange={e=>setSvcNum(e.target.value)} className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-xs focus:outline-none focus:border-blue-500"/>
                                                </div>
                                                <div>
                                                    <label className="text-xs text-muted-foreground block mb-1">السعر (د.ع):</label>
                                                    <input type="text" value={svcPrice} onChange={e=>setSvcPrice(e.target.value)} className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-xs focus:outline-none focus:border-blue-500" placeholder="0"/>
                                                </div>
                                            </div>
                                        )}

                                        {selectedSvcKey === "wipers" && (
                                            <div className="space-y-2">
                                                <label className="text-xs text-muted-foreground block">قائمة المساحات المضافة:</label>
                                                {wipersList.map((w, idx) => (
                                                    <div key={w.id} className="flex flex-wrap items-center gap-2 border-b border-border/40 pb-2">
                                                        <select
                                                            className="bg-muted/50 border border-border rounded-xl p-2 text-xs focus:outline-none focus:border-blue-500 bg-card w-28"
                                                            value={w.type}
                                                            onChange={e => {
                                                                const updated = [...wipersList];
                                                                updated[idx].type = e.target.value;
                                                                setWipersList(updated);
                                                            }}
                                                        >
                                                            <option value="">النوع...</option>
                                                            <option value="VH">VH</option>
                                                            <option value="VP">VP</option>
                                                            <option value="VS">VS</option>
                                                        </select>
                                                        <select
                                                            className="bg-muted/50 border border-border rounded-xl p-2 text-xs focus:outline-none focus:border-blue-500 bg-card w-28"
                                                            value={w.size}
                                                            onChange={e => {
                                                                const updated = [...wipersList];
                                                                updated[idx].size = e.target.value;
                                                                setWipersList(updated);
                                                            }}
                                                        >
                                                            <option value="">الحجم...</option>
                                                            {["14", "16", "18", "20", "22", "24", "26", "28"].map(sz => (
                                                                <option key={sz} value={`${sz} Inch`}>{sz} Inch</option>
                                                            ))}
                                                        </select>
                                                        <input
                                                            type="number"
                                                            placeholder="العدد"
                                                            className="bg-muted/50 border border-border rounded-xl p-2 text-xs focus:outline-none focus:border-blue-500 w-16 text-center"
                                                            value={w.qty}
                                                            onChange={e => {
                                                                const updated = [...wipersList];
                                                                updated[idx].qty = e.target.value;
                                                                setWipersList(updated);
                                                            }}
                                                        />
                                                        <input
                                                            type="number"
                                                            placeholder="السعر المفرد"
                                                            className="bg-muted/50 border border-border rounded-xl p-2 text-xs focus:outline-none focus:border-blue-500 w-24 text-left"
                                                            value={w.price}
                                                            onChange={e => {
                                                                const updated = [...wipersList];
                                                                updated[idx].price = e.target.value;
                                                                setWipersList(updated);
                                                            }}
                                                        />
                                                        <input
                                                            type="text"
                                                            placeholder="ملاحظات"
                                                            className="bg-muted/50 border border-border rounded-xl p-2 text-xs focus:outline-none focus:border-blue-500 flex-1 min-w-[100px]"
                                                            value={w.notes}
                                                            onChange={e => {
                                                                const updated = [...wipersList];
                                                                updated[idx].notes = e.target.value;
                                                                setWipersList(updated);
                                                            }}
                                                        />
                                                        {idx > 0 && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setWipersList(prev => prev.filter(item => item.id !== w.id))}
                                                                className="text-rose-500 hover:bg-rose-500/10 p-1.5 rounded-lg"
                                                            >✕</button>
                                                        )}
                                                    </div>
                                                ))}
                                                <button
                                                    type="button"
                                                    onClick={() => setWipersList(prev => [...prev, { id: Date.now().toString(), type: "", size: "", qty: "1", price: "", notes: "" }])}
                                                    className="text-xs text-blue-500 font-bold border border-blue-500/30 rounded-lg py-1.5 hover:bg-blue-500/10 transition-colors px-3 w-max block"
                                                >
                                                    + إضافة ماسحة أخرى
                                                </button>
                                            </div>
                                        )}

                                        {selectedSvcKey === "additives" && (
                                            <div className="space-y-2">
                                                <label className="text-xs text-muted-foreground block">قائمة المضافات المضافة:</label>
                                                {additivesList.map((a, idx) => (
                                                    <div key={a.id} className="flex flex-wrap items-center gap-2 border-b border-border/40 pb-2">
                                                        <input
                                                            type="text"
                                                            placeholder="اسم المضاف/المحسن"
                                                            className="bg-muted/50 border border-border rounded-xl p-2 text-xs focus:outline-none focus:border-blue-500 flex-1 min-w-[150px]"
                                                            value={a.name}
                                                            onChange={e => {
                                                                const updated = [...additivesList];
                                                                updated[idx].name = e.target.value;
                                                                setAdditivesList(updated);
                                                            }}
                                                        />
                                                        <input
                                                            type="number"
                                                            placeholder="العدد"
                                                            className="bg-muted/50 border border-border rounded-xl p-2 text-xs focus:outline-none focus:border-blue-500 w-16 text-center"
                                                            value={a.qty}
                                                            onChange={e => {
                                                                const updated = [...additivesList];
                                                                updated[idx].qty = e.target.value;
                                                                setAdditivesList(updated);
                                                            }}
                                                        />
                                                        <input
                                                            type="number"
                                                            placeholder="السعر المفرد"
                                                            className="bg-muted/50 border border-border rounded-xl p-2 text-xs focus:outline-none focus:border-blue-500 w-24 text-left"
                                                            value={a.price}
                                                            onChange={e => {
                                                                const updated = [...additivesList];
                                                                updated[idx].price = e.target.value;
                                                                setAdditivesList(updated);
                                                            }}
                                                        />
                                                        <input
                                                            type="text"
                                                            placeholder="ملاحظات"
                                                            className="bg-muted/50 border border-border rounded-xl p-2 text-xs focus:outline-none focus:border-blue-500 w-32"
                                                            value={a.notes}
                                                            onChange={e => {
                                                                const updated = [...additivesList];
                                                                updated[idx].notes = e.target.value;
                                                                setAdditivesList(updated);
                                                            }}
                                                        />
                                                        {idx > 0 && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setAdditivesList(prev => prev.filter(item => item.id !== a.id))}
                                                                className="text-rose-500 hover:bg-rose-500/10 p-1.5 rounded-lg"
                                                            >✕</button>
                                                        )}
                                                    </div>
                                                ))}
                                                <button
                                                    type="button"
                                                    onClick={() => setAdditivesList(prev => [...prev, { id: Date.now().toString(), name: "", qty: "1", price: "", notes: "" }])}
                                                    className="text-xs text-blue-500 font-bold border border-blue-500/30 rounded-lg py-1.5 hover:bg-blue-500/10 transition-colors px-3 w-max block"
                                                >
                                                    + إضافة منتج آخر
                                                </button>
                                            </div>
                                        )}

                                        {selectedSvcKey !== "wipers" && selectedSvcKey !== "additives" && (
                                            <div>
                                                <label className="text-xs text-muted-foreground block mb-1">ملاحظة عامة عن الخدمة:</label>
                                                <input type="text" value={svcNotes} onChange={e=>setSvcNotes(e.target.value)} className="w-full bg-muted/50 border border-border rounded-xl p-2.5 text-xs focus:outline-none focus:border-blue-500" placeholder="مثال: يحتاج تبديل عاجل، أو تهريب خفيف..."/>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {selectedSvcKey && (
                                    <>
                                    {selectedSvcKey !== "custom" && (() => {
                                        let total = 0;
                                        if (selectedSvcKey === "wipers") total = wipersList.reduce((s, w) => s + (parseFloat(w.price) || 0) * (parseFloat(w.qty) || 1), 0);
                                        else if (selectedSvcKey === "additives") total = additivesList.reduce((s, a) => s + (parseFloat(a.price) || 0) * (parseFloat(a.qty) || 1), 0);
                                        else total = (parseFloat(svcPrice) || 0) * (parseFloat((selectedSvcKey === 'engineOil' ? svcLiters : svcQty) || "1") || 1);
                                        return (
                                            <div className="flex items-center justify-between px-1 mt-2 py-2 border-t border-border/60 text-sm">
                                                <span className="font-bold text-muted-foreground">الإجمالي (العدد × السعر المفرد):</span>
                                                <span className="font-black text-emerald-500">{total.toLocaleString('en-US')} د.ع</span>
                                            </div>
                                        );
                                    })()}
                                    <div className="flex gap-2 mt-2">
                                        <button
                                            onClick={async () => {
                                                if (selectedSvcKey === "custom") {
                                                    if (!dynamicSvcName) {
                                                        showError("تنبيه", "يرجى كتابة اسم الخدمة!");
                                                        return;
                                                    }
                                                    const newSvc = {
                                                        name: dynamicSvcName,
                                                        category: dynamicSvcCategory,
                                                        estimatedMinutes: parseInt(dynamicSvcDuration) || 30,
                                                        price: parseFloat(dynamicSvcPrice) || 0,
                                                        details: dynamicSvcDetails
                                                    };
                                                    await handleAddDynamicService("custom", newSvc);
                                                } else {
                                                    await handleAddDynamicService(selectedSvcKey);
                                                }
                                                setSelectedSvcKey("");
                                                setSelectedCatalogId("");
                                                setDynamicSvcName("");
                                                setDynamicSvcPrice("");
                                                setDynamicSvcDuration("30");
                                                setDynamicSvcDetails("");
                                            }}
                                            className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold transition-colors font-ibm"
                                        >
                                            إضافة الخدمة
                                        </button>
                                        <button
                                            onClick={() => {
                                                setIsAddingSvc(false);
                                                setSelectedSvcKey("");
                                                setSelectedCatalogId("");
                                                setDynamicSvcName("");
                                                setDynamicSvcPrice("");
                                                setDynamicSvcDuration("30");
                                                setDynamicSvcDetails("");
                                            }}
                                            className="flex-1 py-2.5 bg-muted hover:bg-muted/80 text-foreground rounded-xl text-sm font-bold transition-colors font-ibm"
                                        >
                                            إلغاء
                                        </button>
                                    </div>
                                    </>
                                )}
                            </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {(() => {
                                const svcs: {name: string, category: string, estimatedMinutes?: number, price?: string | number, qty?: string | number, notes?: string, details?: string}[] = [];
                                
                                order.selected_services?.forEach(svc => {
                                    if (svc.is_paper_v2_format) {
                                        const services = svc.services || {};
                                        Object.entries(services).forEach(([key, value]: [string, any]) => {
                                            const def = PAPER_V2_SERVICE_DEFS[key];
                                            if (!def || !value) return;
                                            if (value.status === 'جيد') return;

                                            const hasStatus = !!value.status;
                                            const hasPrice = value.price !== undefined && value.price !== null && String(value.price).trim() !== "";
                                            const hasDetails = value.details && Object.values(value.details).some((d: any) => String(d ?? "").trim() !== "");

                                            if (!hasStatus && !hasPrice && !hasDetails) return;

                                            const statusLabel = hasStatus ? ` - ${value.status}` : "";
                                            
                                            let detailsStr = "";
                                            let notesStr = "";
                                            if (value.details) {
                                                const detailsArr: string[] = [];
                                                Object.entries(value.details).forEach(([k, v]: [string, any]) => {
                                                    const strVal = String(v ?? "").trim();
                                                    if (strVal) {
                                                        if (k === 'notes') {
                                                            notesStr = strVal;
                                                        } else {
                                                            detailsArr.push(strVal);
                                                        }
                                                    }
                                                });
                                                detailsStr = detailsArr.join(" | ");
                                            }

                                            svcs.push({
                                                name: `${def.name}${statusLabel}`,
                                                category: "نموذج الاستقبال",
                                                estimatedMinutes: def.estimatedMinutes,
                                                details: detailsStr,
                                                notes: notesStr,
                                                price: value.price
                                            });
                                        });

                                        const freeServices = svc.freeServices || {};
                                        Object.entries(PAPER_V2_FREE_SERVICES).forEach(([key, label]) => {
                                            if (freeServices[key]) {
                                                svcs.push({
                                                    name: label,
                                                    category: "فحص مجاني",
                                                    estimatedMinutes: 10,
                                                });
                                            }
                                        });

                                        const customServices = svc.customServices || [];
                                        customServices.forEach((cs: any) => {
                                            svcs.push({
                                                name: cs.label,
                                                category: "حدث صيانة إضافي",
                                                estimatedMinutes: 30,
                                                price: cs.price,
                                                qty: cs.qty,
                                                notes: cs.notes
                                            });
                                        });
                                    } else if (svc.is_paper_format) {
                                        if (svc.services?.engineOil) svcs.push({ name: 'تغيير زيت المحرك', category: 'صيانة ورقية', estimatedMinutes: 30 });
                                        if (svc.services?.transOil) svcs.push({ name: 'تغيير زيت ناقل الحركة', category: 'صيانة ورقية', estimatedMinutes: 45 });
                                        if (svc.services?.filters) svcs.push({ name: 'تغيير الفلاتر', category: 'صيانة ورقية', estimatedMinutes: 20 });
                                        if (svc.services?.cooling) svcs.push({ name: 'تنظيف دورة التبريد', category: 'صيانة ورقية', estimatedMinutes: 60 });
                                        if (svc.services?.brakes) svcs.push({ name: 'فحص نظام الفرامل', category: 'صيانة ورقية', estimatedMinutes: 30 });
                                        if (svc.services?.comprehensive) svcs.push({ name: 'فحص شامل (خدمة الإعزاز)', category: 'فحص شامل', estimatedMinutes: 60 });
                                        
                                        if (svc.texts?.deviceCheck) svcs.push({ name: `فحص بالجهاز: ${svc.texts.deviceCheck}`, category: 'اضافي', estimatedMinutes: 30 });
                                        if (svc.texts?.maintenanceText) svcs.push({ name: `ادامة: ${svc.texts.maintenanceText}`, category: 'اضافي', estimatedMinutes: 45 });
                                    } else {
                                        // Legacy / Dynamically added arrays
                                        svcs.push(svc);
                                    }
                                });

                                if (svcs.length === 0) {
                                    return <p className="text-muted-foreground text-sm col-span-2">لم يتم تحديد خدمات رئيسية.</p>;
                                }

                                return svcs.map((svc, idx) => (
                                    <div key={idx} className="flex justify-between items-center p-3 bg-card border border-border rounded-xl shadow-sm hover:border-rose-500/30 transition-colors">
                                        <div>
                                            <p className="font-bold text-foreground text-sm">{svc.name}</p>
                                            <p className="text-[10px] text-muted-foreground">{svc.category} {(svc as any).details ? `• ${(svc as any).details}` : ''}</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {(svc as any).price !== undefined && (svc as any).price > 0 && (
                                                <span className="font-mono text-xs font-bold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                                    {Number((svc as any).price).toLocaleString()} د.ع
                                                </span>
                                            )}
                                            {(svc as any).qty && (
                                                <span className="font-mono text-xs font-bold text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                                                    الكمية: {(svc as any).qty}
                                                </span>
                                            )}
                                            {(svc as any).notes && (
                                                <span className="font-mono text-xs font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 max-w-[150px] truncate" title={(svc as any).notes}>
                                                    ملاحظات: {(svc as any).notes}
                                                </span>
                                            )}
                                            <div className="text-left font-mono font-bold text-rose-500 bg-rose-500/10 border border-rose-500/20 px-2 py-1 rounded-md text-xs">
                                                {svc.estimatedMinutes || 30}m
                                            </div>
                                        </div>
                                    </div>
                                ));
                            })()}
                        </div>
                    </div>

                    {/* Part 2: Detailed Inspected Items (Health Check) */}
                    <div>
                        <div className="flex justify-between items-center mb-4 pb-3 border-b border-emerald-500/10">
                            <h2 className="text-lg font-bold text-foreground flex items-center gap-2"><CheckCircle2 className="text-emerald-500" size={20}/> تشخيص الأعطال (Diagnosis)</h2>
                            <button onClick={() => setIsDiagnosing(true)} className="text-emerald-600 hover:text-emerald-500 text-sm font-bold flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-lg transition-colors font-ibm">
                                <Plus size={16} /> تسجيل عطل فني
                            </button>
                        </div>

                        {/* Diagnostics Form */}
                        {isDiagnosing && (
                            <div className="mb-4 p-4 bg-muted/50 rounded-2xl border border-border space-y-3">
                                <div>
                                    <label className="text-xs font-bold text-muted-foreground">اسم الجزء التالف (مثال: المحرك، فريون، الكير)</label>
                                    <input value={diagName} onChange={e=>setDiagName(e.target.value)} type="text" className="w-full mt-1 bg-card border border-border rounded-lg p-2 text-sm" placeholder="اكتب الجزء المربوط بالعطل..." />
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs font-bold text-muted-foreground">التشخيص</label>
                                        <select value={diagStatus} onChange={e=>setDiagStatus(e.target.value)} className="w-full mt-1 bg-card border border-border rounded-lg p-2 text-sm">
                                            <option value="يحتاج صيانة">يحتاج صيانة</option>
                                            <option value="تالف">تالف تماماً</option>
                                            <option value="سليم">سليم وتم فحصه</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-muted-foreground">ملاحظات الفني (اسباب/تفاصيل)</label>
                                        <input value={diagNotes} onChange={e=>setDiagNotes(e.target.value)} type="text" className="w-full mt-1 bg-card border border-border rounded-lg p-2 text-sm" placeholder="اكتب ملاحظة..." />
                                    </div>
                                </div>
                                <div className="flex gap-2 pt-2">
                                    <button onClick={handleAddDiagnosis} className="flex-1 bg-emerald-600 text-white py-2 rounded-lg text-sm font-bold">تسجيل العطل</button>
                                    <button onClick={() => setIsDiagnosing(false)} className="px-4 bg-muted border border-border text-foreground py-2 rounded-lg text-sm font-bold">إلغاء</button>
                                </div>
                            </div>
                        )}

                        <div className="space-y-3 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
                            {inspectedServices.map((svc) => (
                                <div key={svc.id} className="flex flex-col sm:flex-row justify-between sm:items-center p-4 bg-muted/30 border border-border rounded-xl gap-3">
                                    <div>
                                        <p className="font-bold text-foreground text-sm">{svc.category}</p>
                                        {svc.notes && <p className="text-xs text-muted-foreground mt-1">الملاحظة: {svc.notes}</p>}
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {svc.service_price && svc.service_price > 0 && (
                                            <span className="font-mono text-sm font-bold text-blue-500 bg-blue-500/10 px-2 py-1 rounded border border-blue-500/20">{svc.service_price} د.ع</span>
                                        )}
                                        <span className={`px-3 py-1 text-xs font-bold rounded-lg border ${
                                            svc.status === 'سليم' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' :
                                            svc.status === 'يحتاج صيانة' ? 'bg-amber-500/10 text-amber-600 border-amber-500/20' :
                                            'bg-rose-500/10 text-rose-600 border-rose-500/20'
                                        }`}>
                                            {svc.status}
                                        </span>
                                    </div>
                                </div>
                            ))}
                            {inspectedServices.length === 0 && (
                                <p className="text-muted-foreground text-sm">التشخيص لم يبدأ أو لم يتم تسجيل ملاحظات العطل.</p>
                            )}
                        </div>
                    </div>

                    {/* حالة المحرك عند الاستلام — لون المحرك قبل تبديل الزيت (مرة واحدة لكل مركبة) */}
                    <div>
                        <div className="flex flex-wrap justify-between items-center gap-2 mb-4 pb-3 border-b border-amber-500/10">
                            <h2 className="text-lg font-bold text-foreground flex items-center gap-2"><Droplet className="text-amber-500" size={20}/> حالة المحرك عند الاستلام</h2>
                            {existingEngineColor && (
                                <span className="text-[11px] font-bold text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-lg">مسجّل مسبقاً — مرة واحدة لكل مركبة</span>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground mb-3">لون المحرك من الداخل قبل تبديل الزيت:</p>
                        <div className="flex flex-wrap gap-3">
                            {ENGINE_COLORS.map(c => {
                                const selected = (existingEngineColor || engineColor) === c;
                                const locked = !!existingEngineColor;
                                return (
                                    <button key={c} type="button" disabled={locked}
                                        onClick={() => !locked && setEngineColor(c)}
                                        className={`px-6 py-2.5 rounded-xl border font-bold text-sm transition-colors ${selected ? 'bg-amber-500 text-white border-amber-500' : 'bg-muted text-muted-foreground border-border hover:bg-muted/80'} ${locked ? 'cursor-default' : ''}`}>
                                        {c}
                                    </button>
                                );
                            })}
                        </div>
                        {!existingEngineColor && (
                            <button onClick={handleSaveEngineColor} disabled={savingEngineColor || !engineColor} className="mt-4 w-full py-3 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 disabled:opacity-60">
                                {savingEngineColor ? <Loader2 className="animate-spin" size={18}/> : <CheckCircle2 size={18}/>} حفظ لون المحرك
                            </button>
                        )}
                    </div>

                    {/* الفحص الشامل — full inspection checklist, opened on the floor */}
                    <div>
                        <div className="flex justify-between items-center mb-4 pb-3 border-b border-blue-500/10">
                            <h2 className="text-lg font-bold text-foreground flex items-center gap-2"><Eye className="text-blue-500" size={20}/> الفحص الشامل (Inspection)</h2>
                            <button onClick={openInspection} className="text-blue-500 hover:text-blue-400 text-sm font-bold flex items-center gap-1 bg-blue-500/10 border border-blue-500/20 px-3 py-1.5 rounded-lg transition-colors font-ibm">
                                <Eye size={16} /> {showInspection ? "إغلاق" : "فتح فحص شامل"}
                            </button>
                        </div>
                        {showInspection && (
                            <div className="space-y-3">
                                <InspectionChecklist value={inspection} onChange={setInspection} />
                                <button onClick={handleSaveInspection} disabled={savingInspection} className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 disabled:opacity-60">
                                    {savingInspection ? <Loader2 className="animate-spin" size={18}/> : <CheckCircle2 size={18}/>} حفظ الفحص الشامل
                                </button>
                            </div>
                        )}
                    </div>

                </div>
            </div>

            {/* Print Preview Modal */}
            {previewOpen && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in font-ibm">
                    <div className="bg-card border border-cyan-900/30 rounded-3xl p-6 max-w-4xl w-full h-[90vh] shadow-[0_0_60px_rgba(6,182,212,0.15)] animate-scale-in flex flex-col space-y-4 text-right" dir="rtl">
                        
                        {/* Header Area */}
                        <div className="flex items-center justify-between border-b border-border/40 pb-4">
                            <div className="flex items-center gap-3">
                                <h3 className="text-xl font-bold text-foreground">🔍 معاينة التقرير والفاتورة</h3>
                                {order && (
                                    <span className="text-xs bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 rounded-lg px-2.5 py-1 font-mono">
                                        #{order.report_number}
                                    </span>
                                )}
                            </div>
                            
                            {/* Controls */}
                            <div className="flex items-center gap-3">
                                {/* Toggle full/short Mode */}
                                <div className="flex bg-muted rounded-xl p-1 border border-border/40">
                                    <button 
                                        onClick={() => setPreviewMode('full')}
                                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${previewMode === 'full' ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-600/20' : 'text-muted-foreground hover:text-foreground'}`}
                                    >
                                        تقرير شامل (للعميل)
                                    </button>
                                    <button 
                                        onClick={() => setPreviewMode('short')}
                                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${previewMode === 'short' ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-600/20' : 'text-muted-foreground hover:text-foreground'}`}
                                    >
                                        تقرير مختصر (للفني)
                                    </button>
                                </div>

                                {/* Direct Print Button */}
                                <button
                                    onClick={() => window.open(`/print/${id}?mode=${previewMode}`, '_blank')}
                                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl transition-all shadow-lg hover:shadow-emerald-600/20 text-xs"
                                >
                                    <Printer size={16} /> إرسال للطباعة 🖨️
                                </button>
                                {false && order?.vehicles?.booklet_serial && (
                                    <button
                                        onClick={() => window.open(`/print/${id}?mode=sticker`, '_blank')}
                                        className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white font-bold rounded-xl transition-all shadow-lg hover:shadow-amber-600/20 text-xs"
                                    >
                                        🏷️ ملصق الدفتر
                                    </button>
                                )}

                                {/* Close Button */}
                                <button
                                    onClick={() => setPreviewOpen(false)}
                                    className="p-2 bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground rounded-xl transition-all border border-border/40"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                        </div>

                        {/* Preview Area */}
                        <div className="flex-1 overflow-auto bg-neutral-950/60 border border-border/20 rounded-2xl p-4 md:p-6 flex justify-center items-start min-h-0 relative">
                            {order ? (
                                <div className="bg-white p-6 rounded-2xl shadow-2xl overflow-x-auto min-w-[800px] transition-transform origin-top print-preview-doc">
                                    <PrintableInspectionReport report={order} mode={previewMode} />
                                </div>
                            ) : (
                                <div className="text-center text-muted-foreground">حدث خطأ أثناء تحميل التقرير.</div>
                            )}
                        </div>
                        
                    </div>
                </div>
            )}

            {/* Mandatory "estimated service time" modal — the timer starts only after this is confirmed */}
            {showStartModal && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm font-ibm" dir="rtl">
                    <div className="bg-card border border-border rounded-3xl shadow-2xl w-full max-w-md p-6 animate-scale-in">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-11 h-11 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center"><Clock size={22} /></div>
                            <div>
                                <h3 className="text-lg font-bold text-foreground">وقت الخدمة المتوقع</h3>
                                <p className="text-xs text-muted-foreground">حدّد المدة المتوقعة قبل بدء الخدمة (إجباري)</p>
                            </div>
                        </div>
                        <div className="flex items-center justify-center gap-3 my-6">
                            <div className="text-center">
                                <input type="text" inputMode="numeric" value={estHours} onChange={(e) => { setEstHours(e.target.value.replace(/[^\d]/g, '')); setStartError(''); }} className="w-24 bg-background border border-border rounded-2xl p-3 text-center text-3xl font-black text-foreground focus:border-blue-500 focus:outline-none" />
                                <p className="text-xs text-muted-foreground mt-1">ساعات</p>
                            </div>
                            <span className="text-3xl font-black text-muted-foreground pb-6">:</span>
                            <div className="text-center">
                                <input type="text" inputMode="numeric" value={estMinutes} onChange={(e) => { setEstMinutes(e.target.value.replace(/[^\d]/g, '')); setStartError(''); }} className="w-24 bg-background border border-border rounded-2xl p-3 text-center text-3xl font-black text-foreground focus:border-blue-500 focus:outline-none" />
                                <p className="text-xs text-muted-foreground mt-1">دقائق</p>
                            </div>
                        </div>
                        {startError && <p className="text-rose-500 text-sm text-center mb-3 font-bold">{startError}</p>}
                        <div className="flex gap-3">
                            <button onClick={() => setShowStartModal(false)} className="flex-1 py-3 bg-muted hover:bg-muted/70 text-foreground font-bold rounded-xl transition-colors">إلغاء</button>
                            <button onClick={confirmStartService} className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2"><Play size={16} /> بدء الخدمة</button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
