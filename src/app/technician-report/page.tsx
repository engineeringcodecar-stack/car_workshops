"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthProvider";
import { Wrench, Loader2, Car, ClipboardCheck, Users, Printer, ChevronLeft, Search, Download } from "lucide-react";
import * as XLSX from 'xlsx';

// Supervisor rating levels, worst -> best (used for the ratings breakdown/export).
const RATING_LEVELS = ['رديء', 'متوسط', 'جيد', 'جيد جداً', 'ممتاز'];

type ReportRow = {
    id: string;
    report_number: number;
    status: string;
    created_at: string;
    technician_rating: string | null;
    technician_rating_notes: string | null;
    selected_services: any[] | null;
    vehicles: { make: string; model: string; plate_number: string | null } | { make: string; model: string; plate_number: string | null }[] | null;
};

type OrderItem = {
    id: string;
    report_number: number;
    date: string;
    status: string;
    vehicle: string;
    services: number;
};

type TechGroup = {
    name: string;
    cars: number;
    services: number;
    completed: number;
    orders: OrderItem[];
    ratings: Record<string, number>;
    // Supervisor rating notes, shown in-app only (excluded from the printed report).
    notes: { report_number: number; note: string }[];
};

function monthStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(ym: string) {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "2-digit", year: "numeric" });
}

// Maintenance work a technician did on a report: services flagged "يحتاج تغيير" + custom/free services.
function countServices(payload: any): number {
    if (!payload) return 0;
    let n = 0;
    if (payload.services && typeof payload.services === "object") {
        n += Object.values(payload.services).filter((v: any) => v && v.status === "يحتاج تغيير").length;
    }
    if (Array.isArray(payload.customServices)) n += payload.customServices.length;
    if (Array.isArray(payload.freeServices)) n += payload.freeServices.length;
    return n;
}

// A car may be worked by more than one technician, written as one field joined by
// + - / , ، & or "و" (e.g. "عباس عجل+حسن"). Split it so each technician is credited
// individually instead of creating a shared/combined profile.
function splitTechnicians(raw: any): string[] {
    if (!raw) return [];
    const parts = String(raw)
        .split(/\s*[+\-/،,&]\s*|\s+و\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
    return Array.from(new Set(parts)); // de-dupe within the same car
}

// Canonicalize an Arabic name for *matching* (not for display): unify the common
// data-entry variants — alef/hamza forms, ة/ه, ى/ي, tatweel, diacritics, spacing.
// Names that differ only by these collapse to the same key.
function normalizeName(raw: string): string {
    return (raw || "")
        .replace(/[ً-ٰٟ]/g, "") // diacritics
        .replace(/ـ/g, "")                 // tatweel ـ
        .replace(/[إأآٱا]/g, "ا")               // alef variants -> ا
        .replace(/ى/g, "ي")                     // alef maqsura -> ي
        .replace(/ؤ/g, "و")
        .replace(/ئ/g, "ي")
        .replace(/ة/g, "ه")                     // ta marbuta -> ه
        .replace(/[^ء-ي٠-٩a-z0-9 ]/gi, " ") // strip punctuation
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

// Levenshtein edit distance (small inputs — names).
function editDistance(a: string, b: string): number {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
        let prev = dp[0];
        dp[0] = i;
        for (let j = 1; j <= n; j++) {
            const tmp = dp[j];
            dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
            prev = tmp;
        }
    }
    return dp[n];
}

// Two normalized names are "the same technician" when they're identical or within
// a small typo distance. Short names require an exact match to avoid false merges.
function namesAreClose(a: string, b: string): boolean {
    if (a === b) return true;
    const maxLen = Math.max(a.length, b.length);
    if (maxLen < 4) return false;
    return 1 - editDistance(a, b) / maxLen >= 0.84;
}

export default function TechnicianReportPage() {
    const { employeeRole, employeeBranchId, allowedPages, loading: authLoading } = useAuth();
    // تقرير الفنيين محجوب عن الموظفين افتراضياً: المالك والمدير دائماً، وغيرهم فقط
    // إذا مُنحوا تبويب «تقرير الفنيين اليومي» من الإعدادات → صلاحيات التبويبات.
    const isAuthorized = employeeRole === "Owner" || employeeRole === "Admin"
        || (Array.isArray(allowedPages) && allowedPages.includes("technician-report"));

    const [month, setMonth] = useState<string>(monthStr());
    const [rows, setRows] = useState<ReportRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTech, setSelectedTech] = useState<string | null>(null);
    const [techSearch, setTechSearch] = useState("");

    const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
    // "" = كل الفروع. Follows the sidebar: on "all branches" it used to force the first branch.
    const [selectedBranchId, setSelectedBranchId] = useState<string>("");
    const [branchesReady, setBranchesReady] = useState(false);
    const canPickBranch = employeeRole === "Owner" || employeeRole === "Admin" || !employeeBranchId;
    const branchName = selectedBranchId ? (branches.find((b) => b.id === selectedBranchId)?.name || "") : (branches.length === 1 ? branches[0].name : "كل الفروع");

    useEffect(() => {
        const fetchBranches = async () => {
            const { data } = await supabase.from("branches").select("id, name");
            if (data && data.length > 0) setBranches(data);
            setSelectedBranchId(employeeBranchId || "");
            setBranchesReady(true);
        };
        fetchBranches();
    }, [employeeBranchId]);

    useEffect(() => {
        if (authLoading || !isAuthorized) return;
        if (!branchesReady) return;
        setSelectedTech(null);

        const fetchRows = async () => {
            setLoading(true);
            const [y, m] = month.split("-").map(Number);
            const monthStart = new Date(y, m - 1, 1);
            const monthEnd = new Date(y, m, 1);

            // Page through the month in 1000-row chunks — Supabase silently caps a single
            // query at 1000 rows, which truncated busy months and skewed the totals.
            const PAGE_SIZE = 1000;
            const MAX_ROWS = 100000;
            const all: ReportRow[] = [];
            for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
                let query = supabase
                    .from("inspection_reports")
                    .select("id, report_number, status, created_at, technician_rating, technician_rating_notes, selected_services, vehicles (make, model, plate_number)")
                    .neq("order_type", "sale")
                    .gte("created_at", monthStart.toISOString())
                    .lt("created_at", monthEnd.toISOString())
                    .order("created_at", { ascending: false })
                    .range(from, from + PAGE_SIZE - 1);

                // Staff locked to a branch always see their own; others see the picked one or all.
                const branchFilter = canPickBranch ? selectedBranchId : employeeBranchId;
                if (branchFilter) query = query.eq("branch_id", branchFilter);

                const { data } = await query;
                if (data && data.length) all.push(...(data as any));
                if (!data || data.length < PAGE_SIZE) break;
            }
            setRows(all);
            setLoading(false);
        };
        fetchRows();
    }, [month, selectedBranchId, employeeBranchId, authLoading, isAuthorized, branchesReady, canPickBranch]);

    const { groups, totalCars, totalServices } = useMemo(() => {
        const UNSET = "غير محدد";
        type Acc = { cars: number; services: number; completed: number; orders: OrderItem[]; spellings: Map<string, number>; ratings: Map<string, number>; notes: { report_number: number; note: string }[] };
        const byKey = new Map<string, Acc>(); // keyed by normalized name
        let totalCars = 0;
        let totalServices = 0;

        for (const r of rows) {
            const payload = Array.isArray(r.selected_services) ? r.selected_services[0] : r.selected_services;
            // An invoice removed from صفحة التدقيق is junk — no technician gets credit for it.
            if (payload?.pricing?.auditExcluded === true) continue;
            const v = Array.isArray(r.vehicles) ? r.vehicles[0] : r.vehicles;
            const sc = countServices(payload);
            // Totals are per actual car (a shared car is still one car / its services counted once).
            totalCars += 1;
            totalServices += sc;

            // Multi-technician: prefer the structured array (each tech carries its OWN rating);
            // fall back to the old joined name + single column rating for legacy orders.
            const techEntries: { name: string; rating: string; note: string }[] = Array.isArray(payload?.technicians) && payload.technicians.length
                ? payload.technicians
                    .map((t: any) => ({ name: (t?.name || "").trim(), rating: t?.rating || "", note: (t?.notes || "").trim() }))
                    .filter((t: { name: string }) => t.name)
                : splitTechnicians(payload?.technicianName).map((n: string, i: number) => ({
                    name: n, rating: r.technician_rating || "",
                    // legacy single-column note belongs to the first technician
                    note: i === 0 ? (r.technician_rating_notes || "").trim() : "",
                }));
            const entries = techEntries.length ? techEntries : [{ name: UNSET, rating: "", note: "" }];
            const order: OrderItem = {
                id: r.id,
                report_number: r.report_number,
                date: new Date(r.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" }),
                status: r.status,
                vehicle: v ? `${v.make || ""} ${v.model || ""}${v.plate_number ? ` (${v.plate_number})` : ""}`.trim() : "—",
                services: sc,
            };

            // Credit the car to each technician; near-duplicate spellings on the same
            // card collapse to one credit via the normalized key.
            const seen = new Set<string>();
            for (const entry of entries) {
                const name = entry.name;
                const key = name === UNSET ? UNSET : normalizeName(name);
                if (!key || seen.has(key)) continue;
                seen.add(key);
                let a = byKey.get(key);
                if (!a) {
                    a = { cars: 0, services: 0, completed: 0, orders: [], spellings: new Map(), ratings: new Map(), notes: [] };
                    byKey.set(key, a);
                }
                a.cars += 1;
                a.services += sc;
                if (r.status === "تم الانتهاء") a.completed += 1;
                a.orders.push(order);
                if (entry.rating) a.ratings.set(entry.rating, (a.ratings.get(entry.rating) || 0) + 1);
                if (entry.note) a.notes.push({ report_number: r.report_number, note: entry.note });
                if (name !== UNSET) a.spellings.set(name, (a.spellings.get(name) || 0) + 1);
            }
        }

        // Cluster near-duplicate normalized keys (typos / different letters) via union-find.
        const keys = [...byKey.keys()];
        const parent = new Map<string, string>();
        keys.forEach((k) => parent.set(k, k));
        const find = (x: string): string => {
            while (parent.get(x) !== x) {
                parent.set(x, parent.get(parent.get(x)!)!);
                x = parent.get(x)!;
            }
            return x;
        };
        const real = keys.filter((k) => k !== UNSET);
        for (let i = 0; i < real.length; i++) {
            for (let j = i + 1; j < real.length; j++) {
                if (namesAreClose(real[i], real[j])) parent.set(find(real[i]), find(real[j]));
            }
        }

        // Merge each cluster's tallies; display the most-used original spelling.
        const clusters = new Map<string, Acc>();
        for (const k of keys) {
            const root = k === UNSET ? UNSET : find(k);
            let c = clusters.get(root);
            if (!c) {
                c = { cars: 0, services: 0, completed: 0, orders: [], spellings: new Map(), ratings: new Map(), notes: [] };
                clusters.set(root, c);
            }
            const a = byKey.get(k)!;
            c.cars += a.cars;
            c.services += a.services;
            c.completed += a.completed;
            c.orders.push(...a.orders);
            c.notes.push(...a.notes);
            a.spellings.forEach((cnt, sp) => c!.spellings.set(sp, (c!.spellings.get(sp) || 0) + cnt));
            a.ratings.forEach((cnt, rt) => c!.ratings.set(rt, (c!.ratings.get(rt) || 0) + cnt));
        }

        const groups: TechGroup[] = [...clusters.entries()].map(([root, c]) => {
            let name = UNSET;
            if (root !== UNSET) {
                let best = "", bestN = -1;
                c.spellings.forEach((cnt, sp) => { if (cnt > bestN) { bestN = cnt; best = sp; } });
                name = best || root;
            }
            return { name, cars: c.cars, services: c.services, completed: c.completed, orders: c.orders, ratings: Object.fromEntries(c.ratings), notes: c.notes };
        }).sort((a, b) => b.cars - a.cars);

        return { groups, totalCars, totalServices };
    }, [rows]);

    const profile = selectedTech ? groups.find((g) => g.name === selectedTech) || null : null;
    const visibleGroups = useMemo(() => {
        const q = techSearch.trim().toLowerCase();
        return q ? groups.filter((g) => g.name.toLowerCase().includes(q)) : groups;
    }, [groups, techSearch]);

    const downloadRatingsExcel = () => {
        const realGroups = groups.filter((g) => g.name !== "غير محدد");
        if (realGroups.length === 0) return;
        const header = ["الفني", "عدد السيارات", "عدد الخدمات", "عدد التقييمات", ...RATING_LEVELS, "التقييم الغالب"];
        const aoa = [header, ...realGroups.map((g) => {
            const ratedCount = RATING_LEVELS.reduce((s, lvl) => s + (g.ratings[lvl] || 0), 0);
            let dom = "—", domN = 0;
            RATING_LEVELS.forEach((lvl) => { const n = g.ratings[lvl] || 0; if (n > domN) { domN = n; dom = lvl; } });
            return [g.name, g.cars, g.services, ratedCount, ...RATING_LEVELS.map((lvl) => g.ratings[lvl] || 0), ratedCount ? dom : "—"];
        })];
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws["!cols"] = [{ wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 8 }, { wch: 16 }];
        if (!ws["!opts"]) ws["!opts"] = {};
        (ws as any)["!opts"].RTL = true;
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "تقييمات الفنيين");
        XLSX.writeFile(wb, `technician_ratings_${month}.xlsx`);
    };

    if (authLoading) {
        return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="animate-spin text-rose-500 w-12 h-12" /></div>;
    }
    if (!isAuthorized) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center p-4 text-center font-ibm" dir="rtl">
                <div className="glass-card p-8 rounded-3xl border border-rose-500/20 max-w-md w-full">
                    <h2 className="text-2xl font-bold text-rose-500 mb-2">غير مصرح بالوصول</h2>
                    <p className="text-muted-foreground">ليس لديك صلاحية لعرض تقارير الفنيين.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen p-4 md:p-8 font-ibm" dir="rtl">
            <div className="max-w-6xl mx-auto space-y-6 animate-fade-in print:hidden">

                {/* Header */}
                <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-6 border-b border-border">
                    <div>
                        <h1 className="text-3xl font-display font-bold text-foreground mb-2 flex items-center gap-3">
                            <Wrench className="text-rose-500" size={30} />
                            تقرير أداء الفنيين الشهري
                        </h1>
                        <p className="text-muted-foreground">اختر فنياً لعرض بروفايله الكامل — كل أوامر العمل والخدمات اللي اشتغلهن خلال الشهر</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        {branches.length > 1 && canPickBranch && (
                            <select value={selectedBranchId} onChange={(e) => setSelectedBranchId(e.target.value)} className="bg-card border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-rose-500/50 cursor-pointer">
                                <option value="">كل الفروع</option>
                                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                        )}
                        <input type="month" value={month} onChange={(e) => setMonth(e.target.value || monthStr())} className="bg-card border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-rose-500/50" />
                        <button
                            onClick={downloadRatingsExcel}
                            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-xl transition-colors shadow-lg shadow-emerald-500/20"
                        >
                            <Download size={16} /> تصدير التقييمات (Excel)
                        </button>
                    </div>
                </div>

                {loading ? (
                    <div className="p-20 text-center"><Loader2 className="animate-spin text-rose-500 w-10 h-10 mx-auto" /></div>
                ) : profile ? (
                    /* ---------- PROFILE VIEW ---------- */
                    <div className="space-y-6">
                        <div className="flex items-center justify-between gap-4 flex-wrap">
                            <button onClick={() => setSelectedTech(null)} className="flex items-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 text-foreground rounded-xl border border-border transition-all text-sm font-bold">
                                <ChevronLeft size={16} /> رجوع لقائمة الفنيين
                            </button>
                            <button onClick={() => window.print()} className="flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl transition-all text-sm font-bold shadow-lg shadow-rose-500/20">
                                <Printer size={16} /> طباعة البروفايل
                            </button>
                        </div>

                        <div className="glass-card p-6 rounded-3xl border border-border flex flex-col sm:flex-row sm:items-center gap-5">
                            <div className="w-16 h-16 rounded-2xl bg-rose-500/10 text-rose-400 flex items-center justify-center shrink-0 text-2xl font-black">
                                {profile.name === "غير محدد" ? "؟" : profile.name.charAt(0)}
                            </div>
                            <div className="flex-1">
                                <h2 className="text-2xl font-bold text-foreground">{profile.name === "غير محدد" ? "غير محدد (كروت بدون اسم فني)" : profile.name}</h2>
                                <p className="text-muted-foreground text-sm">{branchName} • {monthLabel(month)}</p>
                            </div>
                            <div className="flex gap-6">
                                <div className="text-center"><p className="text-3xl font-black text-blue-400">{profile.cars.toLocaleString()}</p><p className="text-xs text-muted-foreground">سيارة</p></div>
                                <div className="text-center"><p className="text-3xl font-black text-emerald-400">{profile.services.toLocaleString()}</p><p className="text-xs text-muted-foreground">خدمة</p></div>
                                <div className="text-center"><p className="text-3xl font-black text-foreground">{profile.completed.toLocaleString()}</p><p className="text-xs text-muted-foreground">منجزة</p></div>
                            </div>
                        </div>

                        {/* Ratings breakdown for this technician */}
                        <div className="glass-card p-6 rounded-3xl border border-border">
                            <h3 className="text-sm font-bold text-muted-foreground mb-3">⭐ تقييمات الأداء</h3>
                            {RATING_LEVELS.reduce((s, lvl) => s + (profile.ratings[lvl] || 0), 0) === 0 ? (
                                <p className="text-sm text-muted-foreground">لا توجد تقييمات لهذا الفني بعد.</p>
                            ) : (
                                <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                                    {RATING_LEVELS.map((lvl) => (
                                        <div key={lvl} className="text-center bg-muted/40 rounded-xl p-3 border border-border">
                                            <p className="text-2xl font-black text-amber-400">{profile.ratings[lvl] || 0}</p>
                                            <p className="text-xs text-muted-foreground">{lvl}</p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Supervisor rating notes — shown in-app only (excluded from the printed report) */}
                        {profile.notes.length > 0 && (
                            <div className="glass-card p-6 rounded-3xl border border-border">
                                <h3 className="text-sm font-bold text-muted-foreground mb-3">📝 ملاحظات المشرف ({profile.notes.length})</h3>
                                <div className="space-y-2 max-h-72 overflow-y-auto scrollbar-thin">
                                    {profile.notes.map((n, i) => (
                                        <div key={i} className="flex items-start gap-3 bg-muted/40 rounded-xl p-3 border border-border">
                                            <span className="text-[11px] font-mono bg-card border border-border rounded-lg px-2 py-0.5 text-muted-foreground shrink-0">#{n.report_number}</span>
                                            <p className="text-sm text-foreground leading-relaxed">{n.note}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="glass-card rounded-3xl border border-border/50 overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-right border-collapse">
                                    <thead>
                                        <tr className="bg-muted/40 text-muted-foreground text-xs font-bold border-b border-border/50">
                                            <th className="p-4">رقم الكرت</th>
                                            <th className="p-4">التاريخ</th>
                                            <th className="p-4">المركبة</th>
                                            <th className="p-4">الحالة</th>
                                            <th className="p-4 text-center">عدد الخدمات</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/30 text-sm">
                                        {profile.orders.map((o) => (
                                            <tr key={o.id} className="hover:bg-muted/20 transition-colors">
                                                <td className="p-4 font-mono font-bold text-rose-400">#{o.report_number}</td>
                                                <td className="p-4 text-muted-foreground font-mono">{o.date}</td>
                                                <td className="p-4 font-bold text-foreground">{o.vehicle}</td>
                                                <td className="p-4">
                                                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${o.status === "تم الانتهاء" ? "bg-emerald-500/10 text-emerald-400" : o.status === "قيد العمل" ? "bg-amber-500/10 text-amber-400" : "bg-rose-500/10 text-rose-400"}`}>{o.status}</span>
                                                </td>
                                                <td className="p-4 text-center font-bold text-emerald-400">{o.services.toLocaleString()}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                ) : (
                    /* ---------- LIST VIEW ---------- */
                    <>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="glass-card p-5 rounded-2xl border border-border flex items-center gap-4">
                                <div className="w-12 h-12 rounded-xl bg-rose-500/10 text-rose-400 flex items-center justify-center shrink-0"><Users size={24} /></div>
                                <div><p className="text-2xl font-black text-foreground">{groups.filter((g) => g.name !== "غير محدد").length}</p><p className="text-sm text-muted-foreground">عدد الفنيين</p></div>
                            </div>
                            <div className="glass-card p-5 rounded-2xl border border-border flex items-center gap-4">
                                <div className="w-12 h-12 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center shrink-0"><Car size={24} /></div>
                                <div><p className="text-2xl font-black text-foreground">{totalCars.toLocaleString()}</p><p className="text-sm text-muted-foreground">إجمالي السيارات</p></div>
                            </div>
                            <div className="glass-card p-5 rounded-2xl border border-border flex items-center gap-4">
                                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0"><ClipboardCheck size={24} /></div>
                                <div><p className="text-2xl font-black text-foreground">{totalServices.toLocaleString()}</p><p className="text-sm text-muted-foreground">إجمالي الخدمات</p></div>
                            </div>
                        </div>

                        <div className="relative">
                            <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" size={18} />
                            <input type="text" value={techSearch} onChange={(e) => setTechSearch(e.target.value)} placeholder="بحث عن فني بالاسم..." className="input-field w-full" style={{ paddingRight: "3rem" }} />
                        </div>

                        {visibleGroups.length === 0 ? (
                            <div className="glass-card p-20 text-center text-muted-foreground space-y-4 rounded-3xl border border-border/50">
                                <Wrench size={48} className="mx-auto text-muted-foreground/50" />
                                <p>{groups.length === 0 ? "لا توجد أوامر عمل في هذا الشهر." : "لا يوجد فني مطابق للبحث."}</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {visibleGroups.map((g) => (
                                    <button key={g.name} onClick={() => setSelectedTech(g.name)} className="glass-card p-5 rounded-2xl border border-border hover:border-rose-500/40 transition-all text-right group">
                                        <div className="flex items-center gap-3 mb-4">
                                            <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 text-lg font-black ${g.name === "غير محدد" ? "bg-amber-500/10 text-amber-400" : "bg-rose-500/10 text-rose-400"}`}>
                                                {g.name === "غير محدد" ? "؟" : g.name.charAt(0)}
                                            </div>
                                            <div className="min-w-0">
                                                <h3 className="font-bold text-foreground truncate group-hover:text-rose-400 transition-colors">{g.name === "غير محدد" ? "غير محدد" : g.name}</h3>
                                                {g.name === "غير محدد" && <p className="text-[10px] text-amber-400">كروت بدون اسم فني</p>}
                                            </div>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground">السيارات: <span className="font-black text-blue-400">{g.cars.toLocaleString()}</span></span>
                                            <span className="text-muted-foreground">الخدمات: <span className="font-black text-emerald-400">{g.services.toLocaleString()}</span></span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* ---------- PRINT LAYOUT (only on print) ---------- */}
            {profile && (
                <div className="hidden print:block text-black bg-white p-8" dir="rtl" style={{ fontFamily: "'IBM Plex Sans Arabic', sans-serif" }}>
                    <div className="flex items-center justify-between border-b-2 border-black pb-4 mb-6">
                        <div>
                            <h1 className="text-2xl font-black">هندسة السيارات</h1>
                            <p className="text-sm">تقرير أداء فني — {branchName}</p>
                        </div>
                        <div className="text-left text-sm">
                            <p>الشهر: {monthLabel(month)}</p>
                            <p>تاريخ الطباعة: {new Date().toLocaleDateString("en-GB")}</p>
                        </div>
                    </div>

                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-xl font-black">الفني: {profile.name === "غير محدد" ? "غير محدد" : profile.name}</h2>
                        <div className="flex gap-8 text-sm font-bold">
                            <span>السيارات: {profile.cars}</span>
                            <span>الخدمات: {profile.services}</span>
                            <span>المنجزة: {profile.completed}</span>
                        </div>
                    </div>

                    {/* Ratings breakdown (notes are intentionally excluded from the report) */}
                    {RATING_LEVELS.reduce((s, lvl) => s + (profile.ratings[lvl] || 0), 0) > 0 && (
                        <div className="mb-6 border border-gray-400 rounded p-3">
                            <h3 className="font-black mb-2">تقييمات الأداء:</h3>
                            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm font-bold">
                                {RATING_LEVELS.map((lvl) => (
                                    <span key={lvl}>{lvl}: {profile.ratings[lvl] || 0}</span>
                                ))}
                            </div>
                        </div>
                    )}

                    <table className="w-full text-right border-collapse text-sm">
                        <thead>
                            <tr className="border-b-2 border-black">
                                <th className="p-2 border border-gray-400">رقم الكرت</th>
                                <th className="p-2 border border-gray-400">التاريخ</th>
                                <th className="p-2 border border-gray-400">المركبة</th>
                                <th className="p-2 border border-gray-400">الحالة</th>
                                <th className="p-2 border border-gray-400">عدد الخدمات</th>
                            </tr>
                        </thead>
                        <tbody>
                            {profile.orders.map((o) => (
                                <tr key={o.id}>
                                    <td className="p-2 border border-gray-400 font-mono">#{o.report_number}</td>
                                    <td className="p-2 border border-gray-400">{o.date}</td>
                                    <td className="p-2 border border-gray-400">{o.vehicle}</td>
                                    <td className="p-2 border border-gray-400">{o.status}</td>
                                    <td className="p-2 border border-gray-400 text-center">{o.services}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
