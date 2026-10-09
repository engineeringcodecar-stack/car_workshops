"use server";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { Database, UserRole } from "@/lib/types";
import { requireAdmin, requireUserManager } from "@/lib/supabase-server";
import { sanitizePageKeys } from "@/lib/pages";

// Roles a non-admin user-manager may neither grant nor touch.
const PRIVILEGED_ROLES: UserRole[] = ["Owner", "Admin"];

// listUsers() returns one page (50 by default) — walk every page.
async function listAllAuthUsers(supabaseAdmin: SupabaseClient<Database>) {
    const perPage = 1000;
    const users: User[] = [];
    for (let page = 1; ; page++) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
        if (error) return { users, error };
        users.push(...data.users);
        if (data.users.length < perPage) return { users, error: null };
    }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "No branch" reaches here as an empty string from the "كل الفروع" option, and has
 * been seen as the literal strings "null"/"undefined". Those are all truthy enough to
 * slip past `|| null` and reach Postgres, which rejects them with
 * `invalid input syntax for type uuid`. Only a real uuid is passed through.
 */
const cleanBranchId = (value?: string | null): string | null =>
    value && UUID_RE.test(value.trim()) ? value.trim() : null;

// Admin Server Action to securely instantiate employees with usernames and permissions
export async function createEmployeeAccount(formData: {
    name: string;
    username: string;
    phone: string;
    role: UserRole;
    password?: string;
    branch_id?: string | null;
    permission_dashboard?: boolean;
    permission_reception?: boolean;
    permission_work_orders?: boolean;
    permission_customers?: boolean;
    permission_reports?: boolean;
    permission_employees?: boolean;
    allowed_pages?: string[];
}) {
    // SECURITY: server actions are public POST endpoints — verify the caller may
    // manage users before touching the service-role client (which bypasses RLS).
    const guard = await requireUserManager();
    if (!guard.ok) return { success: false, error: guard.error };
    const { supabaseAdmin, isAdmin, role: callerRole } = guard;

    // A user-manager who isn't Owner/Admin cannot mint an Owner/Admin account,
    // which would otherwise turn the permission flag into a self-promotion path.
    if (!isAdmin && PRIVILEGED_ROLES.includes(formData.role)) {
        return { success: false, error: "لا يمكنك إنشاء حساب بصلاحية مالك أو مدير نظام." };
    }
    // Only the Owner may create another Owner.
    if (formData.role === "Owner" && callerRole !== "Owner") {
        return { success: false, error: "إنشاء حساب بصلاحية المالك مسموح للمالك فقط." };
    }

    try {
        const cleanUsername = formData.username.trim().toLowerCase();
        const dummyEmail = `${cleanUsername}@workshop.local`;
        console.log("Starting Auth Creation for username:", cleanUsername, "email:", dummyEmail);

        // 1. Create Auth User
        const passwordToUse = formData.password || "workshop123";
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email: dummyEmail,
            password: passwordToUse,
            email_confirm: true,
            user_metadata: { name: formData.name }
        });

        if (authError) {
            console.error("Auth Error:", authError);
            return { success: false, error: authError.message };
        }

        const authUser = authData.user;
        console.log("Auth User created successfully:", authUser.id);

        // 2. Create Employee Record
        const { error: dbError } = await supabaseAdmin
            .from('employees')
            .insert({
                auth_id: authUser.id,
                name: formData.name,
                username: cleanUsername,
                role: formData.role,
                phone: formData.phone,
                branch_id: cleanBranchId(formData.branch_id),
                permission_dashboard: formData.permission_dashboard ?? true,
                permission_reception: formData.permission_reception ?? true,
                permission_work_orders: formData.permission_work_orders ?? true,
                permission_customers: formData.permission_customers ?? true,
                permission_reports: formData.permission_reports ?? true,
                permission_employees: formData.permission_employees ?? false,
                allowed_pages: formData.allowed_pages ? sanitizePageKeys(formData.allowed_pages) : null
            });

        if (dbError) {
            console.error("Database Insert Error:", dbError);
            // Rollback auth user creation if DB insert fails
            await supabaseAdmin.auth.admin.deleteUser(authUser.id);
            return { success: false, error: dbError.message };
        }

        console.log("Employee Record Created Successfully.");
        return { success: true };
    } catch (e: unknown) {
        console.error("Critical Exception:", e);
        return { success: false, error: e instanceof Error ? e.message : "An unexpected error occurred." };
    }
}

// Admin Server Action to update an employee
export async function updateEmployeeAccount(
    authId: string,
    formData: {
        name: string;
        username: string;
        phone: string;
        role: UserRole;
        password?: string;
        branch_id?: string | null;
        permission_dashboard?: boolean;
        permission_reception?: boolean;
        permission_work_orders?: boolean;
        permission_customers?: boolean;
        permission_reports?: boolean;
        permission_employees?: boolean;
        allowed_pages?: string[];
    }
) {
    const guard = await requireUserManager();
    if (!guard.ok) return { success: false, error: guard.error };
    const { supabaseAdmin, userId, isAdmin, role: callerRole } = guard;

    const { data: target, error: targetError } = await supabaseAdmin
        .from("employees")
        .select("role")
        .eq("auth_id", authId)
        .maybeSingle();
    if (targetError) return { success: false, error: targetError.message };

    // Only the Owner may edit an Owner account (password reset included) or grant the role.
    if (callerRole !== "Owner") {
        if (target?.role === "Owner") {
            return { success: false, error: "لا يمكنك تعديل حساب المالك." };
        }
        if (formData.role === "Owner") {
            return { success: false, error: "منح صلاحية المالك مسموح للمالك فقط." };
        }
    }

    if (!isAdmin) {
        // Non-admin managers may not edit an Owner/Admin account (that would let
        // them reset the owner's password) nor promote anyone into those roles.
        if (target && PRIVILEGED_ROLES.includes(target.role)) {
            return { success: false, error: "لا يمكنك تعديل حساب المالك أو مدير النظام." };
        }
        if (PRIVILEGED_ROLES.includes(formData.role)) {
            return { success: false, error: "لا يمكنك منح صلاحية مالك أو مدير نظام." };
        }
    }

    // A non-admin editing their own account keeps their role, branch and tabs.
    const keepAccess = !isAdmin && authId === userId;

    try {
        const cleanUsername = formData.username.trim().toLowerCase();
        const dummyEmail = `${cleanUsername}@workshop.local`;

        // 1. Update Auth User if password is provided
        const updatePayload: {
            email: string;
            user_metadata: { name: string };
            password?: string;
        } = {
            email: dummyEmail,
            user_metadata: { name: formData.name }
        };
        if (formData.password && formData.password.trim().length > 0) {
            updatePayload.password = formData.password;
        }

        const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(authId, updatePayload);
        if (authError) return { success: false, error: authError.message };

        // 2. Update Employee Record
        const { error: dbError } = await supabaseAdmin
            .from('employees')
            .update(keepAccess ? {
                name: formData.name,
                username: cleanUsername,
                phone: formData.phone,
            } : {
                name: formData.name,
                username: cleanUsername,
                role: formData.role,
                phone: formData.phone,
                branch_id: cleanBranchId(formData.branch_id),
                permission_dashboard: formData.permission_dashboard ?? true,
                permission_reception: formData.permission_reception ?? true,
                permission_work_orders: formData.permission_work_orders ?? true,
                permission_customers: formData.permission_customers ?? true,
                permission_reports: formData.permission_reports ?? true,
                permission_employees: formData.permission_employees ?? false,
                allowed_pages: formData.allowed_pages ? sanitizePageKeys(formData.allowed_pages) : null
            })
            .eq('auth_id', authId);

        if (dbError) return { success: false, error: dbError.message };

        return { success: true };
    } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : "An unexpected error occurred." };
    }
}

// Admin Server Action to delete an employee
export async function deleteEmployeeAccount(authId: string) {
    const guard = await requireUserManager();
    if (!guard.ok) return { success: false, error: guard.error };
    const { supabaseAdmin, userId, isAdmin, role: callerRole } = guard;

    // Guard against an admin deleting their own account and locking themselves out.
    if (authId === userId) {
        return { success: false, error: "لا يمكنك حذف حسابك الشخصي." };
    }

    const { data: target, error: targetError } = await supabaseAdmin
        .from("employees")
        .select("role")
        .eq("auth_id", authId)
        .maybeSingle();
    if (targetError) return { success: false, error: targetError.message };

    if (target?.role === "Owner" && callerRole !== "Owner") {
        return { success: false, error: "حذف حساب المالك مسموح للمالك فقط." };
    }
    if (!isAdmin && target && PRIVILEGED_ROLES.includes(target.role)) {
        return { success: false, error: "لا يمكنك حذف حساب المالك أو مدير النظام." };
    }

    try {
        // 1. Block the login first, so a removed employee can't keep signing in
        //    even if a later step fails.
        const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(authId, { ban_duration: "876000h" });
        if (banError) return { success: false, error: banError.message };

        // 2. Delete Employee Record (undo the ban if it can't be removed)
        const { error: dbError } = await supabaseAdmin
            .from('employees')
            .delete()
            .eq('auth_id', authId);

        if (dbError) {
            await supabaseAdmin.auth.admin.updateUserById(authId, { ban_duration: "none" });
            return { success: false, error: dbError.message };
        }

        // 3. Delete Auth User
        const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(authId);

        if (authError) {
            return {
                success: false,
                error: `تم حذف الموظف وإيقاف دخوله، لكن تعذّر حذف حساب الدخول: ${authError.message}`,
            };
        }

        return { success: true };
    } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : "An unexpected error occurred." };
    }
}

// Admin Server Action to fetch auth user emails
export async function getAuthEmails() {
    const guard = await requireAdmin();
    if (!guard.ok) return { success: false, data: [] };
    const { supabaseAdmin } = guard;

    try {
        const { users, error } = await listAllAuthUsers(supabaseAdmin);
        if (error) return { success: false, data: [] };

        return {
            success: true,
            data: users.map(u => ({ id: u.id, email: u.email }))
        };
    } catch {
        return { success: false, data: [] };
    }
}

// Admin Server Action to list app users (employees joined with their auth email).
// Replaces the previously-missing `/api/users` route handler.
export async function listAppUsers() {
    const guard = await requireUserManager();
    if (!guard.ok) return { success: false, error: guard.error, users: [] };
    const { supabaseAdmin } = guard;

    try {
        const { data: employees, error: empError } = await supabaseAdmin
            .from("employees")
            .select("id, auth_id, name, role")
            .order("name", { ascending: true });

        if (empError) return { success: false, error: empError.message, users: [] };

        const { users: authUsers, error: authError } = await listAllAuthUsers(supabaseAdmin);
        if (authError) return { success: false, error: authError.message, users: [] };

        const emailByAuthId = new Map(authUsers.map(u => [u.id, u.email ?? ""]));

        const users = (employees ?? [])
            .filter(e => e.auth_id)
            .map(e => ({
                id: e.auth_id as string,
                employee_id: e.id,
                name: e.name,
                role: e.role,
                email: emailByAuthId.get(e.auth_id as string) ?? "",
            }));

        return { success: true, users };
    } catch (e: unknown) {
        return {
            success: false,
            error: e instanceof Error ? e.message : "An unexpected error occurred.",
            users: [],
        };
    }
}

// Google Sheets sync settings. Customer data is POSTed to this URL from every
// browser, so only the Owner/Admin may change it (the table is read-only to browsers).
export async function saveGoogleSheetsSettings(webhookUrl: string, syncEnabled: boolean) {
    const guard = await requireAdmin();
    if (!guard.ok) return { success: false, error: guard.error };
    const { supabaseAdmin } = guard;

    const url = String(webhookUrl ?? "").trim();
    if (url) {
        let parsed: URL | null = null;
        try { parsed = new URL(url); } catch { /* invalid */ }
        if (!parsed || parsed.protocol !== "https:") {
            return { success: false, error: "رابط الويب هوك يجب أن يكون رابط https صالحاً." };
        }
    }

    try {
        const { error } = await supabaseAdmin
            .from("workshop_settings")
            .upsert([
                { setting_key: "google_sheets_webhook_url", setting_value: url },
                { setting_key: "google_sheets_sync_enabled", setting_value: String(syncEnabled === true) },
            ], { onConflict: "setting_key" });
        if (error) return { success: false, error: error.message };
        return { success: true };
    } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : "An unexpected error occurred." };
    }
}
