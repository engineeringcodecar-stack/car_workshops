"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/AuthProvider";

/**
 * «مهامي» and «حسابي الشخصي» in the sidebar: open the signed-in employee's own profile, so
 * nobody needs a link from the manager. The id comes from the session (AuthProvider), never
 * from the address, so this can only ever lead to the employee's own page.
 */
export default function OpenOwnProfile({ section }: { section?: "tasks" }) {
    const router = useRouter();
    const { employeeId, loading } = useAuth();

    useEffect(() => {
        if (loading || !employeeId) return;
        router.replace(`/employees/${employeeId}${section ? `#${section}` : ""}`);
    }, [loading, employeeId, section, router]);

    return (
        <div className="min-h-screen flex items-center justify-center" dir="rtl">
            {loading || employeeId
                ? <Loader2 className="animate-spin text-muted-foreground" />
                : <div className="glass-card p-8 rounded-2xl text-center">لا يوجد ملف موظف مرتبط بهذا الحساب. راجع الإدارة.</div>}
        </div>
    );
}
