// Shared types + math for the HR module (الموارد البشرية → الموظفون).
// All salary/attendance math lives here so the list page, the profile page and
// the summary table can never disagree on a number.

export type HrEmployee = {
    id: string;
    employee_code: string;
    full_name: string;
    photo: string | null;
    job_title: string | null;
    branch_id: string | null;
    phone: string | null;
    hire_date: string | null;
    status: 'active' | 'inactive' | 'leave';
    wage_type: 'hourly' | 'daily';
    wage_rate: number;
    required_monthly_hours: number;
    created_at: string;
};

export type HrAttendance = {
    id: string;
    employee_id: string;
    date: string;              // YYYY-MM-DD
    check_in: string | null;   // HH:MM(:SS)
    check_out: string | null;
    calculated_hours: number;
    attendance_status: string;
    note: string | null;
    created_at?: string;
    updated_at?: string;
};

export const ATTENDANCE_STATUSES = ['حاضر', 'غائب', 'إجازة', 'مأذونية', 'نصف دوام', 'عطلة'] as const;

// Statuses that count as a worked day for daily-wage salaries.
const FULL_DAY_STATUSES = new Set(['حاضر', 'مأذونية']);
const HALF_DAY_STATUSES = new Set(['نصف دوام']);
// Statuses whose hours are forced to 0 even if times were typed by mistake.
export const NO_HOURS_STATUSES = new Set(['غائب', 'إجازة', 'عطلة']);

export const EMP_STATUS_LABEL: Record<HrEmployee['status'], string> = {
    active: 'فعال',
    inactive: 'متوقف',
    leave: 'إجازة',
};

export const EMP_STATUS_STYLE: Record<HrEmployee['status'], string> = {
    active: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    inactive: 'bg-rose-500/10 text-rose-500 border-rose-500/20',
    leave: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
};

export const WAGE_TYPE_LABEL: Record<HrEmployee['wage_type'], string> = {
    hourly: 'بالساعة',
    daily: 'باليومية',
};

export const ATT_STATUS_STYLE: Record<string, string> = {
    'حاضر': 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    'غائب': 'bg-rose-500/10 text-rose-500 border-rose-500/20',
    'إجازة': 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    'مأذونية': 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    'نصف دوام': 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20',
    'عطلة': 'bg-muted text-muted-foreground border-border',
};

/** "HH:MM[:SS]" pair → hours (2 decimals). An out earlier than the in is an
 *  overnight shift, so 24h is added rather than producing a negative. */
export function computeHours(checkIn: string | null | undefined, checkOut: string | null | undefined): number {
    if (!checkIn || !checkOut) return 0;
    const toMinutes = (t: string) => {
        const [h, m] = t.split(':').map(n => parseInt(n, 10));
        if (isNaN(h) || isNaN(m)) return null;
        return h * 60 + m;
    };
    const inMin = toMinutes(checkIn);
    const outMin = toMinutes(checkOut);
    if (inMin === null || outMin === null) return 0;
    let diff = outMin - inMin;
    if (diff < 0) diff += 24 * 60;
    return Math.round((diff / 60) * 100) / 100;
}

/** Hours a record actually contributes (0 for absence-like statuses). */
export function effectiveHours(rec: Pick<HrAttendance, 'calculated_hours' | 'attendance_status'>): number {
    if (NO_HOURS_STATUSES.has(rec.attendance_status)) return 0;
    return Number(rec.calculated_hours || 0);
}

/** Worked days for daily wages: full day = 1, نصف دوام = 0.5. */
export function workedDays(records: Pick<HrAttendance, 'attendance_status'>[]): number {
    let days = 0;
    for (const r of records) {
        if (FULL_DAY_STATUSES.has(r.attendance_status)) days += 1;
        else if (HALF_DAY_STATUSES.has(r.attendance_status)) days += 0.5;
    }
    return days;
}

export function totalHours(records: Pick<HrAttendance, 'calculated_hours' | 'attendance_status'>[]): number {
    return Math.round(records.reduce((s, r) => s + effectiveHours(r), 0) * 100) / 100;
}

/** الراتب: hourly → total hours × rate | daily → worked days × rate. */
export function salaryFor(emp: Pick<HrEmployee, 'wage_type' | 'wage_rate'>, records: Pick<HrAttendance, 'calculated_hours' | 'attendance_status'>[]): number {
    if (emp.wage_type === 'daily') return Math.round(workedDays(records) * Number(emp.wage_rate || 0));
    return Math.round(totalHours(records) * Number(emp.wage_rate || 0));
}

/** Attendance % = achieved hours ÷ required monthly hours × 100 (per employee). */
export function attendancePct(emp: Pick<HrEmployee, 'required_monthly_hours'>, records: Pick<HrAttendance, 'calculated_hours' | 'attendance_status'>[]): number {
    const required = Number(emp.required_monthly_hours || 0);
    if (required <= 0) return 0;
    return Math.min(999, Math.round((totalHours(records) / required) * 100));
}

export function pctColor(pct: number): string {
    if (pct >= 90) return 'text-emerald-500';
    if (pct >= 70) return 'text-amber-500';
    return 'text-rose-500';
}

export function pctBarColor(pct: number): string {
    if (pct >= 90) return 'bg-emerald-500';
    if (pct >= 70) return 'bg-amber-500';
    return 'bg-rose-500';
}

// ─── Local-date helpers (Iraq time = the browser's local time here) ─────────

export function localDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function currentMonthKey(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 'YYYY-MM' → { start: 'YYYY-MM-01', end: 'YYYY-MM-<last>' } */
export function monthRange(ym: string): { start: string; end: string } {
    const [y, m] = ym.split('-').map(n => parseInt(n, 10));
    const last = new Date(y, m, 0).getDate();
    return { start: `${ym}-01`, end: `${ym}-${String(last).padStart(2, '0')}` };
}

export const DAY_NAMES_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** The Sunday that starts the week containing `d` (Iraqi work week: الأحد أول الأسبوع). */
export function weekStartOf(d: Date): Date {
    const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    copy.setDate(copy.getDate() - copy.getDay()); // getDay(): Sunday = 0
    return copy;
}

/** 7 consecutive days starting at `start` (a Sunday), as {date, dayName}. */
export function weekDays(start: Date): { date: string; dayName: string }[] {
    return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        return { date: localDateStr(d), dayName: DAY_NAMES_AR[d.getDay()] };
    });
}

/** All consecutive days from startDate to endDate inclusive (max 120 days). */
export function dateRangeDays(startDateStr: string, endDateStr: string): { date: string; dayName: string }[] {
    if (!startDateStr || !endDateStr) return [];
    let startD = new Date(startDateStr + 'T00:00:00');
    let endD = new Date(endDateStr + 'T00:00:00');
    if (isNaN(startD.getTime()) || isNaN(endD.getTime())) return [];
    if (startD > endD) {
        const tmp = startD;
        startD = endD;
        endD = tmp;
    }
    const days: { date: string; dayName: string }[] = [];
    const cur = new Date(startD);
    let count = 0;
    while (cur <= endD && count < 120) {
        days.push({ date: localDateStr(cur), dayName: DAY_NAMES_AR[cur.getDay()] });
        cur.setDate(cur.getDate() + 1);
        count++;
    }
    return days;
}

/** Convert Arabic-Indic numerals (٠-٩) to western digits (0-9). */
export function normalizeArabicDigits(str: string): string {
    return (str || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString());
}

/** Parse any time representation into standard "HH:MM" (24-hour). Supports AM/PM, ص/م, and seconds. */
export function parseTimeString(raw: string): string | null {
    if (!raw) return null;
    const clean = normalizeArabicDigits(raw).trim();
    // Matches e.g. "11:45", "08:30:00", "11:45 AM", "1:15pm", "8:30 ص", "5:30 م"
    const m = clean.match(/^(\d{1,2})[:.](\d{1,2})(?:[:.]\d{1,2})?\s*(am|pm|ص|م|صباحا|صباحاً|مساء|مساءً)?$/i);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const suffix = (m[3] || '').toLowerCase();
    if (min < 0 || min > 59) return null;

    if (suffix === 'pm' || suffix === 'م' || suffix === 'مساء' || suffix === 'مساءً') {
        if (h < 12) h += 12;
    } else if (suffix === 'am' || suffix === 'ص' || suffix === 'صباحا' || suffix === 'صباحاً') {
        if (h === 12) h = 0;
    }
    if (h < 0 || h > 23) return null;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const TIME_MARKER = /(am|pm|ص|م|صباحا|صباحاً|مساء|مساءً)\s*$/i;

/** Pasted sheets often write a 12-hour day with no ص/م: "8:30" in, "5:00" out. parseTimeString
 *  reads the out as 05:00, which computeHours then treats as an overnight ~20.5 h shift. When
 *  neither raw time has a marker, both look like a 12-hour clock and the out is not after the in,
 *  read the out as PM if that gives a plausible shift (under 16 h); otherwise keep it, so a real
 *  overnight shift still falls through to computeHours' +24h rule. Returns the (maybe) fixed out. */
export function resolveUnmarkedCheckout(rawIn: string, rawOut: string, checkIn: string, checkOut: string): string {
    if (TIME_MARKER.test(normalizeArabicDigits(rawIn).trim()) || TIME_MARKER.test(normalizeArabicDigits(rawOut).trim())) return checkOut;
    const [ih, im] = checkIn.split(':').map(n => parseInt(n, 10));
    const [oh, om] = checkOut.split(':').map(n => parseInt(n, 10));
    // An hour above 12 means the sheet is on a 24-hour clock — nothing to guess.
    if (ih > 12 || oh >= 12) return checkOut;
    const inMin = ih * 60 + im;
    const outMin = oh * 60 + om;
    if (outMin > inMin) return checkOut;
    const pmShift = outMin + 12 * 60 - inMin;
    if (pmShift > 0 && pmShift < 16 * 60) return `${String(oh + 12).padStart(2, '0')}:${String(om).padStart(2, '0')}`;
    return checkOut;
}

/** Parse various date formats (YYYY-MM-DD, DD/MM/YYYY, etc.) into "YYYY-MM-DD". */
export function parseDateString(raw: string): string | null {
    if (!raw) return null;
    const clean = normalizeArabicDigits(raw).trim();
    // YYYY-MM-DD or YYYY/MM/DD
    let m = clean.match(/^(\d{4})[-/. ](\d{1,2})[-/. ](\d{1,2})$/);
    if (m) {
        const y = parseInt(m[1], 10);
        const mon = parseInt(m[2], 10);
        const day = parseInt(m[3], 10);
        if (y >= 2000 && y <= 2099 && mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
            return `${y}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
    }
    // DD-MM-YYYY or DD/MM/YYYY
    m = clean.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4})$/);
    if (m) {
        const day = parseInt(m[1], 10);
        const mon = parseInt(m[2], 10);
        const y = parseInt(m[3], 10);
        if (y >= 2000 && y <= 2099 && mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
            return `${y}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
    }
    return null;
}

/** Normalize attendance status token. */
export function normalizeAttendanceStatus(raw: string): string | null {
    if (!raw) return null;
    const t = raw.trim().toLowerCase();
    if (['حاضر', 'حضور', 'present', 'p', 'v', '1'].includes(t)) return 'حاضر';
    if (['غائب', 'غياب', 'غايب', 'absent', 'a', 'x', '0'].includes(t)) return 'غائب';
    if (['إجازة', 'اجازة', 'اجازه', 'إجازة', 'leave', 'vacation', 'l'].includes(t)) return 'إجازة';
    if (['مأذونية', 'ماذونية', 'استئذان', 'permission'].includes(t)) return 'مأذونية';
    if (['نصف دوام', 'نص دوام', 'نصف', 'half', 'half day', 'h'].includes(t)) return 'نصف دوام';
    if (['عطلة', 'عطله', 'جمعة', 'جمعه', 'off', 'holiday', 'weekend'].includes(t)) return 'عطلة';
    return null;
}

export type ParsedPastedRow = {
    date?: string;
    check_in?: string;
    check_out?: string;
    status?: string;
    note?: string;
    rawText: string;
};

/** Parse pasted clipboard / Excel / CSV text into structured attendance entries. */
export function parsePastedAttendanceTable(text: string): ParsedPastedRow[] {
    if (!text) return [];
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const results: ParsedPastedRow[] = [];

    for (const line of lines) {
        // Skip obvious header rows
        const lower = line.toLowerCase();
        if (lower.includes('حضور') && lower.includes('انصراف')) continue;
        if (lower.includes('check in') || lower.includes('check out') || lower.includes('check_in')) continue;
        if (lower.includes('التاريخ') && (lower.includes('الوقت') || lower.includes('الحالة') || lower.includes('اليوم'))) continue;

        // Split by tabs, commas, semicolons, or 2+ consecutive spaces
        const tokens = line.split(/\t|,|;|\s{2,}/).map(t => t.trim()).filter(Boolean);
        if (tokens.length === 0) continue;

        let foundDate: string | undefined;
        let foundIn: string | undefined;
        let foundOut: string | undefined;
        let rawIn = '';
        let rawOut = '';
        let foundStatus: string | undefined;
        const leftoverNotes: string[] = [];

        for (const token of tokens) {
            // Check for date
            if (!foundDate) {
                const d = parseDateString(token);
                if (d) {
                    foundDate = d;
                    continue;
                }
            }

            // Check for time
            const t = parseTimeString(token);
            if (t) {
                if (!foundIn) {
                    foundIn = t;
                    rawIn = token;
                    continue;
                } else if (!foundOut) {
                    foundOut = t;
                    rawOut = token;
                    continue;
                }
            }

            // Check for status
            if (!foundStatus) {
                const s = normalizeAttendanceStatus(token);
                if (s) {
                    foundStatus = s;
                    continue;
                }
            }

            // Ignore day names like "السبت", "الأحد", etc.
            if (DAY_NAMES_AR.includes(token) || ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].includes(token.toLowerCase())) {
                continue;
            }

            // Otherwise, keep as note
            leftoverNotes.push(token);
        }

        if (foundIn && foundOut) foundOut = resolveUnmarkedCheckout(rawIn, rawOut, foundIn, foundOut);

        // If we found any relevant field
        if (foundDate || foundIn || foundOut || foundStatus) {
            results.push({
                date: foundDate,
                check_in: foundIn,
                check_out: foundOut,
                status: foundStatus || (foundIn || foundOut ? 'حاضر' : undefined),
                note: leftoverNotes.join(' - ') || undefined,
                rawText: line,
            });
        }
    }

    return results;
}

/** Downscale a picked image file to a small square JPEG data-URL (~15-30KB)
 *  so employee photos live inline in the row — no storage bucket needed. */
export function fileToAvatarDataUrl(file: File, size = 256): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('read failed'));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('decode failed'));
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext('2d');
                if (!ctx) return reject(new Error('canvas failed'));
                // Cover-crop to a square from the center.
                const side = Math.min(img.width, img.height);
                const sx = (img.width - side) / 2;
                const sy = (img.height - side) / 2;
                ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
                resolve(canvas.toDataURL('image/jpeg', 0.82));
            };
            img.src = reader.result as string;
        };
        reader.readAsDataURL(file);
    });
}
