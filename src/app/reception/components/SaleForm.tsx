"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthProvider";
import { showSuccess, showError } from "@/lib/alerts";
import { digitsOnly, decimalsOnly, withCommasDecimal } from "@/lib/format";
import { useContracts } from "@/lib/contracts";
import type { Json } from "@/lib/types";
import { priceForPackage } from "@/lib/inventory";
import ContractBanner from "@/components/ContractBanner";
import { ShoppingCart, ArrowRight, Plus, Trash2, Printer, Loader2, CheckCircle2 } from "lucide-react";

type Product = { name: string; qty: string; price: string; inventory_id?: string; packageUnit?: string };
type InventoryProduct = {
    id: string; item_code: string; name: string; quantity: number; branch_id: string | null;
    sell_price: number; base_unit?: string | null; unit1?: string | null; unit2?: string | null; unit3?: string | null;
    unit1_to_unit2?: number | null; unit2_to_unit3?: number | null;
    price_unit1?: number | null; price_unit2?: number | null; price_unit3?: number | null;
};

const baseUnitFor = (item: InventoryProduct) => item.base_unit?.trim() || item.unit1?.trim() || "قطعة";
const priceForUnit = (item: InventoryProduct, unit: string): number | null => priceForPackage(item, unit);
const packagingOptionsFor = (item: InventoryProduct) =>
    [...new Set([baseUnitFor(item), item.unit1, item.unit2, item.unit3].filter((unit): unit is string => !!unit?.trim()))]
        .map(unit => ({ unit, price: priceForUnit(item, unit) }));

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringField(value: unknown, fallback = ""): string {
    return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
}

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
    const [hasLegacyManualSale, setHasLegacyManualSale] = useState(false);
    // The moment the sale was originally settled. Editing a sale must NOT re-stamp it —
    // rewriting accountedAt with "now" silently moved the sale's income to a different
    // day in the daily closing report.
    const [originalAccountedAt, setOriginalAccountedAt] = useState<string | null>(null);
    const [customerName, setCustomerName] = useState("");
    const [customerPhone, setCustomerPhone] = useState("");
    // جهة التعاقد: a sale billed to a contract is on credit — nothing is collected
    // at the counter, the amount goes onto the contract's balance instead. Only set
    // when opened from the contracts tab (?contract=<id>) or when editing such a sale.
    const contractFromUrl = searchParams.get("contract") || "";
    const [contractId, setContractId] = useState(contractFromUrl);
    const contracts = useContracts();
    const [products, setProducts] = useState<Product[]>([{ name: "", qty: "1", price: "" }]);
    const [inventoryProducts, setInventoryProducts] = useState<InventoryProduct[]>([]);
    const [discount, setDiscount] = useState("");
    const [loading, setLoading] = useState(false);
    const [done, setDone] = useState<{ id: string; number: number | null } | null>(null);

    const branchName = branches.find((b) => b.id === (selectedBranchId || employeeBranchId))?.name || "";

    useEffect(() => {
        const activeBranchId = selectedBranchId || employeeBranchId;
        if (!activeBranchId) { setInventoryProducts([]); return; }
        let cancelled = false;
        (async () => {
            const { data, error } = await supabase.from("inventory")
                .select("id,item_code,name,quantity,branch_id,sell_price,base_unit,unit1,unit2,unit3,unit1_to_unit2,unit2_to_unit3,price_unit1,price_unit2,price_unit3")
                .eq("branch_id", activeBranchId)
                .gt("quantity", 0)
                .order("name");
            if (!cancelled) {
                if (error) {
                    console.error("Failed to load warehouse products:", error);
                    setInventoryProducts([]);
                } else {
                    setInventoryProducts((data || []) as InventoryProduct[]);
                }
            }
        })();
        return () => { cancelled = true; };
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
            const selected = data.selected_services;
            const payload = asRecord(Array.isArray(selected) ? selected[0] : selected);
            if (payload) {
                setCustomerName(stringField(payload.customerName));
                setCustomerPhone(stringField(payload.customerPhone));
                const savedProducts = payload.products;
                if (Array.isArray(savedProducts) && savedProducts.length > 0) {
                    const normalizedProducts = savedProducts.map(value => {
                        const product = asRecord(value) || {};
                        return {
                            name: stringField(product.name),
                            qty: stringField(product.qty, "1"),
                            price: stringField(product.price),
                            inventory_id: stringField(product.inventory_id) || undefined,
                            packageUnit: stringField(product.packageUnit) || undefined,
                        };
                    });
                    setProducts(normalizedProducts);
                    setHasLegacyManualSale(normalizedProducts.every(product => !product.inventory_id));
                }
                const pricing = asRecord(payload.pricing) || {};
                const savedDiscount = parseFloat(stringField(pricing.discount, "0")) || 0;
                setDiscount(savedDiscount > 0 ? String(savedDiscount) : "");
                setOriginalAccountedAt(stringField(pricing.accountedAt) || null);
            }
        })();
    }, [editId, setSelectedBranchId]);

    // Only rows with a name are saved as products, so only they may count toward the total.
    const total = useMemo(
        () => products.filter((p) => p.name.trim()).reduce((s, p) => s + (parseFloat(p.qty) || 0) * (parseFloat(p.price) || 0), 0),
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

    const selectInventoryProduct = (index: number, inventoryId: string) => {
        const item = inventoryProducts.find(product => product.id === inventoryId);
        setProducts(prev => prev.map((product, i) => {
            if (i !== index) return product;
            if (!item) return { ...product, inventory_id: undefined, packageUnit: undefined };
            const unit = baseUnitFor(item);
            return { ...product, name: item.name, inventory_id: item.id, packageUnit: unit, price: String(priceForUnit(item, unit) ?? "") };
        }));
    };

    const selectPackageUnit = (index: number, inventoryId: string, unit: string) => {
        const item = inventoryProducts.find(product => product.id === inventoryId);
        if (!item) return;
        setProducts(prev => prev.map((product, i) => i === index
            ? { ...product, packageUnit: unit, price: String(priceForUnit(item, unit) ?? "") }
            : product));
    };

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
        const hasUnlinkedProducts = valid.some(p => !p.inventory_id);
        if (hasUnlinkedProducts && !(editReportId && hasLegacyManualSale)) {
            showError("اربط المواد بالمخزن", "اختر المادة من المخزن لكل سطر حتى يُخصم رصيدها حسب التعبئة المختارة.");
            return;
        }
        setLoading(true);
        try {
            const payload = [{
                is_sale: true,
                customerName: customerName.trim(),
                customerPhone: customerPhone.trim(),
                products: valid.map((p) => ({ name: p.name.trim(), qty: parseFloat(p.qty) || 1, price: parseFloat(p.price) || 0, inventory_id: p.inventory_id || null, packageUnit: p.packageUnit || null })),
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

            const inventoryLines = valid.filter((p) => p.inventory_id).map((p) => ({
                inventory_id: p.inventory_id,
                package_unit: p.packageUnit,
                quantity: parseFloat(p.qty) || 1,
            }));
            if (hasUnlinkedProducts && editReportId && hasLegacyManualSale) {
                const { error } = await supabase.from("inspection_reports").update({
                    branch_id: branchId, contract_id: contractId || null, total_price: netTotal, selected_services: payload,
                }).eq("id", editReportId);
                if (error) throw error;
                const { data } = await supabase.from("inspection_reports").select("report_number").eq("id", editReportId).single();
                setDone({ id: editReportId, number: data?.report_number ?? null });
            } else {
                const { data, error } = await supabase.rpc("save_inventory_sale", {
                    p_report_id: editReportId,
                    p_branch_id: branchId,
                    p_receptionist_id: employeeId,
                    p_contract_id: contractId || null,
                    p_total_price: netTotal,
                    p_selected_services: payload as Json,
                    p_lines: inventoryLines,
                });
                if (error) throw error;
                const saved = Array.isArray(data) ? data[0] : data;
                if (!saved?.id) throw new Error("لم يرجع النظام رقم الفاتورة بعد الحفظ.");
                setDone({ id: saved.id, number: saved.report_number ?? null });
            }
            showSuccess("تم الحفظ", "تم تسجيل البيع بنجاح.");
        } catch (err: unknown) {
            console.error(err);
            showError("خطأ", "فشل حفظ البيع: " + (err instanceof Error ? err.message : String(err)));
        } finally {
            setLoading(false);
        }
    };

    const resetForNew = () => {
        setDone(null);
        setEditReportId(null);
        setHasLegacyManualSale(false);
        setOriginalAccountedAt(null);
        setCustomerName("");
        setCustomerPhone("");
        setContractId(contractFromUrl);
        setProducts([{ name: "", qty: "1", price: "" }]);
        setDiscount("");
        router.replace(contractFromUrl ? `/reception?sale=1&contract=${contractFromUrl}` : "/reception?sale=1");
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
                                <td className="p-2 border border-gray-400">{p.name}{p.packageUnit ? ` — ${p.packageUnit}` : ""}</td>
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
                        <ContractBanner className="sm:col-span-2" label="بيع مواد" contracts={contracts} contractId={contractId} />
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

                    <div className="space-y-3">
                        {products.map((p, i) => (
                            <div key={i} className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
                                <div className="flex-1 space-y-1">
                                    {i === 0 && <label className="text-xs text-muted-foreground">المنتج</label>}
                                    <input type="text" value={p.name} onChange={(e) => updateProduct(i, "name", e.target.value)} placeholder="اختر مادة من المخزن" readOnly={!!p.inventory_id} className="input-field w-full read-only:opacity-80" />
                                    <select value={p.inventory_id || ""} onChange={(e) => selectInventoryProduct(i, e.target.value)} className="input-field w-full" aria-label="المادة المخزنية">
                                        <option value="">اختر المادة المخزنية لربطها بهذا السطر</option>
                                        {inventoryProducts.map(item => <option key={item.id} value={item.id}>{item.name} — {item.item_code} (المتاح {Number(item.quantity || 0).toLocaleString("en-US")} {baseUnitFor(item)})</option>)}
                                    </select>
                                </div>
                                <div className="w-full sm:w-36 space-y-1">
                                    {i === 0 && <label className="text-xs text-muted-foreground">التعبئة</label>}
                                    <select value={p.packageUnit || ""} disabled={!p.inventory_id} onChange={(e) => p.inventory_id && selectPackageUnit(i, p.inventory_id, e.target.value)} className="input-field w-full disabled:opacity-50">
                                        {!p.inventory_id && <option value="">اختر المادة أولاً</option>}
                                        {p.inventory_id && packagingOptionsFor(inventoryProducts.find(item => item.id === p.inventory_id)!).map(option => (
                                            <option key={option.unit} value={option.unit} disabled={option.price === null}>
                                                {option.unit}{option.price === null ? " — السعر غير محدد" : ` — ${option.price.toLocaleString("en-US")} د.ع`}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="w-full sm:w-24 space-y-1">
                                    {i === 0 && <label className="text-xs text-muted-foreground">الكمية</label>}
                                    <input type="text" inputMode="decimal" value={withCommasDecimal(p.qty)} onChange={(e) => updateProduct(i, "qty", decimalsOnly(e.target.value))} placeholder="1" className="input-field w-full text-center" />
                                </div>
                                <div className="w-full sm:w-32 space-y-1">
                                    {i === 0 && <label className="text-xs text-muted-foreground">السعر</label>}
                                    <input type="text" inputMode="decimal" value={withCommasDecimal(p.price)} onChange={(e) => updateProduct(i, "price", decimalsOnly(e.target.value))} placeholder="0" readOnly={!!p.inventory_id} className="input-field w-full text-center read-only:opacity-80" />
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
