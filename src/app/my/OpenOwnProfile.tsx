"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/AuthProvider";

/**
 * «حسابي الشخصي» in the sidebar: opens the signed-in employee's own profile. The id comes from
 * the session (AuthProvider), never from the address, so this only ever leads to their own page.
 */
export default function OpenOwnProfile() {
    const router = useRouter();
    const { employeeId, loading } = useAuth();

    useEffect(() => {
        if (loading || !employeeId) return;
        router.replace(`/employees/${employeeId}`);
    }, [loading, employeeId, router]);

    return (
        <div className="min-h-screen flex items-center justify-center" dir="rtl">
            {loading || employeeId
                ? <Loader2 className="animate-spin text-muted-foreground" />
                : <div className="glass-card p-8 rounded-2xl text-center">لا يوجد ملف موظف مرتبط بهذا الحساب. راجع الإدارة.</div>}
        </div>
    );
}
