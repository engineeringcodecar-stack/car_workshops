"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type {
    BranchRow, EmployeeRow, ClientRow, VehicleRow, InspectionReportRow, ReportServiceRow
} from "@/lib/types";

// ─── Generic fetch hook ────────────────────────────────────────
function useTable<T>(table: string) {
    const [data, setData]       = useState<T[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        const { data: rows, error: err } = await (supabase as any)
            .from(table)
            .select("*")
            .order("created_at", { ascending: false });
        if (err) setError(err.message);
        else setData(rows ?? []);
        setLoading(false);
    }, [table]);

    useEffect(() => { fetchData(); }, [fetchData]);
    return { data, loading, error, refetch: fetchData };
}

// ─── Branches ────────────────────────────────────────────────
export function useBranches() { return useTable<BranchRow>("branches"); }

// ─── Employees ──────────────────────────────────────────────
export function useEmployees() { return useTable<EmployeeRow>("employees"); }

// ─── Clients ────────────────────────────────────────────────
export function useClients() { return useTable<ClientRow>("clients"); }
export async function addClient(payload: Omit<ClientRow, "id" | "created_at">) {
    const { error } = await supabase.from("clients").insert(payload);
    if (error) throw error;
}

// ─── Vehicles ───────────────────────────────────────────────
export function useVehicles() { return useTable<VehicleRow>("vehicles"); }

// ─── Inspection Reports ─────────────────────────────────────
export function useInspectionReports() { return useTable<InspectionReportRow>("inspection_reports"); }

// ─── Report Services ────────────────────────────────────────
export function useReportServices() { return useTable<ReportServiceRow>("report_services"); }
