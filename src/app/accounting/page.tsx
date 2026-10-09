"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthProvider";
import { Wallet, TrendingUp, TrendingDown, Activity, Calendar, ArrowUpRight, ArrowDownRight, Lock } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from "recharts";

type Transaction = {
    id: string;
    date: string;
    description: string;
    amount: number;
    type: 'income' | 'expense';
    category: string;
    reference: string;
};

export default function AccountingPage() {
    // Same rule as the sidebar entry: Owner/Admin only.
    const { employeeRole, loading: authLoading } = useAuth();
    const isAdmin = employeeRole === "Owner" || employeeRole === "Admin";
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);

    const [stats, setStats] = useState({
        revenue: 0,
        expenses: 0,
        netProfit: 0,
        pending: 0
    });
    
    const [chartData, setChartData] = useState<any[]>([]);

    useEffect(() => {
        if (authLoading || !isAdmin) return;
        fetchAccountingData();
    }, [authLoading, isAdmin]);

    const fetchAccountingData = async () => {
        setLoading(true);
        // We will simulate a ledger by fetching completed Work Orders (Revenue)
        // and Inventory Value / Parts purchases (Expenses)
        
        try {
            const { data: reports } = await supabase
                .from('inspection_reports')
                .select('id, report_number, total_price, status, created_at')
                .order('created_at', { ascending: false });

            const { data: inventory } = await supabase
                .from('inventory')
                .select('name, quantity, purchase_price');

            const fakeLedger: Transaction[] = [];
            let rev = 0;
            let pendingRev = 0;
            let exp = 0;

            if (reports) {
                reports.forEach(r => {
                    const amt = Number(r.total_price || 0);
                    if (r.status === 'تم الانتهاء') {
                        rev += amt;
                        fakeLedger.push({
                            id: r.id, date: r.created_at, description: `إيراد صيانة - تقرير #${r.report_number}`,
                            amount: amt, type: 'income', category: 'صيانة', reference: r.report_number.toString()
                        });
                    } else if (r.status !== 'ملغى') {
                        pendingRev += amt;
                    }
                });
            }

            if (inventory) {
                inventory.forEach((i, idx) => {
                    const cost = (i.quantity || 0) * (i.purchase_price || 0);
                    exp += cost;
                    // Mocking inventory purchase as past expense
                    if (cost > 0) {
                        fakeLedger.push({
                            id: `inv_${idx}`, date: new Date().toISOString(), description: `شراء مخزون - ${i.name}`,
                            amount: cost, type: 'expense', category: 'مشتريات', reference: 'EXP-INV'
                        });
                    }
                });
            }

            // Sort by date desc
            fakeLedger.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

            setTransactions(fakeLedger);
            setStats({
                revenue: rev,
                expenses: exp,
                netProfit: rev - exp,
                pending: pendingRev
            });

            // Prepare chart data (Group strictly by month for demo)
            const monthly: Record<string, { income: number, expense: number }> = {};
            
            fakeLedger.forEach(t => {
                const isodate = t.date ? t.date.substring(0, 7) : 'يوم غير معروف'; // YYYY-MM
                if (!monthly[isodate]) monthly[isodate] = { income: 0, expense: 0 };
                if (t.type === 'income') monthly[isodate].income += t.amount;
                else monthly[isodate].expense += t.amount;
            });

            const cData = Object.keys(monthly).sort().map(m => ({
                name: m,
                إيرادات: monthly[m].income,
                مصروفات: monthly[m].expense,
            })).slice(-6); // last 6 months

            setChartData(cData);

        } catch(err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const formatCur = (val: number) => new Intl.NumberFormat('en-US').format(val || 0);

    if (authLoading) {
        return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" /></div>;
    }

    if (!isAdmin) {
        return (
            <div className="min-h-screen flex items-center justify-center p-6 font-ibm" dir="rtl">
                <div className="glass-card p-10 rounded-3xl border-border text-center max-w-md">
                    <Lock size={40} className="text-rose-500 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-foreground mb-2">غير مصرح</h2>
                    <p className="text-muted-foreground">النظام المحاسبي متاح فقط للمالك ومدير النظام.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen p-4 md:p-8 font-ibm" dir="rtl">
            <div className="max-w-[1400px] mx-auto space-y-8 animate-fade-in">
                
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div>
                        <h1 className="text-3xl font-display font-bold text-foreground mb-2 flex items-center gap-3">
                            <Wallet className="text-emerald-500" size={32} />
                            النظام المحاسبي (Ledger)
                        </h1>
                        <p className="text-muted-foreground">
                            نظرة عامة على الإيرادات والمصروفات وصافي الأرباح
                        </p>
                    </div>
                </div>

                {/* KPI Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div className="glass-card p-6 rounded-2xl border border-border flex flex-col justify-between">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center"><TrendingUp size={20} /></div>
                            <p className="text-muted-foreground font-bold text-sm">إجمالي الإيرادات</p>
                        </div>
                        <h3 className="text-3xl font-display font-bold text-emerald-400" dir="ltr">{formatCur(stats.revenue)}</h3>
                        <p className="text-xs text-muted-foreground mt-2">من الدخل التشغيلي</p>
                    </div>

                    <div className="glass-card p-6 rounded-2xl border-border border flex flex-col justify-between">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-lg bg-rose-500/10 text-rose-400 flex items-center justify-center"><TrendingDown size={20} /></div>
                            <p className="text-muted-foreground font-bold text-sm">إجمالي المصروفات</p>
                        </div>
                        <h3 className="text-3xl font-display font-bold text-rose-400" dir="ltr">{formatCur(stats.expenses)}</h3>
                        <p className="text-xs text-muted-foreground mt-2">تكاليف المخزون المؤرشفة</p>
                    </div>

                    <div className="glass-card p-6 rounded-2xl border border-border flex flex-col justify-between">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center"><Activity size={20} /></div>
                            <p className="text-muted-foreground font-bold text-sm">صافي الخزينة (الربح)</p>
                        </div>
                        <h3 className={`text-3xl font-display font-bold ${stats.netProfit >= 0 ? 'text-foreground' : 'text-rose-500'}`} dir="ltr">{formatCur(stats.netProfit)}</h3>
                        <p className="text-xs text-muted-foreground mt-2">{stats.netProfit >= 0 ? 'المركز المالي إيجابي' : 'عجز في السيولة'}</p>
                    </div>

                    <div className="glass-card p-6 rounded-2xl border-border border flex flex-col justify-between">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-lg bg-muted text-muted-foreground flex items-center justify-center"><Calendar size={20} /></div>
                            <p className="text-muted-foreground font-bold text-sm">المستحقات المتوقعة</p>
                        </div>
                        <h3 className="text-3xl font-display font-bold text-muted-foreground" dir="ltr">{formatCur(stats.pending)}</h3>
                        <p className="text-xs text-muted-foreground mt-2">من أوامر العمل قيد التنفيذ</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Chart */}
                    <div className="lg:col-span-2 glass-card p-6 rounded-2xl border border-border">
                        <h3 className="text-lg font-bold text-foreground mb-6">التدفق المالي (أشهر)</h3>
                        <div className="h-[300px] w-full" dir="ltr">
                            {chartData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={chartData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
                                        <XAxis dataKey="name" stroke="#666" tick={{ fill: '#888', fontSize: 12 }} />
                                        <YAxis stroke="#666" tick={{ fill: '#888', fontSize: 12 }} tickFormatter={(val) => `${val/1000}k`} />
                                        <Tooltip contentStyle={{ backgroundColor: '#111', borderColor: '#333', borderRadius: '8px' }} />
                                        <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                                        <Bar dataKey="إيرادات" fill="#10b981" radius={[4, 4, 0, 0]} barSize={30} />
                                        <Bar dataKey="مصروفات" fill="#f43f5e" radius={[4, 4, 0, 0]} barSize={30} />
                                    </BarChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">لا توجد بيانات كافية للرسم البياني</div>
                            )}
                        </div>
                    </div>

                    {/* Latest Transactions */}
                    <div className="glass-card p-6 rounded-2xl border border-border flex flex-col h-full max-h-[400px]">
                        <h3 className="text-lg font-bold text-foreground mb-4 border-b border-border pb-4">أحدث الحركات</h3>
                        <div className="flex-1 overflow-y-auto custom-scrollbar pe-2 space-y-3">
                            {loading ? (
                                <p className="text-muted-foreground text-center">جاري التحميل...</p>
                            ) : transactions.length === 0 ? (
                                <p className="text-muted-foreground text-center">لا توجد حركات مسجلة</p>
                            ) : transactions.slice(0, 15).map((t, idx) => (
                                <div key={idx} className="flex items-center justify-between p-3 bg-muted rounded-xl border border-border hover:border-muted-foreground/40 transition-colors">
                                    <div className="flex items-center gap-3">
                                        <div className={`p-2 rounded-lg ${t.type === 'income' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                                            {t.type === 'income' ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />}
                                        </div>
                                        <div>
                                            <p className="text-foreground text-sm font-bold truncate max-w-[140px] leading-tight">{t.description}</p>
                                            <p className="text-muted-foreground text-[10px] mt-0.5">{new Date(t.date).toLocaleDateString('en-GB')}</p>
                                        </div>
                                    </div>
                                    <span className={`font-mono font-bold text-sm ${t.type === 'income' ? 'text-emerald-400' : 'text-rose-400'}`} dir="ltr">
                                        {t.type === 'income' ? '+' : '-'}{formatCur(t.amount)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
