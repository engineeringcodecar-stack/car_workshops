// Inlined into the page so first paint needs no second request.
const CSS = String.raw`
@font-face{font-family:'IBM Plex Sans Arabic';font-weight:400;font-display:swap;src:url(/site/fonts/plex-ar-400.woff2) format('woff2');unicode-range:U+600-6FF,U+200C-200F}
@font-face{font-family:'IBM Plex Sans Arabic';font-weight:500;font-display:swap;src:url(/site/fonts/plex-ar-500.woff2) format('woff2');unicode-range:U+600-6FF,U+200C-200F}
@font-face{font-family:'IBM Plex Sans Arabic';font-weight:600;font-display:swap;src:url(/site/fonts/plex-ar-600.woff2) format('woff2');unicode-range:U+600-6FF,U+200C-200F}
@font-face{font-family:'IBM Plex Sans Arabic';font-weight:400;font-display:swap;src:url(/site/fonts/plex-lat-400.woff2) format('woff2');unicode-range:U+0-FF,U+2013-2026,U+2190-2193,U+2713}
@font-face{font-family:'IBM Plex Sans Arabic';font-weight:500;font-display:swap;src:url(/site/fonts/plex-lat-500.woff2) format('woff2');unicode-range:U+0-FF,U+2013-2026,U+2190-2193,U+2713}
@font-face{font-family:'IBM Plex Sans Arabic';font-weight:600;font-display:swap;src:url(/site/fonts/plex-lat-600.woff2) format('woff2');unicode-range:U+0-FF,U+2013-2026,U+2190-2193,U+2713}
@font-face{font-family:Tajawal;font-weight:700;font-display:swap;src:url(/site/fonts/tajawal-700.woff2) format('woff2');unicode-range:U+600-6FF,U+200C-200F}
@font-face{font-family:Tajawal;font-weight:800;font-display:swap;src:url(/site/fonts/tajawal-800.woff2) format('woff2');unicode-range:U+600-6FF,U+200C-200F}
@font-face{font-family:'Exo 2';font-weight:500 800;font-display:swap;src:url(/site/fonts/exo2.woff2) format('woff2');unicode-range:U+0-FF,U+2013-2026}
@font-face{font-family:'IBM Plex Mono';font-weight:500;font-display:swap;src:url(/site/fonts/mono-500.woff2) format('woff2');unicode-range:U+0-FF,U+2013-2026,U+2190-2193,U+2713}

:root{--ease:cubic-bezier(.22,1,.36,1);--h:'Exo 2','Tajawal',sans-serif;--m:'IBM Plex Mono','IBM Plex Sans Arabic',monospace;--line:rgba(245,245,244,.1);--start:1s;--a:left;--b:right}
html[dir=rtl]{--a:right;--b:left}
html[data-seen]{--start:0s}
*{box-sizing:border-box}
html{background:#08090B}
body{margin:0;background:#08090B;color:#F5F5F4;-webkit-font-smoothing:antialiased;font-family:'IBM Plex Sans Arabic',sans-serif;overflow-x:clip}
a{color:#F5F5F4;text-decoration:none}
a:hover{color:#E5444E}
button{font:inherit;color:inherit}
img,svg{max-width:100%}
[hidden]{display:none!important}
::selection{background:#C72731;color:#fff}
:focus-visible{outline:2px solid #F5F5F4;outline-offset:3px}
h1,h2,h3,p{margin:0}
h2{font-family:var(--h);font-weight:800;font-size:clamp(32px,4.4vw,60px);line-height:1.2}
i{font-style:normal}

@keyframes hc-pulse{0%{transform:scale(1);opacity:.75}100%{transform:scale(2.8);opacity:0}}
@keyframes hc-scan{0%{transform:translateY(-100%)}100%{transform:translateY(100%)}}
@keyframes hc-spin{to{transform:translate(-50%,-50%) rotate(360deg)}}
@keyframes hc-load{0%{transform:scaleX(0)}100%{transform:scaleX(1)}}
@keyframes hc-cue{0%,100%{transform:translateY(0);opacity:.35}50%{transform:translateY(9px);opacity:1}}
@keyframes hc-rise{0%{opacity:0;transform:translateY(40px);filter:blur(10px)}100%{opacity:1;transform:none;filter:none}}
@keyframes hc-marquee{to{transform:translateX(-50%)}}
@keyframes fade-up{from{opacity:0;transform:translateY(36px)}to{opacity:1;transform:none}}
@keyframes fade{from{opacity:0}to{opacity:1}}
@keyframes line-up{from{opacity:0;transform:translateY(105%)}to{opacity:1;transform:none}}
@keyframes dash{to{stroke-dashoffset:-12}}

.logo{display:block;height:auto}
.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;opacity:.9}
.wrap{position:relative;max-width:1320px;margin:0 auto}
.pre{opacity:0;transform:translateY(32px);filter:blur(6px);transition:opacity 1.1s var(--ease),transform 1.1s var(--ease),filter 1.1s var(--ease)!important}
.pre.in{opacity:1;transform:none;filter:none}

/* Intro: the logo draws itself, then the page is already there */
.intro{position:fixed;inset:0;z-index:300;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;background:#08090B;pointer-events:none;animation:intro-out .42s ease .88s forwards}
html[data-seen] .intro{display:none}
.intro-mark{position:relative;width:min(66vw,340px);aspect-ratio:378/133}
.intro-word{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.intro-top{clip-path:polygon(112% 0,112% 0,100% 100%,100% 100%);animation:wipe .44s var(--ease) .04s forwards}
.intro-bottom{clip-path:polygon(112% 0,112% 0,100% 100%,100% 100%);animation:wipe .48s var(--ease) .16s forwards;filter:drop-shadow(0 0 20px rgba(229,68,78,.5))}
.intro-glint{clip-path:polygon(112% 0,124% 0,112% 100%,100% 100%);animation:glint .4s ease-in .46s forwards}
.intro-bar{width:min(66vw,340px);height:1px;background:rgba(245,245,244,.12);overflow:hidden}
.intro-bar i{display:block;height:100%;background:#C72731;box-shadow:0 0 10px #E5444E;transform:scaleX(0);transform-origin:var(--a);animation:hc-load .84s cubic-bezier(.65,0,.35,1) forwards}
.intro-name{font:500 11px/1 var(--m);letter-spacing:.32em;color:#A9ADB4}
@keyframes wipe{to{clip-path:polygon(-12% 0,112% 0,100% 100%,-24% 100%)}}
@keyframes glint{to{clip-path:polygon(-24% 0,-12% 0,-24% 100%,-36% 100%)}}
@keyframes intro-out{to{opacity:0;visibility:hidden}}

/* Curtain between sections */
.curtain{position:fixed;inset:0;z-index:250;pointer-events:none}
.curtain i{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;transform:scaleX(0);transform-origin:var(--a);transition:transform .45s cubic-bezier(.77,0,.18,1)}
.curtain i:first-child{background:#C72731}
.curtain i:last-child{background:#08090B;transition-delay:.05s}
.curtain[data-s="1"]{pointer-events:auto}
.curtain[data-s="1"] i{transform:scaleX(1)}
.curtain[data-s="2"] i{transform-origin:var(--b)}
.curtain .logo{width:190px;opacity:0;transition:opacity .25s}
.curtain[data-s="1"] .logo{opacity:1}

.progress{position:fixed;top:0;inset-inline:0;height:2px;z-index:120;pointer-events:none}
.progress i{display:block;height:100%;background:#C72731;transform:scaleX(0);transform-origin:var(--a);box-shadow:0 0 12px rgba(229,68,78,.8)}

/* Nav */
.nav{position:fixed;top:0;inset-inline:0;z-index:110;height:84px;display:flex;align-items:center;justify-content:space-between;gap:24px;padding:0 clamp(16px,4vw,48px);border-bottom:1px solid transparent;transition:background .5s,height .5s,border-color .5s,backdrop-filter .5s}
.nav.solid,.nav.menu-open{background:rgba(8,9,11,.82);backdrop-filter:blur(16px)}
.nav.solid{height:68px;border-bottom-color:rgba(245,245,244,.08)}
.nav-logo .logo{height:46px;width:auto;transition:height .5s}
.nav.solid .nav-logo .logo{height:38px}
.nav-links{display:flex;align-items:center;gap:clamp(14px,2vw,30px)}
.nav-links a{position:relative;padding:10px 2px;font-size:15px;font-weight:500;color:#A9ADB4;transition:color .25s}
.nav-links a:hover,.nav-links a.on{color:#F5F5F4}
.nav-links a::after{content:"";position:absolute;bottom:2px;inset-inline:0;height:1px;background:#E5444E;transform:scaleX(0);transition:transform .4s var(--ease)}
.nav-links a.on::after{transform:scaleX(1)}
.nav-actions{display:flex;align-items:center;gap:10px}
.nav-lang{display:grid;place-items:center;height:40px;min-width:48px;padding:0 12px;border-radius:999px;border:1px solid rgba(245,245,244,.22);background:rgba(8,9,11,.35);font:500 13px/1 var(--m);letter-spacing:.06em;transition:border-color .25s,background .25s}
.nav-lang:hover{border-color:#E5444E;background:rgba(199,39,49,.12);color:#F5F5F4}
.nav-cta{display:grid;place-items:center;height:40px;padding:0 18px;border-radius:8px;border:1px solid #C72731;background:#C72731;color:#fff;font-weight:600;font-size:14px;transition:background .25s,box-shadow .25s,transform .25s}
.nav-cta:hover{background:#E5444E;box-shadow:0 10px 30px rgba(199,39,49,.35);transform:translateY(-2px);color:#fff}
.nav-burger{display:none;width:44px;height:44px;border-radius:8px;border:1px solid rgba(245,245,244,.22);background:rgba(8,9,11,.35);cursor:pointer;flex-direction:column;align-items:center;justify-content:center;gap:6px}
.nav-burger span{width:18px;height:1.5px;background:#F5F5F4;transition:transform .3s}
.nav-burger.open span:first-child{transform:translateY(3.75px) rotate(45deg)}
.nav-burger.open span:last-child{transform:translateY(-3.75px) rotate(-45deg)}
.menu{position:fixed;inset:0;z-index:105;background:rgba(8,9,11,.97);backdrop-filter:blur(20px);display:flex;flex-direction:column;justify-content:safe center;overflow-y:auto;padding:100px clamp(24px,8vw,64px) 40px;gap:4px;opacity:0;visibility:hidden;transition:opacity .45s,visibility .45s}
.menu.open{opacity:1;visibility:visible}
/* Floating WhatsApp button: appears once the hero has scrolled away, and sits under the open menu */
.wa{position:fixed;z-index:100;bottom:max(20px,env(safe-area-inset-bottom));inset-inline-end:clamp(16px,2.4vw,28px);display:flex;align-items:center;gap:10px;height:54px;padding-inline:16px 20px;border-radius:99px;background:rgba(13,15,18,.9);backdrop-filter:blur(12px);border:1px solid rgba(37,211,102,.5);box-shadow:0 18px 44px rgba(0,0,0,.55);font-size:15px;font-weight:600;color:#F5F5F4;opacity:0;visibility:hidden;transform:translateY(14px);transition:opacity .4s,visibility .4s,transform .4s var(--ease),border-color .25s,box-shadow .3s}
.wa.show{opacity:1;visibility:visible;transform:none}
.wa svg{flex:none;width:26px;height:26px;fill:#25D366}
.wa:hover{border-color:#25D366;box-shadow:0 18px 44px rgba(0,0,0,.55),0 0 0 4px rgba(37,211,102,.14);color:#fff;transform:translateY(-3px)}
.menu a{display:flex;align-items:baseline;gap:16px;border-bottom:1px solid rgba(245,245,244,.08);padding:11px 0}
.menu a span:first-child{font:500 11px/1 var(--m);color:#E5444E;letter-spacing:.1em}
.menu a span:last-child{font-family:var(--h);font-weight:800;font-size:clamp(24px,6.4vw,36px)}

/* Hero */
.hero{position:relative;min-height:max(100svh,640px);overflow:hidden;isolation:isolate;background:#08090B}
.hero-par{position:absolute;inset:-4% -2%;z-index:-3;will-change:transform}
.hero-mouse{position:absolute;inset:0;transition:transform 1.2s var(--ease)}
/* The picture is held still: the video's own smoke and light are the only movement in it. */
.hero-mouse img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;max-width:none}
.hero-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 1.6s ease;pointer-events:none}
.hero-video.on{opacity:1}
.hero-shade{position:absolute;inset:0;z-index:-2;background:linear-gradient(90deg,rgba(8,9,11,.92) 0%,rgba(8,9,11,.6) 34%,rgba(8,9,11,0) 62%)}
.hero-fade{position:absolute;inset:0;z-index:-1;background:linear-gradient(0deg,#08090B 0%,rgba(8,9,11,0) 28%),linear-gradient(180deg,rgba(8,9,11,.7) 0%,rgba(8,9,11,0) 22%)}
.hero-lines{position:absolute;inset:0;z-index:-1;background-image:repeating-linear-gradient(to bottom,transparent 0 3px,rgba(220,220,220,.05) 4px 5px);pointer-events:none}
.hero-inner{min-height:inherit;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;padding:110px clamp(20px,6vw,96px)}
html[dir=rtl] .hero-inner{align-items:flex-end}
.hero-copy{max-width:min(50vw,640px);display:flex;flex-direction:column;gap:22px;text-shadow:0 2px 30px rgba(0,0,0,.6)}
.hero-eyebrow{display:flex;align-items:center;gap:12px;font:500 11px/1 var(--m);letter-spacing:.28em;color:#E5444E;animation:fade-up 1s var(--ease) calc(var(--start) + .1s) both}
.hero-eyebrow span:first-child{width:28px;height:1px;background:#C72731}
h1{font-family:var(--h);font-weight:800;font-size:clamp(38px,4.9vw,76px);line-height:1.14;letter-spacing:-.01em}
.line{display:block;overflow:hidden;padding-bottom:.1em}
.line>span{display:block;text-wrap:balance;animation:line-up 1.2s var(--ease) calc(var(--start) + .2s) both}
html[dir=ltr] h1{font-size:clamp(34px,4.2vw,66px)}
.line-red>span{color:#E5444E;text-shadow:0 0 48px rgba(199,39,49,.55);animation-delay:calc(var(--start) + .38s)}
.hero-tag{font:600 clamp(11px,1.1vw,14px)/1 'Exo 2',sans-serif;letter-spacing:.42em;animation:fade 1s ease calc(var(--start) + .6s) both}
html[dir=rtl] .hero-tag{text-align:end}
.hero-sub{max-width:480px;font-size:clamp(15px,1.3vw,18px);line-height:1.85;color:#D3D5D9;animation:fade-up 1s var(--ease) calc(var(--start) + .7s) both}
.hero-pillars{display:flex;align-items:stretch;animation:fade-up 1s var(--ease) calc(var(--start) + .82s) both}
.hero-pillars div{display:flex;flex-direction:column;gap:6px;padding-inline-end:22px;margin-inline-end:22px;border-inline-end:1px solid rgba(245,245,244,.16)}
.hero-pillars div:last-child{border:0}
.hero-pillars span:first-child{font:500 10px/1 var(--m);color:#E5444E;letter-spacing:.12em}
.hero-pillars span:last-child{font-weight:600;font-size:15px}
.hero-cta{display:flex;flex-wrap:wrap;gap:12px;margin-top:6px;animation:fade-up 1s var(--ease) calc(var(--start) + .95s) both}
.hero-foot{position:absolute;bottom:28px;inset-inline:clamp(20px,6vw,96px);display:flex;align-items:center;justify-content:space-between;gap:16px;font:500 10px/1 var(--m);letter-spacing:.24em;color:#A9ADB4;animation:fade 1s ease calc(var(--start) + 1.2s) both}
.hero-foot a{display:flex;align-items:center;gap:12px;color:#A9ADB4;padding:8px 0}
.cue{width:20px;height:32px;border:1px solid rgba(245,245,244,.35);border-radius:12px;display:flex;justify-content:center;padding-top:6px}
.cue i{width:3px;height:7px;border-radius:2px;background:#E5444E;animation:hc-cue 1.8s ease-in-out infinite}

/* Accredited dealerships: on the first screen, under the hero copy */
.agencies{position:absolute;bottom:0;inset-inline:0;display:flex;align-items:center;gap:clamp(18px,3vw,44px);padding:18px clamp(20px,6vw,96px);background:rgba(8,9,11,.62);backdrop-filter:blur(10px);border-top:1px solid var(--line);animation:fade .8s ease calc(var(--start) + .3s) both}
.agencies-label{flex:none}
.agencies-track-wrap{flex:1;min-width:0;overflow:hidden;mask-image:linear-gradient(90deg,transparent,#000 7%,#000 93%,transparent);-webkit-mask-image:linear-gradient(90deg,transparent,#000 7%,#000 93%,transparent)}
.agencies-track{display:flex;align-items:center;gap:14px;padding-right:14px;width:max-content;animation:hc-marquee 40s linear infinite}
.ag{flex:none;display:grid;place-items:center;height:52px;padding:0 20px;border-radius:12px;background:#F3F3F1;box-shadow:inset 0 0 0 1px rgba(255,255,255,.6)}
.ag-dark{background:#14161A;box-shadow:inset 0 0 0 1px rgba(255,255,255,.14)}
.ag img{display:block;height:var(--h);width:auto}
.agencies-track-wrap:hover .agencies-track{animation-play-state:paused}
.has-ag .hero-foot{bottom:88px}
.has-ag .hero-inner{padding-bottom:150px}
html[dir=rtl] .agencies .label{letter-spacing:0;font:500 13px/1 'IBM Plex Sans Arabic',sans-serif}

/* Numbers under the hero */
.proof{position:relative;background:#08090B;border-bottom:1px solid var(--line);padding:clamp(28px,3.4vw,44px) clamp(20px,5vw,64px)}
.proof-in{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:clamp(18px,3vw,40px)}
.proof-in>div{display:flex;flex-direction:column;gap:8px}
.proof strong{font:800 clamp(30px,3.6vw,52px)/1.1 var(--h);color:#F5F5F4}
.proof span{font-size:14px;line-height:1.6;color:#A9ADB4}

.label{display:flex;align-items:center;gap:12px;font:500 12px/1 var(--m);letter-spacing:.2em;color:#E5444E}
.label span:first-child{width:28px;height:1px;background:#C72731}

.btn{display:inline-flex;align-items:center;justify-content:center;gap:12px;height:54px;padding:0 26px;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;transition:background .25s,border-color .25s,box-shadow .3s,transform .3s}
.btn-sm{height:50px;padding:0 22px;font-size:15px;align-self:flex-start}
.btn-red{border:1px solid #C72731;background:#C72731;color:#fff}
.btn-red:hover{background:#E5444E;box-shadow:0 14px 40px rgba(199,39,49,.4);transform:translateY(-3px);color:#fff}
.btn-glass{border:1px solid rgba(245,245,244,.3);background:rgba(8,9,11,.4);backdrop-filter:blur(8px);font-weight:500}
.btn-glass:hover{border-color:#F5F5F4;background:rgba(245,245,244,.08);color:#F5F5F4}
.btn-ghost{border:1px solid rgba(245,245,244,.25);background:transparent;font-weight:500}
.btn-ghost:hover{border-color:#F5F5F4;color:#F5F5F4}

/* Section frame */
.sec{position:relative;overflow:hidden;padding:clamp(100px,11vw,150px) clamp(20px,5vw,64px);background:#08090B}
.sec.alt{background:#0B0C0F;border-top:1px solid rgba(245,245,244,.06)}
.stack{display:flex;flex-direction:column;gap:44px}
.head{display:flex;flex-direction:column;gap:20px}
.head-w{max-width:720px}
.h-wide{max-width:900px;text-wrap:balance}
.head-row{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:24px}
.hint{max-width:380px;color:#A9ADB4;line-height:1.8}
.hint-w{max-width:560px}

/* About */
.about{padding:clamp(100px,12vw,170px) clamp(20px,5vw,64px) clamp(80px,9vw,120px)}
.about-in{display:flex;flex-direction:column;gap:clamp(48px,7vw,96px)}
.about-head{display:flex;flex-direction:column;gap:22px;max-width:980px}
.h-about{font-size:clamp(32px,4.8vw,68px);line-height:1.22;text-wrap:balance}
.lead{max-width:640px;font-size:clamp(16px,1.35vw,19px);line-height:1.9;color:#A9ADB4;text-wrap:pretty}
.steps{display:flex;flex-wrap:wrap;border-top:1px solid var(--line)}
.step{flex:1 1 260px;min-width:0;padding:32px 0 8px;padding-inline-end:32px;display:flex;flex-direction:column;gap:14px}
.step-top{display:flex;align-items:center;gap:14px}
.step-top span{font:800 44px/1 'Exo 2',sans-serif;color:transparent;-webkit-text-stroke:1px #E5444E}
.step-top i{flex:1;height:1px;background:linear-gradient(90deg,rgba(199,39,49,.6),rgba(199,39,49,0))}
html[dir=rtl] .step-top i{background:linear-gradient(270deg,rgba(199,39,49,.6),rgba(199,39,49,0))}
.step h3{font-family:var(--h);font-weight:700;font-size:26px}
.step p{color:#A9ADB4;line-height:1.8;font-size:16px;max-width:360px}
.marquee{position:relative;margin-top:clamp(60px,8vw,110px);overflow:hidden;white-space:nowrap}
.marquee>div{display:inline-flex;gap:48px;animation:hc-marquee 38s linear infinite;font:800 clamp(56px,9vw,140px)/1 var(--h);color:transparent;-webkit-text-stroke:1px rgba(245,245,244,.14)}
.marquee>div>span{display:inline-flex;gap:48px}
.marquee .red{-webkit-text-stroke:1px rgba(229,68,78,.45)}

/* Branches */
.br-tabs{display:flex;flex-wrap:wrap;border-block:1px solid var(--line)}
.br-tab{flex:1 1 220px;position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:10px;padding:26px 22px;background:transparent;border:0;border-inline-end:1px solid rgba(245,245,244,.08);cursor:pointer;text-align:start;transition:background .35s}
.br-tab:hover{background:rgba(23,25,29,.9)}
.br-tab.on{background:#17191D}
.br-tab .code{font:500 11px/1 var(--m);letter-spacing:.16em;color:#7D828A}
.br-tab.on .code{color:#E5444E}
.br-tab .name{font-family:var(--h);font-weight:800;font-size:clamp(22px,2.2vw,30px)}
.br-tab .alt{font-size:13px;color:#A9ADB4}
.br-tab i{position:absolute;top:-1px;inset-inline:0;height:2px;background:#C72731;transform-origin:var(--a);transform:scaleX(0);transition:transform .5s var(--ease)}
.br-tab.on i{transform:scaleX(1)}
.br-body{display:flex;flex-wrap:wrap;gap:clamp(20px,3vw,40px)}
.br-info{flex:1 1 360px;min-width:0}
.br-info>div{display:flex;flex-direction:column;gap:8px}
.br-info h3{margin-bottom:10px;font-family:var(--h);font-weight:800;font-size:clamp(30px,3.4vw,46px);animation:hc-rise .6s var(--ease)}
.row{display:flex;justify-content:space-between;align-items:baseline;gap:20px;padding:16px 0;border-bottom:1px solid rgba(245,245,244,.08);font-size:15px}
.row span:first-child{color:#A9ADB4;font-size:14px;flex:none}
.row>:last-child{text-align:end}
.br-info .btn{margin-top:20px}
.net{flex:1.3 1 420px;min-width:0;position:relative;min-height:380px;border-radius:16px;overflow:hidden;border:1px solid var(--line);background:#101216}
.net-lines{position:absolute;inset:0;width:100%;height:100%}
.net-lines line{stroke:rgba(245,245,244,.18);stroke-width:1;vector-effect:non-scaling-stroke;pointer-events:none;transition:stroke .3s}
.net-lines line.on{stroke:#E5444E;stroke-dasharray:6 6;animation:dash .8s linear infinite}
.net-hub{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;align-items:center;gap:10px;padding:11px 16px;border-radius:8px;border:1px solid rgba(229,68,78,.55);background:rgba(8,9,11,.92);font-size:13px;font-weight:600;white-space:nowrap;box-shadow:0 0 34px rgba(199,39,49,.3)}
.net-hub i{width:8px;height:8px;border-radius:50%;background:#E5444E;box-shadow:0 0 10px #E5444E}
.net-node{position:absolute;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:7px;padding:6px;background:none;border:0;cursor:pointer;white-space:nowrap}
.net-node b{position:relative;width:14px;height:14px;border-radius:50%;background:#2A2D33;border:2px solid #7D828A;transition:background .3s,border-color .3s,box-shadow .3s}
.net-node.on b{background:#C72731;border-color:#fff;box-shadow:0 0 18px rgba(229,68,78,.8)}
.net-node.on b::after{content:"";position:absolute;left:-15px;top:-15px;width:40px;height:40px;border-radius:50%;border:1px solid #E5444E;animation:hc-pulse 2.2s ease-out infinite}
.net-node span:nth-child(2){font:500 10px/1 var(--m);letter-spacing:.14em;color:#A9ADB4}
.net-node span:nth-child(3){font-size:13px;font-weight:600}
.net-foot{position:absolute;inset-inline:20px;bottom:16px;text-align:center;font:500 10px/1.5 var(--m);letter-spacing:.16em;color:#7D828A}

/* Services */
.svc{display:flex;flex-wrap:wrap;gap:clamp(24px,3vw,48px);align-items:stretch}
.svc-list{flex:1 1 360px;min-width:0;display:flex;flex-direction:column}
.svc-tab{position:relative;display:flex;align-items:center;gap:20px;padding:20px 4px;background:none;border:0;border-bottom:1px solid rgba(245,245,244,.08);cursor:pointer;text-align:start;color:#8E939B;transition:color .3s,padding .4s var(--ease)}
.svc-tab.on{color:#F5F5F4;padding-inline-start:18px}
.svc-tab span:first-child{font:500 12px/1 var(--m);color:#5E636B;letter-spacing:.08em;min-width:24px}
.svc-tab.on span:first-child{color:#E5444E}
.svc-tab span:nth-child(2){flex:1;font-family:var(--h);font-weight:700;font-size:clamp(18px,1.6vw,22px)}
.svc-tab i{position:absolute;bottom:-1px;inset-inline-start:0;height:1px;width:100%;background:#C72731;transform-origin:var(--a);transform:scaleX(0);transition:transform .6s var(--ease)}
.svc-tab.on i{transform:scaleX(1)}
.svc-card{flex:1.25 1 440px;min-width:0;position:relative;overflow:hidden;border-radius:16px;border:1px solid var(--line);background:#17191D;min-height:520px;display:flex;flex-direction:column;justify-content:flex-end;padding:clamp(24px,3.4vw,44px)}
.bg-b{opacity:.7}
.svc-panel{display:contents}
.svc-big{position:absolute;top:clamp(16px,2.6vw,36px);inset-inline-end:clamp(20px,3vw,40px);font:800 clamp(120px,16vw,220px)/1 'Exo 2',sans-serif;color:transparent;-webkit-text-stroke:1px rgba(229,68,78,.55);animation:hc-rise .8s var(--ease)}
.svc-code{position:absolute;top:clamp(20px,3vw,40px);inset-inline-start:clamp(24px,3.4vw,44px);font:500 11px/1 var(--m);letter-spacing:.2em;color:#A9ADB4}
.svc-text{position:relative;display:flex;flex-direction:column;gap:18px}
.svc-text h3{font-family:var(--h);font-weight:800;font-size:clamp(28px,3vw,42px);line-height:1.2;animation:hc-rise .7s var(--ease)}
.svc-text p{color:#D3D5D9;line-height:1.85;font-size:16px;max-width:520px}
.svc-inc{display:flex;flex-direction:column;gap:10px;padding-top:6px}
.svc-inc>span{font:500 11px/1 var(--m);letter-spacing:.14em;color:#A9ADB4}
.svc-inc>div{display:flex;flex-wrap:wrap;gap:8px}
.svc-inc>div span{padding:8px 12px;border-radius:999px;border:1px solid rgba(245,245,244,.16);background:rgba(8,9,11,.5);font-size:14px}

/* Inspection */
.bg-faint{opacity:.35}
.ins-body{display:flex;flex-wrap:wrap;gap:clamp(20px,3vw,40px);align-items:flex-start}
.ins-left{flex:1.7 1 560px;min-width:0;display:flex;flex-direction:column;gap:16px}
.scan-btn{height:52px;padding:0 22px}
.scan-btn i{width:8px;height:8px;border-radius:50%;background:#fff;box-shadow:0 0 10px #fff}
.scan-btn.busy{background:rgba(199,39,49,.25);cursor:default}
.stage{position:relative;aspect-ratio:1672/941;border-radius:16px;overflow:hidden;border:1px solid rgba(245,245,244,.12);background:#101216;isolation:isolate}
.stage-car{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:saturate(.75) brightness(.8)}
.stage-vig{position:absolute;inset:0;background:radial-gradient(ellipse at 66% 58%,transparent 30%,rgba(8,9,11,.65) 85%)}
.stage-bp{opacity:.55;mix-blend-mode:screen}
.stage-scan{position:absolute;inset:0;z-index:1;pointer-events:none;background:linear-gradient(to bottom,transparent 44%,rgba(229,68,78,.22) 49%,rgba(255,78,89,.85) 50%,rgba(199,39,49,.22) 51%,transparent 56%);animation:hc-scan 5s linear infinite}
.scanning .stage-scan{animation-duration:1.1s}
.radar{position:absolute;width:0;height:0;z-index:2;pointer-events:none;transition:left .7s var(--ease),top .7s var(--ease)}
.radar img{position:absolute;left:50%;top:50%;width:clamp(120px,22vw,260px);height:clamp(120px,22vw,260px);max-width:none;transform:translate(-50%,-50%);opacity:.9;animation:hc-spin 12s linear infinite}
.scanning .radar img{animation-duration:3s}
.spot{position:absolute;z-index:4;width:30px;height:30px;padding:0;transform:translate(-50%,-50%);border-radius:50%;border:1px solid #fff;background:#C72731;color:#fff;cursor:pointer;display:grid;place-items:center;font:600 14px/1 var(--m);box-shadow:0 0 22px rgba(199,39,49,.6);transition:background .3s,color .3s,transform .3s}
.spot:hover{transform:translate(-50%,-50%) scale(1.15)}
.spot.on{background:#F5F5F4;color:#08090B}
.spot b{position:absolute;inset:-1px;border-radius:50%;border:1px solid #E5444E;animation:hc-pulse 2.4s ease-out var(--d) infinite}
.spot.on b{display:none}
.spot.done:not(.on) i{font-size:0}
.spot.done:not(.on) i::after{content:"✓";font-size:14px}
.spot span{position:absolute;bottom:calc(100% + 10px);left:50%;transform:translateX(-50%);white-space:nowrap;padding:6px 10px;border-radius:6px;background:rgba(8,9,11,.82);border:1px solid rgba(245,245,244,.16);color:#F5F5F4;font:600 13px/1.3 'IBM Plex Sans Arabic',sans-serif;pointer-events:none;opacity:0;transition:opacity .25s}
.spot.on span,.spot:hover span{opacity:1;border-color:#E5444E}
.stage-read{position:absolute;top:14px;inset-inline-start:16px;z-index:3;font:500 10px/1.6 var(--m);letter-spacing:.16em}
.readout{color:#E5444E}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{height:40px;padding:0 14px;border-radius:999px;border:1px solid rgba(245,245,244,.16);background:transparent;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:8px;transition:background .25s,border-color .25s}
.chip i{width:6px;height:6px;border-radius:50%;background:#5E636B}
.chip.on{border-color:#E5444E;background:rgba(199,39,49,.18)}
.chip.on i{background:#E5444E}
.ins-side{flex:1 1 320px;min-width:0;border-radius:16px;border:1px solid var(--line);background:rgba(23,25,29,.85);backdrop-filter:blur(10px);padding:28px}
.sys{display:flex;flex-direction:column;gap:22px}
.sys-num{font:500 11px/1 var(--m);letter-spacing:.18em;color:#E5444E}
.sys h3{font-family:var(--h);font-weight:800;font-size:clamp(28px,2.8vw,38px);animation:hc-rise .6s var(--ease)}
.sys-checks,.sys-rel{display:flex;flex-direction:column}
.sys-checks>span,.sys-rel>span{font-size:13px;color:#A9ADB4;padding-bottom:8px}
.sys-checks div{display:flex;align-items:center;gap:12px;padding:13px 0;border-top:1px solid rgba(245,245,244,.08);font-size:15px}
.sys-checks i{width:7px;height:7px;border-radius:50%;background:#E5444E;flex:none}
.sys-rel{gap:10px}
.sys-rel>span{padding-bottom:0}
.sys-rel button{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;padding:0 14px;border-radius:8px;border:1px solid rgba(245,245,244,.14);background:transparent;cursor:pointer;text-align:start;font-weight:500;transition:background .25s,border-color .25s}
.sys-rel button:hover{border-color:#C72731;background:rgba(199,39,49,.16)}
.sys-rel button span:last-child{color:#E5444E}

/* Technology */
.tech-in{display:flex;flex-wrap:wrap;gap:clamp(32px,5vw,80px)}
.tech-left{flex:1 1 360px;min-width:0;display:flex;flex-direction:column;gap:22px}
.h-tech{font-size:clamp(30px,3.8vw,52px);line-height:1.25;text-wrap:balance}
.tech-radar{position:relative;aspect-ratio:1;max-width:380px;width:100%;margin-top:12px}
.tech-radar img{position:absolute;left:50%;top:50%;width:100%;height:100%;transform:translate(-50%,-50%);opacity:.8;animation:hc-spin 30s linear infinite}
.tech-radar div{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center}
.tech-num{font:800 64px/1 'Exo 2',sans-serif}
.tech-radar div span:last-child{font:500 10px/1 var(--m);letter-spacing:.2em;color:#A9ADB4}
.tech-list{flex:1.4 1 460px;min-width:0;display:flex;flex-direction:column;border-top:1px solid var(--line)}
.acc{border-bottom:1px solid var(--line)}
.acc>button{width:100%;display:flex;align-items:center;gap:20px;padding:26px 0;background:none;border:0;cursor:pointer;text-align:start;color:#A9ADB4;transition:color .3s}
.acc>button:hover,.acc.open>button{color:#F5F5F4}
.tech-list .acc>button>span:first-child{font:500 12px/1 var(--m);color:#E5444E;min-width:26px}
.tech-list .acc>button>span:nth-child(2){flex:1;font-family:var(--h);font-weight:700;font-size:clamp(20px,2vw,28px)}
.acc>button>i{font:400 22px/1 var(--m);color:#E5444E;transition:transform .4s}
.acc.open>button>i{transform:rotate(45deg)}
.acc-body{display:grid;grid-template-rows:0fr;transition:grid-template-rows .55s var(--ease)}
.acc.open .acc-body{grid-template-rows:1fr}
.acc-body>div{overflow:hidden;min-height:0}
.acc-body p{padding:0 0 28px;padding-inline-start:46px;color:#A9ADB4;line-height:1.85;max-width:560px}

/* Products */
.prods{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:clamp(12px,1.6vw,22px)}
.prod{position:relative;overflow:hidden;border-radius:16px;border:1px solid var(--line);background:#101216;transition:border-color .35s,transform .5s var(--ease),box-shadow .5s}
.prod:hover{border-color:rgba(229,68,78,.65);transform:translateY(-4px);box-shadow:0 24px 60px rgba(199,39,49,.16)}
.prod-img{overflow:hidden;aspect-ratio:4/3;background:#08090B}
.prod-img img{display:block;width:100%;height:100%;object-fit:cover;transition:transform .9s var(--ease)}
.prod:hover .prod-img img{transform:scale(1.05)}
.prod-text{display:flex;flex-direction:column;gap:8px;padding:clamp(14px,1.6vw,22px) clamp(14px,1.7vw,24px) clamp(18px,1.9vw,26px)}
.prod-text span{font:500 11px/1 var(--m);letter-spacing:.14em;color:#E5444E}
.prod-text h3{font-family:var(--h);font-weight:800;font-size:clamp(19px,1.9vw,26px)}
.prod-text p{font-size:15px;line-height:1.7;color:#A9ADB4}

/* Passport */
.bg-flip{opacity:.7;transform:scaleX(-1)}
.demo{font:500 11px/1.4 var(--m);letter-spacing:.08em;color:#E5444E;border:1px dashed rgba(229,68,78,.6);padding:9px 12px;border-radius:6px}
.pass-body{display:flex;flex-wrap:wrap;gap:clamp(28px,4vw,56px);align-items:flex-start}
.pass-visual{position:relative;flex:0 1 440px;min-width:300px;height:580px;margin:0 auto}
.book-wrap{position:absolute;top:0;inset-inline-start:0;width:250px;perspective:1200px}
.phone{position:absolute;top:44px;inset-inline-end:0;z-index:2;width:262px;padding:8px;border-radius:42px;background:#050506;border:1px solid rgba(245,245,244,.16);box-shadow:0 50px 90px rgba(0,0,0,.7),0 0 0 1px rgba(0,0,0,.6),inset 0 0 0 2px rgba(245,245,244,.04)}
.phone-screen{position:relative;overflow:hidden;border-radius:34px;padding:10px 12px 14px;display:flex;flex-direction:column;gap:9px;background:radial-gradient(120% 60% at 80% 0%,rgba(211,47,58,.16),transparent 60%),#07070A;font-size:10px;line-height:1.4}
.ph-bar{display:flex;justify-content:space-between;align-items:center;padding:2px 10px 4px;font:600 10px/1 var(--m);color:#D3D5D9}
.ph-bar i{width:62px;height:18px;margin-inline:auto;border-radius:12px;background:#000;position:absolute;left:50%;top:9px;transform:translateX(-50%)}
.ph-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-bottom:9px;border-bottom:1px solid rgba(245,245,244,.08)}
.ph-id{display:flex;align-items:center;gap:7px;min-width:0}
.ph-id .logo{flex:none;width:34px;height:34px;padding:5px;border-radius:9px;background:rgba(245,245,244,.05);border:1px solid rgba(245,245,244,.1)}
.ph-id b{display:block;font-size:11px;font-weight:700}
.ph-ok{display:inline-block;margin-top:3px;padding:1px 7px;border-radius:99px;font-size:8.5px;font-weight:700;color:#34D399;background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.25)}
.ph-sn{flex:none;padding:5px 7px;border-radius:8px;background:rgba(245,245,244,.05);border:1px solid rgba(245,245,244,.1);font:700 9px/1 var(--m);color:#F0646D}
.ph-card{border-radius:16px;padding:11px 12px;background:rgba(23,25,29,.8);border:1px solid rgba(245,245,244,.08);display:flex;flex-direction:column;gap:4px}
.ph-tabs{display:flex;gap:5px;overflow:hidden;white-space:nowrap}
.ph-tabs span{flex:none;padding:6px 9px;border-radius:9px;font-size:8.5px;font-weight:700;color:#A9ADB4;background:rgba(23,25,29,.8);border:1px solid rgba(245,245,244,.08)}
.ph-tabs .on{color:#fff;background:#C72731;border-color:#C72731}
.ph-row{display:flex;justify-content:space-between;align-items:center;gap:6px}
.ph-row b{font-size:11px}
.ph-row span{font:500 8.5px/1 var(--m);color:#A9ADB4}
.ph-pill{display:grid;justify-self:start;align-self:flex-start;margin:6px 0 10px;padding:6px 10px;border-radius:9px;background:rgba(229,68,78,.1);border:1px solid rgba(229,68,78,.3);color:#F0646D;font-weight:700;font-size:10px}
.ph-pill span{grid-area:1/1;opacity:0;transition:opacity .4s}
.ph-pill span.on{opacity:1}
.ph-steps{display:flex}
.ph-steps>div{position:relative;flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;text-align:center}
.ph-steps>div+div::before{content:"";position:absolute;top:10px;inset-inline-end:50%;width:100%;height:2px;background:rgba(245,245,244,.1);transition:background .5s}
.ph-steps i{position:relative;z-index:1;display:grid;place-items:center;width:22px;height:22px;border-radius:50%;font:700 9px/1 var(--m);font-style:normal;background:#1A1C21;border:1px solid rgba(245,245,244,.12);color:#A9ADB4;transition:background .5s,border-color .5s,color .5s}
.ph-steps span{font-size:7.5px;line-height:1.3;color:#A9ADB4}
.ph-steps .on i{background:#C72731;border-color:#C72731;color:transparent}
.ph-steps .on i::after{content:"✓";position:absolute;color:#fff;font-size:10px}
.ph-steps .on span{color:#F5F5F4;font-weight:700}
.ph-steps .on::before{background:#C72731}
.ph-steps .cur i{animation:ph-pulse 1.6s ease-out infinite}
@keyframes ph-pulse{0%{box-shadow:0 0 0 0 rgba(229,68,78,.55)}100%{box-shadow:0 0 0 9px rgba(229,68,78,0)}}
.ph-k{font-size:8.5px;color:#A9ADB4}
.ph-car{font:700 14px/1.3 var(--h)}
.ph-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px}
.ph-grid div{display:flex;flex-direction:column;gap:3px;padding:8px;border-radius:11px;background:rgba(8,9,11,.6);border:1px solid rgba(245,245,244,.06)}
.ph-grid span{font-size:8px;color:#A9ADB4}
.ph-grid b{font:800 13px/1.2 var(--h)}
.ph-grid small{font-size:8px;font-weight:500;color:#A9ADB4}
.ph-last b{font-size:11px}
.ph-last span[dir]{font:500 8.5px/1.4 var(--m);color:#A9ADB4}
.sticker{position:absolute;z-index:3;bottom:18px;inset-inline-start:34px;width:118px;padding:12px 12px 9px;border-radius:12px;background:#F5F5F2;box-shadow:0 24px 50px rgba(0,0,0,.6);transform:rotate(-7deg);display:flex;flex-direction:column;align-items:center;gap:7px}
html[dir=rtl] .sticker{transform:rotate(7deg)}
.sticker img{display:block;width:100%;height:auto}
.sticker span{font:700 11px/1 var(--m);letter-spacing:.08em;color:#0B0C0F}
.pass-how{margin-top:clamp(48px,6vw,80px)}
.book{position:relative;aspect-ratio:3/4.1;border-radius:6px 14px 14px 6px;overflow:hidden;background:linear-gradient(150deg,#1C1013 0%,#0E0A0B 55%,#08090B 100%);border:1px solid rgba(245,245,244,.12);box-shadow:0 40px 80px rgba(0,0,0,.6),inset 10px 0 18px rgba(0,0,0,.6);transform:rotateY(-14deg) rotateX(4deg);transition:transform .9s var(--ease)}
.book:hover{transform:none}
.book>i{position:absolute;right:-30%;width:90%;transform:rotate(-38deg)}
.book>i:nth-child(1){bottom:-6%;height:30%;background:#C72731;opacity:.9}
.book>i:nth-child(2){bottom:6%;height:3%;background:#E5444E;opacity:.7}
.book>div{position:absolute;inset:0;padding:28px;display:flex;flex-direction:column;gap:18px}
.book .logo{width:150px}
.book-t{margin-top:auto;font:700 22px/1.25 'Exo 2',sans-serif;letter-spacing:.06em}
.book-n{font:500 10px/1 var(--m);letter-spacing:.2em;color:#A9ADB4;margin-bottom:28%}
html[dir=rtl] .book-t,html[dir=rtl] .book-n{text-align:right}
.pass-card{flex:1 1 520px;min-width:0;border-radius:16px;border:1px solid var(--line);background:rgba(23,25,29,.88);backdrop-filter:blur(12px);overflow:hidden}
.pass-stats{display:flex;flex-wrap:wrap;border-bottom:1px solid rgba(245,245,244,.08)}
.pass-stats div{flex:1 1 140px;padding:20px 22px;border-inline-end:1px solid rgba(245,245,244,.08);display:flex;flex-direction:column;gap:8px}
.pass-stats span:first-child{font-size:12px;color:#A9ADB4}
.pass-stats span:last-child{font:700 20px/1.2 var(--h)}
.pass-list{padding:10px 24px 18px}
.acc-tl{border-bottom-color:rgba(245,245,244,.08)}
.acc-tl:last-child{border:0}
.acc-tl>button{align-items:flex-start;gap:18px;padding:16px 0;color:#F5F5F4}
.acc-tl>button>b{flex:none;width:10px;height:10px;margin-top:6px;border-radius:50%;border:2px solid #C72731;transition:background .3s}
.acc-tl.open>button>b{background:#C72731}
.tl-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.tl-top{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px}
.tl-top span:first-child{font-weight:600;font-size:16px}
.tl-top span:last-child{font:500 12px/1.6 var(--m);color:#A9ADB4}
.tl-br{font-size:13px;color:#A9ADB4}
.acc-tl .acc-body p{margin:0 0 16px;margin-inline-start:28px;padding:12px 14px;max-width:none;border-radius:8px;background:rgba(8,9,11,.6);border:1px solid rgba(245,245,244,.08);font-size:14px;line-height:1.7;color:#D3D5D9}

/* Investment */
.invest{position:relative;overflow:hidden;isolation:isolate;padding:clamp(110px,13vw,190px) clamp(20px,5vw,64px);background:#08090B}
.invest-img{position:absolute;inset:0;z-index:-2;width:100%;height:100%;max-width:none;object-fit:cover}
.invest-shade{position:absolute;inset:0;z-index:-1;background:linear-gradient(180deg,#08090B 0%,rgba(8,9,11,.34) 22%,rgba(8,9,11,.34) 78%,#08090B 100%),radial-gradient(ellipse at 50% 50%,rgba(8,9,11,.25),rgba(8,9,11,.72))}
.invest-in{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:clamp(40px,6vw,96px);align-items:center}
.invest-main{display:flex;flex-direction:column;align-items:flex-start;gap:24px;text-shadow:0 2px 30px rgba(0,0,0,.7)}
.invest h2{font-size:clamp(36px,5.2vw,76px);line-height:1.14;text-wrap:balance}
.invest-main p{max-width:560px;font-size:clamp(16px,1.3vw,19px);line-height:1.9;color:#D3D5D9}
html[dir=rtl] .invest-mail{align-self:flex-start}
.invest-mail{font:500 15px/1 var(--m);letter-spacing:.04em;color:#F5F5F4;border-bottom:1px solid rgba(229,68,78,.7);padding-bottom:6px}
.pillars{list-style:none;margin:0;padding:0;border-radius:16px;border:1px solid rgba(245,245,244,.14);background:rgba(8,9,11,.66);backdrop-filter:blur(14px);overflow:hidden}
.pillars li{display:flex;gap:18px;padding:clamp(18px,2vw,26px);border-bottom:1px solid rgba(245,245,244,.1)}
.pillars li:last-child{border:0}
.pillars li>span{font:500 12px/1.9 var(--m);color:#E5444E;letter-spacing:.1em}
.pillars h3{margin-bottom:6px;font-family:var(--h);font-weight:700;font-size:clamp(19px,1.7vw,24px)}
.pillars p{font-size:15px;line-height:1.75;color:#A9ADB4}

/* Contact and footer */
.foot{position:relative;overflow:hidden;padding:clamp(100px,11vw,150px) clamp(20px,5vw,64px) 32px;background:#08090B}
.foot .bg{opacity:.8}
.foot-in{display:flex;flex-direction:column;gap:clamp(48px,6vw,80px)}
.foot-head{display:flex;flex-direction:column;gap:24px;max-width:900px}
.foot-head h2{font-size:clamp(36px,5.6vw,80px);line-height:1.15;text-wrap:balance}
.foot-cta{display:flex;flex-wrap:wrap;gap:12px}
.contacts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--line)}
.contacts a{display:flex;flex-direction:column;gap:10px;padding:clamp(22px,2.2vw,30px);background:#0B0C0F;transition:background .25s}
.contacts a:hover{background:#2A1215;color:#F5F5F4}
.contacts span{font-size:14px;color:#A9ADB4}
.contacts strong{font-weight:600;font-size:clamp(15px,1.15vw,17px);overflow-wrap:anywhere}
html[dir=rtl] .contacts strong{text-align:end}
.foot-cols{display:flex;flex-wrap:wrap;gap:40px;justify-content:space-between;border-top:1px solid var(--line);padding-top:40px}
.foot-cols>div{flex:1 1 180px;display:flex;flex-direction:column;gap:10px}
.foot-brand{flex-basis:240px!important;gap:16px!important}
.foot-brand .logo{width:170px}
.foot-brand span{font:500 12px/1 var(--m);letter-spacing:.14em;color:#A9ADB4}
html[dir=rtl] .foot-brand span{text-align:end;align-self:flex-start}
.foot-cols b{font:500 11px/1 var(--m);letter-spacing:.16em;color:#E5444E}
html[dir=rtl] .foot-cols b{letter-spacing:0;font:600 14px/1 'IBM Plex Sans Arabic',sans-serif}
html[dir=rtl] .foot-cols a[data-out]{text-align:right}
.foot-cols a{padding:4px 0;color:#D3D5D9;font-size:15px}
.foot-cols a:hover{color:#E5444E}
.rights{font-size:12px;color:#7D828A;border-top:1px solid rgba(245,245,244,.06);padding-top:24px}

@media(max-width:1079px){
.nav-links{display:none}
.nav-burger{display:flex}
.spot span{display:none}
.invest-in{grid-template-columns:minmax(0,1fr)}
.contacts{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:899px){
.prods{grid-template-columns:repeat(2,minmax(0,1fr))}
.proof-in{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:639px){
.nav-cta{display:none}
.br-tab{flex:1 1 calc(50% - 1px);padding:18px 16px}
.br-tab .name{font-size:20px}
.nav-logo .logo{height:38px}
.nav.solid .nav-logo .logo{height:32px}
.contacts{grid-template-columns:minmax(0,1fr)}
.hero-par{inset:0 0 auto 0;height:66%;-webkit-mask-image:linear-gradient(#000 70%,transparent);mask-image:linear-gradient(#000 70%,transparent)}
.hero-eyebrow,.hero-tag,.hero-pillars{display:none}
.hero-cta{flex-wrap:nowrap}
.hero-cta .btn{flex:1 1 0;min-width:0;justify-content:center;padding-inline:12px;white-space:nowrap}
.hero-mouse img,.hero-video{object-position:60% center}
.hero-shade{background:linear-gradient(0deg,rgba(8,9,11,.96) 0%,rgba(8,9,11,.6) 45%,rgba(8,9,11,.1) 70%)}
.hero-inner{justify-content:flex-end;align-items:stretch!important;padding-bottom:96px}
.hero-copy{max-width:none}
html h1,html[dir=ltr] h1{font-size:clamp(34px,10.4vw,46px)}
.has-ag .hero-inner{padding-bottom:142px}
.has-ag .hero-foot{bottom:62px}
.agencies{padding-block:12px}
.ag{height:42px;padding:0 14px;border-radius:10px}
.ag img{height:calc(var(--h) * .78)}
.agencies .label span:first-child{display:none}
.net{min-height:340px}
.wa{width:54px;padding:0;justify-content:center}
.wa span{display:none}
.pass-visual{flex-basis:100%;min-width:0;max-width:360px;height:540px}
.book-wrap{width:190px}
.book>div{padding:20px;gap:12px}
.book .logo{width:110px}
.book-t{font-size:17px}
.phone{width:236px;top:36px}
.sticker{width:100px;bottom:10px;inset-inline-start:8px}
.net-hub{font-size:12px;padding:9px 12px}
.prod-text p{font-size:14px}
.spot{width:24px;height:24px;font-size:12px}
}
@media(max-width:359px){
.hero-cta .btn{font-size:14px;gap:6px;padding-inline:8px}
}
@media(prefers-reduced-motion:reduce){
/* Reduced, not removed: fades and small loops stay, anything travelling across the screen goes. The intro is under a second, and the logo reveal is the point of it. */
.marquee>div,.agencies-track{animation:none}
.agencies-track-wrap{overflow-x:auto;scrollbar-width:none}
.line>span,.hero-eyebrow,.hero-sub,.hero-pillars,.hero-cta{animation-name:fade}
.pre{transform:none;filter:none}
.book{transform:none;transition:none}
.ph-steps .cur i{animation:none}
}
`;

export const STYLES = CSS
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/ ?([{};]) ?/g, "$1")
    .trim();
