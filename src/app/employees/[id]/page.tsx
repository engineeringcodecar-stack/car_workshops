"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ClipboardList, Loader2, MessageSquareWarning, Target, UserRound, Wrench } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthProvider";
import { showError, showSuccess } from "@/lib/alerts";

type TargetRow = { id: string; metric_key: string; title: string; target_value: number; unit: string; period_start: string; period_end: string; inventory_id?: string | null; service_filter?: string | null };
type Task = { id: string; title: string; details: string | null; due_date: string | null; status: string };
type Complaint = { id: string; report_id: string | null; client_id?: string | null; summary: string; details: string | null; status: string; received_at: string; report?: { report_number: number } | null };
const today = () => new Date().toISOString().slice(0, 10);
const errorText = (e: any) => String(e?.message || e || "حدث خطأ غير معروف");
const SERVICE_LABELS: Record<string, string> = { engineOil: "زيت المحرك", oilFilter: "فلتر زيت المحرك", airFilter: "فلتر الهواء", acFilter: "فلتر التبريد", brakeFluid: "زيت المكابح", coolant: "ماء الراديتر", battery: "البطارية", engineBelts: "قايش المحرك", brakePads: "دسكات السيارة", sparkPlugs: "شمعات الاحتراق", gearboxHydraulic: "هايدروليك الكير", differentialOil: "زيت الدفرنس", tires: "الإطارات", carWash: "غسل السيارة" };
const servicesOf = (row: any) => {
    const payload = Array.isArray(row?.selected_services) ? row.selected_services[0] : row?.selected_services;
    const serviceNames = Object.keys(payload?.services || {}).map(key => SERVICE_LABELS[key] || key);
    serviceNames.push(...Object.keys(payload?.freeServices || {}).filter(key => payload.freeServices[key]).map(key => SERVICE_LABELS[key] || key));
    if (Array.isArray(payload?.customServices)) serviceNames.push(...payload.customServices.map((service: any) => String(service?.label || service?.name || "")).filter(Boolean));
    return serviceNames.join("، ") || "—";
};
const isAssignedTechByName = (row: any, name: string) => {
    const payload = Array.isArray(row?.selected_services) ? row.selected_services[0] : row?.selected_services;
    const names = [...(Array.isArray(payload?.technicians) ? payload.technicians.map((tech: any) => String(tech?.name || "")) : []), String(payload?.technicianName || "")];
    return names.some((techName: string) => techName.trim() && techName.trim() === name.trim());
};

export default function EmployeeProfilePage() {
    const { id } = useParams<{ id: string }>();
    const { employeeId, employeeRole, employeeBranchId, permissionInventoryPrices, loading: authLoading } = useAuth();
    const isAdmin = employeeRole === "Owner" || employeeRole === "Admin";
    const canSeePrices = isAdmin || !!permissionInventoryPrices;
    const [employee, setEmployee] = useState<any>(null);
    const [targets, setTargets] = useState<TargetRow[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [complaints, setComplaints] = useState<Complaint[]>([]);
    const [received, setReceived] = useState<any[]>([]);
    const [assigned, setAssigned] = useState<any[]>([]);
    const [reports, setReports] = useState<any[]>([]);
    const [stockItems, setStockItems] = useState<{ id: string; name: string }[]>([]);
    const [loading, setLoading] = useState(true);
    const [showTarget, setShowTarget] = useState(false);
    const [showTask, setShowTask] = useState(false);
    const [showComplaint, setShowComplaint] = useState(false);
    const [targetForm, setTargetForm] = useState({ title: "", metric_key: "cars_received", target_value: "10", unit: "سيارة", period_start: today(), period_end: today(), inventory_id: "", service_filter: "" });
    const [taskForm, setTaskForm] = useState({ title: "", details: "", due_date: today() });
    const [complaintForm, setComplaintForm] = useState({ report_id: "", summary: "", details: "" });

    const fetchProfile = useCallback(async () => {
        if (!id) return;
        setLoading(true);
        try {
            const [emp, targetRows, taskRows, complaintRows, receptionRows, techRows, techNameRows, reportRows, stockRows] = await Promise.all([
                supabase.from("employees").select("id,name,role,phone,branch_id,created_at,branches(name)").eq("id", id).maybeSingle(),
                (supabase as any).from("employee_targets").select("id,metric_key,title,target_value,unit,period_start,period_end,inventory_id,service_filter").eq("employee_id", id).gte("period_end", today()).order("period_start"),
                (supabase as any).from("employee_tasks").select("id,title,details,due_date,status").eq("employee_id", id).order("created_at", { ascending: false }),
                (supabase as any).from("service_complaints").select("id,report_id,client_id,summary,details,status,received_at").eq("employee_id", id).order("received_at", { ascending: false }),
                supabase.from("inspection_reports").select(`id,report_number,status,order_type,${canSeePrices ? "total_price," : ""}created_at,completed_at,selected_services,receptionist_id`).eq("receptionist_id", id).order("created_at", { ascending: false }).limit(300),
                (supabase as any).from("inspection_reports").select(`id,report_number,status,order_type,technician_rating,${canSeePrices ? "total_price," : ""}created_at,completed_at,selected_services,technician_id`).eq("technician_id", id).order("created_at", { ascending: false }).limit(300),
                (supabase as any).from("inspection_reports").select(`id,report_number,status,order_type,technician_rating,${canSeePrices ? "total_price," : ""}created_at,completed_at,selected_services,technician_id`).or("order_type.is.null,order_type.neq.sale").order("created_at", { ascending: false }).limit(1000),
                supabase.from("inspection_reports").select("id,report_number,created_at,vehicle_id,vehicles(client_id,make,model,plate_number,clients(name))").order("created_at", { ascending: false }).limit(300),
                supabase.from("inventory").select("id,name,branch_id").order("name").limit(1000),
            ]);
            if (emp.error) throw emp.error;
            setEmployee(emp.data);
            setTargets((targetRows.data || []) as unknown as TargetRow[]); setTasks((taskRows.data || []) as unknown as Task[]); setComplaints((complaintRows.data || []) as unknown as Complaint[]);
            const assignedRows = [...(techRows.data || []), ...(techNameRows.data || []).filter((row: any) => isAssignedTechByName(row, emp.data?.name || ""))];
            setReceived(receptionRows.data || []); setAssigned([...new Map(assignedRows.map(row => [row.id, row])).values()]); setReports(reportRows.data || []); setStockItems((stockRows.data || []) as { id: string; name: string }[]);
        } catch (e) { showError("تعذر تحميل ملف الموظف", errorText(e)); }
        finally { setLoading(false); }
    }, [id, canSeePrices]);

    useEffect(() => { if (!authLoading) fetchProfile(); }, [authLoading, fetchProfile]);
    const canView = isAdmin || employeeRole === "Supervisor" || employeeId === id;
    const nowStr = today();
    const completed = assigned.filter(row => row.status === "تم الانتهاء").length;
    const activeReceived = received.filter(row => row.order_type !== "sale");
    const ratingValues = assigned.map(row => {
        const payload = Array.isArray(row.selected_services) ? row.selected_services[0] : row.selected_services;
        const perTech = Array.isArray(payload?.technicians) ? payload.technicians.find((tech: any) => tech?.name?.trim() === employee?.name?.trim())?.rating : null;
        return Number(perTech ?? row.technician_rating ?? 0);
    }).filter(value => value > 0);
    const averageRating = ratingValues.length ? (ratingValues.reduce((sum, value) => sum + value, 0) / ratingValues.length).toFixed(1) : "—";

    const progressOf = (target: TargetRow) => {
        const rows = activeReceived.filter(row => row.created_at?.slice(0, 10) >= target.period_start && row.created_at?.slice(0, 10) <= target.period_end);
        const count = target.metric_key === "completed_orders"
            ? assigned.filter(row => row.status === "تم الانتهاء" && row.completed_at?.slice(0, 10) >= target.period_start && row.completed_at?.slice(0, 10) <= target.period_end).length
            : target.metric_key === "product_units"
                ? received.filter(row => row.order_type === "sale" && row.created_at?.slice(0, 10) >= target.period_start && row.created_at?.slice(0, 10) <= target.period_end).reduce((sum, row) => {
                    const payload = Array.isArray(row.selected_services) ? row.selected_services[0] : row.selected_services;
                    return sum + (Array.isArray(payload?.products) ? payload.products.reduce((n: number, p: any) => n + ((!target.inventory_id || p?.inventory_id === target.inventory_id) ? Number(p?.qty || 0) : 0), 0) : 0);
                }, 0)
                : target.metric_key === "service_cars"
                    ? rows.filter(row => {
                        const payload = Array.isArray(row.selected_services) ? row.selected_services[0] : row.selected_services;
                        const filter = String(target.service_filter || "").trim().toLocaleLowerCase();
                        const selectedServices = Object.entries(payload?.services || {}).filter(([, service]: [string, any]) => service?.status === "يحتاج تغيير").map(([key]) => SERVICE_LABELS[key] || key);
                        selectedServices.push(...Object.keys(payload?.freeServices || {}).filter(key => payload.freeServices[key]).map(key => SERVICE_LABELS[key] || key));
                        selectedServices.push(...(Array.isArray(payload?.customServices) ? payload.customServices.map((service: any) => String(service?.label || service?.name || "")) : []));
                        const serviceNames = selectedServices.join(" ").toLocaleLowerCase();
                        return filter ? serviceNames.includes(filter) : selectedServices.length > 0;
                    }).length
                : rows.length;
        return { count, percent: target.target_value ? Math.min(100, Math.round(count / Number(target.target_value) * 100)) : 0 };
    };

    const saveTarget = async (event: React.FormEvent) => {
        event.preventDefault();
        const targetValue = Number(targetForm.target_value);
        if (!targetForm.title.trim() || !targetValue || targetValue < 0 || targetForm.period_end < targetForm.period_start) return showError("تحقق من الهدف", "أدخل عنواناً وهدفاً صحيحاً وفترة سليمة.");
        const { error } = await (supabase as any).from("employee_targets").insert({ ...targetForm, inventory_id: targetForm.inventory_id || null, service_filter: targetForm.service_filter.trim() || null, employee_id: id, target_value: targetValue, created_by: employeeId, branch_id: employee?.branch_id || employeeBranchId });
        if (error) return showError("لم يتم حفظ الهدف", errorText(error));
        showSuccess("تم الحفظ", "تمت إضافة هدف الموظف."); setShowTarget(false); await fetchProfile();
    };
    const saveTask = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!taskForm.title.trim()) return;
        const { error } = await (supabase as any).from("employee_tasks").insert({ ...taskForm, employee_id: id, created_by: employeeId, branch_id: employee?.branch_id || employeeBranchId });
        if (error) return showError("لم تتم إضافة المهمة", errorText(error));
        showSuccess("تمت الإضافة", "تمت إضافة المهمة للموظف."); setShowTask(false); await fetchProfile();
    };
    const saveComplaint = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!complaintForm.summary.trim()) return;
        const report = reports.find(row => row.id === complaintForm.report_id);
        const { error } = await (supabase as any).from("service_complaints").insert({ employee_id: id, report_id: report?.id || null, vehicle_id: report?.vehicle_id || null, client_id: report?.vehicles?.client_id || null, summary: complaintForm.summary, details: complaintForm.details, created_by: employeeId, branch_id: employee?.branch_id || employeeBranchId });
        if (error) return showError("لم يتم تسجيل الشكوى", errorText(error));
        showSuccess("تم التسجيل", "تم ربط الشكوى بملف الموظف وأمر العمل."); setShowComplaint(false); await fetchProfile();
    };
    const changeTaskStatus = async (task: Task, status: string) => {
        const { error } = await (supabase as any).from("employee_tasks").update({ status, completed_at: status === "مكتملة" ? new Date().toISOString() : null }).eq("id", task.id);
        if (error) return showError("تعذر تحديث المهمة", errorText(error));
        await fetchProfile();
    };
    const changeComplaintStatus = async (complaint: Complaint, status: string) => {
        const { error } = await (supabase as any).from("service_complaints").update({ status, resolved_at: status === "تم الحل" ? new Date().toISOString() : null }).eq("id", complaint.id);
        if (error) return showError("تعذر تحديث الشكوى", errorText(error));
        await fetchProfile();
    };

    if (authLoading || loading) return <div className="min-h-screen flex items-center justify-center" dir="rtl"><Loader2 className="animate-spin" /></div>;
    if (!canView || !employee) return <div className="min-h-screen flex items-center justify-center" dir="rtl"><div className="glass-card p-8 rounded-2xl text-center">غير مصرح أو أن الحساب غير موجود.</div></div>;

    return <main className="min-h-screen p-5 md:p-8 font-ibm" dir="rtl"><div className="max-w-6xl mx-auto space-y-6">
        <Link href="/sales-reports" className="text-sm text-cyan-400 flex items-center gap-2"><ArrowRight size={16} />تقارير المبيعات والأداء</Link>
        <header className="glass-card p-6 rounded-2xl flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-4"><div className="w-14 h-14 rounded-2xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center"><UserRound size={28} /></div><div><h1 className="text-2xl font-bold">{employee.name}</h1><p className="text-muted-foreground">{employee.role === "Receptionist" ? "موظف استقبال" : employee.role === "Supervisor" ? "فني / مشرف" : employee.role} • {employee.branches?.name || "الفرع غير محدد"}</p></div></div>{isAdmin && <div className="flex flex-wrap gap-2"><button onClick={() => setShowTarget(true)} className="px-4 py-2 rounded-xl bg-violet-600 text-white font-bold">إضافة هدف</button><button onClick={() => setShowTask(true)} className="px-4 py-2 rounded-xl bg-cyan-600 text-white font-bold">إضافة مهمة</button><button onClick={() => setShowComplaint(true)} className="px-4 py-2 rounded-xl bg-rose-600 text-white font-bold">تسجيل شكوى</button></div>}</header>
        <section className="grid grid-cols-2 lg:grid-cols-5 gap-3"><Stat title="سيارات استلمها" value={activeReceived.length} /><Stat title="أوامر فنية مكتملة" value={completed} /><Stat title="تقييم الفني" value={averageRating} /><Stat title="أوامر قيد المتابعة" value={activeReceived.filter(x => x.status !== "تم الانتهاء").length} /><Stat title="شكاوى الخدمة" value={complaints.length} /></section>
        <section className="grid xl:grid-cols-2 gap-5">
            <div className="glass-card p-5 rounded-2xl"><h2 className="font-bold text-lg flex items-center gap-2 mb-4"><Target className="text-violet-400" />الأهداف والتقدم</h2>{targets.map(target => { const progress = progressOf(target); return <div key={target.id} className="border border-border rounded-xl p-4 mb-3"><div className="flex justify-between gap-3"><b>{target.title}</b><span className="text-sm">{progress.count} / {Number(target.target_value)} {target.unit}</span></div><div className="h-2 bg-muted rounded-full mt-3 overflow-hidden"><div className="h-full bg-violet-500" style={{ width: `${progress.percent}%` }} /></div><div className="text-xs text-muted-foreground mt-2">{target.period_start} إلى {target.period_end} • التقدم {progress.percent}%</div></div>; })}{targets.length === 0 && <Empty>لا توجد أهداف مسجلة لهذا الموظف.</Empty>}</div>
            <div className="glass-card p-5 rounded-2xl"><h2 className="font-bold text-lg flex items-center gap-2 mb-4"><ClipboardList className="text-cyan-400" />المهام</h2>{tasks.map(task => <div key={task.id} className="border border-border rounded-xl p-4 mb-3"><div className="flex justify-between gap-3"><b>{task.title}</b><span className="text-xs text-muted-foreground">{task.due_date || "بدون موعد"}</span></div>{task.details && <p className="text-sm text-muted-foreground mt-2">{task.details}</p>}<div className="flex justify-between items-center mt-3"><span className={task.status === "مكتملة" ? "text-emerald-400 text-xs" : "text-amber-300 text-xs"}>{task.status}</span>{!isAdmin && task.status !== "مكتملة" && <button onClick={() => changeTaskStatus(task, "مكتملة")} className="text-xs text-cyan-400">إنجاز المهمة</button>}{isAdmin && <select value={task.status} onChange={e => changeTaskStatus(task, e.target.value)} className="bg-background border border-border rounded-lg p-1 text-xs"><option>معلقة</option><option>قيد التنفيذ</option><option>مكتملة</option></select>}</div></div>)}{tasks.length === 0 && <Empty>لا توجد مهام مسجلة.</Empty>}</div>
        </section>
        <section className="glass-card rounded-2xl overflow-hidden"><div className="p-5 border-b border-border"><h2 className="font-bold text-lg flex items-center gap-2"><MessageSquareWarning className="text-rose-400" />شكاوى ما بعد الخدمة المرتبطة بالـCRM</h2></div><div className="divide-y divide-border">{complaints.map(complaint => <div key={complaint.id} className="p-4 flex flex-wrap justify-between gap-3"><div><b>{complaint.summary}</b>{complaint.details && <p className="text-sm text-muted-foreground mt-1">{complaint.details}</p>}<p className="text-xs text-muted-foreground mt-2">{new Date(complaint.received_at).toLocaleDateString("ar-IQ")} {complaint.client_id && <Link href={`/customers/${complaint.client_id}`} className="text-cyan-400 mr-2">ملف العميل في CRM</Link>}{complaint.report_id && <Link href={`/work-orders/${complaint.report_id}`} className="text-cyan-400 mr-2">تفاصيل أمر العمل</Link>}</p></div>{isAdmin ? <select value={complaint.status} onChange={e => changeComplaintStatus(complaint, e.target.value)} className="bg-background border border-border rounded-lg p-1.5 text-xs h-fit"><option>مفتوحة</option><option>قيد المتابعة</option><option>تم الحل</option></select> : <span className={`text-xs h-fit rounded-full px-3 py-1 ${complaint.status === "تم الحل" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-300"}`}>{complaint.status}</span>}</div>)}{complaints.length === 0 && <Empty>لا توجد شكاوى مسجلة.</Empty>}</div></section>
        <section className="glass-card rounded-2xl overflow-hidden"><div className="p-5 border-b border-border"><h2 className="font-bold text-lg flex items-center gap-2"><Wrench className="text-blue-400" />سجل السيارات والعمل</h2><p className="text-xs text-muted-foreground mt-1">يظهر الإسناد برقم الحساب أو باسم الفني المسجل في بطاقة العمل.</p></div><div className="overflow-auto"><table className="w-full min-w-[800px] text-sm text-right"><thead className="bg-muted/40"><tr><th className="p-3">رقم الأمر</th><th className="p-3">الدور في الأمر</th><th className="p-3">الخدمات</th><th className="p-3">الحالة</th><th className="p-3">التاريخ</th>{canSeePrices && <th className="p-3">القيمة</th>}</tr></thead><tbody>{[...new Map([...received.map(r => ({ ...r, staffRole: "استقبال" })), ...assigned.map(r => ({ ...r, staffRole: "فني" }))].map(r => [r.id, r])).values()].map(row => <tr key={row.id} className="border-t border-border"><td className="p-3">#{row.report_number}</td><td className="p-3">{row.staffRole}</td><td className="p-3 max-w-72">{servicesOf(row)}</td><td className="p-3">{row.status}</td><td className="p-3">{new Date(row.created_at).toLocaleDateString("ar-IQ")}</td>{canSeePrices && <td className="p-3">{Number(row.total_price || 0).toLocaleString("en-US")} د.ع</td>}</tr>)}</tbody></table></div></section>
    </div>
    {showTarget && isAdmin && <Modal title="إضافة هدف" close={() => setShowTarget(false)}><form onSubmit={saveTarget} className="space-y-3"><label className="block text-sm">عنوان الهدف<input className="input-field w-full mt-1" required value={targetForm.title} onChange={e => setTargetForm({ ...targetForm, title: e.target.value })} placeholder="مثال: استقبال سيارات تبديل الزيت" /></label><label className="block text-sm">نوع المؤشر<select className="input-field w-full mt-1" value={targetForm.metric_key} onChange={e => setTargetForm({ ...targetForm, metric_key: e.target.value })}><option value="cars_received">سيارات مستلمة</option><option value="service_cars">سيارات لخدمة محددة</option><option value="completed_orders">أوامر مكتملة للفني</option><option value="product_units">وحدات مادة مباعة</option></select></label>{targetForm.metric_key === "service_cars" && <label className="block text-sm">اسم الخدمة أو جزء منه<input className="input-field w-full mt-1" value={targetForm.service_filter} onChange={e => setTargetForm({ ...targetForm, service_filter: e.target.value })} placeholder="تبديل زيت" /></label>}{targetForm.metric_key === "product_units" && <label className="block text-sm">المادة<select className="input-field w-full mt-1" value={targetForm.inventory_id} onChange={e => setTargetForm({ ...targetForm, inventory_id: e.target.value })}><option value="">كل المواد</option>{stockItems.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<div className="grid grid-cols-2 gap-2"><label className="text-sm">العدد المستهدف<input type="number" min="1" className="input-field w-full mt-1" value={targetForm.target_value} onChange={e => setTargetForm({ ...targetForm, target_value: e.target.value })} /></label><label className="text-sm">الوحدة<input className="input-field w-full mt-1" value={targetForm.unit} onChange={e => setTargetForm({ ...targetForm, unit: e.target.value })} /></label></div><div className="grid grid-cols-2 gap-2"><label className="text-sm">بداية الفترة<input type="date" className="input-field w-full mt-1" value={targetForm.period_start} onChange={e => setTargetForm({ ...targetForm, period_start: e.target.value })} /></label><label className="text-sm">نهاية الفترة<input type="date" className="input-field w-full mt-1" value={targetForm.period_end} onChange={e => setTargetForm({ ...targetForm, period_end: e.target.value })} /></label></div><button className="w-full bg-violet-600 text-white rounded-xl py-2 font-bold">حفظ الهدف</button></form></Modal>}
    {showTask && isAdmin && <Modal title="إضافة مهمة" close={() => setShowTask(false)}><form onSubmit={saveTask} className="space-y-3"><label className="block text-sm">المهمة<input required className="input-field w-full mt-1" value={taskForm.title} onChange={e => setTaskForm({ ...taskForm, title: e.target.value })} /></label><label className="block text-sm">التفاصيل<textarea className="input-field w-full mt-1" value={taskForm.details} onChange={e => setTaskForm({ ...taskForm, details: e.target.value })} /></label><label className="block text-sm">موعد الإنجاز<input type="date" className="input-field w-full mt-1" value={taskForm.due_date} onChange={e => setTaskForm({ ...taskForm, due_date: e.target.value })} /></label><button className="w-full bg-cyan-600 text-white rounded-xl py-2 font-bold">إضافة المهمة</button></form></Modal>}
    {showComplaint && isAdmin && <Modal title="تسجيل شكوى خدمة" close={() => setShowComplaint(false)}><form onSubmit={saveComplaint} className="space-y-3"><label className="block text-sm">أمر العمل / العميل<select className="input-field w-full mt-1" value={complaintForm.report_id} onChange={e => setComplaintForm({ ...complaintForm, report_id: e.target.value })}><option value="">شكوى عامة على الموظف</option>{reports.map(report => <option key={report.id} value={report.id}>#{report.report_number} — {report.vehicles?.clients?.name || report.vehicles?.plate_number || "أمر عمل"}</option>)}</select></label><label className="block text-sm">ملخص الشكوى<input required className="input-field w-full mt-1" value={complaintForm.summary} onChange={e => setComplaintForm({ ...complaintForm, summary: e.target.value })} /></label><label className="block text-sm">التفاصيل<textarea className="input-field w-full mt-1" value={complaintForm.details} onChange={e => setComplaintForm({ ...complaintForm, details: e.target.value })} /></label><button className="w-full bg-rose-600 text-white rounded-xl py-2 font-bold">حفظ وربط الشكوى</button></form></Modal>}
    </main>;
}

function Stat({ title, value }: { title: string; value: number | string }) { return <div className="glass-card p-4 rounded-2xl"><div className="text-xs text-muted-foreground">{title}</div><div className="text-2xl font-bold mt-2">{typeof value === "number" ? value.toLocaleString("en-US") : value}</div></div>; }
function Empty({ children }: { children: React.ReactNode }) { return <div className="text-sm text-muted-foreground text-center py-6">{children}</div>; }
function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) { return <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl"><div className="glass-card w-full max-w-md rounded-2xl p-5"><div className="flex justify-between items-center mb-5"><h3 className="font-bold text-lg">{title}</h3><button onClick={close} className="text-muted-foreground">إغلاق</button></div>{children}</div></div>; }
