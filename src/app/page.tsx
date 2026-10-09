"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { useAuth } from "@/lib/AuthProvider";
import {
    Wrench, Car, CheckCircle2, Activity, FileText,
    Search, Bell, Settings, Calendar, Plus, User,
    TrendingUp, Clock, Loader2, ShoppingCart
} from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { invoiceMoney } from "@/lib/contracts";
import Link from "next/link";
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell
} from "recharts";
import NotificationBell from "@/components/NotificationBell";

type WorkOrder = {
    id: string;
    report_number: number;
    status: string;
    estimated_duration: number;
    elapsed_time: number;
    start_time: string | null;
    is_delayed: boolean;
    created_at: string;
    total_price: number | null;
    vehicles: { make: string; model: string; plate_number: string, clients: { name: string; phone: string } };
};

export default function Home() {
    const { t } = useLanguage();
    const { employeeName, employeeRole, employeeBranchId, permissionDashboard, loading: authLoading } = useAuth();

    const [stats, setStats] = useState({
        today: 0,
        inProgress: 0,
        waiting: 0,
        completed: 0,
        revenue: 0
    });
    const [chartData, setChartData] = useState<any[]>([]);
    const [pieData, setPieData] = useState<any[]>([]);
    const [liveOrders, setLiveOrders] = useState<WorkOrder[]>([]);
    const [alerts, setAlerts] = useState<any[]>([]);

    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchDashboardData();

        // Debounced: a burst of saves used to trigger one full refetch per event.
        let debounceTimer: ReturnType<typeof setTimeout> | null = null;
        const channel = supabase.channel('dashboard_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'inspection_reports' }, () => {
                if (debounceTimer) clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => fetchDashboardData(), 500);
            })
            .subscribe();

        return () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            supabase.removeChannel(channel);
        };
    }, [employeeBranchId, employeeRole]);

    // The handful of fields the counters below actually read. Narrow on purpose: the
    // rows come back loosely typed, and the stats only care about these.
    type StatRow = {
        status: string;
        order_type?: string | null;
        total_price?: number | null;
        created_at: string;
        completed_at?: string | null;
        is_delayed?: boolean | null;
    };

    const fetchDashboardData = async () => {
        try {
            // Everything on this dashboard covers the last 7 days plus the currently
            // open orders — fetching the whole history was megabytes per realtime tick
            // and silently wrong past Supabase's 1000-row cap.
            const since = new Date();
            since.setDate(since.getDate() - 7);
            since.setHours(0, 0, 0, 0);
            const sinceIso = since.toISOString();

            const SELECT = `
                    id, report_number, status, order_type, total_price, created_at, completed_at,
                    estimated_duration, elapsed_time, start_time, is_delayed,
                    vehicles (make, model, plate_number, clients(name, phone))
                `;

            let recentQuery = supabase
                .from('inspection_reports')
                .select(SELECT)
                .or(`created_at.gte.${sinceIso},completed_at.gte.${sinceIso}`)
                .order('created_at', { ascending: false })
                .limit(2000);

            // Open orders can be older than 7 days and must still count.
            let openQuery = supabase
                .from('inspection_reports')
                .select(SELECT)
                .in('status', ['تم الاستلام', 'قيد العمل', 'متأخر'])
                .order('created_at', { ascending: false })
                .limit(1000);

            if (employeeBranchId) {
                recentQuery = recentQuery.eq('branch_id', employeeBranchId);
                openQuery = openQuery.eq('branch_id', employeeBranchId);
            }

            // Money collected = what صفحة التدقيق records as إجمالي الواصل: invoices (and sales)
            // ACCOUNTED on that Baghdad day, counting only what was actually received — so
            // contract (آجل) invoices add 0, audit-removed junk adds nothing, and an order that
            // is finished but not yet accounted isn't money yet. Paged past the 1000-row cap.
            const baghdadToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Baghdad' });
            const accountedSince = new Date(new Date(`${baghdadToday}T00:00:00+03:00`).getTime() - 6 * 86400000).toISOString();
            const fetchAccounted = async () => {
                const rows: { status: string; total_price: number | null; pricing: Record<string, unknown> | null }[] = [];
                for (let from = 0; from < 50000; from += 1000) {
                    let q = supabase
                        .from('inspection_reports')
                        .select('status, total_price, pricing:selected_services->0->pricing')
                        .eq('selected_services->0->pricing->>accounted', 'true')
                        .gte('selected_services->0->pricing->>accountedAt', accountedSince)
                        .order('id')
                        .range(from, from + 999);
                    if (employeeBranchId) q = q.eq('branch_id', employeeBranchId);
                    const { data, error } = await q;
                    if (error) throw error;
                    rows.push(...(data || []).map(r => ({ ...r, pricing: r.pricing as Record<string, unknown> | null })));
                    if (!data || data.length < 1000) break;
                }
                return rows;
            };

            const [{ data: recentReports }, { data: openReports }, accountedRows] = await Promise.all([recentQuery, openQuery, fetchAccounted()]);
            const allReports = recentReports as any[] | null;

            if (allReports && openReports) {
                const mappedOrders = openReports as any as WorkOrder[];
                setLiveOrders(mappedOrders.slice(0, 6));

                const isToday = (dateStr: string | null) => {
                    if (!dateStr) return false;
                    const d = new Date(dateStr);
                    const today = new Date();
                    return d.getDate() === today.getDate() &&
                        d.getMonth() === today.getMonth() &&
                        d.getFullYear() === today.getFullYear();
                };

                // A "بيع منتج" row is an over-the-counter invoice, not a vehicle: it has no
                // car attached and is written already finished. Counting those as cars was
                // putting the day's product sales into "تم استقبالها اليوم" and again into
                // "السيارات المكتملة". Every other screen excludes them, so this one does too.
                const isCar = (r: StatRow) => (r.order_type ?? 'maintenance') !== 'sale';

                const todayCount = allReports.filter(r => isCar(r) && isToday(r.created_at)).length;
                const inProgress = openReports.filter(r => isCar(r) && r.status === 'قيد العمل').length;
                const waiting = openReports.filter(r => isCar(r) && (r.status === 'تم الاستلام' || r.status === 'متأخر')).length;
                // A car received yesterday but finished today belongs to today's numbers —
                // key completion stats on completed_at (fall back to created_at for old rows).
                const finishedToday = (r: StatRow) => r.status === 'تم الانتهاء' && isToday(r.completed_at || r.created_at);
                const completedToday = (r: StatRow) => isCar(r) && finishedToday(r);
                const completed = allReports.filter(completedToday).length;

                // 1. Chart Data (Fixing missing days) — days are Baghdad days, like the audit page.
                const dayKey = (dateStr: string) => new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Baghdad' });
                const last7Days = Array.from({length: 7}).map((_, i) => {
                    const d = new Date();
                    d.setDate(d.getDate() - i);
                    return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Baghdad' });
                }).reverse();

                // Received money per accounting day (product sales included — a sale is real
                // income, it just isn't a car).
                const collectedByDay: Record<string, number> = {};
                accountedRows.forEach(r => {
                    const at = r.pricing?.accountedAt;
                    if (typeof at !== 'string') return;
                    const { received } = invoiceMoney(r);
                    collectedByDay[dayKey(at)] = (collectedByDay[dayKey(at)] || 0) + received;
                });
                const revenue = collectedByDay[last7Days[last7Days.length - 1]] || 0;

                const chartArr = last7Days.map(dateStr => {
                    const orders = allReports.filter(r => isCar(r) && dayKey(r.created_at) === dateStr).length;
                    return { name: dateStr, orders, revenue: collectedByDay[dateStr] || 0 };
                });

                setChartData(chartArr);

                // Pie Chart Data (Status Breakdown)
                // Each car lands in exactly one slice. The old rule counted a delayed
                // "قيد العمل" car under both قيد العمل and متأخر, so the slices summed to
                // more cars than are actually in the workshop.
                const openCars = openReports.filter(isCar);
                const bucketOf = (r: StatRow) => (r.is_delayed || r.status === 'متأخر') ? 'متأخر' : r.status;
                const statusCounts = ['تم الاستلام', 'قيد العمل', 'متأخر']
                    .map(s => ({ name: s, value: openCars.filter(r => bucketOf(r) === s).length }))
                    .filter(s => s.value > 0);

                setPieData(statusCounts.length > 0 ? statusCounts : [{ name: 'لا يوجد', value: 1 }]);

                // 2. Alerts
                const generatedAlerts = [];
                // Only currently-open delayed cars are actionable — a finished order that ran
                // late last week shouldn't keep the "عاجل" alert on forever.
                const delayedOrders = openCars.filter(r => r.is_delayed || r.status === 'متأخر').length;
                if (delayedOrders > 0) {
                    generatedAlerts.push({
                        icon: Activity, color: "text-rose-500", bg: "bg-rose-500/10", border: "border-rose-500/50",
                        title: "تأخير في الصيانة",
                        desc: `يوجد ${delayedOrders} مركبات متأخرة عن الوقت المقدر!`,
                        time: "عاجل"
                    });
                }
                if (revenue > 0) {
                    generatedAlerts.push({
                        icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-transparent",
                        title: "ملخص مالي مبدئي",
                        desc: `التحصيل اليومي وصل إلى ${formatCurrency(revenue)} د.ع`,
                        time: "اليوم"
                    });
                }
                if (generatedAlerts.length === 0) {
                    generatedAlerts.push({
                        icon: CheckCircle2, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-transparent",
                        title: "العمليات مستقرة", desc: "جميع المهام تسير بانتظام", time: "الآن"
                    });
                }
                setAlerts(generatedAlerts);

                setStats({
                    today: todayCount,
                    inProgress,
                    waiting,
                    completed,
                    revenue
                });
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('en-US').format(val);
    };

    // Compact axis labels: 1500000 -> "1.5M", 25000 -> "25k"
    const formatAxis = (val: number) => {
        if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
        if (Math.abs(val) >= 1_000) return `${Math.round(val / 1_000)}k`;
        return `${val}`;
    };

    // Readable Arabic tooltip for the dashboard performance chart
    const ChartTooltip = ({ active, payload, label }: any) => {
        if (!active || !payload || !payload.length) return null;
        return (
            <div dir="rtl" style={{ background: 'rgba(15,23,42,0.92)', border: '1px solid #333', borderRadius: '12px', padding: '10px 14px', backdropFilter: 'blur(10px)' }}>
                <p style={{ color: '#e2e8f0', fontWeight: 700, marginBottom: 6, fontSize: 13 }}>{label}</p>
                {payload.map((e: any, i: number) => (
                    <p key={i} style={{ color: e.color, fontSize: 12, margin: 0 }}>
                        {e.dataKey === 'revenue'
                            ? `المحصّل (الواصل): ${formatCurrency(e.value)} د.ع`
                            : `أوامر الصيانة: ${e.value}`}
                    </p>
                ))}
            </div>
        );
    };

    if (authLoading) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <Loader2 className="animate-spin text-emerald-500 w-12 h-12" />
            </div>
        );
    }

    if (employeeRole !== 'Owner' && !permissionDashboard) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center p-4 text-center font-ibm" dir="rtl">
                <div className="glass-card p-8 rounded-3xl border border-rose-500/20 max-w-md w-full">
                    <h2 className="text-2xl font-bold text-rose-500 mb-2">غير مصرح بالوصول</h2>
                    <p className="text-muted-foreground mb-6">ليس لديك صلاحية للوصول إلى لوحة التحكم.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen pb-24 font-ibm bg-gradient-to-br from-[var(--color-background)] to-[var(--color-background)]" dir="rtl">

            {/* 1. Header Navigation */}
            <div className="sticky top-0 z-30 bg-card/80 backdrop-blur-xl border-b border-border px-6 py-4 flex items-center justify-between">
                <div className="flex-1 max-w-md hidden md:flex items-center relative">
                    <Search className="absolute right-4 text-muted-foreground" size={18} />
                    <input
                        type="text"
                        placeholder="ابحث في النظام عن فاتورة أو سيارة..."
                        className="w-full bg-card border border-border rounded-xl py-2.5 pr-11 pl-4 text-foreground placeholder-slate-500 focus:outline-none focus:border-rose-500/50 transition-colors"
                    />
                </div>

                <div className="flex items-center gap-4 ms-auto">
                    <NotificationBell direction="down" align="left" />
                    <Link href="/settings" className="p-2.5 bg-card border-border hover:bg-muted rounded-xl border border-border transition-colors text-muted-foreground flex items-center justify-center">
                        <Settings size={20} />
                    </Link>
                    <div className="h-8 w-[1px] bg-muted mx-2 hidden sm:block"></div>
                    <div className="flex items-center gap-3">
                        <div className="text-right hidden sm:block">
                            <p className="text-sm font-bold text-foreground leading-tight">{employeeName || "المستخدم الحالي"}</p>
                            <p className="text-xs text-rose-400">{employeeRole || "تحميل..."}</p>
                        </div>
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-600 to-rose-900 border border-rose-500/30 flex items-center justify-center overflow-hidden shadow-lg shadow-rose-500/20">
                            <User className="text-foreground" size={20} />
                        </div>
                    </div>
                </div>
            </div>

            <div className="p-6 md:p-8 space-y-8 max-w-[1600px] mx-auto animate-fade-in">

                {/* 2. Page Title & Actions */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div>
                        <h1 className="text-3xl font-display font-bold text-foreground mb-2">لوحة التحكم الرئيسية</h1>
                        <p className="text-muted-foreground flex items-center gap-2">
                            نظرة عامة على أداء ومسار أوامر العمل - {new Date().toLocaleDateString('en-GB')}
                        </p>
                    </div>

                    <div className="flex items-center gap-3">
                        <button className="px-5 py-2.5 bg-card border-border hover:bg-muted text-foreground rounded-xl border border-border transition-all font-medium flex items-center gap-2 shadow-sm">
                            <Calendar size={18} className="text-muted-foreground" />
                            حجز موعد
                        </button>
                        <Link href="/reception" className="px-5 py-2.5 bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 text-foreground rounded-xl transition-all font-medium flex items-center gap-2 shadow-lg shadow-rose-500/25 border border-rose-500/50">
                            <Plus size={18} />
                            أمر صيانة جديد
                        </Link>
                        <Link href="/reception?sale=1" className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-foreground rounded-xl transition-all font-medium flex items-center gap-2 shadow-lg shadow-emerald-500/25 border border-emerald-500/50">
                            <ShoppingCart size={18} />
                            بيع منتج
                        </Link>
                    </div>
                </div>

                {/* 3. KPI Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {/* Orders Today */}
                    <div className="glass-card p-6 flex flex-col justify-between rounded-2xl border-border hover:border-blue-500/50 transition-all duration-300 relative group overflow-hidden">
                        <div className="absolute -inset-2 bg-blue-500/5 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        <div className="flex justify-between items-start mb-4 relative z-10">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-xl bg-blue-500/15 text-blue-400 flex flex-col items-center justify-center border border-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.15)]">
                                    <FileText size={24} />
                                </div>
                                <div>
                                    <p className="text-muted-foreground text-sm font-medium mb-1">تم استقبالها اليوم</p>
                                    <h3 className="text-3xl font-bold text-foreground">{loading ? "..." : (stats.today || 0)}</h3>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Completed */}
                    <div className="glass-card p-6 flex flex-col justify-between rounded-2xl border-border hover:border-emerald-500/50 transition-all duration-300 relative group overflow-hidden">
                        <div className="absolute -inset-2 bg-emerald-500/5 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        <div className="flex justify-between items-start mb-4 relative z-10">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-xl bg-emerald-500/15 text-emerald-400 flex flex-col items-center justify-center border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.15)]">
                                    <CheckCircle2 size={24} />
                                </div>
                                <div>
                                    <p className="text-muted-foreground text-sm font-medium mb-1">السيارات المكتملة</p>
                                    <h3 className="text-3xl font-bold text-foreground">{loading ? "..." : (stats.completed || 0)}</h3>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* In Progress */}
                    <div className="glass-card p-6 flex flex-col justify-between rounded-2xl border-border hover:border-amber-500/50 transition-all duration-300 relative group overflow-hidden">
                        <div className="absolute -inset-2 bg-amber-500/5 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        <div className="flex justify-between items-start mb-4 relative z-10">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-xl bg-amber-500/15 text-amber-500 flex flex-col items-center justify-center border border-amber-500/20 shadow-[0_0_15px_rgba(245,158,11,0.15)]">
                                    <Wrench size={24} />
                                </div>
                                <div>
                                    <p className="text-muted-foreground text-sm font-medium mb-1">سيارات قيد العمل</p>
                                    <h3 className="text-3xl font-bold text-foreground">{loading ? "..." : (stats.inProgress || 0)}</h3>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Waiting */}
                    <div className="glass-card p-6 flex flex-col justify-between rounded-2xl border-border hover:border-rose-500/50 transition-all duration-300 relative group overflow-hidden">
                        <div className="absolute -inset-2 bg-rose-500/5 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        <div className="flex justify-between items-start mb-4 relative z-10">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-xl bg-rose-500/15 text-rose-500 flex flex-col items-center justify-center border border-rose-500/20 shadow-[0_0_15px_rgba(244,63,94,0.15)]">
                                    <Clock size={24} />
                                </div>
                                <div>
                                    <p className="text-muted-foreground text-sm font-medium mb-1">السيارات قيد الانتظار</p>
                                    <h3 className="text-3xl font-bold text-foreground">{loading ? "..." : (stats.waiting || 0)}</h3>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 4. Chart & Modules Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Performance Chart (66%) */}
                    <div className="lg:col-span-2 glass-card p-6 rounded-2xl border-border bg-card/80 backdrop-blur-xl hover:border-emerald-500/30 transition-all duration-300">
                        <div className="flex items-center justify-between mb-8">
                            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                                <Activity className="text-emerald-400" size={20} />
                                أداء الورشة والإيرادات
                            </h3>
                            <select className="bg-card border border-border text-muted-foreground text-sm rounded-xl py-1.5 px-3 focus:outline-none focus:border-rose-500/50">
                                <option>آخر 7 أيام نشطة</option>
                            </select>
                        </div>

                        {/* Custom Legend */}
                        <div className="flex items-center justify-center gap-8 mb-6 text-sm">
                            <span className="flex items-center gap-2 text-muted-foreground"><div className="w-3 h-3 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]"></div> أوامر الصيانة</span>
                            <span className="flex items-center gap-2 text-muted-foreground"><div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div> المحصّل (الواصل)</span>
                        </div>

                        <div className="h-[280px] w-full" dir="ltr">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                        </linearGradient>
                                        <linearGradient id="colorOrders" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
                                    <XAxis dataKey="name" stroke="#666" tick={{ fill: '#888', fontSize: 12 }} axisLine={false} tickLine={false} />
                                    <YAxis yAxisId="left" stroke="#666" tick={{ fill: '#888', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={formatAxis} />
                                    <YAxis yAxisId="right" orientation="right" stroke="#666" tick={{ fill: '#888', fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
                                    <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'rgba(16,185,129,0.25)', strokeWidth: 1 }} />
                                    <Area yAxisId="left" type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorRevenue)" activeDot={{ r: 6, strokeWidth: 2, stroke: '#10b981', fill: '#0f172a' }} />
                                    <Area yAxisId="right" type="monotone" dataKey="orders" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorOrders)" activeDot={{ r: 6, strokeWidth: 2, stroke: '#3b82f6', fill: '#0f172a' }} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Status Pie Chart (33%) */}
                    <div className="glass-card p-6 rounded-2xl border-border bg-card/80 backdrop-blur-xl h-full flex flex-col hover:border-blue-500/30 transition-all duration-300">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                                <Car className="text-blue-400" size={20} />
                                توزيع حالات المركبات
                            </h3>
                        </div>

                        <div className="flex-1 min-h-[220px]" dir="ltr">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={pieData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={65}
                                        outerRadius={90}
                                        paddingAngle={6}
                                        dataKey="value"
                                        stroke="none"
                                        cornerRadius={8}
                                    >
                                        {pieData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={['#3b82f6', '#f59e0b', '#f43f5e', '#10b981', '#8b5cf6'][index % 5]} />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.9)', borderColor: '#333', borderRadius: '12px', color: '#fff', backdropFilter: 'blur(10px)', border: 'none' }}
                                        itemStyle={{ color: '#fff' }}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                        
                        {/* Custom Pie Legend */}
                        <div className="flex flex-wrap justify-center gap-4 mt-2 text-sm" dir="rtl">
                            {pieData.map((entry, index) => (
                                <div key={entry.name} className="flex items-center gap-2 text-muted-foreground">
                                    <div className="w-3 h-3 rounded-full shadow-md" style={{ backgroundColor: ['#3b82f6', '#f59e0b', '#f43f5e', '#10b981', '#8b5cf6'][index % 5] }}></div>
                                    <span className="font-medium text-foreground">{entry.name}</span>
                                    <span className="text-xs bg-muted px-1.5 rounded">{entry.value}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* 5. Notifications Board (Full Width) */}
                <div className="glass-card p-4 sm:p-8 rounded-2xl border-border bg-card/80 backdrop-blur-xl flex flex-col max-h-[600px]">
                    <div className="flex items-center justify-between mb-8 pb-4 border-b border-border shrink-0">
                        <h3 className="text-xl font-bold text-foreground flex items-center gap-3">
                            <Bell className="text-amber-400" size={24} />
                            لوحة الإشعارات المباشرة (Live)
                        </h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto custom-scrollbar pr-2 pb-4">
                        {loading ? (
                            <p className="text-muted-foreground">جاري التحميل...</p>
                        ) : alerts.length === 0 ? (
                            <p className="text-muted-foreground">لا توجد إشعارات</p>
                        ) : alerts.map((alert, idx) => (
                            <div key={idx} className="flex items-start gap-5 p-5 rounded-2xl hover:bg-muted/50 transition-colors group border border-border">
                                <div className={`p-3 rounded-xl ${alert.bg} ${alert.color} border ${alert.border} shrink-0`}>
                                    <alert.icon size={24} />
                                </div>
                                <div className="flex-1">
                                    <div className="flex justify-between items-start mb-1">
                                        <h4 className="text-foreground text-base font-bold group-hover:text-foreground transition-colors">{alert.title}</h4>
                                        <span className="text-muted-foreground text-xs whitespace-nowrap bg-background px-2 py-1 rounded-md">{alert.time}</span>
                                    </div>
                                    <p className="text-muted-foreground text-sm leading-snug">{alert.desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

            </div>
        </div>
    );
}

// ------ Live Timer Card Component ------
function WorkOrderCard({ order }: { order: WorkOrder }) {
    const [liveMinutes, setLiveMinutes] = useState(order.elapsed_time || 0);

    let statusColor = "border-border bg-card/50 text-muted-foreground"; // New / Default
    let statusLabel = order.status;

    if (order.status === 'قيد العمل') statusColor = "border-blue-500/50 bg-blue-900/20 text-blue-400"; // In Progress
    if (order.status === 'متأخر' || order.is_delayed) statusColor = "border-rose-500/50 bg-rose-900/20 text-rose-500 shadow-[0_0_15px_rgba(225,29,72,0.2)]"; // Delayed

    // Calculate live timer only if IN PROGRESS
    useEffect(() => {
        if (order.status !== 'قيد العمل' || !order.start_time) return;

        const interval = setInterval(() => {
            const startMs = new Date(order.start_time!).getTime();
            const nowMs = Date.now();
            const diffMins = Math.floor((nowMs - startMs) / 60000);

            setLiveMinutes((order.elapsed_time || 0) + diffMins);
        }, 10000); // Check every 10s

        return () => clearInterval(interval);
    }, [order.status, order.start_time, order.elapsed_time]);

    const isOverdue = order.estimated_duration > 0 && liveMinutes > order.estimated_duration;
    // Override visual if dynamically overdue right now
    if (isOverdue && order.status === 'قيد العمل') {
        statusColor = "border-rose-500/50 bg-rose-900/20 text-rose-500 shadow-[0_0_15px_rgba(225,29,72,0.2)]";
        statusLabel = "متأخر (تلقائي)";
    }

    return (
        <div className={`p-4 rounded-xl relative overflow-hidden group border transition-all duration-300 flex flex-col justify-between h-full bg-muted hover:bg-muted/80 ${statusColor.split(' ')[0]}`}>
            <div className="mb-3">
                <div className="flex justify-between items-start mb-2">
                    <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${statusColor}`}>
                        {statusLabel}
                    </div>
                    <span className="font-mono text-muted-foreground text-xs">#{order.report_number}</span>
                </div>

                <h3 className="text-foreground font-bold text-sm mb-1 truncate flex items-center gap-1">
                    <Car size={12} className="text-muted-foreground" /> {order.vehicles?.make} {order.vehicles?.model}
                </h3>
            </div>

            <div className="border-t border-border pt-3 mt-auto">
                <div className="flex justify-between items-center mb-2">
                    <div className="text-right w-1/2">
                        <p className="text-[10px] text-muted-foreground mb-0.5">المقدر</p>
                        <p className="text-foreground font-mono font-bold text-sm">{order.estimated_duration || 0}m</p>
                    </div>
                    <div className="text-left w-1/2">
                        <p className="text-[10px] text-muted-foreground mb-0.5">الحي</p>
                        <p className={`font-mono font-bold text-sm ${isOverdue ? 'text-rose-500 animate-pulse' : 'text-blue-400'}`}>
                            {liveMinutes}m
                        </p>
                    </div>
                </div>

                <div className="h-1 w-full bg-card rounded-full overflow-hidden mb-3">
                    <div
                        className={`h-full rounded-full transition-all duration-1000 ${isOverdue ? 'bg-rose-500' : 'bg-blue-500'}`}
                        style={{ width: `${Math.min((liveMinutes / (order.estimated_duration || 1)) * 100, 100)}%` }}
                    />
                </div>

                <Link href={`/work-orders/${order.id}`} className="w-full py-1.5 bg-card hover:bg-muted rounded-lg text-center text-xs font-bold text-muted-foreground hover:text-foreground transition-colors block border border-border">
                    تفاصيل التذكرة
                </Link>
            </div>
        </div>
    );
}
