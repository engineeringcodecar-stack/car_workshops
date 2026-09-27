"use client";

import { useState, useEffect, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { useAuth } from "@/lib/AuthProvider";
import { supabase } from "@/lib/supabase";
import { normalizeBookletCode } from "@/lib/booklet";
import {
    UserPlus, Car, Save, Phone, Hash, AlertCircle, Loader2,
    CheckCircle2, ArrowLeft, ArrowRight, FileText, Printer, Play, X
} from "lucide-react";
import { showSuccess } from "@/lib/alerts";
import { withCommas, digitsOnly } from "@/lib/format";
import { PrintableInspectionReport } from "@/components/PrintableInspectionReport";
import { syncOrderToGoogleSheets } from "@/lib/googleSheetsSync";
import { useContracts, lastContractForVehicle } from "@/lib/contracts";
import ContractSelect from "@/components/ContractSelect";

type Step = 1 | 2 | 3;

// Each of the 14 services has a status and type-specific detail fields
type ServiceEntry = {
    status: "جيد" | "يحتاج تغيير" | "";
    details: Record<string, string>; // flexible detail fields (type, number, qty, etc.)
    price: string;
};

const makeService = (): ServiceEntry => ({ status: "", details: {}, price: "" });

const FREE_SERVICES = [
    { key: "windshieldWater", label: "ماء المساحات" },
    { key: "tirePressure",    label: "ضغط الإطارات" },
    { key: "engineClean",    label: "تنظيف محرك بالبخار" },
];

// The 14 main services — updated to match official paper form
const MAIN_SERVICES: { key: string; label: string; detailFields: { key: string; label: string; listId?: string }[] }[] = [
    {
        key: "engineOil",
        label: "زيت المحرك",
        detailFields: [
            { key: "brand",     label: "نوع الزيت", listId: "oilBrands" },
            { key: "viscosity", label: "درجة اللزوجة", listId: "viscosities" },
            { key: "liters",    label: "عدد اللترات" },
             { key: "notes", label: "ملاحظات" }],
    },
    {
        key: "oilFilter",
        label: "فلتر زيت المحرك",
        detailFields: [
            { key: "type",      label: "نوع الفلتر", listId: "oilFilterBrands" },
            { key: "filterNum", label: "رقم الفلتر", listId: "oilFilterCodes" }, { key: "notes", label: "ملاحظات" }],
    },
    {
        key: "airFilter",
        label: "فلتر الهواء",
        detailFields: [
            { key: "type",      label: "نوع الفلتر", listId: "airFilterBrands" },
            { key: "filterNum", label: "رقم الفلتر", listId: "airFilterCodes" }, { key: "notes", label: "ملاحظات" }],
    },
    {
        key: "acFilter",
        label: "فلتر التبريد",
        detailFields: [
            { key: "type",      label: "نوع الفلتر", listId: "acFilterBrands" },
            { key: "filterNum", label: "رقم الفلتر", listId: "acFilterCodes" }, { key: "notes", label: "ملاحظات" }],
    },
    {
        key: "brakeFluid",
        label: "زيت المكابح",
        detailFields: [
            { key: "type", label: "نوع الزيت", listId: "brakeFluids" },
            { key: "qty",  label: "عدد القطع" }, { key: "notes", label: "ملاحظات" }],
    },
    {
        key: "coolant",
        label: "ماء الراديتر",
        detailFields: [
            { key: "type", label: "نوع الماء", listId: "coolants" },
            { key: "size", label: "الحجم (4L / 1L)" },
            { key: "qty",  label: "العدد" },
             { key: "notes", label: "ملاحظات" }],
    },
    {
        key: "battery",
        label: "البطارية",
        detailFields: [{ key: "type", label: "نوع البطارية والسعة", listId: "batteries" }, { key: "notes", label: "ملاحظات" }],
    },
    {
        key: "engineBelts",
        label: "قايش المحرك",
        detailFields: [
            { key: "type", label: "نوع القايش", listId: "engineBeltsBrands" },
            { key: "num",  label: "رقم القايش" }, { key: "notes", label: "ملاحظات" }],
    },
    {
        key: "brakePads",
        label: "دسكات السيارة",
        detailFields: [
            { key: "type", label: "نوع الدسكات", listId: "brakePadsBrands" },
            { key: "num",  label: "رقم الدسكات" }, { key: "notes", label: "ملاحظات" }],
    },
    {
        key: "sparkPlugs",
        label: "شمعات الاحتراق",
        detailFields: [
            { key: "type", label: "نوع الشمعات", listId: "sparkPlugsBrands" },
            { key: "num",  label: "رقم البلكات" }, { key: "notes", label: "ملاحظات" }],
    },
    {
        key: "gearboxHydraulic",
        label: "هايدروليك الكير",
        detailFields: [
            { key: "type", label: "نوع الهيدروليك", listId: "gearboxOils" },
            { key: "qty",  label: "عدد اللترات" }, { key: "notes", label: "ملاحظات" }],
    },
    {
        key: "gearboxFilter",
        label: "فلتر الكير",
        detailFields: [
            { key: "type", label: "نوع الفلتر", listId: "gearboxFilterBrands" },
            { key: "filterNum", label: "رقم الفلتر", listId: "gearboxFilterCodes" },
             { key: "notes", label: "ملاحظات" }],
    },
    {
        key: "wipers",
        label: "المساحات",
        detailFields: [], // multi-product like additives (add more than one wiper)
    },
    {
        key: "additives",
        label: "المضافات والمحسنات",
        detailFields: [], // Rendered custom below
    },
];

// Extra detail fields so EVERY service gets العدد × سعر الوحدة (price auto-computes as qty × unitPrice
// in setServiceDetail). Skips العدد when the service already has a qty/liters field.
function priceFields(svc: { detailFields: { key: string }[] }): { key: string; label: string; listId?: string }[] {
    const keys = new Set(svc.detailFields.map(f => f.key));
    const extra: { key: string; label: string; listId?: string }[] = [];
    if (!keys.has('qty') && !keys.has('liters')) extra.push({ key: 'qty', label: 'العدد' });
    if (!keys.has('unitPrice')) extra.push({ key: 'unitPrice', label: 'سعر الوحدة' });
    return extra;
}

// Sum a multi-product service (additives): line total = price × quantity, quantity defaults to 1.
function sumMultiProduct(details: Record<string, any>): number {
    let sum = 0;
    for (const dk of Object.keys(details)) {
        if (dk.startsWith('price_')) {
            const price = Number(details[dk] || 0);
            const qty = Number(details[dk.replace('price_', 'qty_')] || 0) || 1;
            sum += price * qty;
        }
    }
    return sum;
}

const SECTOR_BRANCH_SERVICES = [
    {
        section: "المحرك",
        items: [
            { key: "engineFlash", label: "فلاش محرك", guide: "أول زيارة / 30K كم", detailFields: [{ key: "brand", label: "النوع / الماركة", listId: "engineFlashBrands" }, { key: "qty", label: "الكمية" }, { key: "notes", label: "ملاحظات" }] },
            { key: "engineOil", label: "زيت محرك", guide: "5K - 10K km", detailFields: [
                { key: "brand", label: "النوع / الماركة", listId: "oilBrands" },
                { key: "viscosity", label: "درجة اللزوجة", listId: "viscosities" },
                { key: "qty", label: "عدد اللترات" },
                 { key: "notes", label: "ملاحظات" }]},
            { key: "oilFilter", label: "فلتر زيت محرك", guide: "مع تغيير الزيت", detailFields: [
                { key: "brand",      label: "النوع / الماركة", listId: "oilFilterBrands" },
                { key: "filterNum", label: "رقم الفلتر", listId: "oilFilterCodes" }, { key: "notes", label: "ملاحظات" }]},
            { key: "coolant", label: "ماء / سائل تبريد", guide: "عند النقص", detailFields: [
                { key: "brand", label: "النوع / الماركة", listId: "coolants" },
                { key: "qty",  label: "العدد" },
                 { key: "notes", label: "ملاحظات" }]},
            { key: "engineCeramic", label: "سيراميك محرك", guide: "30K - 50K km", detailFields: [{ key: "brand", label: "النوع / الماركة", listId: "engineCeramicBrands" }, { key: "qty", label: "الكمية" }, { key: "notes", label: "ملاحظات" }] },
            { key: "linerCleaner", label: "منظف بطانة (جكجكة)", guide: "كل 20K - 30K", detailFields: [{ key: "brand", label: "النوع / الماركة", listId: "linerCleanerBrands" }, { key: "qty", label: "الكمية" }, { key: "notes", label: "ملاحظات" }] },
            { key: "oilLeakPreventer", label: "مانع تسريب زيت", guide: "عند نضوح زيت", detailFields: [{ key: "brand", label: "النوع / الماركة", listId: "oilLeakPreventerBrands" }, { key: "qty", label: "الكمية" }, { key: "notes", label: "ملاحظات" }] },
            { key: "smokePreventer", label: "مانع دخان / نقص زيت", guide: "عند نقص الزيت / دخان", detailFields: [{ key: "brand", label: "النوع / الماركة", listId: "smokePreventerBrands" }, { key: "qty", label: "الكمية" }, { key: "notes", label: "ملاحظات" }] },
        ]
    },
    {
        section: "الكير",
        items: [
            { key: "gearboxFlash", label: "فلاش كير", guide: "التبديل الكامل", detailFields: [{ key: "brand", label: "النوع / الماركة", listId: "gearboxFlashBrands" }, { key: "qty", label: "الكمية" }, { key: "notes", label: "ملاحظات" }] },
            { key: "gearboxOil", label: "زيت كير", guide: "40K - 60K km", detailFields: [
                { key: "brand", label: "النوع / الماركة", listId: "gearboxOils" },
                { key: "qty",  label: "اللترات" }, { key: "notes", label: "ملاحظات" }]},
            { key: "gearboxFilter", label: "فلتر كير", guide: "مع زيت الكير", detailFields: [
                { key: "brand", label: "النوع / الماركة", listId: "gearboxFilterBrands" },
                { key: "filterNum", label: "رقم الفلتر", listId: "gearboxFilterCodes" },
                 { key: "notes", label: "ملاحظات" }]},
            { key: "gearboxCeramic", label: "سيراميك كير", guide: "لحماية التروس", detailFields: [{ key: "brand", label: "النوع / الماركة", listId: "gearboxCeramicBrands" }, { key: "qty", label: "الكمية" }, { key: "notes", label: "ملاحظات" }] },
            { key: "gearboxAntiSlip", label: "مانع انزلاق الكير", guide: "عند النتعة / التأخير", detailFields: [{ key: "brand", label: "النوع / الماركة", listId: "gearboxAntiSlipBrands" }, { key: "qty", label: "الكمية" }, { key: "notes", label: "ملاحظات" }] },
        ]
    },
    {
        section: "التبريد والفرامل",
        items: [
            { key: "airFilter", label: "فلتر هواء", guide: "5K - 10K km", detailFields: [
                { key: "brand",      label: "النوع / الماركة", listId: "airFilterBrands" },
                { key: "filterNum", label: "رقم الفلتر", listId: "airFilterCodes" }, { key: "notes", label: "ملاحظات" }]},
            { key: "acFilter", label: "فلتر تبريد", guide: "مع الفلتر / 6 أشهر", detailFields: [
                { key: "brand",      label: "النوع / الماركة", listId: "acFilterBrands" },
                { key: "filterNum", label: "رقم الفلتر", listId: "acFilterCodes" }, { key: "notes", label: "ملاحظات" }]},
            { key: "acCleaner", label: "منظف دورة التبريد", guide: "مع فلتر التبريد", detailFields: [{ key: "brand", label: "النوع / الماركة", listId: "acCleanerBrands" }, { key: "qty", label: "الكمية" }, { key: "notes", label: "ملاحظات" }] },
            { key: "brakeFluid", label: "زيت بريك", guide: "40K km", detailFields: [
                { key: "brand", label: "النوع / الماركة", listId: "brakeFluids" },
                { key: "qty",  label: "عدد القطع" }, { key: "notes", label: "ملاحظات" }]},
        ]
    },
    {
        section: "المنظفات والأساسيات",
        items: [
            { key: "injectorCleaner", label: "منظف بخاخات", guide: "10K - 20K km", detailFields: [{ key: "brand", label: "النوع / الماركة", listId: "injectorCleanerBrands" }, { key: "qty", label: "الكمية" }, { key: "notes", label: "ملاحظات" }] },
            { key: "fuelSystemCleaner", label: "منظف نظام الوقود", guide: "10K - 20K km", detailFields: [{ key: "brand", label: "النوع / الماركة", listId: "fuelSystemCleanerBrands" }, { key: "qty", label: "الكمية" }, { key: "notes", label: "ملاحظات" }] },
            { key: "octaneBooster", label: "أوكتان بنزين", guide: "أساسي للوقود", detailFields: [{ key: "brand", label: "النوع / الماركة", listId: "octaneBoosterBrands" }, { key: "qty", label: "الكمية" }, { key: "notes", label: "ملاحظات" }] },
            { key: "battery", label: "البطارية", guide: "فحص دوري", detailFields: [{ key: "brand", label: "النوع / الماركة", listId: "batteries" }, { key: "qty", label: "الكمية" }, { key: "notes", label: "ملاحظات" }] },
            { key: "batteryFilter", label: "فلتر البطارية", guide: "حسب الصيانة", detailFields: [{ key: "brand", label: "النوع / الماركة", listId: "batteryFilterBrands" }, { key: "qty", label: "الكمية" }, { key: "notes", label: "ملاحظات" }] },
            { key: "wipers", label: "مساحات زجاج", guide: "موسمي", detailFields: [
                { key: "brand", label: "النوع / الماركة", listId: "wiperBrands" },
                { key: "size", label: "حجم الماسحات", listId: "wiperSizes" }, { key: "notes", label: "ملاحظات" }]},
            { key: "windshieldFluid", label: "سائل غسيل جام", guide: "عند النقص", detailFields: [{ key: "brand", label: "النوع / الماركة", listId: "windshieldFluids" }, { key: "qty", label: "الكمية" }, { key: "notes", label: "ملاحظات" }] },
        ]
    }
];

const initServices = (): Record<string, ServiceEntry> => {
    const obj: Record<string, ServiceEntry> = {};
    MAIN_SERVICES.forEach(s => { obj[s.key] = makeService(); });
    SECTOR_BRANCH_SERVICES.forEach(section => {
        section.items.forEach(s => {
            obj[s.key] = makeService();
        });
    });
    return obj;
};

// ==================== لستات الاقتراحات الافتراضية الثابتة ====================

const DEFAULT_SUGGESTION_LISTS: Record<string, string[]> = {
    materials: [],
    oilBrands: [],
    viscosities: [],
    brakeFluids: [],
    coolants: [],
    oilFilterBrands: [],
    oilFilterCodes: [],
    airFilterBrands: [],
    airFilterCodes: [],
    acFilterBrands: [],
    acFilterCodes: [],
    gearboxFilterBrands: [],
    gearboxFilterCodes: [],
    batteryFilterBrands: [],
    gearboxOils: [],
    engineFlashBrands: [],
    engineCeramicBrands: [],
    linerCleanerBrands: [],
    oilLeakPreventerBrands: [],
    smokePreventerBrands: [],
    gearboxFlashBrands: [],
    gearboxCeramicBrands: [],
    gearboxAntiSlipBrands: [],
    acCleanerBrands: [],
    injectorCleanerBrands: [],
    fuelSystemCleanerBrands: [],
    octaneBoosterBrands: [],
    batteries: [],
    wiperBrands: [],
    wiperSizes: [],
    engineBeltsBrands: [],
    brakePadsBrands: [],
    sparkPlugsBrands: [],
    windshieldFluids: [],
    technicianNames: [],
    receptionistNames: [],
    supervisorNames: [],
    bayNumbers: []
};

// Tire size entered in ONE field and auto-slashed like a date: "205 / 55 / 16"
// (width 3 / aspect 2 / rim diameter 2). Kept split into {width,aspect,diameter} on save.
const formatTireSize = (raw: string): string => {
    const d = raw.replace(/\D/g, "").slice(0, 7);
    return [d.slice(0, 3), d.slice(3, 5), d.slice(5, 7)].filter(Boolean).join(" / ");
};
const parseTireSize = (val: string): { width: string; aspect: string; diameter: string } => {
    const [width = "", aspect = "", diameter = ""] = val.split("/").map(s => s.trim());
    return { width, aspect, diameter };
};

export default function StandardReception({
    branches,
    selectedBranchId,
    setSelectedBranchId,
    onClose,
    saleMode = false
}: {
    branches: { id: string; name: string }[];
    selectedBranchId: string;
    setSelectedBranchId: (id: string) => void;
    onClose: () => void;
    saleMode?: boolean;
}) {
    // "بيع منتج" order: same flow as a normal work order, but tagged as a sale so it
    // never requires a technician to finish. Initialized from the prop for new orders,
    // and overridden from the loaded record when editing an existing sale.
    const [isSale, setIsSale] = useState<boolean>(saleMode);
    const { t } = useLanguage();
    const { user, employeeRole, employeeBranchId, employeeId } = useAuth();
    const searchParams = useSearchParams();
    const router = useRouter();
    const editId = searchParams.get('edit');
    const [editReportId, setEditReportId] = useState<string | null>(null);

    // Wizard step
    const [step, setStep] = useState<Step>(1);

    // ---------- Branches ----------
    const [branchChangePending, setBranchChangePending] = useState<string | null>(null);

    // ---------- Suggestion Lists (from Supabase Database) ----------
    const [suggestionLists, setSuggestionLists] = useState<Record<string, any[]>>(DEFAULT_SUGGESTION_LISTS);
    const [focusedListId, setFocusedListId] = useState<string | null>(null);
    const [focusedInputValue, setFocusedInputValue] = useState<string>("");
    const [focusedFieldKey, setFocusedFieldKey] = useState<string | null>(null);

    useEffect(() => {
        // Fetch from Supabase
        async function loadFromDB() {
            const activeBranchId = selectedBranchId || employeeBranchId;
            if (!activeBranchId) return;

            try {
                let query = (supabase as any).from('suggestion_lists').select('key, items, branch_id');
                query = query.eq('branch_id', activeBranchId);
                const { data, error } = await query;
                
                if (error) throw error;
                
                const fetchedLists: Record<string, any[]> = {};
                if (data && data.length > 0) {
                    // Sort data to ensure the active branch's entries come last and override others
                    const sortedData = [...data].sort((a, b) => {
                        if (a.branch_id === activeBranchId) return 1;
                        if (b.branch_id === activeBranchId) return -1;
                        return 0;
                    });

                    sortedData.forEach((row: any) => {
                        fetchedLists[row.key] = Array.isArray(row.items) ? row.items : [];
                    });
                }

                setSuggestionLists(() => {
                    const merged: Record<string, any[]> = {};
                    for (const key of Object.keys(DEFAULT_SUGGESTION_LISTS)) {
                        const src = fetchedLists[key] || DEFAULT_SUGGESTION_LISTS[key];
                        // الاقتراحات بدون أسعار (حسب طلب المستخدم): نُفرّغ أي سعر مخزّن حتى
                        // لا يظهر بالقوائم المنسدلة ولا يُعبّأ تلقائياً بخانات الفاتورة.
                        merged[key] = Array.isArray(src)
                            ? src.map((it: any) => (typeof it === 'object' && it !== null ? { ...it, price: "" } : it))
                            : src;
                    }
                    return merged;
                });
            } catch (err) {
                console.error("Failed to load suggestion lists from DB:", err);
            }
        }
        loadFromDB();
    }, [selectedBranchId, employeeBranchId]);

    const getFilteredSuggestions = () => {
        if (!focusedListId || !suggestionLists[focusedListId]) return [];
        
        const listItems = suggestionLists[focusedListId];
        const query = focusedInputValue.trim().toLowerCase();
        
        const normalized = listItems.map(item => {
            if (typeof item === 'object' && item !== null) {
                return {
                    name: item.name || "",
                    price: item.price || "",
                    serial: item.serial || ""
                };
            }
            return {
                name: String(item),
                price: "",
                serial: ""
            };
        });

        if (query.length === 0) {
            return normalized.slice(0, 10);
        }

        return normalized.filter(item => {
            return item.name.toLowerCase().includes(query) || item.serial.toLowerCase().includes(query);
        }).slice(0, 30);
    };

    // ---------- Additional Fields ----------
    const [shiftName, setShiftName] = useState<string>("");
    const [shiftSupervisor, setShiftSupervisor] = useState<string>("");

    // ---------- Employees ----------
    const [employees, setEmployees] = useState<{ id: string; name: string; role: string }[]>([]);
    // Held as a NAME, not an employee id: reception staff are picked from the
    // "أسماء موظفي الاستقبال" suggestion list and don't need a login account.
    const [receptionistName, setReceptionistName] = useState<string>("");

    useEffect(() => {
        // Default to the signed-in user's own name for a new card.
        if (employeeId && !editId && !receptionistName) {
            const me = employees.find(e => e.id === employeeId);
            if (me) setReceptionistName(me.name);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [employeeId, editId, employees]);

    // Resolve the typed name back to an employee row when one exists, so
    // receptionist_id (and everything joining on it) keeps working as before.
    const resolvedReceptionistId = employees.find(
        e => e.name.trim() === receptionistName.trim()
    )?.id || "";

    const [selectedTechnicianId, setSelectedTechnicianId] = useState<string>("");
    const [assignedTechnician, setAssignedTechnician] = useState<string>("");

    // ---------- STEP 1: Customer & Vehicle ----------
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [clientSuggestions, setClientSuggestions] = useState<{ id: string; name: string; phone: string; vehicles: any[] }[]>([]);
    const [isSearchingClient, setIsSearchingClient] = useState(false);
    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
    const [make, setMake] = useState("");
    const [model, setModel] = useState("");
    const [engineSize, setEngineSize] = useState("");
    const [odometer, setOdometer] = useState("");
    const [odometerUnit, setOdometerUnit] = useState<'km' | 'mi'>('km');
    // Future odometer = current reading + a service interval. Quick buttons add the interval
    // in km; if the unit is miles the increment is converted (km × 0.6214).
    const [futureOdometer, setFutureOdometer] = useState("");
    // جهة التعاقد: "" = an ordinary cash customer, otherwise the contract this
    // order is billed to on credit (آجل) — it then lands in the contracts tab.
    const [contractId, setContractId] = useState("");
    const contracts = useContracts();
    const [tireSize, setTireSize] = useState("");
    const FUTURE_INTERVALS = [3000, 5000, 8000, 10000];
    const addFutureKm = (km: number) => {
        const base = parseInt(odometer || "0") || 0;
        const inc = odometerUnit === 'mi' ? Math.round(km * 0.6214) : km;
        setFutureOdometer(String(base + inc));
    };
    const [plateNumber, setPlateNumber] = useState("");
    // Driver route (فرع الكراج) — intercity line, e.g. بصرة - بغداد - ناصرية.
    // The driver's name is the client name itself, so no separate name field.
    const [driverRoute, setDriverRoute] = useState("");

    // ---------- STEP 2: Services ----------
    const [freeServices, setFreeServices] = useState<Record<string, boolean>>({
        windshieldWater: false, tirePressure: false, engineClean: false,
    });
    const [services, setServices] = useState<Record<string, ServiceEntry>>(initServices());
    const [customServices, setCustomServices] = useState<{ id: string; label: string; status: string; price: string }[]>([]);

    // ---------- دفتر الخدمة ----------
    const [bookletType, setBookletType] = useState<"جديد" | "قديم" | "لا يوجد" | "">("");
    const [bookletChanges, setBookletChanges] = useState("");
    const [bookletSerial, setBookletSerial] = useState("");

    // ---------- STEP 3: Pricing & Notes ----------
    const [notes, setNotes] = useState("");
    const [bayNumber, setBayNumber] = useState("");
    const [totalPrice, setTotalPrice] = useState("");
    const [discount, setDiscount] = useState("");
    const [amountReceived, setAmountReceived] = useState("");

    // ---------- UI States ----------
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [createdWorkOrderId, setCreatedWorkOrderId] = useState<string | null>(null);
    const [reportNumber, setReportNumber] = useState<number | null>(null);

    const isSectorBranch = branches.find(b => b.id === selectedBranchId)?.name === 'القطاع' || branches.find(b => b.id === selectedBranchId)?.name === 'فرع القطاع';
    const isIndustrialBranch = ['الصناعية', 'فرع الصناعية', 'الكراج', 'فرع الكراج'].includes(branches.find(b => b.id === selectedBranchId)?.name || '');
    const isGarageBranch = ['الكراج', 'فرع الكراج'].includes(branches.find(b => b.id === selectedBranchId)?.name || '');

    const activeServicesList = useMemo(() => {
        return MAIN_SERVICES.map(svc => {
            if (!isIndustrialBranch) return svc;
            
            let detailFields: { key: string; label: string; listId?: string }[] = [];
            
            if (svc.key === 'coolant') {
                detailFields = [
                    { key: "type",      label: "اسم المادة", listId: "coolants" },
                    { key: "size",      label: "الحجم (4L / 1L)" },
                    { key: "qty",       label: "العدد" },
                    
                    { key: "notes",     label: "ملاحظات" },
                ];
            } else if (svc.key === 'additives' || svc.key === 'wipers') {
                detailFields = []; // additives & wipers (المساحات) are handled custom (multi-product)
            } else {
                const nameKey = svc.key === 'engineOil' ? 'brand' : 'type';
                const originalField = svc.detailFields.find(f => f.key === nameKey || f.key === 'brand' || f.key === 'type');
                detailFields = [
                    { key: nameKey,     label: "اسم المادة", listId: originalField?.listId },
                    { key: "qty",       label: "العدد" },
                    
                    { key: "notes",     label: "ملاحظات" },
                ];
            }
            
            return { ...svc, detailFields };
        });
    }, [isIndustrialBranch]);
    // ---------- Print Preview States ----------
    const [previewReportId, setPreviewReportId] = useState<string | null>(null);
    const [previewMode, setPreviewMode] = useState<'full' | 'short'>('full');
    const [previewReport, setPreviewReport] = useState<any>(null);
    const [previewLoading, setPreviewLoading] = useState(false);

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
                    vehicles (make, model, plate_number, engine_size, clients (name, phone)),
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
    // Fetch employees on mount
    useEffect(() => {
        let empQuery = supabase.from('employees').select('id, name, role, branch_id').order('name');

        const activeBranchId = selectedBranchId || employeeBranchId;
        if (activeBranchId) {
            empQuery = empQuery.eq('branch_id', activeBranchId);
        }

        empQuery.then(({ data }) => {
            if (data) setEmployees(data);
        });

        // Initialize active branch ID if it is not set yet
        if (!selectedBranchId && employeeBranchId) {
            setSelectedBranchId(employeeBranchId);
        } else if (!selectedBranchId && branches && branches.length > 0) {
            setSelectedBranchId(branches[0].id);
        }
    }, [employeeRole, employeeBranchId, selectedBranchId, branches]);

    // Load existing report for editing
    useEffect(() => {
        if (!editId) return;
        const loadReport = async () => {
            const { data } = await supabase.from('inspection_reports')
                .select(`id, status, notes, total_price, odometer_reading, odometer_unit, order_type, selected_services, branch_id, bay_number, receptionist_id, contract_id,
                         vehicles(id, make, model, engine_size, plate_number, booklet_serial, clients(id, name, phone))`)
                .eq('id', editId).single();

            if (data) {
                setEditReportId(data.id);
                setIsSale((data as { order_type?: string }).order_type === 'sale');
                setContractId((data as { contract_id?: string | null }).contract_id || "");
                const vehicle = Array.isArray(data.vehicles) ? data.vehicles[0] : data.vehicles;
                const client = vehicle ? (Array.isArray(vehicle.clients) ? vehicle.clients[0] : vehicle.clients) : null;
                
                if (client) {
                    setName(client.name); setPhone(client.phone); setSelectedClientId(client.id);
                }
                if (vehicle) {
                    setMake(vehicle.make || ""); setModel(vehicle.model || "");
                    setEngineSize(vehicle.engine_size || ""); setPlateNumber(vehicle.plate_number || "");
                    setBookletSerial(vehicle.booklet_serial || "");
                }
                setOdometer(data.odometer_reading?.toString() || "");
                setOdometerUnit((data as { odometer_unit?: string }).odometer_unit === 'mi' ? 'mi' : 'km');
                setNotes(data.notes || "");
                setBayNumber(data.bay_number || "");
                if (data.branch_id) setSelectedBranchId(data.branch_id);
                // Fall back to the linked employee's name; the payload's own
                // receptionistName (set just below) wins when present.
                if (data.receptionist_id) {
                    const linked = employees.find(e => e.id === data.receptionist_id);
                    if (linked) setReceptionistName(linked.name);
                }
                
                const payload = Array.isArray(data.selected_services) ? data.selected_services[0] : data.selected_services;
                if (payload) {
                    setFutureOdometer(payload.futureOdometer || "");
                    setDriverRoute(payload.driverRoute || "");
                    if (payload.tireSize) {
                        const t = payload.tireSize;
                        setTireSize([t.width, t.aspect, t.diameter].filter(Boolean).join(" / "));
                    }
                    if (payload.freeServices) setFreeServices(payload.freeServices);
                    if (payload.services) setServices({ ...initServices(), ...payload.services });
                    if (payload.customServices) setCustomServices(payload.customServices);
                    if (payload.shiftName) setShiftName(payload.shiftName);
                    if (payload.shiftSupervisor) setShiftSupervisor(payload.shiftSupervisor);
                    if (payload.receptionistName) setReceptionistName(payload.receptionistName);
                    if (payload.technicianName) setAssignedTechnician(payload.technicianName);
                    if (payload.booklet) {
                        setBookletType(payload.booklet.type || "");
                        setBookletChanges(payload.booklet.changes || "");
                    }
                    if (payload.pricing) {
                        setTotalPrice(payload.pricing.totalPrice || data.total_price?.toString() || "");
                        setDiscount(payload.pricing.discount || "");
                        setAmountReceived(payload.pricing.amountReceived || "");
                    } else {
                        setTotalPrice(data.total_price?.toString() || "");
                    }
                }
            }
        };
        loadReport();
    }, [editId]);

    // Barcode-scan flow: /reception?vehicle=<id> — prefill everything the system already knows
    // (name, phone, vehicle, tire size, booklet) so staff never re-ask a returning customer.
    const prefillVehicleId = searchParams.get('vehicle');
    useEffect(() => {
        if (!prefillVehicleId || editId) return;
        const loadPrefill = async () => {
            const { data: v } = await supabase.from('vehicles')
                .select('id, make, model, engine_size, plate_number, booklet_serial, clients(id, name, phone)')
                .eq('id', prefillVehicleId).single();
            if (!v) return;
            const client = Array.isArray(v.clients) ? v.clients[0] : v.clients;
            if (client) { setName(client.name || ""); setPhone(client.phone || ""); setSelectedClientId(client.id); }
            setMake(v.make || ""); setModel(v.model || "");
            setEngineSize(v.engine_size || ""); setPlateNumber(v.plate_number || "");
            setBookletSerial(v.booklet_serial || "");
            if (v.booklet_serial) setBookletType("قديم");
            // Latest known tire size + booklet changes count from previous visits.
            const { data: reps } = await supabase.from('inspection_reports')
                .select('selected_services, created_at')
                .eq('vehicle_id', prefillVehicleId)
                .order('created_at', { ascending: false })
                .limit(15);
            let tire: any = null; let changes = "";
            for (const r of reps || []) {
                const p = Array.isArray(r.selected_services) ? r.selected_services[0] : r.selected_services;
                if (!tire && p?.tireSize) tire = p.tireSize;
                if (!changes && p?.booklet?.changes) changes = String(p.booklet.changes);
                if (tire && changes) break;
            }
            if (tire) setTireSize([tire.width, tire.aspect, tire.diameter].filter(Boolean).join(" / "));
            if (changes) setBookletChanges(changes);
            // A returning government car comes back already tagged to its contract.
            const lastContract = await lastContractForVehicle(prefillVehicleId);
            if (lastContract) setContractId(lastContract);
        };
        loadPrefill();
    }, [prefillVehicleId, editId]);

    // Real-time calculation of total price, discount, and owed amounts
    useEffect(() => {
        const sumServices = Object.values(services).reduce((acc, svc) => acc + (parseFloat(svc.price) || 0), 0);
        const sumCustom = customServices.reduce((acc, svc) => acc + (parseFloat(svc.price) || 0), 0);
        const subtotal = sumServices + sumCustom;
        
        const discVal = parseFloat(discount) || 0;
        const netTotal = Math.max(0, subtotal - discVal);
        
        setTotalPrice(netTotal.toString());
    }, [services, customServices, discount]);

    // Custom services helpers
    const addCustomService = () => {
        setCustomServices(prev => [...prev, { id: Date.now().toString(), label: "", status: "", price: "" }]);
    };
    const removeCustomService = (id: string) => setCustomServices(prev => prev.filter(s => s.id !== id));
    const setCustomSvcField = (id: string, field: string, value: string) => {
        setCustomServices(prev => prev.map(s => {
            if (s.id === id) {
                const updated = { ...s, [field]: value };
                if (field === 'label') {
                    const list = suggestionLists["materials"];
                    if (list) {
                        const matched = list.find((item: any) => {
                            const itemName = typeof item === 'object' && item !== null ? item.name : String(item);
                            return itemName.trim().toLowerCase() === value.trim().toLowerCase();
                        });
                        if (matched && typeof matched === 'object' && matched !== null && matched.price) {
                            updated.price = String(matched.price);
                        }
                    }
                }
                return updated;
            }
            return s;
        }));
    };

    // Phone or Booklet Serial search
    useEffect(() => {
        if (typeof window !== "undefined") {
            const params = new URLSearchParams(window.location.search);
            const searchVal = params.get("search");
            if (searchVal && !phone) {
                setPhone(searchVal);
            }
        }
    }, []);

    useEffect(() => {
        if (!phone || phone.length < 3) { setClientSuggestions([]); return; }
        if (selectedClientId) return;
        const searchClient = async () => {
            setIsSearchingClient(true);
            // A scanner types the whole booklet URL — reduce it to the serial first.
            const trimmed = normalizeBookletCode(phone);
            if (trimmed.toUpperCase().startsWith("BK")) {
                // Query by booklet serial number
                const { data } = await supabase
                    .from('clients')
                    .select('id, name, phone, vehicles(make, model, engine_size, plate_number, booklet_serial)')
                    .eq('vehicles.booklet_serial', trimmed.toUpperCase());
                
                const filtered = data?.filter(c => c.vehicles?.some(v => v.booklet_serial?.toUpperCase() === trimmed.toUpperCase())) || [];
                setClientSuggestions(filtered);
            } else {
                // Query by phone
                const { data } = await supabase
                    .from('clients')
                    .select('id, name, phone, vehicles(make, model, engine_size, plate_number, booklet_serial)')
                    .ilike('phone', `%${phone}%`)
                    .limit(5);
                setClientSuggestions(data || []);
            }
            setIsSearchingClient(false);
        };
        const timeout = setTimeout(searchClient, 500);
        return () => clearTimeout(timeout);
    }, [phone, selectedClientId]);

    const selectSuggestion = (client: any) => {
        setPhone(client.phone);
        setName(client.name);
        setSelectedClientId(client.id);
        setClientSuggestions([]);
        if (client.vehicles && client.vehicles.length > 0) {
            const v = client.vehicles[0];
            setMake(v.make || ""); setModel(v.model || "");
            setEngineSize(v.engine_size || ""); setPlateNumber(v.plate_number || "");
            setBookletSerial(v.booklet_serial || "");
        }
    };

    const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setPhone(e.target.value);
        if (selectedClientId) {
            setSelectedClientId(null);
            setName(""); setMake(""); setModel(""); setPlateNumber(""); setBookletSerial("");
        }
    };

    // Update a service's status
    const setServiceStatus = (key: string, status: "جيد" | "يحتاج تغيير") => {
        setServices(prev => ({ ...prev, [key]: { ...prev[key], status } }));
    };

    // Update a service's detail field
    const setServiceDetail = (key: string, field: string, value: string) => {
        setServices(prev => {
            const newDet = { ...prev[key].details, [field]: value };
            let newPrice = prev[key].price;

            // Find listId
            let listId: string | undefined = undefined;
            const mainSvc = activeServicesList.find(s => s.key === key);
            const mainField = mainSvc?.detailFields.find(f => f.key === field);
            if (mainField?.listId) {
                listId = mainField.listId;
            } else {
                for (const sec of SECTOR_BRANCH_SERVICES) {
                    const item = sec.items.find(it => it.key === key);
                    const fld = item?.detailFields?.find(f => f.key === field);
                    if (fld?.listId) {
                        listId = fld.listId;
                        break;
                    }
                }
            }

            // Override listId for non-sector branches:
            if (!isSectorBranch) {
                if (listId && listId !== "technicianNames" && listId !== "supervisorNames" && listId !== "receptionistNames" && listId !== "bayNumbers") {
                    listId = "materials";
                } else if (field.startsWith('prod_')) {
                    listId = "materials";
                }
            }

            // Look up price in suggestions
            if (listId && suggestionLists[listId]) {
                const matchedItem = suggestionLists[listId].find(item => {
                    const itemName = typeof item === 'object' && item !== null ? item.name : String(item);
                    return itemName.trim().toLowerCase() === value.trim().toLowerCase();
                });
                
                if (matchedItem && typeof matchedItem === 'object' && matchedItem !== null && matchedItem.price) {
                    const itemPrice = String(matchedItem.price);
                    
                    if (itemPrice) {
                        newDet.unitPrice = itemPrice;
                    } else if (field.startsWith('prod_')) {
                        const priceKey = field.replace('prod_', 'price_');
                        newDet[priceKey] = itemPrice;
                    } else {
                        newPrice = itemPrice;
                    }
                }
            }

            // Recalculate totals for services with subtotal calculations
            if (key === 'additives' || key === 'cleaners' || key === 'wipers') {
                const sum = sumMultiProduct(newDet);
                newPrice = sum > 0 ? String(sum) : '';
            } else {
                const q = parseFloat(newDet.qty || newDet.liters);
                const up = parseFloat(newDet.unitPrice);
                if (!isNaN(q) && !isNaN(up) && q > 0 && up > 0) {
                    newPrice = (q * up).toString();
                } else if (!isNaN(up) && up > 0) {
                    newPrice = up.toString();
                }
            }

            return {
                ...prev,
                [key]: { ...prev[key], details: newDet, price: newPrice }
            };
        });
    };

    const handleServiceDetailBlur = (key: string, field: string, value: string) => {
        let listId: string | undefined = undefined;
        const mainSvc = activeServicesList.find(s => s.key === key);
        const mainField = mainSvc?.detailFields.find(f => f.key === field);
        if (mainField?.listId) {
            listId = mainField.listId;
        } else {
            for (const sec of SECTOR_BRANCH_SERVICES) {
                const item = sec.items.find(it => it.key === key);
                const fld = item?.detailFields?.find(f => f.key === field);
                if (fld?.listId) {
                    listId = fld.listId;
                    break;
                }
            }
        }

        // Override listId for non-sector branches:
        if (!isSectorBranch) {
            if (listId && listId !== "technicianNames" && listId !== "supervisorNames" && listId !== "receptionistNames" && listId !== "bayNumbers") {
                listId = "materials";
            } else if (field.startsWith('prod_')) {
                listId = "materials";
            }
        }

        if (listId && suggestionLists[listId]) {
            const matchedItem = suggestionLists[listId].find(item => {
                if (typeof item === 'object' && item !== null) {
                    const itemSerial = String(item.serial || '').trim();
                    return itemSerial && itemSerial === value.trim();
                }
                return false;
            });

            if (matchedItem) {
                setServiceDetail(key, field, matchedItem.name);
            }
        }
    };

    // Update a service's price
    const setServicePrice = (key: string, value: string) => {
        setServices(prev => ({ ...prev, [key]: { ...prev[key], price: value } }));
    };

    // Auto-calculate total from service prices (kept for manual trigger if needed)
    const calcTotal = () => {
        const sumServices = Object.values(services).reduce((acc, svc) => acc + (parseFloat(svc.price) || 0), 0);
        const sumCustom = customServices.reduce((acc, svc) => acc + (parseFloat(svc.price) || 0), 0);
        const sum = sumServices + sumCustom;
        if (sum > 0) setTotalPrice(sum.toString());
    };

    const handleNextStep1 = () => {
        if (!name || !phone || !make) {
            setError("يرجى تعبئة الحقول المطلوبة (اسم، هاتف، نوع السيارة)");
            return;
        }
        setError(null); setStep(2);
    };

    const handleNextStep2 = () => { 
        setError(null); 
        calcTotal();
        setStep(3); 
    };

    const handleSaveDraft = async () => saveWorkOrder('تم الاستلام', null, false);
    const handleSaveOnly = async () => saveWorkOrder('تم الاستلام', null, true);
    // Hand the car over to the workshop floor as "received" — the timer does NOT start here.
    // The supervisor starts the service (and sets its estimated time) from ساحة الورشة.
    const handleStartWorkOrder = async () => saveWorkOrder('تم الاستلام', null, false);

    /**
     * The client row for this card, creating one only when the number is genuinely new.
     *
     * clients.phone is UNIQUE. This used to insert blindly whenever the customer wasn't
     * picked from the suggestions list, so a RETURNING customer whose number the
     * receptionist typed by hand failed the whole order with
     * "duplicate key value violates unique constraint clients_phone_key".
     *
     * An existing row is reused as-is — the stored name is not overwritten, because the
     * number is the identity here and the saved name is usually the more complete one.
     */
    const resolveClientId = async (): Promise<string> => {
        if (selectedClientId) return selectedClientId;

        const cleanPhone = phone.trim();
        const cleanName = name.trim();

        const { data: existing } = await supabase
            .from('clients').select('id').eq('phone', cleanPhone).limit(1).maybeSingle();
        if (existing) return existing.id;

        const { data: nc, error: ce } = await supabase
            .from('clients').insert({ name: cleanName, phone: cleanPhone }).select('id').single();

        if (ce) {
            // 23505 = another receptionist registered the same number between the check
            // above and this insert. Fall back to their row instead of failing the card.
            if (ce.code === '23505') {
                const { data: raced } = await supabase
                    .from('clients').select('id').eq('phone', cleanPhone).limit(1).maybeSingle();
                if (raced) return raced.id;
            }
            throw ce;
        }
        return nc!.id;
    };

    const saveWorkOrder = async (status: 'تم الاستلام' | 'قيد العمل', startTime: string | null, skipStep3 = false) => {
        setLoading(true); setError(null);
        try {
            let branchId = null, employeeId = null;
            if (user?.id) {
                const { data: emp } = await supabase.from('employees').select('id, branch_id').eq('auth_id', user.id).maybeSingle();
                if (emp) { employeeId = emp.id; branchId = emp.branch_id; }
            }

            const clientId = await resolveClientId();

            let vehicleId: string | null = null;
            const cleanedPlate = plateNumber ? plateNumber.trim() : "";
            const cleanedMake = make ? make.trim() : "";
            const cleanedModel = model ? model.trim() : "";
            const cleanedEngine = engineSize ? engineSize.trim() : "";

            if (cleanedPlate !== "") {
                // Scope to THIS client so a returning customer's new car doesn't match
                // (or hijack) another client's vehicle with the same plate.
                const { data: evs } = await supabase.from('vehicles')
                    .select('id')
                    .eq('client_id', clientId)
                    .eq('plate_number', cleanedPlate)
                    .limit(1);
                if (evs && evs.length > 0) vehicleId = evs[0].id;
            } else if (cleanedMake !== "" || cleanedModel !== "") {
                const { data: evs } = await supabase.from('vehicles')
                    .select('id')
                    .eq('client_id', clientId)
                    .eq('make', cleanedMake)
                    .eq('model', cleanedModel)
                    .limit(1);
                if (evs && evs.length > 0) vehicleId = evs[0].id;
            }

            let finalBookletSerial = bookletSerial ? bookletSerial.trim() : "";
            if (bookletType === 'جديد' && !finalBookletSerial) {
                const { data: lastVeh } = await supabase
                    .from('vehicles')
                    .select('booklet_serial')
                    .not('booklet_serial', 'is', null)
                    .order('booklet_serial', { ascending: false })
                    .limit(1);
                
                let nextNum = 10001;
                if (lastVeh && lastVeh.length > 0 && lastVeh[0].booklet_serial) {
                    const match = lastVeh[0].booklet_serial.match(/BK-(\d+)/);
                    if (match) {
                        nextNum = parseInt(match[1]) + 1;
                    }
                }
                finalBookletSerial = `BK-${nextNum}`;
                setBookletSerial(finalBookletSerial);
            }

            if (vehicleId) {
                await supabase.from('vehicles')
                    .update({ 
                        client_id: clientId, 
                        make: cleanedMake, 
                        model: cleanedModel, 
                        engine_size: cleanedEngine,
                        plate_number: cleanedPlate || null,
                        booklet_serial: finalBookletSerial || null
                    })
                    .eq('id', vehicleId);
            } else {
                // New car for this client. booklet_serial is globally UNIQUE, so never
                // reuse a serial that already belongs to another vehicle (e.g. the old
                // car's serial auto-filled into the form) — that caused the insert to be
                // rejected and blocked the whole order. Drop it; staff can assign a
                // booklet to the new car separately.
                if (finalBookletSerial) {
                    const { data: dup } = await supabase.from('vehicles')
                        .select('id')
                        .eq('booklet_serial', finalBookletSerial)
                        .limit(1);
                    if (dup && dup.length > 0) finalBookletSerial = "";
                }
                const { data: nv, error: ve } = await supabase.from('vehicles')
                    .insert({
                        client_id: clientId,
                        make: cleanedMake,
                        model: cleanedModel,
                        engine_size: cleanedEngine,
                        plate_number: cleanedPlate || null,
                        booklet_serial: finalBookletSerial || null
                    })
                    .select('id').single();
                if (ve) throw ve;
                vehicleId = nv!.id;
            }

            const receptionistNameToSave = receptionistName.trim();

            // Calculate estimated duration in minutes
            const SERVICE_ESTIMATED_MINUTES: Record<string, number> = {
                engineOil: 30,
                oilFilter: 20,
                airFilter: 20,
                acFilter: 20,
                brakeFluid: 25,
                coolant: 30,
                battery: 20,
                engineBelts: 30,
                brakePads: 30,
                sparkPlugs: 30,
                gearboxHydraulic: 45,
                gearboxFilter: 30,
                wipers: 15,
                additives: 10,
                // Sector Branch new service keys mapping
                engineFlash: 20,
                engineCeramic: 15,
                linerCleaner: 15,
                oilLeakPreventer: 15,
                smokePreventer: 15,
                gearboxFlash: 25,
                gearboxOil: 35,
                gearboxCeramic: 15,
                gearboxAntiSlip: 15,
                acCleaner: 20,
                injectorCleaner: 20,
                fuelSystemCleaner: 20,
                octaneBooster: 10,
                batteryFilter: 15,
                windshieldFluid: 10,
            };

            let calculatedDuration = 0;
            Object.entries(services).forEach(([key, val]: [string, any]) => {
                if (val && val.status === 'يحتاج تغيير') {
                    calculatedDuration += SERVICE_ESTIMATED_MINUTES[key] || 30;
                }
            });
            Object.entries(freeServices).forEach(([key, val]) => {
                if (val) {
                    calculatedDuration += 10;
                }
            });
            if (Array.isArray(customServices)) {
                calculatedDuration += customServices.length * 30;
            }

            if (calculatedDuration === 0) {
                calculatedDuration = 30; // fallback minimum
            }

            const paperPayload = {
                is_paper_v2_format: true,
                freeServices,
                services,
                customServices,
                shiftName,
                shiftSupervisor,
                technicianName: assignedTechnician,
                booklet: { type: bookletType, changes: bookletChanges, serial: finalBookletSerial },
                pricing: { totalPrice, discount, amountReceived, amountOwedByClient: "0", amountOwedToClient: "0" },
                receptionistName: receptionistNameToSave,
                futureOdometer: futureOdometer || "",
                tireSize: parseTireSize(tireSize),
                driverRoute: driverRoute.trim(),
            };

            const finalBranchId = selectedBranchId || branchId;

            if (editReportId) {
                // Merge over the CURRENT payload instead of replacing it, so fields reception
                // doesn't manage survive an edit: the per-technician ratings array (work-order
                // page) and the accounting state (pricing.accounted/accountedAt/grandTotal/
                // auditExcluded from the audit page). Replacing wholesale wiped them.
                const { data: freshRow } = await supabase.from('inspection_reports')
                    .select('selected_services').eq('id', editReportId).single();
                const existing = (Array.isArray(freshRow?.selected_services) ? freshRow!.selected_services[0] : freshRow?.selected_services) || {};
                // A CLOSED invoice's money is frozen. Editing an accounted order used to
                // rewrite total_price (back to reception's pre-discount figure) and stomp
                // pricing.discount/amountReceived, while keeping the audit's grandTotal/
                // accounted/accountedAt — leaving the invoice showing totals from one
                // epoch and a net from another (e.g. مجموع 95,000, خصم 0, صافي 80,000).
                // Services/details may still be edited; the closed amounts may not.
                const isClosedInvoice = (existing.pricing || {}).accounted === true;
                const mergedPayload = {
                    ...existing,
                    ...paperPayload,
                    pricing: isClosedInvoice
                        ? { ...(existing.pricing || {}) }
                        : { ...(existing.pricing || {}), ...paperPayload.pricing },
                };
                const extraEntries = Array.isArray(freshRow?.selected_services) ? freshRow!.selected_services.slice(1) : [];

                const editUpdate: Record<string, unknown> = {
                    branch_id: finalBranchId, vehicle_id: vehicleId, receptionist_id: resolvedReceptionistId || employeeId,
                    odometer_reading: parseInt(odometer || "0") || 0,
                    odometer_unit: odometerUnit,
                    order_type: isSale ? 'sale' : 'maintenance',
                    contract_id: contractId || null,
                    notes, bay_number: bayNumber,
                    selected_services: [mergedPayload, ...extraEntries],
                    estimated_duration: calculatedDuration,
                };
                // total_price on a closed invoice is the accountant's NET — leave it alone.
                if (!isClosedInvoice) editUpdate.total_price = parseFloat(totalPrice || "0");

                const { error: re } = await supabase.from('inspection_reports')
                    .update(editUpdate)
                    .eq('id', editReportId);

                if (re) throw re;
                syncOrderToGoogleSheets(editReportId); // fire-and-forget Google Sheets sync

                if (skipStep3) {
                    showSuccess(
                        "تم التعديل",
                        isClosedInvoice
                            ? "تم حفظ التعديلات. الفاتورة محاسَبة ومغلقة، فالمبالغ (المجموع/الخصم/الواصل) لم تتغير."
                            : "تم حفظ التعديلات بنجاح."
                    );
                    router.push('/work-orders');
                    setLoading(false);
                    return;
                }

                const { data: rd } = await supabase.from('inspection_reports').select('report_number').eq('id', editReportId).single();
                setCreatedWorkOrderId(editReportId);
                if (rd) setReportNumber(rd.report_number);
                setLoading(false);
                return;
            }

            const { data: rd, error: re } = await supabase.from('inspection_reports')
                .insert({
                    branch_id: finalBranchId, vehicle_id: vehicleId, receptionist_id: resolvedReceptionistId || employeeId,
                    odometer_reading: parseInt(odometer || "0") || 0,
                    odometer_unit: odometerUnit,
                    order_type: isSale ? 'sale' : 'maintenance',
                    contract_id: contractId || null,
                    status, total_price: parseFloat(totalPrice || "0"),
                    notes, bay_number: bayNumber, start_time: startTime,
                    selected_services: [paperPayload],
                    estimated_duration: calculatedDuration,
                })
                .select('id, report_number').single();

            if (re) throw re;
            if (rd) syncOrderToGoogleSheets(rd.id); // fire-and-forget Google Sheets sync

            if (skipStep3) {
                showSuccess("تم الحفظ", "تم إنشاء أمر العمل بنجاح.");
                router.push('/work-orders');
                setLoading(false);
                return;
            }

            setCreatedWorkOrderId(rd!.id);
            setReportNumber(rd!.report_number);
        } catch (err: any) {
            console.error(err);
            setError(err.message || "حدث خطأ أثناء الحفظ.");
        } finally {
            setLoading(false);
        }
    };

    const resetWizard = (newBranchId?: string) => {
        setName(""); setPhone(""); setMake(""); setModel(""); setEngineSize("");
        setOdometer(""); setOdometerUnit('km'); setFutureOdometer(""); setTireSize(""); setPlateNumber(""); setNotes(""); setBayNumber("");
        setFreeServices({ windshieldWater: false, tirePressure: false, engineClean: false });
        setServices(initServices());
        setCustomServices([]);
        setBookletType("");
        setBookletChanges("");
        setContractId("");
        setSelectedBranchId(newBranchId || "");
        setReceptionistName(employees.find(e => e.id === employeeId)?.name || ""); setSelectedTechnicianId(""); setAssignedTechnician("");
        setTotalPrice(""); setDiscount(""); setAmountReceived("");
        setCreatedWorkOrderId(null); setReportNumber(null); setSelectedClientId(null); setEditReportId(null);
        setStep(1);
        router.replace('/reception'); // clear edit param
    };

    // ===================== JSX =====================
    return (
        <div className="p-6 md:p-8 space-y-8 animate-fade-in" dir="rtl">

            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <button onClick={() => { if (step > 1) setStep((step - 1) as Step); else onClose(); }} className="p-2 bg-muted hover:bg-rose-500 hover:text-white rounded-xl transition-colors border border-border" title={step > 1 ? "رجوع خطوة واحدة" : "رجوع إلى قائمة أوامر العمل"}>
                        <ArrowRight size={24} />
                    </button>
                    <div>
                        <h1 className="text-3xl font-display font-bold text-foreground mb-2 flex items-center gap-3">
                            <FileText className="text-rose-500" size={32} />
                            {isSale ? "بيع منتج — هندسة السيارات" : "أمر عمل جديد — هندسة السيارات"}
                        </h1>
                        <p className="text-muted-foreground">{isSale ? "بيع منتج مباشر للعميل (بدون اسم فني)" : "إنشاء بطاقة عمل مفصّلة مطابقة للنموذج الرسمي للورشة"}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 bg-background/40 p-2 rounded-xl border border-border">
                    {["1. البيانات", "2. الفحص", "3. المراجعة"].map((label, i) => (
                        <div key={i} className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-colors ${step >= i + 1 ? 'bg-rose-600 text-white' : 'text-muted-foreground'}`}>{label}</div>
                    ))}
                </div>
            </div>

            {error && (
                <div className="bg-rose-950/40 border border-rose-900/50 rounded-xl p-4 flex gap-3 text-rose-200">
                    <AlertCircle className="text-rose-400 shrink-0" size={20} />
                    <p>{error}</p>
                </div>
            )}

            {/* ===== STEP 1: Customer & Vehicle ===== */}
            {step === 1 && !createdWorkOrderId && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-fade-in">
                    {/* Customer */}
                    <div className="glass-card p-6 rounded-2xl border border-rose-900/20">
                        <h2 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2 border-b border-rose-500/20 pb-4">
                            <UserPlus className="text-rose-400" size={24} /> بيانات العميل
                        </h2>
                        <div className="space-y-4">
                            <div className="space-y-2 relative">
                                <label className="text-sm font-medium text-muted-foreground">رقم الهاتف <span className="text-rose-500">*</span></label>
                                <div className="relative">
                                    <Phone className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" size={18} />
                                    <input type="tel" dir="ltr" placeholder="+964 7X XXX XXXX" className="input-field text-right" style={{ paddingRight: '2.5rem' }} value={phone} onChange={handlePhoneChange} />
                                    {isSearchingClient && <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 text-rose-500 animate-spin" size={16} />}
                                </div>
                                {clientSuggestions.length > 0 && (
                                    <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-xl shadow-2xl overflow-hidden max-h-48 overflow-y-auto">
                                        {clientSuggestions.map(c => (
                                            <div key={c.id} onClick={() => selectSuggestion(c)} className="p-3 hover:bg-muted cursor-pointer border-b border-border last:border-0">
                                                <div className="flex justify-between text-sm">
                                                    <span className="font-bold text-foreground">{c.name}</span>
                                                    <span className="text-muted-foreground font-mono">{c.phone}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-muted-foreground">اسم العميل <span className="text-rose-500">*</span></label>
                                <input type="text" placeholder="مثال: أحمد محمد" className="input-field" value={name} onChange={e => setName(e.target.value)} />
                            </div>
                            <ContractSelect contracts={contracts} value={contractId} onChange={setContractId} />
                            {isGarageBranch && (
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-muted-foreground">خط السائق</label>
                                    <input type="text" placeholder="مثال: بصرة - بغداد - ناصرية" className="input-field" value={driverRoute} onChange={e => setDriverRoute(e.target.value)} />
                                </div>
                            )}
                            {branches.length > 0 && (employeeRole === 'Owner' || employeeRole === 'Admin' || !employeeBranchId) && (
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-muted-foreground">الفرع <span className="text-rose-500">*</span></label>
                                    <select
                                        value={selectedBranchId}
                                        onChange={(e) => {
                                            const newBranchId = e.target.value;
                                            const hasData = name.trim() !== "" || phone.trim() !== "" || make.trim() !== "" || model.trim() !== "" || odometer.trim() !== "" || plateNumber.trim() !== "" || driverRoute.trim() !== "" ||
                                                Object.values(freeServices).some(v => v) ||
                                                Object.values(services).some(s => s.status !== "") ||
                                                customServices.length > 0;
                                            
                                            if (hasData) {
                                                setBranchChangePending(newBranchId);
                                            } else {
                                                setSelectedBranchId(newBranchId);
                                            }
                                        }}
                                        className="input-field"
                                    >
                                        <option value="">-- اختر الفرع --</option>
                                        {branches.map(b => (
                                            <option key={b.id} value={b.id}>{b.name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-muted-foreground">موظف الاستقبال</label>
                                {/* Free text backed by the "أسماء موظفي الاستقبال" suggestion list, the
                                    same way the technician and supervisor fields work. It used to be a
                                    dropdown of `employees`, which meant a receptionist had to be given a
                                    login account just to be named on a work order. Staff who DO have an
                                    account still resolve to their employee row (so receptionist_id keeps
                                    working); anyone else is simply recorded by name. */}
                                <input
                                    type="text"
                                    list="receptionist-names-list"
                                    className="input-field"
                                    placeholder="اسم موظف الاستقبال..."
                                    value={receptionistName}
                                    onChange={e => setReceptionistName(e.target.value)}
                                />
                                <datalist id="receptionist-names-list">
                                    {(suggestionLists.receptionistNames || []).map((s: any, i: number) => (
                                        <option key={`s${i}`} value={typeof s === 'object' && s !== null ? s.name : s} />
                                    ))}
                                    {employees
                                        .filter(e => e.role === 'Receptionist' || e.role === 'Admin' || e.role === 'Owner')
                                        .map(e => <option key={e.id} value={e.name} />)}
                                </datalist>
                            </div>
                        </div>
                    </div>

                    {/* Vehicle */}
                    <div className="glass-card p-6 rounded-2xl border border-rose-900/20">
                        <h2 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2 border-b border-rose-500/20 pb-4">
                            <Car className="text-rose-400" size={24} /> بيانات السيارة
                        </h2>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-muted-foreground">نوع السيارة <span className="text-rose-500">*</span></label>
                                <input type="text" placeholder="تويوتا" className="input-field" value={make} onChange={e => setMake(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-muted-foreground">الموديل</label>
                                <input type="text" placeholder="كامري 2022" className="input-field" value={model} onChange={e => setModel(e.target.value)} />
                            </div>
                            <div className="space-y-2 col-span-2">
                                <label className="text-sm font-medium text-muted-foreground">رقم اللوحة</label>
                                <div className="relative">
                                    <Hash className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" size={18} />
                                    <input type="text" placeholder="بغداد ١٢٣٤" className="input-field" style={{ paddingRight: '2.5rem' }} value={plateNumber} onChange={e => setPlateNumber(e.target.value)} />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-muted-foreground">حجم المحرك</label>
                                <input type="text" placeholder="2.5L" className="input-field" value={engineSize} onChange={e => setEngineSize(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-muted-foreground">عداد السيارة</label>
                                <div className="flex gap-2">
                                    <input type="text" inputMode="numeric" dir="ltr" placeholder="0" className="input-field text-right flex-1" value={withCommas(odometer)} onChange={e => setOdometer(digitsOnly(e.target.value))} />
                                    <div className="flex rounded-xl border border-border overflow-hidden shrink-0">
                                        <button type="button" onClick={() => setOdometerUnit('km')} className={`px-3 text-sm font-bold transition-colors ${odometerUnit === 'km' ? 'bg-rose-600 text-white' : 'bg-card text-muted-foreground hover:bg-muted'}`}>كم</button>
                                        <button type="button" onClick={() => setOdometerUnit('mi')} className={`px-3 text-sm font-bold transition-colors ${odometerUnit === 'mi' ? 'bg-rose-600 text-white' : 'bg-card text-muted-foreground hover:bg-muted'}`}>ميل</button>
                                    </div>
                                </div>
                                {/* Future odometer: current reading + a service interval (km auto-converted to miles). */}
                                <div className="flex flex-wrap gap-1.5 pt-1">
                                    {FUTURE_INTERVALS.map(km => (
                                        <button type="button" key={km} onClick={() => addFutureKm(km)}
                                            className="px-3 py-1.5 rounded-lg text-xs font-bold border border-border bg-card text-muted-foreground hover:border-rose-500/60 hover:text-rose-400 transition-colors">
                                            +{km.toLocaleString('en-US')}
                                        </button>
                                    ))}
                                </div>
                                <div className="flex gap-2 items-center">
                                    <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">العداد المستقبلي</label>
                                    <input type="text" inputMode="numeric" dir="ltr" placeholder="0" className="input-field text-right flex-1" value={withCommas(futureOdometer)} onChange={e => setFutureOdometer(digitsOnly(e.target.value))} />
                                    <span className="text-xs text-muted-foreground shrink-0 w-8 text-center">{odometerUnit === 'mi' ? 'ميل' : 'كم'}</span>
                                </div>
                                {/* Tire size (all branches) — one auto-slashing box like the date: 205 / 55 / 16. */}
                                <div className="pt-1">
                                    <label className="text-sm font-medium text-muted-foreground">حجم الإطار</label>
                                    <div className="mt-1" dir="ltr">
                                        <input type="text" inputMode="numeric" placeholder="205 / 55 / 16" title="العرض / الارتفاع / قطر الجنط" className="input-field text-center w-full" value={tireSize} onChange={e => setTireSize(formatTireSize(e.target.value))} />
                                    </div>
                                    <span className="text-[10px] text-muted-foreground mt-1 block">العرض / الارتفاع / قطر الجنط (اختياري).</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* دفتر الخدمة — full width row */}
                    <div className="lg:col-span-2 glass-card p-6 rounded-2xl border border-rose-900/20">
                        <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2 border-b border-rose-500/20 pb-3">
                            <FileText className="text-rose-400" size={20} /> دفتر الخدمة
                        </h2>
                        <div className="flex flex-wrap items-center gap-4">
                            {(['جديد', 'قديم', 'لا يوجد'] as const).map(opt => (
                                <label key={opt} className={`flex items-center gap-3 px-5 py-3 rounded-xl border-2 cursor-pointer transition-all select-none ${
                                    bookletType === opt
                                        ? opt === 'لا يوجد' ? 'border-rose-500 bg-rose-500/10 text-rose-300'
                                        : opt === 'جديد'   ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                                        : 'border-amber-500 bg-amber-500/10 text-amber-300'
                                        : 'border-border hover:border-rose-500/40 text-muted-foreground'
                                }`}>
                                    <input
                                        type="radio"
                                        name="bookletType"
                                        value={opt}
                                        checked={bookletType === opt}
                                        onChange={() => {
                                            setBookletType(opt);
                                            if (opt === 'جديد') setBookletChanges("1");
                                            else if (opt === 'لا يوجد') setBookletChanges("");
                                        }}
                                        className="w-4 h-4 accent-rose-600"
                                    />
                                    <span className="font-bold text-sm">دفتر {opt}</span>
                                </label>
                            ))}
                            {bookletType !== 'لا يوجد' && bookletType !== '' && (
                                <>
                                    <div className="flex items-center gap-3 flex-1 min-w-[220px]">
                                        <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">عدد التبديلات داخل الدفتر:</label>
                                        <input
                                            type="text" inputMode="numeric"
                                            min="0"
                                            placeholder="0"
                                            value={withCommas(bookletChanges)}
                                            onChange={e => setBookletChanges(digitsOnly(e.target.value))}
                                            className="input-field w-24 text-center"
                                            dir="ltr"
                                        />
                                    </div>
                                    {false && (
                                        <div className="flex items-center gap-3 flex-1 min-w-[220px]">
                                            <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">رقم الدفتر التسلسلي:</label>
                                            <input
                                                type="text"
                                                placeholder={bookletType === 'جديد' ? "توليد تلقائي..." : "مثال: BK-10001"}
                                                value={bookletSerial}
                                                onChange={e => setBookletSerial(e.target.value)}
                                                className="input-field w-40 text-center font-bold text-amber-400 font-mono"
                                                dir="ltr"
                                            />
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>

                    <div className="lg:col-span-2 flex justify-end">
                        <button onClick={handleNextStep1} className="px-8 py-3 rounded-xl bg-rose-600 text-white font-bold hover:bg-rose-500 transition-colors flex items-center gap-2">
                            التالي: الفحص والخدمات <ArrowLeft size={20} />
                        </button>
                    </div>
                </div>
            )}

            {/* ===== STEP 2: Services Form ===== */}
            {step === 2 && !createdWorkOrderId && (
                <div className="space-y-6 animate-fade-in-up">
                    <div className="glass-card p-6 rounded-2xl border border-rose-500/20 max-w-5xl mx-auto space-y-8">

                        {/* Free Services */}
                        <div>
                            <h3 className="text-lg font-bold mb-4 pb-2 border-b border-border text-foreground">خدمات الفحص المجاني</h3>
                            <div className="flex flex-wrap gap-4">
                                {FREE_SERVICES.map(fs => (
                                    <label key={fs.key} className="flex items-center gap-3 p-3 bg-background border border-border rounded-xl cursor-pointer hover:border-emerald-500/50 transition-colors">
                                        <input
                                            type="checkbox"
                                            checked={freeServices[fs.key]}
                                            onChange={e => setFreeServices(prev => ({ ...prev, [fs.key]: e.target.checked }))}
                                            className="w-5 h-5 accent-emerald-600 rounded"
                                        />
                                        <span className="font-bold text-sm">{fs.label}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Main 14 Services */}
                        <div>
                            <h3 className="text-lg font-bold mb-4 pb-2 border-b border-border text-foreground">
                                {isSectorBranch 
                                    ? "خدمات فرع القطاع — فحص دوري مع كل زيارة"
                                    : `خدمات العميل (1-${MAIN_SERVICES.length}) — فحص دوري مع كل زيارة`
                                }
                            </h3>

                            {isSectorBranch ? (
                                <div className="space-y-6">
                                    {SECTOR_BRANCH_SERVICES.map((section) => (
                                        <div key={section.section} className="space-y-3">
                                            <h4 className="text-md font-bold text-rose-500 border-r-4 border-rose-500 pr-2 dark:text-rose-400">
                                                {section.section}
                                            </h4>
                                            <div className="space-y-3">
                                                {section.items.map((svc, idx) => {
                                                    const entry = services[svc.key] || { status: "", details: {}, price: "" };
                                                    return (
                                                        <div key={svc.key} className={`rounded-xl border transition-colors ${entry.status === 'يحتاج تغيير' ? 'border-rose-500/40 bg-rose-950/10' : entry.status === 'جيد' ? 'border-emerald-500/30 bg-emerald-950/10' : 'border-border bg-background/40'}`}>
                                                            <div className="flex flex-wrap items-center gap-3 p-3">
                                                                <span className="text-xs font-mono text-muted-foreground w-5 text-center">{idx + 1}</span>
                                                                <div className="flex flex-col flex-1 min-w-[140px]">
                                                                    <span className="font-bold text-sm">{svc.label}</span>
                                                                    <span className="text-xs text-muted-foreground">{svc.guide}</span>
                                                                </div>

                                                                {/* Status buttons */}
                                                                <div className="flex gap-2">
                                                                    <button onClick={() => setServiceStatus(svc.key, "جيد")}
                                                                        className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all ${entry.status === "جيد" ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-muted border-border hover:border-emerald-500/50'}`}>
                                                                        جيد ✓
                                                                    </button>
                                                                    <button onClick={() => setServiceStatus(svc.key, "يحتاج تغيير")}
                                                                        className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all ${entry.status === "يحتاج تغيير" ? 'bg-rose-600 border-rose-500 text-white' : 'bg-muted border-border hover:border-rose-500/50'}`}>
                                                                        يحتاج تغيير
                                                                    </button>
                                                                </div>

                                                                {/* Price field */}
                                                                <div className="flex items-center gap-1">
                                                                    <input
                                                                        type="text" inputMode="numeric"
                                                                        placeholder="السعر"
                                                                        className="input-field text-xs py-1.5 w-24 text-left"
                                                                        dir="ltr"
                                                                        value={withCommas(entry.price)}
                                                                        onChange={e => setServicePrice(svc.key, digitsOnly(e.target.value))}
                                                                    />
                                                                    <span className="text-xs text-muted-foreground">د.ع</span>
                                                                </div>
                                                            </div>

                                                            {/* Expandable detail fields when يحتاج تغيير is selected */}
                                                            {entry.status === "يحتاج تغيير" && svc.detailFields.length > 0 && (
                                                                <div className="flex flex-wrap gap-2 px-4 pb-3 pr-10 border-t border-border/50 pt-3">
                                                                    {[...svc.detailFields, ...priceFields(svc)].map(df => {
                                                                        const resolvedListId = !isSectorBranch && df.listId && df.listId !== 'technicianNames' && df.listId !== 'supervisorNames' && df.listId !== 'receptionistNames' && df.listId !== 'bayNumbers' ? "materials" : df.listId;
                                                                        const fieldKey = svc.key + "_" + df.key;
                                                                        const suggestions = (focusedListId === resolvedListId && focusedFieldKey === fieldKey) ? getFilteredSuggestions() : [];
                                                                        return (
                                                                            <div key={df.key} className="relative flex-1 min-w-[120px]">
                                                                                <input
                                                                                    type={df.key === 'unitPrice' || df.key === 'qty' || df.key === 'liters' ? "number" : "text"}
                                                                                    placeholder={df.label}
                                                                                    className="input-field text-xs py-1.5 w-full"
                                                                                    value={entry.details[df.key] || ""}
                                                                                    onChange={e => {
                                                                                        setServiceDetail(svc.key, df.key, e.target.value);
                                                                                        if (resolvedListId) setFocusedInputValue(e.target.value);
                                                                                    }}
                                                                                    onFocus={() => {
                                                                                        if (resolvedListId) {
                                                                                            setFocusedListId(resolvedListId);
                                                                                            setFocusedFieldKey(fieldKey);
                                                                                            setFocusedInputValue(entry.details[df.key] || "");
                                                                                        }
                                                                                    }}
                                                                                    onBlur={e => {
                                                                                        handleServiceDetailBlur(svc.key, df.key, e.target.value);
                                                                                        setTimeout(() => {
                                                                                            setFocusedListId(null);
                                                                                            setFocusedFieldKey(null);
                                                                                        }, 250);
                                                                                    }}
                                                                                />
                                                                                {focusedListId === resolvedListId && focusedFieldKey === fieldKey && suggestions.length > 0 && (
                                                                                    <div className="suggestion-dropdown scrollbar-thin">
                                                                                        {suggestions.map((item, sidx) => (
                                                                                            <button
                                                                                                key={sidx}
                                                                                                type="button"
                                                                                                onMouseDown={() => {
                                                                                                    setServiceDetail(svc.key, df.key, item.name);
                                                                                                }}
                                                                                                className="suggestion-item"
                                                                                            >
                                                                                                <span className="font-bold truncate text-right flex-1">{item.name}</span>
                                                                                                <div className="flex items-center gap-1.5 shrink-0" dir="ltr">
                                                                                                    {item.price && (
                                                                                                        <span className="suggestion-price">{Number(item.price).toLocaleString()} د.ع</span>
                                                                                                    )}
                                                                                                    {item.serial && (
                                                                                                        <span className="suggestion-serial">{item.serial}</span>
                                                                                                    )}
                                                                                                </div>
                                                                                            </button>
                                                                                        ))}
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {activeServicesList.map((svc, idx) => {
                                        const entry = services[svc.key];
                                        return (
                                            <div key={svc.key} className={`rounded-xl border transition-colors ${entry.status === 'يحتاج تغيير' ? 'border-rose-500/40 bg-rose-950/10' : entry.status === 'جيد' ? 'border-emerald-500/30 bg-emerald-950/10' : 'border-border bg-background/40'}`}>
                                                <div className="flex flex-wrap items-center gap-3 p-3">
                                                    {/* Row number + name */}
                                                    <span className="text-xs font-mono text-muted-foreground w-5 text-center">{idx + 1}</span>
                                                    <span className="font-bold text-sm flex-1 min-w-[140px]">{svc.label}</span>

                                                    {/* Status buttons */}
                                                    <div className="flex gap-2">
                                                        <button onClick={() => setServiceStatus(svc.key, "جيد")}
                                                            className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all ${entry.status === "جيد" ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-muted border-border hover:border-emerald-500/50'}`}>
                                                            جيد ✓
                                                        </button>
                                                        <button onClick={() => setServiceStatus(svc.key, "يحتاج تغيير")}
                                                            className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all ${entry.status === "يحتاج تغيير" ? 'bg-rose-600 border-rose-500 text-white' : 'bg-muted border-border hover:border-rose-500/50'}`}>
                                                            يحتاج تغيير
                                                        </button>
                                                    </div>

                                                    {/* Price field */}
                                                    <div className="flex items-center gap-1">
                                                        <input
                                                            type="text" inputMode="numeric"
                                                            placeholder="السعر"
                                                            className="input-field text-xs py-1.5 w-24 text-left"
                                                            dir="ltr"
                                                            value={withCommas(entry.price)}
                                                            onChange={e => setServicePrice(svc.key, digitsOnly(e.target.value))}
                                                        />
                                                        <span className="text-xs text-muted-foreground">د.ع</span>
                                                    </div>
                                                </div>

                                                {/* Expandable detail fields when يحتاج تغيير is selected */}
                                                {entry.status === "يحتاج تغيير" && (svc.detailFields.length > 0 || svc.key === 'additives' || svc.key === 'wipers') && (
                                                    <div className="flex flex-wrap gap-2 px-4 pb-3 pr-10 border-t border-border/50 pt-3">
                                                        {(svc.key === 'additives' || svc.key === 'wipers') ? (
                                                            <div className="flex flex-col gap-2 w-full">
                                                                {(Object.keys(entry.details).filter(k => k.startsWith('prod_')).length === 0 ? ['prod_1'] : Object.keys(entry.details).filter(k => k.startsWith('prod_'))).map((k, i) => {
                                                                    const priceKey = k.replace('prod_', 'price_');
                                                                    return (
                                                                        <div key={k} className="flex items-center gap-2">
                                                                            <div className="relative flex-1">
                                                                                <input
                                                                                    type="text"
                                                                                    placeholder={`اسم المنتج ${i + 1}`}
                                                                                    className="input-field text-xs py-1.5 w-full"
                                                                                    value={entry.details[k] || ""}
                                                                                    onChange={e => {
                                                                                        setServiceDetail(svc.key, k, e.target.value);
                                                                                        setFocusedInputValue(e.target.value);
                                                                                    }}
                                                                                    onFocus={() => {
                                                                                        setFocusedListId("materials");
                                                                                        setFocusedFieldKey(svc.key + "_" + k);
                                                                                        setFocusedInputValue(entry.details[k] || "");
                                                                                    }}
                                                                                    onBlur={e => {
                                                                                        handleServiceDetailBlur(svc.key, k, e.target.value);
                                                                                        setTimeout(() => {
                                                                                            setFocusedListId(null);
                                                                                            setFocusedFieldKey(null);
                                                                                        }, 250);
                                                                                    }}
                                                                                />
                                                                                {focusedListId === "materials" && focusedFieldKey === (svc.key + "_" + k) && getFilteredSuggestions().length > 0 && (
                                                                                    <div className="suggestion-dropdown scrollbar-thin">
                                                                                        {getFilteredSuggestions().map((item, sidx) => (
                                                                                            <button
                                                                                                key={sidx}
                                                                                                type="button"
                                                                                                onMouseDown={() => {
                                                                                                    setServiceDetail(svc.key, k, item.name);
                                                                                                    if (item.price) {
                                                                                                        setServiceDetail(svc.key, priceKey, item.price);
                                                                                                        setTimeout(() => {
                                                                                                            setServices(prev => {
                                                                                                                const svcData = prev[svc.key];
                                                                                                                const details = { ...svcData.details, [priceKey]: item.price, [k]: item.name };
                                                                                                                const sum = sumMultiProduct(details);
                                                                                                                return { ...prev, [svc.key]: { ...svcData, details, price: sum > 0 ? String(sum) : "" } };
                                                                                                            });
                                                                                                        }, 50);
                                                                                                    }
                                                                                                }}
                                                                                                className="suggestion-item"
                                                                                            >
                                                                                                <span className="font-bold truncate text-right flex-1">{item.name}</span>
                                                                                                <div className="flex items-center gap-1.5 shrink-0" dir="ltr">
                                                                                                    {item.price && (
                                                                                                        <span className="suggestion-price">{Number(item.price).toLocaleString()} د.ع</span>
                                                                                                    )}
                                                                                                    {item.serial && (
                                                                                                        <span className="suggestion-serial">{item.serial}</span>
                                                                                                    )}
                                                                                                </div>
                                                                                            </button>
                                                                                        ))}
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                            <div className="flex items-center gap-1 w-24">
                                                                                <input
                                                                                    type="text"
                                                                                    placeholder="ملاحظات"
                                                                                    className="input-field text-xs py-1.5 w-full text-right"
                                                                                    value={entry.details[`notes_${k}`] || ""}
                                                                                    onChange={e => setServiceDetail(svc.key, `notes_${k}`, e.target.value)}
                                                                                />
                                                                            </div>
                                                                            <div className="flex items-center gap-1 w-16">
                                                                                <input
                                                                                    type="text" inputMode="numeric"
                                                                                    placeholder="العدد"
                                                                                    className="input-field text-xs py-1.5 w-full text-center"
                                                                                    dir="ltr"
                                                                                    value={entry.details[k.replace('prod_', 'qty_')] || ""}
                                                                                    onChange={e => setServiceDetail(svc.key, k.replace('prod_', 'qty_'), digitsOnly(e.target.value))}
                                                                                />
                                                                            </div>
                                                                            <div className="flex items-center gap-1 w-24">
                                                                                <input
                                                                                    type="text" inputMode="numeric"
                                                                                    placeholder="سعر الوحدة"
                                                                                    className="input-field text-xs py-1.5 w-full text-left"
                                                                                    dir="ltr"
                                                                                    value={withCommas(entry.details[priceKey] || "")}
                                                                                    onChange={e => {
                                                                                        setServiceDetail(svc.key, priceKey, digitsOnly(e.target.value));
                                                                                        setTimeout(() => {
                                                                                            setServices(prev => {
                                                                                                const svcData = prev[svc.key];
                                                                                                const details = svcData.details;
                                                                                                const sum = sumMultiProduct(details);
                                                                                                return { ...prev, [svc.key]: { ...svcData, price: sum > 0 ? String(sum) : "" } };
                                                                                            });
                                                                                        }, 50);
                                                                                    }}
                                                                                />
                                                                            </div>
                                                                            {i > 0 && (
                                                                                <button type="button" onClick={() => {
                                                                                    const newDetails = {...entry.details};
                                                                                    delete newDetails[k];
                                                                                    delete newDetails[priceKey];
                                                                                    delete newDetails[k.replace('prod_', 'qty_')];
                                                                                    const sum = sumMultiProduct(newDetails);
                                                                                    setServices(prev => ({...prev, [svc.key]: {...prev[svc.key], details: newDetails, price: sum > 0 ? String(sum) : ""}}));
                                                                                }} className="text-rose-500 hover:bg-rose-500/10 p-1.5 rounded-lg">✕</button>
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })}
                                                                <button 
                                                                    type="button" 
                                                                    onClick={() => setServiceDetail(svc.key, `prod_${Date.now()}`, '')}
                                                                    className="text-xs text-rose-500 font-bold border border-rose-500/30 rounded-lg py-1.5 hover:bg-rose-500/10 transition-colors w-max px-3"
                                                                >
                                                                    + منتج آخر
                                                                </button>
                                                            </div>
                                                        ) : [...svc.detailFields, ...priceFields(svc)].map(df => {
                                                            if (df.key === 'size') {
                                                                return (
                                                                    <select 
                                                                        key={df.key} 
                                                                        className="input-field text-xs py-1.5 flex-1 min-w-[120px]"
                                                                        value={entry.details[df.key] || ""}
                                                                        onChange={e => setServiceDetail(svc.key, df.key, e.target.value)}
                                                                    >
                                                                        <option value="">اختر الحجم</option>
                                                                        <option value="دبة 1 لتر">دبة 1 لتر</option>
                                                                        <option value="دبة 4 لتر">دبة 4 لتر</option>
                                                                    </select>
                                                                );
                                                            }
                                                            const resolvedListId = !isSectorBranch && df.listId && df.listId !== 'technicianNames' && df.listId !== 'supervisorNames' && df.listId !== 'receptionistNames' && df.listId !== 'bayNumbers' ? "materials" : df.listId;
                                                            const fieldKey = svc.key + "_" + df.key;
                                                            const suggestions = (focusedListId === resolvedListId && focusedFieldKey === fieldKey) ? getFilteredSuggestions() : [];
                                                            return (
                                                                <div key={df.key} className="relative flex-1 min-w-[120px]">
                                                                    <input
                                                                        type={df.key === 'unitPrice' || df.key === 'qty' ? "number" : "text"}
                                                                        placeholder={df.label}
                                                                        className="input-field text-xs py-1.5 w-full"
                                                                        value={entry.details[df.key] || ""}
                                                                        onChange={e => {
                                                                            setServiceDetail(svc.key, df.key, e.target.value);
                                                                            if (resolvedListId) setFocusedInputValue(e.target.value);
                                                                        }}
                                                                        onFocus={() => {
                                                                            if (resolvedListId) {
                                                                                setFocusedListId(resolvedListId);
                                                                                setFocusedFieldKey(fieldKey);
                                                                                setFocusedInputValue(entry.details[df.key] || "");
                                                                            }
                                                                        }}
                                                                        onBlur={e => {
                                                                            handleServiceDetailBlur(svc.key, df.key, e.target.value);
                                                                            setTimeout(() => {
                                                                                setFocusedListId(null);
                                                                                setFocusedFieldKey(null);
                                                                            }, 250);
                                                                        }}
                                                                    />
                                                                    {focusedListId === resolvedListId && focusedFieldKey === fieldKey && suggestions.length > 0 && (
                                                                        <div className="suggestion-dropdown scrollbar-thin">
                                                                            {suggestions.map((item, sidx) => (
                                                                                <button
                                                                                    key={sidx}
                                                                                    type="button"
                                                                                    onMouseDown={() => {
                                                                                        setServiceDetail(svc.key, df.key, item.name);
                                                                                    }}
                                                                                    className="suggestion-item"
                                                                                >
                                                                                    <span className="font-bold truncate text-right flex-1">{item.name}</span>
                                                                                    <div className="flex items-center gap-1.5 shrink-0" dir="ltr">
                                                                                        {item.price && (
                                                                                            <span className="suggestion-price">{Number(item.price).toLocaleString()} د.ع</span>
                                                                                        )}
                                                                                        {item.serial && (
                                                                                            <span className="suggestion-serial">{item.serial}</span>
                                                                                        )}
                                                                                    </div>
                                                                                </button>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Maintenance Events (أحداث الصيانة - previously Custom Services) */}
                        <div className="rounded-xl border border-border bg-background/40">
                            <div className="flex flex-wrap items-center justify-between gap-3 p-3">
                                <div className="flex items-center gap-3">
                                    <span className="text-xs font-mono text-muted-foreground w-5 text-center">
                                        {isSectorBranch 
                                            ? SECTOR_BRANCH_SERVICES.reduce((acc, s) => acc + s.items.length, 0) + 1
                                            : MAIN_SERVICES.length + 1
                                        }
                                    </span>
                                    <span className="font-bold text-sm min-w-[140px]">أحداث الصيانة (خدمات إضافية)</span>
                                </div>
                                {customServices.length === 0 && (
                                    <button
                                        type="button"
                                        onClick={addCustomService}
                                        className="flex items-center gap-1.5 px-3 py-1.5 border border-rose-500/30 text-rose-500 hover:bg-rose-600 hover:text-white hover:border-rose-600 text-xs font-bold rounded-lg transition-all"
                                    >
                                        <span className="text-base leading-none">+</span> إضافة حدث صيانة
                                    </button>
                                )}
                            </div>

                            {customServices.length > 0 && (
                                <div className="px-4 pb-3 pr-[3.25rem] border-t border-border/50 pt-3 space-y-3">
                                    {customServices.map((cs, idx) => (
                                        <div key={cs.id} className="flex flex-wrap items-center gap-3">
                                            <input
                                                type="text"
                                                placeholder="النوع / الصنف..."
                                                list="customServicesList"
                                                value={cs.label}
                                                onChange={e => setCustomSvcField(cs.id, 'label', e.target.value)}
                                                className="input-field text-xs py-1.5 flex-1 min-w-[120px]"
                                            />

                                            <input
                                                type="text" inputMode="numeric"
                                                placeholder="الكمية"
                                                value={withCommas((cs as any).qty || "")}
                                                onChange={e => setCustomSvcField(cs.id, 'qty', digitsOnly(e.target.value))}
                                                className="input-field text-xs py-1.5 w-24 text-center"
                                                min="1"
                                            />

                                            <input
                                                type="text"
                                                placeholder="ملاحظات..."
                                                value={(cs as any).notes || ""}
                                                onChange={e => setCustomSvcField(cs.id, 'notes', e.target.value)}
                                                className="input-field text-xs py-1.5 flex-1 min-w-[120px]"
                                            />

                                            <div className="flex items-center gap-1">
                                                <input
                                                    type="text" inputMode="numeric"
                                                    placeholder="السعر"
                                                    value={withCommas(cs.price)}
                                                    onChange={e => setCustomSvcField(cs.id, 'price', digitsOnly(e.target.value))}
                                                    className="input-field text-xs py-1.5 w-24 text-left"
                                                    dir="ltr"
                                                />
                                                <span className="text-xs text-muted-foreground">د.ع</span>
                                            </div>
                                            <button type="button" onClick={() => removeCustomService(cs.id)}
                                                className="p-1.5 text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors">
                                                ✕
                                            </button>
                                        </div>
                                    ))}
                                    
                                    <div className="pt-2">
                                        <button
                                            type="button"
                                            onClick={addCustomService}
                                            className="flex items-center gap-1.5 px-3 py-1.5 border border-rose-500/30 text-rose-500 hover:bg-rose-600 hover:text-white hover:border-rose-600 text-xs font-bold rounded-lg transition-all"
                                        >
                                            <span className="text-base leading-none">+</span> إضافة حدث صيانة آخر
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {isIndustrialBranch && (
                            <div className="rounded-xl border border-border bg-background/40 p-4 mt-4">
                                <label className="text-sm font-bold text-rose-400 mb-2 block">ملاحظات الصيانة:</label>
                                <textarea
                                    className="input-field h-20 py-3 bg-background w-full text-xs"
                                    placeholder="اكتب ملاحظات الصيانة هنا..."
                                    value={notes}
                                    onChange={e => setNotes(e.target.value)}
                                />
                            </div>
                        )}
                    </div>

                    <div className="flex justify-between items-center max-w-5xl mx-auto">
                        <button onClick={() => setStep(1)} className="px-6 py-3 rounded-xl bg-muted text-foreground font-bold hover:bg-muted transition-colors flex items-center gap-2">
                            <ArrowRight size={20} /> رجوع
                        </button>
                        <button onClick={handleNextStep2} className="px-8 py-3 rounded-xl bg-rose-600 text-white font-bold hover:bg-rose-500 transition-colors flex items-center gap-2 shadow-lg shadow-rose-500/20">
                            مراجعة وحفظ <ArrowLeft size={20} />
                        </button>
                    </div>
                </div>
            )}

            {/* ===== STEP 3: Review & Pricing ===== */}
            {step === 3 && !createdWorkOrderId && (
                <div className="space-y-6 animate-fade-in-up">
                    <div className="glass-card p-4 sm:p-8 rounded-3xl border border-rose-500/30 max-w-2xl mx-auto space-y-6">
                        <h2 className="text-2xl font-display font-bold text-foreground text-center border-b border-border pb-4">مراجعة والتسعير</h2>

                        {/* Summary */}
                        <div className="bg-background/40 rounded-2xl p-5 border border-border space-y-3">
                            <h3 className="text-muted-foreground text-sm font-bold">ملخص</h3>
                            <div className="flex justify-between text-sm"><span className="text-muted-foreground">العميل</span><span className="font-bold">{name}</span></div>
                            <div className="flex justify-between text-sm"><span className="text-muted-foreground">السيارة</span><span className="font-bold">{make} {model} ({plateNumber})</span></div>
                            {contractId && (
                                <div className="flex justify-between text-sm"><span className="text-muted-foreground">جهة التعاقد</span><span className="font-bold text-amber-400">عقد {contracts.find(c => c.id === contractId)?.name || ""} (آجل)</span></div>
                            )}
                            {driverRoute.trim() !== "" && (
                                <div className="flex justify-between text-sm"><span className="text-muted-foreground">خط السائق</span><span className="font-bold">{driverRoute}</span></div>
                            )}
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">الخدمات المحتاجة للتغيير</span>
                                <span className="font-bold text-rose-400">
                                    {Object.values(services).filter(s => s.status === "يحتاج تغيير").length} خدمة
                                </span>
                            </div>
                        </div>

                        {/* Notes, Bay, and Shift */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-bold text-rose-400 mb-2 block">رقم الخانة (الموقف):</label>
                                <input
                                    type="text"
                                    list="bay-number-list"
                                    className="input-field bg-background text-lg font-bold"
                                    placeholder="مثال: الخانة 1..."
                                    value={bayNumber}
                                    onChange={e => setBayNumber(e.target.value)}
                                />
                                <datalist id="bay-number-list">
                                    {(suggestionLists.bayNumbers || []).map((b, i) => (
                                        <option key={i} value={typeof b === 'object' && b !== null ? b.name : b} />
                                    ))}
                                </datalist>
                            </div>
                            <div>
                                <label className="text-sm font-bold text-rose-400 mb-2 block">ملاحظات إضافية:</label>
                                <textarea className="input-field h-12 py-3 bg-background" placeholder="ملاحظات للفاتورة..." value={notes} onChange={e => setNotes(e.target.value)} />
                            </div>
                            <div>
                                <label className="text-sm font-bold text-rose-400 mb-2 block">الشفت (الوردية):</label>
                                <select className="input-field bg-background text-lg font-bold" value={shiftName} onChange={e => setShiftName(e.target.value)}>
                                    <option value="">اختيار الشفت...</option>
                                    <option value="صباحي">صباحي</option>
                                    <option value="مسائي">مسائي</option>
                                    <option value="ليلي">ليلي</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-sm font-bold text-rose-400 mb-2 block">مشرف الشفت:</label>
                                <input
                                    type="text"
                                    list="supervisor-names-list"
                                    className="input-field bg-background text-lg font-bold"
                                    placeholder="اسم المشرف..."
                                    value={shiftSupervisor}
                                    onChange={e => setShiftSupervisor(e.target.value)}
                                />
                                <datalist id="supervisor-names-list">
                                    {(suggestionLists.supervisorNames || []).map((s, i) => (
                                        <option key={i} value={typeof s === 'object' && s !== null ? s.name : s} />
                                    ))}
                                </datalist>
                            </div>
                        </div>

                        {/* Pricing */}
                        <div className="bg-rose-950/20 border border-rose-900/30 p-5 rounded-xl space-y-3">
                            <h3 className="text-sm font-bold text-rose-300 mb-3">الأسعار</h3>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div>
                                    <label className="text-xs text-muted-foreground block mb-1">المجموع الكلي (د.ع)</label>
                                    <input type="text" inputMode="numeric" className="input-field bg-background text-lg font-bold" placeholder="0" value={withCommas(totalPrice)} onChange={e => setTotalPrice(digitsOnly(e.target.value))} disabled />
                                </div>
                                <div>
                                    <label className="text-xs text-rose-400 font-bold block mb-1">الخصم (د.ع)</label>
                                    <input type="text" inputMode="numeric" className="input-field bg-rose-950/30 text-rose-300 font-bold border-rose-500/30" placeholder="0" value={withCommas(discount)} onChange={e => setDiscount(digitsOnly(e.target.value))} />
                                </div>
                                <div>
                                    <label className="text-xs text-muted-foreground block mb-1">الواصل (د.ع)</label>
                                    <input type="text" inputMode="numeric" className="input-field bg-background text-lg" placeholder="0" value={withCommas(amountReceived)} onChange={e => setAmountReceived(digitsOnly(e.target.value))} />
                                </div>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-col md:flex-row gap-3 justify-center pt-2">
                            <button onClick={() => setStep(2)} className="px-6 py-3 rounded-xl bg-muted text-foreground font-bold hover:bg-muted/80 transition-colors font-ibm">
                                رجوع للتعديل
                            </button>
                            <button onClick={handleSaveOnly} disabled={loading} className="px-6 py-3 rounded-xl bg-muted border border-border text-muted-foreground font-bold hover:bg-muted/80 flex items-center justify-center gap-2 font-ibm">
                                {loading ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
                                حفظ فقط
                            </button>
                            <button onClick={handleSaveDraft} disabled={loading} className="px-6 py-3 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-300 font-bold hover:bg-blue-600/30 flex items-center justify-center gap-2 font-ibm">
                                {loading ? <Loader2 className="animate-spin" size={20} /> : <Printer size={20} />}
                                حفظ وطباعة / مسودة
                            </button>
                            <button onClick={handleStartWorkOrder} disabled={loading} className="px-8 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-bold hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] transition-all flex items-center justify-center gap-2 font-ibm">
                                {loading ? <Loader2 className="animate-spin" size={20} /> : <Play size={20} />}
                                تسليم للورشة
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ===== SUCCESS SCREEN ===== */}
            {step === 3 && createdWorkOrderId && (
                <div className="glass-card p-10 rounded-3xl border border-emerald-500/30 text-center animate-scale-in">
                    <div className="w-24 h-24 bg-emerald-500/10 rounded-full mx-auto flex items-center justify-center mb-6">
                        <CheckCircle2 className="text-emerald-500" size={48} />
                    </div>
                    <h2 className="text-3xl font-display font-bold text-foreground mb-2">تم إنشاء أمر العمل!</h2>
                    <p className="text-muted-foreground mb-8">رقم الطلب: <span className="text-foreground font-mono bg-muted px-3 py-1 rounded-lg">#{reportNumber}</span></p>
                    <div className="flex flex-col sm:flex-row justify-center gap-4">
                        <button onClick={() => { setPreviewReportId(createdWorkOrderId); setPreviewMode('full'); }}
                            className="px-6 py-3 rounded-xl bg-blue-600/20 text-blue-500 font-bold hover:bg-blue-600/30 transition-colors flex items-center justify-center gap-2">
                            <Printer size={20} /> طباعة للعميل (شامل)
                        </button>
                        <button onClick={() => { setPreviewReportId(createdWorkOrderId); setPreviewMode('short'); }}
                            className="px-6 py-3 rounded-xl bg-amber-600/20 text-amber-500 font-bold hover:bg-amber-600/30 transition-colors flex items-center justify-center gap-2">
                            <Printer size={20} /> طباعة للفني (مختصر)
                        </button>
                        <a href={`/work-orders/${createdWorkOrderId}`}
                            className="px-8 py-3 rounded-xl bg-rose-600 text-white font-bold hover:bg-rose-500 transition-all flex items-center justify-center gap-2">
                            متابعة المركبة أونلاين <ArrowLeft size={20} />
                        </a>
                    </div>
                    <div className="mt-8 pt-8 border-t border-border">
                        <button onClick={() => resetWizard()} className="text-muted-foreground hover:text-foreground transition-colors text-sm font-bold">
                            + إنشاء أمر عمل جديد
                        </button>
                    </div>
                </div>
            )}



            <datalist id="customServicesList">
                {suggestionLists["materials"] && suggestionLists["materials"].length > 0 ? (
                    suggestionLists["materials"].map((item: any, idx: number) => (
                        <option key={idx} value={typeof item === 'object' && item !== null ? item.name : item} />
                    ))
                ) : (
                    <>
                        <option value="فحص شامل (كمبيوتر)" />
                        <option value="تنظيف البخاخات" />
                        <option value="تبديل بواجي (شمعات)" />
                        <option value="ميزانية وتويتر إطارات" />
                        <option value="غسيل راديتر" />
                        <option value="تبديل سفايف (بريكات)" />
                        <option value="شحن غاز تبريد" />
                        <option value="تبديل بطارية" />
                    </>
                )}
            </datalist>

            {branchChangePending && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fade-in font-ibm">
                    <div className="bg-card border border-rose-900/30 rounded-3xl p-6 max-w-md w-full shadow-[0_0_50px_rgba(244,63,94,0.15)] animate-scale-in text-center space-y-6" dir="rtl">
                        {/* Glowing Alert Icon */}
                        <div className="w-16 h-16 bg-rose-500/10 border border-rose-500/30 rounded-full flex items-center justify-center mx-auto shadow-[0_0_20px_rgba(244,63,94,0.2)]">
                            <AlertCircle className="text-rose-500 w-8 h-8 animate-pulse" />
                        </div>
                        
                        <div className="space-y-2">
                            <h3 className="text-xl font-bold text-foreground">تغيير الفرع الحالي</h3>
                            <p className="text-sm text-muted-foreground leading-relaxed">
                                سيتم مسح جميع البيانات التي قمت بإدخالها والبدء من جديد عند تبديل الفرع. هل أنت متأكد من الاستمرار؟
                            </p>
                        </div>
                        
                        <div className="flex gap-3 justify-center pt-2">
                            <button
                                onClick={() => {
                                    resetWizard(branchChangePending);
                                    setBranchChangePending(null);
                                }}
                                className="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl transition-all shadow-lg hover:shadow-rose-600/20 w-1/2"
                            >
                                نعم، تبديل ومسح
                            </button>
                            <button
                                onClick={() => setBranchChangePending(null)}
                                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-foreground border border-slate-700 font-bold rounded-xl transition-all w-1/2"
                            >
                                إلغاء
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {previewReportId && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 z-[9998] bg-black/80 backdrop-blur-sm"
                        onClick={() => setPreviewReportId(null)}
                    />
                    {/* Outer: grid centering — no transform conflict */}
                    <div
                        className="fixed inset-0 z-[9999] font-ibm"
                        style={{ display: 'grid', alignItems: 'start', justifyItems: 'center', padding: '16px', paddingTop: '24px' }}
                    >
                        {/* Inner card: animate here only, not on the centering wrapper */}
                        <div
                            className="bg-card border border-cyan-900/30 rounded-3xl shadow-[0_0_60px_rgba(6,182,212,0.15)] animate-scale-in flex flex-col overflow-hidden w-full"
                            style={{ maxHeight: '90vh', maxWidth: '900px' }}
                            dir="rtl"
                        >
                            {/* ── Header — wraps on mobile so the close (X) is always reachable ── */}
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

                            {/* ── Scrollable document preview ── */}
                            <div className="flex-1 overflow-auto bg-neutral-950/60 p-4 flex justify-center items-start min-h-0">
                                {previewLoading ? (
                                    <div className="flex flex-col items-center justify-center gap-3 py-20">
                                        <Loader2 className="animate-spin text-cyan-500 w-10 h-10" />
                                        <p className="text-sm text-muted-foreground">جاري تحميل تفاصيل الفاتورة...</p>
                                    </div>
                                ) : previewReport ? (
                                    <div
                                        className="bg-white rounded-2xl shadow-2xl print-preview-doc"
                                        style={{ zoom: '0.68', minWidth: '800px', transformOrigin: 'top center' }}
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
