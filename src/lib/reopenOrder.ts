import { supabase } from "./supabase";

/**
 * Send a finished order back to the workshop floor (قيد العمل).
 *
 * If the invoice was ALREADY accounted, reopening also UN-accounts it: the
 * audit's grandTotal/accounted/accountedAt/amountReceived stamps are removed and
 * total_price keeps the agreed net (see below), so once the new work is finished
 * the invoice returns to بانتظار المحاسبة and is settled again like a fresh close.
 *
 * Leaving the stamps in place (what all three reopen buttons used to do) meant
 * a reopened order skipped re-accounting entirely, while services added during
 * the new work bumped total_price underneath the frozen grandTotal — the audit
 * card then showed figures from two different closings at once.
 */
export async function reopenWorkOrder(id: string): Promise<{ error: { message: string } | null }> {
    const { data } = await supabase
        .from("inspection_reports")
        .select("selected_services, total_price")
        .eq("id", id)
        .single();

    const update: Record<string, unknown> = {
        status: "قيد العمل",
        start_time: new Date().toISOString(),
        completed_at: null,
    };

    const raw: unknown = data?.selected_services;
    const arr: any[] = Array.isArray(raw) ? [...raw] : raw ? [raw] : [];
    const pricing = arr[0]?.pricing;
    if (pricing?.accounted === true) {
        const cleared = { ...pricing };
        delete cleared.accounted;
        delete cleared.accountedAt;
        delete cleared.grandTotal;
        // amountReceived now holds what the audit collected, and the audit prefills its
        // «الواصل» from it — kept, a re-close silently reused the old figure. Removing it
        // gives the fresh-close default (full net, or 0 for a contract).
        delete cleared.amountReceived;
        arr[0] = { ...arr[0], pricing: cleared };
        update.selected_services = arr;
        // total_price stays the NET (grandTotal − audit discount). The audit never prefills
        // its discount, so restoring the gross made the re-close silently drop the discount
        // the accountant already granted. Keeping it baked in matches reception's convention:
        // pricing.discount is a discount already inside total_price, so the reception edit
        // form and the print read it consistently, and the audit only adds any EXTRA discount.
        const gross = parseFloat(String(pricing.grandTotal ?? "")) || 0;
        const disc = parseFloat(String(pricing.discount ?? "")) || 0;
        if (gross > 0) update.total_price = Math.max(0, gross - disc);
    }

    const { error } = await supabase.from("inspection_reports").update(update).eq("id", id);
    return { error };
}
