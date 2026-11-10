export type Lang = "ar" | "en";

/**
 * Official agencies, from the company's post of 24 May 2025 ("الوكيل الرسمي لمجموعة شركات").
 * Written in Latin in both languages, the way the brands write their names.
 */
// Official agencies: name, logo in /site/agencies/, the logo's own width and height, and a dark chip for logos made for dark backgrounds.
export const AGENCIES: [string, string, number, number, boolean?][] = [
    ["Castrol", "castrol.svg", 456, 110],
    ["Liqui Moly", "liqui-moly.svg", 568, 371],
    ["Mobil 1", "mobil1.webp", 360, 80],
    ["Valvoline", "valvoline.svg", 288, 196],
    ["MEGUIN", "meguin.svg", 639, 274],
    ["K&N", "kn.svg", 820, 285],
    ["Denckermann", "denckermann.webp", 360, 44, true],
    ["Autolite", "autolite.webp", 360, 74],
];

export const INVEST_EMAIL = "investment@handsacars.com";
export const INFO_EMAIL = "info@handsacars.com";
export const RELATIONS_PHONE = "+964 788 777 9803";
export const WHATSAPP = "https://wa.me/9647887779803";
export const SOCIALS = [
    ["Facebook", "https://www.facebook.com/Carsiqmaysan"],
    ["Instagram", "https://www.instagram.com/carsiqmaysan"],
    ["TikTok", "https://www.tiktok.com/@carsiqmaysan"],
] as const;

/**
 * Inspection points, as % of the 1672x941 car image. The page draws that image 12% narrower
 * (stretched 1.1364 in height about its middle, see `.stage-car`), so the heights are moved
 * the same way when they are placed.
 */
const HOTSPOTS_ON_IMAGE: [number, number][] = [
    [53.8, 44.6],
    [54, 60.5],
    [44.2, 52.4],
    [66, 69],
    [78, 63],
    [90, 62],
];
export const HOTSPOTS: [number, number][] = HOTSPOTS_ON_IMAGE.map(([x, y]) => [x, +(50 + (y - 50) * 1.1364).toFixed(1)]);

/** Which products/ image goes with each entry in `products.items`. */
export const PRODUCT_IMAGES = ["oils", "filters", "tyres", "parts"];

const AR = {
    meta: {
        title: "مركز هندسة السيارات | Engineering of Cars",
        description: "شبكة مراكز صيانة وتشخيص للسيارات بمعيار هندسي واحد ونظام تشغيل موحد، ووكيل رسمي لعلامات عالمية مثل Castrol وLiqui Moly وMobil 1. فروعنا، خدماتنا، منتجاتنا وفرص الاستثمار.",
    },
    langBtn: "EN",
    langHref: "/en",
    langAria: "Switch to English",
    menu: "القائمة",
    arrow: "←",
    homeAria: "هندسة السيارات، الرئيسية",
    nav: {
        about: "من نحن",
        branches: "فروعنا",
        services: "خدماتنا",
        inspect: "الفحص",
        tech: "التقنيات",
        products: "منتجاتنا",
        passport: "جواز الخدمة",
        invest: "الاستثمار",
        contact: "تواصل معنا",
    },
    hero: {
        a: "ليست مجرد صيانة…",
        b: "هندسة تثق بها.",
        sub: "تشخيص دقيق قبل أي إصلاح، وضمان حقيقي وأسعار تنافسية. أربعة فروع بمعيار واحد.",
        pillars: ["خبرة", "جودة", "تنظيم"],
        cta1: "استكشف خدماتنا",
        cta2: "فرص الاستثمار",
        scroll: "مرّر للاستكشاف",
        alt: "سيارة سوداء بإضاءة حمراء سينمائية",
    },
    agencies: { label: "الوكالات المعتمدة" },
    proof: [["04", "فروع عاملة"], ["08", "علامات عالمية بوكالة رسمية"], ["+250 ألف", "متابع على منصات التواصل"], ["+550 ألف", "مشاهدة لأعلى فيديو"]],
    about: {
        title: "نتعامل مع سيارتك كما يتعامل المهندس مع مشروعه.",
        body: "هندسة السيارات أول مشروع هندسي منظم يشخّص الأعطال بأحدث الأجهزة لضمان الدقة، بضمان حقيقي وأسعار تنافسية. تمر كل سيارة بالمنهجية نفسها: نفحص، ونوضّح لك النتيجة، ثم نبدأ العمل.",
        steps: [
            ["نفحص", "تشخيص بالأجهزة وقراءة بيانات السيارة قبل أي قرار."],
            ["نوضّح", "تعرف المشكلة والمطلوب قبل أن نبدأ العمل."],
            ["ننفّذ", "صيانة وفق مواصفات الشركة المصنّعة، وتُسجَّل كل خدمة في جواز سيارتك."],
        ],
    },
    branches: {
        title: "أربعة فروع، معيار واحد",
        word: "فرع",
        address: "العنوان",
        phone: "الهاتف",
        call: "اتصل بالفرع",
        hub: "نظام تشغيل موحد",
        items: [
            { name: "القطاع", alt: "Sector", address: "ميسان، سايدين مستشفى الصدر، قرب المجسر", phone: "+964 776 633 1112" },
            { name: "الصناعية", alt: "Industrial", address: "الصناعية، شارع المعارض", phone: "+964 776 633 1113" },
            { name: "المجر", alt: "Al-Majar", address: "قضاء المجر، محطة وقود أنوار المجر", phone: "+964 776 633 1114" },
            { name: "الكراج", alt: "Garage", address: "العمارة، داخل كراج العمارة الموحد", phone: "" },
        ],
    },
    services: {
        title: "خدماتنا المتكاملة",
        hint: "اختر خدمة لعرض تفاصيلها.",
        includes: "تشمل",
        branchesCta: "شاهد الفروع",
        items: [
            { name: "تبديل الزيت والفلاتر", desc: "تبديل زيت المحرك بزيوت من وكالاتنا الرسمية، مع فلاتر الزيت والهواء والبنزين والتبريد، وفق مواصفات الشركة المصنّعة.", inc: ["زيت المحرك", "فلتر الزيت", "فلتر الهواء", "فلتر البنزين", "فلتر التبريد"] },
            { name: "تشخيص الأعطال إلكترونياً", desc: "قراءة أكواد الأعطال والبيانات الحية من وحدات التحكم لتحديد السبب قبل أي إصلاح.", inc: ["قراءة الأكواد", "بيانات الحساسات", "تحديد العطل"] },
            { name: "فحص الاهتزاز الإلكتروني", desc: "قياس الاهتزازات وتحديد مصدرها: الإطارات، أو أعمدة الدوران، أو المحرك، أو ناقل الحركة.", inc: ["قياس بالسرعات", "تحديد المصدر", "توصية"] },
            { name: "ضبط زوايا العجلات (الميزانية)", desc: "فحص الميزانية مجاناً، وضبط زوايا العجلات لثبات القيادة وتقليل تآكل الإطارات.", inc: ["فحص مجاني", "قياس الزوايا", "الضبط"] },
            { name: "تبديل زيت ناقل الحركة", desc: "تبديل زيت ناقل الحركة الأوتوماتيكي بالنوع والكمية المحددين للسيارة.", inc: ["زيت ناقل الحركة", "فحص التسريب"] },
            { name: "خدمة منظومة التبريد", desc: "فحص سائل التبريد وتبديله، وفحص المبرّد والخراطيم والمروحة.", inc: ["سائل التبريد", "المبرّد", "الخراطيم"] },
            { name: "خدمة منظومة الفرامل", desc: "تبديل زيت الفرامل وفحص الفحمات والأقراص.", inc: ["زيت الفرامل", "الفحمات", "الأقراص"] },
            { name: "الإطارات", desc: "فحص الإطارات وضغط الهواء والتآكل، والتبديل عند الحاجة.", inc: ["ضغط الهواء", "التآكل", "الترصيص"] },
        ],
    },
    inspect: {
        title: "فحص شامل لسيارتك",
        hint: "اضغط على نقاط الفحص لاستعراض كل منظومة، أو شاهد الفحص الكامل.",
        alt: "سيارة سوداء مع نقاط فحص تفاعلية",
        run: "شاهد الفحص الكامل",
        running: "جارٍ الفحص",
        again: "إعادة العرض",
        checks: "نقاط الفحص",
        related: "الخدمات المرتبطة",
        systems: [
            { name: "المحرك", checks: ["مستوى الزيت وحالته", "التسريبات", "أكواد الأعطال"], rel: [0, 1] },
            { name: "التبريد", checks: ["مستوى سائل التبريد", "المبرّد والخراطيم", "المروحة"], rel: [5] },
            { name: "الكهرباء", checks: ["البطارية", "منظومة الشحن", "الإضاءة"], rel: [1] },
            { name: "ناقل الحركة", checks: ["زيت ناقل الحركة", "نعومة التبديل", "الاهتزاز"], rel: [4, 2] },
            { name: "الفرامل", checks: ["سماكة الفحمات", "الأقراص", "زيت الفرامل"], rel: [6] },
            { name: "الإطارات والزوايا", checks: ["ضغط الهواء", "التآكل", "زوايا العجلات"], rel: [3, 7] },
        ],
    },
    tech: {
        title: "أجهزة تشخيص حديثة، وقرارات مبنية على القراءة لا على التخمين.",
        items: [
            ["أجهزة تشخيص بالكمبيوتر", "قراءة أكواد الأعطال والبيانات الحية من وحدات التحكم الإلكترونية في السيارة."],
            ["محلل الاهتزاز الإلكتروني", "تحديد مصدر الاهتزاز بالقياس، بدل التبديل العشوائي للقطع."],
            ["منظومة ضبط زوايا العجلات", "قياس زوايا العجلات وضبطها بدقة."],
            ["معدات تبديل السوائل", "تبديل زيت ناقل الحركة وسائل التبريد وزيت الفرامل بطريقة نظيفة وبكمية مضبوطة."],
        ],
    },
    products: {
        title: "ما يدخل سيارتك نختاره بالمواصفة.",
        items: [
            { name: "الزيوت وسوائل التشغيل", body: "ليكوي مولي، كاسترول، موبل 1، فالفولين وميغوين، من وكالاتنا الرسمية وبمواصفات الشركة المصنّعة.", alt: "عبوة زيت محرك" },
            { name: "الفلاتر", body: "فلاتر الزيت والهواء والبنزين والتبريد، من علامات مثل Denckermann وK&N.", alt: "فلتر زيت وفلتر هواء" },
            { name: "الإطارات", body: "مع خدمة الترصيص وضبط الزوايا.", alt: "إطار سيارة" },
            { name: "البطاريات وقطع الصيانة", body: "بطاريات ECO بضمان استبدال، وفحمات وأقراص الفرامل، وقطع الصيانة الدورية.", alt: "قرص فرامل وفحمات" },
        ],
    },
    passport: {
        title: "تاريخ سيارتك في مكان واحد.",
        body: "تُسجَّل كل زيارة في جواز رقمي يصل إليه العميل عبر رمز QR: الخدمات، والفرع، وقراءة العداد.",
        tag: "مثال توضيحي لمركبة افتراضية",
        stats: [["المركبة", "سيدان 2022"], ["العداد", "124,500 كم"], ["الزيارات", "9"], ["حالة الخدمة", "محدّثة"]],
        timeline: [
            { date: "2026-09-14", km: "124,500", svc: 0, branch: 0, note: "تبديل زيت 5W-30 مع فلتر الزيت والهواء. لا توجد ملاحظات إضافية." },
            { date: "2026-06-02", km: "118,200", svc: 3, branch: 1, note: "ضبط زوايا العجلات الأمامية. تآكل خفيف في الإطار الأمامي الأيسر." },
            { date: "2026-02-20", km: "112,900", svc: 6, branch: 0, note: "تبديل زيت الفرامل. الفحمات الأمامية بحالة جيدة." },
            { date: "2025-11-08", km: "107,300", svc: 4, branch: 3, note: "تبديل زيت ناقل الحركة. يُنصح بالفحص التالي بعد 40,000 كم." },
            { date: "2025-07-15", km: "101,800", svc: 1, branch: 2, note: "فحص بالكمبيوتر بسبب لمبة المحرك. تم تبديل حساس الأكسجين." },
        ],
        // The phone shows the real booklet's screen; its statuses are the ones the booklet uses.
        phone: {
            title: "دفتر الخدمة الرقمي",
            verified: "موثّق",
            now: "حالة سيارتك الآن",
            visit: "زيارة",
            summary: "الملخص الشامل للمركبة",
            steps: ["تم الاستلام", "قيد العمل", "بانتظار المحاسبة", "مكتملة"],
            states: ["تم استلام السيارة", "قيد العمل الآن", "تم الانتهاء — بانتظار المحاسبة", "مكتملة — تم التسليم"],
            vehicle: "المركبة",
            odo: "آخر قراءة عداد",
            visits: "إجمالي الزيارات",
            last: "آخر زيارة",
            km: "كم",
        },
        sticker: "ملصق QR",
        how: [
            ["ملصق QR لسيارتك", "رمز خاص بسيارتك، مرتبط بسجلها في نظامنا."],
            ["امسح بكاميرا الهاتف", "يفتح السجل مباشرة، بدون تطبيق ولا تسجيل دخول."],
            ["تابع سيارتك وراجع تاريخها", "حالة سيارتك أثناء العمل، وكل زيارة سابقة بتفاصيلها."],
        ],
    },
    invest: {
        title: "شبكة تشغيل جاهزة للتوسع.",
        body: "نبني هندسة السيارات نموذجاً قابلاً للنقل: فروع تعمل بمعيار واحد، ونظام تشغيل خاص بنا يدير كل مرحلة من الاستقبال إلى المحاسبة. نرحّب بالشركاء الراغبين في نقل هذا المعيار إلى أسواق المنطقة.",
        cta: "تواصل مع فريق الاستثمار",
        subject: "استفسار استثماري",
        pillars: [
            ["04 فروع عاملة", "شبكة قائمة بمنهجية عمل موحدة، لا فكرة على الورق."],
            ["وكيل رسمي لثماني علامات عالمية", "منها Castrol وLiqui Moly وMobil 1 وValvoline."],
            ["جمهور يتجاوز 250 ألف متابع", "على فيسبوك وإنستغرام وتيك توك، بمحتوى فني يصل إلى مئات آلاف المشاهدات."],
            ["نظام إدارة خاص بنا", "الاستقبال وأوامر العمل والمخزون والمحاسبة والموارد البشرية في منصة واحدة، مع سجل رقمي لكل مركبة يصل إليه العميل عبر رمز QR."],
            ["عقود مؤسسية", "إدارة عقود الجهات والمؤسسات ضمن النظام نفسه."],
        ],
    },
    contact: {
        title: "جاهز لتضع سيارتك بين أيدي مهندسين؟",
        seeBranches: "شاهد الفروع",
        investLabel: "الاستثمار والشراكات",
        infoLabel: "الاستفسارات العامة",
        phoneLabel: "قسم المتابعة والعلاقات",
        whatsappLabel: "واتساب",
    },
    // Floating WhatsApp button, and the messages a chat opens with.
    wa: {
        label: "راسلنا على واتساب",
        text: "السلام عليكم، أريد الاستفسار عن خدمات مركز هندسة السيارات.",
        invest: "السلام عليكم، لدي استفسار عن فرص الاستثمار مع هندسة السيارات.",
    },
    foot: { branches: "فروعنا", sitemap: "الموقع", follow: "تابعنا" },
    rights: "© هندسة السيارات. جميع الحقوق محفوظة.",
};

export type SiteContent = typeof AR;

const EN: SiteContent = {
    meta: {
        title: "Engineering of Cars | هندسة السيارات",
        description: "A network of car service and diagnostic centres run to one engineering standard on one operating system, and official agent for global brands including Castrol, Liqui Moly and Mobil 1. Branches, services, products and investment.",
    },
    langBtn: "ع",
    langHref: "/ar",
    langAria: "التبديل إلى العربية",
    menu: "Menu",
    arrow: "→",
    homeAria: "Engineering of Cars, home",
    nav: {
        about: "About",
        branches: "Branches",
        services: "Services",
        inspect: "Inspection",
        tech: "Technology",
        products: "Products",
        passport: "Passport",
        invest: "Investment",
        contact: "Contact",
    },
    hero: {
        a: "Not just maintenance.",
        b: "Engineering you can trust.",
        sub: "Accurate diagnosis before any repair, a real guarantee and competitive prices. Four branches, one standard.",
        pillars: ["Expertise", "Quality", "Order"],
        cta1: "Explore services",
        cta2: "Investment",
        scroll: "SCROLL TO EXPLORE",
        alt: "Black car in cinematic red light",
    },
    agencies: { label: "Official agencies" },
    proof: [["04", "operating branches"], ["08", "global brands, official agent"], ["250K+", "followers across social platforms"], ["550K+", "views on our top video"]],
    about: {
        title: "We approach your car the way an engineer approaches a project.",
        body: "Engineering of Cars is the first organised engineering project of its kind, diagnosing faults with the latest equipment for accuracy, with a real guarantee and competitive prices. Every car follows the same method: we inspect, we explain the result, then we work.",
        steps: [
            ["Inspect", "Instrument-based diagnosis and a read of the vehicle data before any decision."],
            ["Explain", "You know what the problem is and what it needs before work starts."],
            ["Execute", "Service to manufacturer specification, with every job logged in your car's passport."],
        ],
    },
    branches: {
        title: "Four branches, one standard",
        word: "",
        address: "Address",
        phone: "Phone",
        call: "Call this branch",
        hub: "Unified operating system",
        items: [
            { name: "Sector", alt: "القطاع", address: "Maysan, Al-Sadr Hospital side road, near the overpass", phone: "+964 776 633 1112" },
            { name: "Industrial", alt: "الصناعية", address: "Industrial area, Al-Ma'arid Street", phone: "+964 776 633 1113" },
            { name: "Al-Majar", alt: "المجر", address: "Al-Majar district, Anwar Al-Majar fuel station", phone: "+964 776 633 1114" },
            { name: "Garage", alt: "الكراج", address: "Amarah, inside the Unified Amarah Garage", phone: "" },
        ],
    },
    services: {
        title: "Complete car care",
        hint: "Select a service to see its details.",
        includes: "INCLUDES",
        branchesCta: "See branches",
        items: [
            { name: "Oil & filters", desc: "Engine oil from our official agencies, with oil, air, fuel and AC filters, to manufacturer specification.", inc: ["Engine oil", "Oil filter", "Air filter", "Fuel filter", "AC filter"] },
            { name: "Computer diagnostics", desc: "Reading fault codes and live data from the control units to find the cause before any repair.", inc: ["Fault codes", "Live sensor data", "Fault location"] },
            { name: "Electronic vibration testing", desc: "Measuring vibration and locating its source: tyres, driveshafts, engine or transmission.", inc: ["Speed-range readings", "Source location", "Recommendation"] },
            { name: "Wheel alignment", desc: "A free alignment check, then setting wheel angles for stable driving and even tyre wear.", inc: ["Free check", "Angle measurement", "Adjustment"] },
            { name: "Automatic transmission fluid", desc: "Automatic transmission fluid exchange with the correct type and quantity for the vehicle.", inc: ["ATF", "Leak check"] },
            { name: "Cooling system service", desc: "Coolant check and replacement, with radiator, hose and fan inspection.", inc: ["Coolant", "Radiator", "Hoses"] },
            { name: "Brake system service", desc: "Brake fluid replacement and inspection of pads and discs.", inc: ["Brake fluid", "Pads", "Discs"] },
            { name: "Tyres", desc: "Tyre inspection for pressure and wear, with replacement when needed.", inc: ["Pressure", "Wear", "Balancing"] },
        ],
    },
    inspect: {
        title: "A complete inspection",
        hint: "Tap the inspection points to explore each system, or watch the full inspection.",
        alt: "Black car with interactive inspection points",
        run: "Watch full inspection",
        running: "Inspecting",
        again: "Replay",
        checks: "Checkpoints",
        related: "Related services",
        systems: [
            { name: "Engine", checks: ["Oil level & condition", "Leaks", "Fault codes"], rel: [0, 1] },
            { name: "Cooling", checks: ["Coolant level", "Radiator & hoses", "Fan"], rel: [5] },
            { name: "Electrical", checks: ["Battery", "Charging system", "Lighting"], rel: [1] },
            { name: "Transmission", checks: ["Transmission fluid", "Shift quality", "Vibration"], rel: [4, 2] },
            { name: "Brakes", checks: ["Pad thickness", "Discs", "Brake fluid"], rel: [6] },
            { name: "Tyres & alignment", checks: ["Pressure", "Wear", "Alignment angles"], rel: [3, 7] },
        ],
    },
    tech: {
        title: "Modern diagnostic equipment, and decisions based on readings, not guesses.",
        items: [
            ["Computer diagnostic scanners", "Reading fault codes and live data from the vehicle's electronic control units."],
            ["Electronic vibration analyser", "Locating vibration by measurement instead of replacing parts at random."],
            ["Wheel alignment system", "Accurate measurement and setting of wheel angles."],
            ["Fluid exchange equipment", "Clean, measured exchange of transmission fluid, coolant and brake fluid."],
        ],
    },
    products: {
        title: "What goes into your car is chosen by specification.",
        items: [
            { name: "Oils & operating fluids", body: "Liqui Moly, Castrol, Mobil 1, Valvoline and MEGUIN, from our official agencies and to manufacturer specification.", alt: "Engine oil container" },
            { name: "Filters", body: "Oil, air, fuel and AC filters, from brands including Denckermann and K&N.", alt: "Oil filter and air filter" },
            { name: "Tyres", body: "With balancing and wheel alignment.", alt: "Car tyre" },
            { name: "Batteries & service parts", body: "ECO batteries with a replacement warranty, brake pads and discs, and routine service parts.", alt: "Brake disc and pads" },
        ],
    },
    passport: {
        title: "Your car's history, in one place.",
        body: "Every visit is recorded in a digital passport customers open with a QR code: services, branch and odometer reading.",
        tag: "Illustrative example, fictional vehicle",
        stats: [["Vehicle", "Sedan 2022"], ["Odometer", "124,500 km"], ["Visits", "9"], ["Service status", "Up to date"]],
        timeline: [
            { date: "2026-09-14", km: "124,500", svc: 0, branch: 0, note: "5W-30 oil change with oil and air filter. No further notes." },
            { date: "2026-06-02", km: "118,200", svc: 3, branch: 1, note: "Front alignment set. Light wear on front-left tyre." },
            { date: "2026-02-20", km: "112,900", svc: 6, branch: 0, note: "Brake fluid replaced. Front pads in good condition." },
            { date: "2025-11-08", km: "107,300", svc: 4, branch: 3, note: "ATF exchanged. Next check recommended in 40,000 km." },
            { date: "2025-07-15", km: "101,800", svc: 1, branch: 2, note: "Diagnostics for check-engine light. Oxygen sensor replaced." },
        ],
        phone: {
            title: "Digital service booklet",
            verified: "Verified",
            now: "Your car right now",
            visit: "Visit",
            summary: "Vehicle summary",
            steps: ["Received", "In progress", "Awaiting billing", "Completed"],
            states: ["Car received", "Work in progress", "Done, awaiting billing", "Completed, handed over"],
            vehicle: "Vehicle",
            odo: "Last odometer",
            visits: "Total visits",
            last: "Last visit",
            km: "km",
        },
        sticker: "QR sticker",
        how: [
            ["A QR sticker for your car", "A code unique to your car, linked to its record in our system."],
            ["Scan with your phone camera", "The record opens straight away. No app, no sign-in."],
            ["Follow it, and look back", "Your car's status while we work on it, and every past visit in detail."],
        ],
    },
    invest: {
        title: "An operating network, ready to expand.",
        body: "We are building Engineering of Cars as a transferable model: branches run to one standard, on our own operating system that manages every stage from reception to accounting. We welcome partners who want to bring this standard to markets across the region.",
        cta: "Contact the investment team",
        subject: "Investment enquiry",
        pillars: [
            ["04 operating branches", "A working network on one method, not an idea on paper."],
            ["Official agent for eight global brands", "Including Castrol, Liqui Moly, Mobil 1 and Valvoline."],
            ["An audience of 250K+ followers", "On Facebook, Instagram and TikTok, with technical content reaching hundreds of thousands of views."],
            ["Our own management system", "Reception, work orders, inventory, accounting and HR on one platform, with a digital record per vehicle that customers open with a QR code."],
            ["Institutional contracts", "Contracts with organisations managed on the same system."],
        ],
    },
    contact: {
        title: "Ready to put your car in an engineer's hands?",
        seeBranches: "See branches",
        investLabel: "Investment and partnerships",
        infoLabel: "General enquiries",
        phoneLabel: "Customer relations",
        whatsappLabel: "WhatsApp",
    },
    wa: {
        label: "Chat on WhatsApp",
        text: "Hello, I'd like to ask about Engineering of Cars services.",
        invest: "Hello, I have an enquiry about investing with Engineering of Cars.",
    },
    foot: { branches: "BRANCHES", sitemap: "SITEMAP", follow: "FOLLOW" },
    rights: "© Engineering of Cars. All rights reserved.",
};

export const CONTENT: Record<Lang, SiteContent> = { ar: AR, en: EN };
