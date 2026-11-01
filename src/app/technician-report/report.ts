// Pure tallying for the technician report: which services each technician did on which
// car, and what they were worth. Kept apart from the page so it can be checked on its own.

// Service key → Arabic label (same set the audit page prints on the invoice).
export const SERVICE_LABELS: Record<string, string> = {
    engineOil: 'زيت المحرك', oilFilter: 'فلتر زيت المحرك', airFilter: 'فلتر الهواء',
    acFilter: 'فلتر التبريد', brakeFluid: 'زيت المكابح', coolant: 'ماء الراديتر',
    battery: 'البطارية', engineBelts: 'قايش المحرك',
    brakePads: 'دسكات السيارة', sparkPlugs: 'شمعات الاحتراق',
    gearboxOil: 'زيت كير', gearboxHydraulic: 'هايدروليك الكير', gearboxFilter: 'فلتر الكير',
    wipers: 'مساحات زجاج', windshieldFluid: 'سائل غسيل جام',
    battery2: 'البطارية فحص دوري', batteryFilter: 'فلتر البطارية',
    engineFlash: 'فلاش المحرك', engineCeramic: 'سيراميك محرك',
    linerCleaner: 'منظف بطانة (جكجكة)', oilLeakPreventer: 'مانع تسريب زيت',
    smokePreventer: 'مانع دخان', gearboxFlash: 'فلاش كير',
    gearboxCeramic: 'سيراميك كير', gearboxAntiSlip: 'مانع انزلاق كير',
    acCleaner: 'منظف دورة تبريد', injectorCleaner: 'منظف بخاخات',
    fuelSystemCleaner: 'منظف نظام وقود', octaneBooster: 'محسن أوكتان',
    additives: 'معالجات ومحسنات', cleaners: 'منظفات وأساسيات',
    transOil: 'زيت ناقل الحركة', differentialOil: 'زيت الدبل / البكك',
    maintenanceUnits: 'وحدات الصيانة'
};

export const UNSET = "غير محدد";

// The parts of a work order's selected_services JSON this report reads. [0] is reception's
// card; any later entries are services the floor appended (name/price).
type PriceEntry = { price?: unknown; status?: string; label?: string; name?: string };
export type SelectedEntry = PriceEntry & {
    is_paper_v2_format?: boolean;
    services?: Record<string, PriceEntry | null>;
    customServices?: PriceEntry[];
    technicians?: { name?: string; rating?: string; notes?: string }[];
    technicianName?: string;
    pricing?: { auditExcluded?: boolean };
};

export type ReportRow = {
    id: string;
    report_number: number;
    status: string;
    created_at: string;
    technician_rating: string | null;
    technician_rating_notes: string | null;
    selected_services: SelectedEntry[] | SelectedEntry | null;
    vehicles: { make: string; model: string; plate_number: string | null } | { make: string; model: string; plate_number: string | null }[] | null;
};

export type ServiceLine = { label: string; price: number };

export type OrderItem = {
    id: string;
    report_number: number;
    date: string;
    status: string;
    vehicle: string;
    lines: ServiceLine[];
    value: number;      // the car's full service value
    techCount: number;  // technicians sharing the car (value is split between them)
};

export type ServiceTally = { label: string; count: number; value: number };

export type TechGroup = {
    name: string;
    cars: number;
    services: number;
    completed: number;
    value: number; // this technician's share
    orders: OrderItem[];
    byService: ServiceTally[];
    ratings: Record<string, number>;
    // Supervisor rating notes, shown in-app only (excluded from the printed report).
    notes: { report_number: number; note: string }[];
};

export const num = (v: unknown) => parseFloat(String(v ?? "").replace(/[^\d.]/g, "")) || 0;

// The work a technician did on a car, with prices: services marked for change (or priced),
// reception's custom services, and the services the floor appended (selected_services[1..]).
export function serviceLines(selected: ReportRow["selected_services"]): ServiceLine[] {
    const arr: SelectedEntry[] = Array.isArray(selected) ? selected : selected ? [selected] : [];
    const payload = arr[0] || {};
    const lines: ServiceLine[] = [];
    Object.entries(payload.services || {}).forEach(([k, v]) => {
        if (!v || v.status === "جيد" || v.status === "سليم") return;
        const price = num(v.price);
        if (v.status === "يحتاج تغيير" || price > 0) lines.push({ label: SERVICE_LABELS[k] || k, price });
    });
    (Array.isArray(payload.customServices) ? payload.customServices : []).forEach((c) => {
        const label = (c?.label || c?.name || "").trim();
        if (label) lines.push({ label, price: num(c.price) });
    });
    arr.slice(1).forEach((e) => {
        if (!e || e.is_paper_v2_format) return;
        const label = (e.name || "").trim();
        if (label) lines.push({ label, price: num(e.price) });
    });
    return lines;
}

// A car may be worked by more than one technician, written as one field joined by
// + - / , ، & or "و" (e.g. "عباس عجل+حسن"). Split it so each technician is credited
// individually instead of creating a shared/combined profile.
export function splitTechnicians(raw: unknown): string[] {
    if (!raw) return [];
    const parts = String(raw)
        .split(/\s*[+\-/،,&]\s*|\s+و\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
    return Array.from(new Set(parts)); // de-dupe within the same car
}

// Canonicalize an Arabic name for *matching* (not for display): unify the common
// data-entry variants — alef/hamza forms, ة/ه, ى/ي, tatweel, diacritics, spacing.
// Names that differ only by these collapse to the same key.
export function normalizeName(raw: string): string {
    return (raw || "")
        .replace(/[ً-ٰٟ]/g, "") // diacritics
        .replace(/ـ/g, "")                 // tatweel ـ
        .replace(/[إأآٱا]/g, "ا")               // alef variants -> ا
        .replace(/ى/g, "ي")                     // alef maqsura -> ي
        .replace(/ؤ/g, "و")
        .replace(/ئ/g, "ي")
        .replace(/ة/g, "ه")                     // ta marbuta -> ه
        .replace(/[^ء-ي٠-٩a-z0-9 ]/gi, " ") // strip punctuation
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

// Levenshtein edit distance (small inputs — names).
export function editDistance(a: string, b: string): number {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
        let prev = dp[0];
        dp[0] = i;
        for (let j = 1; j <= n; j++) {
            const tmp = dp[j];
            dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
            prev = tmp;
        }
    }
    return dp[n];
}

// Two normalized names are "the same technician" when they're identical or within
// a small typo distance. Short names require an exact match to avoid false merges.
export function namesAreClose(a: string, b: string): boolean {
    if (a === b) return true;
    const maxLen = Math.max(a.length, b.length);
    if (maxLen < 4) return false;
    return 1 - editDistance(a, b) / maxLen >= 0.84;
}


export function buildTechReport(rows: ReportRow[]): { groups: TechGroup[]; totalCars: number; totalServices: number; totalValue: number } {
    type Acc = {
        cars: number; services: number; completed: number; value: number; orders: OrderItem[];
        byService: Map<string, ServiceTally>; spellings: Map<string, number>; ratings: Map<string, number>;
        notes: { report_number: number; note: string }[];
    };
    const newAcc = (): Acc => ({ cars: 0, services: 0, completed: 0, value: 0, orders: [], byService: new Map(), spellings: new Map(), ratings: new Map(), notes: [] });
    let totalCars = 0;
    let totalServices = 0;
    let totalValue = 0;

    // Pass 1: each counted card with its technician entries, and every name seen.
    type Entry = { name: string; key: string; rating: string; note: string };
    const cards: { r: ReportRow; lines: ServiceLine[]; value: number; entries: Entry[] }[] = [];
    const allKeys = new Set<string>();
    for (const r of rows) {
        if (r.status === "ملغى") continue;
        const payload = Array.isArray(r.selected_services) ? r.selected_services[0] : r.selected_services;
        // An invoice removed from صفحة التدقيق is junk — no technician gets credit for it.
        if (payload?.pricing?.auditExcluded === true) continue;
        const lines = serviceLines(r.selected_services);
        const value = lines.reduce((s, l) => s + l.price, 0);
        // Totals are per actual car (a shared car is still one car / its services counted once).
        totalCars += 1;
        totalServices += lines.length;
        totalValue += value;

        // Multi-technician: prefer the structured array (each tech carries its OWN rating);
        // fall back to the old joined name + single column rating for legacy orders.
        const techEntries: { name: string; rating: string; note: string }[] = Array.isArray(payload?.technicians) && payload.technicians.length
            ? payload.technicians
                .map((t) => ({ name: (t?.name || "").trim(), rating: t?.rating || "", note: (t?.notes || "").trim() }))
                .filter((t: { name: string }) => t.name)
            : splitTechnicians(payload?.technicianName).map((n: string, i: number) => ({
                name: n, rating: r.technician_rating || "",
                // legacy single-column note belongs to the first technician
                note: i === 0 ? (r.technician_rating_notes || "").trim() : "",
            }));
        const entries: Entry[] = (techEntries.length ? techEntries : [{ name: UNSET, rating: "", note: "" }])
            .map((e) => ({ ...e, key: e.name === UNSET ? UNSET : normalizeName(e.name) }))
            .filter((e) => e.key);
        if (entries.length === 0) entries.push({ name: UNSET, key: UNSET, rating: "", note: "" });
        entries.forEach((e) => allKeys.add(e.key));
        cards.push({ r, lines, value, entries });
    }

    // Cluster near-duplicate normalized keys (typos / different letters) via union-find.
    const keys = [...allKeys];
    const parent = new Map<string, string>();
    keys.forEach((k) => parent.set(k, k));
    const find = (x: string): string => {
        while (parent.get(x) !== x) {
            parent.set(x, parent.get(parent.get(x)!)!);
            x = parent.get(x)!;
        }
        return x;
    };
    const real = keys.filter((k) => k !== UNSET);
    for (let i = 0; i < real.length; i++) {
        for (let j = i + 1; j < real.length; j++) {
            if (namesAreClose(real[i], real[j])) parent.set(find(real[i]), find(real[j]));
        }
    }
    const rootOf = (k: string) => (k === UNSET ? UNSET : find(k));

    // Pass 2: credit each card once per technician (after merging spellings), so two
    // spellings of one name on the same card can't count the car twice.
    const clusters = new Map<string, Acc>();
    for (const { r, lines, value, entries } of cards) {
        const perTech = new Map<string, Entry>();
        for (const e of entries) {
            const root = rootOf(e.key);
            if (!perTech.has(root)) perTech.set(root, e);
        }
        // A shared car's value is split equally, so the technicians' values add up to the total.
        const share = 1 / perTech.size;
        const v = Array.isArray(r.vehicles) ? r.vehicles[0] : r.vehicles;
        const order: OrderItem = {
            id: r.id,
            report_number: r.report_number,
            date: new Date(r.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }),
            status: r.status,
            vehicle: v ? `${v.make || ""} ${v.model || ""}${v.plate_number ? ` (${v.plate_number})` : ""}`.trim() : "—",
            lines,
            value,
            techCount: perTech.size,
        };
        perTech.forEach((entry, root) => {
            let c = clusters.get(root);
            if (!c) { c = newAcc(); clusters.set(root, c); }
            c.cars += 1;
            c.services += lines.length;
            c.value += value * share;
            if (r.status === "تم الانتهاء") c.completed += 1;
            c.orders.push(order);
            for (const l of lines) {
                const t = c.byService.get(l.label) || { label: l.label, count: 0, value: 0 };
                t.count += 1;
                t.value += l.price * share;
                c.byService.set(l.label, t);
            }
            if (entry.rating) c.ratings.set(entry.rating, (c.ratings.get(entry.rating) || 0) + 1);
            if (entry.note) c.notes.push({ report_number: r.report_number, note: entry.note });
        });
        // Display name = most-used original spelling across all cards.
        for (const e of entries) {
            if (e.name === UNSET) continue;
            const c = clusters.get(rootOf(e.key))!;
            c.spellings.set(e.name, (c.spellings.get(e.name) || 0) + 1);
        }
    }

    const groups: TechGroup[] = [...clusters.entries()].map(([root, c]) => {
        let name = UNSET;
        if (root !== UNSET) {
            let best = "", bestN = -1;
            c.spellings.forEach((cnt, sp) => { if (cnt > bestN) { bestN = cnt; best = sp; } });
            name = best || root;
        }
        return {
            name, cars: c.cars, services: c.services, completed: c.completed, value: c.value,
            orders: c.orders.sort((a, b) => b.report_number - a.report_number),
            byService: [...c.byService.values()].sort((a, b) => b.value - a.value || b.count - a.count),
            ratings: Object.fromEntries(c.ratings), notes: c.notes,
        };
    }).sort((a, b) => b.value - a.value || b.cars - a.cars);

    return { groups, totalCars, totalServices, totalValue };
}
