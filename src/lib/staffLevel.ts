// Employee level ("like a game"): points from the employee's own work since the system started,
// a level with a bar to the next one, and badges. Pure functions so the numbers can be checked
// on their own; the profile page passes in what it already loaded.

export type LevelInput = {
    received: { created_at: string; order_type: string | null; services: number }[]; // live orders they received
    completed: { at: string; rating: number | null }[];                                // live orders they finished as technician
    tasksDone: { at: string }[];
    complaints: { at: string; resolved: boolean }[];
};

/** Points per action. Shown on the page so everyone knows how to climb. */
export const POINTS = {
    carReceived: 10,
    directSale: 5,
    serviceSold: 2,
    orderCompleted: 10,
    rating5: 5,
    rating4: 2,
    lowRating: -10,   // 1 or 2 stars
    taskDone: 5,
    complaint: -20,
    complaintResolved: -10,
} as const;

export type Level = { level: number; title: string; xp: number; into: number; span: number; toNext: number };

/** Points needed to go from level L to L+1: 300, 450, 600, … — a busy receptionist (~15 cars a
 *  day) reaches about level 7 in the first month and «أسطورة» (20) after roughly a year. */
const stepOf = (level: number) => 300 + (level - 1) * 150;

export function levelOf(xp: number): Level {
    let level = 1, floor = 0;
    while (xp >= floor + stepOf(level)) { floor += stepOf(level); level++; }
    const span = stepOf(level);
    return { level, title: titleOf(level), xp, into: xp - floor, span, toNext: floor + span - xp };
}

export function titleOf(level: number) {
    if (level >= 20) return "أسطورة";
    if (level >= 15) return "نخبة";
    if (level >= 10) return "خبير";
    if (level >= 6) return "محترف";
    if (level >= 3) return "متدرب";
    return "مبتدئ";
}

/** Points earned in [from, to] (YYYY-MM-DD, by the given day function); no bounds = all time. */
export function pointsOf(input: LevelInput, dayOf: (iso: string) => string, from = "", to = "") {
    const inside = (iso: string) => { const d = dayOf(iso); return (!from || d >= from) && (!to || d <= to); };
    let xp = 0;
    for (const r of input.received) if (inside(r.created_at)) xp += (r.order_type === "sale" ? POINTS.directSale : POINTS.carReceived) + r.services * POINTS.serviceSold;
    for (const c of input.completed) if (inside(c.at)) {
        xp += POINTS.orderCompleted;
        if (c.rating != null && c.rating > 0) xp += c.rating >= 5 ? POINTS.rating5 : c.rating >= 4 ? POINTS.rating4 : c.rating <= 2 ? POINTS.lowRating : 0;
    }
    for (const t of input.tasksDone) if (inside(t.at)) xp += POINTS.taskDone;
    for (const c of input.complaints) if (inside(c.at)) xp += c.resolved ? POINTS.complaintResolved : POINTS.complaint;
    return xp;
}

export type Badge = { key: string; label: string; hint: string; earned: boolean };

export function badgesOf(input: LevelInput, dayOf: (iso: string) => string, monthStart: string): Badge[] {
    const cars = input.received.filter(r => r.order_type !== "sale").length;
    const rated = input.completed.filter(c => c.rating != null && c.rating > 0);
    const avg = rated.length ? rated.reduce((s, c) => s + Number(c.rating), 0) / rated.length : 0;
    const workedThisMonth = input.received.some(r => dayOf(r.created_at) >= monthStart) || input.completed.some(c => dayOf(c.at) >= monthStart);
    const complaintsThisMonth = input.complaints.filter(c => dayOf(c.at) >= monthStart).length;
    return [
        { key: "cars100", label: "100 سيارة", hint: "استلم 100 سيارة", earned: cars >= 100 },
        { key: "cars500", label: "500 سيارة", hint: "استلم 500 سيارة", earned: cars >= 500 },
        { key: "orders100", label: "100 أمر منجز", hint: "أنجز 100 أمر عمل كفني", earned: input.completed.length >= 100 },
        { key: "stars", label: "تقييم ممتاز", hint: "معدل 4.5 نجوم أو أكثر على 10 تقييمات", earned: rated.length >= 10 && avg >= 4.5 },
        { key: "clean", label: "شهر بلا شكاوى", hint: "اشتغل هذا الشهر بدون أي شكوى", earned: workedThisMonth && complaintsThisMonth === 0 },
        { key: "tasks", label: "منجز المهام", hint: "أنجز 20 مهمة", earned: input.tasksDone.length >= 20 },
    ];
}
