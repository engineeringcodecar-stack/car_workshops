"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthProvider";
import { showSuccess, showError } from "@/lib/alerts";
import { digitsOnly, decimalsOnly, withCommasDecimal } from "@/lib/format";
import { useContracts } from "@/lib/contracts";
import ContractSelect from "@/components/ContractSelect";
import { ShoppingCart, ArrowRight, Plus, Trash2, Printer, Loader2, CheckCircle2 } from "lucide-react";

type Product = { name: string; qty: string; price: string };

export default function SaleForm({
    branches,
    selectedBranchId,
    setSelectedBranchId,
    onClose,
}: {
    branches: { id: string; name: string }[];
    selectedBranchId: string;
    setSelectedBranchId: (id: string) => void;
    onClose: () => void;
}) {
    const { employeeId, employeeBranchId, employeeRole } = useAuth();
    const searchParams = useSearchParams();
    const router = useRouter();
    const editId = searchParams.get("edit");

    const [editReportId, setEditReportId] = useState<string | null>(null);
    // The moment the sale was originally settled. Editing a sale must NOT re-stamp it —
    // rewriting accountedAt with "now" silently moved the sale's income to a different
    // day in the daily closing report.
    const [originalAccountedAt, setOriginalAccountedAt] = useState<string | null>(null);
    const [customerName, setCustomerName] = useState("");
    const [customerPhone, setCustomerPhone] = useState("");
    // جهة التعاقد: a sale billed to a contract is on credit — nothing is collected
    // at the counter, the amount goes onto the contract's balance instead.
    const [contractId, setContractId] = useState("");
    const contracts = useContracts();
    const [products, setProducts] = useState<Product[]>([{ name: "", qty: "1", price: "" }]);
    const [discount, setDiscount] = useState("");
    const [productNames, setProductNames] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [done, setDone] = useState<{ id: string; number: number | null } | null>(null);

    const branchName = branches.find((b) => b.id === (selectedBranchId || employeeBranchId))?.name || "";

    // Product-name suggestions (same source as the reception form's "materials" list).
    useEffect(() => {
        const activeBranchId = selectedBranchId || employeeBranchId;
        if (!activeBranchId) return;
        (async () => {
            const { data } = await (supabase as any).from("suggestion_lists").select("key, items").eq("branch_id", activeBranchId).eq("key", "materials");
            const items = (data && data[0] && Array.isArray(data[0].items)) ? data[0].items : [];
            setProductNames(items.map((it: any) => (typeof it === "object" && it !== null ? it.name : it)).filter(Boolean));
        })();
    }, [selectedBranchId, employeeBranchId]);

    // Load an existing sale when editing.
    useEffect(() => {
        if (!editId) return;
        (async () => {
            const { data } = await supabase.from("inspection_reports").select("id, branch_id, contract_id, selected_services").eq("id", editId).single();
            if (!data) return;
            setEditReportId(data.id);
            if (data.branch_id) setSelectedBranchId(data.branch_id);
            setContractId(data.contract_id || "");
            const payload = Array.isArray(data.selected_services) ? data.selected_services[0] : data.selected_services;
            if (payload) {
                setCustomerName(payload.customerName || "");
                setCustomerPhone(payload.customerPhone || "");
                if (Array.isArray(payload.products) && payload.products.length > 0) {
                    setProducts(payload.products.map((p: any) => ({ name: p.name || "", qty: String(p.qty ?? "1"), price: String(p.price ?? "") })));
                }
                const savedDiscount = parseFloat(String(payload.pricing?.discount ?? "0")) || 0;
                setDiscount(savedDiscount > 0 ? String(savedDiscount) : "");
                setOriginalAccountedAt(payload.pricing?.accountedAt || null);
            }
        })();
    }, [editId, setSelectedBranchId]);

    const total = useMemo(
        () => products.reduce((s, p) => s + (parseFloat(p.qty) || 0) * (parseFloat(p.price) || 0), 0),
        [products]
    );
    // A sale is settled on the spot, so the net (after discount) is both what the
    // customer pays and what the accounting page counts as income for the day.
    const discountValue = Math.min(parseFloat(discount) || 0, total);
    const netTotal = total - discountValue;

    const updateProduct = (i: number, field: keyof Product, val: string) =>
        setProducts((prev) => prev.map((p, idx) => (idx === i ? { ...p, [field]: val } : p)));
    const addProduct = () => setProducts((prev) => [...prev, { name: "", qty: "1", price: "" }]);
    const removeProduct = (i: number) => setProducts((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));

    const handleSave = async () => {
        const valid = products.filter((p) => p.name.trim());
        if (valid.length === 0) {
            showError("تنبيه", "أضف منتجاً واحداً على الأقل قبل الحفظ.");
            return;
        }
        const branchId = selectedBranchId || employeeBranchId || branches[0]?.id;
        if (!branchId) {
            showError("تنبيه", "اختر الفرع أولاً.");
            return;
        }
        setLoading(true);
        try {
            const payload = [{
                is_sale: true,
                customerName: customerName.trim(),
                customerPhone: customerPhone.trim(),
                products: valid.map((p) => ({ name: p.name.trim(), qty: parseFloat(p.qty) || 1, price: parseFloat(p.price) || 0 })),
                pricing: {
                    grandTotal: String(total),
                    discount: String(discountValue),
                    // On a contract (آجل) nothing is collected at the counter.
                    amountReceived: String(contractId ? 0 : netTotal),
                    accounted: true,
                    // Keep the original settlement moment on edit; stamp "now" only for a new sale.
                    accountedAt: (editReportId && originalAccountedAt) || new Date().toISOString(),
                }
            }];

            if (editReportId) {
                const { error } = await supabase.from("inspection_reports").update({
                    branch_id: branchId,
                    contract_id: contractId || null,
                    // Net, so the daily income matches what was actually collected —
                    // same convention the accounting page uses for maintenance invoices.
                    total_price: netTotal,
                    selected_services: payload,
                }).eq("id", editReportId);
                if (error) throw error;
                const { data } = await supabase.from("inspection_reports").select("report_number").eq("id", editReportId).single();
                setDone({ id: editReportId, number: data?.report_number ?? null });
            } else {
                const { data, error } = await supabase.from("inspection_reports").insert({
                    branch_id: branchId,
                    vehicle_id: null,
                    receptionist_id: employeeId,
                    order_type: "sale",
                    contract_id: contractId || null,
                    status: "تم الانتهاء",
                    odometer_reading: 0,
                    total_price: netTotal,
                    selected_services: payload,
                }).select("id, report_number").single();
                if (error) throw error;
                setDone({ id: data.id, number: data.report_number });
            }
            showSuccess("تم الحفظ", "تم تسجيل البيع بنجاح.");
        } catch (err: any) {
            console.error(err);
            showError("خطأ", "فشل حفظ البيع: " + (err.message || ""));
        } finally {
            setLoading(false);
        }
    };

    const resetForNew = () => {
        setDone(null);
        setEditReportId(null);
        setOriginalAccountedAt(null);
        setCustomerName("");
        setCustomerPhone("");
        setContractId("");
        setProducts([{ name: "", qty: "1", price: "" }]);
        setDiscount("");
        router.replace("/reception?sale=1");
    };

    // ---------- Success screen ----------
    if (done) {
        const validProducts = products.filter((p) => p.name.trim());
        return (
            <div className="p-6 md:p-8 font-ibm" dir="rtl">
                <div className="max-w-xl mx-auto text-center space-y-6 animate-fade-in print:hidden">
                    <div className="w-20 h-20 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center mx-auto">
                        <CheckCircle2 size={48} />
                    </div>
                    <div>
                        <h2 className="text-3xl font-display font-bold text-foreground mb-2">تم تسجيل البيع!</h2>
                        <p className="text-muted-foreground">
                            رقم الفاتورة: <span className="font-mono font-bold text-rose-400">#{done.number}</span>
                            {discountValue > 0 && <> • الخصم: <span className="font-bold text-amber-400">{discountValue.toLocaleString()}</span></>}
                            {" "}• الصافي: <span className="font-bold text-emerald-400">{netTotal.toLocaleString()}</span>
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-3">
                        <button onClick={() => window.print()} className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-emerald-500/20">
                            <Printer size={18} /> طباعة الفاتورة
                        </button>
                        <button onClick={resetForNew} className="flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl transition-all">
                            <ShoppingCart size={18} /> بيع جديد
                        </button>
                        <button onClick={onClose} className="px-5 py-2.5 bg-muted hover:bg-muted/80 text-foreground font-bold rounded-xl transition-all border border-border">
                            رجوع للسجل
                        </button>
                    </div>
                </div>

                {/* Printable invoice */}
                <div className="hidden print:block text-black bg-white p-8" dir="rtl" style={{ fontFamily: "'IBM Plex Sans Arabic', sans-serif" }}>
                    <div className="flex items-center justify-between border-b-2 border-black pb-4 mb-6">
                        <div>
                            <h1 className="text-2xl font-black">هندسة السيارات</h1>
                            <p className="text-sm">فاتورة بيع منتج — {branchName}</p>
                        </div>
                        <div className="text-left text-sm">
                            <p>رقم الفاتورة: #{done.number}</p>
                            <p>التاريخ: {new Date().toLocaleDateString("en-GB")}</p>
                        </div>
                    </div>
                    {(customerName || customerPhone) && (
                        <p className="mb-4 text-sm font-bold">العميل: {customerName || "—"}{customerPhone ? ` • ${customerPhone}` : ""}</p>
                    )}
                    <table className="w-full text-right border-collapse text-sm">
                        <thead>
                            <tr className="border-b-2 border-black">
                                <th className="p-2 border border-gray-400">المنتج</th>
                                <th className="p-2 border border-gray-400">الكمية</th>
                                <th className="p-2 border border-gray-400">السعر</th>
                                <th className="p-2 border border-gray-400">الإجمالي</th>
                            </tr>
                        </thead>
                        <tbody>
                            {validProducts.map((p, i) => {
                                const q = parseFloat(p.qty) || 0;
                                const pr = parseFloat(p.price) || 0;
                                return (
                                    <tr key={i}>
                                        <td className="p-2 border border-gray-400">{p.name}</td>
                                        <td className="p-2 border border-gray-400 text-center">{q.toLocaleString()}</td>
                                        <td className="p-2 border border-gray-400 text-center">{pr.toLocaleString()}</td>
                                        <td className="p-2 border border-gray-400 text-center">{(q * pr).toLocaleString()}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot>
                            {discountValue > 0 && (
                                <>
                                    <tr className="border-t-2 border-black font-bold">
                                        <td className="p-2 border border-gray-400" colSpan={3}>الإجمالي قبل الخصم</td>
                                        <td className="p-2 border border-gray-400 text-center">{total.toLocaleString()}</td>
                                    </tr>
                                    <tr className="font-bold">
                                        <td className="p-2 border border-gray-400" colSpan={3}>الخصم</td>
                                        <td className="p-2 border border-gray-400 text-center">- {discountValue.toLocaleString()}</td>
                                    </tr>
                                </>
                            )}
                            <tr className="border-t-2 border-black font-black">
                                <td className="p-2 border border-gray-400" colSpan={3}>{discountValue > 0 ? "الصافي المطلوب" : "الإجمالي الكلي"}</td>
                                <td className="p-2 border border-gray-400 text-center">{netTotal.toLocaleString()}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        );
    }

    // ---------- Form ----------
    return (
        <div className="p-6 md:p-8 space-y-8 animate-fade-in font-ibm" dir="rtl">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <button onClick={onClose} className="p-2 bg-muted hover:bg-rose-500 hover:text-white rounded-xl transition-colors border border-border" title="رجوع إلى السجل">
                        <ArrowRight size={24} />
                    </button>
                    <div>
                        <h1 className="text-3xl font-display font-bold text-foreground mb-2 flex items-center gap-3">
                            <ShoppingCart className="text-emerald-500" size={32} />
                            {editReportId ? "تعديل بيع منتج" : "بيع منتج"}
                        </h1>
                        <p className="text-muted-foreground">بيع مباشر للعميل بدون فحص أو فني — يُسجَّل بسجل الاستقبال فقط.</p>
                    </div>
                </div>
                {branches.length > 1 && (employeeRole === "Owner" || employeeRole === "Admin" || !employeeBranchId) && (
                    <select value={selectedBranchId} onChange={(e) => setSelectedBranchId(e.target.value)} className="bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-emerald-500/50 cursor-pointer">
                        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                )}
            </div>

            <div className="max-w-3xl space-y-6">
                {/* Customer */}
                <div className="glass-card p-6 rounded-3xl border border-border space-y-4">
                    <h2 className="text-lg font-bold text-foreground">العميل (اختياري)</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">اسم العميل</label>
                            <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="عميل نقدي" className="input-field" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">رقم الهاتف</label>
                            <input type="text" inputMode="numeric" dir="ltr" value={customerPhone} onChange={(e) => setCustomerPhone(digitsOnly(e.target.value))} placeholder="—" className="input-field text-right" />
                        </div>
                        <ContractSelect className="sm:col-span-2" contracts={contracts} value={contractId} onChange={setContractId} />
                    </div>
                </div>

                {/* Products */}
                <div className="glass-card p-6 rounded-3xl border border-border space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-bold text-foreground">المنتجات</h2>
                        <button onClick={addProduct} className="flex items-center gap-1 text-emerald-500 hover:text-emerald-400 text-sm font-bold bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-lg transition-colors">
                            <Plus size={16} /> إضافة منتج
                        </button>
                    </div>

                    <datalist id="sale-product-names">
                        {productNames.map((n, i) => <option key={i} value={n} />)}
                    </datalist>

                    <div className="space-y-3">
                        {products.map((p, i) => (
                            <div key={i} className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
                                <div className="flex-1 space-y-1">
                                    {i === 0 && <label className="text-xs text-muted-foreground">المنتج</label>}
                                    <input list="sale-product-names" type="text" value={p.name} onChange={(e) => updateProduct(i, "name", e.target.value)} placeholder="اسم المنتج" className="input-field w-full" />
                                </div>
                                <div className="w-full sm:w-24 space-y-1">
                                    {i === 0 && <label className="text-xs text-muted-foreground">الكمية</label>}
                                    <input type="text" inputMode="decimal" value={withCommasDecimal(p.qty)} onChange={(e) => updateProduct(i, "qty", decimalsOnly(e.target.value))} placeholder="1" className="input-field w-full text-center" />
                                </div>
                                <div className="w-full sm:w-32 space-y-1">
                                    {i === 0 && <label className="text-xs text-muted-foreground">السعر</label>}
                                    <input type="text" inputMode="decimal" value={withCommasDecimal(p.price)} onChange={(e) => updateProduct(i, "price", decimalsOnly(e.target.value))} placeholder="0" className="input-field w-full text-center" />
                                </div>
                                <button onClick={() => removeProduct(i)} disabled={products.length === 1} className="p-2.5 bg-rose-600/10 text-rose-400 border border-rose-500/20 rounded-xl hover:bg-rose-600 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed shrink-0" title="حذف">
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        ))}
                    </div>

                    <div className="border-t border-border/50 pt-4 mt-2 space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-muted-foreground">الإجمالي قبل الخصم</span>
                            <span className="text-lg font-bold text-foreground">{total.toLocaleString()}</span>
                        </div>

                        <div className="flex items-center justify-between gap-4">
                            <label htmlFor="sale-discount" className="text-sm font-bold text-amber-400 shrink-0">الخصم (د.ع)</label>
                            <input
                                id="sale-discount"
                                type="text"
                                inputMode="numeric"
                                dir="ltr"
                                value={withCommasDecimal(discount)}
                                onChange={(e) => setDiscount(decimalsOnly(e.target.value))}
                                placeholder="0"
                                className="input-field w-40 text-center font-bold"
                            />
                        </div>
                        {(parseFloat(discount) || 0) > total && (
                            <p className="text-xs text-rose-400 text-left">الخصم أكبر من الإجمالي — سيُحتسب الخصم بقيمة الإجمالي فقط.</p>
                        )}

                        <div className="flex items-center justify-between border-t border-border/50 pt-3">
                            <span className="text-lg font-bold text-foreground">الصافي المطلوب</span>
                            <span className="text-2xl font-black text-emerald-400">{netTotal.toLocaleString()}</span>
                        </div>
                    </div>
                </div>

                <div className="flex gap-3">
                    <button onClick={handleSave} disabled={loading} className="flex-1 py-3.5 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold rounded-2xl transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 disabled:opacity-60">
                        {loading ? <><Loader2 className="animate-spin w-5 h-5" /> جاري الحفظ...</> : <><ShoppingCart size={20} /> {editReportId ? "حفظ التعديلات" : "تسجيل البيع"}</>}
                    </button>
                </div>
            </div>
        </div>
    );
}
