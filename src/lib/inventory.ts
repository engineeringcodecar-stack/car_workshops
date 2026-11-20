export type InventoryPackaging = {
    quantity: number | string | null;
    base_unit?: string | null;
    unit1?: string | null;
    unit2?: string | null;
    unit3?: string | null;
    unit1_to_unit2?: number | string | null;
    unit2_to_unit3?: number | string | null;
    sell_price?: number | string | null;
    price_unit1?: number | string | null;
    price_unit2?: number | string | null;
    price_unit3?: number | string | null;
};

export type PackagingOption = {
    unit: string;
    price: number | null;
    stockPerUnit: number;
    available: number;
};

export const INVENTORY_UNITS = ["كارتون", "دبة", "لتر", "قطعة", "غالون", "علبة", "طقم", "زوج", "سطل", "برميل"];

export function parseInventoryNumber(value: unknown): number | null {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (value === null || value === undefined) return null;
    const normalized = String(value)
        .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
        .replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
        .replace(/٬/g, ",").replace(/٫/g, ".")
        .replace(/د\.?\s*ع|IQD/gi, "").replace(/,/g, "").trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

export function getBaseUnit(item: InventoryPackaging): string {
    return String(item.base_unit || item.unit1 || "قطعة").trim();
}

function factors(item: InventoryPackaging) {
    const f1 = parseInventoryNumber(item.unit1_to_unit2) || 1;
    const f2 = parseInventoryNumber(item.unit2_to_unit3) || 1;
    if (f1 <= 0 || f2 <= 0) throw new Error("معاملات التعبئة يجب أن تكون أكبر من صفر.");
    const smallestPerUnit1 = item.unit3 ? f1 * f2 : item.unit2 ? f1 : 1;
    const smallestPerUnit2 = item.unit3 ? f2 : 1;
    const smallFor = (unit: string) => {
        if (unit === item.unit1) return smallestPerUnit1;
        if (unit === item.unit2) return smallestPerUnit2;
        if (unit === item.unit3) return 1;
        return null;
    };
    const smallestPerBase = smallFor(getBaseUnit(item)) ?? 1;
    return { f1, f2, smallestPerUnit1, smallestPerUnit2, smallestPerBase, smallFor };
}

export function stockUnitsPerPackage(item: InventoryPackaging, unit: string): number {
    const { smallestPerBase, smallFor } = factors(item);
    const smallestPerUnit = smallFor(unit) ?? (unit === getBaseUnit(item) ? smallestPerBase : null);
    if (!smallestPerUnit) throw new Error(`وحدة التعبئة «${unit}» غير معرفة لهذه المادة.`);
    return smallestPerUnit / smallestPerBase;
}

export function priceForPackage(item: InventoryPackaging, unit: string): number | null {
    const base = getBaseUnit(item);
    const basePrice = parseInventoryNumber(item.sell_price);
    if (unit === base) return basePrice;
    const explicit = unit === item.unit1 ? parseInventoryNumber(item.price_unit1)
        : unit === item.unit2 ? parseInventoryNumber(item.price_unit2)
        : unit === item.unit3 ? parseInventoryNumber(item.price_unit3)
        : null;
    if (explicit !== null) return explicit;
    if (basePrice === null) return null;
    return Math.round(basePrice * stockUnitsPerPackage(item, unit) * 100) / 100;
}

export function packagingOptions(item: InventoryPackaging): PackagingOption[] {
    const availableStock = parseInventoryNumber(item.quantity) || 0;
    const candidates = [...new Set([getBaseUnit(item), item.unit1, item.unit2, item.unit3].filter((u): u is string => !!u?.trim()))];
    return candidates.map(unit => {
        const price = priceForPackage(item, unit);
        const stockPerUnit = stockUnitsPerPackage(item, unit);
        return { unit, price, stockPerUnit, available: stockPerUnit > 0 ? availableStock / stockPerUnit : 0 };
    });
}

export function deriveBaseQuantity(row: Record<string, unknown>): number | null {
    const base = String(row.base_unit || row.unit1 || "قطعة").trim();
    const direct = parseInventoryNumber(row.quantity);
    if (direct !== null) return direct;
    const q1 = parseInventoryNumber(row.qty_unit1);
    const q2 = parseInventoryNumber(row.qty_unit2);
    const q3 = parseInventoryNumber(row.qty_unit3);
    const f1 = parseInventoryNumber(row.unit1_to_unit2) || 1;
    const f2 = parseInventoryNumber(row.unit2_to_unit3) || 1;
    const smallPerUnit1 = row.unit3 ? f1 * f2 : row.unit2 ? f1 : 1;
    const smallPerUnit2 = row.unit3 ? f2 : 1;
    const smallPerBase = base === row.unit1 ? smallPerUnit1 : base === row.unit2 ? smallPerUnit2 : 1;
    if (q3 !== null) return q3 / smallPerBase;
    if (q2 !== null) return q2 * smallPerUnit2 / smallPerBase;
    if (q1 !== null) return q1 * smallPerUnit1 / smallPerBase;
    return null;
}

export function formatInventoryStock(item: InventoryPackaging): string {
    const quantity = parseInventoryNumber(item.quantity);
    if (quantity === null) return "—";
    const { smallestPerUnit1, smallestPerUnit2, smallestPerBase } = factors(item);
    if (!item.unit2 && !item.unit3) return `${quantity.toLocaleString("en-US")} ${getBaseUnit(item)}`;
    let remainder = quantity * smallestPerBase;
    const parts: string[] = [];
    const take = (amount: number, unit?: string | null) => {
        if (!unit || amount <= 0) return;
        const count = Math.floor(remainder / amount + 1e-9);
        if (count > 0) {
            parts.push(`${count.toLocaleString("en-US")} ${unit}`);
            remainder -= count * amount;
        }
    };
    take(smallestPerUnit1, item.unit1);
    if (item.unit2) take(smallestPerUnit2, item.unit2);
    if (item.unit3 && remainder > 1e-8) parts.push(`${Number(remainder.toFixed(6)).toLocaleString("en-US")} ${item.unit3}`);
    else if (item.unit2 && remainder > 1e-8) parts.push(`${Number((remainder / smallestPerUnit2).toFixed(6)).toLocaleString("en-US")} ${item.unit2}`);
    if (!parts.length) return `0 ${getBaseUnit(item)}`;
    return parts.join(" و ");
}

export function normalizeInventoryHeader(value: unknown): string {
    return String(value ?? "").trim().replace(/[\sـ]+/g, "").replace(/[أإآ]/g, "ا").toLowerCase();
}
