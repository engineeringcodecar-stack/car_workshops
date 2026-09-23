// src/app/api/assistant/export/route.ts
// تصدير تقرير: يستقبل سؤالاً بالعربي، يولّد استعلام SELECT عبر Gemini،
// ينفّذه للقراءة فقط (assistant_query)، ويرجّع ملف CSV قابل للتنزيل (يفتح بالإكسل).
// للمالك/المدير فقط. لا يعدّل أي بيانات.

import { requireAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODELS = ["gemini-flash-lite-latest", "gemini-3.6-flash"];
const PER_CALL_TIMEOUT_MS = 12000;

const SCHEMA = `قاعدة بيانات ورشة سيارات (PostgreSQL). أهم الجداول:
- inspection_reports: أوامر العمل والمبيعات. status ('تم الاستلام','قيد العمل','تم الانتهاء','متأخر','ملغى')، order_type ('maintenance' صيانة، 'sale' بيع)، total_price numeric، created_at، completed_at، vehicle_id (NULL للمبيعات)، branch_id، selected_services jsonb (اسم الفني في selected_services->0->>'technicianName').
- clients(id,name,phone,created_at) العملاء.
- vehicles(id,client_id,make,model,...): تنبيه مهم — عمود make يحوي اسم الموديل/النوع (النترا، سورنتو، توسان...) وعمود model يحوي سنة الصنع. للتجميع حسب نوع السيارة استخدم make.
- inventory(item_code,name,category,sell_price,quantity,...) المخزون.
- pos_sales(total_amount,payment_method,items jsonb,created_at) نقطة البيع.
- report_services, used_parts, employees(name,role,branch_id), branches(id,name).
الإيراد = مجموع total_price للأوامر status='تم الانتهاء'. استخدم دائماً SELECT للقراءة فقط.`;

const SYSTEM = `أنت مولّد تقارير لورشة سيارات. المستخدم يريد تصدير بيانات كملف.
مهمتك: استدعِ الأداة query_database مرة واحدة باستعلام PostgreSQL من نوع SELECT يرجّع صفوف التقرير المطلوب،
بأعمدة واضحة ومسمّاة بالعربي عند الإمكان (استخدم AS "الاسم")، مع LIMIT مناسب (حتى 5000). لا تكتب شرحاً نصياً — فقط نفّذ الاستعلام.
${SCHEMA}`;

const TOOLS = [
    {
        functionDeclarations: [
            {
                name: "query_database",
                description:
                    "نفّذ استعلام PostgreSQL واحد للقراءة فقط (SELECT/WITH) وأرجِع صفوف التقرير. ممنوع أي تعديل. ضع LIMIT مناسباً.",
                parameters: {
                    type: "object",
                    properties: { sql: { type: "string", description: "جملة SELECT/WITH واحدة." } },
                    required: ["sql"],
                },
            },
        ],
    },
];

async function callGeminiOnce(model: string, reqBody: any, apiKey: string) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), PER_CALL_TIMEOUT_MS);
    try {
        const r = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
                body: JSON.stringify(reqBody),
                signal: ctrl.signal,
            }
        );
        if (!r.ok) return { ok: false as const, status: r.status };
        return { ok: true as const, data: await r.json() };
    } finally {
        clearTimeout(to);
    }
}

async function callGemini(reqBody: any, apiKey: string, deadline: number) {
    let last = "unknown";
    for (let attempt = 0; attempt < 4; attempt++) {
        if (Date.now() > deadline) break;
        const model = MODELS[attempt % MODELS.length];
        try {
            const res = await callGeminiOnce(model, reqBody, apiKey);
            if (res.ok) return res.data;
            last = String(res.status);
            if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) {
                throw new Error("gemini-" + res.status);
            }
        } catch (e: any) {
            const msg = e?.name === "AbortError" ? "timeout" : (e?.message || "error");
            if (typeof msg === "string" && msg.startsWith("gemini-")) throw e;
            last = msg;
        }
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
    throw new Error(last);
}

function toCsv(rows: any[]): string {
    if (!Array.isArray(rows) || rows.length === 0) return "﻿(لا توجد بيانات)\n";
    const cols = Object.keys(rows[0]);
    const esc = (v: any) => {
        const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [cols.join(",")];
    for (const row of rows) lines.push(cols.map((c) => esc((row as any)[c])).join(","));
    return "﻿" + lines.join("\r\n"); // BOM حتى يظهر العربي صح بالإكسل
}

export async function POST(request: Request) {
    const guard = await requireAdmin();
    if (!guard.ok) {
        return Response.json({ error: guard.error || "غير مصرح." }, { status: 403 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return Response.json({ error: "المساعد غير مُفعّل: GEMINI_API_KEY غير مضبوط." }, { status: 503 });
    }

    let body: { question?: unknown };
    try {
        body = await request.json();
    } catch {
        return Response.json({ error: "طلب غير صالح." }, { status: 400 });
    }

    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) {
        return Response.json({ error: "حدّد شنو التقرير الذي تريده." }, { status: 400 });
    }

    const reqBody: any = {
        systemInstruction: { parts: [{ text: SYSTEM }] },
        tools: TOOLS,
        contents: [{ role: "user", parts: [{ text: question }] }],
    };

    const deadline = Date.now() + 52000;
    try {
        let rows: any[] | null = null;
        let loops = 0;
        while (loops < 5 && Date.now() < deadline) {
            loops++;
            let data: any;
            try {
                data = await callGemini(reqBody, apiKey, deadline);
            } catch {
                return Response.json({ error: "المساعد مشغول مؤقتاً، جرّب بعد لحظات." }, { status: 503 });
            }
            const parts: any[] = data?.candidates?.[0]?.content?.parts || [];
            const call = parts.find((p) => p.functionCall?.name === "query_database");
            if (!call) break;

            const sql = String(call.functionCall?.args?.sql ?? "");
            const { data: r, error } = await (guard.supabaseAdmin as any).rpc("assistant_query", { query_text: sql });
            if (error) {
                // نعيد الخطأ للنموذج ليصحّح استعلامه.
                reqBody.contents.push({ role: "model", parts });
                reqBody.contents.push({
                    role: "user",
                    parts: [{ functionResponse: { name: "query_database", response: { error: error.message } } }],
                });
                continue;
            }
            rows = Array.isArray(r) ? r : [];
            break;
        }

        if (rows === null) {
            return Response.json({ error: "تعذّر توليد التقرير لهذا الطلب." }, { status: 502 });
        }

        const csv = toCsv(rows);
        const stamp = new Date().toISOString().slice(0, 10);
        return new Response(csv, {
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="report-${stamp}.csv"`,
                "Cache-Control": "no-store",
            },
        });
    } catch (err: any) {
        console.error("export route error:", err);
        return Response.json({ error: "تعذّر توليد التقرير." }, { status: 500 });
    }
}
