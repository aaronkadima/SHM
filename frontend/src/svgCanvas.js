// Superfície SVG com a mesma API do Canvas 2D usada nas figuras (caminhos, retângulos, arcos, texto,
// gradiente linear, recorte, transformações, drawImage). As funções de figura desenham igual em canvas
// (PNG) ou aqui (SVG): texto sai como <text> editável, traços como <path>, rasters como <image>.
let MODE=null,UID=0;
export function withSvg(fn){const prev=MODE;MODE="svg";try{return fn()}finally{MODE=prev}}
export const svgMode=()=>MODE==="svg";
function realCanvas(w,h){if(typeof document==="undefined"&&typeof OffscreenCanvas!=="undefined")return new OffscreenCanvas(w,h);const c=document.createElement("canvas");c.width=w;c.height=h;return c}
// superfície principal de uma figura: SVG dentro de withSvg, canvas real fora
export function surface(w,h){return MODE==="svg"?new SvgCanvas(w,h):realCanvas(w,h)}
export const isSvgCanvas=c=>c instanceof SvgCanvas;

let MEASURE=null;
function measureCtx(){
  if(!MEASURE){try{MEASURE=realCanvas(8,8).getContext("2d")}catch{MEASURE=null}
    if(!MEASURE){let font="10px sans-serif";MEASURE={set font(f){font=f},get font(){return font},measureText:t=>({width:String(t).length*parseFont(font).size*.55})}}}
  return MEASURE;
}
const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const n=v=>Math.round(v*100)/100;
// cor CSS → [cor sem alfa, opacidade]
function color(c){
  if(c==null)return["none",1];c=String(c).trim();
  let m=c.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i);
  if(m){let a=m[4]==null?1:m[4].endsWith("%")?parseFloat(m[4])/100:parseFloat(m[4]);return[`rgb(${Math.round(+m[1])},${Math.round(+m[2])},${Math.round(+m[3])})`,a]}
  m=c.match(/^#([0-9a-f]{8})$/i);if(m)return["#"+m[1].slice(0,6),parseInt(m[1].slice(6),16)/255];
  m=c.match(/^#([0-9a-f]{4})$/i);if(m)return["#"+m[1].slice(0,3),parseInt(m[1][3]+m[1][3],16)/255];
  return[c,1];
}
function parseFont(f){
  const m=String(f||"").match(/^\s*(?:(italic|normal)\s+)?(?:(\d{3}|bold|normal)\s+)?([\d.]+)px\s+(.+)$/i);
  return m?{style:m[1]||"normal",weight:m[2]||"400",size:parseFloat(m[3]),family:m[4]}:{style:"normal",weight:"400",size:10,family:"sans-serif"};
}
const mul=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
const ap=(m,x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
const isId=m=>m[0]===1&&m[1]===0&&m[2]===0&&m[3]===1&&m[4]===0&&m[5]===0;
const mat=m=>isId(m)?"":` transform="matrix(${m.map(n).join(" ")})"`;

class Gradient{constructor(x0,y0,x1,y1,m){this.p=[ap(m,x0,y0),ap(m,x1,y1)];this.stops=[]}addColorStop(o,c){this.stops.push([o,c])}}

class SvgContext{
  constructor(cv){this.canvas=cv;this.out=[];this.defs=[];this.stack=[];this.path=[];this.s={fillStyle:"#000",strokeStyle:"#000",lineWidth:1,font:"10px sans-serif",textAlign:"start",textBaseline:"alphabetic",globalAlpha:1,dash:[],lineCap:"butt",lineJoin:"miter",imageSmoothingEnabled:true,imageSmoothingQuality:"low",m:[1,0,0,1,0,0],clips:0}}
  // estado
  save(){this.stack.push({...this.s,dash:[...this.s.dash],m:[...this.s.m]});this.s.clips=0}
  restore(){const s=this.stack.pop();if(!s)return;for(let i=0;i<this.s.clips;i++)this.out.push("</g>");this.s=s}
  setLineDash(d){this.s.dash=[...(d||[])]}getLineDash(){return[...this.s.dash]}
  translate(x,y){this.s.m=mul(this.s.m,[1,0,0,1,x,y])}
  scale(x,y){this.s.m=mul(this.s.m,[x,0,0,y,0,0])}
  rotate(a){const c=Math.cos(a),s=Math.sin(a);this.s.m=mul(this.s.m,[c,s,-s,c,0,0])}
  transform(a,b,c,d,e,f){this.s.m=mul(this.s.m,[a,b,c,d,e,f])}
  setTransform(a,b,c,d,e,f){this.s.m=typeof a==="object"?[a.a,a.b,a.c,a.d,a.e,a.f]:[a,b,c,d,e,f]}
  resetTransform(){this.s.m=[1,0,0,1,0,0]}
  createLinearGradient(x0,y0,x1,y1){return new Gradient(x0,y0,x1,y1,this.s.m)}
  createRadialGradient(){return new Gradient(0,0,0,1,this.s.m)}
  measureText(t){const c=measureCtx();c.font=this.s.font;return c.measureText(t)}
  // caminhos (pontos já transformados para o espaço do documento)
  beginPath(){this.path=[]}
  moveTo(x,y){const[a,b]=ap(this.s.m,x,y);this.path.push(`M${n(a)} ${n(b)}`)}
  lineTo(x,y){const[a,b]=ap(this.s.m,x,y);this.path.push(`L${n(a)} ${n(b)}`)}
  closePath(){this.path.push("Z")}
  rect(x,y,w,h){this.moveTo(x,y);this.lineTo(x+w,y);this.lineTo(x+w,y+h);this.lineTo(x,y+h);this.closePath()}
  arc(cx,cy,r,a0,a1,ccw=false){
    let d=a1-a0;if(!ccw&&d<0)d+=2*Math.PI*Math.ceil(-d/(2*Math.PI));if(ccw&&d>0)d-=2*Math.PI*Math.ceil(d/(2*Math.PI));
    if(Math.abs(a1-a0)>=2*Math.PI)d=ccw?-2*Math.PI:2*Math.PI;
    const k=Math.max(8,Math.ceil(Math.abs(d)/(Math.PI/48)));
    for(let i=0;i<=k;i++){const a=a0+d*i/k,x=cx+r*Math.cos(a),y=cy+r*Math.sin(a);(i===0&&!this.path.length?this.moveTo:this.lineTo).call(this,x,y)}
  }
  quadraticCurveTo(cx,cy,x,y){const[a,b]=ap(this.s.m,cx,cy),[c,d]=ap(this.s.m,x,y);this.path.push(`Q${n(a)} ${n(b)} ${n(c)} ${n(d)}`)}
  bezierCurveTo(c1x,c1y,c2x,c2y,x,y){const p=[ap(this.s.m,c1x,c1y),ap(this.s.m,c2x,c2y),ap(this.s.m,x,y)];this.path.push("C"+p.map(q=>n(q[0])+" "+n(q[1])).join(" "))}
  paint(kind){
    const st=kind==="fill"?this.s.fillStyle:this.s.strokeStyle;
    if(st instanceof Gradient){const id="g"+(++UID);
      this.defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(st.p[0][0])}" y1="${n(st.p[0][1])}" x2="${n(st.p[1][0])}" y2="${n(st.p[1][1])}">${st.stops.map(([o,c])=>{const[cc,a]=color(c);return`<stop offset="${o}" stop-color="${cc}" stop-opacity="${n(a)}"/>`}).join("")}</linearGradient>`);
      return[`url(#${id})`,this.s.globalAlpha]}
    const[c,a]=color(st);return[c,a*this.s.globalAlpha];
  }
  strokeAttrs(){const sc=Math.sqrt(Math.abs(this.s.m[0]*this.s.m[3]-this.s.m[1]*this.s.m[2]))||1,[c,a]=this.paint("stroke");
    return` fill="none" stroke="${c}"${a<1?` stroke-opacity="${n(a)}"`:""} stroke-width="${n(this.s.lineWidth*sc)}"${this.s.dash.length?` stroke-dasharray="${this.s.dash.map(v=>n(v*sc)).join(" ")}"`:""}${this.s.lineCap!=="butt"?` stroke-linecap="${this.s.lineCap}"`:""}${this.s.lineJoin!=="miter"?` stroke-linejoin="${this.s.lineJoin}"`:""}`}
  fill(rule){if(!this.path.length)return;const[c,a]=this.paint("fill");this.out.push(`<path d="${this.path.join("")}" fill="${c}"${a<1?` fill-opacity="${n(a)}"`:""}${rule==="evenodd"?' fill-rule="evenodd"':""}/>`)}
  stroke(){if(!this.path.length)return;this.out.push(`<path d="${this.path.join("")}"${this.strokeAttrs()}/>`)}
  clip(){const id="c"+(++UID);this.defs.push(`<clipPath id="${id}"><path d="${this.path.join("")||"M0 0"}"/></clipPath>`);this.out.push(`<g clip-path="url(#${id})">`);this.s.clips++}
  fillRect(x,y,w,h){const keep=this.path;this.path=[];this.rect(x,y,w,h);this.fill();this.path=keep}
  strokeRect(x,y,w,h){const keep=this.path;this.path=[];this.rect(x,y,w,h);this.stroke();this.path=keep}
  clearRect(){}
  // texto editável: linha de base alfabética explícita (compatível com Inkscape/Illustrator)
  text(t,x,y,maxW,mode){
    if(t==null||t==="")return;const f=parseFont(this.s.font),al=this.s.textAlign,bl=this.s.textBaseline;
    const dy=bl==="middle"?f.size*.35:bl==="top"||bl==="hanging"?f.size*.8:bl==="bottom"||bl==="ideographic"?-f.size*.22:0;
    const anchor=al==="center"?"middle":al==="right"||al==="end"?"end":"start",w=this.measureText(String(t)).width;
    // com largura máxima, o comprimento fica fixo no medido (ou no máximo): o layout se mantém com qualquer fonte substituta
    const fit=maxW!=null&&isFinite(maxW)&&maxW>0&&w>0&&w>maxW*.6?` textLength="${n(Math.min(w,maxW))}" lengthAdjust="spacingAndGlyphs"`:"";
    const paint=mode==="stroke"?(()=>{const sc=Math.sqrt(Math.abs(this.s.m[0]*this.s.m[3]-this.s.m[1]*this.s.m[2]))||1,[c,a]=this.paint("stroke");return` fill="none" stroke="${c}"${a<1?` stroke-opacity="${n(a)}"`:""} stroke-width="${n(this.s.lineWidth)}" stroke-linejoin="round"`})():(()=>{const[c,a]=this.paint("fill");return` fill="${c}"${a<1?` fill-opacity="${n(a)}"`:""}`})();
    this.out.push(`<text x="${n(x)}" y="${n(y+dy)}"${mat(this.s.m)} font-family="${esc(f.family.replace(/"/g,"'"))}" font-size="${n(f.size)}"${f.weight!=="400"&&f.weight!=="normal"?` font-weight="${f.weight}"`:""}${f.style!=="normal"?` font-style="${f.style}"`:""} text-anchor="${anchor}"${fit}${paint} xml:space="preserve">${esc(t)}</text>`);
  }
  fillText(t,x,y,maxW){this.text(t,x,y,maxW,"fill")}
  strokeText(t,x,y,maxW){this.text(t,x,y,maxW,"stroke")}
  drawImage(img,...a){
    let sx=0,sy=0,sw=img.width,sh=img.height,dx,dy,dw,dh;
    if(a.length===2){[dx,dy]=a;dw=sw;dh=sh}else if(a.length===4){[dx,dy,dw,dh]=a}else{[sx,sy,sw,sh,dx,dy,dw,dh]=a}
    const m=mul(this.s.m,[dw/sw,0,0,dh/sh,dx-sx*dw/sw,dy-sy*dh/sh]),cropped=a.length===8;
    const clip=cropped?(()=>{const id="c"+(++UID);this.defs.push(`<clipPath id="${id}"><rect x="${n(sx)}" y="${n(sy)}" width="${n(sw)}" height="${n(sh)}"/></clipPath>`);return` clip-path="url(#${id})"`})():"";
    const op=this.s.globalAlpha<1?` opacity="${n(this.s.globalAlpha)}"`:"";
    if(img instanceof SvgCanvas){const c=img.getContext("2d");this.defs.push(...c.defs);this.out.push(`<g${mat(m)}${clip}${op}>${c.markup()}</g>`);return}
    const url=rasterUrl(img);if(!url)return;
    const px=!this.s.imageSmoothingEnabled?' style="image-rendering:pixelated" image-rendering="optimizeSpeed"':"";
    this.out.push(`<image x="0" y="0" width="${img.width}" height="${img.height}"${mat(m)}${clip}${op}${px} preserveAspectRatio="none" href="${url}"/>`);
  }
  // compatibilidade: dados de pixel não existem numa superfície vetorial
  getImageData(){throw new Error("getImageData indisponível em SVG")}
  putImageData(){}
  // marcação com todos os grupos de recorte ainda abertos fechados (não altera o estado)
  markup(){const open=this.s.clips+this.stack.reduce((a,t)=>a+(t.clips||0),0);return this.out.join("")+"</g>".repeat(open)}
  createImageData(w,h){return{width:w,height:h,data:new Uint8ClampedArray(w*h*4)}}
}
for(const k of ["fillStyle","strokeStyle","lineWidth","font","textAlign","textBaseline","globalAlpha","lineCap","lineJoin","imageSmoothingEnabled","imageSmoothingQuality"])
  Object.defineProperty(SvgContext.prototype,k,{get(){return this.s[k]},set(v){this.s[k]=v}});
Object.defineProperty(SvgContext.prototype,"lineDashOffset",{get(){return 0},set(){}});
Object.defineProperty(SvgContext.prototype,"globalCompositeOperation",{get(){return"source-over"},set(){}});

// raster embutido: fotos (marcadas __photo) em JPEG, demais em PNG (alfa preservado); cache por objeto
const RASTER=new WeakMap();
function rasterUrl(img){
  if(RASTER.has(img))return RASTER.get(img);let c=img;
  if(!(c.toDataURL)){try{c=realCanvas(img.width,img.height);c.getContext("2d").drawImage(img,0,0)}catch{return null}}
  if(!c.toDataURL)return null;
  const u=img.__photo?c.toDataURL("image/jpeg",.92):c.toDataURL("image/png");RASTER.set(img,u);return u;
}

export class SvgCanvas{
  constructor(w,h){this.width=w;this.height=h;this.ctx=new SvgContext(this)}
  getContext(){return this.ctx}
  toSVG(title=""){const c=this.ctx;
    return`<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}">${title?`<title>${esc(title)}</title>`:""}<defs>${c.defs.join("")}</defs>${c.markup()}</svg>\n`}
}
// figura → URL de objeto SVG (chame fn() dentro do modo SVG)
export function svgUrl(build,title){
  const c=withSvg(build);if(!isSvgCanvas(c))throw new Error("a figura não gerou SVG");
  const s=c.toSVG(title).replace(/<image ([^>]*?)href="/g,'<image $1xlink:href="');
  return URL.createObjectURL(new Blob([s],{type:"image/svg+xml"}));
}
