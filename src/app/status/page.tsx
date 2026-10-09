"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthProvider";
import { Activity, Clock, CheckCircle2, AlertCircle, Car, User, ArrowLeft, Wrench, X, Save, Timer } from "lucide-react";
import Link from "next/link";
import { showError, showSuccess } from "@/lib/alerts";

type WorkOrder = {
    id: string;
    report_number: number;
    status: string;
    estimated_duration: number;
    elapsed_time: number;
    start_time: string | null;
    is_delayed: boolean;
    vehicles: { make: string; model: string; plate_number: string, clients: { name: string; phone: string } };
    bay_number: string | null;
    technician_id: string | null;
};

// Fields the board reads fresh before moving a card off the floor.
type FreshRow = {
    status?: string;
    start_time?: string | null;
    elapsed_time?: number | null;
    estimated_duration?: number | null;
    order_type?: string | null;
    selected_services?: unknown;
    technician_rating?: string | null;
};
type FirstPayload = { technicians?: { name?: string; rating?: string }[]; technicianName?: string; shiftSupervisor?: string };

const COLUMNS = [
    { id: 'تم الاستلام', label: 'تم الاستلام (قيد الانتظار)', icon: Clock, color: 'text-muted-foreground', border: 'border-border', bg: 'bg-card' },
    { id: 'قيد العمل', label: 'جاري العمل (بالورشة)', icon: Activity, color: 'text-blue-400', border: 'border-blue-500/30', bg: 'bg-blue-900/10' },
    { id: 'تم الانتهاء', label: 'مكتمل (جاهز للتسليم)', icon: CheckCircle2, color: 'text-emerald-400', border: 'border-emerald-500/30', bg: 'bg-emerald-900/10' },
    { id: 'متأخر', label: 'متأخر (تنبيه)', icon: AlertCircle, color: 'text-rose-500', border: 'border-rose-500/30', bg: 'bg-rose-900/10' },
];

export default function KanbanStatusPage() {
    const { employeeRole, employeeBranchId } = useAuth();
    const [orders, setOrders] = useState<WorkOrder[]>([]);
    const [loading, setLoading] = useState(true);
    
    // Assignment Modal State
    const [technicians, setTechnicians] = useState<any[]>([]);
    const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
    const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
    const [assignData, setAssignData] = useState({
        technician_id: "",
        bay_number: "",
        estimated_duration: "60"
    });

    useEffect(() => {
        fetchOrders();
        // The board is meant to feel live, so keep the refresh short — but one refetch
        // per event meant a burst of order changes fired a burst of queries. A 5s
        // throttle collapses those while still tracking the floor closely.
        let timer: ReturnType<typeof setTimeout> | null = null;
        const channel = supabase.channel('kanban_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'inspection_reports' }, () => {
                if (timer) return;
                timer = setTimeout(() => { timer = null; fetchOrders(); }, 5000);
            })
            .subscribe();

        return () => { if (timer) clearTimeout(timer); supabase.removeChannel(channel); };
    }, [employeeRole, employeeBranchId]);

    useEffect(() => {
        // Fetch technicians
        const fetchTechs = async () => {
            let empQuery = supabase.from('employees').select('*').in('role', ['Supervisor', 'Admin', 'Owner']);
            if (employeeBranchId) {
                empQuery = empQuery.eq('branch_id', employeeBranchId);
            }
            const { data } = await empQuery;
            if (data) setTechnicians(data);
        };
        fetchTechs();
    }, [employeeRole, employeeBranchId]);

    const fetchOrders = async () => {
        setLoading(true);
        let query = supabase
            .from('inspection_reports')
            .select(`
                id, report_number, status, estimated_duration, elapsed_time, start_time, is_delayed, bay_number, technician_id,
                vehicles (make, model, plate_number, clients (name, phone))
            `)
            .neq('status', 'تم الانتهاء')
            .neq('status', 'ملغى')
            .order('created_at', { ascending: false });

        if (employeeBranchId) {
            query = query.eq('branch_id', employeeBranchId);
        }

        const { data, error } = await query;

        if (!error && data) {
            setOrders(data as any);
        }
        setLoading(false);
    };

    const handleChangeStatus = async (orderId: string, newStatus: string) => {
        if (!orderId || !newStatus) return;

        const currentOrder = orders.find(o => o.id === orderId);

        // If moving to "قيد العمل" from "تم الاستلام", open assignment modal
        if (newStatus === 'قيد العمل' && currentOrder?.status === 'تم الاستلام') {
            handleOpenAssignModal(orderId);
            return;
        }

        // Read the fresh row: completing needs the real timer fields and technician data.
        const { data: fresh } = await supabase.from('inspection_reports')
            .select('status, start_time, elapsed_time, estimated_duration, order_type, selected_services, technician_rating')
            .eq('id', orderId).single();
        const freshRow: FreshRow | undefined = fresh ?? currentOrder;
        const wasRunning = freshRow?.status === 'قيد العمل' || freshRow?.status === 'متأخر';
        // Same timer math as the work-order page's handleComplete: bank the running
        // segment into elapsed_time whenever the card leaves the floor.
        let finalElapsed = freshRow?.elapsed_time || 0;
        if (wasRunning && freshRow?.start_time) {
            finalElapsed += Math.floor((new Date().getTime() - new Date(freshRow.start_time).getTime()) / 60000);
        }

        // Same completion lock as the work-order page: maintenance orders need a supervisor
        // and at least one technician, each with a rating.
        if (newStatus === 'تم الانتهاء' && freshRow?.order_type !== 'sale') {
            const ss = freshRow?.selected_services;
            const p0 = (Array.isArray(ss) ? ss[0] : ss) as FirstPayload | undefined;
            const techs = (Array.isArray(p0?.technicians) ? p0.technicians : []).filter(t => String(t?.name || '').trim());
            const techsOk = techs.length > 0
                ? techs.every(t => !!t?.rating)
                : !!String(p0?.technicianName || '').trim() && !!freshRow?.technician_rating;
            if (!techsOk || !String(p0?.shiftSupervisor || '').trim()) {
                showError("لا يمكن إنهاء المهمة", "أكمل أسماء الفنيين وتقييمهم واسم المشرف من صفحة تفاصيل أمر العمل قبل الإنهاء.");
                return;
            }
        }

        // Optimistic UI update
        const previousOrders = [...orders];
        setOrders(orders.map(o => o.id === orderId ? { ...o, status: newStatus } : o));

        // Db Update
        const updateData: any = { status: newStatus };
        if (wasRunning && newStatus !== 'قيد العمل') {
            updateData.elapsed_time = finalElapsed;
        }

        // If moved to "تم الانتهاء", log completed_at
        if (newStatus === 'تم الانتهاء') {
            updateData.completed_at = new Date().toISOString();
            updateData.end_time = new Date().toISOString();
            updateData.is_delayed = finalElapsed > (freshRow?.estimated_duration || 0);
        } else {
            updateData.completed_at = null;
            if (newStatus === 'قيد العمل' && !wasRunning) {
                updateData.start_time = new Date().toISOString();
            }
        }

        const { error } = await supabase.from('inspection_reports').update(updateData).eq('id', orderId);
        
        if (error) {
            showError("فشل التحديث", "حدث خطأ أثناء تغيير الحالة.");
            setOrders(previousOrders); // Revert UI
            fetchOrders();
        } else {
            showSuccess("تم التحديث", `تم نقل المركبة إلى: ${newStatus}`);
        }
    };

    const handleOpenAssignModal = (orderId: string) => {
        setSelectedOrderId(orderId);
        // Prefill from the card so editing a running assignment doesn't reset its estimate.
        const o = orders.find(x => x.id === orderId);
        setAssignData({
            technician_id: o?.technician_id || "",
            bay_number: o?.bay_number || "",
            estimated_duration: o?.estimated_duration ? String(o.estimated_duration) : "60",
        });
        setIsAssignModalOpen(true);
    };

    const handleSaveAssignment = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedOrderId) return;

        const o = orders.find(x => x.id === selectedOrderId);
        const isRunning = o?.status === 'قيد العمل' || o?.status === 'متأخر';
        const update: Record<string, unknown> = {
            technician_id: assignData.technician_id || null,
            bay_number: assignData.bay_number,
            status: 'قيد العمل',
        };
        // Keep an existing estimate unless one was actually entered.
        const est = parseInt(assignData.estimated_duration);
        if (est > 0) update.estimated_duration = est;
        else if (!o?.estimated_duration) update.estimated_duration = 60;
        // Re-assigning a running card must not restart its timer.
        if (!isRunning) update.start_time = new Date().toISOString();

        const { error } = await supabase.from('inspection_reports').update(update).eq('id', selectedOrderId);

        if (error) {
            showError("فشل", "حدث خطأ أثناء إسناد المهمة");
        } else {
            showSuccess("تم الإسناد", "تم بدء العمل على المركبة بنجاح");
            setIsAssignModalOpen(false);
            fetchOrders();
        }
    };

    return (
        <div className="min-h-screen p-4 md:p-8 font-ibm bg-background" dir="rtl">
            <div className="max-w-[1600px] mx-auto space-y-8 animate-fade-in">
                
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div>
                        <h1 className="text-3xl font-display font-bold text-foreground mb-2 flex items-center gap-3">
                            <Activity className="text-blue-500" size={32} />
                            لوحة متابعة الورشة (Kanban)
                        </h1>
                        <p className="text-muted-foreground">
                            قم بتغيير حالة أوامر العمل بسهولة باستخدام القائمة المنسدلة
                        </p>
                    </div>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" /></div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 items-start">
                        {COLUMNS.map(column => {
                            const columnOrders = orders.filter(o => {
                                if (column.id === 'متأخر') return o.is_delayed || o.status === 'متأخر';
                                if (o.is_delayed && o.status !== 'تم الانتهاء') return false; // Hide from standard cols if delayed
                                // «انتظار» has no column of its own; park it with the waiting (received) cards.
                                if (o.status === 'بانتظار العميل') return column.id === 'تم الاستلام';
                                return o.status === column.id;
                            });

                            return (
                                <div 
                                    key={column.id}
                                    className={`glass-card rounded-2xl border ${column.border} ${column.bg} p-4 min-h-[500px]`}
                                >
                                    <div className="flex items-center justify-between mb-4 border-b border-border pb-4">
                                        <h2 className={`font-bold flex items-center gap-2 ${column.color}`}>
                                            <column.icon size={18} />
                                            {column.label}
                                        </h2>
                                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full bg-muted border border-border text-muted-foreground`}>
                                            {columnOrders.length}
                                        </span>
                                    </div>

                                    <div className="space-y-4">
                                        {columnOrders.map(order => (
                                            <div 
                                                key={order.id}
                                                className="bg-muted border border-border p-4 rounded-xl transition-all shadow-sm flex flex-col h-full"
                                            >
                                                <div className="flex justify-between items-start mb-3">
                                                    <span className="font-mono text-muted-foreground text-xs bg-muted/80 px-2 py-0.5 rounded border border-border">#{order.report_number}</span>
                                                    {(order.is_delayed || order.status === 'متأخر') && (
                                                        <span className="text-[10px] bg-rose-500/10 text-rose-500 border border-rose-500/20 px-2 py-0.5 rounded flex items-center gap-1 font-bold">
                                                            <AlertCircle size={10} /> متأخر
                                                        </span>
                                                    )}
                                                    {order.status === 'بانتظار العميل' && (
                                                        <span className="text-[10px] bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2 py-0.5 rounded font-bold">
                                                            بانتظار العميل
                                                        </span>
                                                    )}
                                                </div>

                                                <h3 className="text-foreground font-bold text-sm mb-1 flex items-center gap-2 truncate">
                                                    <Car size={14} className="text-muted-foreground shrink-0" /> 
                                                    <span className="truncate">{order.vehicles?.make} {order.vehicles?.model}</span>
                                                </h3>
                                                <p className="text-muted-foreground text-xs flex items-center gap-2 truncate mb-4">
                                                    <User size={14} className="shrink-0" /> 
                                                    <span className="truncate">{order.vehicles?.clients?.name || 'غير محدد'}</span>
                                                </p>

                                                <div className="flex items-center justify-between mt-auto pt-3 border-t border-border gap-2">
                                                    {(column.id === 'تم الاستلام' && (employeeRole === 'Supervisor' || employeeRole === 'Admin' || employeeRole === 'Owner')) ? (
                                                        <button 
                                                            onClick={() => handleOpenAssignModal(order.id)}
                                                            className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-colors"
                                                        >
                                                            <Wrench size={14} /> إسناد للورشة
                                                        </button>
                                                    ) : (
                                                        <button 
                                                            onClick={() => handleOpenAssignModal(order.id)}
                                                            className="text-[10px] text-muted-foreground hover:text-foreground font-mono bg-black/30 hover:bg-black/50 px-2 py-1 rounded transition-colors cursor-pointer"
                                                            title="تعديل الإسناد"
                                                        >
                                                            {order.bay_number ? `خانة: ${order.bay_number}` : (order.vehicles?.plate_number || '---')}
                                                        </button>
                                                    )}
                                                    <div className="flex items-center gap-2">
                                                        <select 
                                                            value={order.status === 'متأخر' ? 'قيد العمل' : order.status}
                                                            onChange={(e) => handleChangeStatus(order.id, e.target.value)}
                                                            className="text-xs bg-card border border-border text-foreground rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-500 flex-1 min-w-0"
                                                        >
                                                            <option value="تم الاستلام">الاستلام</option>
                                                            <option value="قيد العمل">الورشة</option>
                                                            <option value="بانتظار العميل">انتظار</option>
                                                            <option value="تم الانتهاء">مكتمل</option>
                                                        </select>

                                                        <Link 
                                                            href={`/work-orders/${order.id}`}
                                                            className="p-1.5 bg-blue-500/10 text-blue-500 hover:bg-blue-500 hover:text-white rounded-lg transition-colors shrink-0"
                                                            title="التفاصيل"
                                                        >
                                                            <ArrowLeft size={16} />
                                                        </Link>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}

                                        {columnOrders.length === 0 && (
                                            <div className="text-center p-6 border-2 border-dashed border-border rounded-xl">
                                                <p className="text-muted-foreground text-sm">لا توجد بطاقات في هذه الحالة</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Assignment Modal */}
                {isAssignModalOpen && (
                    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" dir="rtl">
                        <form onSubmit={handleSaveAssignment} className="bg-card border border-cyan-900/40 rounded-[24px] w-full max-w-sm shadow-[0_0_50px_rgba(6,182,212,0.15)] overflow-hidden flex flex-col relative animate-in zoom-in duration-200">
                            <div className="p-5 border-b border-border bg-gradient-to-l from-slate-900 to-[#050505] flex items-center justify-between">
                                <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                                    <Wrench className="text-cyan-500" /> إسناد المركبة لورشة العمل
                                </h2>
                                <button type="button" onClick={() => setIsAssignModalOpen(false)} className="text-muted-foreground hover:text-foreground bg-muted p-1.5 rounded-lg">
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="p-5 space-y-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-muted-foreground">الخانة (Bay) <span className="text-rose-500">*</span></label>
                                    <input required type="text" placeholder="مثال: الخانة 1 أو A" className="w-full bg-background border border-border rounded-xl p-3 text-foreground focus:border-cyan-500" value={assignData.bay_number} onChange={e => setAssignData({...assignData, bay_number: e.target.value})} />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-muted-foreground">الفني المسؤول (اختياري)</label>
                                    <select className="w-full bg-background border border-border rounded-xl p-3 text-foreground focus:border-cyan-500" value={assignData.technician_id} onChange={e => setAssignData({...assignData, technician_id: e.target.value})}>
                                        <option value="">-- غير محدد --</option>
                                        {technicians.map(t => (
                                            <option key={t.id} value={t.id}>{t.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-muted-foreground flex items-center gap-1"><Timer size={14} /> الوقت المقدر لإنجاز العمل (دقائق)</label>
                                    <input required type="number" min="1" className="w-full bg-background border border-border rounded-xl p-3 text-foreground focus:border-cyan-500 font-mono" value={assignData.estimated_duration} onChange={e => setAssignData({...assignData, estimated_duration: e.target.value})} />
                                </div>
                            </div>
                            
                            <div className="p-5 border-t border-border bg-muted/30 flex gap-3">
                                <button type="button" onClick={() => setIsAssignModalOpen(false)} className="flex-1 px-4 py-2.5 rounded-xl text-muted-foreground hover:bg-muted border border-transparent hover:border-border transition-colors font-medium">إلغاء</button>
                                <button type="submit" className="flex-[2] px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold transition flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
                                    <Save size={18} /> حفظ وبدء العمل
                                </button>
                            </div>
                        </form>
                    </div>
                )}
            </div>
        </div>
    );
}
