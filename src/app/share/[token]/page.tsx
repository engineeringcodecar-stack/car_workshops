"use client";

// A contract's private read-only link (e.g. for محافظة ميسان): its work sheets,
// nothing else. No login, and nothing to edit, add or search.
//
// Data comes from ONE security-definer function, get_contract_worksheets(token),
// which returns only this contract's sheets. The visitor has no table access at
// all, so even someone who opens the browser tools cannot reach anything else.

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import { FileText, Loader2, Printer, X, ClipboardCheck, Eye } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PrintableInspectionReport } from "@/components/PrintableInspectionReport";
import { ComprehensiveInspectionReport } from "@/components/ComprehensiveInspectionReport";

type Joined<T> = T | T[] | null;
type Sheet = {
    id: string;
    report_number: number;
    status: string;
    created_at: string;
    selected_services: Record<string, unknown>[] | null;
    vehicles: Joined<{ make: string | null; model: string | null; plate_number: string | null; clients: Joined<{ name: string | null }> }>;
    branches: Joined<{ name: string }>;
};
type Data = { contract: { name: string }; orders: Sheet[] };

const PAGE = 30;
const one = <T,>(v: Joined<T> | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const fmtDate = (iso: string) => {
    const d = new Date(new Date(iso).getTime() + 3 * 3600 * 1000);
    return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
};
const statusOf = (s: string) =>
    s === "تم الانتهاء" ? { text: "منجزة", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" }
    : s === "قيد العمل" ? { text: "قيد العمل", cls: "bg-amber-500/10 text-amber-400 border-amber-500/20" }
    : { text: "بالانتظار", cls: "bg-sky-500/10 text-sky-400 border-sky-500/20" };
const payloadOf = (s: Sheet) => (Array.isArray(s.selected_services) ? s.selected_services[0] : null) || {};

export default function ContractSharePage() {
    const token = String(useParams().token || "");
    const [data, setData] = useState<Data | null>(null);
    const [state, setState] = useState<"loading" | "ok" | "invalid" | "error">("loading");
    const [shown, setShown] = useState(PAGE);
    const [open, setOpen] = useState<Sheet | null>(null);
    const [view, setView] = useState<"sheet" | "inspection">("sheet");

    useEffect(() => {
        let alive = true;
        supabase.rpc("get_contract_worksheets", { p_token: token }).then(({ data: d, error }) => {
            if (!alive) return;
            if (error) { setState("error"); return; }
            if (!d) { setState("invalid"); return; }
            setData(d as unknown as Data);
            setState("ok");
        });
        return () => { alive = false; };
    }, [token]);

    const orders = useMemo(() => data?.orders || [], [data]);
    const openSheet = (s: Sheet) => {
        setOpen(s);
        setView(payloadOf(s).isComprehensiveInspection ? "inspection" : "sheet");
    };

    if (state === "loading") {
        return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-amber-500 w-10 h-10" /></div>;
    }
    if (state !== "ok" || !data) {
        return (
            <div className="min-h-screen flex items-center justify-center p-6 text-center" dir="rtl">
                <div className="max-w-sm space-y-2">
                    <FileText className="mx-auto text-muted-foreground" size={40} />
                    <h1 className="text-xl font-bold">{state === "invalid" ? "الرابط غير صالح أو تم إيقافه" : "تعذّر تحميل أوراق العمل"}</h1>
                    <p className="text-sm text-muted-foreground">{state === "invalid" ? "يرجى طلب رابط جديد من مركز هندسة السيارات." : "تحقق من الاتصال وأعد تحميل الصفحة."}</p>
                </div>
            </div>
        );
    }

    const hasInspection = !!(open && payloadOf(open).comprehensiveInspection);

    return (
        <div dir="rtl">
            {/* ── Screen ── */}
            <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-6 print:hidden">
                <header className="flex items-center gap-3">
                    <Image src="/logo.png" alt="هندسة السيارات" width={48} height={48} className="w-12 h-12 rounded-xl object-contain bg-white/5 border border-border/40 p-1 shrink-0" />
                    <div className="min-w-0">
                        <div className="text-xs text-muted-foreground">مركز هندسة السيارات</div>
                        <h1 className="text-xl md:text-2xl font-display font-bold truncate">أوراق عمل عقد {data.contract.name}</h1>
                    </div>
                    <span className="mr-auto shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full bg-muted border border-border flex items-center gap-1">
                        <Eye size={12} /> عرض فقط
                    </span>
                </header>

                {orders.length === 0 ? (
                    <div className="glass-card p-10 rounded-3xl text-center text-muted-foreground text-sm">لا توجد أوراق عمل حتى الآن.</div>
                ) : (
                    <div className="space-y-2">
                        {orders.slice(0, shown).map(s => {
                            const v = one(s.vehicles);
                            const st = statusOf(s.status);
                            const p = payloadOf(s);
                            return (
                                <button key={s.id} onClick={() => openSheet(s)}
                                    className="w-full text-right glass-card rounded-2xl border border-border hover:border-amber-500/40 p-4 flex flex-wrap items-center gap-x-5 gap-y-2 transition-colors">
                                    <span className="font-mono font-bold">#{s.report_number}</span>
                                    <span className="text-sm text-muted-foreground">{fmtDate(s.created_at)}</span>
                                    <span className="font-bold">{p.isComprehensiveInspection ? "فحص شامل" : `${v?.make || ""} ${v?.model || ""}`.trim() || "—"}</span>
                                    {v?.plate_number && <span className="font-mono text-sm text-muted-foreground">{v.plate_number}</span>}
                                    {one(v?.clients)?.name && <span className="text-sm text-muted-foreground">{one(v?.clients)?.name}</span>}
                                    <span className="text-sm text-muted-foreground">{one(s.branches)?.name || ""}</span>
                                    <span className={`mr-auto text-[11px] font-bold px-2 py-1 rounded-lg border ${st.cls}`}>{st.text}</span>
                                </button>
                            );
                        })}
                        {shown < orders.length && (
                            <button onClick={() => setShown(n => n + PAGE)} className="w-full py-3 rounded-2xl bg-card border border-border hover:bg-muted text-sm font-bold">
                                عرض المزيد ({orders.length - shown})
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* ── One sheet, as it prints ── */}
            {open && (
                <>
                    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col print:hidden" onClick={() => setOpen(null)}>
                        <div className="flex flex-wrap items-center gap-2 p-3 bg-background border-b border-border" onClick={e => e.stopPropagation()}>
                            <span className="font-bold ml-2">ورقة العمل #{open.report_number}</span>
                            {hasInspection && !payloadOf(open).isComprehensiveInspection && (
                                <button onClick={() => setView(view === "sheet" ? "inspection" : "sheet")}
                                    className="px-3 py-2 rounded-xl bg-blue-600/10 border border-blue-500/30 text-blue-400 text-sm font-bold flex items-center gap-1.5">
                                    <ClipboardCheck size={15} /> {view === "sheet" ? "تقرير الفحص الشامل" : "ورقة العمل"}
                                </button>
                            )}
                            <button onClick={() => window.print()} className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold flex items-center gap-1.5">
                                <Printer size={15} /> طباعة
                            </button>
                            <button onClick={() => setOpen(null)} className="mr-auto p-2 rounded-xl bg-muted hover:bg-rose-500 hover:text-white border border-border" title="إغلاق"><X size={18} /></button>
                        </div>
                        <div className="flex-1 overflow-auto p-3 md:p-6" onClick={e => e.stopPropagation()}>
                            <div className="mx-auto w-[210mm] min-w-[794px] bg-white text-slate-900 rounded-lg shadow-2xl print-preview-doc">
                                {view === "inspection" ? <ComprehensiveInspectionReport report={open} /> : <PrintableInspectionReport report={open} />}
                            </div>
                        </div>
                    </div>
                    <div className="hidden print:block bg-white">
                        {view === "inspection" ? <ComprehensiveInspectionReport report={open} /> : <PrintableInspectionReport report={open} />}
                    </div>
                </>
            )}
        </div>
    );
}
