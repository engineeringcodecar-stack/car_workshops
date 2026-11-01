"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthProvider";
import { Wrench, Loader2, Car, ClipboardCheck, Users, Printer, ChevronLeft, Search, Download, Wallet } from "lucide-react";
import * as XLSX from 'xlsx';

// Supervisor rating levels, worst -> best (used for the ratings breakdown/export).
const RATING_LEVELS = ['رديء', 'متوسط', 'جيد', 'جيد جداً', 'ممتاز'];

// Service key → Arabic label (same set the audit page prints on the invoice).
const SERVICE_LABELS: Record<string, string> = {
    engineOil: 'زيت المحرك', oilFilter: 'فلتر زيت المحرك', airFilter: 'فلتر الهواء',
    acFilter: 'فلتر التبريد', brakeFluid: 'زيت المكابح', coolant: 'ماء الراديتر',
    battery: 'البطارية', engineBelts: 'قايش المحرك',
    brakePads: 'دسكات السيارة', sparkPlugs: 'شمعات الاحتراق',
    gearboxOil: 'زيت كير', gearboxHydraulic: 'هايدروليك الكير', gearboxFilter: 'فلتر الكير',
    wipers: 'مساحات زجاج', windshieldFluid: 'سائل غسيل جام',
    battery2: 'البطارية فحص دوري', batteryFilter: 'فلتر البطارية',
    engineFlash: 'فلاش المحرك', engineCeramic: 'سيراميك محرك',
    linerCleaner: 'منظف بطانة (جكجكة)', oilLeakPreventer: 'مانع تسريب زيت',
    smokePreventer: 'مانع دخان', gearboxFlash: 'فلاش كير',
    gearboxCeramic: 'سيراميك كير', gearboxAntiSlip: 'مانع انزلاق كير',
    acCleaner: 'منظف دورة تبريد', injectorCleaner: 'منظف بخاخات',
    fuelSystemCleaner: 'منظف نظام وقود', octaneBooster: 'محسن أوكتان',
    additives: 'معالجات ومحسنات', cleaners: 'منظفات وأساسيات',
    transOil: 'زيت ناقل الحركة', differentialOil: 'زيت الدبل / البكك',
    maintenanceUnits: 'وحدات الصيانة'
};

const UNSET = "غير محدد";

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

type ServiceLine = { label: string; price: number };

type OrderItem = {
    id: string;
    report_number: number;
    date: string;
    status: string;
    vehicle: string;
    lines: ServiceLine[];
    value: number;      // the car's full service value
    techCount: number;  // technicians sharing the car (value is split between them)
};

type ServiceTally = { label: string; count: number; value: number };

type TechGroup = {
    name: string;
    cars: number;
    services: number;
    completed: number;
    value: number; // this technician's share
    orders: OrderItem[];
    byService: ServiceTally[];
    ratings: Record<string, number>;
    // Supervisor rating notes, shown in-app only (excluded from the printed report).
    notes: { report_number: number; note: string }[];
};

const num = (v: unknown) => parseFloat(String(v ?? "").replace(/[^\d.]/g, "")) || 0;
const money = (v: number) => Math.round(v).toLocaleString("en-US");

function dateStr(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateLabel(ymd: string) {
    const [y, m, d] = ymd.split("-");
    return `${d}/${m}/${y}`;
}

// The work a technician did on a car, with prices: services marked for change (or priced),
// reception's custom services, and the services the floor appended (selected_services[1..]).
function serviceLines(selected: unknown): ServiceLine[] {
    const arr: any[] = Array.isArray(selected) ? selected : selected ? [selected] : [];
    const payload = arr[0] || {};
    const lines: ServiceLine[] = [];
    Object.entries((payload.services || {}) as Record<string, any>).forEach(([k, v]) => {
        if (!v || v.status === "جيد" || v.status === "سليم") return;
        const price = num(v.price);
        if (v.status === "يحتاج تغيير" || price > 0) lines.push({ label: SERVICE_LABELS[k] || k, price });
    });
    (Array.isArray(payload.customServices) ? payload.customServices : []).forEach((c: any) => {
        const label = (c?.label || c?.name || "").trim();
        if (label) lines.push({ label, price: num(c.price) });
    });
    arr.slice(1).forEach((e: any) => {
        if (!e || e.is_paper_v2_format) return;
        const label = (e.name || "").trim();
        if (label) lines.push({ label, price: num(e.price) });
    });
    return lines;
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
        .replace(/[ً-ٰٟ]/g, "") // diacritics
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

    const today = new Date();
    const [dateFrom, setDateFrom] = useState<string>(dateStr(new Date(today.getFullYear(), today.getMonth(), 1)));
    const [dateTo, setDateTo] = useState<string>(dateStr(today));
    const [rows, setRows] = useState<ReportRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTech, setSelectedTech] = useState<string | null>(null);
    const [techSearch, setTechSearch] = useState("");
    const [printMode, setPrintMode] = useState<"summary" | "detail" | null>(null);

    const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
    // "" = كل الفروع. Follows the sidebar: on "all branches" it used to force the first branch.
    const [selectedBranchId, setSelectedBranchId] = useState<string>("");
    const [branchesReady, setBranchesReady] = useState(false);
    const canPickBranch = employeeRole === "Owner" || employeeRole === "Admin" || !employeeBranchId;
    const branchName = selectedBranchId ? (branches.find((b) => b.id === selectedBranchId)?.name || "") : (branches.length === 1 ? branches[0].name : "كل الفروع");
    const rangeValid = !!dateFrom && !!dateTo && dateFrom <= dateTo;
    const periodLabel = rangeValid ? `من ${dateLabel(dateFrom)} إلى ${dateLabel(dateTo)}` : "";

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
        if (!branchesReady || !rangeValid) return;
        setSelectedTech(null);

        const fetchRows = async () => {
            setLoading(true);
            const [fy, fm, fd] = dateFrom.split("-").map(Number);
            const [ty, tm, td] = dateTo.split("-").map(Number);
            const start = new Date(fy, fm - 1, fd);
            const end = new Date(ty, tm - 1, td + 1); // the whole "to" day

            // Page through the range in 1000-row chunks — Supabase silently caps a single
            // query at 1000 rows, which truncated busy periods and skewed the totals.
            const PAGE_SIZE = 1000;
            const MAX_ROWS = 100000;
            const all: ReportRow[] = [];
            for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
                let query = supabase
                    .from("inspection_reports")
                    .select("id, report_number, status, created_at, technician_rating, technician_rating_notes, selected_services, vehicles (make, model, plate_number)")
                    .neq("order_type", "sale")
                    .gte("created_at", start.toISOString())
                    .lt("created_at", end.toISOString())
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
    }, [dateFrom, dateTo, rangeValid, selectedBranchId, employeeBranchId, authLoading, isAuthorized, branchesReady, canPickBranch]);

    const { groups, totalCars, totalServices, totalValue } = useMemo(() => {
        type Acc = {
            cars: number; services: number; completed: number; value: number; orders: OrderItem[];
            byService: Map<string, ServiceTally>; spellings: Map<string, number>; ratings: Map<string, number>;
            notes: { report_number: number; note: string }[];
        };
        const newAcc = (): Acc => ({ cars: 0, services: 0, completed: 0, value: 0, orders: [], byService: new Map(), spellings: new Map(), ratings: new Map(), notes: [] });
        const byKey = new Map<string, Acc>(); // keyed by normalized name
        let totalCars = 0;
        let totalServices = 0;
        let totalValue = 0;

        for (const r of rows) {
            if (r.status === "ملغى") continue;
            const payload = Array.isArray(r.selected_services) ? r.selected_services[0] : r.selected_services;
            // An invoice removed from صفحة التدقيق is junk — no technician gets credit for it.
            if (payload?.pricing?.auditExcluded === true) continue;
            const v = Array.isArray(r.vehicles) ? r.vehicles[0] : r.vehicles;
            const lines = serviceLines(r.selected_services);
            const carValue = lines.reduce((s, l) => s + l.price, 0);
            // Totals are per actual car (a shared car is still one car / its services counted once).
            totalCars += 1;
            totalServices += lines.length;
            totalValue += carValue;

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

            // Near-duplicate spellings on the same card collapse to one credit.
            const uniq = new Map<string, typeof entries[number]>();
            for (const entry of entries) {
                const key = entry.name === UNSET ? UNSET : normalizeName(entry.name);
                if (key && !uniq.has(key)) uniq.set(key, entry);
            }
            // A shared car's value is split equally, so the technicians' values add up to the total.
            const share = 1 / Math.max(1, uniq.size);
            const order: OrderItem = {
                id: r.id,
                report_number: r.report_number,
                date: new Date(r.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }),
                status: r.status,
                vehicle: v ? `${v.make || ""} ${v.model || ""}${v.plate_number ? ` (${v.plate_number})` : ""}`.trim() : "—",
                lines,
                value: carValue,
                techCount: uniq.size,
            };

            uniq.forEach((entry, key) => {
                let a = byKey.get(key);
                if (!a) { a = newAcc(); byKey.set(key, a); }
                a.cars += 1;
                a.services += lines.length;
                a.value += carValue * share;
                if (r.status === "تم الانتهاء") a.completed += 1;
                a.orders.push(order);
                for (const l of lines) {
                    const t = a.byService.get(l.label) || { label: l.label, count: 0, value: 0 };
                    t.count += 1;
                    t.value += l.price * share;
                    a.byService.set(l.label, t);
                }
                if (entry.rating) a.ratings.set(entry.rating, (a.ratings.get(entry.rating) || 0) + 1);
                if (entry.note) a.notes.push({ report_number: r.report_number, note: entry.note });
                if (entry.name !== UNSET) a.spellings.set(entry.name, (a.spellings.get(entry.name) || 0) + 1);
            });
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
            if (!c) { c = newAcc(); clusters.set(root, c); }
            const a = byKey.get(k)!;
            c.cars += a.cars;
            c.services += a.services;
            c.completed += a.completed;
            c.value += a.value;
            c.orders.push(...a.orders);
            c.notes.push(...a.notes);
            a.byService.forEach((t, label) => {
                const ct = c!.byService.get(label) || { label, count: 0, value: 0 };
                ct.count += t.count;
                ct.value += t.value;
                c!.byService.set(label, ct);
            });
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
            return {
                name, cars: c.cars, services: c.services, completed: c.completed, value: c.value,
                orders: c.orders.sort((a, b) => b.report_number - a.report_number),
                byService: [...c.byService.values()].sort((a, b) => b.value - a.value || b.count - a.count),
                ratings: Object.fromEntries(c.ratings), notes: c.notes,
            };
        }).sort((a, b) => b.value - a.value || b.cars - a.cars);

        return { groups, totalCars, totalServices, totalValue };
    }, [rows]);

    const profile = selectedTech ? groups.find((g) => g.name === selectedTech) || null : null;
    const visibleGroups = useMemo(() => {
        const q = techSearch.trim().toLowerCase();
        return q ? groups.filter((g) => g.name.toLowerCase().includes(q)) : groups;
    }, [groups, techSearch]);
    const printGroups = profile ? [profile] : visibleGroups;

    // Render the chosen print layout first, then open the print dialog.
    useEffect(() => {
        if (!printMode) return;
        const t = setTimeout(() => window.print(), 50);
        const done = () => setPrintMode(null);
        window.addEventListener("afterprint", done, { once: true });
        return () => { clearTimeout(t); window.removeEventListener("afterprint", done); };
    }, [printMode]);

    const downloadExcel = () => {
        if (groups.length === 0) return;
        const sheet = (aoa: (string | number)[][], cols: number[]) => {
            const ws = XLSX.utils.aoa_to_sheet(aoa);
            ws["!cols"] = cols.map((wch) => ({ wch }));
            if (!ws["!opts"]) ws["!opts"] = {};
            (ws as any)["!opts"].RTL = true;
            return ws;
        };
        const wb = XLSX.utils.book_new();

        const summary: (string | number)[][] = [
            ["تقرير الفنيين", branchName, periodLabel],
            [],
            ["الفني", "عدد السيارات", "عدد الخدمات", "المنجزة", "القيمة (د.ع)"],
            ...groups.map((g) => [g.name, g.cars, g.services, g.completed, Math.round(g.value)]),
            ["المجموع", totalCars, totalServices, "", Math.round(totalValue)],
        ];
        XLSX.utils.book_append_sheet(wb, sheet(summary, [22, 12, 12, 10, 16]), "ملخص");

        const byService: (string | number)[][] = [["الفني", "الخدمة", "العدد", "القيمة (د.ع)"]];
        groups.forEach((g) => g.byService.forEach((t) => byService.push([g.name, t.label, t.count, Math.round(t.value)])));
        XLSX.utils.book_append_sheet(wb, sheet(byService, [22, 28, 8, 16]), "حسب الخدمة");

        const detail: (string | number)[][] = [["الفني", "رقم الكرت", "التاريخ", "المركبة", "الحالة", "الخدمة", "السعر (د.ع)", "عدد الفنيين", "حصة الفني (د.ع)"]];
        groups.forEach((g) => g.orders.forEach((o) => {
            const lines = o.lines.length ? o.lines : [{ label: "—", price: 0 }];
            lines.forEach((l) => detail.push([g.name, o.report_number, o.date, o.vehicle, o.status, l.label, l.price, o.techCount, Math.round(l.price / Math.max(1, o.techCount))]));
        }));
        XLSX.utils.book_append_sheet(wb, sheet(detail, [22, 10, 12, 26, 12, 28, 12, 10, 14]), "تفصيلي");

        const real = groups.filter((g) => g.name !== UNSET);
        const ratings: (string | number)[][] = [["الفني", "عدد السيارات", "عدد التقييمات", ...RATING_LEVELS, "التقييم الغالب"]];
        real.forEach((g) => {
            const ratedCount = RATING_LEVELS.reduce((s, lvl) => s + (g.ratings[lvl] || 0), 0);
            let dom = "—", domN = 0;
            RATING_LEVELS.forEach((lvl) => { const n = g.ratings[lvl] || 0; if (n > domN) { domN = n; dom = lvl; } });
            ratings.push([g.name, g.cars, ratedCount, ...RATING_LEVELS.map((lvl) => g.ratings[lvl] || 0), ratedCount ? dom : "—"]);
        });
        XLSX.utils.book_append_sheet(wb, sheet(ratings, [22, 12, 12, 8, 8, 8, 10, 8, 16]), "التقييمات");

        XLSX.writeFile(wb, `technicians_${dateFrom}_${dateTo}.xlsx`);
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

    const shareNote = (o: OrderItem) => o.techCount > 1 ? `مشتركة بين ${o.techCount} فنيين` : "";

    return (
        <div className="min-h-screen p-4 md:p-8 font-ibm" dir="rtl">
            <div className="max-w-6xl mx-auto space-y-6 animate-fade-in print:hidden">

                {/* Header */}
                <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-6 border-b border-border">
                    <div>
                        <h1 className="text-3xl font-display font-bold text-foreground mb-2 flex items-center gap-3">
                            <Wrench className="text-rose-500" size={30} />
                            تقرير أداء الفنيين
                        </h1>
                        <p className="text-muted-foreground">كل فني والخدمات اللي اشتغلها وقيمتها خلال الفترة. القيمة حسب أسعار الخدمات قبل الخصم، والسيارة المشتركة تنقسم قيمتها بالتساوي.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        {branches.length > 1 && canPickBranch && (
                            <select value={selectedBranchId} onChange={(e) => setSelectedBranchId(e.target.value)} className="bg-card border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-rose-500/50 cursor-pointer">
                                <option value="">كل الفروع</option>
                                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                        )}
                        <label className="flex items-center gap-2 text-sm text-muted-foreground">
                            من
                            <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} className="bg-card border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-rose-500/50" />
                        </label>
                        <label className="flex items-center gap-2 text-sm text-muted-foreground">
                            إلى
                            <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} className="bg-card border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-rose-500/50" />
                        </label>
                        <button
                            onClick={downloadExcel}
                            disabled={loading || groups.length === 0}
                            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-colors shadow-lg shadow-emerald-500/20"
                        >
                            <Download size={16} /> تصدير Excel
                        </button>
                    </div>
                </div>

                {!rangeValid ? (
                    <div className="glass-card p-10 text-center text-rose-400 rounded-3xl border border-rose-500/20">اختر فترة صحيحة: تاريخ «من» لازم يكون قبل أو يساوي تاريخ «إلى».</div>
                ) : loading ? (
                    <div className="p-20 text-center"><Loader2 className="animate-spin text-rose-500 w-10 h-10 mx-auto" /></div>
                ) : profile ? (
                    /* ---------- DETAIL (one technician) ---------- */
                    <div className="space-y-6">
                        <div className="flex items-center justify-between gap-4 flex-wrap">
                            <button onClick={() => setSelectedTech(null)} className="flex items-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 text-foreground rounded-xl border border-border transition-all text-sm font-bold">
                                <ChevronLeft size={16} /> رجوع للملخص
                            </button>
                            <button onClick={() => setPrintMode("detail")} className="flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl transition-all text-sm font-bold shadow-lg shadow-rose-500/20">
                                <Printer size={16} /> طباعة التفصيلي
                            </button>
                        </div>

                        <div className="glass-card p-6 rounded-3xl border border-border flex flex-col sm:flex-row sm:items-center gap-5">
                            <div className="w-16 h-16 rounded-2xl bg-rose-500/10 text-rose-400 flex items-center justify-center shrink-0 text-2xl font-black">
                                {profile.name === UNSET ? "؟" : profile.name.charAt(0)}
                            </div>
                            <div className="flex-1">
                                <h2 className="text-2xl font-bold text-foreground">{profile.name === UNSET ? "غير محدد (كروت بدون اسم فني)" : profile.name}</h2>
                                <p className="text-muted-foreground text-sm">{branchName} • {periodLabel}</p>
                            </div>
                            <div className="flex flex-wrap gap-6">
                                <div className="text-center"><p className="text-3xl font-black text-blue-400">{profile.cars.toLocaleString()}</p><p className="text-xs text-muted-foreground">سيارة</p></div>
                                <div className="text-center"><p className="text-3xl font-black text-emerald-400">{profile.services.toLocaleString()}</p><p className="text-xs text-muted-foreground">خدمة</p></div>
                                <div className="text-center"><p className="text-3xl font-black text-foreground">{profile.completed.toLocaleString()}</p><p className="text-xs text-muted-foreground">منجزة</p></div>
                                <div className="text-center"><p className="text-3xl font-black text-amber-400" dir="ltr">{money(profile.value)}</p><p className="text-xs text-muted-foreground">القيمة (د.ع)</p></div>
                            </div>
                        </div>

                        {/* Services by type */}
                        <div className="glass-card rounded-3xl border border-border/50 overflow-hidden">
                            <h3 className="text-sm font-bold text-muted-foreground p-4 pb-0">🔧 الخدمات حسب النوع</h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-right border-collapse">
                                    <thead>
                                        <tr className="bg-muted/40 text-muted-foreground text-xs font-bold border-b border-border/50">
                                            <th className="p-4">الخدمة</th>
                                            <th className="p-4 text-center">العدد</th>
                                            <th className="p-4 text-left">القيمة (د.ع)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/30 text-sm">
                                        {profile.byService.map((t) => (
                                            <tr key={t.label} className="hover:bg-muted/20 transition-colors">
                                                <td className="p-4 font-bold text-foreground">{t.label}</td>
                                                <td className="p-4 text-center text-emerald-400 font-bold">{t.count.toLocaleString()}</td>
                                                <td className="p-4 text-left font-mono font-bold text-amber-400" dir="ltr">{money(t.value)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
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

                        {/* Every car with its services and prices */}
                        <div className="glass-card rounded-3xl border border-border/50 overflow-hidden">
                            <h3 className="text-sm font-bold text-muted-foreground p-4 pb-0">🚗 السيارات والخدمات</h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-right border-collapse">
                                    <thead>
                                        <tr className="bg-muted/40 text-muted-foreground text-xs font-bold border-b border-border/50">
                                            <th className="p-4">رقم الكرت</th>
                                            <th className="p-4">التاريخ</th>
                                            <th className="p-4">المركبة</th>
                                            <th className="p-4">الخدمات</th>
                                            <th className="p-4">الحالة</th>
                                            <th className="p-4 text-left">القيمة (د.ع)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/30 text-sm">
                                        {profile.orders.map((o) => (
                                            <tr key={o.id} className="hover:bg-muted/20 transition-colors align-top">
                                                <td className="p-4 font-mono font-bold text-rose-400">#{o.report_number}</td>
                                                <td className="p-4 text-muted-foreground font-mono whitespace-nowrap">{o.date}</td>
                                                <td className="p-4 font-bold text-foreground">{o.vehicle}</td>
                                                <td className="p-4">
                                                    {o.lines.length === 0 ? <span className="text-muted-foreground">—</span> : (
                                                        <ul className="space-y-1">
                                                            {o.lines.map((l, i) => (
                                                                <li key={i} className="flex justify-between gap-4">
                                                                    <span className="text-foreground">{l.label}</span>
                                                                    <span className="font-mono text-muted-foreground" dir="ltr">{money(l.price)}</span>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                </td>
                                                <td className="p-4">
                                                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap ${o.status === "تم الانتهاء" ? "bg-emerald-500/10 text-emerald-400" : o.status === "قيد العمل" ? "bg-amber-500/10 text-amber-400" : "bg-rose-500/10 text-rose-400"}`}>{o.status}</span>
                                                </td>
                                                <td className="p-4 text-left">
                                                    <p className="font-mono font-bold text-amber-400" dir="ltr">{money(o.value / Math.max(1, o.techCount))}</p>
                                                    {o.techCount > 1 && <p className="text-[11px] text-muted-foreground">{shareNote(o)} (من {money(o.value)})</p>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                ) : (
                    /* ---------- SUMMARY (all technicians) ---------- */
                    <>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            <div className="glass-card p-5 rounded-2xl border border-border flex items-center gap-4">
                                <div className="w-12 h-12 rounded-xl bg-rose-500/10 text-rose-400 flex items-center justify-center shrink-0"><Users size={24} /></div>
                                <div><p className="text-2xl font-black text-foreground">{groups.filter((g) => g.name !== UNSET).length}</p><p className="text-sm text-muted-foreground">عدد الفنيين</p></div>
                            </div>
                            <div className="glass-card p-5 rounded-2xl border border-border flex items-center gap-4">
                                <div className="w-12 h-12 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center shrink-0"><Car size={24} /></div>
                                <div><p className="text-2xl font-black text-foreground">{totalCars.toLocaleString()}</p><p className="text-sm text-muted-foreground">إجمالي السيارات</p></div>
                            </div>
                            <div className="glass-card p-5 rounded-2xl border border-border flex items-center gap-4">
                                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0"><ClipboardCheck size={24} /></div>
                                <div><p className="text-2xl font-black text-foreground">{totalServices.toLocaleString()}</p><p className="text-sm text-muted-foreground">إجمالي الخدمات</p></div>
                            </div>
                            <div className="glass-card p-5 rounded-2xl border border-border flex items-center gap-4">
                                <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0"><Wallet size={24} /></div>
                                <div><p className="text-2xl font-black text-foreground" dir="ltr">{money(totalValue)}</p><p className="text-sm text-muted-foreground">إجمالي القيمة (د.ع)</p></div>
                            </div>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-3">
                            <div className="relative flex-1">
                                <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" size={18} />
                                <input type="text" value={techSearch} onChange={(e) => setTechSearch(e.target.value)} placeholder="بحث عن فني بالاسم..." className="input-field w-full" style={{ paddingRight: "3rem" }} />
                            </div>
                            <button onClick={() => setPrintMode("summary")} disabled={visibleGroups.length === 0} className="flex items-center justify-center gap-2 px-4 py-2.5 bg-muted hover:bg-muted/80 disabled:opacity-50 text-foreground rounded-xl border border-border text-sm font-bold">
                                <Printer size={16} /> طباعة الملخص
                            </button>
                            <button onClick={() => setPrintMode("detail")} disabled={visibleGroups.length === 0} className="flex items-center justify-center gap-2 px-4 py-2.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-xl text-sm font-bold shadow-lg shadow-rose-500/20">
                                <Printer size={16} /> طباعة التفصيلي
                            </button>
                        </div>

                        {visibleGroups.length === 0 ? (
                            <div className="glass-card p-20 text-center text-muted-foreground space-y-4 rounded-3xl border border-border/50">
                                <Wrench size={48} className="mx-auto text-muted-foreground/50" />
                                <p>{groups.length === 0 ? "لا توجد أوامر عمل في هذه الفترة." : "لا يوجد فني مطابق للبحث."}</p>
                            </div>
                        ) : (
                            <div className="glass-card rounded-3xl border border-border/50 overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-right border-collapse">
                                        <thead>
                                            <tr className="bg-muted/40 text-muted-foreground text-xs font-bold border-b border-border/50">
                                                <th className="p-4">الفني</th>
                                                <th className="p-4 text-center">السيارات</th>
                                                <th className="p-4 text-center">الخدمات</th>
                                                <th className="p-4 text-center">المنجزة</th>
                                                <th className="p-4 text-left">القيمة (د.ع)</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/30 text-sm">
                                            {visibleGroups.map((g) => (
                                                <tr key={g.name} onClick={() => setSelectedTech(g.name)} className="hover:bg-muted/30 transition-colors cursor-pointer group" title="عرض التفصيلي">
                                                    <td className="p-4">
                                                        <span className="font-bold text-foreground group-hover:text-rose-400 transition-colors">{g.name}</span>
                                                        {g.name === UNSET && <span className="text-[10px] text-amber-400 mr-2">كروت بدون اسم فني</span>}
                                                    </td>
                                                    <td className="p-4 text-center font-bold text-blue-400">{g.cars.toLocaleString()}</td>
                                                    <td className="p-4 text-center font-bold text-emerald-400">{g.services.toLocaleString()}</td>
                                                    <td className="p-4 text-center text-foreground">{g.completed.toLocaleString()}</td>
                                                    <td className="p-4 text-left font-mono font-black text-amber-400" dir="ltr">{money(g.value)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* ---------- PRINT LAYOUT (only on print) ---------- */}
            {printMode && (
                <div className="hidden print:block text-black bg-white p-8" dir="rtl" style={{ fontFamily: "'IBM Plex Sans Arabic', sans-serif" }}>
                    <div className="flex items-center justify-between border-b-2 border-black pb-4 mb-6">
                        <div>
                            <h1 className="text-2xl font-black">هندسة السيارات</h1>
                            <p className="text-sm">تقرير الفنيين ({printMode === "summary" ? "ملخص" : "تفصيلي"}) — {branchName}</p>
                        </div>
                        <div className="text-left text-sm">
                            <p>{periodLabel}</p>
                            <p>تاريخ الطباعة: {new Date().toLocaleDateString("en-GB")}</p>
                        </div>
                    </div>

                    {printMode === "summary" ? (
                        <table className="w-full text-right border-collapse text-sm">
                            <thead>
                                <tr className="border-b-2 border-black">
                                    <th className="p-2 border border-gray-400">الفني</th>
                                    <th className="p-2 border border-gray-400">السيارات</th>
                                    <th className="p-2 border border-gray-400">الخدمات</th>
                                    <th className="p-2 border border-gray-400">المنجزة</th>
                                    <th className="p-2 border border-gray-400">القيمة (د.ع)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {printGroups.map((g) => (
                                    <tr key={g.name}>
                                        <td className="p-2 border border-gray-400 font-bold">{g.name}</td>
                                        <td className="p-2 border border-gray-400 text-center">{g.cars}</td>
                                        <td className="p-2 border border-gray-400 text-center">{g.services}</td>
                                        <td className="p-2 border border-gray-400 text-center">{g.completed}</td>
                                        <td className="p-2 border border-gray-400 font-mono" dir="ltr">{money(g.value)}</td>
                                    </tr>
                                ))}
                                <tr className="font-black border-t-2 border-black">
                                    <td className="p-2 border border-gray-400">المجموع</td>
                                    <td className="p-2 border border-gray-400 text-center">{printGroups.reduce((s, g) => s + g.cars, 0)}</td>
                                    <td className="p-2 border border-gray-400 text-center">{printGroups.reduce((s, g) => s + g.services, 0)}</td>
                                    <td className="p-2 border border-gray-400 text-center">{printGroups.reduce((s, g) => s + g.completed, 0)}</td>
                                    <td className="p-2 border border-gray-400 font-mono" dir="ltr">{money(printGroups.reduce((s, g) => s + g.value, 0))}</td>
                                </tr>
                            </tbody>
                        </table>
                    ) : (
                        printGroups.map((g, gi) => (
                            <div key={g.name} className={gi > 0 ? "mt-8 pt-6 border-t-2 border-black" : ""} style={gi > 0 ? { breakBefore: "page" } : undefined}>
                                <div className="flex items-center justify-between mb-4">
                                    <h2 className="text-xl font-black">الفني: {g.name}</h2>
                                    <div className="flex gap-6 text-sm font-bold">
                                        <span>السيارات: {g.cars}</span>
                                        <span>الخدمات: {g.services}</span>
                                        <span>المنجزة: {g.completed}</span>
                                        <span>القيمة: {money(g.value)} د.ع</span>
                                    </div>
                                </div>

                                {/* Ratings breakdown (notes are intentionally excluded from the report) */}
                                {RATING_LEVELS.reduce((s, lvl) => s + (g.ratings[lvl] || 0), 0) > 0 && (
                                    <div className="mb-4 border border-gray-400 rounded p-3">
                                        <h3 className="font-black mb-2">تقييمات الأداء:</h3>
                                        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm font-bold">
                                            {RATING_LEVELS.map((lvl) => <span key={lvl}>{lvl}: {g.ratings[lvl] || 0}</span>)}
                                        </div>
                                    </div>
                                )}

                                <h3 className="font-black mb-2">الخدمات حسب النوع</h3>
                                <table className="w-full text-right border-collapse text-sm mb-4">
                                    <thead>
                                        <tr className="border-b-2 border-black">
                                            <th className="p-2 border border-gray-400">الخدمة</th>
                                            <th className="p-2 border border-gray-400">العدد</th>
                                            <th className="p-2 border border-gray-400">القيمة (د.ع)</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {g.byService.map((t) => (
                                            <tr key={t.label}>
                                                <td className="p-2 border border-gray-400">{t.label}</td>
                                                <td className="p-2 border border-gray-400 text-center">{t.count}</td>
                                                <td className="p-2 border border-gray-400 font-mono" dir="ltr">{money(t.value)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>

                                <h3 className="font-black mb-2">السيارات</h3>
                                <table className="w-full text-right border-collapse text-sm">
                                    <thead>
                                        <tr className="border-b-2 border-black">
                                            <th className="p-2 border border-gray-400">رقم الكرت</th>
                                            <th className="p-2 border border-gray-400">التاريخ</th>
                                            <th className="p-2 border border-gray-400">المركبة</th>
                                            <th className="p-2 border border-gray-400">الخدمات</th>
                                            <th className="p-2 border border-gray-400">القيمة (د.ع)</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {g.orders.map((o) => (
                                            <tr key={o.id} style={{ breakInside: "avoid" }}>
                                                <td className="p-2 border border-gray-400 font-mono">#{o.report_number}</td>
                                                <td className="p-2 border border-gray-400 whitespace-nowrap">{o.date}</td>
                                                <td className="p-2 border border-gray-400">{o.vehicle}</td>
                                                <td className="p-2 border border-gray-400">
                                                    {o.lines.length === 0 ? "—" : o.lines.map((l, i) => <div key={i}>{l.label} — {money(l.price)}</div>)}
                                                </td>
                                                <td className="p-2 border border-gray-400 font-mono">
                                                    <span dir="ltr">{money(o.value / Math.max(1, o.techCount))}</span>
                                                    {o.techCount > 1 && <div className="text-[10px] font-sans">{shareNote(o)}</div>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
