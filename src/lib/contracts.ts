// Government contracts (عقود) — e.g. محافظة ميسان.
//
// A contract is a body we service on credit (نظام الآجل). Its cars go through the
// normal reception → floor → audit flow; every one of its orders simply carries
// inspection_reports.contract_id. That tag is what gives the contract its own tab,
// statement and payment ledger (see supabase/migrations/20260928_contracts.sql).

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type Contract = { id: string; name: string };

/** Active contracts, loaded once per mount. A tiny table that almost never
 *  changes — deliberately no realtime subscription on it. */
export function useContracts(): Contract[] {
    const [contracts, setContracts] = useState<Contract[]>([]);
    useEffect(() => {
        let alive = true;
        supabase.from("contracts").select("id, name").eq("is_active", true).order("name")
            .then(({ data }) => { if (alive && data) setContracts(data); });
        return () => { alive = false; };
    }, []);
    return contracts;
}

/** The contract this vehicle was last serviced under, so a returning government
 *  car comes back already tagged. null = an ordinary customer. */
export async function lastContractForVehicle(vehicleId: string): Promise<string | null> {
    const { data } = await supabase.from("inspection_reports")
        .select("contract_id")
        .eq("vehicle_id", vehicleId)
        .not("contract_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);
    return data?.[0]?.contract_id ?? null;
}

const num = (v: unknown) => parseFloat(String(v ?? "").replace(/[^\d.]/g, "")) || 0;

export type InvoiceState = "closed" | "pending" | "excluded" | "cancelled";

/** Where one contract invoice stands, and its money — read from the exact
 *  pricing fields the audit page writes when it closes an invoice, so the
 *  contract statement can never disagree with التدقيق والمحاسبة.
 *
 *  closed    counted in the balance: net is owed, received was paid at close
 *  pending   not accounted yet — shown separately, not yet owed
 *  excluded  removed from accounting as junk — ignored entirely
 *  cancelled ملغى — ignored entirely */
export function invoiceMoney(row: {
    status?: string | null;
    total_price?: number | string | null;
    pricing?: Record<string, unknown> | null;
}): { state: InvoiceState; net: number; received: number } {
    const p = row.pricing || {};
    if (row.status === "ملغى") return { state: "cancelled", net: 0, received: 0 };
    if (p.auditExcluded === true) return { state: "excluded", net: 0, received: 0 };
    if (p.accounted === true) {
        // After closing, total_price already holds the net; grandTotal − discount is
        // the same figure, and is the one to trust if they ever disagree.
        const hasGrand = p.grandTotal !== undefined && p.grandTotal !== null && p.grandTotal !== "";
        const net = hasGrand ? Math.max(0, num(p.grandTotal) - num(p.discount)) : num(row.total_price);
        return { state: "closed", net, received: Math.min(net, num(p.amountReceived)) };
    }
    return { state: "pending", net: num(row.total_price), received: 0 };
}
