"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthProvider";
import { showError, showSuccess, showConfirm } from "@/lib/alerts";
import {
    HrEmployee, HrAttendance, ATTENDANCE_STATUSES, NO_HOURS_STATUSES,
    EMP_STATUS_LABEL, EMP_STATUS_STYLE, WAGE_TYPE_LABEL, ATT_STATUS_STYLE,
    computeHours, totalHours, workedDays, salaryFor, attendancePct, pctColor, pctBarColor,
    currentMonthKey, monthRange, weekStartOf, weekDays, localDateStr, dateRangeDays,
    parsePastedAttendanceTable, ParsedPastedRow, DAY_NAMES_AR,
} from "@/lib/hr";
import EmployeeFormModal from "../EmployeeFormModal";
import Avatar from "../Avatar";
import {
    ArrowRight, Lock, Phone, Building2, CalendarDays, BadgeCheck, Edit2, Trash2,
    Wallet, Timer, CalendarClock, QrCode, Loader2, ChevronRight, ChevronLeft, Save,
    ClipboardPaste, Calendar, Sparkles, CheckCircle2, RotateCcw, X, FileSpreadsheet,
} from "lucide-react";

type TabKey = "overview" | "attendance" | "salary" | "leaves" | "documents";

const TABS: { key: TabKey; label: string }[] = [
    { key: "overview", label: "نظرة عامة" },
    { key: "attendance", label: "الحضور والانصراف" },
    { key: "salary", label: "الرواتب" },
    { key: "leaves", label: "الإجازات" },
    { key: "documents", label: "المستندات" },
];

type AttendanceRow = {
    date: string;
    dayName: string;
    check_in: string;
    check_out: string;
    status: string;
    note: string;
    // Set by any edit in this period (incl. "الكل حاضر"): حاضر with no times is the
    // default look of an empty row, so without this a daily-wage حاضر was never saved.
    touched?: boolean;
};

export default function HrEmployeeProfilePage() {
    const params = useParams();
    const router = useRouter();
    const id = params.id as string;
    const { employeeRole, loading: authLoading } = useAuth();
    const isAdmin = employeeRole === "Owner" || employeeRole === "Admin";

    const [emp, setEmp] = useState<HrEmployee | null>(null);
    const [records, setRecords] = useState<HrAttendance[]>([]);   // ALL records for this employee
    const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
    const [loading, setLoading] = useState(true);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<TabKey>("attendance");
    const [monthKey, setMonthKey] = useState(currentMonthKey());

    // ── Flexible Period / Range Editor State ──
    const [rangeStart, setRangeStart] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    });
    const [rangeEnd, setRangeEnd] = useState(() => localDateStr(new Date()));
    const [periodRows, setPeriodRows] = useState<AttendanceRow[]>([]);
    const [savingPeriod, setSavingPeriod] = useState(false);

    // ── Paste Modal State ──
    const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
    const [pasteRawText, setPasteRawText] = useState("");
    const [pasteAutoExpand, setPasteAutoExpand] = useState(true);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [empRes, attRes, brRes] = await Promise.all([
                (supabase as any).from("hr_employees").select("*").eq("id", id).maybeSingle(),
                (supabase as any).from("hr_attendance").select("*").eq("employee_id", id).order("date", { ascending: false }).limit(1500),
                supabase.from("branches").select("id, name").order("name"),
            ]);
            if (empRes.error) throw empRes.error;
            setEmp(empRes.data || null);
            setRecords(attRes.data || []);
            if (brRes.data) setBranches(brRes.data as any);
        } catch (err: any) {
            showError("خطأ", err.message || "تعذر تحميل ملف الموظف.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { if (isAdmin && id) fetchData(); }, [isAdmin, id]);

    // Rebuild period rows whenever range or stored records change
    useEffect(() => {
        if (!rangeStart || !rangeEnd) return;
        const days = dateRangeDays(rangeStart, rangeEnd);
        setPeriodRows(days.map(d => {
            const existing = records.find(r => r.date === d.date);
            return {
                date: d.date,
                dayName: d.dayName,
                check_in: existing?.check_in ? existing.check_in.slice(0, 5) : "",
                check_out: existing?.check_out ? existing.check_out.slice(0, 5) : "",
                status: existing?.attendance_status || "حاضر",
                note: existing?.note || "",
            };
        }));
    }, [rangeStart, rangeEnd, records]);

    const { start: mStart, end: mEnd } = monthRange(monthKey);
    const monthRecords = useMemo(() => records.filter(r => r.date >= mStart && r.date <= mEnd), [records, mStart, mEnd]);

    const monthStats = useMemo(() => {
        if (!emp) return { hours: 0, days: 0, salary: 0, pct: 0, lastDate: null as string | null };
        return {
            hours: totalHours(monthRecords),
            days: workedDays(monthRecords),
            salary: salaryFor(emp, monthRecords),
            pct: attendancePct(emp, monthRecords),
            lastDate: monthRecords.length ? monthRecords[0].date : null,
        };
    }, [emp, monthRecords]);

    // Period summary stats (for current displayed editor table)
    const periodStats = useMemo(() => {
        const rowsWithEffectiveHours = periodRows.map(r => ({
            calculated_hours: NO_HOURS_STATUSES.has(r.status) ? 0 : computeHours(r.check_in, r.check_out),
            attendance_status: r.status,
        }));
        return {
            totalHours: totalHours(rowsWithEffectiveHours),
            workedDays: workedDays(rowsWithEffectiveHours),
            filledDays: periodRows.filter(r => r.check_in || r.check_out || r.status !== "حاضر" || r.note).length,
        };
    }, [periodRows]);

    // Parsed pasted rows preview
    const parsedPastedRows = useMemo(() => {
        return parsePastedAttendanceTable(pasteRawText);
    }, [pasteRawText]);

    // الرواتب tab: every month that has records, newest first.
    const monthlySalaries = useMemo(() => {
        if (!emp) return [];
        const byMonth: Record<string, HrAttendance[]> = {};
        records.forEach(r => { (byMonth[r.date.slice(0, 7)] ||= []).push(r); });
        return Object.entries(byMonth)
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([ym, recs]) => ({
                month: ym,
                hours: totalHours(recs),
                days: workedDays(recs),
                pct: attendancePct(emp, recs),
                salary: salaryFor(emp, recs),
            }));
    }, [emp, records]);

    const branchName = (bid: string | null) => branches.find(b => b.id === bid)?.name || "بدون فرع";
    const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n || 0);

    const setRow = (i: number, key: Exclude<keyof AttendanceRow, "touched">, value: string) =>
        setPeriodRows(rows => rows.map((r, idx) => (idx === i ? { ...r, [key]: value, touched: true } : r)));

    // Quick range presets
    const applyPreset = (type: "month-to-date" | "full-month" | "this-week" | "last-7" | "last-15" | "prev-month") => {
        const today = new Date();
        const todayStr = localDateStr(today);
        if (type === "month-to-date") {
            const startStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
            setRangeStart(startStr);
            setRangeEnd(todayStr);
        } else if (type === "full-month") {
            const rng = monthRange(currentMonthKey());
            setRangeStart(rng.start);
            setRangeEnd(rng.end);
        } else if (type === "this-week") {
            const wStart = weekStartOf(today);
            const wDays = weekDays(wStart);
            setRangeStart(wDays[0].date);
            setRangeEnd(wDays[6].date);
        } else if (type === "last-7") {
            const past7 = new Date(today);
            past7.setDate(past7.getDate() - 6);
            setRangeStart(localDateStr(past7));
            setRangeEnd(todayStr);
        } else if (type === "last-15") {
            const past15 = new Date(today);
            past15.setDate(past15.getDate() - 14);
            setRangeStart(localDateStr(past15));
            setRangeEnd(todayStr);
        } else if (type === "prev-month") {
            const prevM = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            const ym = `${prevM.getFullYear()}-${String(prevM.getMonth() + 1).padStart(2, "0")}`;
            const rng = monthRange(ym);
            setRangeStart(rng.start);
            setRangeEnd(rng.end);
        }
    };

    // Quick fill actions
    const fillDefaultTimes = () => {
        setPeriodRows(rows => rows.map(r => {
            if (NO_HOURS_STATUSES.has(r.status)) return r;
            return {
                ...r,
                check_in: r.check_in || "08:30",
                check_out: r.check_out || "17:00",
                status: "حاضر",
            };
        }));
    };

    const markAllPresent = () => {
        setPeriodRows(rows => rows.map(r => ({ ...r, status: "حاضر", touched: true })));
    };

    const clearPeriodInputs = () => {
        const days = dateRangeDays(rangeStart, rangeEnd);
        setPeriodRows(days.map(d => {
            const existing = records.find(r => r.date === d.date);
            return {
                date: d.date,
                dayName: d.dayName,
                check_in: existing?.check_in ? existing.check_in.slice(0, 5) : "",
                check_out: existing?.check_out ? existing.check_out.slice(0, 5) : "",
                status: existing?.attendance_status || "حاضر",
                note: existing?.note || "",
            };
        }));
    };

    // Apply pasted rows from modal or clipboard
    const applyPastedRows = () => {
        if (parsedPastedRows.length === 0) {
            showError("تنبيه", "لم يتم التعرف على أي صفوف دوام من النص الملصق.");
            return;
        }

        // Determine if pasted rows contain specific dates
        const rowsWithDates = parsedPastedRows.filter(r => r.date);
        let newStart = rangeStart;
        let newEnd = rangeEnd;

        if (rowsWithDates.length > 0 && pasteAutoExpand) {
            const allDates = rowsWithDates.map(r => r.date!).sort();
            const minDate = allDates[0];
            const maxDate = allDates[allDates.length - 1];
            if (minDate < newStart) newStart = minDate;
            if (maxDate > newEnd) newEnd = maxDate;
            setRangeStart(newStart);
            setRangeEnd(newEnd);
        }

        // Generate full period array for the target range
        const days = dateRangeDays(newStart, newEnd);
        const mapByDate = new Map<string, ParsedPastedRow>();
        parsedPastedRows.forEach(r => {
            if (r.date) mapByDate.set(r.date, r);
        });

        const hasExplicitDates = mapByDate.size > 0;

        setPeriodRows(days.map((d, index) => {
            const existingDb = records.find(r => r.date === d.date);
            let pastedMatch: ParsedPastedRow | undefined;

            if (hasExplicitDates) {
                pastedMatch = mapByDate.get(d.date);
            } else if (index < parsedPastedRows.length) {
                // If no dates were in the text, match sequentially
                pastedMatch = parsedPastedRows[index];
            }

            if (pastedMatch) {
                return {
                    date: d.date,
                    dayName: d.dayName,
                    check_in: pastedMatch.check_in ?? (existingDb?.check_in ? existingDb.check_in.slice(0, 5) : ""),
                    check_out: pastedMatch.check_out ?? (existingDb?.check_out ? existingDb.check_out.slice(0, 5) : ""),
                    status: pastedMatch.status || existingDb?.attendance_status || "حاضر",
                    note: pastedMatch.note ?? (existingDb?.note || ""),
                    touched: true,
                };
            }

            return {
                date: d.date,
                dayName: d.dayName,
                check_in: existingDb?.check_in ? existingDb.check_in.slice(0, 5) : "",
                check_out: existingDb?.check_out ? existingDb.check_out.slice(0, 5) : "",
                status: existingDb?.attendance_status || "حاضر",
                note: existingDb?.note || "",
            };
        }));

        setIsPasteModalOpen(false);
        setPasteRawText("");
        showSuccess("تم لصق الجدول", `تم استيراد ${parsedPastedRows.length} سجل بنجاح إلى جدول الفترة.`);
    };

    // Save period changes
    const savePeriod = async () => {
        if (!emp) return;
        setSavingPeriod(true);
        try {
            const toSave = periodRows.filter(r =>
                r.touched || r.check_in || r.check_out || r.note || r.status !== "حاضر" || records.some(x => x.date === r.date)
            );

            if (toSave.length === 0) {
                showError("تنبيه", "لا توجد بيانات لحفظها — أدخل أوقات الحضور أو غيّر الحالة.");
                setSavingPeriod(false);
                return;
            }

            const rows = toSave.map(r => ({
                employee_id: emp.id,
                date: r.date,
                check_in: r.check_in || null,
                check_out: r.check_out || null,
                calculated_hours: NO_HOURS_STATUSES.has(r.status) ? 0 : computeHours(r.check_in, r.check_out),
                attendance_status: r.status,
                note: r.note.trim() || null,
                updated_at: new Date().toISOString(),
            }));

            const { error } = await (supabase as any)
                .from("hr_attendance")
                .upsert(rows, { onConflict: "employee_id,date" });
            if (error) throw error;

            showSuccess("تم الحفظ بنجاح", `تم تحديث دوام ${rows.length} يوم — الساعات والنسبة والرواتب تحدّثت مباشرة.`);
            fetchData();
        } catch (err: any) {
            showError("خطأ", err.message || "تعذر حفظ سجلات الدوام.");
        } finally {
            setSavingPeriod(false);
        }
    };

    const deleteRecord = async (rec: HrAttendance) => {
        const ok = await showConfirm("حذف سجل", `حذف سجل يوم ${rec.date}؟`, "نعم، احذف", true);
        if (!ok) return;
        const { error } = await (supabase as any).from("hr_attendance").delete().eq("id", rec.id);
        if (error) showError("خطأ", error.message);
        else fetchData();
    };

    const deleteEmployee = async () => {
        if (!emp) return;
        const ok = await showConfirm(
            "حذف الموظف",
            `حذف "${emp.full_name}" نهائياً؟ سيتم حذف كل سجلات الحضور والانصراف الخاصة به أيضاً.`,
            "نعم، احذف",
            true
        );
        if (!ok) return;
        const { error } = await (supabase as any).from("hr_employees").delete().eq("id", emp.id);
        if (error) {
            showError("خطأ", error.message);
            return;
        }
        showSuccess("تم الحذف", `تم حذف "${emp.full_name}" وكل سجلاته.`);
        router.push("/hr/employees");
    };

    const shiftMonth = (dir: number) => {
        const [y, m] = monthKey.split("-").map(n => parseInt(n, 10));
        const d = new Date(y, m - 1 + dir, 1);
        setMonthKey(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    };

    if (authLoading || (loading && !emp)) {
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

    if (!emp) {
        return (
            <div className="min-h-screen flex items-center justify-center p-6 font-ibm" dir="rtl">
                <div className="glass-card p-10 rounded-3xl border-border text-center max-w-md">
                    <h2 className="text-xl font-bold text-foreground mb-4">الموظف غير موجود</h2>
                    <Link href="/hr/employees" className="text-rose-500 hover:text-rose-400 font-bold">العودة لقائمة الموظفين</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen p-4 md:p-8 font-ibm" dir="rtl">
            <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">

                <button onClick={() => router.push("/hr/employees")}
                    className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm font-bold">
                    <ArrowRight size={18} /> العودة للموظفين
                </button>

                {/* Header */}
                <div className="glass-card p-6 rounded-3xl border border-border">
                    <div className="flex flex-col md:flex-row md:items-center gap-6">
                        <Avatar photo={emp.photo} name={emp.full_name} size="w-24 h-24 text-3xl" />
                        <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-3 mb-2">
                                <h1 className="text-2xl font-display font-bold text-foreground">{emp.full_name}</h1>
                                <span className={`text-xs px-2.5 py-1 rounded-full border font-bold ${EMP_STATUS_STYLE[emp.status]}`}>{EMP_STATUS_LABEL[emp.status]}</span>
                            </div>
                            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                                <span className="flex items-center gap-1.5"><BadgeCheck size={15} className="text-rose-400" /><span className="font-mono" dir="ltr">{emp.employee_code}</span></span>
                                {emp.job_title && <span>{emp.job_title}</span>}
                                <span className="flex items-center gap-1.5"><Building2 size={15} className="text-rose-400" />{branchName(emp.branch_id)}</span>
                                {emp.phone && <span className="flex items-center gap-1.5"><Phone size={15} className="text-rose-400" /><span className="font-mono" dir="ltr">{emp.phone}</span></span>}
                                {emp.hire_date && <span className="flex items-center gap-1.5"><CalendarDays size={15} className="text-rose-400" />المباشرة: <span className="font-mono" dir="ltr">{emp.hire_date}</span></span>}
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="bg-white p-2 rounded-xl border border-border shrink-0" title="رمز الموظف">
                                <QRCodeSVG value={`HR-EMP:${emp.employee_code}`} size={72} />
                            </div>
                            <button onClick={() => setIsEditOpen(true)}
                                className="px-4 py-2.5 bg-muted hover:bg-rose-600 hover:text-white border border-border text-foreground rounded-xl font-bold text-sm transition-colors flex items-center gap-2">
                                <Edit2 size={16} /> تعديل البيانات
                            </button>
                            <button onClick={deleteEmployee}
                                className="px-4 py-2.5 bg-rose-500/10 hover:bg-rose-600 hover:text-white border border-rose-500/20 text-rose-500 rounded-xl font-bold text-sm transition-colors flex items-center gap-2"
                                title="حذف الموظف نهائياً">
                                <Trash2 size={16} /> حذف
                            </button>
                        </div>
                    </div>
                </div>

                {/* Month selector + summary cards */}
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-foreground flex items-center gap-2"><CalendarClock size={20} className="text-rose-500" /> ملخص شهر {monthKey}</h3>
                    <div className="flex items-center gap-2">
                        <button onClick={() => shiftMonth(-1)} className="p-2 bg-card border border-border rounded-lg text-muted-foreground hover:text-foreground"><ChevronRight size={16} /></button>
                        <button onClick={() => shiftMonth(1)} className="p-2 bg-card border border-border rounded-lg text-muted-foreground hover:text-foreground"><ChevronLeft size={16} /></button>
                    </div>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <SummaryCard icon={<Wallet size={18} />} color="text-amber-500 bg-amber-500/10" title="نوع وقيمة الأجر"
                        value={`${fmt(emp.wage_rate)} د.ع`} sub={WAGE_TYPE_LABEL[emp.wage_type]} />
                    <SummaryCard icon={<Timer size={18} />} color="text-blue-500 bg-blue-500/10" title="الساعات المحققة / المطلوبة"
                        value={`${fmt(monthStats.hours)} / ${fmt(emp.required_monthly_hours)}`}
                        sub={emp.wage_type === "daily" ? `أيام الدوام: ${monthStats.days}` : "ساعة هذا الشهر"} />
                    <SummaryCard icon={<Wallet size={18} />} color="text-emerald-500 bg-emerald-500/10" title="الراتب المستحق"
                        value={`${fmt(monthStats.salary)} د.ع`}
                        sub={emp.wage_type === "daily" ? `${monthStats.days} يوم × ${fmt(emp.wage_rate)}` : `${fmt(monthStats.hours)} س × ${fmt(emp.wage_rate)}`} />
                    <div className="glass-card p-4 rounded-2xl border border-border flex items-center gap-4">
                        <CircularProgress pct={monthStats.pct} />
                        <div>
                            <p className="text-xs font-bold text-muted-foreground mb-1">نسبة الدوام</p>
                            <p className={`text-2xl font-display font-black ${pctColor(monthStats.pct)}`} dir="ltr">{monthStats.pct}%</p>
                            <p className="text-[11px] text-muted-foreground mt-1">آخر تحديث: {monthStats.lastDate || "—"}</p>
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex bg-card border border-border rounded-xl p-1 overflow-x-auto custom-scrollbar">
                    {TABS.map(t => (
                        <button key={t.key} onClick={() => setActiveTab(t.key)}
                            className={`px-4 py-2 rounded-lg font-bold text-sm whitespace-nowrap transition-colors ${activeTab === t.key ? "bg-rose-600/15 text-rose-500" : "text-muted-foreground hover:text-foreground"}`}>
                            {t.label}
                        </button>
                    ))}
                </div>

                {/* ── Tab: الحضور والانصراف (مع لصق الجدول واختيار الفترة المخصصة) ── */}
                {activeTab === "attendance" && (
                    <div className="space-y-6">

                        {/* Bulk & Period Editor */}
                        <div className="glass-card rounded-3xl border border-border overflow-hidden shadow-xl shadow-black/5">
                            {/* Editor Header & Date Range Controls */}
                            <div className="p-5 border-b border-border bg-card/60 space-y-4">
                                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                                    <div>
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-500 flex items-center justify-center">
                                                <Calendar size={18} />
                                            </div>
                                            <h3 className="text-lg font-bold text-foreground">تحديث سجل الدوام (فترة مخصصة)</h3>
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-1 mr-10.5">
                                            حدد أي فترة زمنية تريدها، أو الصق جدول دوام كامل من Excel أو البصمة دفعة واحدة.
                                        </p>
                                    </div>

                                    {/* Action Buttons: Paste from Excel + Quick Tools */}
                                    <div className="flex flex-wrap items-center gap-2">
                                        <button
                                            onClick={() => setIsPasteModalOpen(true)}
                                            className="px-3.5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-md shadow-emerald-600/20"
                                        >
                                            <ClipboardPaste size={16} /> لصق جدول (Excel / بصمة)
                                        </button>
                                        <button
                                            onClick={fillDefaultTimes}
                                            className="px-3 py-2 bg-muted hover:bg-muted/80 border border-border text-foreground font-bold rounded-xl text-xs flex items-center gap-1.5 transition-colors"
                                            title="تعبئة وقت افتراضي (08:30 إلى 17:00) للأيام الفارغة"
                                        >
                                            <Sparkles size={14} className="text-amber-500" /> تعبئة أوقات افتراضية
                                        </button>
                                        <button
                                            onClick={markAllPresent}
                                            className="px-3 py-2 bg-muted hover:bg-muted/80 border border-border text-foreground font-bold rounded-xl text-xs flex items-center gap-1.5 transition-colors"
                                        >
                                            <CheckCircle2 size={14} className="text-emerald-500" /> الكل حاضر
                                        </button>
                                        <button
                                            onClick={clearPeriodInputs}
                                            className="p-2 bg-muted hover:bg-rose-500/10 hover:text-rose-500 border border-border text-muted-foreground rounded-xl transition-colors"
                                            title="إعادة تعيين للمحفوظ سابقاً"
                                        >
                                            <RotateCcw size={15} />
                                        </button>
                                    </div>
                                </div>

                                {/* Date Range Picker & Quick Presets */}
                                <div className="pt-2 border-t border-border/60 flex flex-col md:flex-row md:items-center justify-between gap-3">
                                    <div className="flex flex-wrap items-center gap-2 text-xs">
                                        <span className="font-bold text-muted-foreground">الفترة:</span>
                                        <div className="flex items-center gap-1.5 bg-muted/80 border border-border rounded-xl px-2.5 py-1.5">
                                            <span className="text-muted-foreground text-[11px]">من</span>
                                            <input
                                                type="date"
                                                value={rangeStart}
                                                onChange={e => setRangeStart(e.target.value)}
                                                className="bg-transparent text-foreground font-mono text-xs focus:outline-none cursor-pointer"
                                            />
                                            <span className="text-muted-foreground text-[11px] mr-1">إلى</span>
                                            <input
                                                type="date"
                                                value={rangeEnd}
                                                onChange={e => setRangeEnd(e.target.value)}
                                                className="bg-transparent text-foreground font-mono text-xs focus:outline-none cursor-pointer"
                                            />
                                        </div>
                                    </div>

                                    {/* Quick Preset Buttons */}
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <button onClick={() => applyPreset("month-to-date")} className="px-2.5 py-1 bg-muted/60 hover:bg-rose-500/10 hover:text-rose-500 border border-border/80 rounded-lg text-[11px] font-bold text-muted-foreground transition-colors">هذا الشهر (حتى اليوم)</button>
                                        <button onClick={() => applyPreset("full-month")} className="px-2.5 py-1 bg-muted/60 hover:bg-rose-500/10 hover:text-rose-500 border border-border/80 rounded-lg text-[11px] font-bold text-muted-foreground transition-colors">الشهر بالكامل</button>
                                        <button onClick={() => applyPreset("this-week")} className="px-2.5 py-1 bg-muted/60 hover:bg-rose-500/10 hover:text-rose-500 border border-border/80 rounded-lg text-[11px] font-bold text-muted-foreground transition-colors">هذا الأسبوع</button>
                                        <button onClick={() => applyPreset("last-7")} className="px-2.5 py-1 bg-muted/60 hover:bg-rose-500/10 hover:text-rose-500 border border-border/80 rounded-lg text-[11px] font-bold text-muted-foreground transition-colors">آخر 7 أيام</button>
                                        <button onClick={() => applyPreset("last-15")} className="px-2.5 py-1 bg-muted/60 hover:bg-rose-500/10 hover:text-rose-500 border border-border/80 rounded-lg text-[11px] font-bold text-muted-foreground transition-colors">آخر 15 يوم</button>
                                        <button onClick={() => applyPreset("prev-month")} className="px-2.5 py-1 bg-muted/60 hover:bg-rose-500/10 hover:text-rose-500 border border-border/80 rounded-lg text-[11px] font-bold text-muted-foreground transition-colors">الشهر السابق</button>
                                    </div>
                                </div>
                            </div>

                            {/* Stats Ribbon for Current View */}
                            <div className="px-5 py-2.5 bg-muted/40 border-b border-border text-xs flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-4 text-muted-foreground">
                                    <span>عدد الأيام المعروضة: <strong className="text-foreground font-mono">{periodRows.length}</strong></span>
                                    <span>الأيام المعبأة: <strong className="text-foreground font-mono">{periodStats.filledDays}</strong></span>
                                    <span>مجموع الساعات بالفترة: <strong className="text-emerald-500 font-mono font-bold">{periodStats.totalHours} س</strong></span>
                                </div>
                                <div className="text-[11px] text-muted-foreground">
                                    💡 يمكنك نسخ صفوف من Excel والضغط على زر <strong className="text-emerald-400">لصق جدول</strong> لتعبئة كل شيء تلقائياً.
                                </div>
                            </div>

                            {/* Table */}
                            <div className="overflow-x-auto custom-scrollbar max-h-[500px]">
                                <table className="w-full text-right text-sm min-w-[760px]">
                                    <thead className="sticky top-0 bg-muted/90 backdrop-blur z-10">
                                        <tr className="border-b border-border text-muted-foreground">
                                            <th className="py-3 px-4 font-bold">اليوم</th>
                                            <th className="py-3 px-4 font-bold">التاريخ</th>
                                            <th className="py-3 px-4 font-bold">الحضور</th>
                                            <th className="py-3 px-4 font-bold">الانصراف</th>
                                            <th className="py-3 px-4 font-bold">الساعات</th>
                                            <th className="py-3 px-4 font-bold">الحالة</th>
                                            <th className="py-3 px-4 font-bold">ملاحظة</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {periodRows.length === 0 ? (
                                            <tr>
                                                <td colSpan={7} className="py-8 text-center text-muted-foreground">اختر فترة زمنية صحيحة لعرض الأيام.</td>
                                            </tr>
                                        ) : (
                                            periodRows.map((r, i) => {
                                                const hours = NO_HOURS_STATUSES.has(r.status) ? 0 : computeHours(r.check_in, r.check_out);
                                                const isToday = r.date === localDateStr(new Date());
                                                const isFriday = r.dayName === "الجمعة";
                                                return (
                                                    <tr key={r.date} className={`${isToday ? "bg-rose-500/5 font-semibold" : isFriday ? "bg-muted/20 text-muted-foreground" : "hover:bg-muted/30"} transition-colors`}>
                                                        <td className="py-2.5 px-4 font-bold text-foreground">
                                                            {r.dayName}
                                                            {isToday && <span className="text-[10px] bg-rose-500/10 text-rose-500 px-1.5 py-0.5 rounded-full mr-1.5">اليوم</span>}
                                                        </td>
                                                        <td className="py-2.5 px-4 font-mono text-muted-foreground" dir="ltr">{r.date}</td>
                                                        <td className="py-2.5 px-4">
                                                            <input
                                                                type="time"
                                                                value={r.check_in}
                                                                onChange={e => setRow(i, "check_in", e.target.value)}
                                                                className="bg-muted border border-border rounded-lg p-1.5 text-foreground text-xs font-mono focus:border-rose-500 focus:outline-none"
                                                            />
                                                        </td>
                                                        <td className="py-2.5 px-4">
                                                            <input
                                                                type="time"
                                                                value={r.check_out}
                                                                onChange={e => setRow(i, "check_out", e.target.value)}
                                                                className="bg-muted border border-border rounded-lg p-1.5 text-foreground text-xs font-mono focus:border-rose-500 focus:outline-none"
                                                            />
                                                        </td>
                                                        <td className="py-2.5 px-4 font-mono font-bold text-foreground" dir="ltr">
                                                            {hours ? `${hours} س` : "—"}
                                                        </td>
                                                        <td className="py-2.5 px-4">
                                                            <select
                                                                value={r.status}
                                                                onChange={e => setRow(i, "status", e.target.value)}
                                                                className="bg-muted border border-border rounded-lg p-1.5 text-foreground text-xs focus:border-rose-500 focus:outline-none cursor-pointer"
                                                            >
                                                                {ATTENDANCE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                                                            </select>
                                                        </td>
                                                        <td className="py-2.5 px-4">
                                                            <input
                                                                type="text"
                                                                value={r.note}
                                                                onChange={e => setRow(i, "note", e.target.value)}
                                                                placeholder="—"
                                                                className="w-full min-w-[110px] bg-muted border border-border rounded-lg p-1.5 text-foreground text-xs focus:border-rose-500 focus:outline-none"
                                                            />
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {/* Save Footer */}
                            <div className="p-4 border-t border-border bg-card/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <span className="text-xs text-muted-foreground">
                                    يتم حفظ جميع الأيام التي أدخلت فيها أوقات أو غيرت حالتها في الفترة المحددة ({rangeStart} إلى {rangeEnd}).
                                </span>
                                <button
                                    onClick={savePeriod}
                                    disabled={savingPeriod}
                                    className="px-6 py-2.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-rose-500/20"
                                >
                                    {savingPeriod ? <Loader2 className="animate-spin" size={17} /> : <Save size={17} />} حفظ التغييرات
                                </button>
                            </div>
                        </div>

                        {/* Month records archive */}
                        <div className="glass-card rounded-2xl border border-border overflow-hidden">
                            <div className="p-5 border-b border-border flex items-center justify-between">
                                <h3 className="text-lg font-bold text-foreground">سجل الحضور المحفوظ — شهر {monthKey}</h3>
                                <span className="text-xs text-muted-foreground font-mono">{monthRecords.length} سجل</span>
                            </div>
                            {monthRecords.length === 0 ? (
                                <p className="p-8 text-center text-muted-foreground text-sm">لا توجد سجلات دوام محفوظة لهذا الشهر.</p>
                            ) : (
                                <div className="overflow-x-auto custom-scrollbar">
                                    <table className="w-full text-right text-sm min-w-[700px]">
                                        <thead>
                                            <tr className="bg-muted/60 text-muted-foreground">
                                                <th className="py-3 px-4 font-bold">التاريخ</th>
                                                <th className="py-3 px-4 font-bold">الحضور</th>
                                                <th className="py-3 px-4 font-bold">الانصراف</th>
                                                <th className="py-3 px-4 font-bold">الساعات</th>
                                                <th className="py-3 px-4 font-bold">الحالة</th>
                                                <th className="py-3 px-4 font-bold">ملاحظة</th>
                                                <th className="py-3 px-4"></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                            {monthRecords.map(r => (
                                                <tr key={r.id} className="hover:bg-muted/40 transition-colors">
                                                    <td className="py-2.5 px-4 font-mono" dir="ltr">{r.date}</td>
                                                    <td className="py-2.5 px-4 font-mono text-muted-foreground" dir="ltr">{r.check_in ? r.check_in.slice(0, 5) : "—"}</td>
                                                    <td className="py-2.5 px-4 font-mono text-muted-foreground" dir="ltr">{r.check_out ? r.check_out.slice(0, 5) : "—"}</td>
                                                    <td className="py-2.5 px-4 font-mono font-bold" dir="ltr">{Number(r.calculated_hours) || "—"}</td>
                                                    <td className="py-2.5 px-4">
                                                        <span className={`text-[11px] px-2 py-1 rounded border font-bold ${ATT_STATUS_STYLE[r.attendance_status] || "bg-muted text-muted-foreground border-border"}`}>{r.attendance_status}</span>
                                                    </td>
                                                    <td className="py-2.5 px-4 text-muted-foreground text-xs max-w-[180px] truncate">{r.note || "—"}</td>
                                                    <td className="py-2.5 px-4">
                                                        <button onClick={() => deleteRecord(r)} className="p-1.5 text-muted-foreground hover:text-rose-500 transition-colors" title="حذف السجل"><Trash2 size={15} /></button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── Tab: نظرة عامة ── */}
                {activeTab === "overview" && (
                    <div className="glass-card p-6 rounded-2xl border border-border space-y-5">
                        <h3 className="text-lg font-bold text-foreground">نظرة عامة</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
                            <OverviewRow label="الرقم الوظيفي" value={emp.employee_code} mono />
                            <OverviewRow label="الاختصاص" value={emp.job_title || "—"} />
                            <OverviewRow label="الفرع" value={branchName(emp.branch_id)} />
                            <OverviewRow label="الهاتف" value={emp.phone || "—"} mono />
                            <OverviewRow label="تاريخ المباشرة" value={emp.hire_date || "—"} mono />
                            <OverviewRow label="نوع الأجر" value={`${WAGE_TYPE_LABEL[emp.wage_type]} — ${fmt(emp.wage_rate)} د.ع`} />
                            <OverviewRow label="الساعات الشهرية المطلوبة" value={`${fmt(emp.required_monthly_hours)} ساعة`} />
                            <OverviewRow label="إجمالي سجلات الدوام" value={`${records.length} سجل`} />
                        </div>
                        <div>
                            <div className="flex justify-between items-center mb-1.5">
                                <span className="text-xs font-bold text-muted-foreground">نسبة دوام شهر {monthKey}</span>
                                <span className={`text-sm font-black font-mono ${pctColor(monthStats.pct)}`}>{monthStats.pct}%</span>
                            </div>
                            <div className="h-2.5 bg-muted rounded-full overflow-hidden border border-border/50">
                                <div className={`h-full rounded-full transition-all ${pctBarColor(monthStats.pct)}`} style={{ width: `${Math.min(100, monthStats.pct)}%` }} />
                            </div>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground bg-muted/50 border border-border rounded-xl p-3">
                            <QrCode size={16} className="text-rose-400 shrink-0" />
                            رمز QR الخاص بالموظف (أعلى الصفحة) يحمل الرقم الوظيفي وجاهز للاستخدام مستقبلاً في تسجيل الحضور بالمسح.
                        </div>
                    </div>
                )}

                {/* ── Tab: الرواتب ── */}
                {activeTab === "salary" && (
                    <div className="glass-card rounded-2xl border border-border overflow-hidden">
                        <div className="p-5 border-b border-border">
                            <h3 className="text-lg font-bold text-foreground">الرواتب المحتسبة من سجل الدوام</h3>
                            <p className="text-xs text-muted-foreground mt-1">
                                {emp.wage_type === "hourly"
                                    ? `الأجر بالساعة: الراتب = مجموع الساعات × ${fmt(emp.wage_rate)} د.ع`
                                    : `الأجر باليومية: الراتب = مجموع أيام الدوام × ${fmt(emp.wage_rate)} د.ع (نصف الدوام = نصف يوم)`}
                            </p>
                        </div>
                        {monthlySalaries.length === 0 ? (
                            <p className="p-8 text-center text-muted-foreground text-sm">لا توجد رواتب محتسبة — أضف سجلات دوام أولاً.</p>
                        ) : (
                            <div className="overflow-x-auto custom-scrollbar">
                                <table className="w-full text-right text-sm min-w-[600px]">
                                    <thead>
                                        <tr className="bg-muted/60 text-muted-foreground">
                                            <th className="py-3 px-4 font-bold">الشهر</th>
                                            <th className="py-3 px-4 font-bold">مجموع الساعات</th>
                                            <th className="py-3 px-4 font-bold">أيام الدوام</th>
                                            <th className="py-3 px-4 font-bold">نسبة الدوام</th>
                                            <th className="py-3 px-4 font-bold">الراتب المستحق</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {monthlySalaries.map(m => (
                                            <tr key={m.month} className={`hover:bg-muted/40 transition-colors ${m.month === monthKey ? "bg-rose-500/5" : ""}`}>
                                                <td className="py-3 px-4 font-mono font-bold" dir="ltr">{m.month}</td>
                                                <td className="py-3 px-4 font-mono" dir="ltr">{fmt(m.hours)}</td>
                                                <td className="py-3 px-4 font-mono" dir="ltr">{m.days}</td>
                                                <td className="py-3 px-4"><span className={`font-mono font-bold ${pctColor(m.pct)}`}>{m.pct}%</span></td>
                                                <td className="py-3 px-4 font-mono font-black text-emerald-500" dir="ltr">{fmt(m.salary)} د.ع</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* ── Placeholder tabs ── */}
                {(activeTab === "leaves" || activeTab === "documents") && (
                    <div className="glass-card p-12 rounded-2xl border-dashed border-2 border-border text-center">
                        <p className="text-muted-foreground font-bold">قسم «{activeTab === "leaves" ? "الإجازات" : "المستندات"}» سيتم تفعيله في المرحلة القادمة من نظام الموارد البشرية.</p>
                    </div>
                )}
            </div>

            {/* ── Paste Table Modal (لصق جدول Excel / بصمة) ── */}
            {isPasteModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in" dir="rtl">
                    <div className="bg-card border border-border rounded-3xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
                        {/* Modal Header */}
                        <div className="p-5 border-b border-border flex items-center justify-between bg-muted/40">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
                                    <FileSpreadsheet size={22} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-foreground">لصق جدول الدوام (Excel / جهاز البصمة)</h3>
                                    <p className="text-xs text-muted-foreground">انسخ الأعمدة من Excel أو تقرير البصمة والصقها مباشرة هنا.</p>
                                </div>
                            </div>
                            <button
                                onClick={() => { setIsPasteModalOpen(false); setPasteRawText(""); }}
                                className="p-2 text-muted-foreground hover:text-foreground rounded-xl hover:bg-muted transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="p-6 overflow-y-auto custom-scrollbar space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-foreground mb-1.5">
                                    ألصق البيانات المنسوخة (Ctrl + V):
                                </label>
                                <textarea
                                    value={pasteRawText}
                                    onChange={e => setPasteRawText(e.target.value)}
                                    placeholder={`مثال لصق مع تواريخ:\n2026-08-01\t08:30\t17:00\tحاضر\n2026-08-02\t08:30\t17:00\tحاضر\n2026-08-03\t09:00\t18:00\tحاضر\n\nأو بدون تواريخ (تعبئة بالتسلسل):\n08:30\t17:00\n08:30\t17:00`}
                                    rows={6}
                                    className="w-full bg-muted border border-border rounded-2xl p-3.5 text-foreground text-xs font-mono focus:border-emerald-500 focus:outline-none resize-y"
                                    dir="ltr"
                                    autoFocus
                                />
                            </div>

                            {/* Options */}
                            <div className="flex flex-wrap items-center gap-4 text-xs">
                                <label className="flex items-center gap-2 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={pasteAutoExpand}
                                        onChange={e => setPasteAutoExpand(e.target.checked)}
                                        className="rounded border-border text-emerald-600 focus:ring-emerald-500"
                                    />
                                    <span className="text-foreground">توسيع نطاق الفترة تلقائياً لتشمل تواريخ الجدول المنسوخ</span>
                                </label>
                            </div>

                            {/* Live Parsed Preview */}
                            {pasteRawText.trim() && (
                                <div className="border border-border rounded-2xl p-4 bg-muted/20 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                                            <CheckCircle2 size={15} className="text-emerald-500" />
                                            معاينة البيانات المكتشفة ({parsedPastedRows.length} صف):
                                        </h4>
                                        <span className="text-[11px] text-muted-foreground">
                                            {parsedPastedRows.filter(r => r.date).length} صف يحمل تاريخاً محدداً
                                        </span>
                                    </div>

                                    {parsedPastedRows.length === 0 ? (
                                        <p className="text-xs text-amber-500 bg-amber-500/10 p-2.5 rounded-xl border border-amber-500/20">
                                            لم يتم التعرف على أوقات أو تواريخ صالحة. تأكد من نسخ أوقات مثل (08:30 أو 8:30 AM/PM).
                                        </p>
                                    ) : (
                                        <div className="overflow-x-auto max-h-48 custom-scrollbar border border-border rounded-xl">
                                            <table className="w-full text-right text-xs">
                                                <thead className="bg-muted/80 sticky top-0 text-muted-foreground">
                                                    <tr>
                                                        <th className="py-2 px-3">#</th>
                                                        <th className="py-2 px-3">التاريخ</th>
                                                        <th className="py-2 px-3">الحضور</th>
                                                        <th className="py-2 px-3">الانصراف</th>
                                                        <th className="py-2 px-3">الساعات</th>
                                                        <th className="py-2 px-3">الحالة</th>
                                                        <th className="py-2 px-3">ملاحظة</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-border">
                                                    {parsedPastedRows.slice(0, 50).map((r, idx) => {
                                                        const h = computeHours(r.check_in, r.check_out);
                                                        return (
                                                            <tr key={idx} className="hover:bg-muted/30">
                                                                <td className="py-1.5 px-3 font-mono text-muted-foreground">{idx + 1}</td>
                                                                <td className="py-1.5 px-3 font-mono" dir="ltr">{r.date || `— (صف ${idx + 1})`}</td>
                                                                <td className="py-1.5 px-3 font-mono" dir="ltr">{r.check_in || "—"}</td>
                                                                <td className="py-1.5 px-3 font-mono" dir="ltr">{r.check_out || "—"}</td>
                                                                <td className="py-1.5 px-3 font-mono font-bold">{h ? `${h} س` : "—"}</td>
                                                                <td className="py-1.5 px-3"><span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-500 rounded text-[10px] font-bold">{r.status || "حاضر"}</span></td>
                                                                <td className="py-1.5 px-3 text-muted-foreground text-[11px] truncate max-w-[120px]">{r.note || "—"}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Modal Footer */}
                        <div className="p-4 border-t border-border bg-muted/30 flex items-center justify-end gap-2">
                            <button
                                onClick={() => { setIsPasteModalOpen(false); setPasteRawText(""); }}
                                className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground font-bold rounded-xl text-xs transition-colors"
                            >
                                إلغاء
                            </button>
                            <button
                                onClick={applyPastedRows}
                                disabled={parsedPastedRows.length === 0}
                                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition-colors shadow-lg shadow-emerald-600/20"
                            >
                                <CheckCircle2 size={16} /> تطبيق على الجدول ({parsedPastedRows.length} صف)
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isEditOpen && (
                <EmployeeFormModal
                    employee={emp}
                    branches={branches}
                    onClose={() => setIsEditOpen(false)}
                    onSaved={fetchData}
                />
            )}
        </div>
    );
}

function SummaryCard({ icon, color, title, value, sub }: { icon: React.ReactNode; color: string; title: string; value: string; sub: string }) {
    return (
        <div className="glass-card p-4 rounded-2xl border border-border">
            <div className="flex items-center gap-2.5 mb-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>{icon}</div>
                <p className="text-xs font-bold text-muted-foreground">{title}</p>
            </div>
            <p className="text-xl font-display font-bold text-foreground" dir="ltr">{value}</p>
            <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>
        </div>
    );
}

function OverviewRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="flex justify-between items-center border-b border-border/50 pb-2">
            <span className="text-muted-foreground">{label}</span>
            <span className={`font-bold text-foreground ${mono ? "font-mono" : ""}`} dir={mono ? "ltr" : undefined}>{value}</span>
        </div>
    );
}

function CircularProgress({ pct }: { pct: number }) {
    const r = 26;
    const c = 2 * Math.PI * r;
    const clamped = Math.min(100, Math.max(0, pct));
    const stroke = pct >= 90 ? "#10b981" : pct >= 70 ? "#f59e0b" : "#f43f5e";
    return (
        <svg width="68" height="68" viewBox="0 0 68 68" className="shrink-0 -rotate-90">
            <circle cx="34" cy="34" r={r} fill="none" strokeWidth="7" className="stroke-muted" />
            <circle cx="34" cy="34" r={r} fill="none" strokeWidth="7" stroke={stroke} strokeLinecap="round"
                strokeDasharray={c} strokeDashoffset={c - (c * clamped) / 100} style={{ transition: "stroke-dashoffset 0.6s ease" }} />
        </svg>
    );
}
