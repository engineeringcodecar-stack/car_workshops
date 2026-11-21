"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CalendarRange, ClipboardList, History, Loader2, MessageSquareWarning, Pencil, RotateCcw, Target, Trash2, UserRound, Wrench } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthProvider";
import { showConfirm, showError, showSuccess } from "@/lib/alerts";

type TargetRow = { id: string; metric_key: string; title: string; target_value: number; unit: string; period_start: string; period_end: string; inventory_id?: string | null; service_filter?: string | null };
type Task = { id: string; title: string; details: string | null; due_date: string | null; status: string; created_at: string };
type Complaint = { id: string; report_id: string | null; client_id?: string | null; summary: string; details: string | null; status: string; received_at: string };
type StaffTable = "employee_targets" | "employee_tasks" | "service_complaints";
type Preset = "today" | "week" | "month" | "all" | "custom";

// Dates are compared as the browser's local calendar day (the workshops are all in Iraq).
const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => dayOf(new Date());
const localDay = (iso?: string | null) => (iso ? dayOf(new Date(iso)) : "");
const errorText = (e: any) => String(e?.message || e || "حدث خطأ غير معروف");
const PRESETS: { key: Preset; label: string }[] = [
    { key: "today", label: "اليوم" }, { key: "week", label: "هذا الأسبوع" }, { key: "month", label: "هذا الشهر" }, { key: "all", label: "كل الفترات" }, { key: "custom", label: "فترة محددة" },
];
function presetRange(preset: Preset): { from: string; to: string } {
    const now = new Date();
    if (preset === "today") return { from: today(), to: today() };
    if (preset === "week") {
        // The working week in Iraq starts on Saturday.
        const start = new Date(now); start.setDate(now.getDate() - ((now.getDay() + 1) % 7));
        return { from: dayOf(start), to: today() };
    }
    if (preset === "month") return { from: dayOf(new Date(now.getFullYear(), now.getMonth(), 1)), to: today() };
    return { from: "", to: "" };
}
const inRange = (day: string, from: string, to: string) => !!day && (!from || day >= from) && (!to || day <= to);

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
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

const ORDER_FIELDS = "id,report_number,status,order_type,branch_id,branches(name),vehicle_id,vehicles(client_id,make,model,plate_number,clients(name)),created_at,completed_at,selected_services";
const emptyTarget = () => ({ title: "", metric_key: "cars_received", target_value: "10", unit: "سيارة", period_start: today(), period_end: today(), inventory_id: "", service_filter: "" });
const emptyTask = () => ({ title: "", details: "", due_date: today() });
const emptyComplaint = () => ({ report_id: "", summary: "", details: "" });

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
    const [refreshing, setRefreshing] = useState(false);

    // Period filter for everything dated on the page.
    const [preset, setPreset] = useState<Preset>("month");
    const [range, setRange] = useState(() => presetRange("month"));
    const choosePreset = (p: Preset) => { setPreset(p); if (p !== "custom") setRange(presetRange(p)); };

    // Add/edit forms: editingId null = adding a new record.
    const [targetModal, setTargetModal] = useState<{ editingId: string | null } | null>(null);
    const [taskModal, setTaskModal] = useState<{ editingId: string | null } | null>(null);
    const [complaintModal, setComplaintModal] = useState<{ editingId: string | null } | null>(null);
    const [targetForm, setTargetForm] = useState(emptyTarget());
    const [taskForm, setTaskForm] = useState(emptyTask());
    const [complaintForm, setComplaintForm] = useState(emptyComplaint());
    const [saving, setSaving] = useState(false);
    type DeletedRow = { table: StaffTable; id: string; kind: string; name: string; deleted_at: string };
    const [deletedLog, setDeletedLog] = useState<DeletedRow[] | null>(null);

    const fetchProfile = useCallback(async (quiet = false) => {
        if (!id) return;
        if (quiet) setRefreshing(true); else setLoading(true);
        try {
            const emp = await supabase.from("employees").select("id,name,role,phone,branch_id,created_at,branches(name)").eq("id", id).maybeSingle();
            if (emp.error) throw emp.error;
            const targetRows = await (supabase as any).from("employee_targets").select("id,metric_key,title,target_value,unit,period_start,period_end,inventory_id,service_filter").eq("employee_id", id).is("deleted_at", null).order("period_start", { ascending: false });
            if (targetRows.error) throw targetRows.error;
            const allTargets = (targetRows.data || []) as TargetRow[];

            // Orders are fetched for the chosen period widened to cover the visible targets,
            // so a target's progress does not depend on the period being looked at.
            const shown = allTargets.filter(t => !range.from || !range.to || (t.period_end >= range.from && t.period_start <= range.to));
            let from = range.from, to = range.to;
            for (const t of shown) { if (from && t.period_start < from) from = t.period_start; if (to && t.period_end > to) to = t.period_end; }
            const dated = (q: any) => {
                if (from) q = q.gte("created_at", new Date(`${from}T00:00:00`).toISOString());
                if (to) q = q.lte("created_at", new Date(`${to}T23:59:59.999`).toISOString());
                return q;
            };
            const fields = `${ORDER_FIELDS},technician_rating${canSeePrices ? ",total_price" : ""}`;
            const empBranch = emp.data?.branch_id || null;
            let reportPicker = supabase.from("inspection_reports").select("id,report_number,created_at,vehicle_id,vehicles(client_id,make,model,plate_number,clients(name))").order("created_at", { ascending: false }).limit(300);
            if (empBranch) reportPicker = reportPicker.eq("branch_id", empBranch);
            const [taskRows, complaintRows, receptionRows, techRows, techNameRows, reportRows, stockRows] = await Promise.all([
                (supabase as any).from("employee_tasks").select("id,title,details,due_date,status,created_at").eq("employee_id", id).is("deleted_at", null).order("created_at", { ascending: false }),
                (supabase as any).from("service_complaints").select("id,report_id,client_id,summary,details,status,received_at").eq("employee_id", id).is("deleted_at", null).order("received_at", { ascending: false }),
                dated((supabase as any).from("inspection_reports").select(`${fields},receptionist_id`).eq("receptionist_id", id)).order("created_at", { ascending: false }).limit(1000),
                dated((supabase as any).from("inspection_reports").select(`${fields},technician_id`).eq("technician_id", id)).order("created_at", { ascending: false }).limit(1000),
                // Orders where the technician is only written by name: same branch only, so a namesake elsewhere is not counted.
                (q => empBranch ? q.eq("branch_id", empBranch) : q)(dated((supabase as any).from("inspection_reports").select(`${fields},technician_id`).or("order_type.is.null,order_type.neq.sale"))).order("created_at", { ascending: false }).limit(1000),
                reportPicker,
                isAdmin ? supabase.from("inventory").select("id,name,branch_id").order("name").limit(1000) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
            ]);
            for (const r of [taskRows, complaintRows, receptionRows, techRows, techNameRows]) if (r.error) throw r.error;
            setEmployee(emp.data);
            setTargets(allTargets);
            setTasks((taskRows.data || []) as Task[]);
            setComplaints((complaintRows.data || []) as Complaint[]);
            const assignedRows = [...(techRows.data || []), ...(techNameRows.data || []).filter((row: any) => isAssignedTechByName(row, emp.data?.name || ""))];
            setReceived(receptionRows.data || []);
            setAssigned([...new Map(assignedRows.map((row: any) => [row.id, row])).values()]);
            setReports(reportRows.data || []);
            setStockItems((stockRows.data || []) as { id: string; name: string }[]);
        } catch (e) { showError("تعذر تحميل ملف الموظف", errorText(e)); }
        finally { setLoading(false); setRefreshing(false); }
    }, [id, canSeePrices, isAdmin, range.from, range.to]);

    useEffect(() => { if (!authLoading) fetchProfile(employee !== null); }, [authLoading, fetchProfile]); // eslint-disable-line react-hooks/exhaustive-deps

    // «مهامي» opens this page with #tasks: bring the tasks into view once they are on screen.
    useEffect(() => {
        if (loading || typeof window === "undefined" || window.location.hash !== "#tasks") return;
        document.getElementById("tasks")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, [loading]);

    const isOwn = !!employeeId && employeeId === id;
    const sameBranch = !employeeBranchId || !employee?.branch_id || employee.branch_id === employeeBranchId;
    const isBranchSupervisor = employeeRole === "Supervisor" && sameBranch;
    const canView = isAdmin || isOwn || isBranchSupervisor;
    const canManage = isAdmin;
    // A Supervisor handles complaints of their branch, but not the ones filed against themselves.
    const canManageComplaints = isAdmin || (isBranchSupervisor && !isOwn);

    // ── Everything below follows the period filter ──
    const { from, to } = range;
    const workRows = useMemo(() => {
        const merged = new Map<string, any>();
        for (const r of received) merged.set(r.id, { ...r, staffRole: "استقبال" });
        for (const r of assigned) merged.set(r.id, { ...r, staffRole: merged.has(r.id) ? "استقبال وفني" : "فني" });
        return [...merged.values()].filter(r => inRange(localDay(r.created_at), from, to)).sort((a, b) => b.created_at.localeCompare(a.created_at));
    }, [received, assigned, from, to]);
    const receivedInPeriod = received.filter(r => r.order_type !== "sale" && inRange(localDay(r.created_at), from, to));
    const completedInPeriod = assigned.filter(r => r.status === "تم الانتهاء" && inRange(localDay(r.completed_at || r.created_at), from, to));
    const tasksInPeriod = tasks.filter(t => !from || !to || inRange(t.due_date || localDay(t.created_at), from, to) || (t.status !== "مكتملة" && (t.due_date || "") < from));
    const complaintsInPeriod = complaints.filter(c => inRange(localDay(c.received_at), from, to));
    const targetsInPeriod = targets.filter(t => !from || !to || (t.period_end >= from && t.period_start <= to));
    const ratingValues = assigned.filter(r => inRange(localDay(r.created_at), from, to)).map(row => {
        const payload = Array.isArray(row.selected_services) ? row.selected_services[0] : row.selected_services;
        const perTech = Array.isArray(payload?.technicians) ? payload.technicians.find((tech: any) => tech?.name?.trim() === employee?.name?.trim())?.rating : null;
        return Number(perTech ?? row.technician_rating ?? 0);
    }).filter(value => value > 0);
    const averageRating = ratingValues.length ? (ratingValues.reduce((sum, value) => sum + value, 0) / ratingValues.length).toFixed(1) : "—";

    const activeReceived = received.filter(row => row.order_type !== "sale");
    const progressOf = (target: TargetRow) => {
        const within = (iso?: string | null) => { const d = localDay(iso); return d >= target.period_start && d <= target.period_end; };
        const rows = activeReceived.filter(row => within(row.created_at));
        const count = target.metric_key === "completed_orders"
            ? assigned.filter(row => row.status === "تم الانتهاء" && within(row.completed_at)).length
            : target.metric_key === "product_units"
                ? received.filter(row => row.order_type === "sale" && within(row.created_at)).reduce((sum, row) => {
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

    // ── Add / edit ──
    const openTarget = (t?: TargetRow) => {
        setTargetForm(t ? { title: t.title, metric_key: t.metric_key, target_value: String(t.target_value), unit: t.unit, period_start: t.period_start, period_end: t.period_end, inventory_id: t.inventory_id || "", service_filter: t.service_filter || "" } : emptyTarget());
        setTargetModal({ editingId: t?.id || null });
    };
    const openTask = (t?: Task) => { setTaskForm(t ? { title: t.title, details: t.details || "", due_date: t.due_date || "" } : emptyTask()); setTaskModal({ editingId: t?.id || null }); };
    const openComplaint = (c?: Complaint) => { setComplaintForm(c ? { report_id: c.report_id || "", summary: c.summary, details: c.details || "" } : emptyComplaint()); setComplaintModal({ editingId: c?.id || null }); };

    const finish = async (ok: string, close: () => void) => { showSuccess("تم الحفظ", ok); close(); await fetchProfile(true); };
    const saveTarget = async (event: React.FormEvent) => {
        event.preventDefault();
        const targetValue = Number(targetForm.target_value);
        if (!targetForm.title.trim() || !targetValue || targetValue < 0 || targetForm.period_end < targetForm.period_start) return showError("تحقق من الهدف", "أدخل عنواناً وهدفاً صحيحاً وفترة سليمة.");
        const fields = { ...targetForm, title: targetForm.title.trim(), inventory_id: targetForm.inventory_id || null, service_filter: targetForm.service_filter.trim() || null, target_value: targetValue };
        setSaving(true);
        const editingId = targetModal?.editingId;
        const { error } = editingId
            ? await (supabase as any).from("employee_targets").update(fields).eq("id", editingId)
            : await (supabase as any).from("employee_targets").insert({ ...fields, employee_id: id, created_by: employeeId, branch_id: employee?.branch_id || employeeBranchId });
        setSaving(false);
        if (error) return showError("لم يتم حفظ الهدف", errorText(error));
        await finish(editingId ? "تم تعديل الهدف." : "تمت إضافة هدف الموظف.", () => setTargetModal(null));
    };
    const saveTask = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!taskForm.title.trim()) return showError("تحقق من المهمة", "اكتب عنوان المهمة.");
        const fields = { title: taskForm.title.trim(), details: taskForm.details.trim() || null, due_date: taskForm.due_date || null };
        setSaving(true);
        const editingId = taskModal?.editingId;
        const { error } = editingId
            ? await (supabase as any).from("employee_tasks").update(fields).eq("id", editingId)
            : await (supabase as any).from("employee_tasks").insert({ ...fields, employee_id: id, created_by: employeeId, branch_id: employee?.branch_id || employeeBranchId });
        setSaving(false);
        if (error) return showError("لم يتم حفظ المهمة", errorText(error));
        await finish(editingId ? "تم تعديل المهمة." : "تمت إضافة المهمة للموظف.", () => setTaskModal(null));
    };
    const saveComplaint = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!complaintForm.summary.trim()) return showError("تحقق من الشكوى", "اكتب ملخص الشكوى.");
        const report = reports.find(row => row.id === complaintForm.report_id);
        const fields = { report_id: report?.id || null, vehicle_id: report?.vehicle_id || null, client_id: one<any>(report?.vehicles)?.client_id || null, summary: complaintForm.summary.trim(), details: complaintForm.details.trim() || null };
        setSaving(true);
        const editingId = complaintModal?.editingId;
        const { error } = editingId
            ? await (supabase as any).from("service_complaints").update(fields).eq("id", editingId)
            : await (supabase as any).from("service_complaints").insert({ ...fields, employee_id: id, created_by: employeeId, branch_id: employee?.branch_id || employeeBranchId });
        setSaving(false);
        if (error) return showError("لم يتم حفظ الشكوى", errorText(error));
        await finish(editingId ? "تم تعديل الشكوى." : "تم ربط الشكوى بملف الموظف وأمر العمل.", () => setComplaintModal(null));
    };

    // ── Delete: kept in the table with deleted_at/deleted_by, hidden everywhere ──
    const softDelete = async (table: StaffTable, rowId: string, kind: string, name: string) => {
        const ok = await showConfirm(`حذف ${kind}`, `سيتم حذف ${kind} «${name}» من ملف ${employee?.name || "الموظف"}. يبقى محفوظاً في سجل الحذف ويمكن للإدارة استرجاعه.`, "حذف", true);
        if (!ok) return;
        const { error } = await (supabase as any).from(table).update({ deleted_at: new Date().toISOString(), deleted_by: employeeId }).eq("id", rowId);
        if (error) return showError("تعذر الحذف", errorText(error));
        showSuccess("تم الحذف", `تم حذف ${kind}.`);
        await fetchProfile(true);
    };

    const openDeletedLog = async () => {
        const pick = (table: StaffTable, kind: string, nameField: string) => (supabase as any).from(table).select(`id,${nameField},deleted_at`).eq("employee_id", id).not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(100)
            .then(({ data }: { data: any[] | null }) => (data || []).map(r => ({ table, id: r.id, kind, name: r[nameField], deleted_at: r.deleted_at })));
        const lists = await Promise.all([pick("employee_targets", "هدف", "title"), pick("employee_tasks", "مهمة", "title"), pick("service_complaints", "شكوى", "summary")]);
        setDeletedLog(lists.flat().sort((a, b) => b.deleted_at.localeCompare(a.deleted_at)));
    };
    const restore = async (row: DeletedRow) => {
        const { error } = await (supabase as any).from(row.table).update({ deleted_at: null, deleted_by: null }).eq("id", row.id);
        if (error) return showError("تعذر الاسترجاع", errorText(error));
        showSuccess("تم الاسترجاع", `رجعت ${row.kind} «${row.name}» إلى الملف.`);
        setDeletedLog(log => (log || []).filter(r => r.id !== row.id));
        await fetchProfile(true);
    };

    const changeTaskStatus = async (task: Task, status: string) => {
        const { error } = await (supabase as any).from("employee_tasks").update({ status, completed_at: status === "مكتملة" ? new Date().toISOString() : null }).eq("id", task.id);
        if (error) return showError("تعذر تحديث المهمة", errorText(error));
        if (status === "مكتملة") showSuccess("أحسنت", "تم تسجيل إنجاز المهمة.");
        await fetchProfile(true);
    };
    const changeComplaintStatus = async (complaint: Complaint, status: string) => {
        const { error } = await (supabase as any).from("service_complaints").update({ status, resolved_at: status === "تم الحل" ? new Date().toISOString() : null }).eq("id", complaint.id);
        if (error) return showError("تعذر تحديث الشكوى", errorText(error));
        await fetchProfile(true);
    };

    if (authLoading || loading) return <div className="min-h-screen flex items-center justify-center" dir="rtl"><Loader2 className="animate-spin" /></div>;
    if (!canView || !employee) return <div className="min-h-screen flex items-center justify-center" dir="rtl"><div className="glass-card p-8 rounded-2xl text-center">غير مصرح أو أن الحساب غير موجود.</div></div>;

    const roleLabel = employee.role === "Receptionist" ? "موظف استقبال" : employee.role === "Supervisor" ? "فني / مشرف" : employee.role === "Admin" ? "مدير" : employee.role === "Owner" ? "المالك" : employee.role;
    const branchName = one<any>(employee.branches)?.name || "الفرع غير محدد";
    const periodLabel = preset === "all" ? "كل الفترات" : from && to ? (from === to ? from : `${from} إلى ${to}`) : "—";

    return <main className="min-h-screen p-5 md:p-8 font-ibm" dir="rtl"><div className="max-w-6xl mx-auto space-y-6">
        {(isAdmin || employeeRole === "Supervisor") && !isOwn && <Link href="/sales-reports" className="text-sm text-cyan-400 flex items-center gap-2"><ArrowRight size={16} />تقارير المبيعات والأداء</Link>}

        <header className="glass-card p-6 rounded-2xl flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center"><UserRound size={28} /></div>
                <div><h1 className="text-2xl font-bold">{isOwn ? "حسابي الشخصي" : employee.name}</h1><p className="text-muted-foreground">{isOwn && `${employee.name} • `}{roleLabel} • {branchName}</p></div>
            </div>
            {(canManage || canManageComplaints) && <div className="flex flex-wrap gap-2">
                {canManage && <button onClick={() => openTarget()} className="px-4 py-2 rounded-xl bg-violet-600 text-white font-bold">إضافة هدف</button>}
                {canManage && <button onClick={() => openTask()} className="px-4 py-2 rounded-xl bg-cyan-600 text-white font-bold">إضافة مهمة</button>}
                {canManageComplaints && <button onClick={() => openComplaint()} className="px-4 py-2 rounded-xl bg-rose-600 text-white font-bold">تسجيل شكوى</button>}
                {canManage && <button onClick={openDeletedLog} className="px-4 py-2 rounded-xl border border-border text-muted-foreground hover:text-foreground font-bold flex items-center gap-2"><History size={16} />المحذوفات</button>}
            </div>}
        </header>

        {/* Period filter */}
        <section className="glass-card p-4 rounded-2xl flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2 text-sm font-bold"><CalendarRange size={18} className="text-cyan-400" />الفترة</span>
            <div className="flex flex-wrap gap-1.5">{PRESETS.map(p => <button key={p.key} onClick={() => choosePreset(p.key)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${preset === p.key ? "bg-cyan-600 border-cyan-500 text-white" : "bg-card border-border text-muted-foreground hover:border-cyan-500/60"}`}>{p.label}</button>)}</div>
            {preset !== "all" && <div className="flex flex-wrap items-center gap-2 text-xs">
                <label className="flex items-center gap-1.5">من<input type="date" className="input-field py-1.5 text-xs" value={from} max={to || undefined} onChange={e => { setPreset("custom"); setRange(r => ({ ...r, from: e.target.value })); }} /></label>
                <label className="flex items-center gap-1.5">إلى<input type="date" className="input-field py-1.5 text-xs" value={to} min={from || undefined} onChange={e => { setPreset("custom"); setRange(r => ({ ...r, to: e.target.value })); }} /></label>
            </div>}
            {preset !== "all" && <button onClick={() => choosePreset("all")} className="text-xs text-muted-foreground hover:text-rose-400">مسح الفلتر</button>}
            {refreshing && <Loader2 size={16} className="animate-spin text-muted-foreground" />}
        </section>

        <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Stat title="سيارات استلمها" value={receivedInPeriod.length} />
            <Stat title="أوامر فنية مكتملة" value={completedInPeriod.length} />
            <Stat title="تقييم الفني" value={averageRating} />
            <Stat title="مهام مفتوحة" value={tasks.filter(t => t.status !== "مكتملة").length} />
            <Stat title="شكاوى الخدمة" value={complaintsInPeriod.length} />
        </section>
        <p className="text-xs text-muted-foreground -mt-3">الأرقام للفترة: {periodLabel}</p>

        <section className="grid xl:grid-cols-2 gap-5">
            <div className="glass-card p-5 rounded-2xl">
                <h2 className="font-bold text-lg flex items-center gap-2 mb-4"><Target className="text-violet-400" />الأهداف والتقدم</h2>
                {targetsInPeriod.map(target => { const progress = progressOf(target); return <div key={target.id} className="border border-border rounded-xl p-4 mb-3">
                    <div className="flex justify-between gap-3"><b>{target.title}</b><span className="text-sm whitespace-nowrap">{progress.count} / {Number(target.target_value)} {target.unit}</span></div>
                    <div className="h-2 bg-muted rounded-full mt-3 overflow-hidden"><div className="h-full bg-violet-500" style={{ width: `${progress.percent}%` }} /></div>
                    <div className="flex justify-between items-center mt-2"><span className="text-xs text-muted-foreground">{target.period_start} إلى {target.period_end} • التقدم {progress.percent}%</span>
                        {canManage && <RowActions onEdit={() => openTarget(target)} onDelete={() => softDelete("employee_targets", target.id, "الهدف", target.title)} />}</div>
                </div>; })}
                {targetsInPeriod.length === 0 && <Empty>لا توجد أهداف في هذه الفترة.</Empty>}
            </div>

            <div id="tasks" className="glass-card p-5 rounded-2xl scroll-mt-24">
                <h2 className="font-bold text-lg flex items-center gap-2 mb-4"><ClipboardList className="text-cyan-400" />{isOwn ? "مهامي" : "المهام"}</h2>
                {tasksInPeriod.map(task => { const late = task.status !== "مكتملة" && !!task.due_date && task.due_date < today(); return <div key={task.id} className="border border-border rounded-xl p-4 mb-3">
                    <div className="flex justify-between gap-3"><b>{task.title}</b><span className={`text-xs whitespace-nowrap ${late ? "text-rose-400 font-bold" : "text-muted-foreground"}`}>{task.due_date ? `${late ? "متأخرة • " : ""}${task.due_date}` : "بدون موعد"}</span></div>
                    {task.details && <p className="text-sm text-muted-foreground mt-2">{task.details}</p>}
                    <div className="flex flex-wrap justify-between items-center gap-2 mt-3">
                        <span className={task.status === "مكتملة" ? "text-emerald-400 text-xs" : "text-amber-300 text-xs"}>{task.status}</span>
                        <div className="flex items-center gap-3">
                            {!canManage && isOwn && task.status !== "مكتملة" && <button onClick={() => changeTaskStatus(task, "مكتملة")} className="text-xs font-bold text-cyan-400">إنجاز المهمة</button>}
                            {canManage && <select value={task.status} onChange={e => changeTaskStatus(task, e.target.value)} className="bg-background border border-border rounded-lg p-1 text-xs"><option>معلقة</option><option>قيد التنفيذ</option><option>مكتملة</option></select>}
                            {canManage && <RowActions onEdit={() => openTask(task)} onDelete={() => softDelete("employee_tasks", task.id, "المهمة", task.title)} />}
                        </div>
                    </div>
                </div>; })}
                {tasksInPeriod.length === 0 && <Empty>{tasks.length ? "لا توجد مهام في هذه الفترة." : "لا توجد مهام مسجلة."}</Empty>}
            </div>
        </section>

        <section className="glass-card rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-border"><h2 className="font-bold text-lg flex items-center gap-2"><MessageSquareWarning className="text-rose-400" />شكاوى ما بعد الخدمة</h2></div>
            <div className="divide-y divide-border">
                {complaintsInPeriod.map(complaint => <div key={complaint.id} className="p-4 flex flex-wrap justify-between gap-3">
                    <div><b>{complaint.summary}</b>{complaint.details && <p className="text-sm text-muted-foreground mt-1">{complaint.details}</p>}
                        <p className="text-xs text-muted-foreground mt-2">{localDay(complaint.received_at)}
                            {complaint.client_id && <Link href={`/customers/${complaint.client_id}`} className="text-cyan-400 mr-2">ملف العميل في CRM</Link>}
                            {complaint.report_id && <Link href={`/work-orders/${complaint.report_id}`} className="text-cyan-400 mr-2">تفاصيل أمر العمل</Link>}</p></div>
                    <div className="flex items-center gap-3 h-fit">
                        {canManageComplaints ? <select value={complaint.status} onChange={e => changeComplaintStatus(complaint, e.target.value)} className="bg-background border border-border rounded-lg p-1.5 text-xs"><option>مفتوحة</option><option>قيد المتابعة</option><option>تم الحل</option></select>
                            : <span className={`text-xs rounded-full px-3 py-1 ${complaint.status === "تم الحل" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-300"}`}>{complaint.status}</span>}
                        {canManageComplaints && <RowActions onEdit={() => openComplaint(complaint)} onDelete={() => softDelete("service_complaints", complaint.id, "الشكوى", complaint.summary)} />}
                    </div>
                </div>)}
                {complaintsInPeriod.length === 0 && <Empty>لا توجد شكاوى في هذه الفترة.</Empty>}
            </div>
        </section>

        <section className="glass-card rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-border"><h2 className="font-bold text-lg flex items-center gap-2"><Wrench className="text-blue-400" />السيارات المستلمة والأعمال المنجزة</h2><p className="text-xs text-muted-foreground mt-1">يظهر الإسناد برقم الحساب أو باسم الفني المسجل في بطاقة العمل. اضغط رقم الأمر لفتحه أو اسم العميل لفتح ملفه.</p></div>
            <div className="overflow-auto"><table className="w-full min-w-[900px] text-sm text-right">
                <thead className="bg-muted/40"><tr><th className="p-3">رقم الأمر</th><th className="p-3">الدور</th><th className="p-3">العميل والسيارة</th><th className="p-3">الخدمات</th><th className="p-3">الفرع</th><th className="p-3">الحالة</th><th className="p-3">التاريخ</th>{canSeePrices && <th className="p-3">القيمة</th>}</tr></thead>
                <tbody>{workRows.map(row => { const v = one<any>(row.vehicles); const client = one<any>(v?.clients); return <tr key={row.id} className="border-t border-border">
                    <td className="p-3"><Link href={`/work-orders/${row.id}`} className="text-cyan-400 font-bold">#{row.report_number}</Link></td>
                    <td className="p-3">{row.order_type === "sale" ? "بيع" : row.staffRole}</td>
                    <td className="p-3">{v?.client_id ? <Link href={`/customers/${v.client_id}`} className="text-cyan-400">{client?.name || "ملف العميل"}</Link> : (client?.name || "—")}<div className="text-xs text-muted-foreground">{[v?.make, v?.model, v?.plate_number].filter(Boolean).join(" • ")}</div></td>
                    <td className="p-3 max-w-72">{servicesOf(row)}</td>
                    <td className="p-3">{one<any>(row.branches)?.name || "—"}</td>
                    <td className="p-3">{row.status}</td>
                    <td className="p-3 whitespace-nowrap">{localDay(row.created_at)}</td>
                    {canSeePrices && <td className="p-3 whitespace-nowrap">{Number(row.total_price || 0).toLocaleString("en-US")} د.ع</td>}
                </tr>; })}</tbody>
            </table>{workRows.length === 0 && <Empty>لا توجد أوامر عمل في هذه الفترة.</Empty>}</div>
        </section>
    </div>

    {targetModal && canManage && <Modal title={targetModal.editingId ? "تعديل الهدف" : "إضافة هدف"} close={() => setTargetModal(null)}><form onSubmit={saveTarget} className="space-y-3">
        <label className="block text-sm">عنوان الهدف<input className="input-field w-full mt-1" required value={targetForm.title} onChange={e => setTargetForm({ ...targetForm, title: e.target.value })} placeholder="مثال: استقبال سيارات تبديل الزيت" /></label>
        <label className="block text-sm">نوع المؤشر<select className="input-field w-full mt-1" value={targetForm.metric_key} onChange={e => setTargetForm({ ...targetForm, metric_key: e.target.value })}><option value="cars_received">سيارات مستلمة</option><option value="service_cars">سيارات لخدمة محددة</option><option value="completed_orders">أوامر مكتملة للفني</option><option value="product_units">وحدات مادة مباعة</option></select></label>
        {targetForm.metric_key === "service_cars" && <label className="block text-sm">اسم الخدمة أو جزء منه<input className="input-field w-full mt-1" value={targetForm.service_filter} onChange={e => setTargetForm({ ...targetForm, service_filter: e.target.value })} placeholder="تبديل زيت" /></label>}
        {targetForm.metric_key === "product_units" && <label className="block text-sm">المادة<select className="input-field w-full mt-1" value={targetForm.inventory_id} onChange={e => setTargetForm({ ...targetForm, inventory_id: e.target.value })}><option value="">كل المواد</option>{stockItems.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        <div className="grid grid-cols-2 gap-2"><label className="text-sm">العدد المستهدف<input type="number" min="1" className="input-field w-full mt-1" value={targetForm.target_value} onChange={e => setTargetForm({ ...targetForm, target_value: e.target.value })} /></label><label className="text-sm">الوحدة<input className="input-field w-full mt-1" value={targetForm.unit} onChange={e => setTargetForm({ ...targetForm, unit: e.target.value })} /></label></div>
        <div className="grid grid-cols-2 gap-2"><label className="text-sm">بداية الفترة<input type="date" className="input-field w-full mt-1" value={targetForm.period_start} onChange={e => setTargetForm({ ...targetForm, period_start: e.target.value })} /></label><label className="text-sm">نهاية الفترة<input type="date" className="input-field w-full mt-1" value={targetForm.period_end} onChange={e => setTargetForm({ ...targetForm, period_end: e.target.value })} /></label></div>
        <SaveButton saving={saving} className="bg-violet-600">{targetModal.editingId ? "حفظ التعديل" : "حفظ الهدف"}</SaveButton>
    </form></Modal>}
    {taskModal && canManage && <Modal title={taskModal.editingId ? "تعديل المهمة" : "إضافة مهمة"} close={() => setTaskModal(null)}><form onSubmit={saveTask} className="space-y-3">
        <label className="block text-sm">المهمة<input required className="input-field w-full mt-1" value={taskForm.title} onChange={e => setTaskForm({ ...taskForm, title: e.target.value })} /></label>
        <label className="block text-sm">التفاصيل<textarea className="input-field w-full mt-1" value={taskForm.details} onChange={e => setTaskForm({ ...taskForm, details: e.target.value })} /></label>
        <label className="block text-sm">موعد الإنجاز<input type="date" className="input-field w-full mt-1" value={taskForm.due_date} onChange={e => setTaskForm({ ...taskForm, due_date: e.target.value })} /></label>
        <SaveButton saving={saving} className="bg-cyan-600">{taskModal.editingId ? "حفظ التعديل" : "إضافة المهمة"}</SaveButton>
    </form></Modal>}
    {complaintModal && canManageComplaints && <Modal title={complaintModal.editingId ? "تعديل الشكوى" : "تسجيل شكوى خدمة"} close={() => setComplaintModal(null)}><form onSubmit={saveComplaint} className="space-y-3">
        <label className="block text-sm">أمر العمل / العميل<select className="input-field w-full mt-1" value={complaintForm.report_id} onChange={e => setComplaintForm({ ...complaintForm, report_id: e.target.value })}><option value="">شكوى عامة على الموظف</option>{reports.map(report => { const v = one<any>(report.vehicles); return <option key={report.id} value={report.id}>#{report.report_number} — {one<any>(v?.clients)?.name || v?.plate_number || "أمر عمل"}</option>; })}</select></label>
        <label className="block text-sm">ملخص الشكوى<input required className="input-field w-full mt-1" value={complaintForm.summary} onChange={e => setComplaintForm({ ...complaintForm, summary: e.target.value })} /></label>
        <label className="block text-sm">التفاصيل<textarea className="input-field w-full mt-1" value={complaintForm.details} onChange={e => setComplaintForm({ ...complaintForm, details: e.target.value })} /></label>
        <SaveButton saving={saving} className="bg-rose-600">{complaintModal.editingId ? "حفظ التعديل" : "حفظ وربط الشكوى"}</SaveButton>
    </form></Modal>}
    {deletedLog && canManage && <Modal title="المحذوفات من الملف" close={() => setDeletedLog(null)}>
        <div className="max-h-[60vh] overflow-auto divide-y divide-border">
            {deletedLog.map(row => <div key={row.id} className="py-3 flex items-center justify-between gap-3">
                <div><div className="text-xs text-muted-foreground">{row.kind} • حُذف {localDay(row.deleted_at)}</div><b className="text-sm">{row.name}</b></div>
                <button onClick={() => restore(row)} className="flex items-center gap-1 text-xs font-bold text-cyan-400 whitespace-nowrap"><RotateCcw size={13} />استرجاع</button>
            </div>)}
            {deletedLog.length === 0 && <Empty>لا يوجد شيء محذوف.</Empty>}
        </div>
    </Modal>}
    </main>;
}

function Stat({ title, value }: { title: string; value: number | string }) { return <div className="glass-card p-4 rounded-2xl"><div className="text-xs text-muted-foreground">{title}</div><div className="text-2xl font-bold mt-2">{typeof value === "number" ? value.toLocaleString("en-US") : value}</div></div>; }
function Empty({ children }: { children: React.ReactNode }) { return <div className="text-sm text-muted-foreground text-center py-6">{children}</div>; }
function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
    return <span className="flex items-center gap-2">
        <button onClick={onEdit} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-cyan-400"><Pencil size={13} />تعديل</button>
        <button onClick={onDelete} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-rose-400"><Trash2 size={13} />حذف</button>
    </span>;
}
function SaveButton({ saving, className, children }: { saving: boolean; className: string; children: React.ReactNode }) {
    return <button disabled={saving} className={`w-full ${className} text-white rounded-xl py-2 font-bold flex items-center justify-center gap-2 disabled:opacity-60`}>{saving && <Loader2 size={16} className="animate-spin" />}{children}</button>;
}
function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) { return <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl"><div className="glass-card w-full max-w-md rounded-2xl p-5"><div className="flex justify-between items-center mb-5"><h3 className="font-bold text-lg">{title}</h3><button onClick={close} className="text-muted-foreground">إغلاق</button></div>{children}</div></div>; }
