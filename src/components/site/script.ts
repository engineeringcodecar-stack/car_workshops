// Runs before first paint: the intro plays once per browser session.
export const BOOT = `try{sessionStorage.seen?document.documentElement.dataset.seen=1:sessionStorage.seen=1}catch(e){}`;

// Everything interactive on the page. The content is in the HTML already, so the
// page reads fine if this never runs.
export const SCRIPT = String.raw`(function(){
var d=document,w=window,rm=matchMedia("(prefers-reduced-motion: reduce)").matches;
var $=function(s){return d.querySelector(s)},$$=function(s){return Array.prototype.slice.call(d.querySelectorAll(s))};

/* Scroll: progress bar, hero parallax, solid nav, active link */
var prog=$(".progress i"),par=$(".hero-par"),txt=$(".hero-copy"),nav=$(".nav"),waBtn=$(".wa"),raf=0;
var ids=$$("[data-nav]").map(function(a){return a.dataset.nav}).filter(function(v,i,a){return a.indexOf(v)==i});
function frame(){
  raf=0;
  var y=w.scrollY,h=w.innerHeight,H=d.documentElement.scrollHeight-h;
  prog.style.transform="scaleX("+(H>0?Math.min(1,y/H):0)+")";
  if(!rm&&y<h*1.3){
    par.style.transform="translate3d(0,"+y*.3+"px,0)";
    txt.style.transform="translate3d(0,"+y*-.12+"px,0)";
    txt.style.opacity=Math.max(0,1-y/(h*.75));
  }
  var act="";
  ids.forEach(function(id){var el=d.getElementById(id);if(el&&el.getBoundingClientRect().top<h*.45)act=id});
  $$("[data-nav]").forEach(function(a){a.classList.toggle("on",a.dataset.nav==act)});
  nav.classList.toggle("solid",y>40);
  waBtn.classList.toggle("show",y>h*.6);
}
function tick(){if(!raf)raf=requestAnimationFrame(frame)}
w.addEventListener("scroll",tick,{passive:true});w.addEventListener("resize",tick);frame();

/* Hero video: starts as soon as the hero image itself has loaded, so it never competes
   with it, and never with data saver or a 2G connection. It also plays with reduced motion
   (the owner's choice): the camera is fixed and the picture does not move. Phones get the
   tall clip, matching the <picture> breakpoint. The still image stays underneath, so
   nothing changes if it never plays. */
var hv=$(".hero-video"),net=navigator.connection||{};
if(hv&&!net.saveData&&!/2g/.test(net.effectiveType||"")){
  var hvTall=matchMedia("(max-width: 700px)");
  var hvPlay=function(){var p=hv.play();if(p&&p.catch)p.catch(function(){})};
  var hvStart=function(){
    hv.classList.remove("on");
    hv.addEventListener("playing",function(){hv.classList.add("on")},{once:true});
    hv.src=hvTall.matches?hv.dataset.srcTall:hv.dataset.src;hvPlay();
  };
  var hvImg=$(".hero-mouse img");
  if(hvImg.complete)hvStart();else{hvImg.addEventListener("load",hvStart,{once:true});hvImg.addEventListener("error",hvStart,{once:true})}
  if(hvTall.addEventListener)hvTall.addEventListener("change",function(){if(hv.src)hvStart()});
  if("IntersectionObserver"in w)new IntersectionObserver(function(es){if(hv.src)es[0].isIntersecting?hvPlay():hv.pause()}).observe($(".hero"));
}

/* Reveal on scroll */
if("IntersectionObserver"in w){
  var io=new IntersectionObserver(function(es){es.forEach(function(e){
    if(e.isIntersecting){
      var el=e.target;el.classList.add("in");io.unobserve(el);
      setTimeout(function(){el.classList.remove("pre","in");el.style.transitionDelay=""},1500);
    }
  })},{threshold:.1,rootMargin:"0px 0px -40px 0px"});
  $$("[data-reveal]").forEach(function(el){
    if(el.getBoundingClientRect().top<w.innerHeight)return;
    el.classList.add("pre");el.style.transitionDelay=(el.dataset.delay||0)+"ms";io.observe(el);
  });
}

/* Service pictures: once the services card is on screen, fetch the other services' pictures
   too, so switching service does not wait on a download. Only with a mouse, where hovering
   the list flips through them; on a phone each one loads when its service is tapped, which
   spares mobile data. */
var svcCard=$(".svc-card");
if(svcCard&&"IntersectionObserver"in w&&matchMedia("(hover: hover)").matches&&!net.saveData){
  var svcIo=new IntersectionObserver(function(es){
    if(!es[0].isIntersecting)return;
    svcIo.disconnect();
    setTimeout(function(){$$(".svc-img,.svc-brands img").forEach(function(i){i.loading="eager"})},800);
  });
  svcIo.observe(svcCard);
}

/* Curtain between sections and between languages */
var cur=$(".curtain"),menu=$(".menu"),burger=$(".nav-burger"),ct;
function curtain(mid){
  if(rm)return mid();
  clearTimeout(ct);cur.dataset.s=1;
  ct=setTimeout(function(){mid();cur.dataset.s=2;ct=setTimeout(function(){cur.dataset.s=0},560)},500);
}
function setMenu(open){menu.classList.toggle("open",open);burger.classList.toggle("open",open);burger.setAttribute("aria-expanded",open);nav.classList.toggle("menu-open",open)}
burger.addEventListener("click",function(){setMenu(!menu.classList.contains("open"))});
function jump(id){var el=d.getElementById(id);history.pushState(null,"","#"+id);w.scrollTo({top:el?el.getBoundingClientRect().top+w.scrollY:0,behavior:"instant"})}

/* Tabs: every [data-tab="group:i"] selects [data-panel="group:i"] */
function pick(group,i){
  $$('[data-tab^="'+group+':"]').forEach(function(t){
    var on=t.dataset.tab==group+":"+i;t.classList.toggle("on",on);
    if(t.hasAttribute("aria-selected"))t.setAttribute("aria-selected",on);
  });
  $$('[data-panel^="'+group+':"]').forEach(function(p){p.hidden=p.dataset.panel!=group+":"+i});
  if(group=="sys")place(i);
}

/* Inspection: moves the radar and walks through all six systems */
var radar=$(".radar"),scanBtn=$(".scan-btn"),scanTxt=$(".scan-txt"),readout=$(".readout"),stage=$(".stage"),si;
function place(i){var s=$('.spot[data-tab="sys:'+i+'"]');radar.style.left=s.style.left;radar.style.top=s.style.top;$(".sys-code").textContent="SYS-0"+(+i+1)}
function stopScan(){clearInterval(si);si=0;stage.classList.remove("scanning");scanBtn.classList.remove("busy");scanBtn.disabled=false}
scanBtn.addEventListener("click",function(){
  var n=0;
  $$(".spot").forEach(function(s){s.classList.remove("done")});
  stage.classList.add("scanning");scanBtn.classList.add("busy");scanBtn.disabled=true;pick("sys",0);
  var show=function(){scanTxt.textContent=scanBtn.dataset.running+" "+(n+1)+"/6";readout.textContent="SCANNING "+(n+1)+"/6"};show();
  si=setInterval(function(){
    $('.spot[data-tab="sys:'+n+'"]').classList.add("done");n++;
    if(n>=6){stopScan();scanTxt.textContent=scanBtn.dataset.again;readout.textContent="COMPLETE 6/6";return}
    pick("sys",n);show();
  },1100);
});

/* Passport phone: walks the live status through its four steps while it is on screen */
var phSt=$(".ph-status");
if(phSt&&"IntersectionObserver"in w){
  var phSteps=$$(".ph-steps>div"),phPill=$$(".ph-pill span"),phN=2,phT=0;
  var phSet=function(n){
    phSteps.forEach(function(s,i){s.classList.toggle("on",i<n);s.classList.toggle("cur",i==n-1&&n<4)});
    phPill.forEach(function(s,i){s.classList.toggle("on",i==n-1)});
  };
  var phNext=function(){phN=phN%4+1;phSet(phN);phT=setTimeout(phNext,phN==4?3200:1800)};
  new IntersectionObserver(function(es){clearTimeout(phT);if(es[0].isIntersecting)phT=setTimeout(phNext,1800)}).observe(phSt);
}

/* One click handler for all of it */
d.addEventListener("click",function(e){
  var t=e.target.closest("[data-tab],[data-toggle],[data-svc],a[href^='#'],a[data-lang]");
  if(!t)return;
  if(t.dataset.tab){
    var g=t.dataset.tab.split(":");if(g[0]=="sys"&&si){stopScan();scanTxt.textContent=scanBtn.dataset.run;readout.textContent="READY"}
    pick(g[0],g[1]);
    if(t.dataset.keep){e.preventDefault();curtain(function(){jump("branches")})}
    return;
  }
  if(t.dataset.toggle){
    var box=t.parentNode,was=box.classList.contains("open");
    Array.prototype.forEach.call(box.parentNode.children,function(a){a.classList.remove("open");a.firstElementChild.setAttribute("aria-expanded",false)});
    if(!was){box.classList.add("open");t.setAttribute("aria-expanded",true)}
    if(t.dataset.num){var n=$(".tech-num");n.textContent=was?"04":t.dataset.num}
    return;
  }
  if(t.dataset.svc){e.preventDefault();pick("svc",t.dataset.svc);return curtain(function(){jump("services")})}
  e.preventDefault();
  setMenu(false);
  if(t.dataset.lang)return curtain(function(){location.href=t.getAttribute("href")});
  var id=t.getAttribute("href").slice(1);curtain(function(){jump(id)});
});
d.addEventListener("mouseover",function(e){
  var t=e.target.closest('[data-tab^="svc:"]');
  if(t&&!t.classList.contains("on")){var g=t.dataset.tab.split(":");pick(g[0],g[1])}
});
})()`;
