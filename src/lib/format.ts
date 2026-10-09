// Number formatting helpers for inputs and display.
//
// Design: component state always stays as a RAW digit string (e.g. "70000").
// Only the *display* gets thousands separators ("70,000"). This means existing
// save logic (parseInt / Number on the raw state) keeps working unchanged — the
// stored value never contains commas.

/** Arabic-Indic digits (٠١٢ / ۰۱۲) and the Arabic decimal point (٫) -> Latin, so "٤٫٤" reads as "4.4". */
export function toLatinDigits(value: string): string {
    return (value ?? "")
        .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
        .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0))
        .replace(/\u066B/g, ".")
        .replace(/\u066C/g, ",");
}

/** Display a value with thousands separators: 70000 -> "70,000". Empty -> "". */
export function withCommas(value: string | number | null | undefined): string {
    if (value === null || value === undefined || value === "") return "";
    const raw = toLatinDigits(String(value)).replace(/,/g, "").trim();
    // A computed amount like 4.4 × 25 = "110.00000000000001" must show as 110. Stripping
    // the "." instead turned it into 11,000,000,000,000,000.
    const n = Number(raw);
    if (raw !== "" && Number.isFinite(n)) return Math.round(n).toLocaleString("en-US");
    const digits = raw.replace(/[^\d]/g, "");
    if (digits === "") return "";
    return Number(digits).toLocaleString("en-US");
}

/** Keep only digits — used in input onChange so state stays raw. */
export function digitsOnly(value: string): string {
    return toLatinDigits(value).replace(/[^\d]/g, "");
}

/** Keep digits and a single decimal point (e.g. "1.5") — for quantities/prices that may be fractional. */
export function decimalsOnly(value: string): string {
    let v = toLatinDigits(value).replace(/[^\d.]/g, "");
    const firstDot = v.indexOf(".");
    if (firstDot !== -1) {
        // collapse any extra dots after the first one
        v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, "");
    }
    return v;
}

/**
 * Display a possibly-fractional value with thousands separators on the integer
 * part, preserving the decimal part (and a trailing dot while typing):
 * "1500.5" -> "1,500.5", "1." -> "1.". Empty -> "".
 */
export function withCommasDecimal(value: string | number | null | undefined): string {
    if (value === null || value === undefined || value === "") return "";
    const cleaned = decimalsOnly(String(value));
    if (cleaned === "" || cleaned === ".") return "";
    const dot = cleaned.indexOf(".");
    const intPart = dot === -1 ? cleaned : cleaned.slice(0, dot);
    const decPart = dot === -1 ? null : cleaned.slice(dot + 1);
    const intFmt = intPart === "" ? "0" : Number(intPart).toLocaleString("en-US");
    return decPart === null ? intFmt : `${intFmt}.${decPart}`;
}
