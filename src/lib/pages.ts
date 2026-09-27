// Central registry of the app's sidebar tabs, used by the Sidebar (visibility),
// the settings page (per-employee permission checkboxes) and the server actions
// (sanitizing what gets stored). One list — so a new tab added here automatically
// appears as a permission checkbox.

export type AppPage = { key: string; href: string; label: string };

export const APP_PAGES: AppPage[] = [
    { key: 'dashboard', href: '/', label: 'لوحة التحكم الرئيسية' },
    { key: 'reception', href: '/reception', label: 'الاستقبال وأوامر العمل' },
    { key: 'suggestions', href: '/suggestions', label: 'إدارة الاقتراحات' },
    { key: 'work-orders', href: '/work-orders', label: 'ساحة الورشة (العمل الحي)' },
    { key: 'audit', href: '/audit', label: 'التدقيق والمحاسبة' },
    { key: 'customers', href: '/customers', label: 'سجل العملاء والمركبات' },
    { key: 'contracts', href: '/contracts', label: 'العقود الحكومية (الآجل)' },
    { key: 'reports', href: '/reports', label: 'الفواتير والتقارير (PDF)' },
    { key: 'technician-report', href: '/technician-report', label: 'تقرير الفنيين اليومي' },
    { key: 'financial-reports', href: '/financial-reports', label: 'السجلات والدفاتر (Excel)' },
    { key: 'hr', href: '/hr/employees', label: 'الموارد البشرية — الموظفون' },
    { key: 'settings', href: '/settings', label: 'الإعدادات وإدارة الموظفين' },
];

export const PAGE_KEYS = APP_PAGES.map(p => p.key);

export const PAGE_KEY_BY_HREF: Record<string, string> =
    Object.fromEntries(APP_PAGES.map(p => [p.href, p.key]));

/** Keep only known page keys (used server-side before storing). */
export function sanitizePageKeys(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((k): k is string => typeof k === 'string' && PAGE_KEYS.includes(k));
}

/** What an employee saw BEFORE per-tab permissions existed — used as the
 *  fallback when allowed_pages hasn't been configured yet, and to prefill the
 *  checkboxes when editing an old account. Mirrors the old sidebar rules,
 *  except technician-report which is now admin-only by default. */
export function legacyAllowedPages(role: string | null, flags: {
    permission_dashboard?: boolean | null;
    permission_reception?: boolean | null;
    permission_work_orders?: boolean | null;
    permission_customers?: boolean | null;
    permission_reports?: boolean | null;
    permission_employees?: boolean | null;
}): string[] {
    const out: string[] = [];
    if (flags.permission_dashboard ?? true) out.push('dashboard');
    if (flags.permission_reception ?? true) out.push('reception');
    out.push('suggestions');
    if (flags.permission_work_orders ?? true) out.push('work-orders');
    if (role === 'Supervisor' || (flags.permission_reception ?? true) || (flags.permission_work_orders ?? true)) out.push('audit');
    if (flags.permission_customers ?? true) out.push('customers');
    if (flags.permission_reports ?? true) out.push('reports');
    if (flags.permission_employees) out.push('settings');
    return out;
}

/** Default tab set for a brand-new non-admin account. */
export const DEFAULT_NEW_EMPLOYEE_PAGES = [
    'dashboard', 'reception', 'suggestions', 'work-orders', 'audit', 'customers', 'reports',
];
