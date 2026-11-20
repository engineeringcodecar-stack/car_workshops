"use client";

import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Download, FileUp, Loader2, Package, RefreshCw, Search, ShieldAlert, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthProvider";
import { showConfirm, showError, showSuccess } from "@/lib/alerts";
import {
    deriveBaseQuantity, formatInventoryStock, INVENTORY_UNITS, normalizeInventoryHeader,
    parseInventoryNumber, packagingOptions, stockUnitsPerPackage,
} from "@/lib/inventory";

type Branch = { id: string; name: string };
type ImportMode = "full" | "new" | "quantities" | "prices";
type InventoryRow = {
    id: string; branch_id: string; item_code: string; murabba_id: string | null; name: string;
    category: string | null; quantity: number; min_quantity: number | null; purchase_price: number | null;
    sell_price: number; special_price: number | null; price_wholesale: number | null; last_purchase_price: number | null;
    base_unit: string | null; unit1: string | null; unit2: string | null; unit3: string | null;
    unit1_to_unit2: number | null; unit2_to_unit3: number | null; price_unit1: number | null;
    price_unit2: number | null; price_unit3: number | null; supplier: string | null; store: string | null;
    location: string | null; created_at: string | null; branches?: { name: string } | null;
};
type ParsedRow = Record<string, unknown> & { __row: number; __key: string };
type Preview = { mode: ImportMode; fileName: string; sheetName: string; rows: ParsedRow[]; warnings: string[] };

const MODE_LABEL: Record<ImportMode, string> = {
    full: "تحميل/تحديث المخزن الكامل",
    new: "مواد جديدة",
    quantities: "تحديث الكميات",
    prices: "تحديث الأسعار",
};

const INVENTORY_HEADERS = [
    "آخر شراء", "سعر التعئبة 3", "سعر التعئبة 2", "عدد3", "تاريخ الاضافة", "عدد تعبئة 2", "عدد تعبئة 1",
    "الحد الأدنى", "الشركة", "تعبئة3", "تعبئة2", "تعبئة1", "التعبئة", "موجود المخزن", "المجموعة",
    "المخزن", "سعر الجملة", "عدد2", "عدد1", "سعر الشراء", "سعر العام", "العدد", "إسم المادة", "ت", "الفرع",
];
const NEW_ITEM_HEADERS = [
    ...INVENTORY_HEADERS.slice(0, 16), "سعر الخاص", "سعر التعبئة 1", "سعر الجملة", "عدد2", "عدد1", "الموقع",
    "سعر الشراء", "سعر العام", "العدد", "إسم المادة", "ت", "الفرع",
];
const QUANTITY_HEADERS = ["المخزن", "العدد", "إسم المادة", "ت", "الفرع"];
const PRICE_HEADERS = ["آخر شراء", "سعر التعئبة 3", "سعر التعئبة 2", "سعر الخاص", "سعر الجملة", "سعر الشراء", "سعر العام", "إسم المادة", "ت", "الفرع", "سعر التعبئة 1"];
const EXPORT_HEADERS = [...INVENTORY_HEADERS, "سعر التعبئة 1"];
const TEMPLATE_GUIDE = [
    ["تمبلت المخزن الموحد — هندسة السيارات"],
    ["كل سطر مادة واحدة في فرع واحد. المفتاح هو (الفرع، ت)."],
    ["العدد والأسعار والحد الأدنى بوحدة التعبئة المحددة في العمود (التعبئة)."],
    ["للرصيد الدقيق: عند غياب العدد، يستخرج النظام الكمية من عدد3 ثم عدد2 ثم عدد1."],
    ["تحديث الكميات: العدد الجديد يحل محل الرصيد القديم."],
    ["تحديث الأسعار: الخلية الفارغة تترك السعر الحالي كما هو."],
    ["تعبئة1 هي الوحدة الكبرى، ثم تعبئة2، ثم تعبئة3؛ عوامل التحويل تعبئة1 إلى 2 وتعبئة2 إلى 3."],
    ["إذا لم يُدخل سعر تعبئة فرعية، يحسبه النظام من سعر التعبئة الأساسية وعامل التحويل؛ يمكن إدخال سعر مستقل للتعبئة 1/2/3 لتجاوز الحساب."],
    ["تُقرأ الأعمدة من عناوينها العربية؛ يمكن حذف الأعمدة المحسوبة قبل الاستيراد."],
];

function cellValue(row: unknown[], indexByHeader: Map<string, number>, aliases: string[]): unknown {
    for (const alias of aliases) {
        const index = indexByHeader.get(normalizeInventoryHeader(alias));
        if (index !== undefined) return row[index];
    }
    return undefined;
}

function readText(row: unknown[], index: Map<string, number>, aliases: string[]): string {
    const value = cellValue(row, index, aliases);
    return value === null || value === undefined ? "" : String(value).trim();
}

function readNumber(row: unknown[], index: Map<string, number>, aliases: string[]): number | null {
    return parseInventoryNumber(cellValue(row, index, aliases));
}

function readDate(row: unknown[], index: Map<string, number>, aliases: string[]): string | null {
    const value = cellValue(row, index, aliases);
    if (value === null || value === undefined || value === "") return null;
    if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
    if (typeof value === "number") {
        const parts = XLSX.SSF.parse_date_code(value);
        if (parts) return new Date(Date.UTC(parts.y, parts.m - 1, parts.d, parts.H, parts.M, Math.floor(parts.S))).toISOString();
    }
    const text = String(value).trim();
    if (/^\d{4}-\d{1,2}-\d{1,2}/.test(text)) return text;
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : text;
}

function cleanKey(value: unknown): string {
    return String(value ?? "").trim().replace(/\.0+$/, "");
}

function buildTemplate(branches: Branch[]) {
    const wb = XLSX.utils.book_new();
    const add = (name: string, headers: string[]) => {
        const ws = XLSX.utils.aoa_to_sheet([headers]);
        ws["!cols"] = headers.map(h => ({ wch: Math.max(12, Math.min(28, h.length + 4)) }));
        XLSX.utils.book_append_sheet(wb, ws, name);
    };
    const guide = XLSX.utils.aoa_to_sheet(TEMPLATE_GUIDE);
    guide["!cols"] = [{ wch: 110 }];
    XLSX.utils.book_append_sheet(wb, guide, "الدليل");
    add("المخزن", INVENTORY_HEADERS);
    add("مواد جديدة", NEW_ITEM_HEADERS);
    add("تحديث الكميات", QUANTITY_HEADERS);
    add("تحديث الأسعار", PRICE_HEADERS);
    const lists = XLSX.utils.aoa_to_sheet([
        ["الفرع", "الوحدات"],
        ...branches.map((branch, index) => [branch.name, INVENTORY_UNITS[index] || ""]),
        ...INVENTORY_UNITS.slice(branches.length).map(unit => ["", unit]),
    ]);
    XLSX.utils.book_append_sheet(wb, lists, "القوائم");
    XLSX.writeFile(wb, "تمبلت_المخزن_الموحد.xlsx");
}

function modeForSheet(name: string): ImportMode | null {
    const normalized = normalizeInventoryHeader(name);
    if (normalized.includes("تحديثالكميات")) return "quantities";
    if (normalized.includes("تحديثالاسعار")) return "prices";
    if (normalized.includes("موادجديدة")) return "new";
    if (normalized.includes("المخزن")) return "full";
    return null;
}

function formatMoney(value: number | null | undefined) {
    return value === null || value === undefined ? "—" : `${Number(value).toLocaleString("en-US")} د.ع`;
}

function errorMessage(error: unknown): string {
    return error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export default function InventoryPage() {
    const { employeeRole, employeeBranchId, loading: authLoading } = useAuth();
    const isAdmin = employeeRole === "Owner" || employeeRole === "Admin";
    const [branches, setBranches] = useState<Branch[]>([]);
    const [items, setItems] = useState<InventoryRow[]>([]);
    const [selectedBranch, setSelectedBranch] = useState("");
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [onlyLow, setOnlyLow] = useState(false);
    const [activeTab, setActiveTab] = useState<"list" | "import">("list");
    const [mode, setMode] = useState<ImportMode>("full");
    const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
    const [fileName, setFileName] = useState("");
    const [sheetName, setSheetName] = useState("");
    const [importBranch, setImportBranch] = useState("");
    const [preview, setPreview] = useState<Preview | null>(null);
    const [importing, setImporting] = useState(false);

    const fetchBranches = useCallback(async () => {
        const { data, error } = await supabase.from("branches").select("id,name").order("name");
        if (error) throw error;
        const rows = (data || []) as Branch[];
        setBranches(rows);
        if (!importBranch && employeeBranchId) setImportBranch(employeeBranchId);
    }, [employeeBranchId, importBranch]);

    const fetchInventory = useCallback(async () => {
        setLoading(true);
        try {
            const all: InventoryRow[] = [];
            const pageSize = 1000;
            for (let from = 0; from < 10000; from += pageSize) {
                let query = supabase.from("inventory")
                    .select("*,branches(name)")
                    .order("name").range(from, from + pageSize - 1);
                if (selectedBranch) query = query.eq("branch_id", selectedBranch);
                const { data, error } = await query;
                if (error) throw error;
                all.push(...((data || []) as unknown as InventoryRow[]));
                if (!data || data.length < pageSize) break;
            }
            setItems(all);
        } catch (error: unknown) {
            showError("تعذر تحميل المخزن", errorMessage(error) || "حدث خطأ أثناء قراءة المواد.");
        } finally {
            setLoading(false);
        }
    }, [selectedBranch]);

    useEffect(() => {
        if (!isAdmin) return;
        fetchBranches().catch(error => showError("تعذر تحميل الفروع", errorMessage(error)));
    }, [isAdmin, fetchBranches]);

    useEffect(() => {
        if (isAdmin) fetchInventory();
    }, [isAdmin, fetchInventory]);

    const filteredItems = useMemo(() => items.filter(item => {
        const q = search.trim().toLowerCase();
        const matches = !q || [item.name, item.item_code, item.murabba_id, item.category, item.supplier, item.store, item.branches?.name]
            .some(value => String(value || "").toLowerCase().includes(q));
        const low = item.quantity <= (item.min_quantity ?? 5);
        return matches && (!onlyLow || low);
    }), [items, search, onlyLow]);

    const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        setPreview(null);
        setWorkbook(null);
        setSheetName("");
        if (!file) return;
        try {
            const bytes = await file.arrayBuffer();
            const wb = XLSX.read(bytes, { type: "array", cellDates: true });
            setWorkbook(wb);
            setFileName(file.name);
            const preferred = wb.SheetNames.find(name => modeForSheet(name) !== null) || "";
            setSheetName(preferred);
            const detectedMode = preferred ? modeForSheet(preferred) : null;
            if (detectedMode) setMode(detectedMode);
        } catch {
            showError("ملف غير صالح", "تعذر قراءة الملف. اختر ملف Excel بصيغة xlsx أو xls.");
        } finally {
            event.target.value = "";
        }
    };

    const preparePreview = () => {
        if (!workbook || !sheetName) { showError("اختر ورقة", "اختر ورقة بيانات من الملف قبل المعاينة."); return; }
        const ws = workbook.Sheets[sheetName];
        if (!ws) { showError("ورقة غير موجودة", "تعذر العثور على ورقة البيانات المحددة."); return; }
        const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true, blankrows: false });
        if (matrix.length < 2) { showError("لا توجد بيانات", "يجب أن يحتوي الملف على صف عناوين وصف بيانات واحد على الأقل."); return; }
        const headers = matrix[0].map(normalizeInventoryHeader);
        const headerMap = new Map<string, number>();
        headers.forEach((header, i) => { if (header && !headerMap.has(header)) headerMap.set(header, i); });
        const selectedMode = modeForSheet(sheetName) || mode;
        const branchByName = new Map(branches.map(branch => [normalizeInventoryHeader(branch.name), branch.id]));
        const parsed: ParsedRow[] = [];
        const warnings: string[] = [];
        const seen = new Set<string>();

        matrix.slice(1).forEach((rawRow, rowOffset) => {
            const row = rawRow as unknown[];
            if (row.every(value => String(value ?? "").trim() === "")) return;
            const excelRow = rowOffset + 2;
            const itemKey = cleanKey(readText(row, headerMap, ["ت", "murabba_id", "item_code", "كود المادة"]));
            const name = readText(row, headerMap, ["إسم المادة", "اسم المادة", "name"]);
            const branchName = readText(row, headerMap, ["الفرع", "branch"]);
            const branchId = branchName ? branchByName.get(normalizeInventoryHeader(branchName)) : importBranch;
            if (!itemKey || !branchId) {
                warnings.push(`السطر ${excelRow}: ${!itemKey ? "رقم المادة (ت) مفقود" : `الفرع «${branchName}» غير معروف`}.`);
                return;
            }
            const uniqueKey = `${branchId}:${itemKey}`;
            if (seen.has(uniqueKey)) { warnings.push(`السطر ${excelRow}: المفتاح (الفرع، ت) مكرر: ${branchName || branches.find(b => b.id === branchId)?.name}، ${itemKey}.`); return; }
            seen.add(uniqueKey);

            const output: ParsedRow = { __row: excelRow, __key: uniqueKey, branch_id: branchId, murabba_id: itemKey, item_code: itemKey };
            if (selectedMode === "quantities") {
                const quantity = readNumber(row, headerMap, ["العدد", "quantity", "qty"]);
                if (quantity === null || quantity < 0) { warnings.push(`السطر ${excelRow}: العدد مفقود أو سالب.`); return; }
                output.quantity = quantity;
                output.name = name;
            } else if (selectedMode === "prices") {
                output.name = name;
                const priceColumns: [string, string[]][] = [
                    ["sell_price", ["سعر العام", "price_public", "sell_price"]],
                    ["special_price", ["سعر الخاص", "special_price"]],
                    ["purchase_price", ["سعر الشراء", "cost_avg", "purchase_price"]],
                    ["price_wholesale", ["سعر الجملة", "price_wholesale"]],
                    ["price_unit2", ["سعر التعبئة 2", "سعر التعئبة 2", "price_unit2"]],
                    ["price_unit3", ["سعر التعبئة 3", "سعر التعئبة 3", "price_unit3"]],
                    ["price_unit1", ["سعر التعبئة 1", "سعر التعئبة 1", "price_unit1"]],
                    ["last_purchase_price", ["آخر شراء", "last_purchase_price"]],
                ];
                for (const [field, aliases] of priceColumns) {
                    const value = readNumber(row, headerMap, aliases);
                    if (value !== null) output[field] = value;
                }
                if (!Object.keys(output).some(field => priceColumns.some(([key]) => key === field))) {
                    warnings.push(`السطر ${excelRow}: لا يحتوي على سعر لتحديثه.`); return;
                }
            } else {
                if (!name) { warnings.push(`السطر ${excelRow}: اسم المادة مطلوب.`); return; }
                const unit1 = readText(row, headerMap, ["تعبئة1", "unit1"]);
                const unit2 = readText(row, headerMap, ["تعبئة2", "unit2"]);
                const unit3 = readText(row, headerMap, ["تعبئة3", "unit3"]);
                const baseUnitText = readText(row, headerMap, ["التعبئة", "base_unit"]);
                const baseUnit = baseUnitText || unit1 || "قطعة";
                const unit1To2 = readNumber(row, headerMap, ["عدد تعبئة 1", "unit1_to_unit2"]);
                const unit2To3 = readNumber(row, headerMap, ["عدد تعبئة 2", "unit2_to_unit3"]);
                if (!unit1) { warnings.push(`السطر ${excelRow}: تعبئة1 مطلوبة للمادة «${name}».`); return; }
                if (unit2 && (!unit1To2 || unit1To2 <= 0)) { warnings.push(`السطر ${excelRow}: عامل تحويل تعبئة1 إلى تعبئة2 غير صالح.`); return; }
                if (unit3 && (!unit2 || !unit2To3 || unit2To3 <= 0)) { warnings.push(`السطر ${excelRow}: تعبئة3 تحتاج تعبئة2 وعامل تحويل صالح.`); return; }
                const sellPrice = readNumber(row, headerMap, ["سعر العام", "price_public", "sell_price"]);
                if (sellPrice === null || sellPrice < 0) { warnings.push(`السطر ${excelRow}: سعر العام مطلوب ويجب ألا يكون سالباً.`); return; }
                const raw: Record<string, unknown> = {
                    name, base_unit: baseUnit, unit1, unit2: unit2 || null, unit3: unit3 || null,
                    unit1_to_unit2: unit1To2, unit2_to_unit3: unit2To3,
                    qty_unit1: readNumber(row, headerMap, ["عدد1", "qty_unit1"]),
                    qty_unit2: readNumber(row, headerMap, ["عدد2", "qty_unit2"]),
                    qty_unit3: readNumber(row, headerMap, ["عدد3", "qty_unit3"]),
                    quantity: readNumber(row, headerMap, ["العدد", "qty", "quantity"]),
                };
                const quantity = deriveBaseQuantity(raw);
                if (quantity === null || quantity < 0) { warnings.push(`السطر ${excelRow}: لا يمكن تحديد الرصيد. أدخل العدد أو عدد1/عدد2/عدد3.`); return; }
                const unitSet = new Set(INVENTORY_UNITS);
                if ([unit1, unit2, unit3].filter(Boolean).some(unit => !unitSet.has(unit))) {
                    warnings.push(`السطر ${excelRow}: توجد وحدة غير موجودة في قائمة الوحدات المعتمدة.`); return;
                }
                Object.assign(output, {
                    name, category: readText(row, headerMap, ["المجموعة", "group", "category"]) || "غير مصنف",
                    quantity, sell_price: sellPrice,
                    purchase_price: readNumber(row, headerMap, ["سعر الشراء", "cost_avg", "purchase_price"]),
                    special_price: readNumber(row, headerMap, ["سعر الخاص", "special_price"]),
                    price_wholesale: readNumber(row, headerMap, ["سعر الجملة", "price_wholesale"]),
                    last_purchase_price: readNumber(row, headerMap, ["آخر شراء", "last_purchase_price"]),
                    price_unit2: readNumber(row, headerMap, ["سعر التعبئة 2", "سعر التعئبة 2", "price_unit2"]),
                    price_unit3: readNumber(row, headerMap, ["سعر التعبئة 3", "سعر التعئبة 3", "price_unit3"]),
                    price_unit1: readNumber(row, headerMap, ["سعر التعبئة 1", "سعر التعئبة 1", "price_unit1"]),
                    min_quantity: readNumber(row, headerMap, ["الحد الأدنى", "min_qty", "min_quantity"]),
                    supplier: readText(row, headerMap, ["الشركة", "supplier"]) || null,
                    store: readText(row, headerMap, ["المخزن", "store"]) || null,
                    location: readText(row, headerMap, ["الموقع", "location"]) || null,
                    created_at: readDate(row, headerMap, ["تاريخ الاضافة", "created_at"]),
                    notes: readText(row, headerMap, ["notes"]) || null,
                });
            }
            parsed.push(output);
        });
        if (warnings.length) {
            showError("الملف يحتاج تصحيحاً", warnings.slice(0, 6).join("\n") + (warnings.length > 6 ? `\nوهناك ${warnings.length - 6} ملاحظات إضافية.` : ""));
            setPreview(null);
            return;
        }
        if (!parsed.length) { setPreview(null); return; }
        setPreview({ mode: selectedMode, fileName, sheetName, rows: parsed, warnings });
    };

    const commitImport = async () => {
        if (!preview) return;
        const confirmed = await showConfirm(
            "تأكيد تحديث المخزن",
            `سيتم تطبيق ${preview.rows.length.toLocaleString("en-US")} صف في وضع «${MODE_LABEL[preview.mode]}». سيتم التراجع عن العملية كاملة إذا فشل أي صف.`,
            "تطبيق التحديث",
            false
        );
        if (!confirmed) return;
        setImporting(true);
        try {
            const payload = preview.rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith("__"))));
            const { data, error } = await supabase.rpc("import_inventory_rows", { p_mode: preview.mode, p_rows: payload as unknown as import("@/lib/types").Json });
            if (error) throw error;
            const result = asRecord(data);
            const inserted = Number(result.inserted || 0);
            const updated = Number(result.updated || 0);
            showSuccess("اكتمل الاستيراد", `أضيف ${inserted.toLocaleString("en-US")} مادة، وحُدّث ${updated.toLocaleString("en-US")} صف.`);
            setPreview(null);
            setWorkbook(null);
            setFileName("");
            setActiveTab("list");
            await fetchInventory();
        } catch (error: unknown) {
            showError("لم يكتمل الاستيراد", errorMessage(error) || "تعذر تطبيق الملف. لم يتم حفظ أي جزء من الدفعة.");
        } finally {
            setImporting(false);
        }
    };

    const exportInventory = () => {
        const rows = filteredItems.map(item => ({
            "الفرع": item.branches?.name || branches.find(b => b.id === item.branch_id)?.name || "",
            "ت": item.murabba_id || item.item_code,
            "إسم المادة": item.name,
            "العدد": item.quantity,
            "سعر العام": item.sell_price,
            "سعر الشراء": item.purchase_price,
            "عدد1": item.unit1 ? Number(item.quantity) / stockUnitsPerPackage(item, item.unit1) : "",
            "عدد2": item.unit2 ? Number(item.quantity) / stockUnitsPerPackage(item, item.unit2) : "",
            "عدد3": item.unit3 ? Number(item.quantity) / stockUnitsPerPackage(item, item.unit3) : "",
            "سعر الجملة": item.price_wholesale,
            "المخزن": item.store,
            "المجموعة": item.category,
            "موجود المخزن": formatInventoryStock(item),
            "التعبئة": item.base_unit,
            "تعبئة1": item.unit1,
            "تعبئة2": item.unit2,
            "تعبئة3": item.unit3,
            "الشركة": item.supplier,
            "الحد الأدنى": item.min_quantity,
            "عدد تعبئة 1": item.unit1_to_unit2,
            "عدد تعبئة 2": item.unit2_to_unit3,
            "سعر التعبئة 2": item.price_unit2,
            "سعر التعبئة 3": item.price_unit3,
            "سعر التعبئة 1": item.price_unit1,
            "آخر شراء": item.last_purchase_price,
        }));
        const ws = XLSX.utils.json_to_sheet(rows, { header: EXPORT_HEADERS });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "المخزن");
        XLSX.writeFile(wb, "تصدير_المخزن_الموحد.xlsx");
    };

    if (authLoading) {
        return <div className="min-h-screen flex items-center justify-center" dir="rtl"><Loader2 className="animate-spin text-rose-500" size={36} /></div>;
    }

    if (!isAdmin) {
        return <div className="min-h-screen flex items-center justify-center p-6" dir="rtl"><div className="glass-card rounded-2xl p-8 text-center"><ShieldAlert className="mx-auto mb-3 text-rose-500" size={36} /><h1 className="text-xl font-bold">هذه الشاشة مخصصة للمالك والمدير</h1></div></div>;
    }

    return (
        <div className="min-h-screen p-5 md:p-8 space-y-6 font-ibm" dir="rtl">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-display font-bold flex items-center gap-3"><Package className="text-rose-500" /> المخزن الموحد</h1>
                    <p className="text-muted-foreground mt-2">مخزون كل فرع بوحدة التعبئة، مع أسعار التعبئة والتحويلات.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button onClick={() => setActiveTab("list")} className={`px-4 py-2 rounded-xl border font-bold ${activeTab === "list" ? "bg-rose-600 text-white border-rose-500" : "bg-card border-border"}`}>المواد</button>
                    <button onClick={() => setActiveTab("import")} className={`px-4 py-2 rounded-xl border font-bold ${activeTab === "import" ? "bg-rose-600 text-white border-rose-500" : "bg-card border-border"}`}><FileUp size={16} className="inline ml-2" />استيراد وتحديث</button>
                </div>
            </div>

            {activeTab === "list" ? <>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div className="glass-card rounded-2xl p-4"><div className="text-xs text-muted-foreground">المواد المعروضة</div><div className="text-2xl font-bold mt-1">{filteredItems.length.toLocaleString("en-US")}</div></div>
                    <div className="glass-card rounded-2xl p-4"><div className="text-xs text-muted-foreground">منخفضة عن الحد الأدنى</div><div className="text-2xl font-bold mt-1 text-amber-400">{items.filter(i => i.quantity <= (i.min_quantity ?? 5)).length.toLocaleString("en-US")}</div></div>
                    <div className="glass-card rounded-2xl p-4"><div className="text-xs text-muted-foreground">قيمة الرصيد بسعر الشراء</div><div className="text-xl font-bold mt-1">{items.reduce((sum, i) => sum + Number(i.quantity || 0) * Number(i.purchase_price || 0), 0).toLocaleString("en-US")} د.ع</div></div>
                    <div className="glass-card rounded-2xl p-4"><div className="text-xs text-muted-foreground">الفروع المحملة</div><div className="text-2xl font-bold mt-1">{selectedBranch ? 1 : branches.length}</div></div>
                </div>
                <div className="glass-card rounded-2xl p-4 flex flex-col md:flex-row gap-3">
                    <div className="relative flex-1"><Search size={17} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={e => setSearch(e.target.value)} className="input-field w-full pr-10" placeholder="بحث بالاسم أو رقم المادة أو الشركة..." /></div>
                    <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)} className="input-field md:w-56"><option value="">كل الفروع</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select>
                    <button onClick={() => setOnlyLow(v => !v)} className={`px-4 py-2 rounded-xl border font-bold ${onlyLow ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-border"}`}>منخفض المخزون</button>
                    <button onClick={fetchInventory} className="p-2.5 rounded-xl border border-border" title="تحديث القائمة"><RefreshCw size={18} /></button>
                    <button onClick={exportInventory} className="px-4 py-2 rounded-xl border border-emerald-500/30 text-emerald-400 font-bold"><Download size={16} className="inline ml-2" />تصدير</button>
                </div>
                <div className="glass-card rounded-2xl border border-border overflow-auto">
                    <table className="w-full min-w-[1100px] text-sm text-right">
                        <thead className="bg-muted/50 text-muted-foreground"><tr>{["الفرع", "ت / كود المادة", "إسم المادة", "المجموعة", "موجود المخزن", "التعبئة", "أسعار التعبئة", "الحد الأدنى", "المخزن"].map(h => <th key={h} className="p-3 whitespace-nowrap">{h}</th>)}</tr></thead>
                        <tbody>
                            {loading ? <tr><td colSpan={9} className="p-12 text-center"><Loader2 className="animate-spin inline ml-2" />جارٍ تحميل المخزن...</td></tr>
                                : filteredItems.length === 0 ? <tr><td colSpan={9} className="p-12 text-center text-muted-foreground">لا توجد مواد مطابقة.</td></tr>
                                    : filteredItems.map(item => {
                                        const low = item.quantity <= (item.min_quantity ?? 5);
                                        const prices = packagingOptions(item).filter(x => x.price !== null).map(x => `${x.unit}: ${formatMoney(x.price)}`).join(" • ");
                                        return <tr key={item.id} className="border-t border-border/70 hover:bg-muted/30">
                                            <td className="p-3 whitespace-nowrap">{item.branches?.name || branches.find(b => b.id === item.branch_id)?.name || "—"}</td>
                                            <td className="p-3 font-mono">{item.murabba_id || item.item_code}</td>
                                            <td className="p-3 font-bold">{item.name}<div className="text-xs text-muted-foreground font-normal">{item.supplier || ""}</div></td>
                                            <td className="p-3">{item.category || "—"}</td>
                                            <td className={`p-3 font-bold ${low ? "text-amber-400" : "text-emerald-400"}`}>{formatInventoryStock(item)}</td>
                                            <td className="p-3">{item.base_unit || item.unit1 || "قطعة"}</td>
                                            <td className="p-3 min-w-[260px] text-xs">{prices || formatMoney(item.sell_price)}</td>
                                            <td className="p-3">{Number(item.min_quantity ?? 5).toLocaleString("en-US")}</td>
                                            <td className="p-3">{item.store || "—"}</td>
                                        </tr>;
                                    })}
                        </tbody>
                    </table>
                </div>
            </> : <div className="max-w-5xl space-y-5">
                <div className="glass-card rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
                    <div><h2 className="font-bold text-lg">ملف المخزن</h2><p className="text-sm text-muted-foreground mt-1">ارفع ملف النموذج، اختر ورقة البيانات، ثم راجع المعاينة قبل التطبيق.</p></div>
                    <button onClick={() => buildTemplate(branches)} className="px-4 py-2 rounded-xl border border-emerald-500/30 text-emerald-400 font-bold"><Download size={16} className="inline ml-2" />تنزيل التمبلت</button>
                </div>
                <div className="glass-card rounded-2xl p-5 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <label className="space-y-2"><span className="text-sm font-bold">نوع العملية</span><select value={mode} onChange={e => { setMode(e.target.value as ImportMode); setPreview(null); }} className="input-field w-full">{Object.entries(MODE_LABEL).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                        <label className="space-y-2"><span className="text-sm font-bold">فرع الاستيراد الافتراضي</span><select value={importBranch} onChange={e => { setImportBranch(e.target.value); setPreview(null); }} className="input-field w-full"><option value="">اختر الفرع إذا لم يكن في الملف</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
                        <label className="space-y-2"><span className="text-sm font-bold">ملف Excel</span><input type="file" accept=".xlsx,.xls" onChange={chooseFile} className="block w-full text-sm file:ml-3 file:rounded-lg file:border-0 file:bg-rose-600 file:px-3 file:py-2 file:text-white" /></label>
                    </div>
                    {workbook && <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="text-sm text-muted-foreground self-center">الملف: <b className="text-foreground">{fileName}</b></div>
                        <label className="space-y-2"><span className="text-sm font-bold">ورقة البيانات</span><select value={sheetName} onChange={e => { setSheetName(e.target.value); setPreview(null); const detected = modeForSheet(e.target.value); if (detected) setMode(detected); }} className="input-field w-full"><option value="">اختر ورقة</option>{workbook.SheetNames.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
                        <div className="md:col-span-2 flex flex-wrap gap-2"><button onClick={preparePreview} className="px-5 py-2.5 rounded-xl bg-rose-600 text-white font-bold"><Upload size={16} className="inline ml-2" />معاينة الصفوف</button><span className="text-xs text-muted-foreground self-center">الرفع يطابق العناوين العربية ويتجاهل الأعمدة الإضافية والمحسوبة.</span></div>
                    </div>}
                </div>
                {preview && <div className="glass-card rounded-2xl p-5 space-y-4">
                    <div className="flex flex-wrap justify-between items-center gap-3"><div><h3 className="text-lg font-bold">المعاينة: {MODE_LABEL[preview.mode]}</h3><p className="text-sm text-muted-foreground">{preview.fileName} • {preview.sheetName} • {preview.rows.length.toLocaleString("en-US")} صف صالح</p></div><button onClick={commitImport} disabled={importing} className="px-5 py-2.5 rounded-xl bg-emerald-600 disabled:opacity-60 text-white font-bold">{importing ? <><Loader2 className="animate-spin inline ml-2" size={16} />جارٍ التطبيق...</> : "تطبيق الاستيراد"}</button></div>
                    {preview.warnings.length > 0 && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">تم استبعاد {preview.warnings.length} صف لوجود بيانات ناقصة أو مكررة. أول الملاحظات: {preview.warnings.slice(0,3).join(" • ")}</div>}
                    <div className="overflow-auto border border-border rounded-xl"><table className="w-full text-sm"><thead className="bg-muted"><tr><th className="p-2">سطر الملف</th><th className="p-2">الفرع</th><th className="p-2">ت</th><th className="p-2">المادة</th><th className="p-2">العدد / الأسعار</th></tr></thead><tbody>{preview.rows.slice(0,20).map(row => <tr key={`${row.__key}:${row.__row}`} className="border-t border-border"><td className="p-2 text-center">{row.__row}</td><td className="p-2">{branches.find(b => b.id === row.branch_id)?.name}</td><td className="p-2 font-mono">{row.murabba_id as string}</td><td className="p-2">{String(row.name || "—")}</td><td className="p-2">{row.quantity !== undefined ? String(row.quantity) : [row.sell_price, row.price_unit2, row.price_unit3].filter(v => v !== undefined).map(v => Number(v).toLocaleString("en-US")).join(" / ") || "—"}</td></tr>)}</tbody></table></div>
                    {preview.rows.length > 20 && <p className="text-xs text-muted-foreground">معروض أول 20 صفًا؛ سيتم إرسال كل الصفوف الصالحة ({preview.rows.length.toLocaleString("en-US")}).</p>}
                </div>}
            </div>}
        </div>
    );
}
