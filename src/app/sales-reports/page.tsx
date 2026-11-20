"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, CalendarDays, Loader2, Package, TrendingDown, TrendingUp, Users, Wrench } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthProvider";

type SaleLine = { name: string; qty: number; amount: number; inventory_id?: string | null };
type Employee = { id: string; name: string; role: string; branch_id: string | null };
const money = (n: number) => `${Math.round(n).toLocaleString("en-US")} د.ع`;
const dateInput = (date: Date) => {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
};
const payloadOf = (row: any) => Array.isArray(row?.selected_services) ? row.selected_services[0] : row?.selected_services;
const isAssignedTech = (row: any, employee: Employee) => {
    if (row.technician_id === employee.id) return true;
    const payload = payloadOf(row);
    const names = [...(Array.isArray(payload?.technicians) ? payload.technicians.map((tech: any) => String(tech?.name || "")) : []), String(payload?.technicianName || "")];
    return names.some((name: string) => name.trim() && name.trim() === employee.name.trim());
};
const readProductLines = (products: any, withPrices: boolean): SaleLine[] => Array.isArray(products) ? products.map((p: any) => ({
    name: String(p?.name || "مادة بدون اسم").trim(),
    qty: Number(p?.qty ?? p?.quantity ?? 0) || 0,
    amount: withPrices ? (Number(p?.qty ?? p?.quantity ?? 0) || 0) * (Number(p?.price ?? p?.unit_price ?? 0) || 0) : 0,
    inventory_id: p?.inventory_id || null,
})).filter(p => p.qty > 0) : [];

export default function SalesReportsPage() {
    const { employeeRole, employeeBranchId, allowedPages, permissionInventoryPrices, loading: authLoading } = useAuth();
    const isAdmin = employeeRole === "Owner" || employeeRole === "Admin";
    const canSeePrices = isAdmin || !!permissionInventoryPrices;
    const authorized = isAdmin || employeeRole === "Supervisor" || !!allowedPages?.includes("sales-reports");
    const [from, setFrom] = useState(() => dateInput(new Date(Date.now() - 29 * 86400000)));
    const [to, setTo] = useState(() => dateInput(new Date()));
    const [branch, setBranch] = useState("");
    const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
    const [orders, setOrders] = useState<any[]>([]);
    const [posSales, setPosSales] = useState<any[]>([]);
    const [inventory, setInventory] = useState<any[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [complaints, setComplaints] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!authorized) return;
        supabase.from("branches").select("id,name").order("name").then(({ data }) => setBranches((data || []) as any));
        supabase.from("employees").select("id,name,role,branch_id").order("name").then(({ data }) => setEmployees((data || []) as Employee[]));
    }, [authorized]);

    const fetchReport = useCallback(async () => {
        if (!authorized || !from || !to) return;
        setLoading(true); setError("");
        const start = new Date(`${from}T00:00:00+03:00`).toISOString();
        const end = new Date(`${to}T23:59:59.999+03:00`).toISOString();
        try {
            let orderQuery = supabase.from("inspection_reports")
                .select(`id,report_number,order_type,status,${canSeePrices ? "total_price," : ""}created_at,completed_at,branch_id,receptionist_id,technician_id,selected_services`)
                .gte("created_at", start).lte("created_at", end).order("created_at", { ascending: false });
            const chosenBranch = isAdmin ? branch : employeeBranchId;
            if (chosenBranch) orderQuery = orderQuery.eq("branch_id", chosenBranch);
            const [{ data: orderData, error: orderError }, { data: posData, error: posError }, { data: stockData, error: stockError }, { data: complaintData }] = await Promise.all([
                orderQuery,
                supabase.from("pos_sales").select(`id,${canSeePrices ? "total_amount," : ""}items,created_at`).gte("created_at", start).lte("created_at", end).order("created_at", { ascending: false }),
                (() => { let q = supabase.from("inventory").select(`id,branch_id,name,item_code,quantity,min_quantity${canSeePrices ? ",purchase_price,sell_price" : ""}`); if (chosenBranch) q = q.eq("branch_id", chosenBranch); return q; })(),
                (supabase as any).from("service_complaints").select("id,employee_id,status").gte("received_at", start).lte("received_at", end),
            ]);
            if (orderError) throw orderError;
            if (posError) throw posError;
            if (stockError) throw stockError;
            setOrders(orderData || []); setPosSales(posData || []); setInventory(stockData || []); setComplaints(complaintData || []);
        } catch (e: any) {
            setError(e?.message || "تعذر تحميل بيانات المبيعات. تأكد من تطبيق ترحيل ملف الموظفين والشكاوى.");
            setOrders([]); setPosSales([]); setInventory([]); setComplaints([]);
        } finally { setLoading(false); }
    }, [authorized, from, to, branch, employeeBranchId, isAdmin, canSeePrices]);

    useEffect(() => { fetchReport(); }, [fetchReport]);

    const analysis = useMemo(() => {
        const products = new Map<string, SaleLine & { key: string; count: number }>();
        const addLines = (lines: SaleLine[]) => lines.forEach(line => {
            const key = line.inventory_id || line.name.toLocaleLowerCase().trim();
            const current = products.get(key) || { ...line, key, qty: 0, amount: 0, count: 0 };
            current.qty += line.qty; current.amount += line.amount; current.count += 1; products.set(key, current);
        });
        const salesOrders = orders.filter(o => o.order_type === "sale");
        for (const row of salesOrders) addLines(readProductLines(payloadOf(row)?.products, canSeePrices));
        for (const row of posSales) addLines(readProductLines(row.items, canSeePrices));
        const productList = [...products.values()].sort((a, b) => b.qty - a.qty);
        const completedOrders = orders.filter(o => o.order_type !== "sale" && o.status === "تم الانتهاء");
        const maintenanceRevenue = canSeePrices ? completedOrders.reduce((sum, o) => sum + Number(o.total_price || 0), 0) : 0;
        const productRevenue = canSeePrices ? salesOrders.reduce((sum, o) => sum + Number(o.total_price || 0), 0) + posSales.reduce((sum, o) => sum + Number(o.total_amount || 0), 0) : 0;
        const byEmployee = employees.map(employee => {
            const received = orders.filter(o => o.receptionist_id === employee.id && o.order_type !== "sale");
            const assigned = completedOrders.filter(o => isAssignedTech(o, employee));
            return { ...employee, received: received.length, completed: assigned.length, revenue: canSeePrices ? assigned.reduce((sum, o) => sum + Number(o.total_price || 0), 0) : 0, complaints: complaints.filter(c => c.employee_id === employee.id).length };
        }).filter(e => e.received || e.completed || e.complaints).sort((a, b) => b.completed - a.completed || b.received - a.received);
        const soldKeys = new Set(productList.map(p => p.key));
        const dormant = inventory.filter(item => Number(item.quantity || 0) > 0 && !soldKeys.has(item.id) && !soldKeys.has(String(item.name || "").toLocaleLowerCase().trim()));
        return { productList, completedOrders, maintenanceRevenue, productRevenue, byEmployee, dormant, salesOrders };
    }, [orders, posSales, inventory, employees, complaints, canSeePrices]);

    if (authLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;
    if (!authorized) return <div className="min-h-screen flex items-center justify-center p-6" dir="rtl"><div className="glass-card p-8 rounded-2xl text-center"><h1 className="text-xl font-bold">غير مصرح بالوصول</h1><p className="text-muted-foreground mt-2">لا تملك صلاحية تقارير المبيعات.</p></div></div>;

    return <main className="min-h-screen p-5 md:p-8 font-ibm" dir="rtl"><div className="max-w-7xl mx-auto space-y-6">
        <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-border pb-5">
            <div><h1 className="text-3xl font-bold flex items-center gap-3"><BarChart3 className="text-emerald-400" />تقارير المبيعات وتحليل الأداء</h1><p className="text-muted-foreground mt-2">مبيعات الورشة ونقطة البيع، المواد المطلوبة والراكدة، وأداء الموظفين المرتبط بأوامر العمل والـCRM.</p></div>
            <div className="flex flex-wrap gap-2 items-end"><label className="text-xs text-muted-foreground">من<input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input-field block mt-1" /></label><label className="text-xs text-muted-foreground">إلى<input type="date" value={to} onChange={e => setTo(e.target.value)} className="input-field block mt-1" /></label>{isAdmin && <label className="text-xs text-muted-foreground">الفرع<select value={branch} onChange={e => setBranch(e.target.value)} className="input-field block mt-1"><option value="">كل الفروع</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}</div>
        </header>
        {error && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-200 text-sm">{error}<button onClick={fetchReport} className="underline mr-3">إعادة المحاولة</button></div>}
        {loading ? <div className="glass-card p-12 rounded-2xl text-center"><Loader2 className="animate-spin inline ml-2" />جاري تحليل المبيعات والمخزون...</div> : <>
            <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                {canSeePrices && <Kpi title="إيراد أوامر الصيانة المكتملة" value={money(analysis.maintenanceRevenue)} icon={<Wrench size={20} />} />}
                {canSeePrices && <Kpi title="إيراد مبيعات المواد" value={money(analysis.productRevenue)} icon={<TrendingUp size={20} />} />}
                <Kpi title="سيارات مكتملة" value={analysis.completedOrders.length.toLocaleString("en-US")} icon={<CalendarDays size={20} />} />
                <Kpi title="مواد راكدة بلا بيع مسجل" value={analysis.dormant.length.toLocaleString("en-US")} icon={<TrendingDown size={20} />} />
            </section>
            <section className="grid xl:grid-cols-2 gap-5">
                <div className="glass-card rounded-2xl overflow-hidden"><div className="p-5 border-b border-border"><h2 className="font-bold text-lg flex gap-2 items-center"><Package className="text-emerald-400" />الأكثر مبيعًا</h2><p className="text-xs text-muted-foreground mt-1">حسب الكمية من أوامر بيع المنتجات ونقطة البيع ضمن الفترة المحددة.</p></div><ProductTable rows={analysis.productList.slice(0, 10)} showPrices={canSeePrices} /></div>
                <div className="glass-card rounded-2xl overflow-hidden"><div className="p-5 border-b border-border"><h2 className="font-bold text-lg flex gap-2 items-center"><TrendingDown className="text-amber-400" />الأقل مبيعًا من المواد المباعة</h2><p className="text-xs text-muted-foreground mt-1">المواد ذات أقل كميات بيع مسجلة؛ لا تشمل المواد بلا حركة.</p></div><ProductTable rows={[...analysis.productList].sort((a, b) => a.qty - b.qty).slice(0, 10)} showPrices={canSeePrices} /></div>
            </section>
            <section className="glass-card rounded-2xl overflow-hidden"><div className="p-5 border-b border-border"><h2 className="font-bold text-lg">المواد الراكدة</h2><p className="text-xs text-muted-foreground mt-1">رصيد متوفر لم يظهر في سجلات بيع المنتجات خلال الفترة المختارة. تطابق المادة بمعرف المخزن أو الاسم.</p></div><div className="overflow-auto"><table className="w-full min-w-[650px] text-sm text-right"><thead className="bg-muted/40 text-muted-foreground"><tr>{["المادة", "الكود", "الرصيد", "حد التنبيه", ...(canSeePrices ? ["تكلفة الرصيد"] : [])].map(h => <th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{analysis.dormant.slice(0, 30).map(item => <tr key={item.id} className="border-t border-border"><td className="p-3 font-bold">{item.name}</td><td className="p-3 font-mono">{item.item_code || "—"}</td><td className="p-3">{Number(item.quantity).toLocaleString("en-US")}</td><td className="p-3">{Number(item.min_quantity || 0).toLocaleString("en-US")}</td>{canSeePrices && <td className="p-3">{money(Number(item.purchase_price || 0) * Number(item.quantity || 0))}</td>}</tr>)}{analysis.dormant.length === 0 && <tr><td className="p-8 text-center text-muted-foreground" colSpan={canSeePrices ? 5 : 4}>لا توجد مواد راكدة حسب الفترة.</td></tr>}</tbody></table></div></section>
            <section className="glass-card rounded-2xl overflow-hidden"><div className="p-5 border-b border-border"><h2 className="font-bold text-lg flex gap-2 items-center"><Users className="text-cyan-400" />أداء الموظفين</h2><p className="text-xs text-muted-foreground mt-1">الاستقبال حسب الموظف المسجل في أمر العمل، والفني حسب الفني المعيّن عند بدء التنفيذ.</p></div><div className="overflow-auto"><table className="w-full min-w-[760px] text-sm text-right"><thead className="bg-muted/40 text-muted-foreground"><tr>{["الموظف", "الدور", "سيارات مستلمة", "أعمال مكتملة", ...(canSeePrices ? ["قيمة الأعمال المكتملة"] : []), "شكاوى الخدمة"].map(h => <th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{analysis.byEmployee.map(employee => <tr key={employee.id} className="border-t border-border hover:bg-muted/20"><td className="p-3"><Link href={`/employees/${employee.id}`} className="font-bold text-cyan-400 hover:underline">{employee.name}</Link></td><td className="p-3">{employee.role === "Receptionist" ? "استقبال" : employee.role === "Supervisor" ? "فني / مشرف" : employee.role}</td><td className="p-3">{employee.received.toLocaleString("en-US")}</td><td className="p-3">{employee.completed.toLocaleString("en-US")}</td>{canSeePrices && <td className="p-3">{money(employee.revenue)}</td>}<td className="p-3">{employee.complaints.toLocaleString("en-US")}</td></tr>)}{analysis.byEmployee.length === 0 && <tr><td className="p-8 text-center text-muted-foreground" colSpan={canSeePrices ? 6 : 5}>لا توجد حركات موظفين في الفترة المحددة.</td></tr>}</tbody></table></div></section>
            <p className="text-xs text-muted-foreground">مصادر المبيعات: أوامر المنتجات من الاستقبال ونقطة البيع. قد تكون مبيعات نقطة البيع غير مرتبطة بفرع أو حساب موظف وفق البيانات الحالية.</p>
        </>}
    </div></main>;
}

function Kpi({ title, value, icon }: { title: string; value: string; icon: React.ReactNode }) { return <div className="glass-card rounded-2xl p-5"><div className="flex justify-between text-muted-foreground text-sm"><span>{title}</span>{icon}</div><div className="font-bold text-2xl mt-3">{value}</div></div>; }
function ProductTable({ rows, showPrices }: { rows: (SaleLine & { key: string; count: number })[]; showPrices: boolean }) { return <div className="overflow-auto"><table className="w-full min-w-[440px] text-sm text-right"><thead className="bg-muted/40 text-muted-foreground"><tr><th className="p-3">المنتج</th><th className="p-3">الكمية المباعة</th>{showPrices && <th className="p-3">مجموع البيع</th>}</tr></thead><tbody>{rows.map((row, i) => <tr key={row.key} className="border-t border-border"><td className="p-3"><span className="text-muted-foreground ml-2">{i + 1}.</span>{row.name}</td><td className="p-3 font-bold">{row.qty.toLocaleString("en-US")}</td>{showPrices && <td className="p-3">{money(row.amount)}</td>}</tr>)}{rows.length === 0 && <tr><td colSpan={showPrices ? 3 : 2} className="p-7 text-center text-muted-foreground">لا توجد منتجات مباعة خلال الفترة.</td></tr>}</tbody></table></div>; }
