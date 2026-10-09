"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
    FileSpreadsheet, Plus, Trash2, Save, Search, X,
    Droplets, Thermometer, Filter, Battery, Cog, ChevronDown, ChevronUp, Check, Loader2,
    Shield, Wrench, Activity, UserCircle
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { showSuccess, showError } from "@/lib/alerts";
import { useAuth } from "@/lib/AuthProvider";
import * as XLSX from "xlsx";
import Swal from "sweetalert2";
// ─── Default Lists (empty to avoid populating mock data) ───
const DEFAULT_LISTS: Record<string, string[]> = {
    materials: [], // Unified list
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
    supervisorNames: [],
    receptionistNames: [],
    bayNumbers: []
};

// ─── Visual Groupings ───
const ORIGINAL_GROUPS = [
    {
        id: "engine",
        name: "المحرك والسوائل",
        icon: <Droplets size={18} />,
        categories: [
            { key: "oilBrands", label: "أنواع زيوت المحرك", icon: <Droplets size={16} />, color: "emerald" },
            { key: "viscosities", label: "درجات اللزوجة", icon: <Thermometer size={16} />, color: "blue" },
            { key: "brakeFluids", label: "أنواع زيت الفرامل", icon: <Droplets size={16} />, color: "rose" },
            { key: "coolants", label: "أنواع ماء الراديتر/التبريد", icon: <Thermometer size={16} />, color: "cyan" },
        ]
    },
    {
        id: "filters",
        name: "الفلاتر",
        icon: <Filter size={18} />,
        categories: [
            { key: "oilFilterBrands", label: "ماركات فلاتر زيت المحرك", icon: <Filter size={16} />, color: "amber" },
            { key: "oilFilterCodes", label: "أكواد فلاتر زيت المحرك", icon: <Filter size={16} />, color: "amber" },
            { key: "airFilterBrands", label: "ماركات فلاتر الهواء", icon: <Filter size={16} />, color: "amber" },
            { key: "airFilterCodes", label: "أكواد فلاتر الهواء", icon: <Filter size={16} />, color: "amber" },
            { key: "acFilterBrands", label: "ماركات فلاتر التبريد", icon: <Filter size={16} />, color: "amber" },
            { key: "acFilterCodes", label: "أكواد فلاتر التبريد", icon: <Filter size={16} />, color: "amber" },
            { key: "gearboxFilterBrands", label: "ماركات فلاتر الكير", icon: <Filter size={16} />, color: "amber" },
            { key: "gearboxFilterCodes", label: "أكواد فلاتر الكير", icon: <Filter size={16} />, color: "amber" },
            { key: "batteryFilterBrands", label: "ماركات فلاتر البطارية", icon: <Filter size={16} />, color: "yellow" },
        ]
    },
    {
        id: "gearbox",
        name: "الكير والناقل",
        icon: <Cog size={18} />,
        categories: [
            { key: "gearboxOils", label: "زيوت الكير والهايدروليك", icon: <Cog size={16} />, color: "cyan" },
        ]
    },
    {
        id: "cleaners",
        name: "المنظفات والمضافات",
        icon: <Cog size={18} />,
        categories: [
            { key: "engineFlashBrands", label: "فلاش المحرك", icon: <Cog size={16} />, color: "rose" },
            { key: "engineCeramicBrands", label: "سيراميك المحرك", icon: <Cog size={16} />, color: "rose" },
            { key: "linerCleanerBrands", label: "منظف بطانة (جكجكة)", icon: <Cog size={16} />, color: "rose" },
            { key: "oilLeakPreventerBrands", label: "مانع تسريب زيت", icon: <Cog size={16} />, color: "rose" },
            { key: "smokePreventerBrands", label: "مانع دخان / نقص زيت", icon: <Cog size={16} />, color: "rose" },
            { key: "gearboxFlashBrands", label: "فلاش الكير", icon: <Cog size={16} />, color: "rose" },
            { key: "gearboxCeramicBrands", label: "سيراميك الكير", icon: <Cog size={16} />, color: "rose" },
            { key: "gearboxAntiSlipBrands", label: "مانع انزلاق الكير", icon: <Cog size={16} />, color: "rose" },
            { key: "acCleanerBrands", label: "منظف دورة التبريد والمكيف", icon: <Cog size={16} />, color: "rose" },
            { key: "injectorCleanerBrands", label: "منظف البخاخات", icon: <Cog size={16} />, color: "rose" },
            { key: "fuelSystemCleanerBrands", label: "منظف نظام الوقود", icon: <Cog size={16} />, color: "rose" },
            { key: "octaneBoosterBrands", label: "محسنات الأوكتان", icon: <Cog size={16} />, color: "rose" },
        ]
    },
    {
        id: "essentials",
        name: "الاستهلاكيات والأساسيات",
        icon: <Battery size={18} />,
        categories: [
            { key: "batteries", label: "أنواع البطاريات والسعة", icon: <Battery size={16} />, color: "yellow" },
            { key: "wiperBrands", label: "ماركات المساحات", icon: <Cog size={16} />, color: "blue" },
            { key: "wiperSizes", label: "مقاسات المساحات", icon: <Cog size={16} />, color: "blue" },
            { key: "engineBeltsBrands", label: "قوايش المحرك", icon: <Cog size={16} />, color: "emerald" },
            { key: "brakePadsBrands", label: "دسكات السيارة/الفرامل", icon: <Cog size={16} />, color: "rose" },
            { key: "sparkPlugsBrands", label: "شمعات الاحتراق/البواجي", icon: <Cog size={16} />, color: "purple" },
            { key: "windshieldFluids", label: "سائل غسيل جام", icon: <Cog size={16} />, color: "cyan" },
        ]
    }
];

const STAFF_GROUP = {
    id: "staff",
    name: "طاقم العمل والورشة",
    icon: <Wrench size={18} />,
    categories: [
        { key: "technicianNames", label: "أسماء الفنيين", icon: <Wrench size={16} />, color: "blue" },
        { key: "supervisorNames", label: "أسماء المشرفين", icon: <Shield size={16} />, color: "rose" },
        // Reception staff are picked by name from this list, so a receptionist no
        // longer needs a login account just to appear on a work order.
        { key: "receptionistNames", label: "أسماء موظفي الاستقبال", icon: <UserCircle size={16} />, color: "amber" },
        { key: "bayNumbers", label: "أرقام الخانات", icon: <Activity size={16} />, color: "emerald" },
    ]
};

const UNIFIED_GROUP = {
    id: "unified",
    name: "المواد والقطع",
    icon: <Droplets size={18} />,
    categories: [
        { key: "materials", label: "قائمة المواد والقطع الموحدة", icon: <Droplets size={16} />, color: "emerald" }
    ]
};

const CATEGORY_META = [
    ...ORIGINAL_GROUPS.flatMap(g => g.categories),
    ...UNIFIED_GROUP.categories,
    ...STAFF_GROUP.categories
];

// Color utilities
const colorClasses: Record<string, { bg: string; border: string; text: string; badge: string; ring: string }> = {
    emerald: { bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-500", badge: "bg-emerald-500/20 text-emerald-400", ring: "ring-emerald-500/30" },
    blue: { bg: "bg-blue-500/10", border: "border-blue-500/30", text: "text-blue-500", badge: "bg-blue-500/20 text-blue-400", ring: "ring-blue-500/30" },
    amber: { bg: "bg-amber-500/10", border: "border-amber-500/30", text: "text-amber-500", badge: "bg-amber-500/20 text-amber-400", ring: "ring-amber-500/30" },
    purple: { bg: "bg-purple-500/10", border: "border-purple-500/30", text: "text-purple-500", badge: "bg-purple-500/20 text-purple-400", ring: "ring-purple-500/30" },
    yellow: { bg: "bg-yellow-500/10", border: "border-yellow-500/30", text: "text-yellow-500", badge: "bg-yellow-500/20 text-yellow-400", ring: "ring-yellow-500/30" },
    rose: { bg: "bg-rose-500/10", border: "border-rose-500/30", text: "text-rose-500", badge: "bg-rose-500/20 text-rose-400", ring: "ring-rose-500/30" },
    cyan: { bg: "bg-cyan-500/10", border: "border-cyan-500/30", text: "text-cyan-500", badge: "bg-cyan-500/20 text-cyan-400", ring: "ring-cyan-500/30" },
};

interface SuggestionItem {
    name: string;
    price: string;
    serial?: string;
}

const INITIAL_LISTS: Record<string, SuggestionItem[]> = {};
for (const key of Object.keys(DEFAULT_LISTS)) {
    INITIAL_LISTS[key] = DEFAULT_LISTS[key].map(name => ({ name, price: "", serial: "" }));
}

export default function SuggestionsPage() {
    const [lists, setLists] = useState<Record<string, SuggestionItem[]>>(INITIAL_LISTS);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    
    // Suggestion inputs and editing
    const [newItemNames, setNewItemNames] = useState<Record<string, string>>({});
    const [newItemPrices, setNewItemPrices] = useState<Record<string, string>>({});
    const [newItemSerials, setNewItemSerials] = useState<Record<string, string>>({});
    const [editingItem, setEditingItem] = useState<{ categoryKey: string; index: number; name: string; price: string; serial: string } | null>(null);

    const [searchQuery, setSearchQuery] = useState("");
    const [hasChanges, setHasChanges] = useState(false);

    // Branch state parameters
    const [branches, setBranches] = useState<{id: string, name: string}[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState("");
    // The branch whose lists are actually on screen. Saving upserts every list into
    // selectedBranchId, so it is only allowed once that branch's own lists loaded —
    // never while loading, after a failed load, or with another branch's lists.
    const [loadedBranchId, setLoadedBranchId] = useState("");
    const canSave = !!selectedBranchId && loadedBranchId === selectedBranchId;
    const { employeeBranchId, employeeRole } = useAuth();

    // Fetch branches list
    useEffect(() => {
        const fetchBranches = async () => {
            const { data } = await supabase.from('branches').select('id, name');
            if (data && data.length > 0) {
                setBranches(data);
                setSelectedBranchId(employeeBranchId || data[0].id);
            }
        };
        fetchBranches();
    }, [employeeBranchId]);

    // Guards against a slow branch fetch resolving late and clobbering
    // whatever the user typed after switching branches.
    const fetchRequestIdRef = useRef(0);

    // Fetch suggestion lists from Supabase
    useEffect(() => {
        if (!selectedBranchId) return;

        const requestId = ++fetchRequestIdRef.current;
        const fetchSuggestions = async () => {
            setLoading(true);
            // Drop the previous branch's lists right away so they can neither show
            // under the new branch nor be saved into it if this load fails.
            setLoadedBranchId("");
            setLists(Object.fromEntries(Object.keys(DEFAULT_LISTS).map(k => [k, [] as SuggestionItem[]])));
            setHasChanges(false);
            try {
                const { data, error } = await (supabase as any)
                    .from('suggestion_lists')
                    .select('key, items')
                    .eq('branch_id', selectedBranchId);

                if (requestId !== fetchRequestIdRef.current) return; // stale response — ignore
                if (error) throw error;

                // Create a temporary object with default values
                const loadedLists: Record<string, SuggestionItem[]> = {};
                for (const key of Object.keys(DEFAULT_LISTS)) {
                    loadedLists[key] = [];
                }

                if (data && data.length > 0) {
                    data.forEach((row: any) => {
                        if (row.key && Array.isArray(row.items)) {
                            // Ensure each item has name, price, and serial
                            loadedLists[row.key] = row.items.map((item: any) => {
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
                        }
                    });
                }

                setLists(loadedLists);
                setLoadedBranchId(selectedBranchId);
                setHasChanges(false); // fresh branch data — nothing unsaved
            } catch (err) {
                console.error("Error loading suggestion lists from Supabase:", err);
                if (requestId === fetchRequestIdRef.current) {
                    showError("تعذّر التحميل", "تعذّر تحميل قوائم الاقتراحات لهذا الفرع، لذلك الحفظ معطّل. أعد تحميل الصفحة.");
                }
            } finally {
                if (requestId === fetchRequestIdRef.current) {
                    setLoading(false);
                }
            }
        };

        fetchSuggestions();
    }, [selectedBranchId]);

    const activeGroups = useMemo(() => {
        return [
            UNIFIED_GROUP,
            STAFF_GROUP
        ];
    }, [branches, selectedBranchId]);

    const activeCategoryMeta = useMemo(() => {
        return activeGroups.reduce((acc, g) => {
            return [...acc, ...g.categories];
        }, [] as { key: string; label: string; icon: React.ReactNode; color: string }[]);
    }, [activeGroups]);

    // Track active Group ID
    const [activeGroupId, setActiveGroupId] = useState<string>("engine");
    const [expandedCategory, setExpandedCategory] = useState<string | null>("oilBrands");

    // Automatically switch active tab if it's no longer available for this branch
    useEffect(() => {
        const exists = activeGroups.some(g => g.id === activeGroupId);
        if (!exists && activeGroups.length > 0) {
            setActiveGroupId(activeGroups[0].id);
        }
    }, [activeGroups, activeGroupId]);

    const handleAddItem = useCallback((categoryKey: string) => {
        const name = (newItemNames[categoryKey] || "").trim();
        const price = (newItemPrices[categoryKey] || "").trim();
        if (!name) return;
        
        const exists = lists[categoryKey]?.some(item => item.name.toLowerCase() === name.toLowerCase());
        if (exists) {
            showError("موجود مسبقاً", `"${name}" موجود بالفعل في القائمة!`);
            return;
        }

        // Auto-calculate serial number if it's not a staff category
        let serial = "";
        const isStaffCategory = ["technicianNames", "supervisorNames", "receptionistNames", "bayNumbers"].includes(categoryKey);
        if (!isStaffCategory) {
            const currentItems = lists[categoryKey] || [];
            const serialNums = currentItems
                .map(item => parseInt(item.serial || ""))
                .filter(num => !isNaN(num));
            const maxSerial = serialNums.length > 0 ? Math.max(...serialNums) : 0;
            serial = String(maxSerial + 1);
        }

        setLists(prev => ({
            ...prev,
            [categoryKey]: [...(prev[categoryKey] || []), { name, price, serial }]
        }));
        
        setNewItemNames(prev => ({ ...prev, [categoryKey]: "" }));
        setNewItemPrices(prev => ({ ...prev, [categoryKey]: "" }));
        setNewItemSerials(prev => ({ ...prev, [categoryKey]: "" }));
        setHasChanges(true);
    }, [newItemNames, newItemPrices, lists]);
    const handleRemoveItem = useCallback((categoryKey: string, index: number) => {
        setLists(prev => ({
            ...prev,
            [categoryKey]: prev[categoryKey].filter((_, i) => i !== index)
        }));
        setHasChanges(true);
    }, []);

    const handleSave = useCallback(async () => {
        if (!selectedBranchId) return;
        if (!canSave) {
            showError("لا يمكن الحفظ", "قوائم هذا الفرع لم تُحمَّل بعد. انتظر اكتمال التحميل أو أعد تحميل الصفحة.");
            return;
        }
        setSaving(true);
        try {
            // Write each list to Supabase
            const promises = Object.keys(lists).map(async key => {
                const label = CATEGORY_META.find(c => c.key === key)?.label || key;
                return (supabase as any).from("suggestion_lists").upsert({
                    branch_id: selectedBranchId,
                    key,
                    label,
                    items: lists[key],
                    updated_at: new Date().toISOString()
                });
            });

            const results = await Promise.all(promises);
            const error = results.find(r => r.error);
            if (error) throw error.error;

            setHasChanges(false);
            showSuccess("تم الحفظ في قاعدة البيانات ✅", "تم حفظ وتحديث جميع الاقتراحات بنجاح!");
        } catch (err) {
            console.error("Error saving to Supabase:", err);
            showError("خطأ في الحفظ", "تعذر حفظ البيانات في السيرفر. يرجى التحقق من اتصال الشبكة.");
        } finally {
            setSaving(false);
        }
    }, [lists, selectedBranchId, canSave]);

    const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>, categoryKey: string) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const bstr = evt.target?.result;
                const wb = XLSX.read(bstr, { type: "binary" });
                const wsname = wb.SheetNames[0];
                const ws = wb.Sheets[wsname];
                const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });

                // Auto-detect the name (and optional price) column + where data starts, so ANY
                // reasonable sheet works: the app's own export (المادة at col 8 / row 9) as well
                // as a plain list with the names in the first column.
                let nameCol = -1, priceCol = -1, startRow = 0;
                for (let i = 0; i < Math.min(data.length, 20); i++) {
                    const row = data[i] || [];
                    for (let c = 0; c < row.length; c++) {
                        const cell = String(row[c] ?? '').trim();
                        if (nameCol === -1 && /^(اسم|الاسم|المادة|الصنف|المنتج|name)/i.test(cell)) { nameCol = c; startRow = i + 1; }
                        if (priceCol === -1 && /(سعر|السعر|price|الكلفة|الثمن)/i.test(cell)) priceCol = c;
                    }
                    if (nameCol !== -1) break;
                }
                // No header row found → assume col A = name, col B = price, data from the first row.
                if (nameCol === -1) { nameCol = 0; if (priceCol === -1) priceCol = 1; startRow = 0; }

                const HEADER_WORDS = new Set(['المادة', 'اسم', 'الاسم', 'العدد', 'تـ', 'ت', 'السعر', 'سعر', 'name', 'price']);
                const newItems: {name: string, price: string}[] = [];
                for (let i = startRow; i < data.length; i++) {
                    const row = data[i];
                    if (!row) continue;
                    const name = String(row[nameCol] ?? '').trim();
                    if (!name || HEADER_WORDS.has(name)) continue; // skip empty / header cells
                    const price = priceCol >= 0 ? String(row[priceCol] ?? '').replace(/[^\d.]/g, '') : '';
                    newItems.push({ name, price });
                }

                if (newItems.length === 0) {
                    showError("لم يتم العثور على عناصر جديدة لإضافتها.");
                    return;
                }

                // Ask user how to proceed
                const result = await Swal.fire({
                    background: '#0a0f1c', color: '#f8fafc',
                    title: 'خيارات الاستيراد',
                    text: `تم العثور على ${newItems.length} عنصر في الإكسيل. كيف تريد إضافتها للقائمة الحالية؟`,
                    icon: 'question',
                    showDenyButton: true,
                    showCancelButton: true,
                    confirmButtonText: 'إضافة فوق القديم',
                    denyButtonText: 'مسح القديم واستبدال',
                    cancelButtonText: 'إلغاء العملية',
                    customClass: {
                        popup: 'border border-cyan-900/30 rounded-2xl shadow-[0_0_50px_rgba(6,182,212,0.1)]',
                        confirmButton: 'bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl px-4 py-2.5 font-bold outline-none m-1',
                        denyButton: 'bg-rose-600 hover:bg-rose-500 text-white rounded-xl px-4 py-2.5 font-bold outline-none m-1',
                        cancelButton: 'bg-muted text-foreground rounded-xl px-4 py-2.5 font-bold outline-none m-1 border border-border'
                    },
                    buttonsStyling: false
                });

                if (result.isDismissed) {
                    e.target.value = '';
                    return; // Cancelled
                }

                const replaceAll = result.isDenied;

                // Merge outside the state updater — React may run updaters 0/1/2
                // times, so counting inside one gave a wrong/random addedCount.
                const currentList: SuggestionItem[] = replaceAll ? [] : [...(lists[categoryKey] || [])];
                let addedCount = 0;
                newItems.forEach(newItem => {
                    if (!currentList.some(item => item.name === newItem.name)) {
                        currentList.push(newItem);
                        addedCount++;
                    }
                });

                setLists(prev => ({ ...prev, [categoryKey]: currentList }));

                if (addedCount > 0 || replaceAll) {
                    setHasChanges(true);
                    showSuccess(`تمت العملية بنجاح! لا تنس الضغط على زر "حفظ التغييرات في السيرفر".`);
                } else {
                    showSuccess("لم يتم إضافة عناصر جديدة (جميعها مكررة).");
                }
            } catch (err) {
                console.error("Excel import error:", err);
                showError("فشل في قراءة ملف الإكسيل. تأكد من أن الملف بصيغة صحيحة.");
            }
            // reset file input
            e.target.value = '';
        };
        reader.readAsBinaryString(file);
    };

    const handleExportExcel = (categoryKey: string, categoryLabel: string) => {
        try {
            const currentList = lists[categoryKey] || [];
            if (currentList.length === 0) {
                showError("لا يوجد عناصر لتصديرها في هذه القائمة.");
                return;
            }

            // Clean 2-column export: المادة + السعر (no العدد / تسلسل).
            const exportData: any[][] = [["المادة", "السعر"]];
            currentList.forEach(item => exportData.push([item.name, item.price || ""]));

            const ws = XLSX.utils.aoa_to_sheet(exportData);
            ws["!cols"] = [{ wch: 32 }, { wch: 14 }];
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "الاقتراحات");
            XLSX.writeFile(wb, `تصدير_${categoryLabel.replace(/\s+/g, '_')}.xlsx`);
            
            showSuccess(`تم تصدير ${currentList.length} عنصر بنجاح!`);
        } catch (err) {
            console.error("Excel export error:", err);
            showError("حدث خطأ أثناء تصدير الملف.");
        }
    };

    // Downloadable import template — exactly the two columns the import reads.
    const handleDownloadTemplate = () => {
        const ws = XLSX.utils.aoa_to_sheet([
            ["المادة", "السعر"],
            ["مثال: زيت شل 5W30", "15000"],
            ["مثال: فلتر زيت WOLF", "5000"],
        ]);
        ws["!cols"] = [{ wch: 32 }, { wch: 14 }];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "قالب الاستيراد");
        XLSX.writeFile(wb, "قالب_استيراد_الاقتراحات.xlsx");
    };

    const totalItems = useMemo(() => {
        return Object.values(lists).reduce((sum, arr) => sum + arr.length, 0);
    }, [lists]);

    // Active Group Category Keys
    const activeGroupKeys = useMemo(() => {
        const group = activeGroups.find(g => g.id === activeGroupId);
        return group ? group.categories.map(c => c.key) : [];
    }, [activeGroupId, activeGroups]);

    return (
        <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6" dir="rtl">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between gap-4 items-start md:items-center">
                <div>
                    <h1 className="text-3xl font-display font-bold text-foreground flex items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-lg shadow-rose-500/20">
                            <FileSpreadsheet className="text-white" size={24} />
                        </div>
                        إدارة الاقتراحات (قاعدة البيانات)
                    </h1>
                    <p className="text-muted-foreground mt-2 text-sm">
                        تحكم بـ 33 قائمة للاقتراحات تظهر في شاشة الاستقبال وأوامر العمل.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    {/* Branch Dropdown Select */}
                    {branches.length > 0 && (employeeRole === 'Owner' || employeeRole === 'Admin' || !employeeBranchId) && (
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-muted-foreground">الفرع:</span>
                            <select
                                value={selectedBranchId}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    if (hasChanges) {
                                        if (confirm("لديك تغييرات غير محفوظة، هل أنت متأكد من الانتقال وتجاهل التعديلات؟")) {
                                            setSelectedBranchId(val);
                                        }
                                    } else {
                                        setSelectedBranchId(val);
                                    }
                                }}
                                className="bg-card border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:border-rose-500/50 cursor-pointer hover:border-border/80 transition-colors"
                            >
                                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                        </div>
                    )}
                    <div className="bg-card border border-border rounded-xl px-4 py-2 text-sm font-bold text-muted-foreground">
                        الإجمالي: <span className="text-foreground">{totalItems}</span> اقتراح
                    </div>

                    <button
                        onClick={handleSave}
                        disabled={!hasChanges || saving || !canSave}
                        className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition-all shadow-lg ${
                            hasChanges && canSave
                                ? "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-500/20 cursor-pointer"
                                : "bg-muted text-muted-foreground cursor-not-allowed shadow-none"
                        }`}
                    >
                        {saving ? <Loader2 size={16} className="animate-spin" /> : hasChanges ? <Save size={16} /> : <Check size={16} />}
                        {saving ? "جاري الحفظ..." : hasChanges ? "حفظ التغييرات في السيرفر" : "محفوظ في السيرفر"}
                    </button>
                </div>
            </div>

            {/* Search */}
            <div className="relative">
                <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                <input
                    type="text"
                    placeholder="ابحث عن اقتراح معين في جميع القوائم..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full bg-card border border-border rounded-2xl py-3 pr-12 pl-4 text-sm text-foreground focus:border-rose-500/50 focus:outline-none transition-colors font-ibm"
                />
                {searchQuery && (
                    <button onClick={() => setSearchQuery("")} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        <X size={16} />
                    </button>
                )}
            </div>

            {/* Tabs for Groupings */}
            {!searchQuery && (
                <div className="flex border-b border-border overflow-x-auto no-scrollbar gap-2 pb-1">
                    {activeGroups.map(g => (
                        <button
                            key={g.id}
                            onClick={() => {
                                setActiveGroupId(g.id);
                                if (g.categories.length > 0) {
                                    setExpandedCategory(g.categories[0].key);
                                }
                            }}
                            className={`flex items-center gap-2 px-5 py-3 border-b-2 font-bold text-sm whitespace-nowrap transition-all ${
                                activeGroupId === g.id
                                    ? "border-rose-500 text-rose-500 bg-rose-500/5 font-extrabold"
                                    : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30"
                            }`}
                        >
                            {g.icon}
                            {g.name}
                        </button>
                    ))}
                </div>
            )}

            {/* Loading state */}
            {loading && (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <Loader2 size={36} className="text-rose-500 animate-spin" />
                    <p className="text-muted-foreground text-sm font-bold">جاري تحميل قوائم الاقتراحات من قاعدة البيانات...</p>
                </div>
            )}

            {/* Category Cards */}
            {!loading && (
                <div className="space-y-4">
                    {activeCategoryMeta.map(cat => {
                        // If not searching, only show categories in active group
                        if (!searchQuery && !activeGroupKeys.includes(cat.key)) return null;

                        const items = lists[cat.key] || [];
                        const cc = colorClasses[cat.color] || colorClasses.emerald;
                        const isExpanded = expandedCategory === cat.key || searchQuery;

                        // Carry each item's real index through the filter, so edit/delete
                        // hit the right row even when names are duplicated.
                        const indexedItems = items.map((item, originalIdx) => ({ item, originalIdx }));
                        const filteredItems = searchQuery
                            ? indexedItems.filter(({ item }) => item.name.toLowerCase().includes(searchQuery.toLowerCase()))
                            : indexedItems;

                        // If searching and no matches in this list, skip
                        if (searchQuery && filteredItems.length === 0) return null;

                        const isStaffCategory = ["technicianNames", "supervisorNames", "receptionistNames", "bayNumbers"].includes(cat.key);

                        return (
                            <div key={cat.key} className={`bg-card border ${isExpanded ? cc.border : 'border-border'} rounded-2xl overflow-hidden transition-all shadow-sm`}>
                                {/* Category Header */}
                                <button
                                    onClick={() => setExpandedCategory(isExpanded ? null : cat.key)}
                                    className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors cursor-pointer"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`w-10 h-10 rounded-xl ${cc.bg} ${cc.border} border flex items-center justify-center`}>
                                            <span className={cc.text}>{cat.icon}</span>
                                        </div>
                                        <div className="text-right">
                                            <h3 className="font-bold text-foreground text-sm">{cat.label}</h3>
                                            <p className="text-xs text-muted-foreground">{items.length} عنصر</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className={`px-3 py-1 rounded-lg text-xs font-bold ${cc.badge}`}>
                                            {items.length}
                                        </span>
                                        {isExpanded ? <ChevronUp size={18} className="text-muted-foreground" /> : <ChevronDown size={18} className="text-muted-foreground" />}
                                    </div>
                                </button>

                                {/* Expanded Content */}
                                {isExpanded && (
                                    <div className="border-t border-border p-4 space-y-4">
                                        {/* Add new item */}
                                        <div className="flex flex-col sm:flex-row gap-3">
                                            <input
                                                type="text"
                                                placeholder={`أضف عنصر جديد إلى ${cat.label}...`}
                                                value={newItemNames[cat.key] || ""}
                                                onChange={e => setNewItemNames(prev => ({ ...prev, [cat.key]: e.target.value }))}
                                                onKeyDown={e => { if (e.key === "Enter") handleAddItem(cat.key); }}
                                                className={`flex-1 bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:border-rose-500 focus:outline-none transition-colors font-ibm`}
                                            />
                                            <button
                                                onClick={() => handleAddItem(cat.key)}
                                                className={`px-6 py-2.5 ${cc.bg} ${cc.border} border ${cc.text} font-bold text-sm rounded-xl hover:opacity-80 transition-all flex items-center justify-center gap-2 cursor-pointer`}
                                            >
                                                <Plus size={16} /> إضافة
                                            </button>
                                            {!isStaffCategory && (
                                                <div className="flex gap-2">
                                                    <label className={`px-4 py-2.5 bg-emerald-500/10 border-emerald-500/30 border text-emerald-500 font-bold text-sm rounded-xl hover:bg-emerald-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap`}>
                                                        <FileSpreadsheet size={16} /> استيراد
                                                        <input
                                                            type="file"
                                                            accept=".xls,.xlsx,.csv"
                                                            className="hidden"
                                                            onChange={(e) => handleImportExcel(e, cat.key)}
                                                        />
                                                    </label>
                                                    <button
                                                        onClick={() => handleExportExcel(cat.key, cat.label)}
                                                        className={`px-4 py-2.5 bg-blue-500/10 border-blue-500/30 border text-blue-500 font-bold text-sm rounded-xl hover:bg-blue-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap`}
                                                    >
                                                        <FileSpreadsheet size={16} /> تصدير
                                                    </button>
                                                    <button
                                                        onClick={handleDownloadTemplate}
                                                        className={`px-4 py-2.5 bg-amber-500/10 border-amber-500/30 border text-amber-500 font-bold text-sm rounded-xl hover:bg-amber-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap`}
                                                    >
                                                        <FileSpreadsheet size={16} /> قالب
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        {/* Items Grid */}
                                        <div className="flex flex-col gap-2.5">
                                            {filteredItems.map(({ item, originalIdx }, idx) => {
                                                const isEditing = editingItem && editingItem.categoryKey === cat.key && editingItem.index === originalIdx;

                                                if (isEditing) {
                                                    return (
                                                        <div key={`${item.name}-${idx}`} className="flex flex-wrap items-center gap-2 bg-muted/40 border border-border p-2 rounded-xl w-full">
                                                            {!isStaffCategory && editingItem.serial && (
                                                                <span className="shrink-0 bg-rose-500/10 text-rose-500 border border-rose-500/20 text-[10px] px-2 py-1 rounded font-bold font-mono">
                                                                    {editingItem.serial}
                                                                </span>
                                                            )}
                                                            <input
                                                                type="text"
                                                                value={editingItem.name}
                                                                onChange={e => setEditingItem(prev => prev ? { ...prev, name: e.target.value } : null)}
                                                                className="flex-1 min-w-[120px] bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-rose-500 font-ibm"
                                                                placeholder="الاسم"
                                                            />
                                                            <button
                                                                onClick={() => {
                                                                    if (!editingItem.name.trim()) return;
                                                                    setLists(prev => {
                                                                        const updated = [...prev[editingItem.categoryKey]];
                                                                        updated[editingItem.index] = { 
                                                                            name: editingItem.name.trim(), 
                                                                            price: editingItem.price.trim(),
                                                                            serial: (editingItem.serial || "").trim()
                                                                        };
                                                                        return { ...prev, [editingItem.categoryKey]: updated };
                                                                    });
                                                                    setEditingItem(null);
                                                                    setHasChanges(true);
                                                                }}
                                                                className="p-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 rounded-lg hover:bg-emerald-500/20 transition-colors cursor-pointer"
                                                                title="حفظ"
                                                            >
                                                                <Check size={14} />
                                                            </button>
                                                            <button
                                                                onClick={() => setEditingItem(null)}
                                                                className="p-1.5 bg-rose-500/10 border border-rose-500/20 text-rose-500 rounded-lg hover:bg-rose-500/20 transition-colors cursor-pointer"
                                                                title="إلغاء"
                                                            >
                                                                <X size={14} />
                                                            </button>
                                                        </div>
                                                    );
                                                }

                                                return (
                                                    <div
                                                        key={`${item.name}-${idx}`}
                                                        className={`group flex items-center justify-between gap-3 px-3 py-2.5 ${cc.bg} border ${cc.border} rounded-xl text-sm font-medium text-foreground transition-all hover:bg-muted/20 hover:shadow-sm`}
                                                    >
                                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                                            {item.serial && !isStaffCategory && (
                                                                <span className="shrink-0 bg-rose-500/10 text-rose-500 border border-rose-500/20 text-[10px] px-1.5 py-0.5 rounded font-bold font-mono">
                                                                    {item.serial}
                                                                </span>
                                                            )}
                                                            <span className="truncate font-bold text-foreground/90">{item.name}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1.5 shrink-0">
                                                            <button
                                                                onClick={() => setEditingItem({
                                                                    categoryKey: cat.key,
                                                                    index: originalIdx,
                                                                    name: item.name,
                                                                    price: item.price,
                                                                    serial: item.serial || ""
                                                                })}
                                                                className="text-blue-500 hover:text-blue-400 p-2 hover:bg-blue-500/10 rounded-xl transition-colors cursor-pointer"
                                                                title="تعديل"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                                                            </button>
                                                            <button
                                                                onClick={() => handleRemoveItem(cat.key, originalIdx)}
                                                                className="text-rose-500 hover:text-rose-400 p-2 hover:bg-rose-500/10 rounded-xl transition-colors cursor-pointer"
                                                                title="حذف"
                                                            >
                                                                <Trash2 size={18} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                            {filteredItems.length === 0 && (
                                                <p className="text-muted-foreground text-sm py-4 col-span-full w-full text-center">
                                                    {searchQuery ? "لا توجد نتائج مطابقة" : "لا توجد عناصر. أضف عنصراً جديداً أعلاه."}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Floating Save Button for mobile */}
            {hasChanges && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 md:hidden">
                    <button
                        onClick={handleSave}
                        disabled={saving || !canSave}
                        className="flex items-center gap-2 px-8 py-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold rounded-2xl shadow-2xl shadow-emerald-500/30 text-sm animate-bounce cursor-pointer"
                    >
                        {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                        {saving ? "جاري الحفظ..." : "حفظ التغييرات في السيرفر"}
                    </button>
                </div>
            )}
        </div>
    );
}
