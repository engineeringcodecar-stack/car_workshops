import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, UserRole } from "./types";
import { AUTH_COOKIE_NAME } from "./supabase-cookie";

// Roles allowed to manage other user accounts.
const ADMIN_ROLES: UserRole[] = ["Owner", "Admin"];

/**
 * Cookie-based Supabase client for use in Server Components, Server Actions and
 * Route Handlers. It reads the caller's session from the request cookies, so it
 * is subject to RLS and represents the *actual logged-in user* — never use the
 * anon client to make trust decisions without first validating with getUser().
 */
export async function createSupabaseServerClient() {
    const cookieStore = await cookies();

    return createServerClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            // Must match the browser client exactly — see supabase-cookie.ts.
            cookieOptions: { name: AUTH_COOKIE_NAME },
            cookies: {
                getAll() {
                    return cookieStore.getAll();
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        );
                    } catch {
                        // setAll can be called from a Server Component, where writing
                        // cookies is not allowed. Safe to ignore — the session refresh
                        // will be persisted on the next request that can write cookies.
                    }
                },
            },
        }
    );
}

/** Build a service-role admin client (bypasses RLS). Server-only. */
function createSupabaseAdminClient(): SupabaseClient<Database> | null {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) return null;

    return createClient<Database>(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
}

export type AdminGuardResult =
    | { ok: true; supabaseAdmin: SupabaseClient<Database>; userId: string; role: UserRole }
    | { ok: false; error: string };

export type UserManagerGuardResult =
    | {
          ok: true;
          supabaseAdmin: SupabaseClient<Database>;
          userId: string;
          role: UserRole;
          /**
           * Owner/Admin. Only they may hand out (or touch) Owner/Admin accounts.
           * Owner accounts and the Owner role stay Owner-only: check `role` for those.
           */
          isAdmin: boolean;
      }
    | { ok: false; error: string };

type CallerResult =
    | {
          ok: true;
          supabaseAdmin: SupabaseClient<Database>;
          userId: string;
          role: UserRole;
          canManageUsers: boolean;
      }
    | { ok: false; error: string };

/**
 * Identify the caller and load the fields the guards below decide on.
 *
 * `getUser()` validates the JWT against the Supabase auth server, so the identity
 * cannot be spoofed by a forged cookie. Errors are returned in Arabic because they
 * are shown verbatim to staff in the Settings screen.
 */
async function resolveCaller(): Promise<CallerResult> {
    const supabaseAdmin = createSupabaseAdminClient();
    if (!supabaseAdmin) {
        return {
            ok: false,
            error:
                "إعدادات الخادم ناقصة: مفتاح SUPABASE_SERVICE_ROLE_KEY غير مضبوط. " +
                "أضفه في متغيرات البيئة (Environment Variables) وأعد النشر.",
        };
    }

    const serverClient = await createSupabaseServerClient();
    const {
        data: { user },
        error: userError,
    } = await serverClient.auth.getUser();

    if (userError || !user) {
        return { ok: false, error: "انتهت الجلسة. سجّل الخروج ثم الدخول من جديد وأعد المحاولة." };
    }

    const { data: employee, error: roleError } = await supabaseAdmin
        .from("employees")
        .select("role, permission_employees")
        .eq("auth_id", user.id)
        .limit(1)
        .maybeSingle();

    if (roleError) {
        return { ok: false, error: `تعذّر قراءة صلاحيات المستخدم: ${roleError.message}` };
    }
    if (!employee) {
        return { ok: false, error: "لا يوجد سجل موظف مرتبط بهذا الحساب. راجع المالك." };
    }

    return {
        ok: true,
        supabaseAdmin,
        userId: user.id,
        role: employee.role,
        canManageUsers: ADMIN_ROLES.includes(employee.role) || employee.permission_employees === true,
    };
}

/**
 * Strict gate: Owner/Admin only. For actions that go beyond account management
 * (e.g. the AI assistant, which runs arbitrary read-only SQL).
 */
export async function requireAdmin(): Promise<AdminGuardResult> {
    const caller = await resolveCaller();
    if (!caller.ok) return caller;

    if (!ADMIN_ROLES.includes(caller.role)) {
        return { ok: false, error: "هذا الإجراء مسموح للمالك أو مدير النظام فقط." };
    }

    return { ok: true, supabaseAdmin: caller.supabaseAdmin, userId: caller.userId, role: caller.role };
}

/**
 * Gate for managing staff accounts.
 *
 * This mirrors what the Settings page actually shows: Owner/Admin, PLUS anyone
 * carrying the `permission_employees` flag. Previously the page opened for the
 * flag but every action here demanded Owner/Admin, so supervisors saw the buttons
 * and every single save failed with "Forbidden".
 *
 * `isAdmin` is returned so callers can still keep the sharp edges (creating,
 * editing or deleting Owner/Admin accounts) reserved for real admins — otherwise
 * the flag would be a self-promotion path.
 */
export async function requireUserManager(): Promise<UserManagerGuardResult> {
    const caller = await resolveCaller();
    if (!caller.ok) return caller;

    if (!caller.canManageUsers) {
        return { ok: false, error: "ليس لديك صلاحية إدارة المستخدمين. اطلب من المالك تفعيل صلاحية «الموظفون»." };
    }

    return {
        ok: true,
        supabaseAdmin: caller.supabaseAdmin,
        userId: caller.userId,
        role: caller.role,
        isAdmin: ADMIN_ROLES.includes(caller.role),
    };
}
