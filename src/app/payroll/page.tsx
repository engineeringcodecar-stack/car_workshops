"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { DollarSign, CheckCircle, AlertCircle, Save, Edit2, X, TrendingUp } from "lucide-react";
import { showError, showSuccess } from "@/lib/alerts";
import { useAuth } from "@/lib/AuthProvider";

type PayrollRecord = {
    emp_id: string;
    name: string;
    role: string;
    base_salary: number;
    absences: number;
    bonus: number;
    total: number;
    status: 'pending' | 'paid';
    record_id?: number | null; 
};

export default function PayrollPage() {
    const { employeeBranchId, employeeRole } = useAuth();
    const [records, setRecords] = useState<PayrollRecord[]>([]);
    const [loading, setLoading] = useState(true);
    // YYYY-MM in Baghdad time — UTC put the first hours of a new month (00:00–03:00) in the old one.
    const [month] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Baghdad' }).substring(0, 7));

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingRecord, setEditingRecord] = useState<PayrollRecord | null>(null);
    const [formBase, setFormBase] = useState(0);
    const [formAbsences, setFormAbsences] = useState(0);
    const [formBonus, setFormBonus] = useState(0);

    useEffect(() => {
        fetchPayroll();
    }, []);

    const fetchPayroll = async () => {
        setLoading(true);
        try {
            // Fetch employees
            let query = supabase.from('employees').select('id, name, role, branch_id');
            if (employeeBranchId) {
                query = query.eq('branch_id', employeeBranchId);
            }
            const { data: employeesData } = await query;
            
            // Fetch existing records for this month
            const { data: payrollData } = await supabase.from('payroll_records' as any).select('*').eq('salary_month', month);
            
            if (employeesData) {
                const merged: PayrollRecord[] = employeesData.map((emp) => {
                    const base = emp.role === 'Admin' ? 2000000 : emp.role === 'Supervisor' ? 1200000 : 750000;
                    const existing = (payrollData as any[])?.find((p: any) => p.emp_id === emp.id);

                    return {
                        emp_id: emp.id,
                        name: emp.name,
                        role: emp.role,
                        base_salary: existing ? parseFloat(existing.base_salary) : base,
                        absences: existing ? existing.absences_days : 0,
                        bonus: existing ? parseFloat(existing.bonus_amount) : 0,
                        total: 0, 
                        status: existing ? (existing.status as 'pending'|'paid') : 'pending',
                        record_id: existing ? existing.id : null
                    };
                });

                // Calculate totals
                merged.forEach(rec => {
                    const dailyRate = rec.base_salary / 30;
                    rec.total = rec.base_salary - (rec.absences * dailyRate) + rec.bonus;
                    if(rec.total < 0) rec.total = 0;
                });

                setRecords(merged);
            }
        } catch {
            showError("خطأ", "حدث خطأ أثناء تحميل بيانات الرواتب.");
        } finally {
            setLoading(false);
        }
    };

    const openEditModal = (rec: PayrollRecord) => {
        if (rec.status === 'paid') {
            showError("تنبيه", "لا يمكن تعديل الراتب بعد صرفه!");
            return;
        }
        setEditingRecord(rec);
        setFormBase(rec.base_salary);
        setFormAbsences(rec.absences);
        setFormBonus(rec.bonus);
        setIsModalOpen(true);
    };

    const handleSavePayroll = async (e: React.FormEvent) => {
        e.preventDefault();
        if(!editingRecord) return;

        // Upsert to database as 'pending' to save the values
        const { data, error } = await supabase.from('payroll_records' as any).upsert({
            id: editingRecord.record_id || undefined,
            emp_id: editingRecord.emp_id,
            salary_month: month,
            base_salary: formBase,
            absences_days: formAbsences,
            bonus_amount: formBonus,
            status: 'pending'
        }, { onConflict: 'emp_id, salary_month' }).select().single();

        if (!error && (data as any)) {
            setIsModalOpen(false);
            showSuccess("تم", "تم حفظ التعديلات بنجاح.");
            fetchPayroll(); // Refresh math visually
        } else {
            console.error("Failed to update payroll logic:", error);
            showError("خطأ", "فشل في حفظ التعديلات.");
        }
    };

    const handlePay = async (rec: PayrollRecord) => {
        // Mark as paid in Database
        const { data, error } = await supabase.from('payroll_records' as any).upsert({
            id: rec.record_id || undefined,
            emp_id: rec.emp_id,
            salary_month: month,
            base_salary: rec.base_salary,
            absences_days: rec.absences,
            bonus_amount: rec.bonus,
            status: 'paid'
        }, { onConflict: 'emp_id, salary_month' }).select().single();

        if (!error && (data as any)) {
            setRecords(prev => prev.map(r => r.emp_id === rec.emp_id ? { ...r, status: 'paid', record_id: (data as any).id } : r));
        } else {
            console.error("Failed to pay:", error);
            alert("خطأ أثناء محاولة صرف الراتب!");
        }
    };

    const formatCur = (val: number) => new Intl.NumberFormat('en-US').format(Math.floor(val));

    // Dynamic math for Modal
    const previewDeduction = (formBase / 30) * Math.max(0, formAbsences);
    const previewTotal = Math.max(0, formBase - previewDeduction + formBonus);

    return (
        <div className="min-h-screen p-4 md:p-8 font-ibm" dir="rtl">
            <div className="max-w-7xl mx-auto space-y-8 animate-fade-in">
                
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div>
                        <h1 className="text-3xl font-display font-bold text-foreground mb-2 flex items-center gap-3">
                            <DollarSign className="text-emerald-500" size={32} />
                            الرواتب والأجور (Payroll)
                        </h1>
                        <p className="text-muted-foreground">
                            إدارة رواتب الموظفين، الخصومات المتعلقة بالغياب والمكافآت.
                        </p>
                    </div>
                    <div className="flex bg-card border border-border rounded-xl p-2 items-center gap-4 shadow-sm">
                        <span className="text-sm font-bold text-muted-foreground mr-2">دورة الرواتب:</span>
                        <div className="font-mono font-bold text-xl text-emerald-500 tracking-wider bg-emerald-500/10 px-4 py-1 rounded-lg" dir="ltr">{month}</div>
                    </div>
                </div>

                {/* Dashboard Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="glass-card p-6 rounded-2xl border-border flex items-center justify-between">
                        <div>
                            <p className="text-sm font-bold text-muted-foreground mb-1">إجمالي رواتب الشهر للجميع</p>
                            <span className="text-2xl font-bold font-mono text-foreground tracking-widest">{formatCur(records.reduce((a, b) => a + b.total, 0))} <span className="text-sm text-muted-foreground">د.ع</span></span>
                        </div>
                        <div className="w-12 h-12 bg-blue-500/10 text-blue-500 rounded-xl flex items-center justify-center">
                            <DollarSign size={24} />
                        </div>
                    </div>
                    
                    <div className="glass-card p-6 rounded-2xl border-border flex items-center justify-between">
                        <div>
                            <p className="text-sm font-bold text-muted-foreground mb-1">إجمالي الخصومات المؤكدة</p>
                            <span className="text-2xl font-bold font-mono text-rose-500 tracking-widest">{formatCur(records.reduce((a, b) => a + (b.absences * (b.base_salary/30)), 0))} <span className="text-sm text-muted-foreground">د.ع</span></span>
                        </div>
                        <div className="w-12 h-12 bg-rose-500/10 text-rose-500 rounded-xl flex items-center justify-center">
                            <AlertCircle size={24} />
                        </div>
                    </div>

                    <div className="glass-card p-6 rounded-2xl border-border flex items-center justify-between">
                        <div>
                            <p className="text-sm font-bold text-muted-foreground mb-1">المنح والمكافآت (Bonuses)</p>
                            <span className="text-2xl font-bold font-mono text-emerald-500 tracking-widest">{formatCur(records.reduce((a, b) => a + b.bonus, 0))} <span className="text-sm text-muted-foreground">د.ع</span></span>
                        </div>
                        <div className="w-12 h-12 bg-emerald-500/10 text-emerald-500 rounded-xl flex items-center justify-center">
                            <TrendingUp className="text-emerald-500" size={24} />
                        </div>
                    </div>
                </div>

                {/* Table */}
                <div className="glass-card rounded-2xl border-border overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-right text-sm">
                            <thead className="bg-muted border-b border-border">
                                <tr>
                                    <th className="p-4 text-muted-foreground font-bold">الموظف</th>
                                    <th className="p-4 text-muted-foreground font-bold text-center">أيام الغياب</th>
                                    <th className="p-4 text-muted-foreground font-bold">الراتب الأساسي</th>
                                    <th className="p-4 text-muted-foreground font-bold text-center">مكافآت</th>
                                    <th className="p-4 text-muted-foreground font-bold">المستحق للصرف (Net)</th>
                                    <th className="p-4 text-muted-foreground font-bold text-center">الإجراءات والتحكم</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {loading ? (
                                    <tr><td colSpan={6} className="text-center p-8 text-muted-foreground">جاري مسح السجلات...</td></tr>
                                ) : records.length === 0 ? (
                                    <tr><td colSpan={6} className="text-center p-8 text-muted-foreground font-bold">تأكد من إضافة موظفين في قسم (HR) أولاً!</td></tr>
                                ) : (
                                    records.map(rec => (
                                        <tr key={rec.emp_id} className="hover:bg-muted/30 transition-colors">
                                            <td className="p-4">
                                                <div className="font-bold text-foreground mb-1">{rec.name}</div>
                                                <div className="text-xs text-muted-foreground">{rec.role === 'Admin' ? 'المدير' : rec.role === 'Supervisor' ? 'مشرف فني' : 'استقبال'}</div>
                                            </td>
                                            <td className="p-4 text-center">
                                                <span className={`px-3 py-1 rounded-full inline-flex items-center gap-1 font-mono font-bold text-xs ${rec.absences > 0 ? 'bg-rose-500/10 border border-rose-500/30 text-rose-500' : 'bg-muted text-muted-foreground border border-border'}`}>
                                                    {rec.absences} أيام
                                                </span>
                                            </td>
                                            <td className="p-4 font-mono font-medium text-muted-foreground">{formatCur(rec.base_salary)}</td>
                                            <td className="p-4 text-center text-emerald-500 font-mono font-bold text-xs">
                                                {rec.bonus > 0 ? '+'+formatCur(rec.bonus) : '-'}
                                            </td>
                                            <td className="p-4 font-mono font-bold text-foreground text-lg">{formatCur(rec.total)}</td>
                                            <td className="p-4 text-center">
                                                {rec.status === 'paid' ? (
                                                    <span className="inline-flex items-center justify-center gap-1 w-full max-w-[140px] text-emerald-500 bg-emerald-500/10 px-3 py-2 rounded-xl text-xs font-bold border border-emerald-500/20">
                                                        <CheckCircle size={16} /> تم الصرف للحساب
                                                    </span>
                                                ) : (
                                                    <div className="flex gap-2 justify-center">
                                                        <button onClick={() => openEditModal(rec)} className="p-2 bg-muted hover:bg-emerald-600 hover:text-white border border-border text-muted-foreground rounded-xl transition-colors shadow-sm" title="تعديل الراتب والغياب">
                                                            <Edit2 size={16} />
                                                        </button>
                                                        <button onClick={() => handlePay(rec)} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-colors text-xs shadow-lg shadow-emerald-500/20 flex-1 max-w-[100px]">
                                                            صرف الراتب
                                                        </button>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>

            {/* Editing Payroll Logic Modal */}
            {isModalOpen && editingRecord && (
                <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-card border border-border mt-10 rounded-2xl w-full max-w-lg shadow-2xl relative animate-in fade-in zoom-in duration-200">
                        <div className="p-6 border-b border-border flex justify-between items-center bg-muted/50 rounded-t-2xl">
                            <h2 className="text-xl font-bold text-foreground">تعديل رواتب {editingRecord.name}</h2>
                            <button onClick={() => setIsModalOpen(false)} className="text-muted-foreground hover:text-foreground hover:bg-background p-1 rounded-md transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        
                        <form onSubmit={handleSavePayroll} className="p-6 space-y-5">
                            <div>
                                <label className="block text-sm font-bold text-muted-foreground mb-2">الراتب الأساسي (Base Salary)</label>
                                <input required type="number" value={formBase} onChange={e => setFormBase(Number(e.target.value))} className="w-full bg-muted border border-border rounded-xl p-3 text-foreground focus:border-emerald-500 focus:outline-none focus:bg-background transition-colors font-mono" />
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-bold text-muted-foreground mb-2">عدد أيام الغياب <span className="text-rose-500 shrink-0 text-xs">(تُخصم تلقائياً)</span></label>
                                    <input type="number" min="0" max="31" value={formAbsences} onChange={e => setFormAbsences(Number(e.target.value))} className="w-full bg-rose-500/5 text-rose-500 border border-rose-500/30 rounded-xl p-3 focus:border-rose-500 focus:outline-none transition-colors font-mono font-bold" />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-muted-foreground mb-2">منح اضافية (Bonus)</label>
                                    <input type="number" min="0" value={formBonus} onChange={e => setFormBonus(Number(e.target.value))} className="w-full bg-emerald-500/5 text-emerald-500 border border-emerald-500/30 rounded-xl p-3 focus:border-emerald-500 focus:outline-none transition-colors font-mono font-bold" />
                                </div>
                            </div>

                            {/* Mathematical Live Preview */}
                            <div className="bg-background border border-border p-4 rounded-xl mt-4">
                                <h4 className="text-xs font-bold text-muted-foreground uppercase mb-3">حسابية الراتب المبدئية لهذا الشهر</h4>
                                <div className="space-y-2 font-mono text-sm">
                                    <div className="flex justify-between text-muted-foreground"><span>الأساسي (Base):</span> <span>{formatCur(formBase)} د.ع</span></div>
                                    <div className="flex justify-between text-rose-500 font-medium"><span>عقوبة أيام الغياب ({formAbsences}):</span> <span>- {formatCur(previewDeduction)} د.ع</span></div>
                                    <div className="flex justify-between text-emerald-500 font-medium"><span>المكافآت (Bonus):</span> <span>+ {formatCur(formBonus)} د.ع</span></div>
                                    <div className="border-t border-border pt-2 flex justify-between text-foreground font-bold text-lg mt-2">
                                        <span>الصافي للصرف (Net):</span> 
                                        <span>{formatCur(previewTotal)} د.ع</span>
                                    </div>
                                </div>
                            </div>

                            <div className="pt-2 flex gap-3">
                                <button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-3 rounded-xl font-bold transition-colors flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20">
                                    <Save size={18} /> حفظ المعادلة برصيد الشهر
                                </button>
                                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 bg-muted hover:bg-muted/70 border border-border text-foreground py-3 rounded-xl font-bold transition-colors">
                                    تجاهل
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
