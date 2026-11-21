"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ClipboardList, Loader2, UserRound } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthProvider";
import { showError, showSuccess } from "@/lib/alerts";

type Task = { id: string; title: string; details: string | null; due_date: string | null; status: string; created_at: string; completed_at: string | null };
const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const localDay = (iso?: string | null) => (iso ? dayOf(new Date(iso)) : "");

/** «مهامي»: the signed-in employee's own tasks. The id comes from the session, never the address. */
export default function MyTasksPage() {
    const { employeeId, loading: authLoading } = useAuth();
    const [tasks, setTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);
    const [showDone, setShowDone] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!employeeId) return;
        const { data, error } = await (supabase as any).from("employee_tasks")
            .select("id,title,details,due_date,status,created_at,completed_at")
            .eq("employee_id", employeeId).is("deleted_at", null)
            .order("due_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
        if (error) showError("تعذر تحميل المهام", String(error.message || error));
        setTasks((data || []) as Task[]);
        setLoading(false);
    }, [employeeId]);
    useEffect(() => { if (!authLoading) load(); }, [authLoading, load]); // eslint-disable-line react-hooks/set-state-in-effect -- loads data once auth is ready

    const complete = async (task: Task) => {
        setBusy(task.id);
        const { error } = await (supabase as any).from("employee_tasks").update({ status: "مكتملة", completed_at: new Date().toISOString() }).eq("id", task.id);
        setBusy(null);
        if (error) return showError("تعذر تحديث المهمة", String(error.message || error));
        showSuccess("أحسنت", "تم تسجيل إنجاز المهمة.");
        await load();
    };

    if (authLoading || (loading && employeeId)) return <div className="min-h-screen flex items-center justify-center" dir="rtl"><Loader2 className="animate-spin text-muted-foreground" /></div>;
    if (!employeeId) return <div className="min-h-screen flex items-center justify-center" dir="rtl"><div className="glass-card p-8 rounded-2xl text-center">لا يوجد ملف موظف مرتبط بهذا الحساب. راجع الإدارة.</div></div>;

    const today = dayOf(new Date());
    const open = tasks.filter(t => t.status !== "مكتملة");
    const done = tasks.filter(t => t.status === "مكتملة").sort((a, b) => (b.completed_at || "").localeCompare(a.completed_at || ""));
    const late = open.filter(t => t.due_date && t.due_date < today).length;

    return <main className="min-h-screen p-5 md:p-8 font-ibm" dir="rtl"><div className="max-w-3xl mx-auto space-y-5">
        <header className="glass-card p-6 rounded-2xl flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center"><ClipboardList size={28} /></div>
                <div><h1 className="text-2xl font-bold">مهامي</h1><p className="text-muted-foreground text-sm">{open.length ? `${open.length} مهمة مفتوحة${late ? ` • ${late} متأخرة` : ""}` : "لا توجد مهام مفتوحة"}</p></div>
            </div>
            <Link href="/my/profile" className="text-sm text-cyan-400 flex items-center gap-2"><UserRound size={16} />حسابي الشخصي</Link>
        </header>

        <section className="space-y-3">
            {open.map(task => { const isLate = !!task.due_date && task.due_date < today; return <div key={task.id} className={`glass-card rounded-2xl p-5 border ${isLate ? "border-rose-500/40" : "border-transparent"}`}>
                <div className="flex justify-between gap-3"><b className="text-lg">{task.title}</b>
                    <span className={`text-xs whitespace-nowrap ${isLate ? "text-rose-400 font-bold" : "text-muted-foreground"}`}>{task.due_date ? `${isLate ? "متأخرة • " : task.due_date === today ? "اليوم • " : ""}${task.due_date}` : "بدون موعد"}</span></div>
                {task.details && <p className="text-sm text-muted-foreground mt-2 whitespace-pre-line">{task.details}</p>}
                <div className="flex justify-between items-center mt-4">
                    <span className="text-xs text-amber-300">{task.status}</span>
                    <button disabled={busy === task.id} onClick={() => complete(task)} className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-60">
                        {busy === task.id ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}إنجاز المهمة</button>
                </div>
            </div>; })}
            {open.length === 0 && <div className="glass-card rounded-2xl p-10 text-center text-muted-foreground">ممتاز، لا توجد مهام مفتوحة حالياً.</div>}
        </section>

        {done.length > 0 && <section className="glass-card rounded-2xl overflow-hidden">
            <button onClick={() => setShowDone(v => !v)} className="w-full p-4 flex justify-between text-sm font-bold"><span>المهام المكتملة ({done.length})</span><span className="text-muted-foreground">{showDone ? "إخفاء" : "عرض"}</span></button>
            {showDone && <div className="divide-y divide-border border-t border-border">{done.map(task => <div key={task.id} className="p-4 flex justify-between gap-3 text-sm"><span>{task.title}</span><span className="text-emerald-400 text-xs whitespace-nowrap">أُنجزت {localDay(task.completed_at)}</span></div>)}</div>}
        </section>}
    </div></main>;
}
