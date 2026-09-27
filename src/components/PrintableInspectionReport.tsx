import React, { forwardRef } from 'react';
import BookletCodes from '@/components/BookletCodes';

interface PrintableInspectionReportProps {
    report: any;
    mode?: string;
}

export const PrintableInspectionReport = forwardRef<HTMLDivElement, PrintableInspectionReportProps>(({ report, mode = 'full' }, ref) => {

    const isPaperV2 = report?.selected_services?.[0]?.is_paper_v2_format === true;
    const data = isPaperV2 ? report.selected_services[0] : null;

    const oldServices = !isPaperV2 && Array.isArray(report?.selected_services)
        ? report.selected_services
        : [];

    const s = data?.services || {};
    const fs = data?.freeServices || {};
    const p = data?.pricing || {
        totalPrice: report?.total_price || 0,
        amountReceived: 0,
        amountOwedByClient: 0,
        amountOwedToClient: 0,
    };
    const customs = data?.customServices || oldServices.map((srv: any, i: number) => ({
        // Stable, deterministic id (used as a React key below). Avoids Math.random()
        // during render, which would regenerate keys and remount rows every render.
        id: `old-${i}`,
        label: typeof srv === 'string' ? srv : (srv.service || srv.label || 'خدمة سابقة'),
        status: srv.status || 'مكتمل',
        price: srv.price || 0,
    }));
    const booklet = data?.booklet || {};

    // لون المحرك من الداخل قبل تبديل الزيت (حالة المحرك عند الاستلام) — يُسجَّل مرة واحدة لكل مركبة.
    // يُمرَّر من صفحة الطباعة على المستوى الأعلى؛ مع رجوع احتياطي لحمولة الزيارة الحالية.
    const engineColorVal: string | null =
        report?.engineColorOnReceipt ||
        (Array.isArray(report?.selected_services) ? report.selected_services[0] : report?.selected_services)?.engineColorOnReceipt ||
        null;

    const v = Array.isArray(report?.vehicles) ? (report.vehicles[0] || {}) : (report?.vehicles || {});
    const client = Array.isArray(v?.clients) ? (v.clients[0] || {}) : (v?.clients || {});

    const openTime = report?.start_time ? new Date(report.start_time).toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' }) : '___________';
    const closeTime = report?.completed_at ? new Date(report.completed_at).toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' }) : '___________';
    const dateStr = report?.created_at ? new Date(report.created_at).toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB');

    /* ── Reusable helpers ── */
    const Val = ({ v: val, w = 80 }: { v?: string | number; w?: number }) => (
        <span style={{
            display: 'inline-block',
            borderBottom: '1.5px solid #1a1a2e',
            minWidth: `${w}px`,
            padding: '0 4px',
            textAlign: 'center',
            fontWeight: 700,
            fontSize: '12px',
            color: val ? '#1a1a2e' : '#888',
        }}>
            {val ?? ''}
        </span>
    );

    const Tick = ({ ok }: { ok?: boolean }) => (
        <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '16px',
            height: '16px',
            border: '1.5px solid',
            borderColor: ok ? '#16a34a' : '#9ca3af',
            borderRadius: '3px',
            backgroundColor: ok ? '#dcfce7' : 'transparent',
            color: '#16a34a',
            fontWeight: 900,
            fontSize: '11px',
            marginRight: '2px',
        }}>
            {ok ? '✓' : ''}
        </span>
    );

    const StatusBadge = ({ status }: { status?: string }) => {
        const isGood = status === 'جيد';
        const isChange = status === 'يحتاج تغيير';
        return (
            <span style={{ display: 'inline-flex', gap: '6px' }}>
                <span style={{
                    padding: '1px 6px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, // ↑ 10→11px
                    backgroundColor: isGood ? '#dcfce7' : '#f3f4f6',
                    color: isGood ? '#15803d' : '#9ca3af',
                    border: `1px solid ${isGood ? '#86efac' : '#e5e7eb'}`,
                    whiteSpace: 'nowrap',
                }}>
                    <Tick ok={isGood} /> جيد
                </span>
                <span style={{
                    padding: '1px 6px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, // ↑ 10→11px
                    backgroundColor: isChange ? '#fee2e2' : '#f3f4f6',
                    color: isChange ? '#dc2626' : '#9ca3af',
                    border: `1px solid ${isChange ? '#fca5a5' : '#e5e7eb'}`,
                    whiteSpace: 'nowrap',
                }}>
                    <Tick ok={isChange} /> تغيير
                </span>
            </span>
        );
    };

    const formatNum = (val: any) => {
        if (!val) return val;
        const num = Number(String(val).replace(/,/g, ''));
        if (!isNaN(num) && num > 0) return num.toLocaleString();
        return val;
    };

    const SvcRow = ({
        num, label, svcKey, fields,
    }: {
        num: number;
        label: string;
        svcKey: string;
        fields?: { key: string; label: string }[];
    }) => {
        const svc = (s as any)[svcKey] || {};
        return (
            <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: '3px 4px', textAlign: 'center', fontWeight: 700, fontSize: '11px', color: '#6b7280', width: '20px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{num}</td>
                <td style={{ padding: '3px 5px', fontWeight: 700, fontSize: '11px', width: '105px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{label}</td>
                <td style={{ padding: '3px 5px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                    <StatusBadge status={svc.status} />
                </td>
                <td style={{ padding: '3px 5px', verticalAlign: 'middle', overflow: 'hidden' }}>
                    {svcKey === 'additives' ? (
                        <span style={{ display: 'inline-flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', fontSize: '11px' }}>
                            {Object.keys(svc.details || {}).filter(k => k.startsWith('prod_')).map((k) => (
                                <span key={k} style={{ whiteSpace: 'nowrap', fontSize: '11px' }}>
                                    <Val v={svc.details?.[k]} w={60} />
                                </span>
                            ))}
                        </span>
                    ) : (fields && fields.length > 0 && (
                        <span style={{ display: 'inline-flex', gap: '8px', alignItems: 'center', flexWrap: 'nowrap', whiteSpace: 'nowrap', fontSize: '11px' }}>
                            {fields.map(f => (
                                <span key={f.key} style={{ whiteSpace: 'nowrap', fontSize: '11px' }}>
                                    {f.label}: <Val v={svc.details?.[f.key]} w={42} />
                                </span>
                            ))}
                        </span>
                    ))}
                </td>
                <td style={{ padding: '3px 5px', textAlign: 'center', fontWeight: 700, fontSize: '11px', width: '58px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                    <Val v={formatNum(svc.price)} w={48} />
                </td>
            </tr>
        );
    };

    const isSectorBranch = report?.branches?.name === 'القطاع' || report?.branches?.name === 'فرع القطاع';
    const isIndustrialBranch = ['الصناعية', 'فرع الصناعية', 'الكراج', 'فرع الكراج'].includes(report?.branches?.name || '');

    const flatSectorServices = [
        { key: 'engineFlash', label: 'فلاش محرك', fields: [{ key: 'type', label: 'النوع / الماركة' }, { key: 'qty', label: 'الكمية' }] },
        { key: 'engineOil', label: 'زيت محرك', fields: [{ key: 'type', label: 'النوع / الماركة' }, { key: 'qty', label: 'الكمية' }] },
        { key: 'oilFilter', label: 'فلتر زيت محرك', fields: [{ key: 'type', label: 'النوع / الماركة' }, { key: 'qty', label: 'الكمية' }] },
        { key: 'coolant', label: 'ماء / سائل تبريد', fields: [{ key: 'type', label: 'النوع / الماركة' }, { key: 'qty', label: 'العدد' }] },
        { key: 'engineCeramic', label: 'سيراميك محرك', fields: [{ key: 'type', label: 'النوع / الماركة' }, { key: 'qty', label: 'الكمية' }] },
        { key: 'linerCleaner', label: 'منظف بطانة (جكجكة)', fields: [{ key: 'type', label: 'النوع / الماركة' }, { key: 'qty', label: 'الكمية' }] },
        { key: 'oilLeakPreventer', label: 'مانع تسريب زيت', fields: [{ key: 'type', label: 'النوع / الماركة' }, { key: 'qty', label: 'الكمية' }] },
        { key: 'smokePreventer', label: 'مانع دخان / نقص زيت', fields: [{ key: 'type', label: 'النوع / الماركة' }, { key: 'qty', label: 'الكمية' }] },
        { key: 'gearboxFlash', label: 'فلاش كير', fields: [{ key: 'type', label: 'النوع / الماركة' }, { key: 'qty', label: 'الكمية' }] },
        { key: 'gearboxOil', label: 'زيت كير', fields: [{ key: 'type', label: 'النوع / الماركة' }, { key: 'qty', label: 'العدد' }] },
        { key: 'gearboxFilter', label: 'فلتر كير', fields: [{ key: 'type', label: 'النوع / الماركة' }, { key: 'qty', label: 'العدد' }] },
        { key: 'gearboxCeramic', label: 'سيراميك كير', fields: [{ key: 'type', label: 'النوع / الماركة' }, { key: 'qty', label: 'الكمية' }] },
        { key: 'gearboxAntiSlip', label: 'مانع انزلاق الكير', fields: [{ key: 'type', label: 'النوع / الماركة' }, { key: 'qty', label: 'الكمية' }] },
        { key: 'airFilter', label: 'فلتر هواء', fields: [{ key: 'type', label: 'النوع / الماركة' }, { key: 'qty', label: 'العدد' }] },
        { key: 'acFilter', label: 'فلتر تبريد', fields: [{ key: 'type', label: 'النوع / الماركة' }, { key: 'qty', label: 'العدد' }] },
        { key: 'acCleaner', label: 'منظف دورة التبريد', fields: [{ key: 'type', label: 'النوع / الماركة' }, { key: 'qty', label: 'الكمية' }] },
        { key: 'brakeFluid', label: 'زيت بريك', fields: [{ key: 'type', label: 'النوع / الماركة' }, { key: 'qty', label: 'العدد' }] },
        { key: 'injectorCleaner', label: 'منظف بخاخات', fields: [{ key: 'type', label: 'النوع / الماركة' }, { key: 'qty', label: 'الكمية' }] },
        { key: 'fuelSystemCleaner', label: 'منظف نظام الوقود', fields: [{ key: 'type', label: 'النوع / الماركة' }, { key: 'qty', label: 'الكمية' }] },
        { key: 'octaneBooster', label: 'أوكتان بنزين', fields: [{ key: 'type', label: 'النوع / الماركة' }, { key: 'qty', label: 'الكمية' }] },
        { key: 'battery', label: 'البطارية', fields: [{ key: 'type', label: 'النوع / الماركة' }, { key: 'qty', label: 'الكمية' }] },
        { key: 'batteryFilter', label: 'فلتر البطارية', fields: [{ key: 'type', label: 'النوع / الماركة' }, { key: 'qty', label: 'الكمية' }] },
        { key: 'wipers', label: 'مساحات زجاج', fields: [{ key: 'type', label: 'النوع / الماركة' }, { key: 'qty', label: 'العدد' }] },
        { key: 'windshieldFluid', label: 'سائل غسيل جام', fields: [{ key: 'type', label: 'النوع / الماركة' }, { key: 'qty', label: 'الكمية' }] },
        { key: 'tires', label: 'الإطارات', fields: [] },
    ];

    let SERVICES = isSectorBranch ? flatSectorServices : [
        { key: 'engineOil', label: 'زيت المحرك', fields: isIndustrialBranch ? [{ key: 'brand', label: 'النوع' }, { key: 'qty', label: 'العدد' }] : [{ key: 'brand', label: 'نوع الزيت' }, { key: 'viscosity', label: 'اللزوجة' }, { key: 'liters', label: 'اللترات' }] },
        { key: 'oilFilter', label: 'فلتر زيت المحرك', fields: isIndustrialBranch ? [{ key: 'type', label: 'النوع' }, { key: 'qty', label: 'العدد' }] : [{ key: 'type', label: 'النوع' }, { key: 'filterNum', label: 'الرقم' }] },
        { key: 'airFilter', label: 'فلتر الهواء', fields: isIndustrialBranch ? [{ key: 'type', label: 'النوع' }, { key: 'qty', label: 'العدد' }] : [{ key: 'type', label: 'النوع' }, { key: 'filterNum', label: 'الرقم' }] },
        { key: 'acFilter', label: 'فلتر التبريد', fields: isIndustrialBranch ? [{ key: 'type', label: 'النوع' }, { key: 'qty', label: 'العدد' }] : [{ key: 'type', label: 'النوع' }, { key: 'filterNum', label: 'الرقم' }] },
        { key: 'brakeFluid', label: 'زيت المكابح', fields: isIndustrialBranch ? [{ key: 'type', label: 'النوع' }, { key: 'qty', label: 'العدد' }] : [{ key: 'type', label: 'النوع' }, { key: 'qty', label: 'العدد' }] },
        { key: 'coolant', label: 'ماء الراديتر', fields: [{ key: 'type', label: 'النوع' }, { key: 'qty', label: 'العدد' }, { key: 'size', label: 'الحجم' }] },
        { key: 'battery', label: 'البطارية', fields: isIndustrialBranch ? [{ key: 'type', label: 'النوع والسعة' }, { key: 'qty', label: 'العدد' }] : [{ key: 'type', label: 'النوع والسعة' }] },
        { key: 'engineBelts', label: 'قايش المحرك', fields: isIndustrialBranch ? [{ key: 'type', label: 'النوع' }, { key: 'qty', label: 'العدد' }] : [{ key: 'type', label: 'النوع' }, { key: 'num', label: 'الرقم' }] },
        { key: 'brakePads', label: 'دسكات السيارة', fields: isIndustrialBranch ? [{ key: 'type', label: 'النوع' }, { key: 'qty', label: 'العدد' }] : [{ key: 'type', label: 'النوع' }, { key: 'num', label: 'الرقم' }] },
        { key: 'sparkPlugs', label: 'شمعات الاحتراق', fields: isIndustrialBranch ? [{ key: 'type', label: 'النوع' }, { key: 'qty', label: 'العدد' }] : [{ key: 'type', label: 'النوع' }, { key: 'num', label: 'الرقم' }] },
        { key: 'gearboxHydraulic', label: 'هايدروليك الكير', fields: isIndustrialBranch ? [{ key: 'type', label: 'النوع' }, { key: 'qty', label: 'العدد' }] : [{ key: 'type', label: 'النوع' }, { key: 'qty', label: 'اللترات' }] },
        { key: 'gearboxFilter', label: 'فلتر الكير', fields: isIndustrialBranch ? [{ key: 'type', label: 'النوع' }, { key: 'qty', label: 'العدد' }] : [{ key: 'type', label: 'النوع' }, { key: 'filterNum', label: 'الرقم' }] },
        { key: 'wipers', label: 'الماسحات', fields: isIndustrialBranch ? [{ key: 'type', label: 'النوع' }, { key: 'qty', label: 'العدد' }] : [{ key: 'type', label: 'النوع' }, { key: 'size', label: 'الحجم' }] },
        { key: 'additives', label: 'المضافات والمحسنات', fields: [] },
    ];

    if (mode === 'short') {
        SERVICES = SERVICES.filter(svc => {
            const status = (s as any)[svc.key]?.status;
            return status === 'يحتاج تغيير';
        });
    }

    const totalItems = SERVICES.length + customs.filter((c: any) => c.label).length;

    // ─── SCALE: higher values = bigger printed text ───────────────────────────
    // Increased scale so content fills the page beautifully without wasting space at the bottom.
    let printScale = 0.95;
    if (totalItems > 20) {
        printScale = 0.86;
    } else if (totalItems > 14) {
        printScale = 0.90;
    }

    // Row padding & signature sizing — optimized to balance page filling and fitting.
    const rowPadding = totalItems > 20 ? '3.5px 5px' : (totalItems > 14 ? '4.5px 6px' : '5.5px 8px');
    const sigHeight = totalItems > 20 ? '22px' : (totalItems > 14 ? '28px' : '36px');
    const sigMargin = totalItems > 20 ? '8px' : (totalItems > 14 ? '12px' : '16px');

    // Helper for consistent section bottom spacing
    const mb = (large: string, small: string) => totalItems > 14 ? large : small;

    return (
        <div className="relative print-page-wrapper">
            <style type="text/css">{`
                @import url('https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,700;1,400;1,700&display=swap');
            `}</style>
            <style type="text/css" media="print">{`
                @page { size: A4 portrait; margin: 0 !important; }
                body  { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; background: white; max-height: 297mm; overflow: hidden; }
                * { font-family: 'Amiri', 'Times New Roman', serif !important; page-break-inside: avoid; }
                .print-page-wrapper { width: 210mm; height: 297mm; overflow: hidden; margin: 0 auto; page-break-inside: avoid; page-break-after: avoid; }
                .print-page-content { width: 100%; transform-origin: top center; transform: scale(${printScale}); line-height: 1.15; }
            `}</style>

            <div
                ref={ref}
                dir="rtl"
                className="print-page-content"
                style={{
                    maxWidth: '800px',
                    margin: '0 auto',
                    // ↓ tighter padding — reclaims ~6–8px top+bottom versus original
                    padding: totalItems > 14 ? '3mm 5mm' : '4mm 6mm',
                    boxSizing: 'border-box',
                    fontSize: '13px',          // ↑ was 11px → bigger base text
                    color: '#1a1a2e',
                    backgroundColor: '#fff',
                    fontFamily: "'Amiri', serif",
                }}
            >

                {/* ══ HEADER ══ */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: mb('4px', '9px') }}>
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '10px', color: '#6b7280' }}>رقم الطلب</div>
                        <div style={{ fontSize: '22px', fontWeight: 900, color: '#dc2626', letterSpacing: '-0.5px' }}>
                            {/* ↑ 20px → 22px */}
                            #{report.report_number ?? '—'}
                        </div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ background: 'linear-gradient(135deg,#1a1a2e 0%,#2d2d5e 100%)', color: 'white', padding: '6px 20px', borderRadius: '10px', display: 'inline-block' }}>
                            <div style={{ fontSize: '18px', fontWeight: 900, letterSpacing: '1px' }}>
                                هندسة <span style={{ color: '#f87171' }}>السيارات</span>
                            </div>
                            <div style={{ fontSize: '9px', color: '#94a3b8', marginTop: '1px' }}>Car Engineering Center</div>
                        </div>
                    </div>
                    <div style={{ textAlign: 'left' }}>
                        <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '2px' }}>التاريخ</div>
                        <div style={{ fontWeight: 700, fontSize: '14px' }}>{dateStr}</div>
                        {/* ↑ 13px → 14px */}
                    </div>
                </div>

                {/* ══ META STRIP ══ */}
                <div style={{
                    background: '#f1f5f9', borderRadius: '8px',
                    padding: '4px 10px',
                    display: 'flex', justifyContent: 'space-between',
                    marginBottom: mb('4px', '8px'),
                    fontSize: '11px',
                    flexWrap: 'wrap', gap: '4px',
                }}>
                    <span>رقم الخانة: <strong>{report.bay_number || '___________'}</strong></span>
                    <span>الشفت: <strong>{data?.shiftName || '___________'}</strong></span>
                    <span>مشرف الشفت: <strong>{data?.shiftSupervisor || '___________'}</strong></span>
                    <span>موظف الاستقبال: <strong>{data?.receptionistName || report.receptionist?.name || '___________'}</strong></span>
                    <span>اسم الفني: <strong>{data?.technicianName || '___________'}</strong></span>
                    <span>وقت الفتح: <strong>{openTime}</strong></span>
                    <span>وقت الغلق: <strong>{closeTime}</strong></span>
                </div>

                {/* ══ BOOKLET ══ */}
                <div style={{
                    background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '8px',
                    padding: '6px 12px',
                    display: 'flex', gap: '20px', alignItems: 'center',
                    marginBottom: mb('4px', '8px'),
                    fontSize: '12px',
                    flexWrap: 'wrap',
                }}>
                    <strong style={{ color: '#92400e' }}>دفتر الخدمة :</strong>
                    {['جديد', 'قديم', 'لا يوجد'].map(opt => (
                        <span key={opt} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{
                                width: '14px', height: '14px', border: '1.5px solid #92400e', borderRadius: '3px',
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '10px', fontWeight: 900,
                                backgroundColor: booklet.type === opt ? '#fef08a' : 'transparent',
                            }}>
                                {booklet.type === opt ? '✓' : ''}
                            </span>
                            دفتر {opt}
                        </span>
                    ))}
                    {booklet.type && booklet.type !== 'لا يوجد' && booklet.changes && (
                        <span style={{ marginRight: '10px' }}>
                            عدد التبديلات: <strong style={{ color: '#92400e' }}>{booklet.changes}</strong>
                        </span>
                    )}

                    {v.booklet_serial && (
                        <div style={{
                            marginRight: 'auto',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            background: '#fef3c7',
                            padding: '6px 12px',
                            borderRadius: '8px',
                            border: '1px solid #f59e0b',
                        }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <span style={{ fontSize: '11px', color: '#78350f', fontWeight: 600 }}>دفتر الخدمة الرقمي</span>
                                <strong style={{ color: '#b45309', fontFamily: 'monospace', fontSize: '14px' }}>{v.booklet_serial}</strong>
                                <span style={{ fontSize: '9px', color: '#92400e' }}>امسح لعرض سجل الصيانة</span>
                            </div>
                            <BookletCodes serial={v.booklet_serial} variant="report" />
                        </div>
                    )}
                </div>

                {/* ══ ENGINE COLOR ON RECEIPT — حالة المحرك عند الاستلام ══ */}
                <div style={{
                    background: '#fff7ed', border: '1px solid #fdba74', borderRadius: '8px',
                    padding: '6px 12px',
                    display: 'flex', gap: '18px', alignItems: 'center',
                    marginBottom: mb('4px', '8px'),
                    fontSize: '12px',
                    flexWrap: 'wrap',
                }}>
                    <strong style={{ color: '#9a3412' }}>لون المحرك من الداخل قبل تبديل الزيت :</strong>
                    {['نظيف', 'نصف نظيف', 'أسود'].map(opt => (
                        <span key={opt} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{
                                width: '14px', height: '14px', border: '1.5px solid #9a3412', borderRadius: '3px',
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '10px', fontWeight: 900,
                                backgroundColor: engineColorVal === opt ? '#fed7aa' : 'transparent',
                            }}>
                                {engineColorVal === opt ? '✓' : ''}
                            </span>
                            {opt}
                        </span>
                    ))}
                </div>

                {/* ══ CLIENT + VEHICLE ══ */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px', marginBottom: mb('4px', '8px') }}>
                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '5px 9px' }}>
                        {/* ↑ padding: was 6px 10px */}
                        <div style={{ fontWeight: 800, fontSize: '12px', color: '#dc2626', borderBottom: '1px solid #fca5a5', paddingBottom: '2px', marginBottom: '4px' }}>
                            {/* ↑ 11px → 12px */}
                            👤 بيانات العميل
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '12px' }}>
                            {/* ↑ 11px → 12px */}
                            <div>الاسم: <Val v={client.name} w={130} /></div>
                            <div>رقم الهاتف: <Val v={client.phone} w={115} /></div>
                            {data?.driverRoute ? <div>خط السائق: <Val v={data.driverRoute} w={130} /></div> : null}
                            {/* Government contract (آجل): the body being invoiced, printed so the sheet can go to them. */}
                            {report?.contract?.name ? <div>جهة التعاقد: <span style={{ fontWeight: 800 }}>عقد {report.contract.name} (آجل)</span></div> : null}
                        </div>
                    </div>
                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '5px 9px' }}>
                        {/* ↑ padding: was 6px 10px */}
                        <div style={{ fontWeight: 800, fontSize: '12px', color: '#dc2626', borderBottom: '1px solid #fca5a5', paddingBottom: '2px', marginBottom: '4px' }}>
                            {/* ↑ 11px → 12px */}
                            🚗 بيانات السيارة
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px', fontSize: '12px' }}>
                            {/* ↑ 11px → 12px */}
                            <div>النوع: <Val v={v.make} w={60} /></div>
                            <div>الموديل: <Val v={v.model} w={60} /></div>
                            <div>المحرك: <Val v={v.engine_size} w={50} /></div>
                            <div>الكيلومتر: <Val v={report.odometer_reading} w={50} /></div>
                        </div>
                    </div>
                </div>

                {/* ══ FREE SERVICES ══ */}
                <div style={{
                    background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px',
                    padding: '4px 10px',                           // ↓ was 5px 12px
                    display: 'flex', gap: '24px',
                    marginBottom: mb('4px', '8px'),                // ↓ was 6px/10px
                    fontSize: '12px',                              // ↑ was 11px
                    alignItems: 'center',
                }}>
                    <strong style={{ color: '#166534', whiteSpace: 'nowrap' }}>✅ خدمات مجانية:</strong>
                    {[
                        { key: 'windshieldWater', label: 'ماء المساحات' },
                        { key: 'tirePressure', label: 'ضغط الإطارات' },
                        { key: 'engineClean', label: 'تنظيف المحرك بالبخار' },
                    ].map(f => (
                        <span key={f.key} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: (fs as any)[f.key] ? '#15803d' : '#9ca3af' }}>
                            <Tick ok={(fs as any)[f.key]} /> {f.label}
                        </span>
                    ))}
                </div>

                {/* ══ MAIN SERVICES TABLE ══ */}
                <div style={{ border: '1.5px solid #1a1a2e', borderRadius: '8px', overflow: 'hidden', marginBottom: mb('4px', '8px') }}>
                    {/* ↓ marginBottom was 6px/10px */}
                    <div style={{
                        background: 'linear-gradient(90deg,#1a1a2e,#2d2d5e)', color: 'white',
                        padding: '4px 10px',                       // ↓ was 5px 12px
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                        <span style={{ fontWeight: 800, fontSize: '13px' }}>
                            {/* ↑ was 12px → 13px */}
                            خدمات العميل — الفحص الدوري مع كل زيارة
                        </span>
                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                            {/* ↑ was 10px → 11px */}
                            {isSectorBranch ? `${flatSectorServices.length} خدمة أساسية` : '14 خدمة أساسية'}
                        </span>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', tableLayout: 'fixed' }}>
                        {/* ↑ fontSize was 10px → 12px */}
                        <thead>
                            <tr style={{ background: '#f1f5f9', fontSize: '10px', color: '#64748b', fontWeight: 700 }}>
                                {/* ↑ fontSize was 9px → 10px */}
                                <th style={{ padding: '3px 4px', width: '20px' }}>#</th>
                                <th style={{ padding: '3px 5px', textAlign: 'right', width: '105px' }}>الخدمة</th>
                                <th style={{ padding: '3px 5px', textAlign: 'right', width: '125px' }}>الحالة</th>
                                <th style={{ padding: '3px 5px', textAlign: 'right' }}>التفاصيل</th>
                                <th style={{ padding: '3px 5px', width: '58px', textAlign: 'center' }}>السعر (د.ع)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {SERVICES.map((svc, i) => (
                                <tr key={svc.key} style={{ borderBottom: '1px solid #e5e7eb' }}>
                                    <td style={{ padding: rowPadding, textAlign: 'center', fontWeight: 700, fontSize: '12px', color: '#6b7280', width: '20px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{i + 1}</td>
                                    {/* ↑ fontSize was 10px → 12px */}
                                    <td style={{ padding: rowPadding, fontWeight: 700, fontSize: '12px', width: '105px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{svc.label}</td>
                                    {/* ↑ fontSize was 10px → 12px */}
                                    <td style={{ padding: rowPadding, verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                                        <StatusBadge status={(s as any)[svc.key]?.status} />
                                    </td>
                                    <td style={{ padding: rowPadding, verticalAlign: 'middle', overflow: 'hidden' }}>
                                        {(svc.key === 'additives' || svc.key === 'tires') ? (
                                            <span style={{ display: 'inline-flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', fontSize: '11px' }}>
                                                {/* ↑ was 10px → 11px */}
                                                {Object.keys((s as any)[svc.key]?.details || {}).filter(k => k.startsWith('prod_')).map((k) => {
                                                    const det = (s as any)[svc.key]?.details || {};
                                                    const suf = k.replace('prod_', '');
                                                    const qty = det[`qty_${suf}`];
                                                    const note = det[`notes_${suf}`];
                                                    return (
                                                        <span key={k} style={{ whiteSpace: 'nowrap', fontSize: '11px' }}>
                                                            <Val v={det[k]} w={60} />
                                                            {svc.key === 'tires' && qty ? <span> × {qty}</span> : null}
                                                            {svc.key === 'tires' && note ? <span style={{ color: '#b45309' }}> ({note})</span> : null}
                                                        </span>
                                                    );
                                                })}
                                            </span>
                                        ) : (svc.fields && svc.fields.length > 0 && (
                                            <span style={{ display: 'inline-flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', fontSize: '11px' }}>
                                                {/* ↑ was 10px → 11px */}
                                                {svc.fields.map(f => (
                                                    <span key={f.key} style={{ whiteSpace: 'nowrap', fontSize: '11px' }}>
                                                        {f.label}: <Val v={(s as any)[svc.key]?.details?.[f.key]} w={42} />
                                                    </span>
                                                ))}
                                                {(s as any)[svc.key]?.details?.notes && (
                                                    <span style={{ whiteSpace: 'normal', fontSize: '11px', color: '#b45309', fontWeight: 'bold' }}>
                                                        ملاحظات: {(s as any)[svc.key].details.notes}
                                                    </span>
                                                )}
                                            </span>
                                        ))}
                                    </td>
                                    <td style={{ padding: rowPadding, textAlign: 'center', fontWeight: 700, fontSize: '12px', width: '58px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                                        {/* ↑ fontSize was 10px → 12px */}
                                        <Val v={(s as any)[svc.key]?.price} w={48} />
                                    </td>
                                </tr>
                            ))}

                            {/* Custom / extra services */}
                            {customs.filter((c: any) => c.label).map((c: any, i: number) => {
                                const customPadding = totalItems > 14 ? '1px 3px' : '4px 7px';  // ↓ was '2px 4px' / '5px 8px'
                                const customFontSize = totalItems > 14 ? '11px' : '13px';     // ↑ was '10px' / '12px'
                                return (
                                    <tr key={c.id} style={{ borderBottom: '1px solid #e5e7eb', background: '#fffbeb' }}>
                                        <td style={{ padding: customPadding, textAlign: 'center', fontWeight: 700, fontSize: customFontSize, color: '#92400e' }}>{SERVICES.length + i + 1}</td>
                                        <td style={{ padding: customPadding, fontWeight: 700, fontSize: customFontSize, color: '#92400e' }}>{c.label}</td>
                                        <td style={{ padding: customPadding }}><StatusBadge status={c.status} /></td>
                                        <td style={{ padding: customPadding, fontSize: totalItems > 14 ? '10px' : '12px', color: '#6b7280' }}>
                                            {c.notes ? c.notes : 'حدث صيانة'}
                                        </td>
                                        {/* ↑ was '9px' / '11px' → '10px' / '12px' */}
                                        <td style={{ padding: customPadding, textAlign: 'center', fontWeight: 700 }}>
                                            <Val v={formatNum(c.price)} w={55} />
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* ══ TOTALS ══ */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4,1fr)',
                    gap: '5px',                                    // ↓ was 6px
                    marginBottom: mb('4px', '9px'),                // ↓ was 6px/12px
                }}>
                    {[
                        { label: 'المجموع الكلي', val: formatNum(p.totalPrice || 0), color: '#1a1a2e' },
                        { label: 'الخصم', val: formatNum(p.discount || 0), color: '#d97706' },
                        { label: 'المبلغ الواصل', val: formatNum(p.amountReceived || 0), color: '#15803d' },
                        { label: 'الباقي', val: formatNum(p.amountOwedByClient || 0), color: '#dc2626' },
                    ].map(item => (
                        <div key={item.label} style={{
                            border: `1.5px solid ${item.color}22`, borderRadius: '8px',
                            padding: totalItems > 14 ? '3px 5px' : '5px 8px',  // ↓ was '3px 6px' / '6px 10px'
                            textAlign: 'center',
                            background: `${item.color}08`,
                        }}>
                            <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '2px' }}>{item.label}</div>
                            {/* ↑ was 10px → 11px */}
                            <div style={{ fontWeight: 900, fontSize: totalItems > 14 ? '13px' : '15px', color: item.color }}>
                                {/* ↑ was '12px'/'14px' → '13px'/'15px' */}
                                {item.val || '—'}
                            </div>
                            {item.val && <div style={{ fontSize: '10px', color: '#9ca3af' }}>د.ع</div>}
                            {/* ↑ was 9px → 10px */}
                        </div>
                    ))}
                </div>

                {/* ══ NOTES ══ */}
                {report.notes && (
                    <div style={{
                        background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px',
                        padding: totalItems > 14 ? '3px 9px' : '5px 11px',   // ↓ was '4px 10px' / '6px 12px'
                        marginBottom: mb('4px', '8px'),                        // ↓ was 6px/10px
                        fontSize: '12px',                                      // ↑ was 11px
                    }}>
                        <strong>ملاحظات:</strong> {report.notes}
                    </div>
                )}

                {/* ══ SIGNATURES ══ */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginTop: sigMargin }}>
                    {['توقيع الزبون', 'موظف الاستقبال', 'مشرف الصيانة', 'الكاشير'].map(sig => (
                        <div key={sig} style={{ textAlign: 'center', borderTop: '1px dashed #9ca3af', paddingTop: '4px' }}>
                            <div style={{ height: sigHeight }} />
                            <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: 600 }}>{sig}</div>
                            {/* ↑ was 10px → 11px */}
                        </div>
                    ))}
                </div>

            </div>
        </div>
    );
});

PrintableInspectionReport.displayName = 'PrintableInspectionReport';