// Employee level ("like a game"): points from the employee's own work since the system started,
// a level with a bar to the next one, and badges. Pure functions so the numbers can be checked
// on their own; the profile page passes in what it already loaded.
//
// Points follow the job: the receptionist sells, the technician works the orders, the shift
// supervisor runs the workshop floor. Nobody earns points for someone else's job.

export type Duty = { sells: boolean; works: boolean; supervises: boolean };

/** What each role is scored on. A shift supervisor who also works the reception counter
 *  (`atReception`) is scored on sales as well; a branch manager runs the plan and does not sell. */
export function dutyOf(role: string | null | undefined, atReception: boolean): Duty {
    if (role === "Technician") return { sells: false, works: true, supervises: false };
    if (role === "Receptionist") return { sells: true, works: false, supervises: false };
    if (role === "Supervisor") return { sells: atReception, works: false, supervises: true };
    if (role === "BranchManager") return { sells: false, works: false, supervises: true };
    return { sells: true, works: false, supervises: true };
}

export type LevelInput = {
    received: { created_at: string; order_type: string | null; services: number }[]; // live orders they received (sold)
    completed: { at: string; rating: number | null }[];                                // live orders they finished as technician
    supervised: { at: string; late: boolean }[];                                       // live finished orders they ran as shift supervisor
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
    supervisedOnTime: 5,
    supervisedLate: -5,
    taskDone: 5,
    complaint: -20,
    complaintResolved: -10,
} as const;

/** The point rules that apply to this duty, for the «شلون تجمع النقاط؟» list. */
export function rulesFor(duty: Duty): [string, number][] {
    return [
        ...(duty.sells ? [["سيارة تستلمها", POINTS.carReceived], ["خدمة تنباع على السيارة", POINTS.serviceSold], ["بيع مباشر", POINTS.directSale]] as [string, number][] : []),
        ...(duty.works ? [["أمر عمل تنجزه", POINTS.orderCompleted], ["تقييم 5 نجوم", POINTS.rating5], ["تقييم 4 نجوم", POINTS.rating4], ["تقييم نجمة أو نجمتين", POINTS.lowRating]] as [string, number][] : []),
        ...(duty.supervises ? [["أمر بإشرافك خلص بوقته", POINTS.supervisedOnTime], ["أمر بإشرافك تأخر", POINTS.supervisedLate]] as [string, number][] : []),
        ["مهمة تنجزها", POINTS.taskDone],
        ["شكوى عليك", POINTS.complaint],
        ["شكوى انحلت", POINTS.complaintResolved],
    ];
}

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
    for (const s of input.supervised) if (inside(s.at)) xp += s.late ? POINTS.supervisedLate : POINTS.supervisedOnTime;
    for (const t of input.tasksDone) if (inside(t.at)) xp += POINTS.taskDone;
    for (const c of input.complaints) if (inside(c.at)) xp += c.resolved ? POINTS.complaintResolved : POINTS.complaint;
    return xp;
}

export type Badge = { key: string; label: string; hint: string; earned: boolean };

export function badgesOf(input: LevelInput, dayOf: (iso: string) => string, monthStart: string, duty: Duty): Badge[] {
    const cars = input.received.filter(r => r.order_type !== "sale").length;
    const rated = input.completed.filter(c => c.rating != null && c.rating > 0);
    const avg = rated.length ? rated.reduce((s, c) => s + Number(c.rating), 0) / rated.length : 0;
    const thisMonth = (iso: string) => dayOf(iso) >= monthStart;
    const workedThisMonth = input.received.some(r => thisMonth(r.created_at)) || input.completed.some(c => thisMonth(c.at)) || input.supervised.some(s => thisMonth(s.at));
    const complaintsThisMonth = input.complaints.filter(c => thisMonth(c.at)).length;
    const supervisedThisMonth = input.supervised.filter(s => thisMonth(s.at));
    return [
        ...(duty.sells ? [
            { key: "cars100", label: "100 سيارة", hint: "استلم 100 سيارة", earned: cars >= 100 },
            { key: "cars500", label: "500 سيارة", hint: "استلم 500 سيارة", earned: cars >= 500 },
        ] : []),
        ...(duty.works ? [
            { key: "orders100", label: "100 أمر منجز", hint: "أنجز 100 أمر عمل", earned: input.completed.length >= 100 },
            { key: "stars", label: "تقييم ممتاز", hint: "معدل 4.5 نجوم أو أكثر على 10 تقييمات", earned: rated.length >= 10 && avg >= 4.5 },
        ] : []),
        ...(duty.supervises ? [
            { key: "floor100", label: "100 أمر بإشرافه", hint: "أشرف على 100 أمر عمل منجز", earned: input.supervised.length >= 100 },
            { key: "ontime", label: "شهر بلا تأخير", hint: "كل الأوامر اللي أشرف عليها هذا الشهر خلصت بوقتها", earned: supervisedThisMonth.length > 0 && supervisedThisMonth.every(s => !s.late) },
        ] : []),
        { key: "clean", label: "شهر بلا شكاوى", hint: "اشتغل هذا الشهر بدون أي شكوى", earned: workedThisMonth && complaintsThisMonth === 0 },
        { key: "tasks", label: "منجز المهام", hint: "أنجز 20 مهمة", earned: input.tasksDone.length >= 20 },
    ];
}
