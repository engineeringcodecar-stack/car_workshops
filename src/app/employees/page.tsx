"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Users, Search, Plus, Mail, Phone, Calendar as CalIcon, Shield, Trash2, Edit2, X } from "lucide-react";
import { showConfirm, showError, showSuccess } from "@/lib/alerts";

export default function EmployeesPage() {
    const [employees, setEmployees] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");

    // Modal States
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingEmp, setEditingEmp] = useState<any | null>(null);
    
    // Form States
    const [formName, setFormName] = useState("");
    const [formPhone, setFormPhone] = useState("");
    const [formRole, setFormRole] = useState("Receptionist");

    useEffect(() => {
        fetchEmployees();
    }, []);

    const fetchEmployees = async () => {
        setLoading(true);
        const { data } = await supabase.from('employees').select('*').order('created_at', { ascending: false });
        if (data) setEmployees(data);
        setLoading(false);
    };

    const openModal = (emp?: any) => {
        if (emp) {
            setEditingEmp(emp);
            setFormName(emp.name || "");
            setFormPhone(emp.phone || "");
            setFormRole(emp.role || "Receptionist");
        } else {
            setEditingEmp(null);
            setFormName("");
            setFormPhone("");
            setFormRole("Receptionist");
        }
        setIsModalOpen(true);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        
        const payload: any = {
            name: formName,
            phone: formPhone,
            role: formRole
        };

        if (editingEmp) {
            await supabase.from('employees').update(payload).eq('id', editingEmp.id);
        } else {
            await supabase.from('employees').insert([{ ...payload }]);
        }

        setIsModalOpen(false);
        fetchEmployees();
    };

    const handleDelete = async (id: string, name: string) => {
        const isConfirmed = await showConfirm(
            "حذف موظف",
            `هل أنت متأكد من حذف الموظف ${name}؟ لا يمكن التراجع عن هذا الإجراء.`,
            "نعم، احذف",
            true
        );
        if (isConfirmed) {
            const { error } = await supabase.from('employees').delete().eq('id', id);
            if (!error) {
                showSuccess("تم الحذف", "تم حذف الموظف بنجاح");
                fetchEmployees();
            } else {
                showError("خطأ", "حدث خطأ أثناء الحذف");
            }
        }
    };

    const filtered = employees.filter(e => e.name.includes(searchTerm) || (e.phone && e.phone.includes(searchTerm)));

    return (
        <div className="min-h-screen p-4 md:p-8 font-ibm" dir="rtl">
            <div className="max-w-7xl mx-auto space-y-8 animate-fade-in">
                
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div>
                        <h1 className="text-3xl font-display font-bold text-foreground mb-2 flex items-center gap-3">
                            <Users className="text-rose-500" size={32} />
                            إدارة الموظفين (HR)
                        </h1>
                        <p className="text-muted-foreground">
                            استعراض طاقم العمل، الصلاحيات، وإضافة موظفين جدد
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="relative w-full md:w-64">
                            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                            <input
                                type="text"
                                placeholder="بحث عن موظف..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="w-full bg-card border border-border rounded-xl py-2.5 pr-10 pl-4 text-foreground focus:outline-none focus:border-rose-500 transition-colors"
                            />
                        </div>
                        <button onClick={() => openModal()} className="shrink-0 px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl transition-colors flex items-center gap-2 shadow-lg shadow-rose-500/20 whitespace-nowrap">
                            <Plus size={18} /> موظف جديد
                        </button>
                    </div>
                </div>

                {/* Grid */}
                {loading ? (
                    <div className="flex justify-center p-20"><div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" /></div>
                ) : filtered.length === 0 ? (
                    <div className="glass-card p-12 text-center text-muted-foreground rounded-2xl border-border">
                        لا يوجد موظفين يطابقون بحثك.
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filtered.map(emp => (
                            <div key={emp.id} className="glass-card p-6 rounded-2xl border-border relative group overflow-hidden transition-all hover:border-rose-500/30">
                                <div className="absolute top-4 left-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => openModal(emp)} className="p-2 bg-muted hover:bg-blue-600 hover:text-white rounded-lg text-muted-foreground transition-colors"><Edit2 size={16} /></button>
                                    <button onClick={() => handleDelete(emp.id, emp.name)} className="p-2 bg-muted hover:bg-rose-600 hover:text-white rounded-lg text-muted-foreground transition-colors"><Trash2 size={16} /></button>
                                </div>
                                <div className="flex items-center gap-4 mb-6 mt-2">
                                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-rose-600 to-red-900 border-2 border-border flex items-center justify-center text-xl font-bold text-white shadow-lg shadow-rose-500/20">
                                        {emp.name.substring(0, 2)}
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold text-foreground mb-1">{emp.name}</h3>
                                        <span className={`text-xs px-2 py-1 rounded inline-flex items-center gap-1 ${
                                            emp.role === 'Admin' || emp.role === 'Owner' ? 'bg-rose-500/20 text-rose-500' :
                                            emp.role === 'Supervisor' ? 'bg-blue-500/20 text-blue-500' :
                                            'bg-muted text-muted-foreground'
                                        }`}>
                                            <Shield size={12} /> {emp.role === 'Admin' ? 'مدير عام' : emp.role === 'BranchManager' ? 'مدير فرع' : emp.role === 'Supervisor' ? 'مشرف شفت' : emp.role === 'Technician' ? 'فني' : 'استقبال ومبيعات'}
                                        </span>
                                    </div>
                                </div>

                                <div className="space-y-3 text-sm text-muted-foreground">
                                    <div className="flex items-center gap-3">
                                        <Mail size={16} className="text-muted-foreground" />
                                        <span className="font-mono" dir="ltr">- محدد بالصلاحيات -</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <Phone size={16} className="text-muted-foreground" />
                                        <span className="font-mono" dir="ltr">{emp.phone || "لا يوجد رقم مسجل"}</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <CalIcon size={16} className="text-muted-foreground" />
                                        <span>تاريخ الانضمام: {new Date(emp.created_at).toLocaleDateString('en-GB')}</span>
                                    </div>
                                </div>
                                
                                <div className="mt-6 pt-4 border-t border-border flex justify-between items-center">
                                    <span className="text-xs text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20">نشط حالياً</span>
                                    <span className="text-xs text-muted-foreground font-mono">ID: {emp.id.substring(0,6)}...</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl relative animate-in fade-in zoom-in duration-200">
                        <div className="p-6 border-b border-border flex justify-between items-center bg-muted/50 rounded-t-2xl">
                            <h2 className="text-xl font-bold text-foreground">{editingEmp ? 'تعديل بيانات الموظف' : 'إضافة موظف جديد'}</h2>
                            <button onClick={() => setIsModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                                <X size={20} />
                            </button>
                        </div>
                        
                        <form onSubmit={handleSave} className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-muted-foreground mb-2">اسم الموظف الثلاثي <span className="text-rose-500">*</span></label>
                                <input required value={formName} onChange={e => setFormName(e.target.value)} type="text" className="w-full bg-muted border border-border rounded-xl p-3 text-foreground focus:border-rose-500 focus:outline-none transition-colors" placeholder="محمد صالح العبدالله" />
                            </div>
                            
                            <div>
                                <label className="block text-sm font-bold text-muted-foreground mb-2">رقم الهاتف (للتواصل الداخلي)</label>
                                <input value={formPhone} onChange={e => setFormPhone(e.target.value)} type="tel" className="w-full bg-muted border border-border rounded-xl p-3 text-foreground focus:border-rose-500 focus:outline-none transition-colors font-mono" placeholder="07XXXXXXXXX" dir="ltr" />
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-muted-foreground mb-2">الدور الوظيفي (الصلاحيات) <span className="text-rose-500">*</span></label>
                                <select value={formRole} onChange={e => setFormRole(e.target.value)} className="w-full bg-muted border border-border rounded-xl p-3 text-foreground focus:border-rose-500 focus:outline-none transition-colors appearance-none cursor-pointer">
                                    <option value="Admin">مدير عام (Admin) - كافه الصلاحيات</option>
                                    <option value="Supervisor">مشرف فني (Supervisor) - ورشة وتقارير</option>
                                    <option value="Receptionist">استقبال (Receptionist) - فواتير فقط</option>
                                </select>
                            </div>

                            <div className="pt-4 flex gap-3">
                                <button type="submit" className="flex-1 bg-rose-600 hover:bg-rose-500 text-white py-3 rounded-xl font-bold transition-colors shadow-lg shadow-rose-500/20">
                                    {editingEmp ? 'حفظ التعديلات' : 'إضافة الموظف'}
                                </button>
                                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 bg-muted hover:bg-slate-300 dark:hover:bg-slate-700 border border-border text-foreground py-3 rounded-xl font-bold transition-colors">
                                    إلغاء
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
