"use client";

import { useState, useEffect } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { Settings, Users, Building2, MapPin, Save, MessageCircle, Plus, Loader2, X, AlertCircle } from "lucide-react";
import { useAuth } from "@/lib/AuthProvider";
import { supabase } from "@/lib/supabase";
import { createEmployeeAccount, updateEmployeeAccount, deleteEmployeeAccount, saveGoogleSheetsSettings } from "@/app/actions/admin";
import { UserRole } from "@/lib/types";
import { showConfirm, showError, showSuccess } from "@/lib/alerts";
import { APP_PAGES, legacyAllowedPages, DEFAULT_NEW_EMPLOYEE_PAGES } from "@/lib/pages";

export default function SettingsPage() {
    const { t } = useLanguage();
    const { employeeRole, loading: authLoading, permissionEmployees } = useAuth();
    // Owner/Admin. Staff who only carry the "الموظفون" permission flag can manage
    // accounts, but not admin-level ones — mirrors requireUserManager() on the server.
    const isAdmin = employeeRole === 'Owner' || employeeRole === 'Admin';
    
    // Auth & Employees State
    const [employees, setEmployees] = useState<any[]>([]);
    const [branches, setBranches] = useState<any[]>([]);
    const [loadingEnv, setLoadingEnv] = useState(true);

    // Modal State
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [webhookUrl, setWebhookUrl] = useState("");
    const [syncEnabled, setSyncEnabled] = useState(false);
    const [isSavingGoogle, setIsSavingGoogle] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
    const [isBranchModalOpen, setIsBranchModalOpen] = useState(false);
    const [isEditBranchModalOpen, setIsEditBranchModalOpen] = useState(false);
    const [editingBranch, setEditingBranch] = useState<any | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);

    const [formData, setFormData] = useState({
        name: "",
        username: "",
        phone: "",
        password: "",
        role: "Receptionist" as UserRole,
        branch_id: "",
        permission_dashboard: true,
        permission_reception: true,
        permission_work_orders: true,
        permission_customers: true,
        permission_reports: true,
        permission_employees: false,
        allowed_pages: [...DEFAULT_NEW_EMPLOYEE_PAGES]
    });

    const [branchData, setBranchData] = useState({
        name: "",
        address: ""
    });

    const fetchAllData = async () => {
        try {
            // The three queries are independent — run them in parallel.
            const [
                { data: empData, error: empErr },
                { data: bData, error: bErr },
                { data: settingsData }
            ] = await Promise.all([
                supabase.from('employees').select('*').order('created_at', { ascending: false }),
                supabase.from('branches').select('*').order('created_at', { ascending: true }),
                supabase.from('workshop_settings').select('*')
            ]);

            if (!empErr && empData) {
                setEmployees(empData);
            }

            if (!bErr && bData) setBranches(bData);

            if (settingsData) {
                const urlVal = settingsData.find(s => s.setting_key === 'google_sheets_webhook_url')?.setting_value || "";
                const enabledVal = settingsData.find(s => s.setting_key === 'google_sheets_sync_enabled')?.setting_value === 'true';
                setWebhookUrl(urlVal);
                setSyncEnabled(enabledVal);
            }

        } catch (e) {
            console.error("Exception fetching settings data:", e);
        } finally {
            setLoadingEnv(false);
        }
    };

    useEffect(() => {
        // Wait for auth to settle, then either fetch or show the unauthorized
        // panel — an auth user with no employees row must not spin forever.
        if (authLoading) return;
        if (isAdmin || permissionEmployees) {
            fetchAllData();
        } else {
            setLoadingEnv(false);
        }
    }, [authLoading, isAdmin, permissionEmployees]);

    const handleSaveGoogleSettings = async () => {
        setIsSavingGoogle(true);
        try {
            // Saved on the server, which checks the caller is Owner/Admin.
            const res = await saveGoogleSheetsSettings(webhookUrl, syncEnabled);
            if (!res.success) {
                showError("خطأ", res.error || "فشل حفظ إعدادات Google Sheets");
                return;
            }
            showSuccess("تم الحفظ", "تم حفظ إعدادات مزامنة Google Sheets بنجاح!");
        } catch (err: any) {
            console.error(err);
            showError("خطأ", "فشل حفظ إعدادات Google Sheets");
        } finally {
            setIsSavingGoogle(false);
        }
    };

    const handleDeleteBranch = async (id: string, name: string) => {
        const isConfirmed = await showConfirm(
            `حذف فرع "${name}"`,
            `هل أنت متأكد من حذف هذا الفرع نهائياً؟\nسيتم حذف الفرع فقط في حال لم يكن مرتبطاً بأي موظفين أو فواتير.`,
            'نعم، احذف الفرع',
            true
        );
        if (!isConfirmed) return;

        setLoadingEnv(true);
        try {
            const { error } = await supabase.from('branches').delete().eq('id', id);
            
            if (error) {
                if (error.code === '23503') { // Foreign key violation
                    showError("لا يمكن حذف الفرع", "هذا الفرع مرتبط بموظفين أو فواتير حالية. يجب نقلهم لفرع آخر أولاً.");
                } else {
                    showError("خطأ", `حدث خطأ أثناء الحذف: ${error.message}`);
                }
            } else {
                showSuccess("تم الحذف", "تم حذف الفرع بنجاح.");
                fetchAllData();
            }
        } catch (err: any) {
            showError("خطأ", `حدث خطأ: ${err.message}`);
        } finally {
            setLoadingEnv(false);
        }
    };

    // The old boolean flags stay in sync with the tab list so anything still
    // reading them (legacy fallbacks, requireUserManager's permission_employees)
    // keeps working.
    const withSyncedFlags = (fd: typeof formData) => ({
        ...fd,
        permission_dashboard: fd.allowed_pages.includes('dashboard'),
        permission_reception: fd.allowed_pages.includes('reception'),
        permission_work_orders: fd.allowed_pages.includes('work-orders'),
        permission_customers: fd.allowed_pages.includes('customers'),
        permission_reports: fd.allowed_pages.includes('reports'),
        permission_employees: fd.allowed_pages.includes('settings'),
    });

    const handleCreateUser = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name || !formData.role || !formData.username) {
            showError("بيانات ناقصة", "يرجى تعبئة الحقول المطلوبة (الاسم، اسم المستخدم، الصلاحية)");
            return;
        }
        setIsSubmitting(true);
        setFormError(null);

        const res = await createEmployeeAccount(withSyncedFlags(formData));
        
        if (res.success) {
            setIsAddModalOpen(false);
            setFormData({
                name: "",
                username: "",
                phone: "",
                password: "",
                role: "Receptionist",
                branch_id: "",
                permission_dashboard: true,
                permission_reception: true,
                permission_work_orders: true,
                permission_customers: true,
                permission_reports: true,
                permission_employees: false,
                allowed_pages: [...DEFAULT_NEW_EMPLOYEE_PAGES]
            });
            await fetchAllData();
        } else {
            setFormError(res.error || "فشل في إنشاء الحساب. لعل اسم المستخدم مستخدم مسبقاً.");
        }
        
        setIsSubmitting(false);
    };

    // Who this user may edit/delete — same rule the server enforces, so the screen
    // never offers an action that is going to come back rejected.
    const canManage = (emp: any) => {
        if (emp.role === 'Owner') return employeeRole === 'Owner';
        if (emp.role === 'Admin') return isAdmin;
        return true;
    };

    const handleEditUserClick = (emp: any) => {
        if (!canManage(emp)) {
            showError("غير مصرح", "لا يمكنك تعديل بيانات هذا الحساب.");
            return;
        }
        setEditingEmployeeId(emp.auth_id);
        setFormData({
            name: emp.name,
            username: emp.username || "",
            phone: emp.phone || "",
            password: "", // empty so it won't update unless typed
            role: emp.role as UserRole,
            branch_id: emp.branch_id || "",
            permission_dashboard: emp.permission_dashboard ?? true,
            permission_reception: emp.permission_reception ?? true,
            permission_work_orders: emp.permission_work_orders ?? true,
            permission_customers: emp.permission_customers ?? true,
            permission_reports: emp.permission_reports ?? true,
            permission_employees: emp.permission_employees ?? false,
            // Accounts saved before per-tab permissions get their old effective set prefilled.
            allowed_pages: Array.isArray(emp.allowed_pages)
                ? emp.allowed_pages
                : legacyAllowedPages(emp.role, emp)
        });
        setIsEditModalOpen(true);
    };

    const handleUpdateUser = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingEmployeeId) return;
        setIsSubmitting(true);
        setFormError(null);

        const res = await updateEmployeeAccount(editingEmployeeId, withSyncedFlags(formData));
        
        if (res.success) {
            showSuccess("تم التحديث", "تم تحديث بيانات المستخدم بنجاح");
            setIsEditModalOpen(false);
            setFormData({
                name: "",
                username: "",
                phone: "",
                password: "",
                role: "Receptionist",
                branch_id: "",
                permission_dashboard: true,
                permission_reception: true,
                permission_work_orders: true,
                permission_customers: true,
                permission_reports: true,
                permission_employees: false,
                allowed_pages: [...DEFAULT_NEW_EMPLOYEE_PAGES]
            });
            setEditingEmployeeId(null);
            await fetchAllData();
        } else {
            setFormError(res.error || "فشل في تحديث الحساب.");
        }
        
        setIsSubmitting(false);
    };

    const handleDeleteUser = async (authId: string, name: string, role: string) => {
        if (role === 'Owner') {
            showError("غير مصرح", "لا يمكن حذف المالك الأساسي للنظام.");
            return;
        }
        
        const isConfirmed = await showConfirm(
            `حذف المستخدم`,
            `هل أنت متأكد من حذف المستخدم ${name}؟ لا يمكن التراجع عن هذا الإجراء.`,
            'نعم، احذف',
            true
        );
        if (isConfirmed) {
            setLoadingEnv(true);
            const res = await deleteEmployeeAccount(authId);
            setLoadingEnv(false);
            if (res.success) {
                showSuccess("تم الحذف", "تم حذف المستخدم بنجاح.");
                fetchAllData();
            } else {
                showError("خطأ", res.error || "حدث خطأ أثناء الحذف.");
            }
        }
    };

    const handleCreateBranch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!branchData.name) {
            showError("بيانات ناقصة", "الرجاء تعبئة الحقول المطلوبة (اسم الفرع).");
            return;
        }
        setIsSubmitting(true);
        
        const { error } = await supabase.from('branches').insert([{ name: branchData.name, address: branchData.address }]);
        
        if (!error) {
            setIsBranchModalOpen(false);
            setBranchData({ name: "", address: "" });
            await fetchAllData();
        } else {
            alert("خطأ أثناء إضافة الفرع، ربما قاعدة البيانات غير المحدثة؟");
        }
        setIsSubmitting(false);
    };

    const handleEditBranchClick = (branch: any) => {
        setEditingBranch(branch);
        setBranchData({ name: branch.name, address: branch.address || "" });
        setIsEditBranchModalOpen(true);
    };

    const handleUpdateBranch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingBranch) return;
        setIsSubmitting(true);
        const { error } = await supabase.from('branches')
            .update({ name: branchData.name, address: branchData.address })
            .eq('id', editingBranch.id);
        if (!error) {
            setIsEditBranchModalOpen(false);
            setEditingBranch(null);
            setBranchData({ name: "", address: "" });
            await fetchAllData();
        } else {
            alert("خطأ أثناء تحديث بيانات الفرع.");
        }
        setIsSubmitting(false);
    };

    if (authLoading || loadingEnv) {
        return <div className="p-20 flex justify-center"><Loader2 className="animate-spin text-rose-500 w-10 h-10" /></div>;
    }

    if (!isAdmin && !permissionEmployees) {
        return (
            <div className="p-8 flex items-center justify-center min-h-[50vh] animate-fade-in" dir="rtl">
                <div className="glass-card p-8 rounded-2xl border-border text-center max-w-md w-full relative overflow-hidden">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-rose-500/10 blur-[50px] rounded-full pointer-events-none" />
                    <AlertCircle className="mx-auto text-rose-500 mb-4 relative z-10" size={48} />
                    <h2 className="text-2xl font-bold text-foreground mb-2 relative z-10">غير مصرح لك</h2>
                    <p className="text-muted-foreground relative z-10">عذراً، صفحة الإعدادات وصلاحيات الموظفين مخصصة للإدارة العليا فقط.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 md:p-8 space-y-8 animate-fade-in pb-24" dir={t.common.dashboard === "لوحة التحكم" ? "rtl" : "ltr"}>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-display font-bold text-foreground mb-2 flex items-center gap-3">
                        <Settings className="text-rose-500" size={32} />
                        الإعدادات المركزية
                    </h1>
                    <p className="text-muted-foreground">
                        إدارة الفروع وصلاحيات المستخدمين المسموح لهم بالدخول للنظام.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Branches Settings */}
                <div className="glass-card p-6 rounded-2xl relative overflow-hidden group">
                    <h2 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2 border-b border-rose-500/20 pb-4">
                        <Building2 className="text-rose-400" size={24} />
                        إعدادات الفروع (Branches)
                    </h2>
                    
                    <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                        {branches.map((branch) => (
                            <div key={branch.id} className="p-4 bg-card/50 border border-border hover:border-rose-500/30 transition-colors rounded-xl flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-rose-500/10 rounded-lg text-rose-500">
                                        <MapPin size={20} />
                                    </div>
                                    <div>
                                        <h4 className="text-foreground font-bold">{branch.name}</h4>
                                        <p className="text-xs text-muted-foreground">{branch.address || 'عنوان غير مسجل'}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => handleEditBranchClick(branch)} className="p-1.5 hover:bg-blue-500/10 hover:text-blue-400 text-muted-foreground rounded transition-colors" title="تعديل الفرع">
                                        <Settings size={14} />
                                    </button>
                                    <button onClick={() => handleDeleteBranch(branch.id, branch.name)} className="p-1.5 hover:bg-rose-500/10 hover:text-rose-500 text-muted-foreground rounded transition-colors" title="حذف الفرع">
                                        <X size={14} />
                                    </button>
                                </div>
                            </div>
                        ))}
                        {branches.length === 0 && (
                            <p className="text-center text-muted-foreground text-sm py-4">لا توجد فروع مضافة بعد.</p>
                        )}
                        <button onClick={() => setIsBranchModalOpen(true)} className="w-full py-3 rounded-xl border border-dashed border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors text-sm font-medium hover:border-rose-500/50">
                            + إضافة فرع جديد للنظام
                        </button>
                    </div>
                </div>

                {/* Google Sheets Integration */}
                <div className="glass-card p-6 rounded-2xl relative overflow-hidden group">
                    <h2 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2 border-b border-emerald-500/20 pb-4">
                        <span className="text-emerald-400">📊</span>
                        ربط Google Sheets للمزامنة التلقائية
                    </h2>
                    
                    <div className="space-y-5">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-muted-foreground">تفعيل المزامنة التلقائية للبيانات:</span>
                            <button
                                onClick={() => setSyncEnabled(!syncEnabled)}
                                className={`w-12 h-6 rounded-full p-1 transition-colors duration-200 focus:outline-none ${syncEnabled ? 'bg-emerald-600' : 'bg-muted border border-border'}`}
                            >
                                <div className={`w-4 h-4 rounded-full bg-white transition-transform duration-200 ${syncEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                            </button>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground ml-1">رابط الويب هوك الخاص بـ Google Web App (Webhook URL)</label>
                            <input 
                                type="text" 
                                value={webhookUrl}
                                onChange={e => setWebhookUrl(e.target.value)}
                                placeholder="https://script.google.com/macros/s/.../exec"
                                className="input-field text-left"
                                dir="ltr"
                            />
                        </div>
                        <button 
                            onClick={handleSaveGoogleSettings}
                            disabled={isSavingGoogle || !isAdmin}
                            title={isAdmin ? undefined : "متاح للمالك أو مدير النظام فقط"}
                            className="w-full py-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-500 transition flex items-center justify-center gap-2 font-bold font-ibm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isSavingGoogle ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                            حفظ إعدادات المزامنة
                        </button>
                    </div>
                </div>

                {/* WhatsApp Integration API */}
                <div className="glass-card p-6 rounded-2xl relative overflow-hidden group">
                    <h2 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2 border-b border-blue-500/20 pb-4">
                        <MessageCircle className="text-blue-400" size={24} />
                        ربط واتساب API (WhatsApp)
                    </h2>
                    
                    <div className="space-y-5">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground ml-1">مفتاح الربط (API Key)</label>
                            <input 
                                type="password" 
                                placeholder="************************"
                                className="input-field text-left"
                                dir="ltr"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground ml-1">رسالة الترحيب الآلية</label>
                            <textarea 
                                placeholder="مرحباً [الاسم]، تم استلام سيارتك [النوع] وجاري العمل عليها..."
                                className="input-field min-h-[100px] text-sm resize-none"
                            />
                        </div>
                        <button className="w-full py-2.5 rounded-xl bg-muted text-foreground hover:bg-muted/80 transition flex items-center justify-center gap-2 border border-border">
                            <Save size={18} /> حفظ إعدادات الرسائل
                        </button>
                    </div>
                </div>

                {/* Users Management */}
                <div className="glass-card p-6 rounded-2xl md:col-span-2">
                    <h2 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2 border-b border-border pb-4">
                        <Users className="text-cyan-500" size={24} />
                        إدارة المستخدمين النشطين
                    </h2>
                    
                    <div className="overflow-x-auto custom-scrollbar">
                        <table className="w-full text-right text-sm">
                            <thead>
                                <tr className="border-b border-border text-muted-foreground bg-card/30">
                                    <th className="py-3 px-4 font-medium">الاسم</th>
                                    <th className="py-3 px-4 font-medium text-center">الصلاحية (الولوج)</th>
                                    <th className="py-3 px-4 font-medium">رقم الهاتف</th>
                                    <th className="py-3 px-4 font-medium">تاريخ الإنضمام</th>
                                    <th className="py-3 px-4 font-medium text-left">إجراءات</th>
                                </tr>
                            </thead>
                            <tbody>
                                {employees.map(emp => (
                                    <tr key={emp.id} className="border-b border-border hover:bg-muted/20 transition-colors">
                                        <td className="py-4 px-4 font-bold text-foreground">
                                            <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 rounded-full bg-cyan-950/30 text-cyan-500 flex items-center justify-center border border-cyan-900/50 font-mono text-xs shadow-sm">{emp.name.charAt(0)}</div>
                                                <div className="flex flex-col">
                                                    <span>{emp.name}</span>
                                                    <span className="text-[10px] text-muted-foreground font-mono font-normal mt-0.5" dir="ltr">@{emp.username || "—"}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="py-4 px-4 text-center">
                                            <span className={`px-3 py-1.5 rounded-full text-[11px] font-bold border inline-block min-w-[80px] ${
                                                emp.role === 'Owner' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' :
                                                emp.role === 'Admin' ? 'bg-rose-500/10 text-rose-500 border-rose-500/20' :
                                                emp.role === 'Supervisor' ? 'bg-blue-500/10 text-blue-500 border-blue-500/20' :
                                                'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                                            }`}>
                                                {emp.role === 'Owner' ? 'مالك النظام' : emp.role === 'Admin' ? 'مدير عام' : emp.role === 'Supervisor' ? 'مشرف فني' : 'استقبال'}
                                            </span>
                                        </td>
                                        <td className="py-4 px-4 text-muted-foreground font-mono" dir="ltr">{emp.phone || 'لا يوجد'}</td>
                                        <td className="py-4 px-4 text-muted-foreground font-mono text-xs">{new Date(emp.created_at).toLocaleDateString('en-GB')}</td>
                                        <td className="py-4 px-4 text-left">
                                            <div className="flex justify-end gap-2">
                                                {canManage(emp) && (
                                                    <button onClick={() => handleEditUserClick(emp)} className="text-blue-500 hover:bg-blue-500/10 p-1.5 rounded transition-colors text-xs font-bold border border-blue-500/20">تعديل</button>
                                                )}
                                                {canManage(emp) && (
                                                    <button onClick={() => handleDeleteUser(emp.auth_id, emp.name, emp.role)} className="text-rose-500 hover:bg-rose-500/10 p-1.5 rounded transition-colors text-xs font-bold border border-rose-500/20">حذف</button>
                                                )}
                                                {!canManage(emp) && (
                                                    <span className="text-xs text-muted-foreground italic px-1">محمي</span>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {employees.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="text-center py-8 text-muted-foreground font-bold">لم يتم العثور على مستخدمين!</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    
                    <div className="mt-4 flex justify-end">
                        <button 
                            onClick={() => setIsAddModalOpen(true)}
                            className="px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl transition flex items-center gap-2 shadow-lg shadow-cyan-500/20"
                        >
                            <Plus size={18} /> إنشاء حساب دخول جديد
                        </button>
                    </div>
                </div>
            </div>

            {/* ADD BRANCH MODAL */}
            {isBranchModalOpen && (
                <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" dir="rtl">
                    <form onSubmit={handleCreateBranch} className="bg-card border border-border w-full max-w-sm rounded-[24px] overflow-hidden shadow-2xl relative animate-in zoom-in duration-200 text-right">
                        <div className="p-5 border-b border-border bg-muted/30 flex justify-between items-center">
                            <h2 className="text-lg font-bold text-foreground">إضافة فرع جديد</h2>
                            <button type="button" onClick={() => setIsBranchModalOpen(false)} className="text-muted-foreground hover:bg-background p-1.5 rounded-lg transition-colors"><X size={18} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="text-sm font-bold text-muted-foreground block mb-2">اسم الفرع <span className="text-rose-500">*</span></label>
                                <input required type="text" value={branchData.name} onChange={e => setBranchData({...branchData, name: e.target.value})} className="w-full bg-background border border-border rounded-xl p-3 text-foreground focus:border-rose-500" placeholder="مثال: الفرع الشمالي" />
                            </div>
                            <div>
                                <label className="text-sm font-bold text-muted-foreground block mb-2">العنوان الجغرافي</label>
                                <input type="text" value={branchData.address} onChange={e => setBranchData({...branchData, address: e.target.value})} className="w-full bg-background border border-border rounded-xl p-3 text-foreground focus:border-rose-500" placeholder="مثال: الرياض - شارع التخصصي" />
                            </div>
                        </div>
                        <div className="p-4 border-t border-border bg-muted/30 flex gap-3">
                            <button type="submit" disabled={isSubmitting} className="flex-1 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white py-3 rounded-xl font-bold transition-colors shadow-lg shadow-rose-500/20">
                                {isSubmitting ? 'جاري الإضافة...' : 'حفظ الفرع'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* ADD EMPLOYEE MODAL */}
            {isAddModalOpen && (
                <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" dir="rtl">
                    <form onSubmit={handleCreateUser} className="bg-card border border-cyan-900/40 rounded-[24px] w-full max-w-md max-h-[90vh] shadow-[0_0_50px_rgba(6,182,212,0.15)] overflow-hidden flex flex-col relative animate-in zoom-in duration-200 text-right">
                        <div className="p-6 border-b border-border bg-gradient-to-l from-slate-900 to-[#050505] flex items-center justify-between shrink-0">
                            <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                                <Users className="text-cyan-500" /> إضافة مستخدم جديد للنظام (Access)
                            </h2>
                            <button type="button" onClick={() => setIsAddModalOpen(false)} className="text-muted-foreground hover:text-foreground bg-muted p-1.5 rounded-lg border border-border">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-6 space-y-4 overflow-y-auto w-full custom-scrollbar">
                            {formError && (
                                <div className="bg-rose-500/10 border border-rose-500/30 text-rose-500 p-3 rounded-xl text-sm flex gap-2">
                                    <AlertCircle size={18} className="shrink-0" />
                                    <span>{formError}</span>
                                </div>
                            )}
                            
                            <div className="space-y-2">
                                <label htmlFor="emp-name" className="text-sm font-medium text-muted-foreground">الاسم الكامل</label>
                                <input id="emp-name" name="name" required type="text" className="w-full bg-background border border-border rounded-xl p-3 text-foreground focus:border-cyan-500" placeholder="مثال: أحمد عبد الله" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="emp-username" className="text-sm font-medium text-muted-foreground">اسم المستخدم (لتسجيل الدخول)</label>
                                <input id="emp-username" name="username" required type="text" className="w-full bg-background border border-border rounded-xl p-3 text-foreground focus:border-cyan-500 text-left font-mono" dir="ltr" placeholder="مثال: ahmed123" value={formData.username} onChange={e => setFormData({...formData, username: e.target.value})} />
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="emp-password" className="text-sm font-medium text-muted-foreground">كلمة المرور المشفرة</label>
                                <input id="emp-password" name="password" required minLength={6} type="password" autoComplete="new-password" className="w-full bg-background border border-border rounded-xl p-3 text-foreground focus:border-cyan-500 font-mono text-left tracking-widest" dir="ltr" placeholder="••••••••" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} />
                            </div>

                            {/* Stacks on phones — two selects side by side in a 360px-wide
                                modal truncated the role/branch names. */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
                                <div className="space-y-2">
                                    <label htmlFor="emp-role" className="text-sm font-medium text-muted-foreground">المنصب الدقيق والصلاحية</label>
                                    <select id="emp-role" name="role" className="w-full bg-cyan-950/20 border border-cyan-900/50 font-bold rounded-xl p-3 text-cyan-400 focus:border-cyan-500" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value as UserRole})}>
                                        <option value="Receptionist">موظف استقبال</option>
                                        <option value="Supervisor">مشرف فني (ورشة)</option>
                                        {/* Only a real admin may hand out admin-level roles — the server
                                            enforces the same rule, so hide what would just fail. */}
                                        {isAdmin && <option value="Admin">مدير عام (أقصى صلاحية)</option>}
                                        {employeeRole === 'Owner' && <option value="Owner">مالك النظام (صلاحية كاملة)</option>}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label htmlFor="emp-branch" className="text-sm font-medium text-muted-foreground">الفرع التابع له</label>
                                    <select id="emp-branch" name="branch_id" className="w-full bg-background border border-border rounded-xl p-3 text-foreground focus:border-cyan-500" value={formData.branch_id} onChange={e => setFormData({...formData, branch_id: e.target.value})}>
                                        <option value="">-- كل الفروع (للمدراء) --</option>
                                        {branches.map(b => (
                                            <option key={b.id} value={b.id}>{b.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="col-span-2 space-y-2">
                                    <label htmlFor="emp-phone" className="text-sm font-medium text-muted-foreground">رقم الجوال للتنبيهات</label>
                                    <input id="emp-phone" name="phone" type="tel" className="w-full bg-background border border-border rounded-xl p-3 text-foreground focus:border-cyan-500 font-mono text-left" dir="ltr" placeholder="05XXXXXXXX" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
                                </div>
                            </div>

                            <div className="space-y-3 border-t border-border pt-4 mt-4">
                                <h3 className="text-sm font-bold text-cyan-400">تحديد صلاحيات التبويبات والموديولات:</h3>
                                <p className="text-[11px] text-muted-foreground">حدد التبويبات التي تظهر لهذا الموظف. المالك والمدير العام يشاهدون كل التبويبات دائماً.</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                                    {APP_PAGES.map(p => (
                                        <label key={p.key} className="flex items-center gap-2 cursor-pointer bg-card/40 p-2.5 rounded-xl border border-border/50 hover:border-cyan-500/20 transition-colors">
                                            <input type="checkbox"
                                                checked={formData.allowed_pages.includes(p.key)}
                                                onChange={e => setFormData({
                                                    ...formData,
                                                    allowed_pages: e.target.checked
                                                        ? [...formData.allowed_pages, p.key]
                                                        : formData.allowed_pages.filter(k => k !== p.key)
                                                })}
                                                className="accent-cyan-500 w-4 h-4 rounded cursor-pointer" />
                                            <span className="text-foreground font-medium">{p.label}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="p-6 border-t border-border bg-card flex justify-end gap-3 shrink-0">
                            <button type="button" onClick={() => setIsAddModalOpen(false)} className="px-5 py-2.5 rounded-xl text-muted-foreground hover:bg-muted border border-transparent hover:border-border transition-colors font-medium">إلغاء الأمر</button>
                            <button type="submit" disabled={isSubmitting} className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold transition flex items-center gap-2 shadow-[0_0_15px_rgba(6,182,212,0.2)] disabled:opacity-50">
                                {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />} صناعة وتخزين الحساب
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* EDIT EMPLOYEE MODAL */}
            {isEditModalOpen && (
                <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" dir="rtl">
                    <form onSubmit={handleUpdateUser} className="bg-card border border-cyan-900/40 rounded-[24px] w-full max-w-md max-h-[90vh] shadow-[0_0_50px_rgba(6,182,212,0.15)] overflow-hidden flex flex-col relative animate-in zoom-in duration-200 text-right">
                        <div className="p-6 border-b border-border bg-gradient-to-l from-slate-900 to-[#050505] flex items-center justify-between shrink-0">
                            <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                                <Settings className="text-cyan-500" /> تعديل بيانات المستخدم
                            </h2>
                            <button type="button" onClick={() => {
                                setIsEditModalOpen(false);
                                setEditingEmployeeId(null);
                                setFormData({
                                    name: "",
                                    username: "",
                                    phone: "",
                                    password: "",
                                    role: "Receptionist",
                                    branch_id: "",
                                    permission_dashboard: true,
                                    permission_reception: true,
                                    permission_work_orders: true,
                                    permission_customers: true,
                                    permission_reports: true,
                                    permission_employees: false,
                                    allowed_pages: [...DEFAULT_NEW_EMPLOYEE_PAGES]
                                });
                            }} className="text-muted-foreground hover:text-foreground bg-muted p-1.5 rounded-lg border border-border">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-6 space-y-4 overflow-y-auto w-full custom-scrollbar">
                            {formError && (
                                <div className="bg-rose-500/10 border border-rose-500/30 text-rose-500 p-3 rounded-xl text-sm flex gap-2">
                                    <AlertCircle size={18} className="shrink-0" />
                                    <span>{formError}</span>
                                </div>
                            )}
                            
                            <div className="space-y-2">
                                <label htmlFor="edit-emp-name" className="text-sm font-medium text-muted-foreground">الاسم الكامل</label>
                                <input id="edit-emp-name" name="name" required type="text" className="w-full bg-background border border-border rounded-xl p-3 text-foreground focus:border-cyan-500" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="edit-emp-username" className="text-sm font-medium text-muted-foreground">اسم المستخدم (لتسجيل الدخول)</label>
                                <input id="edit-emp-username" name="username" required type="text" className="w-full bg-background border border-border rounded-xl p-3 text-foreground focus:border-cyan-500 text-left font-mono" dir="ltr" value={formData.username} onChange={e => setFormData({...formData, username: e.target.value})} />
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="edit-emp-password" className="text-sm font-medium text-muted-foreground">كلمة المرور الجديدة (اختياري)</label>
                                <input id="edit-emp-password" name="password" minLength={6} type="password" autoComplete="new-password" className="w-full bg-background border border-border rounded-xl p-3 text-foreground focus:border-cyan-500 font-mono text-left tracking-widest" dir="ltr" placeholder="أدخل كلمة مرور جديدة للتغيير" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} />
                            </div>

                            {/* Stacks on phones — two selects side by side in a 360px-wide
                                modal truncated the role/branch names. */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
                                <div className="space-y-2">
                                    <label htmlFor="edit-emp-role" className="text-sm font-medium text-muted-foreground">الصلاحية</label>
                                    <select id="edit-emp-role" name="role" className="w-full bg-cyan-950/20 border border-cyan-900/50 font-bold rounded-xl p-3 text-cyan-400 focus:border-cyan-500" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value as UserRole})}>
                                        <option value="Receptionist">موظف استقبال</option>
                                        <option value="Supervisor">مشرف فني (ورشة)</option>
                                        {/* Only a real admin may hand out admin-level roles — the server
                                            enforces the same rule, so hide what would just fail. */}
                                        {isAdmin && <option value="Admin">مدير عام (أقصى صلاحية)</option>}
                                        {employeeRole === 'Owner' && <option value="Owner">مالك النظام (صلاحية كاملة)</option>}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label htmlFor="edit-emp-branch" className="text-sm font-medium text-muted-foreground">الفرع التابع له</label>
                                    <select id="edit-emp-branch" name="branch_id" className="w-full bg-background border border-border rounded-xl p-3 text-foreground focus:border-cyan-500" value={formData.branch_id} onChange={e => setFormData({...formData, branch_id: e.target.value})}>
                                        <option value="">-- كل الفروع (للمدراء) --</option>
                                        {branches.map(b => (
                                            <option key={b.id} value={b.id}>{b.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="col-span-2 space-y-2">
                                    <label htmlFor="edit-emp-phone" className="text-sm font-medium text-muted-foreground">رقم الجوال</label>
                                    <input id="edit-emp-phone" name="phone" type="tel" className="w-full bg-background border border-border rounded-xl p-3 text-foreground focus:border-cyan-500 font-mono text-left" dir="ltr" placeholder="05XXXXXXXX" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
                                </div>
                            </div>

                            <div className="space-y-3 border-t border-border pt-4 mt-4">
                                <h3 className="text-sm font-bold text-cyan-400">تحديد صلاحيات التبويبات والموديولات:</h3>
                                <p className="text-[11px] text-muted-foreground">حدد التبويبات التي تظهر لهذا الموظف. المالك والمدير العام يشاهدون كل التبويبات دائماً.</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                                    {APP_PAGES.map(p => (
                                        <label key={p.key} className="flex items-center gap-2 cursor-pointer bg-card/40 p-2.5 rounded-xl border border-border/50 hover:border-cyan-500/20 transition-colors">
                                            <input type="checkbox"
                                                checked={formData.allowed_pages.includes(p.key)}
                                                onChange={e => setFormData({
                                                    ...formData,
                                                    allowed_pages: e.target.checked
                                                        ? [...formData.allowed_pages, p.key]
                                                        : formData.allowed_pages.filter(k => k !== p.key)
                                                })}
                                                className="accent-cyan-500 w-4 h-4 rounded cursor-pointer" />
                                            <span className="text-foreground font-medium">{p.label}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="p-6 border-t border-border bg-card flex justify-end gap-3 shrink-0">
                            <button type="button" onClick={() => {
                                setIsEditModalOpen(false);
                                setEditingEmployeeId(null);
                                setFormData({
                                    name: "",
                                    username: "",
                                    phone: "",
                                    password: "",
                                    role: "Receptionist",
                                    branch_id: "",
                                    permission_dashboard: true,
                                    permission_reception: true,
                                    permission_work_orders: true,
                                    permission_customers: true,
                                    permission_reports: true,
                                    permission_employees: false,
                                    allowed_pages: [...DEFAULT_NEW_EMPLOYEE_PAGES]
                                });
                            }} className="px-5 py-2.5 rounded-xl text-muted-foreground hover:bg-muted border border-transparent hover:border-border transition-colors font-medium">إلغاء الأمر</button>
                            <button type="submit" disabled={isSubmitting} className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold transition flex items-center gap-2 shadow-[0_0_15px_rgba(37,99,235,0.2)] disabled:opacity-50">
                                {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />} تحديث البيانات
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Edit Branch Modal */}
            {isEditBranchModalOpen && (
                <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-card border border-border rounded-[24px] w-full max-w-md max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in duration-200 text-right">
                        <div className="p-6 border-b border-border flex justify-between items-center">
                            <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                                <Settings className="text-blue-500" size={22} /> تعديل بيانات الفرع
                            </h2>
                            <button onClick={() => { setIsEditBranchModalOpen(false); setEditingBranch(null); setBranchData({ name: "", address: "" }); }} className="p-1.5 bg-muted rounded-lg border border-border hover:bg-rose-500/10 hover:text-rose-500 transition-colors">
                                <X size={18} />
                            </button>
                        </div>
                        <form onSubmit={handleUpdateBranch} className="p-6 space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-muted-foreground">اسم الفرع *</label>
                                <input
                                    type="text" required
                                    value={branchData.name}
                                    onChange={e => setBranchData({...branchData, name: e.target.value})}
                                    className="w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:border-blue-500"
                                    placeholder="مثال: فرع القطاع"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-muted-foreground">عنوان الفرع</label>
                                <input
                                    type="text"
                                    value={branchData.address}
                                    onChange={e => setBranchData({...branchData, address: e.target.value})}
                                    className="w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:border-blue-500"
                                    placeholder="مثال: شارع الصناعة"
                                />
                            </div>
                            <div className="pt-2 flex gap-3">
                                <button type="submit" disabled={isSubmitting} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-xl font-bold transition-colors flex items-center justify-center gap-2">
                                    {isSubmitting ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} حفظ التعديل
                                </button>
                                <button type="button" onClick={() => { setIsEditBranchModalOpen(false); setEditingBranch(null); setBranchData({ name: "", address: "" }); }} className="flex-1 bg-muted text-foreground py-2.5 rounded-xl font-bold transition-colors">إلغاء</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
