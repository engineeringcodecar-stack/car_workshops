// Runs before first paint: the intro plays once per browser session.
export const BOOT = `try{sessionStorage.seen?document.documentElement.dataset.seen=1:sessionStorage.seen=1}catch(e){}`;

// Everything interactive on the page. The content is in the HTML already, so the
// page reads fine if this never runs.
export const SCRIPT = String.raw`(function(){
var d=document,w=window,rm=matchMedia("(prefers-reduced-motion: reduce)").matches;
var $=function(s){return d.querySelector(s)},$$=function(s){return Array.prototype.slice.call(d.querySelectorAll(s))};

/* Scroll: progress bar, hero parallax, solid nav, active link */
var prog=$(".progress i"),par=$(".hero-par"),txt=$(".hero-copy"),nav=$(".nav"),raf=0;
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
}
function tick(){if(!raf)raf=requestAnimationFrame(frame)}
w.addEventListener("scroll",tick,{passive:true});w.addEventListener("resize",tick);frame();

/* Hero follows the pointer */
var mouse=$(".hero-mouse");
if(!rm)$(".hero").addEventListener("mousemove",function(e){
  var r=e.currentTarget.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;
  mouse.style.transform="translate3d("+x*-18+"px,"+y*-12+"px,0)";
});

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
