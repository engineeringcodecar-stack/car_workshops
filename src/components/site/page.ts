import { AGENCIES, CONTENT, HOTSPOTS, INFO_EMAIL, INVEST_EMAIL, PRODUCT_IMAGES, RELATIONS_PHONE, SOCIALS, WHATSAPP, type Lang } from "./content";
import { LOGO_BOTTOM, LOGO_TOP, LOGO_VIEWBOX } from "./logoPaths";
import { BOOT, SCRIPT } from "./script";
import { STYLES } from "./styles";

const ORIGIN = "https://www.handsacars.com";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const each = <T,>(items: readonly T[], fn: (item: T, i: number) => string) => items.map(fn).join("");
const pad = (n: number) => String(n).padStart(2, "0");
const tel = (phone: string) => `tel:${phone.replace(/\s/g, "")}`;

const logo = (cls = "") =>
    `<svg class="logo ${cls}" viewBox="${LOGO_VIEWBOX}" role="img" aria-label="هندسة السيارات"><use href="#logo-top" fill="#D5D8DC"/><use href="#logo-bottom" fill="#D32F3A"/></svg>`;

const label = (text: string) => `<div class="label"><span></span><span>${esc(text)}</span></div>`;

const NODES: [number, number][] = [[19, 26], [81, 26], [19, 74], [81, 74]];

function body(lang: Lang) {
    const c = CONTENT[lang];
    const mailto = `mailto:${INVEST_EMAIL}?subject=${encodeURIComponent(c.invest.subject)}`;
    const navKeys = ["about", "branches", "services", "inspect", "products", "invest"] as const;
    const menuKeys = ["about", "branches", "services", "inspect", "tech", "products", "passport", "invest", "contact"] as const;
    const branchName = (i: number) => `${c.branches.word} ${c.branches.items[i].name}`.trim();
    const marquee = Array.from({ length: 4 }, () => `<span><span>ENGINEERING OF CARS</span><span class="red">هندسة السيارات</span></span>`).join("");

    return `
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<path id="logo-top" d="${LOGO_TOP}"/><path id="logo-bottom" d="${LOGO_BOTTOM}"/>
</defs></svg>

<div class="intro" aria-hidden="true">
    <div class="intro-mark">
        <svg class="intro-word intro-top" viewBox="${LOGO_VIEWBOX}"><use href="#logo-top" fill="#D5D8DC"/></svg>
        <svg class="intro-word intro-bottom" viewBox="${LOGO_VIEWBOX}"><use href="#logo-bottom" fill="#D32F3A"/></svg>
        <svg class="intro-word intro-glint" viewBox="${LOGO_VIEWBOX}"><use href="#logo-top" fill="#fff"/><use href="#logo-bottom" fill="#fff"/></svg>
    </div>
    <div class="intro-bar"><i></i></div>
    <div class="intro-name" dir="ltr">ENGINEERING OF CARS</div>
</div>

<div class="curtain" data-s="0" aria-hidden="true"><i></i><i>${logo()}</i></div>
<div class="progress" aria-hidden="true"><i></i></div>

<nav class="nav">
    <a class="nav-logo" href="#top" aria-label="${esc(c.homeAria)}">${logo()}</a>
    <div class="nav-links">${each(navKeys, (k) => `<a href="#${k}" data-nav="${k}"><span>${esc(c.nav[k])}</span></a>`)}</div>
    <div class="nav-actions">
        <a class="nav-lang" href="${c.langHref}" data-lang="1" aria-label="${esc(c.langAria)}">${c.langBtn}</a>
        <a class="nav-cta" href="#contact" data-nav="contact">${esc(c.nav.contact)}</a>
        <button class="nav-burger" aria-label="${esc(c.menu)}" aria-expanded="false"><span></span><span></span></button>
    </div>
</nav>
<div class="menu">${each(menuKeys, (k, i) => `<a href="#${k}"><span dir="ltr">${pad(i + 1)}</span><span>${esc(c.nav[k])}</span></a>`)}</div>

<main id="top">
<header class="hero has-ag">
    <div class="hero-par"><div class="hero-mouse">
        <picture>
            <source media="(max-width: 700px)" srcset="/site/car-tall.webp" width="900" height="1200">
            <img src="/site/car-wide.webp" width="1672" height="941" alt="${esc(c.hero.alt)}" fetchpriority="high" decoding="async">
        </picture>
    </div></div>
    <div class="hero-shade"></div><div class="hero-fade"></div><div class="hero-lines"></div>
    <div class="hero-inner"><div class="hero-copy">
        <div class="hero-eyebrow"><span></span><span>ENGINEERING OF CARS</span></div>
        <h1><span class="line"><span>${esc(c.hero.a)}</span></span><span class="line line-red"><span>${esc(c.hero.b)}</span></span></h1>
        <div class="hero-tag" dir="ltr">ENGINEERING EVERY JOURNEY.</div>
        <p class="hero-sub">${esc(c.hero.sub)}</p>
        <div class="hero-pillars">${each(c.hero.pillars, (p, i) => `<div><span dir="ltr">${pad(i + 1)}</span><span>${esc(p)}</span></div>`)}</div>
        <div class="hero-cta">
            <a class="btn btn-red" href="#services"><span>${esc(c.hero.cta1)}</span><span>${c.arrow}</span></a>
            <a class="btn btn-glass" href="#invest">${esc(c.hero.cta2)}</a>
        </div>
    </div></div>
    <div class="hero-foot">
        <a href="#about"><span class="cue"><i></i></span><span>${esc(c.hero.scroll)}</span></a>
        <span dir="ltr">HANDSACARS.COM</span>
    </div>
    <div class="agencies" aria-label="${esc(c.agencies.label)}">
        <div class="agencies-label">${label(c.agencies.label)}</div>
        <div class="agencies-track-wrap" dir="ltr"><div class="agencies-track">${each(
            [...AGENCIES, ...AGENCIES, ...AGENCIES, ...AGENCIES],
            (name, i) => `<span${i >= AGENCIES.length ? ' aria-hidden="true"' : ""}>${esc(name)}</span>`,
        )}</div></div>
    </div>
</header>

<div class="proof"><div class="wrap proof-in">${each(c.proof, ([value, text], i) => `<div data-reveal="1" data-delay="${i * 80}"><strong>${esc(value)}</strong><span>${esc(text)}</span></div>`)}</div></div>

<section id="about" class="sec about">
    <img class="bg" src="/site/texture.webp" alt="" loading="lazy">
    <div class="wrap about-in">
        <div data-reveal="1" class="about-head">
            ${label("01 — ABOUT")}
            <h2 class="h-about">${esc(c.about.title)}</h2>
            <p class="lead">${esc(c.about.body)}</p>
        </div>
        <div class="steps">${each(c.about.steps, ([title, text], i) => `<div data-reveal="1" class="step">
            <div class="step-top"><span dir="ltr">${pad(i + 1)}</span><i></i></div>
            <h3>${esc(title)}</h3><p>${esc(text)}</p>
        </div>`)}</div>
    </div>
    <div class="marquee" aria-hidden="true" dir="ltr"><div>${marquee}</div></div>
</section>

<section id="branches" class="sec alt">
    <div class="wrap stack">
        <div data-reveal="1" class="head">${label("02 — BRANCHES")}<h2>${esc(c.branches.title)}</h2></div>
        <div data-reveal="1" class="br-tabs" role="tablist" aria-label="${esc(c.branches.title)}">${each(c.branches.items, (b, i) => `<button role="tab" class="br-tab${i ? "" : " on"}" aria-selected="${!i}" data-tab="br:${i}">
            <span class="code" dir="ltr">BR-0${i + 1}</span><span class="name">${esc(b.name)}</span><span class="alt">${esc(b.alt)}</span><i></i>
        </button>`)}</div>
        <div class="br-body">
            <div class="br-info">${each(c.branches.items, (b, i) => `<div data-panel="br:${i}"${i ? " hidden" : ""}>
                <h3>${esc(branchName(i))}</h3>
                <div class="row"><span>${esc(c.branches.address)}</span><span>${esc(b.address)}</span></div>
                ${b.phone ? `<div class="row"><span>${esc(c.branches.phone)}</span><a href="${tel(b.phone)}" dir="ltr">${b.phone}</a></div>
                <a class="btn btn-red btn-sm" href="${tel(b.phone)}">${esc(c.branches.call)}</a>` : ""}
            </div>`)}</div>
            <div class="net">
                <img class="bg" src="/site/blueprint.svg" alt="" loading="lazy">
                <svg class="net-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${each(NODES, ([x, y], i) => `<line x1="50" y1="50" x2="${x}" y2="${y}" data-tab="br:${i}" class="${i ? "" : "on"}"/>`)}</svg>
                <div class="net-hub"><i></i>${esc(c.branches.hub)}</div>
                ${each(NODES, ([x, y], i) => `<button class="net-node${i ? "" : " on"}" data-tab="br:${i}" style="left:${x}%;top:${y}%" aria-label="${esc(branchName(i))}"><b></b><span dir="ltr">BR-0${i + 1}</span><span>${esc(c.branches.items[i].name)}</span></button>`)}
                <div class="net-foot" dir="ltr">ONE NETWORK · ONE STANDARD</div>
            </div>
        </div>
    </div>
</section>

<section id="services" class="sec">
    <div class="wrap stack">
        <div data-reveal="1" class="head-row">
            <div class="head">${label("03 — SERVICES")}<h2>${esc(c.services.title)}</h2></div>
            <p class="hint">${esc(c.services.hint)}</p>
        </div>
        <div class="svc">
            <div data-reveal="1" class="svc-list" role="tablist" aria-label="${esc(c.services.title)}">${each(c.services.items, (s, i) => `<button role="tab" class="svc-tab${i ? "" : " on"}" aria-selected="${!i}" data-tab="svc:${i}"><span dir="ltr">${pad(i + 1)}</span><span>${esc(s.name)}</span><i></i></button>`)}</div>
            <div data-reveal="1" data-delay="120" class="svc-card">
                <img class="bg" src="/site/texture.webp" alt="" loading="lazy"><img class="bg bg-b" src="/site/blueprint.svg" alt="" loading="lazy">
                ${each(c.services.items, (s, i) => `<div class="svc-panel" data-panel="svc:${i}"${i ? " hidden" : ""}>
                    <div class="svc-big" dir="ltr">${pad(i + 1)}</div>
                    <div class="svc-code" dir="ltr">SERVICE / ${pad(i + 1)} / 08</div>
                    <div class="svc-text">
                        <h3>${esc(s.name)}</h3>
                        <p>${esc(s.desc)}</p>
                        <div class="svc-inc"><span>${esc(c.services.includes)}</span><div>${each(s.inc, (x) => `<span>${esc(x)}</span>`)}</div></div>
                        <a class="btn btn-ghost btn-sm" href="#branches">${esc(c.services.branchesCta)}</a>
                    </div>
                </div>`)}
            </div>
        </div>
    </div>
</section>

<section id="inspect" class="sec alt ins">
    <img class="bg bg-faint" src="/site/blueprint.svg" alt="" loading="lazy">
    <div class="wrap stack">
        <div data-reveal="1" class="head-row">
            <div class="head">${label("04 — INTERACTIVE INSPECTION")}<h2>${esc(c.inspect.title)}</h2><p class="hint hint-w">${esc(c.inspect.hint)}</p></div>
            <button class="btn btn-red scan-btn" data-run="${esc(c.inspect.run)}" data-running="${esc(c.inspect.running)}" data-again="${esc(c.inspect.again)}"><i></i><span class="scan-txt">${esc(c.inspect.run)}</span></button>
        </div>
        <div class="ins-body">
            <div data-reveal="1" class="ins-left">
                <div class="stage">
                    <img class="stage-car" src="/site/car-wide.webp" width="1672" height="941" alt="${esc(c.inspect.alt)}" loading="lazy" decoding="async">
                    <div class="stage-vig"></div>
                    <img class="bg stage-bp" src="/site/blueprint.svg" alt="" loading="lazy">
                    <div class="stage-scan"></div>
                    <div class="radar" style="left:${HOTSPOTS[0][0]}%;top:${HOTSPOTS[0][1]}%"><img src="/site/radar-rings.svg" alt="" loading="lazy"></div>
                    ${each(HOTSPOTS, ([x, y], i) => `<button class="spot${i ? "" : " on"}" data-tab="sys:${i}" style="left:${x}%;top:${y}%;--d:${i * 0.3}s" aria-label="${esc(c.inspect.systems[i].name)}"><b></b><i>+</i><span>${esc(c.inspect.systems[i].name)}</span></button>`)}
                    <div class="stage-read" dir="ltr">SCAN · <span class="sys-code">SYS-01</span><br><span class="readout">READY</span></div>
                </div>
                <div class="chips" role="tablist" aria-label="${esc(c.inspect.title)}">${each(c.inspect.systems, (s, i) => `<button role="tab" class="chip${i ? "" : " on"}" aria-selected="${!i}" data-tab="sys:${i}"><i></i>${esc(s.name)}</button>`)}</div>
            </div>
            <div data-reveal="1" data-delay="120" class="ins-side">${each(c.inspect.systems, (s, i) => `<div class="sys" data-panel="sys:${i}"${i ? " hidden" : ""}>
                <span class="sys-num" dir="ltr">SYS-0${i + 1} / 06</span>
                <h3>${esc(s.name)}</h3>
                <div class="sys-checks"><span>${esc(c.inspect.checks)}</span>${each(s.checks, (x) => `<div><i></i>${esc(x)}</div>`)}</div>
                <div class="sys-rel"><span>${esc(c.inspect.related)}</span>${each(s.rel, (r) => `<button data-svc="${r}"><span>${esc(c.services.items[r].name)}</span><span>${c.arrow}</span></button>`)}</div>
            </div>`)}</div>
        </div>
    </div>
</section>

<section id="tech" class="sec tech">
    <div class="wrap tech-in">
        <div data-reveal="1" class="tech-left">
            ${label("05 — TECHNOLOGY")}
            <h2 class="h-tech">${esc(c.tech.title)}</h2>
            <div class="tech-radar"><img src="/site/radar-rings.svg" alt="" loading="lazy">
                <div><span class="tech-num" dir="ltr">01</span><span dir="ltr">EQUIPMENT</span></div>
            </div>
        </div>
        <div data-reveal="1" data-delay="120" class="tech-list">${each(c.tech.items, ([name, text], i) => `<div class="acc${i ? "" : " open"}">
            <button data-toggle="1" data-num="${pad(i + 1)}" aria-expanded="${!i}"><span dir="ltr">${pad(i + 1)}</span><span>${esc(name)}</span><i>+</i></button>
            <div class="acc-body"><div><p>${esc(text)}</p></div></div>
        </div>`)}</div>
    </div>
</section>

<section id="products" class="sec alt">
    <div class="wrap stack">
        <div data-reveal="1" class="head">${label("06 — PRODUCTS")}<h2 class="h-wide">${esc(c.products.title)}</h2></div>
        <div class="prods">${each(c.products.items, (p, i) => `<article data-reveal="1" data-delay="${i * 80}" class="prod">
            <div class="prod-img"><img src="/site/products/${PRODUCT_IMAGES[i]}.webp" width="720" height="540" alt="${esc(p.alt)}" loading="lazy" decoding="async"></div>
            <div class="prod-text"><span dir="ltr">P-0${i + 1}</span><h3>${esc(p.name)}</h3><p>${esc(p.body)}</p></div>
        </article>`)}</div>
    </div>
</section>

<section id="passport" class="sec pass">
    <img class="bg bg-flip" src="/site/texture.webp" alt="" loading="lazy">
    <div class="wrap stack">
        <div data-reveal="1" class="head-row">
            <div class="head head-w">${label("07 — VEHICLE SERVICE PASSPORT")}<h2>${esc(c.passport.title)}</h2><p class="hint hint-w">${esc(c.passport.body)}</p></div>
            <span class="demo">${esc(c.passport.tag)}</span>
        </div>
        <div class="pass-body">
            <div data-reveal="1" class="book-wrap"><div class="book">
                <i></i><i></i>
                <div>${logo()}<div class="book-t" dir="ltr">VEHICLE<br>SERVICE<br>PASSPORT</div><div class="book-n" dir="ltr">Nº DEMO-0000</div></div>
            </div></div>
            <div data-reveal="1" data-delay="120" class="pass-card">
                <div class="pass-stats">${each(c.passport.stats, ([k, v]) => `<div><span>${esc(k)}</span><span>${esc(v)}</span></div>`)}</div>
                <div class="pass-list">${each(c.passport.timeline, (e, i) => `<div class="acc acc-tl${i ? "" : " open"}">
                    <button data-toggle="1" aria-expanded="${!i}"><b></b><span class="tl-main"><span class="tl-top"><span>${esc(c.services.items[e.svc].name)}</span><span dir="ltr">${e.date} · ${e.km} KM</span></span><span class="tl-br">${esc(branchName(e.branch))}</span></span></button>
                    <div class="acc-body"><div><p>${esc(e.note)}</p></div></div>
                </div>`)}</div>
            </div>
        </div>
    </div>
</section>

<section id="invest" class="invest">
    <img class="invest-img" src="/site/invest.webp" width="1600" height="900" alt="" loading="lazy" decoding="async">
    <div class="invest-shade"></div>
    <div class="wrap invest-in">
        <div data-reveal="1" class="invest-main">
            ${label("08 — INVESTMENT")}
            <h2>${esc(c.invest.title)}</h2>
            <p>${esc(c.invest.body)}</p>
            <a class="btn btn-red" href="${mailto}"><span>${esc(c.invest.cta)}</span><span>${c.arrow}</span></a>
            <a class="invest-mail" href="${mailto}" dir="ltr">${INVEST_EMAIL}</a>
        </div>
        <ul class="pillars">${each(c.invest.pillars, ([title, text], i) => `<li data-reveal="1" data-delay="${i * 80}"><span dir="ltr">${pad(i + 1)}</span><div><h3>${esc(title)}</h3><p>${esc(text)}</p></div></li>`)}</ul>
    </div>
</section>
</main>

<footer id="contact" class="foot">
    <img class="bg" src="/site/texture.webp" alt="" loading="lazy">
    <div class="wrap foot-in">
        <div data-reveal="1" class="foot-head">
            ${label("09 — CONTACT")}
            <h2>${esc(c.contact.title)}</h2>
            <div class="foot-cta">
                <a class="btn btn-red" href="#branches">${esc(c.contact.seeBranches)}</a>
                <a class="btn btn-ghost" href="${mailto}">${esc(c.invest.cta)}</a>
            </div>
        </div>
        <div data-reveal="1" class="contacts">
            <a href="${mailto}"><span>${esc(c.contact.investLabel)}</span><strong dir="ltr">${INVEST_EMAIL}</strong></a>
            <a href="mailto:${INFO_EMAIL}"><span>${esc(c.contact.infoLabel)}</span><strong dir="ltr">${INFO_EMAIL}</strong></a>
            <a href="${tel(RELATIONS_PHONE)}"><span>${esc(c.contact.phoneLabel)}</span><strong dir="ltr">${RELATIONS_PHONE}</strong></a>
            <a href="${WHATSAPP}" target="_blank" rel="noopener"><span>${esc(c.contact.whatsappLabel)}</span><strong dir="ltr">${RELATIONS_PHONE}</strong></a>
        </div>
        <div class="foot-cols">
            <div class="foot-brand">${logo()}<span dir="ltr">HANDSACARS.COM</span></div>
            <div><b>${esc(c.foot.branches)}</b>${each(c.branches.items, (b, i) => `<a href="#branches" data-tab="br:${i}" data-keep="1">${esc(b.name)}</a>`)}</div>
            <div><b>${esc(c.foot.sitemap)}</b>${each(navKeys, (k) => `<a href="#${k}">${esc(c.nav[k])}</a>`)}</div>
            <div><b>${esc(c.foot.follow)}</b>${each(SOCIALS, ([name, url]) => `<a href="${url}" target="_blank" rel="noopener" data-out="1" dir="ltr">${name}</a>`)}</div>
        </div>
        <div class="rights"><span>${esc(c.rights)}</span></div>
    </div>
</footer>`;
}

/**
 * The public site is a plain HTML document rather than a React page: its content is
 * in the first response, and it ships no framework JS.
 */
export function sitePage(lang: Lang) {
    const { title, description } = CONTENT[lang].meta;
    const path = lang === "ar" ? "/" : "/en";
    const fonts = lang === "ar" ? ["plex-ar-400", "tajawal-800"] : ["plex-lat-400", "exo2"];
    const items = CONTENT.ar.branches.items;
    const business = {
        "@context": "https://schema.org",
        "@type": "AutoRepair",
        name: "مركز هندسة السيارات",
        alternateName: "Engineering of Cars",
        url: `${ORIGIN}/`,
        logo: `${ORIGIN}/logo.png`,
        image: `${ORIGIN}/site/og.jpg`,
        telephone: RELATIONS_PHONE.replace(/\s/g, ""),
        address: { "@type": "PostalAddress", addressLocality: "العمارة", addressRegion: "ميسان", addressCountry: "IQ" },
        sameAs: SOCIALS.map(([, url]) => url),
        department: items.map((b) => ({
            "@type": "AutoRepair",
            name: `فرع ${b.name}`,
            address: b.address,
            ...(b.phone ? { telephone: b.phone.replace(/\s/g, "") } : {}),
        })),
    };
    const html = `<!doctype html>
<html lang="${lang}" dir="${lang === "ar" ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#08090B">
<link rel="canonical" href="${ORIGIN}${path}">
<link rel="alternate" hreflang="ar" href="${ORIGIN}/">
<link rel="alternate" hreflang="en" href="${ORIGIN}/en">
<link rel="alternate" hreflang="x-default" href="${ORIGIN}/">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/site/icon-180.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${lang === "ar" ? "هندسة السيارات" : "Engineering of Cars"}">
<meta property="og:locale" content="${lang === "ar" ? "ar_IQ" : "en_US"}">
<meta property="og:url" content="${ORIGIN}${path}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${ORIGIN}/site/og.jpg">
<meta name="twitter:card" content="summary_large_image">
${fonts.map((f) => `<link rel="preload" href="/site/fonts/${f}.woff2" as="font" type="font/woff2" crossorigin>`).join("\n")}
<script type="application/ld+json">${JSON.stringify(business).replace(/</g, "\\u003c")}</script>
<style>${STYLES}</style>
<script>${BOOT}</script>
</head>
<body>${body(lang)}<script>${SCRIPT}</script></body>
</html>`;
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
