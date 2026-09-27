"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthProvider";
import { Wrench, ShieldAlert, Shield, ArrowLeft, Car, Activity, Loader2, Gauge, Search } from "lucide-react";
import Link from "next/link";

type WorkOrderList = {
    id: string;
    report_number: number;
    status: string;
    bay_number: string | null;
    start_time: string | null;
    elapsed_time: number | null;
    odometer_reading: number;
    odometer_unit?: string;
    vehicles: { make: string; model: string; plate_number: string; clients?: { name: string } | null };
    technician: { name: string } | null;
    created_at: string;
    estimated_duration: number;
    is_delayed: boolean;
    selected_services: any[] | null;
    contract_id?: string | null;
    contract?: { name: string } | null;
};

export default function WorkOrdersListPage() {
    const { employeeRole, employeeBranchId, permissionWorkOrders, loading: authLoading } = useAuth();
    const [orders, setOrders] = useState<WorkOrderList[]>([]);
    const [loading, setLoading] = useState(true);
    const [now, setNow] = useState(() => Date.now());
    
    const [branches, setBranches] = useState<{id: string, name: string}[]>([]);
    // "" is a real choice here — it means كل الفروع. `branchReady` tells the two apart
    // from "we haven't resolved the branch list yet", which is why the fetch waits on
    // the flag instead of on the id being truthy.
    const [selectedBranchId, setSelectedBranchId] = useState("");
    const [branchReady, setBranchReady] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    // Debounce timer for the realtime refetch — bursts of events collapse into one silent refresh.
    const realtimeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Hooks must run unconditionally (Rules of Hooks). Access guards early-return
    // below, after every hook/handler is declared.
    const isAuthorized = employeeRole === 'Owner' || permissionWorkOrders;
    // Owner/Admin drive the branch from this page's own dropdown (which offers كل الفروع).
    // Everyone else is locked to the branch on their employee record.
    const isBranchAdmin = employeeRole === 'Owner' || employeeRole === 'Admin';
    const isBranchPinned = !!employeeBranchId && !isBranchAdmin;
    const activeBranchId = isBranchPinned ? employeeBranchId : (selectedBranchId || null);

    // Filter the live orders by report number, plate, customer name, make/model or bay.
    const q = searchTerm.trim().toLowerCase();
    const filteredOrders = !q ? orders : orders.filter(o => {
        const clients = o.vehicles?.clients;
        const clientName = Array.isArray(clients) ? clients[0]?.name : (clients as { name?: string } | undefined)?.name;
        return [String(o.report_number), o.vehicles?.make, o.vehicles?.model, o.vehicles?.plate_number, clientName, o.bay_number]
            .filter(Boolean)
            .some(v => String(v).toLowerCase().includes(q));
    });

    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 1000); // Check every second
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        const fetchBranches = async () => {
            const { data } = await supabase.from('branches').select('id, name');
            if (data && data.length > 0) {
                setBranches(data);
                // Start on the branch the sidebar has active. With none active, Owner/Admin
                // open on كل الفروع instead of silently landing on the first branch in the
                // list; anyone else keeps opening on a single branch as before.
                setSelectedBranchId(employeeBranchId || (isBranchAdmin ? "" : data[0].id));
            }
            setBranchReady(true);
        };
        fetchBranches();
    }, [employeeBranchId, isBranchAdmin]);

    useEffect(() => {
        if (authLoading || !isAuthorized) return;
        if (!branchReady) return; // Wait until the branch list has resolved

        fetchOrders();

        const channel = supabase.channel('work_orders_realtime')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'inspection_reports' }, () => {
                // Trailing debounce: refetch once, ~500ms after the last event (silent — no spinner).
                if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
                realtimeTimer.current = setTimeout(() => fetchOrders(), 500);
            })
            .subscribe();

        return () => {
            if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
            supabase.removeChannel(channel);
        };
    }, [employeeBranchId, employeeRole, selectedBranchId, branchReady, authLoading, isAuthorized]);



    const fetchOrders = async () => {
        let query = supabase
            .from('inspection_reports')
            .select(`id, report_number, status, created_at, estimated_duration, is_delayed, odometer_reading, odometer_unit, bay_number, start_time, elapsed_time, contract_id, contract:contracts(name), vehicles (make, model, plate_number, clients (name)), selected_services`)
            .neq('status', 'تم الانتهاء')
            .neq('status', 'ملغى')
            // NULL-safe: `<>` is false for NULL, so a plain .neq dropped legacy rows with no order_type.
            .or('order_type.is.null,order_type.neq.sale')
            .order('created_at', { ascending: false });

        // null = كل الفروع, so no branch predicate at all.
        if (activeBranchId) {
            query = query.eq('branch_id', activeBranchId);
        }

        const { data } = await query;
        if (data) setOrders(data as any);
        setLoading(false);
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
                    <p className="text-muted-foreground mb-6">ليس لديك صلاحية للوصول إلى ساحة الورشة والعمل الحي.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen p-4 md:p-8 font-ibm" dir="rtl">
            <div className="max-w-7xl mx-auto space-y-8 animate-fade-in">

                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-border">
                    <div>
                        <h1 className="text-3xl font-display font-bold text-foreground mb-2 flex items-center gap-3">
                            <Wrench className="text-blue-500" size={32} />
                            ساحة الورشة (أوامر العمل)
                        </h1>
                        <p className="text-muted-foreground">
                            إدارة العمليات، مراقبة الوقت، وتوجيه السيارات للفنيين
                        </p>
                    </div>
                    <div className="flex items-center gap-4">
                        {/* Branch Dropdown Select */}
                        {branches.length > 0 && (employeeRole === 'Owner' || employeeRole === 'Admin' || !employeeBranchId) && (
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-muted-foreground">الفرع:</span>
                                <select
                                    value={selectedBranchId}
                                    onChange={(e) => setSelectedBranchId(e.target.value)}
                                    className="bg-card border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:border-blue-500/50 cursor-pointer hover:border-border/80 transition-colors"
                                >
                                    <option value="">كل الفروع</option>
                                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                </select>
                            </div>
                        )}
                        <Link href="/reception" className="btn-primary flex items-center gap-2 whitespace-nowrap px-6 py-2">
                            <span>+</span> أمر عمل جديد
                        </Link>
                    </div>
                </div>

                {/* Search */}
                <div className="relative">
                    <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" size={18} />
                    <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="بحث برقم التقرير، اللوحة، العميل، نوع السيارة، أو الخانة..."
                        className="input-field w-full"
                        style={{ paddingRight: '3rem' }}
                    />
                </div>

                {loading ? (
                    <div className="flex justify-center p-20"><div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
                ) : filteredOrders.length === 0 ? (
                    <div className="glass-card p-12 text-center text-muted-foreground rounded-2xl border-border">
                        {orders.length === 0 ? "لا يوجد مركبات في الورشة حالياً." : "لا توجد نتائج مطابقة للبحث."}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {filteredOrders.map(order => {
                            let currentLiveSeconds = (order.elapsed_time || 0) * 60;
                            if (order.status === 'قيد العمل' && order.start_time) {
                                const startMs = new Date(order.start_time).getTime();
                                currentLiveSeconds += Math.floor((now - startMs) / 1000);
                            }
                            
                            const totalEstimatedSeconds = order.estimated_duration * 60;
                            const remainingSeconds = totalEstimatedSeconds - currentLiveSeconds;
                            const isTimerDanger = remainingSeconds <= 0;
                            
                            const absRemaining = Math.abs(remainingSeconds);
                            const fmtHMS = (total: number) => {
                                const s = Math.max(0, Math.floor(total));
                                const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
                                const pad = (n: number) => n.toString().padStart(2, '0');
                                return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
                            };
                            const timeString = fmtHMS(absRemaining);
                            
                            return (
                            <div key={order.id} className="glass-card p-6 rounded-2xl border-border relative group overflow-hidden transition-all hover:border-blue-500/30 flex flex-col justify-between">
                                <div>
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="flex flex-col gap-2">
                                            <span className={`text-xs font-bold px-3 py-1.5 rounded-lg inline-flex items-center gap-1 w-max ${
                                                order.status === 'تم الانتهاء' ? 'bg-emerald-500/10 text-emerald-500' :
                                                order.status === 'قيد العمل' ? 'bg-blue-500/10 text-blue-500' :
                                                'bg-amber-500/10 text-amber-500'
                                            }`}>
                                                {order.status}
                                            </span>
                                            {order.contract_id && (
                                                <span className="text-[10px] font-bold px-2 py-1 rounded-lg w-max bg-amber-500/15 text-amber-400 border border-amber-500/30">
                                                    عقد {order.contract?.name || ""}
                                                </span>
                                            )}
                                        </div>
                                        <span className="font-mono text-muted-foreground font-bold text-lg">#{order.report_number}</span>
                                    </div>
                                    
                                    <div className="flex items-center gap-4 mb-5">
                                        <div className="w-12 h-12 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center shrink-0">
                                            <Car size={24} />
                                        </div>
                                        <div className="min-w-0">
                                            <h3 className="font-bold text-lg text-foreground truncate">{order.vehicles?.make} {order.vehicles?.model}</h3>
                                            <p className="text-sm text-muted-foreground font-mono mt-1" dir="ltr">
                                                {order.vehicles?.plate_number} 
                                                {order.vehicles?.clients && (Array.isArray(order.vehicles.clients) ? order.vehicles.clients[0]?.name : order.vehicles.clients.name) ? ` • ${Array.isArray(order.vehicles.clients) ? order.vehicles.clients[0]?.name : order.vehicles.clients.name}` : ''}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex flex-col gap-1.5 mb-4 text-sm font-bold text-muted-foreground border-b border-border/50 pb-3">
                                        <div className="flex items-center gap-2">
                                            <Shield className="text-rose-400" size={16} /> المشرف: <span className="text-foreground">{order.selected_services?.[0]?.shiftSupervisor || 'غير محدد'}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Wrench className="text-blue-400" size={16} /> الفني: <span className="text-foreground">{order.selected_services?.[0]?.technicianName || 'غير محدد'}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Activity className="text-emerald-400" size={16} /> رقم الخانة: <span className="text-foreground">{order.bay_number || 'غير محدد'}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Gauge className="text-cyan-400" size={16} /> عداد السيارة: <span className="text-foreground">{order.odometer_reading ? `${order.odometer_reading.toLocaleString()} ${order.odometer_unit === 'mi' ? 'ميل' : 'كم'}` : 'غير محدد'}</span>
                                        </div>
                                    </div>

                                    <div className="space-y-3 mb-6">
                                        <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-background/50 border border-border">
                                            <span className="text-sm text-muted-foreground mb-1">الوقت المتبقي</span>
                                            <div className={`text-4xl font-black font-mono tracking-wider ${isTimerDanger ? 'text-rose-500' : 'text-emerald-500'}`}>
                                                {order.status === 'قيد العمل' ? (
                                                    remainingSeconds > 0 ? timeString : `-${timeString}`
                                                ) : (
                                                    order.estimated_duration > 0 ? fmtHMS(order.estimated_duration * 60) : '—'
                                                )}
                                            </div>
                                        </div>
                                        {/* Delay Warning */}
                                        {(order.is_delayed || order.status === 'متأخر' || isTimerDanger) && order.status === 'قيد العمل' && (
                                            <div className="flex justify-center items-center gap-1 text-rose-500 text-sm font-bold bg-rose-500/10 px-3 py-2 rounded-lg">
                                                <ShieldAlert size={16} /> تجاوز الوقت المحدد!
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="flex gap-3">
                                    <Link href={`/work-orders/${order.id}`} className="flex-1 flex items-center justify-center gap-2 py-3 bg-muted hover:bg-blue-600 hover:text-white text-muted-foreground transition-colors font-bold rounded-xl text-base border border-transparent hover:border-blue-500 shadow-sm">
                                        تفاصيل الصيانة <ArrowLeft size={18} />
                                    </Link>
                                    <Link href={`/reception?edit=${order.id}`} className="px-5 py-3 bg-muted hover:bg-rose-600/10 hover:text-rose-500 text-muted-foreground transition-colors font-bold rounded-xl text-base border border-transparent hover:border-rose-500/30">
                                        تعديل
                                    </Link>
                                </div>
                            </div>
                        )})}
                    </div>
                )}
            </div>
        </div>
    );
}
