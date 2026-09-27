"use client";

import { Landmark } from "lucide-react";
import type { Contract } from "@/lib/contracts";

/** "جهة التعاقد" picker shared by every intake form. Empty value = an ordinary
 *  (cash) customer. Renders nothing when no contracts exist, so branches that
 *  never deal with a contract see no extra field. */
export default function ContractSelect({
    contracts, value, onChange, className = "",
}: {
    contracts: Contract[];
    value: string;
    onChange: (id: string) => void;
    className?: string;
}) {
    if (contracts.length === 0) return null;
    const selected = contracts.find(c => c.id === value);
    return (
        <div className={`space-y-2 ${className}`}>
            <label className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <Landmark size={14} className="text-amber-400" /> جهة التعاقد
            </label>
            <select
                value={value}
                onChange={e => onChange(e.target.value)}
                className={`input-field cursor-pointer ${selected ? "border-amber-500/60 text-amber-300 font-bold" : ""}`}
            >
                <option value="">زبون عادي (نقدي)</option>
                {contracts.map(c => (
                    <option key={c.id} value={c.id}>عقد {c.name} (آجل)</option>
                ))}
            </select>
            {selected && (
                <p className="text-[11px] text-amber-400/90 leading-relaxed">
                    يُسجَّل على عقد {selected.name} بالآجل ويظهر في تبويب العقود الحكومية.
                </p>
            )}
        </div>
    );
}
