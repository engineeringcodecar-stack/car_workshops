"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { normalizeBookletCode } from "@/lib/booklet";
import { digitsOnly, withCommas } from "@/lib/format";
import { useRouter } from "next/navigation";
import { Loader2, ArrowRight, CheckCircle2, Printer } from "lucide-react";
import { showError } from "@/lib/alerts";
import { useContracts, lastContractForVehicle } from "@/lib/contracts";
import ContractSelect from "@/components/ContractSelect";
import {
    INSPECTION_SECTIONS, INSPECTION_STATUSES, emptyInspection, InspectionStatus,
} from "@/lib/comprehensiveInspection";

// الفحص الشامل — standalone lightweight form (mirrors SaleForm). Reception fills the
// customer/vehicle info + the checklist, saves as a report tied to a real vehicle_id
// (so it appears in the customer's file) with a comprehensiveInspection payload.
export default function InspectionForm({
    branches, selectedBranchId, setSelectedBranchId, onClose, initialVehicleId,
}: {
    branches: { id: string; name: string }[];
    selectedBranchId: string;
    setSelectedBranchId: (id: string) => void;
    onClose: () => void;
    initialVehicleId?: string;
}) {
    const router = useRouter();
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [make, setMake] = useState("");
    const [model, setModel] = useState("");
    const [plateNumber, setPlateNumber] = useState("");
    const [engineSize, setEngineSize] = useState("");
    const [odometer, setOdometer] = useState("");
    const [technician, setTechnician] = useState("");
    // جهة التعاقد: "" = ordinary customer, else the contract this inspection belongs to.
    const [contractId, setContractId] = useState("");
    const contracts = useContracts();
    // Link to an EXISTING customer/vehicle (chosen from search) so no duplicate is created.
    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
    const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
    const [suggestions, setSuggestions] = useState<any[]>([]);
    const [insp, setInsp] = useState(emptyInspection());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState<{ id: string; number: number | null } | null>(null);

    const setItem = (key: string, field: "status" | "note", value: string) =>
        setInsp(prev => ({ ...prev, items: { ...prev.items, [key]: { ...prev.items[key], [field]: value as any } } }));

    // Search EXISTING customers by phone or booklet serial (BK-…) — same as reception.
    useEffect(() => {
        if (selectedClientId) return;
        // A scanner types the whole booklet URL — reduce it to the serial first.
        const q = normalizeBookletCode(phone);
        if (q.length < 3) { setSuggestions([]); return; }
        const t = setTimeout(async () => {
            const sel = "id, name, phone, vehicles(id, make, model, engine_size, plate_number, booklet_serial)";
            if (q.toUpperCase().startsWith("BK")) {
                const { data } = await supabase.from("clients").select(sel).eq("vehicles.booklet_serial", q.toUpperCase());
                setSuggestions((data || []).filter((c: any) => c.vehicles?.some((v: any) => v.booklet_serial?.toUpperCase() === q.toUpperCase())));
            } else {
                const { data } = await supabase.from("clients").select(sel).ilike("phone", `%${q}%`).limit(6);
                setSuggestions(data || []);
            }
        }, 400);
        return () => clearTimeout(t);
    }, [phone, selectedClientId]);

    const pickCustomer = (c: any) => {
        setName(c.name || "");
        setPhone(c.phone || "");
        setSelectedClientId(c.id);
        setSuggestions([]);
        const v = c.vehicles?.[0];
        if (v) {
            setMake(v.make || ""); setModel(v.model || "");
            setEngineSize(v.engine_size || ""); setPlateNumber(v.plate_number || "");
            setSelectedVehicleId(v.id || null);
        }
    };

    const clearLink = () => { setSelectedClientId(null); setSelectedVehicleId(null); };

    // A government car picked from search (or opened from its file) comes back
    // already tagged to its contract. Only ever pre-selects — never clears a choice.
    useEffect(() => {
        if (!selectedVehicleId) return;
        let alive = true;
        lastContractForVehicle(selectedVehicleId).then(id => { if (alive && id) setContractId(id); });
        return () => { alive = false; };
    }, [selectedVehicleId]);

    // Preselected vehicle (opened from a customer's file) — load + link it automatically.
    useEffect(() => {
        if (!initialVehicleId) return;
        (async () => {
            const { data } = await supabase.from("vehicles")
                .select("id, make, model, engine_size, plate_number, clients(id, name, phone)")
                .eq("id", initialVehicleId).maybeSingle();
            if (!data) return;
            setMake(data.make || ""); setModel(data.model || "");
            setEngineSize(data.engine_size || ""); setPlateNumber(data.plate_number || "");
            setSelectedVehicleId(data.id);
            const c: any = Array.isArray(data.clients) ? data.clients[0] : data.clients;
            if (c) { setName(c.name || ""); setPhone(c.phone || ""); setSelectedClientId(c.id); }
        })();
    }, [initialVehicleId]);

    // Full literal class strings (Tailwind JIT can't see dynamically-built names).
    const STATUS_CLASSES: Record<string, { active: string; idle: string }> = {
        "سليم": { active: "bg-emerald-500 text-white border-emerald-500", idle: "border-border text-muted-foreground hover:border-emerald-500/50" },
        "صيانة": { active: "bg-amber-500 text-white border-amber-500", idle: "border-border text-muted-foreground hover:border-amber-500/50" },
        "تالف": { active: "bg-rose-500 text-white border-rose-500", idle: "border-border text-muted-foreground hover:border-rose-500/50" },
    };

    const handleSave = async () => {
        if (!name.trim() && !phone.trim()) { setError("أدخل اسم الزبون أو رقم الهاتف على الأقل."); return; }
        setLoading(true); setError(null);
        try {
            // ── client: use the one picked from search, else find-or-create by phone ──
            let clientId: string | null = selectedClientId;
            const phoneClean = phone.trim();
            if (!clientId && phoneClean) {
                const { data: ec } = await supabase.from("clients").select("id").eq("phone", phoneClean).maybeSingle();
                clientId = ec?.id ?? null;
            }
            if (!clientId) {
                const { data: nc, error: ce } = await supabase.from("clients")
                    .insert({ name: name.trim() || "زبون", phone: phoneClean }).select("id").single();
                if (ce) throw ce;
                clientId = nc.id;
            }
            // ── vehicle: use the picked one, else find-or-create by plate under the client ──
            let vehicleId: string | null = selectedVehicleId;
            const plateClean = plateNumber.trim();
            if (!vehicleId && plateClean) {
                const { data: ev } = await supabase.from("vehicles").select("id").eq("plate_number", plateClean).maybeSingle();
                vehicleId = ev?.id ?? null;
            }
            if (!vehicleId) {
                const { data: nv, error: ve } = await supabase.from("vehicles").insert({
                    client_id: clientId, make: make.trim() || "-", model: model.trim() || "-",
                    plate_number: plateClean || null, engine_size: engineSize.trim() || null,
                }).select("id").single();
                if (ve) throw ve;
                vehicleId = nv.id;
            }
            // ── insert the inspection as a report ──
            const payload = {
                isComprehensiveInspection: true,
                comprehensiveInspection: insp,
                customerName: name.trim(),
                customerPhone: phoneClean,
                technicianName: technician.trim(),
            };
            const { data: rd, error: re } = await supabase.from("inspection_reports").insert({
                branch_id: selectedBranchId || null,
                vehicle_id: vehicleId,
                odometer_reading: parseInt(odometer || "0") || 0,
                odometer_unit: "km",
                order_type: "maintenance",
                contract_id: contractId || null,
                status: "تم الانتهاء",
                total_price: 0,
                selected_services: [payload],
            }).select("id, report_number").single();
            if (re) throw re;
            setDone({ id: rd.id, number: rd.report_number });
        } catch (e: any) {
            console.error(e);
            setError(e.message || "حدث خطأ أثناء الحفظ.");
            showError("خطأ", e.message || "تعذّر حفظ الفحص الشامل.");
        } finally {
            setLoading(false);
        }
    };

    if (done) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center p-4 font-ibm" dir="rtl">
                <div className="glass-card p-8 rounded-3xl max-w-md w-full text-center border border-emerald-500/20">
                    <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold mb-2">تم حفظ الفحص الشامل</h2>
                    <p className="text-muted-foreground mb-6">التقرير رقم #{done.number ?? "—"} — محفوظ بملف العميل.</p>
                    <div className="flex gap-3">
                        <button onClick={() => window.open(`/inspection/${done.id}`, "_blank")}
                            className="flex-1 py-3 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-2xl flex items-center justify-center gap-2">
                            <Printer size={18} /> طباعة الفحص
                        </button>
                        <button onClick={onClose}
                            className="flex-1 py-3 bg-muted hover:bg-muted/80 font-bold rounded-2xl border border-border">رجوع للسجل</button>
                    </div>
                </div>
            </div>
        );
    }

    // Live summary for the progress bar.
    const allItems = Object.values(insp.items);
    const total = allItems.length;
    const cnt = (s: string) => allItems.filter(i => i.status === s).length;
    const assessed = allItems.filter(i => i.status).length;

    return (
        <div className="min-h-screen bg-background p-4 md:p-8 pb-28 font-ibm" dir="rtl">
            <div className="max-w-5xl mx-auto space-y-5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <button onClick={onClose} className="p-2 bg-muted hover:bg-rose-500 hover:text-white rounded-xl border border-border" title="رجوع">
                            <ArrowRight size={18} />
                        </button>
                        <h1 className="text-2xl font-display font-bold">فحص شامل جديد</h1>
                    </div>
                    {branches.length > 1 && (
                        <select value={selectedBranchId} onChange={e => setSelectedBranchId(e.target.value)}
                            className="bg-card border border-border rounded-xl px-4 py-2.5 text-sm">
                            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                    )}
                </div>

                {/* Customer + vehicle */}
                <div className="glass-card p-5 rounded-2xl grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Field label="اسم الزبون">
                        <input className="input-field" value={name} onChange={e => setName(e.target.value)} placeholder="—" />
                        {selectedClientId && <span className="text-[10px] text-emerald-400 font-bold mt-1 block">✓ مرتبط بزبون موجود</span>}
                    </Field>
                    <Field label="رقم الهاتف / الدفتر (للبحث)">
                        <div className="relative">
                            <input className="input-field text-right w-full" dir="ltr" value={phone}
                                onChange={e => { setPhone(e.target.value); clearLink(); }}
                                placeholder="ابحث برقم الهاتف أو BK-…" />
                            {suggestions.length > 0 && (
                                <div className="absolute z-20 mt-1 w-full bg-card border border-border rounded-xl shadow-xl max-h-56 overflow-auto text-right">
                                    {suggestions.map(c => (
                                        <button key={c.id} type="button" onClick={() => pickCustomer(c)}
                                            className="w-full text-right px-3 py-2 hover:bg-rose-500/10 border-b border-border/40 last:border-0">
                                            <div className="font-bold text-sm">{c.name}</div>
                                            <div className="text-xs text-muted-foreground" dir="ltr">{c.phone}{c.vehicles?.[0] ? ` • ${c.vehicles[0].make} ${c.vehicles[0].model}` : ""}</div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </Field>
                    <Field label="نوع المركبة"><input className="input-field" value={make} onChange={e => setMake(e.target.value)} placeholder="—" /></Field>
                    <Field label="الموديل / السنة"><input className="input-field" value={model} onChange={e => setModel(e.target.value)} placeholder="—" /></Field>
                    <Field label="رقم اللوحة"><input className="input-field" value={plateNumber} onChange={e => setPlateNumber(e.target.value)} placeholder="—" /></Field>
                    <Field label="حجم المحرك"><input className="input-field" value={engineSize} onChange={e => setEngineSize(e.target.value)} placeholder="—" /></Field>
                    <Field label="عداد المسافة"><input className="input-field text-right" dir="ltr" inputMode="numeric" value={withCommas(odometer)} onChange={e => setOdometer(digitsOnly(e.target.value))} placeholder="0" /></Field>
                    <Field label="الفني المسؤول"><input className="input-field" value={technician} onChange={e => setTechnician(e.target.value)} placeholder="—" /></Field>
                    <ContractSelect className="col-span-2" contracts={contracts} value={contractId} onChange={setContractId} />
                </div>

                {/* Progress summary */}
                <div className="glass-card p-4 rounded-2xl flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <span className="text-sm font-bold">تم تقييم {assessed} من {total}</span>
                        <div className="h-2 w-40 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-rose-500 transition-all" style={{ width: `${total ? (assessed / total) * 100 : 0}%` }} />
                        </div>
                    </div>
                    <div className="flex gap-2 text-xs font-bold">
                        <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">سليم {cnt("سليم")}</span>
                        <span className="px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">صيانة {cnt("صيانة")}</span>
                        <span className="px-2.5 py-1 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">تالف {cnt("تالف")}</span>
                    </div>
                </div>

                {/* Checklist sections */}
                {INSPECTION_SECTIONS.map(sec => (
                    <div key={sec.key} className="glass-card p-4 rounded-2xl">
                        <h3 className="font-bold mb-3 border-b border-border pb-2 flex items-center gap-2">
                            <span className="w-7 h-7 rounded-lg bg-rose-500/10 flex items-center justify-center text-base">{sec.icon}</span>
                            <span className="text-rose-400">{sec.title}</span>
                        </h3>
                        <div className="space-y-2">
                            {sec.items.map(it => {
                                const cur = insp.items[it.key];
                                return (
                                    <div key={it.key} className="flex flex-col md:flex-row md:items-center gap-2 border-b border-border/40 pb-2">
                                        <span className="md:w-48 font-medium text-sm shrink-0">{it.label}</span>
                                        <div className="flex gap-1.5">
                                            {INSPECTION_STATUSES.map(st => {
                                                const active = cur.status === st;
                                                const cls = STATUS_CLASSES[st];
                                                return (
                                                    <button key={st} type="button"
                                                        onClick={() => setItem(it.key, "status", active ? "" : st)}
                                                        className={`px-3 py-1 rounded-lg text-xs font-bold border transition-colors ${active ? cls.active : cls.idle}`}>
                                                        {st}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <input className="input-field text-xs py-1.5 flex-1" placeholder="ملاحظة الفني"
                                            value={cur.note} onChange={e => setItem(it.key, "note", e.target.value)} />
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}

                {/* Final assessment */}
                <div className="glass-card p-5 rounded-2xl grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Field label="الملاحظات النهائية" className="md:col-span-2">
                        <textarea className="input-field min-h-[70px]" value={insp.finalNotes}
                            onChange={e => setInsp(p => ({ ...p, finalNotes: e.target.value }))} placeholder="—" />
                    </Field>
                    <div>
                        <Field label="التقييم الفني">
                            <div className="flex gap-1.5">
                                {INSPECTION_STATUSES.map(st => (
                                    <button key={st} type="button"
                                        onClick={() => setInsp(p => ({ ...p, rating: p.rating === st ? "" : st }))}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${insp.rating === st ? "bg-rose-600 text-white border-rose-600" : "border-border text-muted-foreground"}`}>
                                        {st}
                                    </button>
                                ))}
                            </div>
                        </Field>
                        <Field label="النسبة %" className="mt-3">
                            <input className="input-field text-right" dir="ltr" inputMode="numeric" value={insp.percentage}
                                onChange={e => {
                                    const raw = digitsOnly(e.target.value).slice(0, 3);
                                    const capped = raw === "" ? "" : String(Math.min(100, parseInt(raw, 10)));
                                    setInsp(p => ({ ...p, percentage: capped }));
                                }} placeholder="0 - 100" />
                            <span className="text-[10px] text-muted-foreground mt-1 block">النسبة من 0 إلى 100% فقط.</span>
                        </Field>
                    </div>
                </div>

                {error && <p className="text-rose-500 text-sm font-bold text-center">{error}</p>}

                <div className="sticky bottom-3 z-30">
                    <div className="glass-card border border-border/60 rounded-2xl p-3 flex gap-3 shadow-2xl backdrop-blur">
                        <button onClick={onClose} className="px-6 py-3 bg-muted hover:bg-muted/80 font-bold rounded-xl border border-border">إلغاء</button>
                        <button onClick={handleSave} disabled={loading}
                            className="flex-1 py-3 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold rounded-xl shadow-lg flex items-center justify-center gap-2 disabled:opacity-60">
                            {loading ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />} حفظ الفحص الشامل
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
    return (
        <div className={className}>
            <label className="block text-xs font-bold text-muted-foreground mb-1.5">{label}</label>
            {children}
        </div>
    );
}
