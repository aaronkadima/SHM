// Idioma da plataforma (PT · EN · ES · FR). Padrão: PT; a escolha fica salva no navegador.
// O código-fonte é escrito em português; as traduções ficam no dicionário (i18nDict.js), indexado
// pelo texto em português. Dois caminhos:
//  · tr("texto") — usado onde o texto não está no DOM: imagens das Etapas, legendas, camadas e
//    exportações (SVG, CSV, HTML, IFC), para que as figuras saiam no idioma escolhido;
//  · startDomTranslator() — traduz os nós de texto e os atributos title/aria-label/placeholder da
//    interface por correspondência exata, sem reescrever os componentes. Só altera nodeValue/atributos
//    (não cria nem remove nós), o que é seguro com o React.
import{DICT}from"./i18nDict.js";

export const LANGS=[
  {id:"pt",code:"PT",name:"Português",html:"pt-BR"},
  {id:"en",code:"EN",name:"English",html:"en"},
  {id:"es",code:"ES",name:"Español",html:"es"},
  {id:"fr",code:"FR",name:"Français",html:"fr"}
];
const COL={en:0,es:1,fr:2};
const KEY="shmLang";
const listeners=new Set();
function initial(){
  try{const s=localStorage.getItem(KEY);if(LANGS.some(l=>l.id===s))return s}catch{}
  // padrão: português; o idioma só muda por escolha explícita no seletor (não pelo idioma do navegador)
  return "pt";
}
let current=initial();
export function getLang(){return current}
export function langInfo(id=current){return LANGS.find(l=>l.id===id)||LANGS[0]}
export function setLang(id){
  if(!LANGS.some(l=>l.id===id)||id===current)return;
  current=id;try{localStorage.setItem(KEY,id)}catch{}
  if(typeof document!=="undefined")document.documentElement.lang=langInfo().html;
  for(const f of listeners)try{f(id)}catch{}
}
export function onLangChange(f){listeners.add(f);return()=>listeners.delete(f)}

// padrões para textos com números (ex.: "Zoom 100%", "3 achados")
const PATTERNS=[];
export function addPattern(re,fn){PATTERNS.push([re,fn])}

const W={limiar:["threshold","umbral","seuil"],polo:["pole","polo","pôle"]};
addPattern(/^(\d+) · (.+)$/,(m,lang,t)=>{const r=t(m[2],lang);return r!==m[2]?m[1]+" · "+r:null});
addPattern(/^limiar ([\d.,]+)$/,(m,lang)=>W.limiar[COL[lang]]+" "+(lang==="en"?m[1].replace(",","."):m[1]));
addPattern(/^polo z ≥ ([\d.,]+)$/,(m,lang)=>W.polo[COL[lang]]+" z ≥ "+m[1]);

export function tr(text,lang=current){
  if(lang==="pt"||text==null)return text;
  const s=String(text),col=COL[lang];
  const hit=DICT[s];if(hit&&hit[col])return hit[col];
  const t=s.trim();if(t!==s){const h=DICT[t];if(h&&h[col])return s.replace(t,h[col])}
  for(const[re,fn]of PATTERNS){const m=t.match(re);if(m){const out=fn(m,lang,tr);if(out!=null)return s.replace(t,out)}}
  return text;
}

// ---------- tradução da interface por DOM ----------
const ORIG=new WeakMap(); // nó/atributo → texto original em português
const ATTRS=["title","aria-label","placeholder","alt"];
function translateTextNode(n){
  const parent=n.parentElement;if(!parent)return;
  const tag=parent.tagName;if(tag==="SCRIPT"||tag==="STYLE"||tag==="TEXTAREA"||parent.closest("[data-no-i18n],code,pre,.mono"))return;
  let rec=ORIG.get(n);const v=n.nodeValue;
  // o React (ou o usuário) mudou o texto: novo original
  if(!rec||(v!==rec.shown)){rec={pt:v,shown:v};ORIG.set(n,rec)}
  if(!/[A-Za-zÀ-ú]/.test(rec.pt))return;
  const next=current==="pt"?rec.pt:tr(rec.pt);
  if(next!==v){rec.shown=next;n.nodeValue=next}else rec.shown=v;
}
function translateAttrs(el){
  if(el.closest?.("[data-no-i18n]"))return;
  let recs=ORIG.get(el);if(!recs){recs={};ORIG.set(el,recs)}
  for(const a of ATTRS){
    if(!el.hasAttribute(a))continue;const v=el.getAttribute(a),r=recs[a];
    if(!r||v!==r.shown)recs[a]={pt:v,shown:v};
    const next=current==="pt"?recs[a].pt:tr(recs[a].pt);
    if(next!==v){recs[a].shown=next;el.setAttribute(a,next)}
  }
}
function walk(root){
  if(root.nodeType===3){translateTextNode(root);return}
  if(root.nodeType!==1)return;
  translateAttrs(root);
  const it=document.createTreeWalker(root,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);
  let n=it.nextNode();while(n){if(n.nodeType===3)translateTextNode(n);else translateAttrs(n);n=it.nextNode()}
}
let observer=null,pending=new Set(),scheduled=false;
function flush(){scheduled=false;const list=[...pending];pending.clear();for(const n of list)if(n.isConnected)walk(n)}
export function startDomTranslator(root=document.body){
  if(typeof document==="undefined"||observer)return;
  document.documentElement.lang=langInfo().html;
  walk(root);
  observer=new MutationObserver(muts=>{
    for(const m of muts){
      if(m.type==="characterData")pending.add(m.target);
      else if(m.type==="attributes")pending.add(m.target);
      else for(const n of m.addedNodes)pending.add(n);
    }
    if(!scheduled){scheduled=true;queueMicrotask(flush)}
  });
  observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:ATTRS});
  onLangChange(()=>walk(root));
}
