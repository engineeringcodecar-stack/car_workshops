"use client";

// ملف السيارة — one contract car's file, like a customer's file in سجل العملاء:
// every visit it made under the contract, what was done, what it cost, and the
// comprehensive inspection result inside the visit it was done in (inspections are
// filled in from the work order on the floor, not from here).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
    Car, X, Loader2, Printer, ExternalLink, Edit2, Trash2, FileText, Plus, Gauge, Wrench, Landmark,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { invoiceMoney, type Contract } from "@/lib/contracts";
import { SERVICE_LABELS, FREE_SERVICE_LABELS } from "@/lib/serviceLabels";
import { INSPECTION_SECTIONS, type ComprehensiveInspection } from "@/lib/comprehensiveInspection";
import { showConfirm, showError, showSuccess } from "@/lib/alerts";

type Svc = { status?: string; price?: string | number; details?: Record<string, unknown> };
type Payload = {
    services?: Record<string, Svc>;
    customServices?: { label?: string; name?: string; qty?: string | number; price?: string | number; notes?: string }[];
    freeServices?: Record<string, boolean>;
    technicianName?: string;
    shiftSupervisor?: string;
    futureOdometer?: string;
    isComprehensiveInspection?: boolean;
    comprehensiveInspection?: ComprehensiveInspection;
    pricing?: Record<string, unknown>;
    products?: { name?: string; qty?: number; price?: number }[];
};
type Extra = { name?: string; price?: string | number; addedDuringWork?: boolean };
type Joined<T> = T | T[] | null;

type Visit = {
    id: string;
    report_number: number;
    status: string;
    order_type: string | null;
    created_at: string;
    total_price: number | null;
    odometer_reading: number | null;
    odometer_unit: string | null;
    selected_services: unknown;
    branches: Joined<{ name: string }>;
    vehicles: Joined<{ make: string | null; model: string | null; plate_number: string | null; engine_size: string | null; clients: Joined<{ name: string | null; phone: string | null }> }>;
};

const one = <T,>(v: Joined<T> | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const num = (v: unknown) => parseFloat(String(v ?? "").replace(/[^\d.]/g, "")) || 0;
const money = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtDate = (iso: string) => {
    const d = new Date(new Date(iso).getTime() + 3 * 3600 * 1000);
    return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
};
const payloadOf = (v: Visit): Payload => {
    const s = v.selected_services;
    return ((Array.isArray(s) ? s[0] : s) || {}) as Payload;
};
const extrasOf = (v: Visit): Extra[] => (Array.isArray(v.selected_services) ? (v.selected_services.slice(1) as Extra[]) : []);

function detailText(d: Record<string, unknown> = {}): string {
    const parts: string[] = [];
    const prods = Object.keys(d).filter(k => /^prod_\d+$/.test(k)).sort();
    if (prods.length) {
        for (const k of prods) {
            const i = k.split("_")[1];
            const name = String(d[k] ?? "").trim();
            if (!name) continue;
            const q = String(d[`qty_${i}`] ?? "").trim();
            parts.push(q && q !== "1" ? `${name} ×${q}` : name);
        }
        return parts.join("، ");
    }
    for (const k of ["brand", "type", "viscosity", "filterNum", "num", "size"]) {
        const v = String(d[k] ?? "").trim();
        if (v) parts.push(v);
    }
    const liters = String(d.liters ?? "").trim();
    if (liters) parts.push(`${liters} لتر`);
    const qty = String(d.qty ?? "").trim();
    if (qty && qty !== "1") parts.push(`×${qty}`);
    const notes = String(d.notes ?? "").trim();
    if (notes) parts.push(notes);
    return parts.join(" · ");
}

function servicesOf(v: Visit): { name: string; detail: string; price: number; added?: boolean }[] {
    const p = payloadOf(v);
    const out: { name: string; detail: string; price: number; added?: boolean }[] = [];
    if (v.order_type === "sale") {
        for (const pr of p.products || []) out.push({ name: pr.name || "مادة", detail: pr.qty && pr.qty !== 1 ? `×${pr.qty}` : "", price: num(pr.price) * (pr.qty || 1) });
        return out;
    }
    for (const [k, s] of Object.entries(p.services || {})) {
        if (s?.status !== "يحتاج تغيير") continue;
        out.push({ name: SERVICE_LABELS[k] || k, detail: detailText(s.details), price: num(s.price) });
    }
    for (const c of p.customServices || []) {
        const qty = String(c.qty ?? "").trim();
        out.push({ name: c.label || c.name || "خدمة", detail: [qty && qty !== "1" ? `×${qty}` : "", c.notes || ""].filter(Boolean).join(" · "), price: num(c.price) });
    }
    for (const e of extrasOf(v)) if (e?.name) out.push({ name: e.name, detail: "", price: num(e.price), added: !!e.addedDuringWork });
    return out;
}

function statusChip(v: Visit): { text: string; cls: string } {
    const p = payloadOf(v);
    const m = invoiceMoney({ status: v.status, total_price: v.total_price, pricing: p.pricing });
    if (m.state === "cancelled") return { text: "ملغى", cls: "bg-muted text-muted-foreground border-border" };
    if (p.isComprehensiveInspection) return { text: "فحص شامل", cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" };
    if (m.state === "excluded") return { text: "مستبعدة من المحاسبة", cls: "bg-muted text-muted-foreground border-border" };
    if (m.state === "closed") return { text: "مُحاسَبة", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" };
    if (v.status === "تم الانتهاء") return { text: "بانتظار المحاسبة", cls: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" };
    if (v.status === "قيد العمل") return { text: "قيد العمل", cls: "bg-amber-500/10 text-amber-400 border-amber-500/20" };
    return { text: "بالانتظار", cls: "bg-sky-500/10 text-sky-400 border-sky-500/20" };
}

const badge = (s: string) => s === "سليم" ? "bg-emerald-500/15 text-emerald-400"
    : s === "صيانة" ? "bg-amber-500/15 text-amber-400"
    : s === "تالف" ? "bg-rose-500/15 text-rose-400" : "bg-muted text-muted-foreground";

export default function CarFile({ contract, vehicleId, canDelete, onClose, onChanged }: {
    contract: Contract;
    vehicleId: string;
    canDelete: boolean;
    onClose: () => void;
    onChanged: () => void;
}) {
    const [visits, setVisits] = useState<Visit[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);

    // Bumped after a delete to re-read the file.
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let alive = true;
        (async () => {
        const { data, error } = await supabase.from("inspection_reports")
            .select(`id, report_number, status, order_type, created_at, total_price, odometer_reading, odometer_unit, selected_services,
                branches(name), vehicles(make, model, plate_number, engine_size, clients(name, phone))`)
            .eq("contract_id", contract.id)
            .eq("vehicle_id", vehicleId)
            .order("created_at", { ascending: false })
            .limit(300);
        if (!alive) return;
        if (error) showError("خطأ", error.message);
        const rows = ((data || []) as unknown as Visit[]).filter(v => v.status !== "ملغى");
        setVisits(rows);
        setSelectedId(prev => (prev && rows.some(r => r.id === prev)) ? prev : (rows[0]?.id ?? null));
        setLoading(false);
        })();
        return () => { alive = false; };
    }, [contract.id, vehicleId, reloadKey]);

    // Close on Escape, and keep the page behind from scrolling while the file is open.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
    }, [onClose]);

    const latest = visits[0];
    const car = latest ? one(latest.vehicles) : null;
    const driver = car ? one(car.clients) : null;

    const stats = useMemo(() => {
        let due = 0, pending = 0, maxOdo = 0, unit = "km", inspections = 0, workOrders = 0;
        let nextOil = 0;
        for (const v of visits) {
            const p = payloadOf(v);
            const m = invoiceMoney({ status: v.status, total_price: v.total_price, pricing: p.pricing });
            if (m.state === "closed") due += m.net;
            else if (m.state === "pending" && !p.isComprehensiveInspection) pending++;
            if (p.comprehensiveInspection) inspections++;
            if (!p.isComprehensiveInspection) workOrders++;
            if ((v.odometer_reading || 0) > maxOdo) { maxOdo = v.odometer_reading || 0; unit = v.odometer_unit || "km"; }
            if (!nextOil) {
                const f = parseInt(String(p.futureOdometer || "").replace(/[^\d]/g, ""), 10) || 0;
                if (f > 0 && f < 2_000_000) nextOil = f;
            }
        }
        return { due, pending, maxOdo, unit: unit === "mi" ? "ميل" : "كم", inspections, workOrders, nextOil };
    }, [visits]);

    const selected = visits.find(v => v.id === selectedId) || null;

    const deleteVisit = async (v: Visit) => {
        const ok = await showConfirm(
            "حذف أمر العمل",
            `حذف أمر العمل #${v.report_number} نهائياً؟ سيُحذف من ملف السيارة ومن حساب العقد ولا يمكن التراجع.`,
            "حذف",
            true,
        );
        if (!ok) return;
        setDeleting(v.id);
        const { error } = await supabase.from("inspection_reports").delete().eq("id", v.id);
        setDeleting(null);
        if (error) { showError("خطأ", error.message); return; }
        showSuccess("تم الحذف", `حُذف أمر العمل #${v.report_number}.`);
        setLoading(true);
        setReloadKey(k => k + 1);
        onChanged();
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-stretch md:items-center justify-center md:p-6" dir="rtl" onClick={onClose}>
            <div className="bg-background border border-border md:rounded-3xl w-full max-w-6xl h-full md:h-[90vh] flex flex-col overflow-hidden shadow-2xl"
                onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="p-4 md:p-6 border-b border-border flex flex-col gap-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0"><Car size={24} /></div>
                            <div className="min-w-0">
                                <h2 className="text-xl md:text-2xl font-display font-bold truncate">
                                    ملف السيارة{car ? `: ${car.make || ""} ${car.model || ""}` : ""}
                                </h2>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground mt-1">
                                    {car?.plate_number && <span className="font-mono text-foreground">{car.plate_number}</span>}
                                    {driver?.name && <span>السائق: <span className="text-foreground">{driver.name}</span></span>}
                                    {driver?.phone && <span dir="ltr">{driver.phone}</span>}
                                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                                        <Landmark size={11} /> عقد {contract.name}
                                    </span>
                                </div>
                            </div>
                        </div>
                        <button onClick={onClose} className="p-2 rounded-xl bg-muted hover:bg-rose-500 hover:text-white border border-border shrink-0" title="إغلاق"><X size={20} /></button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
                        <Stat label="الزيارات" value={String(stats.workOrders)} sub={stats.inspections ? `${stats.inspections} فحص شامل` : "—"} />
                        <Stat label="آخر عداد" value={stats.maxOdo ? `${money(stats.maxOdo)} ${stats.unit}` : "—"} />
                        <Stat label="تبديل الزيت القادم" value={stats.nextOil ? `${money(stats.nextOil)} ${stats.unit}` : "—"} />
                        <Stat label="المستحق على السيارة" value={`${money(stats.due)} د.ع`} sub={stats.pending ? `${stats.pending} بانتظار المحاسبة` : "فواتير مغلقة"} />
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Link href={`/reception?contract=${contract.id}&vehicle=${vehicleId}`}
                            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-sm font-bold flex items-center gap-2">
                            <Plus size={16} /> ورقة عمل جديدة للسيارة
                        </Link>
                    </div>
                </div>

                {/* Body: visits list + selected visit */}
                {loading ? (
                    <div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-amber-500 w-10 h-10" /></div>
                ) : visits.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-6 text-center">لا توجد زيارات لهذه السيارة على العقد.</div>
                ) : (
                    <div className="flex-1 min-h-0 flex flex-col md:flex-row">
                        <div className="md:w-72 shrink-0 border-b md:border-b-0 md:border-l border-border overflow-y-auto max-h-56 md:max-h-none p-3 space-y-2">
                            <div className="text-xs font-bold text-muted-foreground px-1 pb-1">سجل الزيارات ({visits.length})</div>
                            {visits.map(v => {
                                const chip = statusChip(v);
                                const p = payloadOf(v);
                                const active = v.id === selectedId;
                                return (
                                    <button key={v.id} onClick={() => setSelectedId(v.id)}
                                        className={`w-full text-right p-3 rounded-xl border transition-colors ${active ? "bg-amber-500/10 border-amber-500/40" : "bg-card border-border hover:border-amber-500/30"}`}>
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-mono font-bold text-sm">#{v.report_number}</span>
                                            <span className="text-[11px] text-muted-foreground">{fmtDate(v.created_at)}</span>
                                        </div>
                                        <div className="flex items-center justify-between gap-2 mt-1.5">
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${chip.cls}`}>{chip.text}</span>
                                            {p.comprehensiveInspection && !p.isComprehensiveInspection && <span className="text-[10px] font-bold text-blue-400">+ فحص شامل</span>}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                        <div className="flex-1 min-w-0 overflow-y-auto p-4 md:p-6">
                            {selected && <VisitDetails v={selected} contractId={contract.id} canDelete={canDelete}
                                deleting={deleting === selected.id} onDelete={() => deleteVisit(selected)} />}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
        <div className="bg-card border border-border rounded-2xl p-3">
            <div className="text-[11px] text-muted-foreground font-bold">{label}</div>
            <div className="text-base md:text-lg font-black mt-0.5" dir="ltr" style={{ textAlign: "right" }}>{value}</div>
            {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
        </div>
    );
}

function VisitDetails({ v, contractId, canDelete, deleting, onDelete }: {
    v: Visit; contractId: string; canDelete: boolean; deleting: boolean; onDelete: () => void;
}) {
    const p = payloadOf(v);
    const chip = statusChip(v);
    const services = servicesOf(v);
    const m = invoiceMoney({ status: v.status, total_price: v.total_price, pricing: p.pricing });
    const free = Object.entries(p.freeServices || {}).filter(([, on]) => on).map(([k]) => FREE_SERVICE_LABELS[k] || k);
    const ci = p.comprehensiveInspection;
    const isSale = v.order_type === "sale";

    return (
        <div className="space-y-5">
            {/* Visit header + actions */}
            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-lg font-bold">{p.isComprehensiveInspection ? "فحص شامل" : isSale ? "بيع مواد" : "زيارة صيانة"} #{v.report_number}</h3>
                        <span className={`text-[11px] font-bold px-2 py-1 rounded-lg border ${chip.cls}`}>{chip.text}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-2">
                        <span>التاريخ: <span className="text-foreground">{fmtDate(v.created_at)}</span></span>
                        {one(v.branches)?.name && <span>الفرع: <span className="text-foreground">{one(v.branches)?.name}</span></span>}
                        {!!v.odometer_reading && <span className="flex items-center gap-1"><Gauge size={12} /> <span className="text-foreground">{money(v.odometer_reading)} {v.odometer_unit === "mi" ? "ميل" : "كم"}</span></span>}
                        {p.technicianName && <span className="flex items-center gap-1"><Wrench size={12} /> <span className="text-foreground">{p.technicianName}</span></span>}
                        {p.shiftSupervisor && <span>المشرف: <span className="text-foreground">{p.shiftSupervisor}</span></span>}
                    </div>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                    {!p.isComprehensiveInspection && (
                        <Link href={`/reception?edit=${v.id}&contract=${contractId}`}
                            className="h-9 px-3 rounded-lg bg-muted hover:bg-amber-500/20 border border-border text-xs font-bold flex items-center gap-1.5"><Edit2 size={14} /> تعديل</Link>
                    )}
                    {!isSale && !p.isComprehensiveInspection && (
                        <Link href={`/work-orders/${v.id}`}
                            className="h-9 px-3 rounded-lg bg-muted hover:bg-blue-500/20 border border-border text-xs font-bold flex items-center gap-1.5"><ExternalLink size={14} /> أمر العمل</Link>
                    )}
                    <button onClick={() => window.open(`/print/${v.id}?mode=full`, "_blank")}
                        className="h-9 px-3 rounded-lg bg-muted hover:bg-emerald-500/20 border border-border text-xs font-bold flex items-center gap-1.5"><Printer size={14} /> طباعة</button>
                    {canDelete && (
                        <button onClick={onDelete} disabled={deleting}
                            className="h-9 px-3 rounded-lg bg-rose-500/10 hover:bg-rose-500 hover:text-white text-rose-400 border border-rose-500/30 text-xs font-bold flex items-center gap-1.5 disabled:opacity-60">
                            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} حذف
                        </button>
                    )}
                </div>
            </div>

            {/* What was done */}
            {!p.isComprehensiveInspection && (
                <div className="bg-card border border-border rounded-2xl overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-border text-sm font-bold">{isSale ? "المواد المباعة" : "الخدمات المنفّذة"}</div>
                    {services.length === 0 ? (
                        <div className="p-4 text-xs text-muted-foreground">لا توجد خدمات مسجلة بهذه الزيارة.</div>
                    ) : services.map((s, i) => (
                        <div key={i} className="px-4 py-2.5 border-b border-border/50 last:border-0 flex items-start justify-between gap-3 text-sm">
                            <div className="min-w-0">
                                <div className="font-bold">{s.name}{s.added && <span className="mr-2 text-[10px] text-amber-400">أُضيفت أثناء العمل</span>}</div>
                                {s.detail && <div className="text-[11px] text-muted-foreground mt-0.5">{s.detail}</div>}
                            </div>
                            <div className="font-bold whitespace-nowrap" dir="ltr">{s.price ? `${money(s.price)} د.ع` : "—"}</div>
                        </div>
                    ))}
                    {free.length > 0 && (
                        <div className="px-4 py-2.5 border-t border-border/50 flex flex-wrap gap-1.5 items-center">
                            <span className="text-[11px] text-muted-foreground">خدمات مجانية:</span>
                            {free.map(f => <span key={f} className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">{f}</span>)}
                        </div>
                    )}
                    <div className="px-4 py-3 bg-muted/30 border-t border-border grid grid-cols-2 gap-2 text-sm">
                        {m.state === "closed" ? (<>
                            <div>الصافي: <span className="font-bold">{money(m.net)} د.ع</span></div>
                            <div>الواصل عند الإغلاق: <span className="font-bold">{money(m.received)} د.ع</span></div>
                        </>) : m.state === "pending" ? (
                            <div className="col-span-2 text-muted-foreground">المبلغ التقديري: <span className="font-bold text-foreground">{money(m.net)} د.ع</span> (لم تُحاسَب بعد)</div>
                        ) : (
                            <div className="col-span-2 text-muted-foreground">خارج المحاسبة</div>
                        )}
                    </div>
                </div>
            )}

            {/* Comprehensive inspection result, same layout as the customer file */}
            {ci ? (
                <div className="space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                        <h4 className="text-sm font-bold text-blue-400 flex items-center gap-2"><FileText size={15} /> نتيجة الفحص الشامل</h4>
                        {ci.rating && <span className={`text-xs font-bold px-2.5 py-1 rounded-lg ${badge(ci.rating)}`}>التقييم: {ci.rating}{ci.percentage ? ` (${ci.percentage}%)` : ""}</span>}
                    </div>
                    {INSPECTION_SECTIONS.map(sec => {
                        const items = sec.items.filter(it => ci.items?.[it.key]?.status || ci.items?.[it.key]?.note);
                        if (!items.length) return null;
                        return (
                            <div key={sec.key} className="bg-muted/10 border border-border/40 rounded-xl p-3">
                                <div className="text-xs font-bold text-foreground mb-2 border-b border-border/40 pb-1">{sec.title}</div>
                                <div className="space-y-1.5">
                                    {items.map(it => {
                                        const d = ci.items[it.key];
                                        return (
                                            <div key={it.key} className="flex items-center gap-2 text-[11px]">
                                                <span className="flex-1 font-medium">{it.label}</span>
                                                {d.status && <span className={`px-2 py-0.5 rounded font-bold ${badge(d.status)}`}>{d.status}</span>}
                                                {d.note && <span className="text-muted-foreground">{d.note}</span>}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                    {ci.finalNotes && (
                        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 text-xs">
                            <span className="font-bold text-amber-400">الملاحظات النهائية: </span>{ci.finalNotes}
                        </div>
                    )}
                    <button onClick={() => window.open(`/inspection/${v.id}`, "_blank")}
                        className="w-full py-2.5 bg-blue-600/10 hover:bg-blue-600 hover:text-white text-blue-400 border border-blue-500/30 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-2">
                        <FileText size={14} /> طباعة الفحص الشامل (PDF)
                    </button>
                </div>
            ) : !isSale && (
                <div className="text-[11px] text-muted-foreground bg-muted/20 border border-border/50 rounded-xl p-3">
                    لا يوجد فحص شامل بهذه الزيارة. يُسجَّل الفحص الشامل من صفحة أمر العمل في ساحة الورشة.
                </div>
            )}
        </div>
    );
}
