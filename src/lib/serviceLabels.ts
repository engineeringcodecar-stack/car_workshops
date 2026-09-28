// Service key → Arabic label, for the keys reception writes into
// selected_services[0].services (standard and القطاع service sets).
export const SERVICE_LABELS: Record<string, string> = {
    engineOil: "زيت المحرك", oilFilter: "فلتر زيت المحرك", airFilter: "فلتر الهواء",
    acFilter: "فلتر التبريد", brakeFluid: "زيت المكابح", coolant: "ماء الراديتر",
    battery: "البطارية", engineBelts: "قايش المحرك",
    brakePads: "دسكات السيارة", sparkPlugs: "شمعات الاحتراق",
    gearboxOil: "زيت كير", gearboxHydraulic: "هايدروليك الكير", gearboxFilter: "فلتر الكير",
    wipers: "مساحات زجاج", windshieldFluid: "سائل غسيل جام", tires: "الإطارات",
    battery2: "البطارية فحص دوري", batteryFilter: "فلتر البطارية",
    engineFlash: "فلاش المحرك", engineCeramic: "سيراميك محرك",
    linerCleaner: "منظف بطانة (جكجكة)", oilLeakPreventer: "مانع تسريب زيت",
    smokePreventer: "مانع دخان", gearboxFlash: "فلاش كير",
    gearboxCeramic: "سيراميك كير", gearboxAntiSlip: "مانع انزلاق كير",
    acCleaner: "منظف دورة تبريد", injectorCleaner: "منظف بخاخات",
    fuelSystemCleaner: "منظف نظام وقود", octaneBooster: "محسن أوكتان",
    additives: "معالجات ومحسنات", cleaners: "منظفات وأساسيات",
    transOil: "زيت ناقل الحركة", differentialOil: "زيت الدبل / البكك",
    maintenanceUnits: "وحدات الصيانة",
};

export const FREE_SERVICE_LABELS: Record<string, string> = {
    windshieldWater: "ماء المساحات", tirePressure: "ضغط الإطارات", engineClean: "تنظيف محرك بالبخار",
};
