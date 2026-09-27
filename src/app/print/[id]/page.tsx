"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { PrintableInspectionReport } from "@/components/PrintableInspectionReport";
import BookletCodes from "@/components/BookletCodes";
import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";

export default function PrintPage() {
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const id = params.id as string;
    const mode = searchParams.get('mode') || 'full';
    const [report, setReport] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [scale, setScale] = useState(1);

    useEffect(() => {
        const fetchData = async () => {
            const { data: reportData } = await supabase
                .from("inspection_reports")
                .select(`
                    id, report_number, status, order_type, total_price, created_at, completed_at, odometer_reading,
                    estimated_duration, elapsed_time, start_time, selected_services, notes, branch_id, vehicle_id,
                    branches(id, name), contract:contracts(name),
                    vehicles (make, model, plate_number, engine_size, booklet_serial, clients (name, phone)),
                    receptionist:receptionist_id(name)
                `)
                .eq("id", id)
                .single();

            if (reportData) {
                // لون المحرك عند الاستلام يُسجَّل مرة واحدة لكل مركبة (غالباً على أول زيارة)،
                // فنجلبه من أي زيارة لنفس السيارة كي يظهر على ورقة عمل كل زيارة.
                let engineColorOnReceipt =
                    (Array.isArray(reportData.selected_services) ? reportData.selected_services[0] : reportData.selected_services)?.engineColorOnReceipt || null;
                if (!engineColorOnReceipt && (reportData as any).vehicle_id) {
                    // JSON-path select: pull the one string server-side instead of downloading
                    // the full selected_services of every report for the vehicle.
                    const { data: vReports } = await (supabase as any)
                        .from("inspection_reports")
                        .select("color:selected_services->0->>engineColorOnReceipt")
                        .eq("vehicle_id", (reportData as any).vehicle_id)
                        .not("selected_services->0->>engineColorOnReceipt", "is", null)
                        .neq("selected_services->0->>engineColorOnReceipt", "")
                        .limit(1);
                    engineColorOnReceipt = vReports?.[0]?.color || null;
                }
                setReport({ ...reportData, engineColorOnReceipt });
            }
            setLoading(false);
        };

        fetchData();
    }, [id]);

    useEffect(() => {
        const handleResize = () => {
            const width = window.innerWidth;
            if (width < 840) {
                // scale to fit within viewport width with 20px padding on each side
                setScale((width - 40) / 800);
            } else {
                setScale(1);
            }
        };
        handleResize();
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    useEffect(() => {
        // Auto-trigger print once data is loaded
        if (!loading && report) {
            const handleAfterPrint = () => {
                window.parent.postMessage({ type: 'print_complete' }, '*');
            };
            window.addEventListener("afterprint", handleAfterPrint);
            setTimeout(() => window.print(), 500);
            return () => {
                window.removeEventListener("afterprint", handleAfterPrint);
            };
        }
    }, [loading, report]);

    if (loading) {
        return (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "Arial", direction: "rtl" }}>
                <p>جاري تحضير التقرير للطباعة...</p>
            </div>
        );
    }

    if (!report) {
        return (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "Arial", direction: "rtl" }}>
                <p>لم يتم العثور على التقرير.</p>
            </div>
        );
    }

    if (mode === 'sticker') {
        const v = Array.isArray(report.vehicles) ? (report.vehicles[0] || {}) : (report.vehicles || {});
        const serialNum = v.booklet_serial || "BK-00000";
        
        return (
            <>
                <style>{`
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    html, body { background: white; color: black; }
                    @media screen {
                        body { padding: 40px; background: #f5f5f5; display: flex; justify-content: center; }
                        .sticker-card {
                            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                            border-radius: 12px;
                        }
                    }
                    @media print {
                        html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
                        @page { size: 58mm 60mm; margin: 0; }
                    }
                    .no-print-btn {
                        position: fixed; bottom: 20px; right: 20px;
                        background: #dc2626; color: white; border: none;
                        padding: 12px 24px; border-radius: 8px; font-size: 16px;
                        cursor: pointer; font-family: Arial; z-index: 999;
                        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                    }
                    @media print { .no-print-btn { display: none !important; } }
                `}</style>

                <div className="no-print-btn flex flex-col gap-3 fixed bottom-5 right-5 z-[999]">
                    <button 
                        onClick={() => router.back()}
                        className="bg-slate-800 text-white border-none py-3 px-6 rounded-xl text-base cursor-pointer font-bold shadow-lg flex items-center gap-2 justify-center"
                    >
                        <ArrowRight size={20} /> رجوع
                    </button>
                    <button 
                        onClick={() => window.print()}
                        className="bg-rose-600 text-white border-none py-3 px-6 rounded-xl text-base cursor-pointer font-bold shadow-lg"
                    >
                        🖨️ طباعة الملصق
                    </button>
                </div>

                <div className="sticker-card bg-white p-4 flex flex-col items-center justify-center text-center select-none" style={{
                    width: '58mm',
                    height: '60mm',
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    direction: 'rtl',
                }}>
                    <div style={{ margin: '4px 0' }}>
                        <BookletCodes serial={serialNum} variant="sticker" />
                    </div>
                    <strong style={{ fontSize: '15px', fontFamily: 'monospace', color: '#000', letterSpacing: '0.5px', marginTop: '4px' }}>{serialNum}</strong>
                </div>
            </>
        );
    }

    return (
        <>
            <style>{`
                * { margin: 0; padding: 0; box-sizing: border-box; }
                html, body { background: white; }
                @media screen {
                    body { padding: 20px; background: #f5f5f5; }
                    .print-scale-container {
                        width: 100%;
                        display: flex;
                        justify-content: center;
                        align-items: flex-start;
                        overflow: hidden;
                        padding: 10px 0;
                    }
                }
                @media print {
                    html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
                    @page { size: A4 portrait; margin: 0; }
                    .print-scale-container {
                        padding: 0 !important;
                        overflow: visible !important;
                        display: block !important;
                    }
                    .print-scale-wrapper {
                        transform: none !important;
                        width: 100% !important;
                        margin: 0 !important;
                        padding: 0 !important;
                        height: auto !important;
                    }
                }
                .no-print-btn {
                    position: fixed; bottom: 20px; right: 20px;
                    background: #dc2626; color: white; border: none;
                    padding: 12px 24px; border-radius: 8px; font-size: 16px;
                    cursor: pointer; font-family: Arial; z-index: 999;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                }
                @media print { .no-print-btn { display: none !important; } }
            `}</style>

            <div className="no-print-btn flex flex-col gap-3 fixed bottom-5 right-5 z-[999]">
                <button 
                    onClick={() => router.back()}
                    className="bg-slate-800 text-white border-none py-3 px-6 rounded-xl text-base cursor-pointer font-bold shadow-lg flex items-center gap-2 justify-center"
                >
                    <ArrowRight size={20} /> رجوع
                </button>
                <button 
                    onClick={() => window.print()}
                    className="bg-rose-600 text-white border-none py-3 px-6 rounded-xl text-base cursor-pointer font-bold shadow-lg"
                >
                    🖨️ طباعة مرة أخرى
                </button>
            </div>

            <div className="print-scale-container">
                <div className="print-scale-wrapper" style={{
                    transform: `scale(${scale})`,
                    transformOrigin: 'top center',
                    width: '800px',
                    flexShrink: 0,
                    marginBottom: `calc(800px * (${scale} - 1))`,
                    height: 'auto'
                }}>
                    {report.order_type === 'sale'
                        ? <SaleInvoice report={report} />
                        : <PrintableInspectionReport report={report} mode={mode} />}
                </div>
            </div>
        </>
    );
}

// Product-sale ("بيع منتج") invoice — sales have no inspection/work sheet, so the generic
// PrintableInspectionReport would print blank. This mirrors the invoice in SaleForm.
function SaleInvoice({ report }: { report: any }) {
    const num = (v: any) => parseFloat(String(v ?? '').replace(/[^\d.]/g, '')) || 0;
    const fmt = (n: number) => n.toLocaleString('en-US');
    const payload = Array.isArray(report.selected_services) ? report.selected_services[0] : report.selected_services;
    const branch = Array.isArray(report.branches) ? report.branches[0] : report.branches;
    const products = Array.isArray(payload?.products) ? payload.products : [];
    const pricing = payload?.pricing || {};
    const subtotal = products.reduce((s: number, p: any) => s + num(p.qty) * num(p.price), 0);
    const grand = num(pricing.grandTotal) || subtotal || num(report.total_price);
    const discount = num(pricing.discount);
    const received = num(pricing.amountReceived);
    const net = grand - discount;

    const d = new Date(report.created_at);
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
    let hh = d.getHours(); const mm = pad(d.getMinutes()); const ap = hh >= 12 ? 'م' : 'ص'; hh = hh % 12 || 12;
    const timeStr = `${hh}:${mm} ${ap}`;

    const ACCENT = '#b91c1c', INK = '#111827', MUTED = '#6b7280', LINE = '#e5e7eb';
    const exact = { WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as React.CSSProperties;

    const TotalRow = ({ label, value, strong }: { label: string; value: number; strong?: boolean }) => (
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 4px', fontSize: 14, color: strong ? INK : MUTED }}>
            <span>{label}</span>
            <span style={{ fontWeight: strong ? 800 : 700 }} dir="ltr">{fmt(value)} د.ع</span>
        </div>
    );

    return (
        <div style={{ fontFamily: "'IBM Plex Sans Arabic', sans-serif", width: '100%', background: '#fff', color: INK, direction: 'rtl', padding: '36px 40px', ...exact }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 18, borderBottom: `3px solid ${ACCENT}` }}>
                <div>
                    <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: '-0.5px' }}>هندسة السيارات</div>
                    <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>مركز صيانة وخدمات السيارات{branch?.name ? ` — فرع ${branch.name}` : ''}</div>
                </div>
                <div style={{ textAlign: 'left' }}>
                    <div style={{ display: 'inline-block', background: ACCENT, color: '#fff', fontWeight: 800, fontSize: 14, padding: '6px 16px', borderRadius: 8, ...exact }}>فاتورة بيع منتج</div>
                    <div style={{ fontSize: 13, marginTop: 10, color: MUTED }}>رقم الفاتورة: <span style={{ color: INK, fontWeight: 800 }}>#{report.report_number}</span></div>
                    <div style={{ fontSize: 13, color: MUTED }}>التاريخ: <span style={{ color: INK, fontWeight: 700 }}>{dateStr}</span> — {timeStr}</div>
                </div>
            </div>

            {/* Customer */}
            <div style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: '12px 16px', background: '#fafafa', margin: '22px 0', ...exact }}>
                <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>العميل</div>
                <div style={{ fontSize: 15, fontWeight: 800 }}>
                    {payload?.customerName || 'عميل نقدي'}
                    {payload?.customerPhone ? <span style={{ fontSize: 13, color: MUTED, fontWeight: 600, marginRight: 10 }} dir="ltr">{payload.customerPhone}</span> : null}
                </div>
            </div>

            {/* Products */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                    <tr style={{ background: INK, color: '#fff', ...exact }}>
                        <th style={{ padding: '11px 12px', textAlign: 'center', width: 40, fontWeight: 700 }}>#</th>
                        <th style={{ padding: '11px 12px', textAlign: 'right', fontWeight: 700 }}>المنتج</th>
                        <th style={{ padding: '11px 12px', textAlign: 'center', width: 70, fontWeight: 700 }}>الكمية</th>
                        <th style={{ padding: '11px 12px', textAlign: 'center', width: 120, fontWeight: 700 }}>السعر المفرد</th>
                        <th style={{ padding: '11px 12px', textAlign: 'center', width: 130, fontWeight: 700 }}>الإجمالي</th>
                    </tr>
                </thead>
                <tbody>
                    {products.length === 0 && (
                        <tr><td colSpan={5} style={{ padding: 18, textAlign: 'center', color: MUTED, border: `1px solid ${LINE}` }}>لا توجد منتجات</td></tr>
                    )}
                    {products.map((p: any, i: number) => {
                        const q = num(p.qty), pr = num(p.price);
                        return (
                            <tr key={i} style={{ background: i % 2 ? '#f9fafb' : '#fff', ...exact }}>
                                <td style={{ padding: '10px 12px', textAlign: 'center', color: MUTED, borderBottom: `1px solid ${LINE}` }}>{i + 1}</td>
                                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, borderBottom: `1px solid ${LINE}` }}>{p.name}</td>
                                <td style={{ padding: '10px 12px', textAlign: 'center', borderBottom: `1px solid ${LINE}` }} dir="ltr">{fmt(q)}</td>
                                <td style={{ padding: '10px 12px', textAlign: 'center', borderBottom: `1px solid ${LINE}` }} dir="ltr">{fmt(pr)}</td>
                                <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 800, borderBottom: `1px solid ${LINE}` }} dir="ltr">{fmt(q * pr)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>

            {/* Totals */}
            <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: 22 }}>
                <div style={{ width: 320 }}>
                    {discount > 0 && <TotalRow label="المجموع الفرعي" value={grand} />}
                    {discount > 0 && <TotalRow label="الخصم" value={-discount} />}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: ACCENT, color: '#fff', padding: '12px 16px', borderRadius: 10, marginTop: 8, ...exact }}>
                        <span style={{ fontWeight: 800, fontSize: 15 }}>الإجمالي الكلي</span>
                        <span style={{ fontWeight: 900, fontSize: 19 }} dir="ltr">{fmt(net)} د.ع</span>
                    </div>
                    {received > 0 && <TotalRow label="الواصل" value={received} />}
                    {received > 0 && net - received !== 0 && <TotalRow label="المتبقي" value={net - received} strong />}
                </div>
            </div>

            {/* Footer */}
            <div style={{ marginTop: 44, paddingTop: 16, borderTop: `1px solid ${LINE}`, textAlign: 'center', color: MUTED, fontSize: 12 }}>
                شكراً لتعاملكم معنا — هندسة السيارات
            </div>
        </div>
    );
}
