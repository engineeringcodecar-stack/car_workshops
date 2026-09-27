"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/AuthProvider";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import {
    LayoutDashboard,
    Wrench,
    FileText,
    Settings,
    ChevronLeft,
    ChevronRight,
    Menu,
    X,
    Building2,
    LogOut,
    Users,
    ClipboardList,
    FileSpreadsheet,
    ClipboardCheck,
    UserCircle,
    Landmark,
} from "lucide-react";
import ThemeToggle from "./ThemeToggle";
import NotificationBell from "./NotificationBell";
import { PAGE_KEY_BY_HREF } from "@/lib/pages";

const LOGO_BG = "bg-gradient-to-br from-rose-500 via-red-500 to-rose-700";
const ACCENT_BTN = "bg-rose-600 hover:bg-rose-500 text-white";

export function Sidebar() {
    const pathname = usePathname();
    const {
        signOut,
        employeeRole,
        employeeBranchId,
        setEmployeeBranchId,
        permissionDashboard,
        permissionReception,
        permissionWorkOrders,
        permissionCustomers,
        permissionReports,
        permissionEmployees,
        allowedPages
    } = useAuth();
    const { t } = useLanguage();
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [isMobileOpen, setIsMobileOpen] = useState(false);
    const [branches, setBranches] = useState<{id: string, name: string}[]>([]);

    useEffect(() => {
        if (employeeRole === 'Owner' || employeeRole === 'Admin') {
            supabase.from('branches').select('id, name').then(({data}) => {
                if (data) setBranches(data);
            });
        }
    }, [employeeRole]);

    // TODO: Update translations in dictionaries.ts, for now using hardcoded fallback or safe common keys
    // categorized navItems mimicking an ERP system like Odoo
    type NavCategory = {
        title: string;
        items: { href: string; label: string; icon: React.ReactNode; roles?: string[] }[];
    };
    
    const navCategories: NavCategory[] = [
        {
            title: "العمليات (Operations)",
            items: [
                { href: "/", label: t.common.dashboard || "لوحة التحكم", icon: <LayoutDashboard size={20} /> },
                // المساعد الذكي مخفي مؤقتاً من القائمة (الكود جاهز — يُعاد تفعيله بإزالة التعليق).
                // { href: "/assistant", label: "المساعد الذكي", icon: <Sparkles size={20} />, roles: ["Owner", "Admin"] },
                { href: "/reception", label: "الاستقبال وأوامر العمل", icon: <ClipboardList size={20} /> },
                { href: "/suggestions", label: "إدارة الاقتراحات", icon: <FileSpreadsheet size={20} /> },
                // { href: "/services", label: "الفحص والصيانة", icon: <Hammer size={20} />, roles: ["Owner", "Admin", "Supervisor"] },
                { href: "/work-orders", label: "ساحة الورشة (العمل الحي)", icon: <Wrench size={20} /> },
                { href: "/audit", label: "التدقيق والمحاسبة", icon: <ClipboardCheck size={20} />, roles: ["Owner", "Admin", "Supervisor"] },
                // { href: "/status", label: "متابعة وإنجاز العمل", icon: <Activity size={20} /> }
            ]
        },
        {
            title: "العملاء والمركبات (CRM)",
            items: [
                { href: "/customers", label: "سجل العملاء والمركبات", icon: <Users size={20} /> },
                { href: "/contracts", label: "العقود الحكومية", icon: <Landmark size={20} /> },
            ]
        },
        {
            title: "الموارد البشرية (HR)",
            items: [
                { href: "/hr/employees", label: "الموظفون", icon: <UserCircle size={20} />, roles: ["Owner", "Admin"] },
            ]
        },
        {
            title: "التقارير والتصدير",
            items: [
                { href: "/reports", label: "الفواتير والتقارير (PDF)", icon: <FileText size={20} />, roles: ["Owner", "Admin", "Supervisor"] },
                { href: "/technician-report", label: "تقرير الفنيين اليومي", icon: <Wrench size={20} />, roles: ["Owner", "Admin", "Supervisor"] },
                { href: "/financial-reports", label: "السجلات والدفاتر (Excel)", icon: <FileSpreadsheet size={20} />, roles: ["Owner", "Admin"] },
            ]
        },
        {
            title: "النظام والإدارة",
            items: [
                // { href: "/whatsapp", label: "ربط الواتساب والجدوى", icon: <MessageSquare size={20} /> },
                { href: "/settings", label: t.common.settings || "الإعدادات", icon: <Settings size={20} /> },
            ]
        },
        /* -- مخفية مؤقتاً لتبسيط النظام بناءً على طلب العميل --
        {
            title: "المالية والتحليلات (Finance & Analytics)",
            items: [
                { href: "/reports", label: "الفواتير (PDF)", icon: <FileText size={20} />, roles: ["Owner", "Admin", "Supervisor"] },
                { href: "/financial-reports", label: "السجلات والدفاتر (Excel)", icon: <FileText size={20} />, roles: ["Owner", "Admin", "Supervisor"] },
                { href: "/accounting", label: "النظام المحاسبي", icon: <Wallet size={20} />, roles: ["Owner", "Admin"] },
                { href: "/analytics", label: "تحليلات الأداء الحيّة", icon: <PieChart size={20} /> },
            ]
        },
        {
            title: "الموارد البشرية والإدارة (HR & Admin)",
            items: [
                { href: "/employees", label: "طاقم العمل", icon: <UserCircle size={20} />, roles: ["Owner", "Admin"] },
                { href: "/payroll", label: "مسير الرواتب", icon: <CalendarDays size={20} />, roles: ["Owner", "Admin"] },
                { href: "/alerts", label: "مركز التنبيهات والأحداث", icon: <Bell size={20} /> },
                { href: "/documents", label: "أرشيف المستندات والوثائق", icon: <FolderOpen size={20} /> },
            ]
        },
        {
            title: "النظام (System)",
            items: [
                { href: "/settings", label: t.common.settings || "الإعدادات", icon: <Settings size={20} />, roles: ["Owner", "Admin"] },
            ]
        }
        */
    ];

    const authorizedCategories = navCategories.map(category => ({
        ...category,
        items: category.items.filter(item => {
            // Owner and Admin always see every tab.
            if (employeeRole === 'Owner' || employeeRole === 'Admin') return true;

            // Per-tab permissions (الإعدادات → صلاحيات التبويبات): when configured,
            // the allowed_pages list is the single source of truth for this employee.
            const key = PAGE_KEY_BY_HREF[item.href];
            if (Array.isArray(allowedPages)) {
                return key ? allowedPages.includes(key) : false;
            }

            // Legacy fallback for accounts saved before per-tab permissions existed.
            if (item.href === '/') return !!permissionDashboard;
            if (item.href === '/assistant') return false;
            if (item.href === '/reception') return !!permissionReception;
            if (item.href === '/work-orders') return !!permissionWorkOrders;
            if (item.href === '/audit') return employeeRole === 'Supervisor' || !!permissionWorkOrders || !!permissionReception;
            if (item.href === '/customers') return !!permissionCustomers;
            if (item.href === '/reports') return !!permissionReports;
            // تقرير الفنيين: مخفي عن الموظفين افتراضياً — يظهر فقط لمن يُمنح التبويب صراحةً.
            if (item.href === '/technician-report') return false;
            if (item.href === '/financial-reports') return false;
            if (item.href === '/hr/employees') return false;
            // العقود: money on credit — only for staff explicitly granted the tab.
            if (item.href === '/contracts') return false;
            if (item.href === '/settings') return !!permissionEmployees;

            return true;
        })
    })).filter(category => category.items.length > 0);

    const sidebarBg = "bg-card/95 backdrop-blur-xl border-l border-border";

    return (
        <>
            {/* ── Mobile Header ── */}
            <header className={`print:hidden lg:hidden fixed top-0 right-0 left-0 h-16 ${sidebarBg} border-b border-border z-50 flex items-center justify-between px-4`}>
                <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl ${LOGO_BG} flex items-center justify-center shadow-lg shadow-rose-500/20`}>
                        <Building2 className="text-white" size={18} />
                    </div>
                    <div className="flex flex-col">
                        <span className="font-display font-bold text-xs text-foreground leading-none">هندسة السيارات</span>
                        {(employeeRole === 'Owner' || employeeRole === 'Admin') && branches.length > 0 ? (
                            <select 
                                className="text-[10px] bg-transparent text-rose-400 font-bold outline-none cursor-pointer w-max mt-0.5"
                                value={employeeBranchId || ""}
                                onChange={(e) => setEmployeeBranchId(e.target.value)}
                            >
                                <option value="" className="bg-popover text-foreground">كل الفروع</option>
                                {branches.map(b => (
                                    <option key={b.id} value={b.id} className="bg-popover text-foreground">{b.name}</option>
                                ))}
                            </select>
                        ) : (
                            <span className="text-[9px] text-rose-400 mt-0.5">إدارة الورشة المتكامل</span>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <NotificationBell direction="down" align="left" />
                    <button
                        onClick={() => setIsMobileOpen(!isMobileOpen)}
                        className="p-2 hover:bg-slate-800/40 rounded-lg transition-colors text-muted-foreground"
                    >
                        {isMobileOpen ? <X size={22} /> : <Menu size={22} />}
                    </button>
                </div>
            </header>

            {/* ── Mobile Overlay ── */}
            {isMobileOpen && (
                <div
                    className="lg:hidden fixed inset-0 bg-card/80 backdrop-blur-sm z-40"
                    onClick={() => setIsMobileOpen(false)}
                />
            )}

            {/* ── Mobile Drawer ── */}
            <aside
                className={`print:hidden lg:hidden fixed top-16 right-0 h-[calc(100vh-4rem)] ${sidebarBg} z-40 transition-transform duration-300 ease-in-out w-72 flex flex-col ${
                    isMobileOpen ? "translate-x-0" : "translate-x-full"
                }`}
            >
                <nav className="flex-1 p-3 mt-2 overflow-y-auto overflow-x-hidden">
                    {(employeeRole === 'Owner' || employeeRole === 'Admin') && branches.length > 0 && (
                        <div className="mb-4 px-3 py-2 bg-rose-500/5 rounded-xl border border-rose-500/10">
                            <label className="text-[10px] font-bold text-rose-400 block mb-1">الفرع النشط:</label>
                            <select
                                className="w-full bg-transparent text-sm font-bold text-foreground outline-none cursor-pointer"
                                value={employeeBranchId || ""}
                                onChange={(e) => setEmployeeBranchId(e.target.value)}
                            >
                                <option value="" className="bg-popover text-foreground">كل الفروع</option>
                                {branches.map(b => (
                                    <option key={b.id} value={b.id} className="bg-popover text-foreground">{b.name}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    {authorizedCategories.map((category, idx) => (
                        <div key={idx} className="mb-6 last:mb-0">
                            <h3 className="px-3 mb-2 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                                {category.title}
                            </h3>
                            <div className="space-y-1">
                                {category.items.map((item) => {
                                    const isActive = pathname === item.href;
                                    return (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            onClick={() => setIsMobileOpen(false)}
                                            className={`sidebar-item ${isActive ? "active" : ""}`}
                                        >
                                            <span className={isActive ? "text-rose-400" : "text-muted-foreground"}>
                                                {item.icon}
                                            </span>
                                            <span className={`font-medium text-sm ${isActive ? "text-foreground" : "text-muted-foreground"}`}>
                                                {item.label}
                                            </span>
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </nav>
                <div className="p-3 border-t border-border space-y-2">
                    <ThemeToggle />
                    <button
                        onClick={() => signOut()}
                        className="sidebar-item w-full text-rose-500 hover:bg-rose-500/10 justify-start"
                    >
                        <LogOut size={20} />
                        <span className="font-medium text-sm ml-2">{t.common.logout}</span>
                    </button>
                </div>
            </aside>

            {/* ── Desktop Sidebar ── */}
            <aside
                className={`print:hidden hidden lg:flex flex-col fixed top-0 right-0 h-screen ${sidebarBg} z-40 transition-all duration-300 ${
                    isCollapsed ? "w-[72px]" : "w-64"
                }`}
            >
                {/* Logo */}
                <div className="h-[70px] flex items-center border-b border-border px-3 shrink-0 justify-between">
                    <div className="flex items-center gap-3 overflow-hidden">
                        <div className={`w-10 h-10 rounded-xl ${LOGO_BG} flex items-center justify-center shrink-0 shadow-lg shadow-rose-500/20`}>
                            <Building2 className="text-white" size={20} />
                        </div>
                        {!isCollapsed && (
                            <div className="flex flex-col min-w-0">
                                <span className="font-display font-bold text-sm text-foreground leading-none truncate">هندسة السيارات</span>
                                {(employeeRole === 'Owner' || employeeRole === 'Admin') && branches.length > 0 ? (
                                    <select 
                                        className="text-xs bg-transparent text-rose-400 font-bold outline-none cursor-pointer w-full mt-1 truncate"
                                        value={employeeBranchId || ""}
                                        onChange={(e) => setEmployeeBranchId(e.target.value)}
                                    >
                                        <option value="" className="bg-popover text-foreground">كل الفروع</option>
                                        {branches.map(b => (
                                            <option key={b.id} value={b.id} className="bg-popover text-foreground">{b.name}</option>
                                        ))}
                                    </select>
                                ) : (
                                    <span className="text-[10px] text-rose-400 mt-1 truncate">إدارة الورشة المتكامل</span>
                                )}
                            </div>
                        )}
                    </div>
                    {!isCollapsed && (
                        <div className="shrink-0 pl-1">
                            <NotificationBell direction="down" align="right" />
                        </div>
                    )}
                </div>

                {/* Collapse Toggle */}
                <button
                    onClick={() => setIsCollapsed(!isCollapsed)}
                    className={`absolute -left-3 top-[54px] w-6 h-6 ${ACCENT_BTN} rounded-full flex items-center justify-center shadow-md shadow-rose-500/30 transition-all`}
                >
                    {isCollapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
                </button>

                {/* Nav */}
                <nav className="flex-1 p-3 mt-2 overflow-y-auto overflow-x-hidden custom-scrollbar">
                    {authorizedCategories.map((category, idx) => (
                        <div key={idx} className={`${isCollapsed ? "mb-2" : "mb-6"} last:mb-0`}>
                            {!isCollapsed ? (
                                <h3 className="px-3 mb-2 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                                    {category.title}
                                </h3>
                            ) : (
                                idx !== 0 && <div className="h-px bg-muted/50 my-2 mx-2" />
                            )}
                            <div className="space-y-1">
                                {category.items.map((item) => {
                                    const isActive = pathname === item.href;
                                    return (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            title={isCollapsed ? item.label : undefined}
                                            className={`sidebar-item ${isActive ? "active" : ""} ${isCollapsed ? "justify-center px-2" : ""}`}
                                        >
                                            <span className={isActive ? "text-rose-400" : "text-muted-foreground"}>
                                                {item.icon}
                                            </span>
                                            {!isCollapsed && (
                                                <span className={`font-medium text-sm ${isActive ? "text-foreground" : "text-muted-foreground"} whitespace-nowrap`}>
                                                    {item.label}
                                                </span>
                                            )}
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </nav>

                {/* Footer */}
                <div className="p-3 shrink-0 border-t border-border space-y-2">
                    {isCollapsed && (
                        <div className="flex items-center justify-center px-1 mb-2">
                            <NotificationBell direction="up" align="right" />
                        </div>
                    )}
                    {!isCollapsed && <ThemeToggle />}
                    <button
                        onClick={() => signOut()}
                        title={isCollapsed ? t.common.logout : undefined}
                        className={`sidebar-item w-full text-rose-500 hover:bg-rose-500/10 ${isCollapsed ? "justify-center px-2" : "justify-start"}`}
                    >
                        <LogOut size={20} />
                        {!isCollapsed && <span className="font-medium text-sm ml-2">{t.common.logout}</span>}
                    </button>
                </div>
            </aside>
        </>
    );
}
