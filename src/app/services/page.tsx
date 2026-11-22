"use client";

import { useState, useEffect } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { Wrench, CheckCircle2, AlertTriangle, XCircle, FileText, Loader2, Save, ChevronDown, ChevronRight, CheckSquare, PackagePlus, Trash2, Search, X, AlertCircle } from "lucide-react";
import { showError, showSuccess, showConfirm } from "@/lib/alerts";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthProvider";

type ServiceStatus = "سليم" | "يحتاج صيانة" | "تالف";

// The granular 41-item checklist mapping exactly 1:1 to the PDF constraints
const CATEGORIES = [
    { 
        id: "engine", name: "المحرك (Engine)",
        items: ['البلكات (شمعات الاشتعال)', 'نوذلات', 'حساسات', 'قايش', 'بكرات', 'تسريب زيت (نضوج)', 'الفيول بم', 'دهن المحرك', 'التوربو']
    },
    { 
        id: "gearbox", name: "ناقل الحركة (الكير)",
        items: ['فحص كهربائي بالجهاز', 'فحص او تغيير زيت الكير', 'تسريب الكير', 'فلتر الكير']
    },
    { 
        id: "brakes", name: "الفرامل (البريك)",
        items: ['فحص فلنجات امامي', 'فحص فلنجات خلفي', 'فحص دسكات امامي', 'فحص دسكات خلفي', 'فحص دهن البريك']
    },
    { 
        id: "suspension", name: "الحدادية (Suspension)",
        items: ['هزة امامي', 'هزة خلفي', 'فحص الاجزاء المتحركة', 'ميزانية الكترونية']
    },
    { 
        id: "filters", name: "الفلاتر (Filters)",
        items: ['فلتر هواء', 'فلتر تبريد', 'فلتر بانزين', 'فلتر زيت', 'فلتر بطارية']
    },
    { 
        id: "cooling", name: "منظومة التبريد (Cooling)",
        items: ['الراديتور', 'ضغط الجوينات', 'الدببة', 'قبق الراديتور', 'ماء الراديتور', 'التسريب', 'فحص الفان كهربائياً']
    },
    { 
        id: "tires", name: "الاطارات (Tires)",
        items: ['الاطارات الامامية', 'الاطارات الخلفية', 'ضغط الاطارات']
    },
    { 
        id: "electrical", name: "الكهرباء (Electrical)",
        items: ['عمر البطارية', 'الداينمو', 'الدنارة الامامية', 'الدنارة الخلفية']
    }
];

export default function ServicesPage() {
    const { t } = useLanguage();
    const { employeeRole, employeeName, employeeBranchId } = useAuth();
    
    const [reports, setReports] = useState<any[]>([]);
    const [selectedReportId, setSelectedReportId] = useState<string>("");
    
    const [statuses, setStatuses] = useState<Record<string, ServiceStatus>>({});
    const [notes, setNotes] = useState<Record<string, string>>({});
    const [prices, setPrices] = useState<Record<string, string>>({});
    
    // Inventory Integration States
    const [inventoryItems, setInventoryItems] = useState<any[]>([]);
    const [usedParts, setUsedParts] = useState<any[]>([]);
    const [isPartsModalOpen, setIsPartsModalOpen] = useState(false);
    const [partSearch, setPartSearch] = useState("");
    const [debouncedPartSearch, setDebouncedPartSearch] = useState("");
    const [isSearchingParts, setIsSearchingParts] = useState(false);
    
    // Accordion State
    const [expandedCategories, setExpandedCategories] = useState<string[]>(['engine']);

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [successMessage, setSuccessMessage] = useState("");

    // Load available reports ONLY
    useEffect(() => {
        const fetchInitialData = async () => {
            try {
                // Fetch valid open reports
                let query = supabase
                    .from('inspection_reports')
                    .select('id, report_number, odometer_reading, branch_id, vehicles(make, model, plate_number, clients(name))')
                    .neq('status', 'تم الانتهاء');
                
                if (employeeBranchId) {
                    query = query.eq('branch_id', employeeBranchId);
                }
                
                const { data: reportsData } = await query.order('created_at', { ascending: false });
                
                if (reportsData) {
                    setReports(reportsData);
                    if (reportsData.length > 0) setSelectedReportId(reportsData[0].id);
                }
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        fetchInitialData();
    }, [employeeBranchId]);

    // Debounce Parts Search
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedPartSearch(partSearch), 500);
        return () => clearTimeout(timer);
    }, [partSearch]);

    // Live Server-Side Inventory Search for modal
    useEffect(() => {
        if (!isPartsModalOpen) return;
        
        const searchInventory = async () => {
            setIsSearchingParts(true);
            try {
                let query = supabase.from('inventory').select('*').gt('quantity', 0).order('name').limit(15);
                if (debouncedPartSearch) {
                    query = query.or(`name.ilike.%${debouncedPartSearch}%,item_code.ilike.%${debouncedPartSearch}%`);
                }
                const { data } = await query;
                if (data) setInventoryItems(data);
            } catch (err) {
                console.error(err);
            } finally {
                setIsSearchingParts(false);
            }
        };
        searchInventory();
    }, [debouncedPartSearch, isPartsModalOpen]);

    const selectedReport = reports.find(r => r.id === selectedReportId);

    const toggleAccordion = (id: string) => {
        setExpandedCategories(prev => 
            prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
        );
    };

    const handleStatusChange = (itemName: string, status: ServiceStatus) => {
        setStatuses(prev => ({ ...prev, [itemName]: status }));
    };

    const handleNoteChange = (itemName: string, val: string) => {
        setNotes(prev => ({ ...prev, [itemName]: val }));
    };

    const handlePriceChange = (itemName: string, val: string) => {
        setPrices(prev => ({ ...prev, [itemName]: val }));
    };

    const setAllSaliem = (categoryItems: string[], e: React.MouseEvent) => {
        e.stopPropagation();
        const updates: Record<string, ServiceStatus> = {};
        categoryItems.forEach(item => {
            updates[item] = "سليم";
        });
        setStatuses(prev => ({ ...prev, ...updates }));
    };

    /* INVENTORY LOGIC */
    const addUsedPart = (item: any) => {
        const exists = usedParts.find(p => p.inventory_id === item.id);
        if (exists) {
            setUsedParts(prev => prev.map(p => 
                p.inventory_id === item.id && p.quantity_used < p.max_quantity 
                    ? { ...p, quantity_used: p.quantity_used + 1 } 
                    : p
            ));
        } else {
            setUsedParts(prev => [...prev, {
                inventory_id: item.id,
                name: item.name,
                item_code: item.item_code,
                sell_price: item.sell_price,
                quantity_used: 1,
                max_quantity: item.quantity,
                branch_id: item.branch_id
            }]);
        }
    };

    const removeUsedPart = (id: string) => {
        setUsedParts(prev => prev.filter(p => p.inventory_id !== id));
    };

    const updateUsedPartQty = (id: string, qty: number) => {
        setUsedParts(prev => prev.map(p => {
            if (p.inventory_id === id) {
                // Enforce safety limits
                const safeQty = Math.max(1, Math.min(qty || 1, p.max_quantity));
                return { ...p, quantity_used: safeQty };
            }
            return p;
        }));
    };

    const computeLaborTotal = () => {
        return Object.values(prices).reduce((acc, curr) => acc + (parseFloat(curr) || 0), 0);
    };

    const computePartsTotal = () => {
        return usedParts.reduce((acc, part) => acc + (part.quantity_used * part.sell_price), 0);
    };

    const computeTotal = () => {
        return computeLaborTotal() + computePartsTotal();
    };

    const handleSubmit = async () => {
        if (!selectedReportId) return;

        const confirmed = await showConfirm("تأكيد اعتماد التقرير", "هل أنت متأكد من رغبتك في إتمام هذا التقرير وتسجيل الأسعار؟ لا يمكن التراجع عن هذا الإجراء.");
        if (!confirmed) return;

        setSaving(true);
        setSuccessMessage("");
        
        try {
            // 0. Pre-verify inventory availability (Prevent negative quantity and handle concurrency)
            if (usedParts.length > 0) {
                for (const p of usedParts) {
                    const { data: dbItem, error: getErr } = await supabase
                        .from('inventory')
                        .select('quantity, name')
                        .eq('id', p.inventory_id)
                        .single();

                    if (getErr || !dbItem) {
                        throw new Error(`المنفذ غير قادر على التحقق من وجود "${p.name}" في المخزن!`);
                    }

                    if ((dbItem.quantity || 0) < p.quantity_used) {
                        throw new Error(`عذراً، الكمية المطلوبة من "${p.name}" (${p.quantity_used}) غير متوفرة حالياً في المخزن! المتاح هو (${dbItem.quantity || 0}) فقط.`);
                    }
                }
            }

            const total = computeTotal();

            // 1. Update report status to completed
            const { error: finishErr } = await supabase
                .from('inspection_reports')
                .update({ status: 'تم الانتهاء', total_price: total, completed_at: new Date().toISOString() })
                .eq('id', selectedReportId);
            // e.g. a stock material on the order is short: the database refuses to finish it.
            if (finishErr) throw new Error(finishErr.message);

            // 2. Insert granular service records for EACH item 
            const servicesToInsert: any[] = [];
            
            CATEGORIES.forEach(cat => {
                cat.items.forEach(item => {
                    servicesToInsert.push({
                        report_id: selectedReportId,
                        category: item, // the exact string mapped to the printable PDF row!
                        status: statuses[item] || "سليم",
                        notes: notes[item] || "",
                        service_price: parseFloat(prices[item]) || 0,
                        photo_url: null
                    });
                });
            });

            await supabase.from('report_services').insert(servicesToInsert);

            // 3. Process Used Parts logic
            if (usedParts.length > 0) {
                const partsToInsert = usedParts.map(p => ({
                    report_id: selectedReportId,
                    inventory_id: p.inventory_id,
                    quantity: p.quantity_used,
                    unit_price: p.sell_price,
                    total_price: p.quantity_used * p.sell_price,
                    part_name: p.name || null,
                    part_code: p.item_code || null
                }));
                
                await supabase.from('used_parts').insert(partsToInsert);

                // Auto-Deduct inventory quantities via individual updates (or an RPC loop if deployed)
                // Doing sequential updates since TS loop is fine for UI logic scope
                for (const p of usedParts) {
                    const remainingQty = p.max_quantity - p.quantity_used;
                    await supabase.from('inventory').update({ quantity: remainingQty }).eq('id', p.inventory_id);
                    
                    // Log the transaction
                    await supabase.from('inventory_transactions').insert({
                        branch_id: p.branch_id || null,
                        inventory_id: p.inventory_id,
                        item_code: p.item_code || null,
                        item_name: p.name,
                        transaction_type: 'صرف كمية',
                        quantity_changed: -p.quantity_used,
                        quantity_before: p.max_quantity,
                        quantity_after: remainingQty,
                        user_name: employeeName || 'نظام الصيانة'
                    });
                }
            }

            showSuccess("تم الاعتماد", "تم اعتماد التقرير وخصم القطع من المخزن بنجاح!");
            window.scrollTo({ top: 0, behavior: 'smooth' });
            
            // Remove from list
            setReports(prev => prev.filter(r => r.id !== selectedReportId));
            if (reports.length > 1) setSelectedReportId(reports[1].id);
            else setSelectedReportId("");
            
            // Clear inputs
            setStatuses({});
            setNotes({});
            setPrices({});
            setUsedParts([]);
            setExpandedCategories(['engine']);
            
        } catch (err: any) {
            console.error(err);
            const errMsg = err?.message || "حدث خطأ أثناء الحفظ";
            showError("خطأ في الاعتماد", errMsg);
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="p-20 flex justify-center"><Loader2 className="animate-spin text-rose-500 w-10 h-10" /></div>;
    }

    if (employeeRole === "Receptionist") {
        return (
            <div className="p-8 flex items-center justify-center min-h-[50vh] animate-fade-in" dir="rtl">
                <div className="bg-background/40 border border-border p-8 rounded-2xl text-center max-w-md w-full relative overflow-hidden">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-rose-500/10 blur-[50px] rounded-full pointer-events-none" />
                    <AlertCircle className="mx-auto text-rose-500 mb-4 relative z-10" size={48} />
                    <h2 className="text-2xl font-bold text-foreground mb-2 relative z-10">غير مصرح لك</h2>
                    <p className="text-muted-foreground relative z-10">عذراً، صفحة تشخيص المركبات وتسعير الخدمات مهندسين وفنيين الورشة فقط.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 md:p-8 space-y-6 animate-fade-in pb-32" dir={t.common.dashboard === "لوحة التحكم" ? "rtl" : "ltr"}>
            {/* Header */}
            <div>
                <h1 className="text-3xl font-display font-bold text-foreground mb-2 flex items-center gap-3">
                    <Wrench className="text-rose-500" size={32} />
                    إدارة الفحص المفصل
                </h1>
                <p className="text-muted-foreground">
                    تقييم الأجزاء التفصيلية، أجور الايدي العاملة، وإدراج قطع المخزن
                </p>
            </div>

            {successMessage && (
                <div className="bg-emerald-500/10 border border-emerald-900/50 rounded-xl p-4 flex gap-3 text-emerald-300 animate-slide-up shadow-xl">
                    <CheckCircle2 size={24} /> 
                    <p className="font-bold">{successMessage}</p>
                </div>
            )}

            {/* Vehicle Selector Banner */}
            <div className="bg-card/90 backdrop-blur-md border border-rose-900/20 rounded-xl p-6 shadow-2xl flex flex-col gap-4 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-rose-500/5 blur-[80px] rounded-full pointer-events-none" />
                {reports.length === 0 ? (
                    <div className="text-center text-muted-foreground py-4 font-bold text-lg relative z-10">لا توجد سيارات بانتظار الفحص حالياً. ممتاز!</div>
                ) : (
                    <>
                        <div className="flex flex-col md:flex-row gap-4 justify-between md:items-center relative z-10">
                            <div className="flex-1 w-full max-w-lg">
                                <label className="text-sm font-bold text-rose-300 mb-2 block">اختر السيارة قيد العمل:</label>
                                <select 
                                    className="input-field appearance-none bg-background font-bold text-foreground w-full border-border ring-2 ring-transparent focus:ring-rose-500/20"
                                    value={selectedReportId}
                                    onChange={(e) => setSelectedReportId(e.target.value)}
                                >
                                    {reports.map(r => (
                                        <option key={r.id} value={r.id}>
                                            بوليصة #{r.report_number} - {r.vehicles.make} {r.vehicles.model} ({r.vehicles.plate_number})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {selectedReport && (
                                <div className="flex bg-card p-4 rounded-xl border border-border items-center justify-between gap-6 shadow-inner">
                                    <div>
                                        <span className="text-muted-foreground text-xs block mb-1">العميل</span>
                                        <span className="text-rose-300 font-bold">{selectedReport.vehicles.clients?.name}</span>
                                    </div>
                                    <div className="h-10 w-px bg-muted/80"></div>
                                    <div>
                                        <span className="text-muted-foreground text-xs block mb-1">العداد</span>
                                        <span className="text-emerald-400 font-bold font-mono tracking-wider" dir="ltr">{selectedReport.odometer_reading?.toLocaleString()} KM</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* Expandable Accordion List of Inspection Items (Labor) */}
            {selectedReportId && (
                <div className="space-y-4">
                    {CATEGORIES.map(category => {
                        const isExpanded = expandedCategories.includes(category.id);
                        const allHealthy = category.items.every(item => (statuses[item] || "سليم") === "سليم");
                        
                        return (
                            <div key={category.id} className="bg-background/40 border border-border rounded-xl overflow-hidden shadow-xl transition-all duration-300">
                                {/* Accordion Header */}
                                <div 
                                    onClick={() => toggleAccordion(category.id)}
                                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50 transition-colors select-none"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`p-1.5 rounded-lg transition-colors ${isExpanded ? 'bg-rose-500/20 text-rose-400' : 'bg-muted border border-border text-muted-foreground'}`}>
                                            {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-bold text-foreground tracking-wide">{category.name}</h3>
                                            <p className="text-xs text-muted-foreground">{category.items.length} نقاط فحص</p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-4">
                                        <button 
                                            onClick={(e) => setAllSaliem(category.items, e)}
                                            className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-all flex items-center gap-1.5 ${allHealthy ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.2)]' : 'bg-background text-muted-foreground border-border hover:text-emerald-400 hover:border-emerald-500/40'}`}
                                        >
                                            <CheckSquare size={14} />
                                            {allHealthy ? 'تم تحديد الكل كسليم' : 'تحديد الكل كنظيف'}
                                        </button>
                                    </div>
                                </div>

                                {/* Accordion Content */}
                                {isExpanded && (
                                    <div className="p-4 pt-0 border-t border-border bg-background">
                                        <div className="space-y-4 mt-4">
                                            {category.items.map((itemName, index) => {
                                                const isActiveStatus = statuses[itemName] || "سليم";
                                                
                                                return (
                                                    <div key={itemName} className="grid grid-cols-2 lg:grid-cols-12 gap-3 lg:gap-4 items-center bg-card p-3 lg:p-4 rounded-xl border border-border shadow-inner">
                                                        
                                                        <div className="col-span-2 lg:col-span-3 flex items-center gap-3">
                                                            <div className="bg-muted border border-border text-muted-foreground text-xs w-6 h-6 rounded flex flex-col items-center justify-center font-mono font-bold shrink-0">{index + 1}</div>
                                                            <span className="font-bold text-foreground text-sm">{itemName}</span>
                                                        </div>

                                                        <div className="col-span-2 lg:col-span-4 flex gap-2">
                                                            {(["سليم", "يحتاج صيانة", "تالف"] as ServiceStatus[]).map((statusOption) => {
                                                                const isActive = isActiveStatus === statusOption;
                                                                let activeColors = "text-muted-foreground hover:bg-muted";
                                                                let Icon = CheckCircle2;
                                                                
                                                                if (isActive) {
                                                                    if (statusOption === "سليم") activeColors = "bg-emerald-500/20 text-emerald-400 border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.15)]";
                                                                    else if (statusOption === "يحتاج صيانة") { activeColors = "bg-amber-500/20 text-amber-400 border-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.15)]"; Icon = AlertTriangle; }
                                                                    else { activeColors = "bg-rose-500/20 text-rose-400 border-rose-500/30 shadow-[0_0_15px_rgba(225,29,72,0.15)]"; Icon = XCircle; }
                                                                } else {
                                                                    if (statusOption === "يحتاج صيانة") Icon = AlertTriangle;
                                                                    if (statusOption === "تالف") Icon = XCircle;
                                                                }

                                                                return (
                                                                    <button
                                                                        key={statusOption}
                                                                        onClick={() => handleStatusChange(itemName, statusOption)}
                                                                        className={`flex-1 py-1.5 rounded-lg border border-transparent transition-all text-[11px] sm:text-xs font-bold flex items-center justify-center gap-1.5 ${activeColors}`}
                                                                    >
                                                                        <Icon size={12} className="shrink-0" />
                                                                        <span className="truncate">{statusOption}</span>
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>

                                                        <div className="col-span-1 lg:col-span-3">
                                                            <div className="relative">
                                                                <FileText className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hidden sm:block" size={14} />
                                                                <input 
                                                                    type="text"
                                                                    placeholder="ملاحظة الفحص..."
                                                                    value={notes[itemName] || ''}
                                                                    onChange={(e) => handleNoteChange(itemName, e.target.value)}
                                                                    className="input-field text-xs sm:pr-9 h-9 w-full bg-background border-border focus:border-rose-400 focus:bg-card placeholder:text-[10px] sm:placeholder:text-xs"
                                                                />
                                                            </div>
                                                        </div>

                                                        <div className="col-span-1 lg:col-span-2">
                                                            <div className="relative">
                                                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-[9px] font-bold">IQD</span>
                                                                <input 
                                                                    type="number" 
                                                                    placeholder="أجور اليد"
                                                                    value={prices[itemName] || ''}
                                                                    onChange={(e) => handlePriceChange(itemName, e.target.value)}
                                                                    className="input-field pl-8 h-9 shrink-0 w-full text-xs text-right bg-background border-border placeholder:text-[10px] sm:placeholder:text-xs focus:border-rose-400 focus:bg-card"
                                                                    dir="ltr"
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {/* INVENTORY / USED PARTS SECTION */}
                    <div className="mt-8 bg-card/80 border border-border rounded-2xl overflow-hidden shadow-xl">
                        <div className="p-6 border-b border-border flex items-center justify-between">
                            <div>
                                <h3 className="text-xl font-bold text-foreground flex items-center gap-2">
                                    <PackagePlus className="text-rose-500" />
                                    قطع الغيار المستخدمة
                                </h3>
                                <p className="text-muted-foreground text-sm mt-1">
                                    أضف القطع المستخدمة في العمل. سيتم سحبها تلقائياً من المخزون بعد الحفظ.
                                </p>
                            </div>
                            <button 
                                onClick={() => setIsPartsModalOpen(true)}
                                className="px-5 py-2.5 bg-rose-600/10 hover:bg-rose-600/20 text-rose-400 border border-rose-500/30 rounded-xl font-bold flex items-center gap-2 transition-all"
                            >
                                <PackagePlus size={18} />
                                <span className="hidden sm:inline">صرف قطعة</span>
                            </button>
                        </div>

                        <div className="p-6">
                            {usedParts.length === 0 ? (
                                <div className="text-center py-6 text-muted-foreground bg-background rounded-xl border border-dashed border-border">
                                    لم يتم تحديد أي قطع مستخدمة لهذا التقرير بعد.
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {usedParts.map(part => (
                                        <div key={part.inventory_id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card p-4 rounded-xl border border-border">
                                            <div>
                                                <h4 className="font-bold text-foreground">{part.name}</h4>
                                                <span className="text-xs text-muted-foreground font-mono">CODE: {part.item_code} | {part.sell_price} IQD</span>
                                            </div>
                                            
                                            <div className="flex items-center gap-6">
                                                <div className="flex items-center gap-3 bg-background px-3 py-1.5 rounded-lg border border-border">
                                                    <span className="text-xs text-muted-foreground flex-1 whitespace-nowrap">الكمية:</span>
                                                    <input 
                                                        type="number"
                                                        value={part.quantity_used}
                                                        onChange={(e) => updateUsedPartQty(part.inventory_id, parseInt(e.target.value))}
                                                        className="w-16 bg-transparent text-foreground font-bold text-center outline-none border-b border-rose-500/50 focus:border-rose-400"
                                                        dir="ltr"
                                                        min="1"
                                                        max={part.max_quantity}
                                                    />
                                                </div>
                                                <div className="text-emerald-400 font-bold font-mono tracking-widest hidden sm:block">
                                                    {part.quantity_used * part.sell_price} IQD
                                                </div>
                                                <button onClick={() => removeUsedPart(part.inventory_id)} className="text-muted-foreground hover:text-rose-500 transition-colors bg-muted p-2 rounded-lg">
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Total Footer */}
            {selectedReportId && (
                <div className="fixed bottom-0 right-0 lg:right-64 left-0 h-24 bg-background/90 backdrop-blur-xl border-t border-border flex flex-col sm:flex-row items-center justify-between px-6 lg:px-12 z-20 shadow-[0_-10px_40px_rgba(225,29,72,0.1)] gap-2 py-3">
                    <div className="flex flex-col">
                        <span className="text-muted-foreground text-xs font-medium">الإجمالي المبدئي (شامل أجور اليد وقطع المخزن)</span>
                        <div className="flex items-center gap-3">
                            <span className="text-xs text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded font-bold border border-rose-500/20">{usedParts.length} قطع</span>
                            <span className="text-2xl font-bold font-display text-foreground truncate text-shadow-glow" dir="ltr">{computeTotal()} <span className="text-rose-500 text-lg">IQD</span></span>
                        </div>
                    </div>
                    <button 
                        onClick={handleSubmit} 
                        disabled={saving}
                        className="btn-primary py-3 w-full sm:w-auto mt-2 sm:mt-0"
                    >
                        {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                        حفظ التقرير وخصم القطع
                    </button>
                </div>
            )}

            {/* Selecting Parts Modal */}
            {isPartsModalOpen && (
                <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[99999] flex justify-center items-center p-4 animate-fade-in">
                    <div className="bg-background w-full max-w-3xl rounded-2xl border border-border shadow-[0_0_50px_rgba(225,29,72,0.15)] flex flex-col max-h-[85vh] overflow-hidden">
                        <div className="p-6 border-b border-border bg-card flex items-center justify-between shrink-0">
                            <h3 className="text-xl font-bold text-foreground flex items-center gap-2">
                                <Search className="text-rose-500" />
                                البحث عن قطع غيار
                            </h3>
                            <button onClick={() => setIsPartsModalOpen(false)} className="text-muted-foreground hover:text-foreground bg-muted border border-border p-2 rounded-lg transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-4 border-b border-border shrink-0">
                            <input 
                                type="text"
                                placeholder="بحث بالاسم أو كود القطعة..."
                                className="input-field w-full placeholder:text-muted-foreground"
                                value={partSearch}
                                onChange={(e) => setPartSearch(e.target.value)}
                            />
                        </div>

                        <div className="overflow-y-auto p-4 space-y-2 flex-1">
                            {isSearchingParts ? (
                                <div className="p-12 flex justify-center"><Loader2 className="animate-spin text-rose-500 w-8 h-8" /></div>
                            ) : inventoryItems.length === 0 ? (
                                <div className="p-8 text-center text-muted-foreground font-bold">لا يوجد قطع مطابقة لطلبك في الخادم.</div>
                            ) : (
                                inventoryItems.map(item => {
                                    const attached = usedParts.find(p => p.inventory_id === item.id);
                                    const isAttached = !!attached;

                                    return (
                                        <div key={item.id} className="flex items-center justify-between p-4 bg-card border border-border rounded-xl hover:bg-muted transition-colors">
                                            <div>
                                                <h4 className="font-bold text-foreground">{item.name}</h4>
                                                <div className="flex items-center gap-3 text-xs mt-1">
                                                    <span className="text-muted-foreground font-mono">CODE: {item.item_code}</span>
                                                    <span className="text-rose-400 font-mono">{item.sell_price} IQD</span>
                                                    <span className="text-emerald-500 bg-emerald-500/10 px-1.5 rounded">متوفر: {item.quantity}</span>
                                                </div>
                                            </div>
                                            <button 
                                                onClick={() => addUsedPart(item)}
                                                className={`px-4 py-2 rounded-lg font-bold text-xs transition-colors ${
                                                    isAttached 
                                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                                                    : 'bg-rose-500/10 text-rose-400 border border-transparent hover:border-rose-500/50'
                                                }`}
                                            >
                                                {isAttached ? `محدد (${attached.quantity_used}) - زيادة` : 'إضافة للتقرير'}
                                            </button>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
