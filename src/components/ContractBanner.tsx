"use client";

import { Landmark } from "lucide-react";
import type { Contract } from "@/lib/contracts";

/** Shown on an intake form that was opened from the contracts tab. Read-only on
 *  purpose: reception never chooses the contract — the "إنشاء ورقة عمل" link it
 *  came from does. Renders nothing for an ordinary customer. */
export default function ContractBanner({
    contracts, contractId, label = "ورقة عمل", className = "",
}: {
    contracts: Contract[];
    contractId: string;
    label?: string;
    className?: string;
}) {
    if (!contractId) return null;
    const name = contracts.find(c => c.id === contractId)?.name;
    return (
        <div className={`flex items-center gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-300 ${className}`}>
            <Landmark size={20} className="shrink-0" />
            <div>
                <div className="font-bold text-sm">{label} على عقد {name || "حكومي"} (آجل)</div>
                <div className="text-[11px] text-amber-400/80">تُسجَّل على حساب العقد وتظهر في تبويب العقود الحكومية.</div>
            </div>
        </div>
    );
}
