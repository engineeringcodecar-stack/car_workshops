"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthProvider";
import { showError } from "@/lib/alerts";
import {
    HrEmployee, HrAttendance,
    EMP_STATUS_LABEL, EMP_STATUS_STYLE, WAGE_TYPE_LABEL,
    totalHours, workedDays, salaryFor, attendancePct, pctColor, pctBarColor,
    currentMonthKey, monthRange,
} from "@/lib/hr";
import EmployeeFormModal from "./EmployeeFormModal";
import Avatar from "./Avatar";
import {
    Users, Search, Plus, Lock, UserCheck, Timer, CalendarClock,
    Wallet, Building2, ArrowLeft,
} from "lucide-react";

type MonthAgg = {
    hours: number;
    days: number;
    salary: number;
    pct: number;
    lastDate: string | null;
    count: number;
};

export default function HrEmployeesPage() {
    const { employeeRole, loading: authLoading } = useAuth();
    const isAdmin = employeeRole === "Owner" || employeeRole === "Admin";

    const [employees, setEmployees] = useState<HrEmployee[]>([]);
    const [monthRecords, setMonthRecords] = useState<HrAttendance[]>([]);
    const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);

    const [searchTerm, setSearchTerm] = useState("");
    const [branchFilter, setBranchFilter] = useState("");
    const [statusFilter, setStatusFilter] = useState("");

    const monthKey = currentMonthKey();

    const fetchData = async () => {
        setLoading(true);
        try {
            const { start, end } = monthRange(monthKey);
            // A month of attendance for every employee easily passes Supabase's 1000-row cap;
            // a single query silently dropped the rest and salaries came out too low.
            const fetchMonthAttendance = async () => {
                const rows: HrAttendance[] = [];
                for (let from = 0; from < 100000; from += 1000) {
                    const { data, error } = await (supabase as any).from("hr_attendance").select("*")
                        .gte("date", start).lte("date", end).order("date").order("id").range(from, from + 999);
                    if (error) return { data: null, error };
                    rows.push(...(data || []));
                    if (!data || data.length < 1000) break;
                }
                return { data: rows, error: null };
            };
            const [empRes, attRes, brRes] = await Promise.all([
                (supabase as any).from("hr_employees").select("*").order("full_name"),
                fetchMonthAttendance(),
                supabase.from("branches").select("id, name").order("name"),
            ]);
            if (empRes.error) throw empRes.error;
            if (attRes.error) throw attRes.error;
            setEmployees(empRes.data || []);
            setMonthRecords(attRes.data || []);
            if (brRes.data) setBranches(brRes.data as any);
        } catch (err: any) {
            showError("خطأ", err.message || "تعذر تحميل بيانات الموظفين. تأكد من تشغيل ملف قاعدة البيانات (migration).");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { if (isAdmin) fetchData(); }, [isAdmin]);

    // Per-employee aggregation for the CURRENT month — one place computes it all.
    const aggByEmp = useMemo(() => {
        const byEmp: Record<string, HrAttendance[]> = {};
        monthRecords.forEach(r => { (byEmp[r.employee_id] ||= []).push(r); });
        const agg: Record<string, MonthAgg> = {};
        employees.forEach(emp => {
            const recs = byEmp[emp.id] || [];
            agg[emp.id] = {
                hours: totalHours(recs),
                days: workedDays(recs),
                salary: salaryFor(emp, recs),
                pct: attendancePct(emp, recs),
                lastDate: recs.length ? recs.reduce((m, r) => (r.date > m ? r.date : m), recs[0].date) : null,
                count: recs.length,
            };
        });
        return agg;
    }, [employees, monthRecords]);

    const filtered = useMemo(() => {
        const term = searchTerm.trim();
        return employees.filter(e => {
            if (branchFilter && e.branch_id !== branchFilter) return false;
            if (statusFilter && e.status !== statusFilter) return false;
            if (!term) return true;
            return e.full_name.includes(term)
                || e.employee_code.includes(term)
                || (e.job_title || "").includes(term)
                || (e.phone || "").includes(term);
        });
    }, [employees, searchTerm, branchFilter, statusFilter]);

    const branchName = (id: string | null) => branches.find(b => b.id === id)?.name || "بدون فرع";

    // Top stat cards
    const stats = useMemo(() => {
        const active = employees.filter(e => e.status === "active");
        const withRequired = active.filter(e => Number(e.required_monthly_hours) > 0);
        const avgPct = withRequired.length
            ? Math.round(withRequired.reduce((s, e) => s + (aggByEmp[e.id]?.pct || 0), 0) / withRequired.length)
            : 0;
        const lastUpdate = monthRecords.length
            ? monthRecords.reduce((m, r) => (r.date > m ? r.date : m), monthRecords[0].date)
            : null;
        return { total: employees.length, active: active.length, avgPct, lastUpdate, updates: monthRecords.length };
    }, [employees, aggByEmp, monthRecords]);

    // مجموع الرواتب المستحقة هذا الشهر لكل فرع
    const branchSalaries = useMemo(() => {
        const totals: Record<string, number> = {};
        employees.forEach(e => {
            const key = e.branch_id || "none";
            totals[key] = (totals[key] || 0) + (aggByEmp[e.id]?.salary || 0);
        });
        return Object.entries(totals)
            .map(([key, total]) => ({ key, name: key === "none" ? "بدون فرع" : branchName(key), total }))
            .filter(b => b.total > 0 || b.key !== "none")
            .sort((a, b) => b.total - a.total);
    }, [employees, aggByEmp, branches]);

    const grandSalary = branchSalaries.reduce((s, b) => s + b.total, 0);
    const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n || 0);

    if (authLoading) {
        return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" /></div>;
    }

    if (!isAdmin) {
        return (
            <div className="min-h-screen flex items-center justify-center p-6 font-ibm" dir="rtl">
                <div className="glass-card p-10 rounded-3xl border-border text-center max-w-md">
                    <Lock size={40} className="text-rose-500 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-foreground mb-2">غير مصرح</h2>
                    <p className="text-muted-foreground">قسم الموارد البشرية متاح فقط للمالك ومدير النظام.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen p-4 md:p-8 font-ibm" dir="rtl">
            <div className="max-w-7xl mx-auto space-y-8 animate-fade-in">

                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div>
                        <h1 className="text-3xl font-display font-bold text-foreground mb-2 flex items-center gap-3">
                            <Users className="text-rose-500" size={32} />
                            الموظفون
                        </h1>
                        <p className="text-muted-foreground">إدارة موظفي الورشة، الدوام، والأجور — شهر {monthKey}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="relative w-full md:w-64">
                            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                            <input
                                type="text"
                                placeholder="بحث بالاسم، الرقم، الاختصاص..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="w-full bg-card border border-border rounded-xl py-2.5 pr-10 pl-4 text-foreground focus:outline-none focus:border-rose-500 transition-colors"
                            />
                        </div>
                        <button onClick={() => setIsModalOpen(true)}
                            className="shrink-0 px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl transition-colors flex items-center gap-2 shadow-lg shadow-rose-500/20 whitespace-nowrap">
                            <Plus size={18} /> إضافة موظف جديد
                        </button>
                    </div>
                </div>

                {/* Filters */}
                <div className="flex flex-wrap gap-3">
                    <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)}
                        className="bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-rose-500 appearance-none cursor-pointer">
                        <option value="">كل الفروع</option>
                        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                        className="bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-rose-500 appearance-none cursor-pointer">
                        <option value="">كل الحالات</option>
                        <option value="active">فعال</option>
                        <option value="leave">إجازة</option>
                        <option value="inactive">متوقف</option>
                    </select>
                </div>

                {/* Stat cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    <StatCard icon={<Users size={20} />} color="text-rose-500 bg-rose-500/10" title="إجمالي الموظفين" value={String(stats.total)} sub="موظف مسجل" />
                    <StatCard icon={<UserCheck size={20} />} color="text-emerald-500 bg-emerald-500/10" title="الموظفون النشطون" value={String(stats.active)} sub="بحالة فعال" />
                    <StatCard icon={<Timer size={20} />} color="text-blue-500 bg-blue-500/10" title="متوسط نسبة الدوام" value={`${stats.avgPct}%`} sub="للموظفين الفعالين هذا الشهر" />
                    <StatCard icon={<CalendarClock size={20} />} color="text-amber-500 bg-amber-500/10" title="تحديثات الدوام" value={String(stats.updates)}
                        sub={stats.lastUpdate ? `آخر تحديث: ${stats.lastUpdate}` : "لا توجد سجلات هذا الشهر"} />
                </div>

                {/* Branch salary totals */}
                <div className="glass-card p-6 rounded-2xl border border-border">
                    <h3 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
                        <Wallet className="text-emerald-500" size={20} /> مجموع الرواتب المستحقة هذا الشهر (حسب الفرع)
                    </h3>
                    {branchSalaries.length === 0 ? (
                        <p className="text-muted-foreground text-sm">لا توجد رواتب محتسبة بعد — أضف موظفين وسجلات دوام.</p>
                    ) : (
                        <div className="flex flex-wrap gap-4">
                            {branchSalaries.map(b => (
                                <div key={b.key} className="flex items-center gap-3 bg-muted border border-border rounded-xl px-4 py-3">
                                    <Building2 size={18} className="text-muted-foreground" />
                                    <span className="text-sm font-bold text-foreground">{b.name}</span>
                                    <span className="font-mono font-bold text-emerald-500" dir="ltr">{fmt(b.total)} د.ع</span>
                                </div>
                            ))}
                            <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
                                <span className="text-sm font-bold text-emerald-500">الإجمالي الكلي</span>
                                <span className="font-mono font-black text-emerald-500" dir="ltr">{fmt(grandSalary)} د.ع</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Employee cards */}
                {loading ? (
                    <div className="flex justify-center p-20"><div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" /></div>
                ) : filtered.length === 0 ? (
                    <div className="glass-card p-12 text-center text-muted-foreground rounded-2xl border-border">
                        {employees.length === 0 ? "لا يوجد موظفون بعد — ابدأ بإضافة أول موظف." : "لا يوجد موظفون يطابقون بحثك."}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filtered.map(emp => {
                            const a = aggByEmp[emp.id] || { hours: 0, days: 0, salary: 0, pct: 0, lastDate: null, count: 0 };
                            return (
                                <div key={emp.id} className="glass-card p-6 rounded-2xl border-border relative group overflow-hidden transition-all hover:border-rose-500/30 flex flex-col">
                                    <div className="flex items-center gap-4 mb-5">
                                        <Avatar photo={emp.photo} name={emp.full_name} size="w-16 h-16 text-xl" />
                                        <div className="min-w-0">
                                            <h3 className="text-lg font-bold text-foreground truncate">{emp.full_name}</h3>
                                            <p className="text-xs text-muted-foreground font-mono" dir="ltr">{emp.employee_code}</p>
                                            <div className="flex flex-wrap items-center gap-2 mt-1.5">
                                                <span className={`text-[11px] px-2 py-0.5 rounded border font-bold ${EMP_STATUS_STYLE[emp.status]}`}>{EMP_STATUS_LABEL[emp.status]}</span>
                                                <span className="text-[11px] px-2 py-0.5 rounded border border-border bg-muted text-muted-foreground">{WAGE_TYPE_LABEL[emp.wage_type]}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-4">
                                        <InfoRow label="الاختصاص" value={emp.job_title || "—"} />
                                        <InfoRow label="الفرع" value={branchName(emp.branch_id)} />
                                        <InfoRow label="قيمة الأجر" value={`${fmt(emp.wage_rate)} د.ع`} mono />
                                        <InfoRow label="الساعات المطلوبة" value={`${fmt(emp.required_monthly_hours)} س`} mono />
                                        <InfoRow label="الساعات المحققة" value={`${fmt(a.hours)} س`} mono />
                                        <InfoRow label="آخر تحديث دوام" value={a.lastDate || "—"} mono />
                                    </div>

                                    {/* Attendance % */}
                                    <div className="mb-5">
                                        <div className="flex justify-between items-center mb-1.5">
                                            <span className="text-xs font-bold text-muted-foreground">نسبة الدوام</span>
                                            <span className={`text-sm font-black font-mono ${pctColor(a.pct)}`}>{a.pct}%</span>
                                        </div>
                                        <div className="h-2 bg-muted rounded-full overflow-hidden border border-border/50">
                                            <div className={`h-full rounded-full transition-all ${pctBarColor(a.pct)}`} style={{ width: `${Math.min(100, a.pct)}%` }} />
                                        </div>
                                    </div>

                                    <Link href={`/hr/employees/${emp.id}`}
                                        className="mt-auto w-full py-2.5 bg-muted hover:bg-rose-600 hover:text-white border border-border text-foreground rounded-xl font-bold text-sm transition-colors flex items-center justify-center gap-2">
                                        فتح الملف <ArrowLeft size={16} />
                                    </Link>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Summary table */}
                {!loading && filtered.length > 0 && (
                    <div className="glass-card rounded-2xl border border-border overflow-hidden">
                        <div className="p-5 border-b border-border">
                            <h3 className="text-lg font-bold text-foreground">جدول ملخص الموظفين</h3>
                        </div>
                        <div className="overflow-x-auto custom-scrollbar">
                            <table className="w-full text-right text-sm min-w-[860px]">
                                <thead>
                                    <tr className="bg-muted/60 text-muted-foreground">
                                        <th className="py-3 px-4 font-bold">الموظف</th>
                                        <th className="py-3 px-4 font-bold">الاختصاص</th>
                                        <th className="py-3 px-4 font-bold">الفرع</th>
                                        <th className="py-3 px-4 font-bold">نوع الأجر</th>
                                        <th className="py-3 px-4 font-bold">قيمة الأجر</th>
                                        <th className="py-3 px-4 font-bold">المحققة / المطلوبة</th>
                                        <th className="py-3 px-4 font-bold">نسبة الدوام</th>
                                        <th className="py-3 px-4 font-bold">الراتب المستحق</th>
                                        <th className="py-3 px-4 font-bold">الحالة</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {filtered.map(emp => {
                                        const a = aggByEmp[emp.id] || { hours: 0, days: 0, salary: 0, pct: 0, lastDate: null, count: 0 };
                                        return (
                                            <tr key={emp.id} className="hover:bg-muted/40 transition-colors">
                                                <td className="py-3 px-4">
                                                    <Link href={`/hr/employees/${emp.id}`} className="flex items-center gap-3 group">
                                                        <Avatar photo={emp.photo} name={emp.full_name} size="w-9 h-9 text-xs" />
                                                        <div>
                                                            <span className="font-bold text-foreground group-hover:text-rose-500 transition-colors block">{emp.full_name}</span>
                                                            <span className="text-[11px] text-muted-foreground font-mono" dir="ltr">{emp.employee_code}</span>
                                                        </div>
                                                    </Link>
                                                </td>
                                                <td className="py-3 px-4 text-muted-foreground">{emp.job_title || "—"}</td>
                                                <td className="py-3 px-4 text-muted-foreground">{branchName(emp.branch_id)}</td>
                                                <td className="py-3 px-4">{WAGE_TYPE_LABEL[emp.wage_type]}</td>
                                                <td className="py-3 px-4 font-mono" dir="ltr">{fmt(emp.wage_rate)}</td>
                                                <td className="py-3 px-4 font-mono" dir="ltr">
                                                    {emp.wage_type === "daily" ? `${a.days} يوم — ` : ""}{fmt(a.hours)} / {fmt(emp.required_monthly_hours)} س
                                                </td>
                                                <td className="py-3 px-4">
                                                    <span className={`font-mono font-bold ${pctColor(a.pct)}`}>{a.pct}%</span>
                                                </td>
                                                <td className="py-3 px-4 font-mono font-bold text-emerald-500" dir="ltr">{fmt(a.salary)}</td>
                                                <td className="py-3 px-4">
                                                    <span className={`text-[11px] px-2 py-1 rounded border font-bold ${EMP_STATUS_STYLE[emp.status]}`}>{EMP_STATUS_LABEL[emp.status]}</span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>

            {isModalOpen && (
                <EmployeeFormModal
                    employee={null}
                    branches={branches}
                    onClose={() => setIsModalOpen(false)}
                    onSaved={fetchData}
                />
            )}
        </div>
    );
}

function StatCard({ icon, color, title, value, sub }: { icon: React.ReactNode; color: string; title: string; value: string; sub: string }) {
    return (
        <div className="glass-card p-6 rounded-2xl border border-border flex flex-col justify-between">
            <div className="flex items-center gap-3 mb-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>{icon}</div>
                <p className="text-muted-foreground font-bold text-sm">{title}</p>
            </div>
            <h3 className="text-3xl font-display font-bold text-foreground" dir="ltr">{value}</h3>
            <p className="text-xs text-muted-foreground mt-2">{sub}</p>
        </div>
    );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="flex flex-col">
            <span className="text-[11px] text-muted-foreground">{label}</span>
            <span className={`text-foreground font-bold truncate ${mono ? "font-mono text-[13px]" : ""}`} dir={mono ? "ltr" : undefined}>{value}</span>
        </div>
    );
}
