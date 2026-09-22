// src/app/api/assistant/route.ts
// نسخة معدّلة: المساعد يشتغل على Google Gemini (الطبقة المجانية) بدل Anthropic.
// ⚠️ تبديل مزوّد الذكاء فقط — ما يمسّ أي شي ثاني بالنظام.
// نفس عقد الواجهة تماماً: يستقبل { messages:[{role,content}] } ويرجّع { reply }.
// فصفحة /assistant ما تحتاج أي تعديل.
//
// المطلوب لتشغيله:
//   1) متغير بيئة GEMINI_API_KEY (مفتاح مجاني من aistudio.google.com — بلا كارت)
//   2) دالة assistant_query موجودة بالقاعدة (نفس المايگريشن الحالي — قراءة فقط)

import { requireAdmin } from "@/lib/supabase-server";

// Node runtime (needs the service-role Supabase client), never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "gemini-flash-lite-latest";// نفس وثيقة السكيما الأصلية — بلا تغيير.
const SCHEMA_DOC = `قاعدة البيانات (PostgreSQL) لورشة سيارات. الجداول والأعمدة المهمة:

branches(id uuid, name text)  -- الفروع
employees(id uuid, auth_id uuid, name text, username text, role text, branch_id uuid, phone text, created_at timestamptz)
  -- role أحد: 'Owner','Admin','Supervisor','Receptionist'
clients(id uuid, name text, phone text, created_at timestamptz)  -- العملاء
vehicles(id uuid, client_id uuid, make text, model text, engine_size text, plate_number text, booklet_serial text, created_at timestamptz)
inspection_reports(id uuid, report_number int, branch_id uuid, vehicle_id uuid NULL, receptionist_id uuid, supervisor_id uuid,
  status text, order_type text, odometer_reading int, odometer_unit text, total_price numeric, notes text,
  completed_at timestamptz, created_at timestamptz, estimated_duration int, start_time timestamptz, end_time timestamptz,
  elapsed_time int, is_delayed bool, bay_number text, technician_id uuid NULL, selected_services jsonb)
  -- هذا الجدول الأساسي لأوامر العمل والمبيعات.
  -- status (عربي): 'تم الاستلام','قيد العمل','تم الانتهاء','متأخر','ملغى'
  -- order_type: 'maintenance' (أمر صيانة) أو 'sale' (بيع منتج). المبيعات vehicle_id فيها NULL.
inventory(id uuid, branch_id uuid, item_code text, name text, category text, purchase_price numeric, sell_price numeric, quantity int, min_quantity int)
report_services(id uuid, report_id uuid, category text, status text, notes text, service_price numeric, created_at timestamptz)
used_parts(id uuid, report_id uuid, inventory_id uuid, quantity int, unit_price numeric, total_price numeric, part_name text, part_code text)
pos_sales(id bigint, total_amount numeric, payment_method text, items jsonb, created_at timestamptz)

ملاحظات بالغة الأهمية:
- اسم الفني ليس عموداً. يُخزَّن نصاً في selected_services->0->>'technicianName'. واسم المشرف في selected_services->0->>'shiftSupervisor'.
- لو عمل سيارةً واحدةً أكثر من فني، يُكتب الاسم مدموجاً بفواصل مثل +، -، /، و، ، . عند تحليل الفنيين فرداً فرداً استخدم regexp_split_to_table على هذه الفواصل وحذف الفراغات.
- عدد الخدمات على كرت الصيانة ≈ عدد عناصر selected_services->0->'services' التي قيمتها status='يحتاج تغيير'، زائد عناصر مصفوفتي customServices و freeServices.
- بيع المنتج (order_type='sale'): selected_services->0 يحتوي customerName و customerPhone و products (مصفوفة فيها name,qty,price).
- الإيراد عادةً = مجموع total_price للأوامر المنتهية (status='تم الانتهاء').
- العميل مرتبط بالكرت عبر vehicles.client_id (انضمّ inspection_reports.vehicle_id = vehicles.id ثم vehicles.client_id = clients.id). المبيعات بلا مركبة فاسم عميلها داخل selected_services.
- استخدم دائماً صيغة PostgreSQL ومعاملات JSON (->, ->>). أضف LIMIT مناسباً. النتائج محدودة بـ 1000 صف.`;

const SYSTEM = `أنت مساعد ذكي لإدارة ورشة سيارات، تخدم المالك والمدير. تجاوب بالعربية (اللهجة العراقية) بإيجاز ووضوح.
لديك أداة query_database لتنفيذ استعلامات قراءة فقط (SELECT) على قاعدة البيانات الحقيقية.
القواعد:
- لا تخمّن الأرقام أبداً. استعلم من قاعدة البيانات أولاً ثم أجب من النتائج الفعلية.
- استعلامات قراءة فقط (SELECT/WITH). لا تعديل ولا حذف.
- لو احتجت عدة استعلامات للوصول للجواب نفّذها بالتتابع.
- بعد الحصول على النتائج، قدّم إجابة عربية مختصرة ومباشرة (أرقام واضحة، أسماء، جداول صغيرة عند اللزوم).
- لو السؤال غامض اطلب توضيحاً بدل التخمين.
- لو ما توفرت بيانات كافية قُل ذلك بصراحة.

${SCHEMA_DOC}`;

// تعريف الأداة بصيغة Gemini function-calling.
const TOOLS = [
    {
        functionDeclarations: [
            {
                name: "query_database",
                description:
                    "نفّذ استعلام PostgreSQL واحد للقراءة فقط (SELECT/WITH) على قاعدة الورشة وأرجِع الصفوف. ممنوع INSERT/UPDATE/DELETE/DDL. ضع LIMIT مناسباً؛ النتائج محدودة بـ1000 صف.",
                parameters: {
                    type: "object",
                    properties: {
                        sql: { type: "string", description: "جملة SELECT/WITH واحدة للقراءة فقط." },
                    },
                    required: ["sql"],
                },
            },
        ],
    },
];

export async function POST(request: Request) {
    const guard = await requireAdmin();
    if (!guard.ok) {
        return Response.json({ error: guard.error || "غير مصرح." }, { status: 403 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return Response.json(
            { error: "المساعد غير مُفعّل بعد: لم يتم ضبط مفتاح GEMINI_API_KEY في إعدادات المشروع." },
            { status: 503 }
        );
    }

    let body: { messages?: unknown };
    try {
        body = await request.json();
    } catch {
        return Response.json({ error: "طلب غير صالح." }, { status: 400 });
    }

    const incoming = Array.isArray(body.messages) ? body.messages : null;
    if (!incoming) {
        return Response.json({ error: "messages[] مطلوبة." }, { status: 400 });
    }

    // نحمل فقط أدوار المستخدم/المساعد النصية، ونحوّلها لصيغة Gemini (assistant -> model).
    const contents = incoming
        .filter((m): m is { role: "user" | "assistant"; content: string } =>
            !!m && typeof m === "object" &&
            ((m as any).role === "user" || (m as any).role === "assistant") &&
            typeof (m as any).content === "string" && (m as any).content.trim() !== ""
        )
        .slice(-20)
        .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] as any[] }));

    if (contents.length === 0 || contents[contents.length - 1].role !== "user") {
        return Response.json({ error: "آخر رسالة يجب أن تكون من المستخدم." }, { status: 400 });
    }

    const supabaseAdmin = guard.supabaseAdmin;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

    const reqBody: any = {
        systemInstruction: { parts: [{ text: SYSTEM }] },
        tools: TOOLS,
        contents,
    };

    try {
        let loops = 0;
        while (loops < 8) {
            loops++;
            const r = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
                body: JSON.stringify(reqBody),
            });

            if (!r.ok) {
                const t = await r.text();
                console.error("gemini error:", r.status, t.slice(0, 400));
                return Response.json(
                    { error: "تعذّر الاتصال بالمساعد. (" + r.status + ")" },
                    { status: r.status === 401 || r.status === 403 ? 502 : 500 }
                );
            }

            const data = await r.json();
            const parts: any[] = data?.candidates?.[0]?.content?.parts || [];
            const calls = parts.filter((p) => p.functionCall);

            if (calls.length > 0) {
                // نضيف دور النموذج (الذي طلب الأداة) ثم نرجّع نتائج الاستعلام.
                reqBody.contents.push({ role: "model", parts });
                const responseParts: any[] = [];
                for (const p of calls) {
                    if (p.functionCall?.name === "query_database") {
                        const sql = String(p.functionCall?.args?.sql ?? "");
                        const { data: rows, error } = await (supabaseAdmin as any).rpc("assistant_query", {
                            query_text: sql,
                        });
                        responseParts.push({
                            functionResponse: {
                                name: "query_database",
                                response: error
                                    ? { error: error.message }
                                    : { result: JSON.stringify(rows ?? []).slice(0, 60000) },
                            },
                        });
                    }
                }
                reqBody.contents.push({ role: "user", parts: responseParts });
                continue;
            }

            const reply = parts
                .filter((p) => typeof p.text === "string")
                .map((p) => p.text)
                .join("\n")
                .trim();

            return Response.json({ reply: reply || "لم أتمكن من إيجاد إجابة." });
        }

        return Response.json({ reply: "تعذّر إكمال الإجابة ضمن الحد المسموح." });
    } catch (err: any) {
        console.error("assistant route error:", err);
        return Response.json(
            { error: "تعذّر الاتصال بالمساعد. " + (err?.message ? `(${err.message})` : "") },
            { status: 500 }
        );
    }
}
