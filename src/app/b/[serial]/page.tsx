"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { normalizeBookletCode } from "@/lib/booklet";
import {
    Car, MapPin, User, ShieldCheck,
    AlertCircle, Wrench, Phone,
    Droplets, CheckCircle2, Activity, Gauge
} from "lucide-react";
import Link from "next/link";

type Vehicle = {
    id: string;
    make: string;
    model: string;
    plate_number: string | null;
    engine_size: string | null;
    booklet_serial: string | null;
    clients: {
        id: string;
        name: string;
        phone: string;
    } | null;
};

type Report = {
    id: string;
    report_number: number;
    status: string;
    total_price: number | null;
    selected_services: any[];
    odometer_reading: number;
    created_at: string;
    branches: { name: string } | null;
    receptionist: { name: string } | null;
};

const SERVICE_LABELS: Record<string, string> = {
    engineOil: 'زيت المحرك', 
    oilFilter: 'فلتر زيت المحرك',
    airFilter: 'فلتر الهواء', 
    acFilter: 'فلتر التبريد',
    brakeFluid: 'زيت المكابح', 
    coolant: 'ماء الراديتر',
    battery: 'البطارية', 
    engineBelts: 'قايش المحرك',
    brakePads: 'دسكات السيارة', 
    sparkPlugs: 'شمعات الاحتراق',
    gearboxOil: 'زيت كير',
    gearboxHydraulic: 'هايدروليك الكير',
    tires: 'الإطارات',
    gearboxFilter: 'فلتر الكير',
    wipers: 'مساحات زجاج', 
    windshieldFluid: 'سائل غسيل جام',
    battery2: 'البطارية فحص دوري', 
    batteryFilter: 'فلتر البطارية',
    engineFlash: 'فلاش المحرك', 
    engineCeramic: 'سيراميك محرك',
    linerCleaner: 'منظف بطانة (جكجكة)', 
    oilLeakPreventer: 'مانع تسريب زيت',
    smokePreventer: 'مانع دخان', 
    gearboxFlash: 'فلاش كير',
    gearboxCeramic: 'سيراميك كير', 
    gearboxAntiSlip: 'مانع انزلاق كير',
    acCleaner: 'منظف دورة تبريد', 
    injectorCleaner: 'منظف بخاخات',
    fuelSystemCleaner: 'منظف نظام الوقود', 
    octaneBooster: 'محسن أوكتان',
    additives: 'معالجات ومحسنات', 
    cleaners: 'منظفات وأساسيات',
    transOil: 'زيت ناقل الحركة', 
    differentialOil: 'زيت الدبل / البكك',
    maintenanceUnits: 'وحدات الصيانة'
};

const FREE_SERVICES_MAP: Record<string, string> = {
    windshieldWater: "ماء المساحات",
    tirePressure: "ضغط الإطارات",
    engineClean: "تنظيف محرك بالبخار",
};

export default function PublicBookletPage() {
    const params = useParams();
    // The printed barcode uses a short numeric form (/b/10001) to keep the symbol
    // narrow; restore the stored serial. Full /b/BK-10001 links keep working.
    // useParams() already returns a decoded value, so it is passed through as-is;
    // normalizeBookletCode does any decoding it needs, safely.
    const serial = normalizeBookletCode(`/b/${(params.serial as string) || ""}`);

    const [vehicle, setVehicle] = useState<Vehicle | null>(null);
    const [reports, setReports] = useState<Report[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<string>("summary");
    const [isEmployee, setIsEmployee] = useState(false);
    const [employeeName, setEmployeeName] = useState<string | null>(null);

    useEffect(() => {
        if (serial) {
            fetchBookletData();
            checkEmployeeSession();
        }
    }, [serial]);

    const checkEmployeeSession = async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
                const { data: emp } = await supabase
                    .from("employees")
                    .select("name")
                    .eq("auth_id", session.user.id)
                    .maybeSingle();
                
                if (emp) {
                    setIsEmployee(true);
                    setEmployeeName(emp.name);
                }
            }
        } catch (e) {
            console.error("Error checking employee session:", e);
        }
    };

    const fetchBookletData = async () => {
        setLoading(true);
        setError(null);
        try {
            // Anonymous-safe lookup. A SECURITY DEFINER database function returns
            // ONLY this one vehicle + its reports for the given serial, so no table
            // is exposed to the anon role (RLS keeps every table closed otherwise).
            const { data, error: rpcErr } = await (supabase.rpc as any)(
                "get_public_booklet",
                { p_serial: serial }
            );

            if (rpcErr) throw rpcErr;

            const vData = data?.vehicle;
            if (!vData) {
                setError("رقم الدفتر غير مسجل في النظام. يرجى التحقق من الرقم المطبوع أو رمز QR.");
                setLoading(false);
                return;
            }

            const mappedVehicle: Vehicle = {
                id: vData.id,
                make: vData.make,
                model: vData.model,
                plate_number: vData.plate_number,
                engine_size: vData.engine_size,
                booklet_serial: vData.booklet_serial,
                clients: vData.clients ?? null
            };

            setVehicle(mappedVehicle);
            setReports(data?.reports || []);


        } catch (e: any) {
            console.error("Error loading booklet:", e);
            setError("حدث خطأ أثناء تحميل بيانات الدفتر. يرجى تحديث الصفحة والمحاولة مجدداً.");
        } finally {
            setLoading(false);
        }
    };

    const maskPhone = (phone?: string) => {
        if (!phone) return "—";
        const cleaned = phone.trim();
        // Already masked server-side (get_public_booklet) — don't mask twice.
        if (cleaned.includes("*")) return cleaned;
        if (cleaned.length <= 6) return cleaned;
        if (cleaned.startsWith("07")) {
            return `${cleaned.slice(0, 3)}****${cleaned.slice(-4)}`;
        }
        if (cleaned.startsWith("+964")) {
            return `${cleaned.slice(0, 7)}****${cleaned.slice(-4)}`;
        }
        return `${cleaned.slice(0, 3)}****${cleaned.slice(-3)}`;
    };



    if (loading) {
        return (
            <div className="min-h-screen bg-[#08080d] text-foreground flex items-center justify-center p-4" dir="rtl">
                <div className="max-w-2xl w-full text-center space-y-6">
                    <div className="w-16 h-16 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-center justify-center mx-auto animate-pulse">
                        <Droplets className="text-rose-500 animate-bounce" size={32} />
                    </div>
                    <div className="space-y-2">
                        <h2 className="text-xl font-bold text-foreground">جاري تحميل دفتر الصيانة الرقمي...</h2>
                        <p className="text-muted-foreground text-sm">نسترجع بيانات المركبة وسجل الصيانة من خوادمنا</p>
                    </div>
                    <div className="w-full max-w-sm mx-auto h-1.5 bg-card rounded-full overflow-hidden border border-border">
                        <div className="bg-gradient-to-r from-rose-500 to-amber-500 h-full w-2/3 animate-infinite-scroll rounded-full" style={{
                            animation: "loading-bar 1.5s infinite ease-in-out"
                        }}></div>
                    </div>
                </div>
            </div>
        );
    }

    if (error || !vehicle) {
        return (
            <div className="min-h-screen bg-[#08080d] text-foreground flex items-center justify-center p-4" dir="rtl">
                <div className="max-w-md w-full bg-card/50 border border-border p-8 rounded-3xl text-center space-y-6 backdrop-blur-md shadow-2xl">
                    <div className="w-16 h-16 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center justify-center mx-auto text-rose-500">
                        <AlertCircle size={36} />
                    </div>
                    <div className="space-y-2">
                        <h2 className="text-2xl font-bold text-foreground">عذراً، لم نتمكن من العثور على الدفتر</h2>
                        <p className="text-muted-foreground text-sm leading-relaxed">
                            {error || "حدث خطأ غير متوقع في الوصول لبيانات هذا الدفتر."}
                        </p>
                    </div>
                    <div className="pt-2">
                        <button 
                            onClick={fetchBookletData}
                            className="w-full py-3 bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-white font-bold rounded-2xl transition-all shadow-lg shadow-rose-950/20"
                        >
                            إعادة المحاولة
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Calculations
    const totalVisits = reports.length;
    const latestOdometer = reports.length > 0 ? Math.max(...reports.map(r => r.odometer_reading || 0)) : 0;

    // Live status of the most recent visit — lets the customer track their car remotely (refresh to update).
    const latestReport = reports.length > 0
        ? [...reports].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
        : null;
    const statusInfo = (() => {
        if (!latestReport) return null;
        const s = latestReport.status;
        if (s === 'ملغى' || s === 'cancelled') return null;
        const done = s === 'تم الانتهاء' || s === 'completed';
        const pricing = (Array.isArray(latestReport.selected_services) ? latestReport.selected_services[0] : latestReport.selected_services)?.pricing;
        const accounted = pricing?.accounted === true;
        if (done && accounted) return { step: 4, label: 'مكتملة — تم التسليم' };
        if (done) return { step: 3, label: 'تم الانتهاء — بانتظار المحاسبة' };
        if (s === 'قيد العمل' || s === 'in_progress') return { step: 2, label: 'قيد العمل الآن' };
        return { step: 1, label: 'تم استلام السيارة' };
    })();
    const STATUS_STEPS = ['تم الاستلام', 'قيد العمل', 'بانتظار المحاسبة', 'مكتملة'];

    return (
        <div className="relative min-h-screen bg-[#07070a] text-foreground font-ibm pb-16 overflow-x-hidden" dir="rtl">
            {isEmployee && (
                <div className="bg-gradient-to-r from-amber-600 to-amber-700 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-3 font-bold text-sm shadow-md border-b border-amber-500/30 sticky top-0 z-[20]">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0"></span>
                        <span>وضع الإدارة - مرحباً بك يا {employeeName || "زميلنا"} 👋</span>
                        <span className="text-[11px] text-amber-200 bg-amber-800/40 px-2 py-0.5 rounded border border-amber-700/20 font-medium">تتصفح الدفتر الرقمي للزبون</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Link
                            href={`/reception?vehicle=${vehicle?.id || ""}`}
                            className="bg-white text-amber-700 hover:bg-amber-50 px-3.5 py-1.5 rounded-xl transition-all shadow-sm flex items-center gap-1.5 text-xs font-bold"
                        >
                            <Wrench size={14} /> استقبال صيانة جديدة
                        </Link>
                        <Link
                            href={`/customers?search=${serial}`}
                            className="bg-amber-900/40 hover:bg-amber-900/60 border border-amber-800 text-white px-3.5 py-1.5 rounded-xl transition-all flex items-center gap-1.5 text-xs font-bold"
                        >
                            <User size={14} /> فتح في سجل العملاء
                        </Link>
                    </div>
                </div>
            )}

            {/* Ambient Background Glows */}
            <div className="absolute top-0 right-1/4 w-[350px] h-[350px] bg-rose-500/10 rounded-full blur-[120px] pointer-events-none"></div>
            <div className="absolute top-1/3 left-1/4 w-[400px] h-[400px] bg-blue-500/5 rounded-full blur-[140px] pointer-events-none"></div>

            {/* Header / Brand Identity */}
            <header className="border-b border-border/40 bg-[#0c0c12]/80 backdrop-blur-md sticky top-0 z-10">
                <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        {/* شعار المركز */}
                        <img src="/logo.png" alt="هندسة السيارات" className="w-11 h-11 rounded-xl object-contain bg-white/5 border border-border/40 p-1 shrink-0" />
                        <div>
                            <h1 className="font-bold text-lg text-foreground tracking-tight flex items-center gap-2">
                                هندسة السيارات
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                    <ShieldCheck size={10} /> موثق
                                </span>
                            </h1>
                            <p className="text-[11px] text-muted-foreground font-medium">دفتر الخدمة الرقمي — سجل صيانة المركبة المعتمد</p>
                        </div>
                    </div>
                    <div className="px-3.5 py-1.5 bg-muted/60 border border-border rounded-xl">
                        <span className="text-xs font-bold text-muted-foreground block text-center leading-none mb-1">الرقم التسلسلي</span>
                        <span className="text-sm font-bold text-rose-400 font-mono tracking-wider">{vehicle.booklet_serial}</span>
                    </div>
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-4 mt-8 relative z-[1] space-y-6">
                
                {/* Tabs Navigation (Responsive: Horizontal scroll on mobile, flex on desktop) */}
                <div className="flex gap-2 overflow-x-auto pb-2 border-b border-border/40 scrollbar-none" dir="rtl">
                    <button
                        onClick={() => setActiveTab("summary")}
                        className={`px-5 py-3 rounded-2xl text-xs font-bold transition-all shrink-0 border ${
                            activeTab === "summary"
                                ? "bg-rose-600 text-white border-rose-600 shadow-lg shadow-rose-950/20"
                                : "bg-card hover:bg-muted text-muted-foreground border-border"
                        }`}
                    >
                        الملخص الشامل للمركبة
                    </button>
                    {reports.map((report) => {
                        const dateObj = new Date(report.created_at);
                        const formattedDate = dateObj.toLocaleDateString("en-GB", {
                            month: '2-digit',
                            day: '2-digit'
                        });
                        return (
                            <button
                                key={report.id}
                                onClick={() => setActiveTab(report.id)}
                                className={`px-5 py-3 rounded-2xl text-xs font-bold transition-all shrink-0 border ${
                                    activeTab === report.id
                                        ? "bg-emerald-600 text-white border-emerald-600 shadow-lg shadow-emerald-950/20"
                                        : "bg-card hover:bg-muted text-muted-foreground border-border"
                                }`}
                            >
                                زيارة #{report.report_number} ({formattedDate})
                            </button>
                        );
                    })}
                </div>

                {/* Tab Content */}
                <div className="animate-fade-in">
                    {activeTab === "summary" ? (
                        <>
                        {/* Live status tracker — the customer can follow their car remotely (refresh to update) */}
                        {statusInfo && (
                            <section className="glass-card p-5 md:p-6 rounded-3xl border border-border/60 shadow-xl mb-6">
                                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                                    <h3 className="text-sm font-bold text-foreground flex items-center gap-2"><Activity size={16} className="text-rose-400" /> حالة سيارتك الآن</h3>
                                    <span className="text-[11px] text-muted-foreground font-mono">زيارة #{latestReport?.report_number}</span>
                                </div>
                                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 font-bold text-sm mb-5">
                                    {statusInfo.label}
                                </div>
                                <div>
                                    {/* circles + connectors */}
                                    <div className="flex items-center">
                                        {STATUS_STEPS.map((label, i) => {
                                            const active = statusInfo.step >= i + 1;
                                            const lineActive = statusInfo.step >= i + 2;
                                            return (
                                                <div key={i} className={`flex items-center ${i < STATUS_STEPS.length - 1 ? 'flex-1' : ''}`}>
                                                    <div className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-xs font-bold border ${active ? 'bg-rose-500 border-rose-500 text-white' : 'bg-muted border-border text-muted-foreground'}`}>
                                                        {active ? '✓' : i + 1}
                                                    </div>
                                                    {i < STATUS_STEPS.length - 1 && <div className={`h-0.5 flex-1 mx-1 rounded ${lineActive ? 'bg-rose-500' : 'bg-border'}`} />}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    {/* labels aligned under circles */}
                                    <div className="flex mt-2">
                                        {STATUS_STEPS.map((label, i) => {
                                            const active = statusInfo.step >= i + 1;
                                            return (
                                                <span key={i} className={`text-[9px] text-center leading-tight ${i < STATUS_STEPS.length - 1 ? 'flex-1' : 'w-8'} ${active ? 'text-foreground font-bold' : 'text-muted-foreground'}`}>{label}</span>
                                            );
                                        })}
                                    </div>
                                </div>
                            </section>
                        )}
                        {/* Vehicle Specs Dashboard */}
                        <section className="glass-card p-6 md:p-8 rounded-3xl border border-border/60 shadow-xl overflow-hidden relative">
                            <div className="absolute top-0 left-0 w-24 h-24 bg-gradient-to-br from-blue-500/10 to-transparent rounded-br-full pointer-events-none"></div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
                                <div className="md:col-span-2 space-y-4">
                                    {/* 1) Owner name first */}
                                    <div className="space-y-1">
                                        <span className="text-xs font-bold text-rose-500 tracking-widest uppercase">صاحب المركبة</span>
                                        <h2 className="text-2xl md:text-3xl font-extrabold text-foreground flex items-center gap-2">
                                            <User size={24} className="text-rose-400 shrink-0" />
                                            {vehicle.clients?.name || "—"}
                                        </h2>
                                    </div>

                                    {/* 2) Vehicle info */}
                                    <div className="space-y-1">
                                        <span className="text-xs text-muted-foreground font-medium">المركبة</span>
                                        <h3 className="text-lg font-bold text-foreground">{vehicle.make} {vehicle.model}</h3>
                                    </div>

                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                        <div className="bg-background/40 p-3 rounded-2xl border border-border/40">
                                            <span className="block text-xs text-muted-foreground mb-1">رقم اللوحة</span>
                                            <span className="font-bold text-sm font-mono">{vehicle.plate_number || "—"}</span>
                                        </div>
                                        <div className="bg-background/40 p-3 rounded-2xl border border-border/40">
                                            <span className="block text-xs text-muted-foreground mb-1">حجم المحرك</span>
                                            <span className="font-bold text-sm">{vehicle.engine_size || "—"}</span>
                                        </div>
                                        {/* 3) Phone (masked for privacy on this public page) */}
                                        <div className="bg-background/40 p-3 rounded-2xl border border-border/40 col-span-2 sm:col-span-1">
                                            <span className="block text-xs text-muted-foreground mb-1">رقم الهاتف</span>
                                            <span className="font-bold text-sm font-mono flex items-center gap-1.5">
                                                <Phone size={14} className="text-rose-400 shrink-0" />
                                                {maskPhone(vehicle.clients?.phone)}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Quick Stats Grid */}
                                <div className="grid grid-cols-2 gap-4 md:border-r md:border-border/60 md:pr-6 h-full">
                                    <div className="bg-gradient-to-br from-rose-500/5 to-rose-600/5 p-4 rounded-2xl border border-rose-500/10 flex flex-col justify-center items-center text-center">
                                        <Gauge className="text-rose-400 mb-2" size={24} />
                                        <span className="text-xs text-muted-foreground font-medium">آخر قراءة عداد</span>
                                        <span className="text-lg font-black font-mono text-foreground mt-1">
                                            {latestOdometer > 0 ? latestOdometer.toLocaleString() : "—"}{" "}
                                            <span className="text-[10px] text-muted-foreground font-sans">كم</span>
                                        </span>
                                    </div>
                                    <div className="bg-gradient-to-br from-blue-500/5 to-blue-600/5 p-4 rounded-2xl border border-blue-500/10 flex flex-col justify-center items-center text-center">
                                        <Activity className="text-blue-400 mb-2" size={24} />
                                        <span className="text-xs text-muted-foreground font-medium">إجمالي الزيارات</span>
                                        <span className="text-xl font-black font-mono text-foreground mt-1">{totalVisits} <span className="text-[10px] font-sans text-muted-foreground">زيارة</span></span>
                                    </div>
                                </div>
                            </div>
                        </section>
                        </>
                    ) : (
                        /* Render Selected Visit Details */
                        (() => {
                            const report = reports.find(r => r.id === activeTab);
                            if (!report) return <div className="text-center text-muted-foreground text-xs">عذراً، لم يتم العثور على بيانات الفاتورة.</div>;
                            
                            const isPaperV2 = report.selected_services?.[0]?.is_paper_v2_format === true;
                            const servicePayload = isPaperV2 ? report.selected_services[0] : null;

                            const services = servicePayload?.services || {};
                            const freeServices = servicePayload?.freeServices || {};
                            const oldServicesList = !isPaperV2 && Array.isArray(report.selected_services) ? report.selected_services : [];
                            
                            const oilSvc = services.engineOil || {};
                            const oilDetails = oilSvc.details || {};
                            const hasOilChange = oilSvc.status === "يحتاج تغيير" || oldServicesList.some((s: any) => s.service === "engineOil" || s.label?.includes("زيت المحرك"));
                            
                            const replacedItems: string[] = [];
                            const inspectedItems: string[] = [];

                            Object.entries(services).forEach(([key, val]: [string, any]) => {
                                const label = SERVICE_LABELS[key] || key;
                                if (val?.status === "يحتاج تغيير") {
                                    let detailStr = "";
                                    if (key === 'engineOil') {
                                        const brand = oilDetails.type || oilDetails.brand || "";
                                        const visc = oilDetails.viscosity || "";
                                        const qty = oilDetails.liters || oilDetails.qty || "";
                                        detailStr = [brand, visc, qty ? `${qty}L` : ""].filter(Boolean).join(" - ");
                                    } else if (key === 'additives' || key === 'cleaners' || Object.keys(val.details || {}).some(k => k.startsWith('prod_'))) {
                                        // Multi-product lines (also wipers/tires) use any prod_* suffix
                                        // (prod_1, prod_12, prod_extra_…), not just prod_0..prod_9.
                                        const added = Object.keys(val.details || {})
                                            .filter(k => k.startsWith('prod_'))
                                            .map(k => String(val.details[k] ?? '').trim())
                                            .filter(Boolean);
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

                            if (isPaperV2) {
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
                                <div className="glass-card rounded-3xl border border-border/60 p-6 space-y-6 bg-[#0b0b11]/70">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/40 pb-4">
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="font-mono text-sm bg-muted px-2.5 py-1 rounded-lg font-bold border border-border">زيارة #{report.report_number}</span>
                                                <span className="text-[11px] text-muted-foreground">{formattedDate} ({formattedTime})</span>
                                                <span className={`text-xs px-2 py-0.5 rounded-full border ${
                                                    report.status === "completed" || report.status === "تم الانتهاء"
                                                        ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                                                        : "bg-amber-500/10 text-amber-500 border-amber-500/20"
                                                }`}>
                                                    {report.status}
                                                </span>
                                            </div>
                                        </div>
                                        <p className="text-base font-bold text-emerald-500 bg-emerald-500/10 px-4 py-1.5 rounded-xl border border-emerald-500/20" dir="ltr">
                                            {report.total_price ? report.total_price.toLocaleString() : 0} <span className="text-[10px]">IQD</span>
                                        </p>
                                    </div>

                                    {/* Stats */}
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

                                    {/* Engine Oil Details */}
                                    {hasOilChange && (
                                        <div className="p-4 bg-gradient-to-br from-[#1c1313]/50 to-[#221715]/40 rounded-2xl border border-rose-950/40 relative overflow-hidden">
                                            <h5 className="text-xs font-bold text-rose-400 flex items-center gap-2 mb-3">
                                                <Droplets size={14} />
                                                خدمة تغيير زيت المحرك
                                            </h5>
                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px]">
                                                <div className="bg-background/40 p-2 rounded-xl border border-border/30">
                                                    <span className="block text-[10px] text-muted-foreground mb-1">النوع / الماركة</span>
                                                    <span className="font-bold text-foreground">{oilDetails.type || oilDetails.brand || "—"}</span>
                                                </div>
                                                <div className="bg-background/40 p-2 rounded-xl border border-border/30">
                                                    <span className="block text-[10px] text-muted-foreground mb-1">درجة اللزوجة</span>
                                                    <span className="font-bold text-foreground font-mono">{oilDetails.viscosity || "—"}</span>
                                                </div>
                                                <div className="bg-background/40 p-2 rounded-xl border border-border/30">
                                                    <span className="block text-[10px] text-muted-foreground mb-1">حجم التعبئة</span>
                                                    <span className="font-bold text-foreground font-mono">{oilDetails.liters || oilDetails.qty || "—"} لتر</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Replaced Parts */}
                                    {replacedItems.length > 0 && (
                                        <div className="space-y-3">
                                            <h5 className="text-xs font-bold text-foreground flex items-center gap-2 border-b border-border/40 pb-2">
                                                <Wrench size={12} className="text-amber-500" />
                                                القطع المستبدلة والخدمات المنجزة
                                            </h5>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                {replacedItems.map((item, idx) => (
                                                    <div key={idx} className="flex items-start gap-2 text-[11px] font-semibold text-foreground bg-background/25 border border-border/20 p-2.5 rounded-xl">
                                                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                                                        <span>{item}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Free Services */}
                                    {activeFreeServices.length > 0 && (
                                        <div className="space-y-3">
                                            <h5 className="text-xs font-bold text-foreground flex items-center gap-2 border-b border-border/40 pb-2">
                                                <CheckCircle2 size={12} className="text-emerald-500" />
                                                خدمات مجانية إضافية منجزة
                                            </h5>
                                            <div className="flex flex-wrap gap-2">
                                                {activeFreeServices.map((fs, idx) => (
                                                    <span key={idx} className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1.5 rounded-xl">
                                                        ✓ {fs}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Inspected Components */}
                                    {inspectedItems.length > 0 && (
                                        <div className="space-y-3">
                                            <h5 className="text-xs font-bold text-foreground flex items-center gap-2 border-b border-border/40 pb-2">
                                                <ShieldCheck size={12} className="text-blue-400" />
                                                أجزاء تم فحصها وحالتها جيدة
                                            </h5>
                                            <div className="flex flex-wrap gap-2">
                                                {inspectedItems.map((item, idx) => (
                                                    <span key={idx} className="text-[10px] font-medium text-muted-foreground bg-background/30 border border-border/30 px-2.5 py-1.5 rounded-xl">
                                                        {item}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Staff Details */}
                                    {(report.receptionist?.name || servicePayload?.shiftSupervisor || servicePayload?.technicianName) && (
                                        <div className="flex flex-wrap justify-between items-center gap-2 text-[10px] text-muted-foreground bg-background/20 p-2.5 rounded-xl border border-border/20">
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
                        })()
                    )}
                </div>

            </main>

            {/* فروعنا وأرقام التواصل */}
            <section className="max-w-4xl mx-auto px-4 mt-14">
                <div className="glass-card rounded-3xl border border-border/60 p-6 md:p-8">
                    <h3 className="text-base font-bold text-foreground flex items-center gap-2 mb-1">
                        <Phone size={17} className="text-rose-400" /> فروعنا وأرقام التواصل
                    </h3>
                    <p className="text-[11px] text-muted-foreground mb-5">مرحباً بك في هندسة السيارات — قسم العلاقات</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {([
                            { name: "فرع القطاع", address: "سايدين مستشفى الصدر", phone: "07766331112" },
                            { name: "فرع الصناعية", address: "شارع البكرات", phone: "07766331113" },
                            { name: "فرع المجر", address: "داخل محطة انوار المجر", phone: "07766331114" },
                            { name: "فرع الكراج", address: "العمارة داخل كراج العمارة الموحد", phone: "" },
                        ] as { name: string; address: string; phone: string }[]).map((b) => (
                            <div key={b.name} className="bg-background/40 border border-border/40 rounded-2xl p-4 flex flex-col gap-2">
                                <span className="font-bold text-sm text-foreground flex items-center gap-1.5">
                                    <MapPin size={14} className="text-rose-400 shrink-0" /> {b.name}
                                </span>
                                <span className="text-[11px] text-muted-foreground">{b.address}</span>
                                {b.phone && (
                                    <a href={`tel:${b.phone}`} dir="ltr"
                                        className="mt-1 inline-flex items-center justify-center gap-2 bg-rose-500/10 hover:bg-rose-600 hover:text-white text-rose-400 border border-rose-500/30 rounded-xl px-3 py-2 text-sm font-bold font-mono transition-colors">
                                        <Phone size={14} /> {b.phone}
                                    </a>
                                )}
                            </div>
                        ))}
                    </div>
                    {/* قسم المتابعة والعلاقات */}
                    <div className="mt-4 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
                        <span className="font-bold text-sm text-foreground flex items-center gap-1.5">
                            <User size={14} className="text-emerald-400 shrink-0" /> قسم المتابعة والعلاقات
                        </span>
                        <a href="tel:+964788779803" dir="ltr"
                            className="inline-flex items-center gap-2 bg-emerald-500/10 hover:bg-emerald-600 hover:text-white text-emerald-400 border border-emerald-500/30 rounded-xl px-4 py-2 text-sm font-bold font-mono transition-colors">
                            <Phone size={14} /> +964 788 77 9803
                        </a>
                    </div>
                </div>
            </section>

            {/* Footer / Copyright */}
            <footer className="mt-14 border-t border-border/40 pt-8 text-center text-xs text-muted-foreground">
                <div className="max-w-4xl mx-auto px-4 space-y-2">
                    <p className="font-bold">نظام هندسة السيارات © {new Date().getFullYear()}</p>
                    <p className="text-[10px] opacity-60">تاريخ آخر صيانة يعتمد على العمليات المنفذة داخل فروعنا المعتمدة.</p>
                </div>
            </footer>
        </div>
    );
}
