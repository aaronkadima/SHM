// CDM-4 · deconvolução de "pigmentos" por Beer–Lambert (Ruifrok & Johnston, 2001, adaptada).
//
// Na histologia, a cor de cada pixel vira densidade óptica OD = −log10(I/I₀), onde os corantes se somam
// linearmente; resolvendo OD = S·c obtêm-se as concentrações c. No concreto, a "luz incidente" I₀ é o
// próprio concreto saudável da foto (mediana fora de qualquer máscara) e os "corantes" são:
//   neutro     (1,1,1)/√3 — umidade e sombra escurecem os três canais por igual;
//   ferrugem   OD de RGB (150, 85, 45) relativo a (150,150,150) — óxido de ferro absorve o azul;
//   biológico  OD de RGB (100,130, 90) — alga/musgo absorvem vermelho e azul.
// No CDM-4 a camada é de DIAGNÓSTICO: anota cada registro com a composição e mede quanto da corrosão
// detectada tem óxido de ferro de fato. Não remove nem cria achados até ser validada com GT de corrosão.
// Limitação conhecida: giz laranja de marcação aparece como ferrugem.

export const PIGMENT_DEFAULTS={rustThreshold:.25,bioThreshold:.25,healthyGuardPx:7,smoothK:5};
const odv=(rgb,ref=[150,150,150])=>{const v=rgb.map((c,i)=>-Math.log10(c/ref[i])),n=Math.hypot(...v);return v.map(x=>x/n)};
export const PIGMENT_VECTORS={neutral:[1,1,1].map(v=>v/Math.sqrt(3)),rust:odv([150,85,45]),biological:odv([100,130,90])};

function inv3(m){
  const[a,b,c,d,e,f,g,h,i]=m,A=e*i-f*h,B=-(d*i-f*g),C=d*h-e*g,det=a*A+b*B+c*C;
  return[A/det,-(b*i-c*h)/det,(b*f-c*e)/det,B/det,(a*i-c*g)/det,-(a*f-c*d)/det,C/det,-(a*h-b*g)/det,(a*e-b*d)/det];
}
function median(arr){if(!arr.length)return 0;const s=Float32Array.from(arr).sort(),n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2}
function boxMean(src,w,h,k){
  const r=k>>1,W=w+1,I=new Float64Array(W*(h+1)),out=new Float32Array(w*h);
  for(let y=0;y<h;y++){let row=0;for(let x=0;x<w;x++){row+=src[y*w+x];I[(y+1)*W+x+1]=I[y*W+x+1]+row}}
  for(let y=0;y<h;y++){const y0=Math.max(0,y-r),y1=Math.min(h-1,y+r);
    for(let x=0;x<w;x++){const x0=Math.max(0,x-r),x1=Math.min(w-1,x+r);
      out[y*w+x]=(I[(y1+1)*W+x1+1]-I[y0*W+x1+1]-I[(y1+1)*W+x0]+I[y0*W+x0])/((y1-y0+1)*(x1-x0+1))}}
  return out;
}

// anyDamage: união das máscaras finais (define o concreto saudável que serve de I₀).
export function pigmentMaps(rgba,w,h,anyDamage,opts={}){
  const o={...PIGMENT_DEFAULTS,...opts},n=w*h;
  // saudável = fora do dano dilatado; amostragem determinística para a mediana
  let guard=anyDamage;
  if(anyDamage&&o.healthyGuardPx>0){
    const r=o.healthyGuardPx,tmp=new Uint8Array(n);guard=new Uint8Array(n);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=0;for(let d=-r;d<=r&&!v;d++){const xx=x+d;if(xx>=0&&xx<w&&anyDamage[y*w+xx])v=1}tmp[y*w+x]=v}
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=0;for(let d=-r;d<=r&&!v;d++){const yy=y+d;if(yy>=0&&yy<h&&tmp[yy*w+x])v=1}guard[y*w+x]=v}
  }
  const step=Math.max(1,Math.floor(n/200000)),R=[],G=[],B=[];
  for(let i=0;i<n;i+=step){if(guard&&guard[i])continue;R.push(rgba[4*i]);G.push(rgba[4*i+1]);B.push(rgba[4*i+2])}
  if(R.length<100){R.length=G.length=B.length=0;for(let i=0;i<n;i+=step){R.push(rgba[4*i]);G.push(rgba[4*i+1]);B.push(rgba[4*i+2])}}
  const I0=[median(R),median(G),median(B)].map(v=>Math.max(1,v));
  const V=PIGMENT_VECTORS,S=[V.neutral[0],V.rust[0],V.biological[0],V.neutral[1],V.rust[1],V.biological[1],V.neutral[2],V.rust[2],V.biological[2]],Si=inv3(S);
  const neutral=new Float32Array(n),rust=new Float32Array(n),bio=new Float32Array(n);
  for(let i=0;i<n;i++){
    const a=-Math.log10(Math.max(1,rgba[4*i])/I0[0]),b=-Math.log10(Math.max(1,rgba[4*i+1])/I0[1]),c=-Math.log10(Math.max(1,rgba[4*i+2])/I0[2]);
    neutral[i]=Si[0]*a+Si[1]*b+Si[2]*c;rust[i]=Si[3]*a+Si[4]*b+Si[5]*c;bio[i]=Si[6]*a+Si[7]*b+Si[8]*c;
  }
  const k=o.smoothK;
  return{neutral:k>1?boxMean(neutral,w,h,k):neutral,rust:k>1?boxMean(rust,w,h,k):rust,biological:k>1?boxMean(bio,w,h,k):bio,I0:I0.map(v=>Math.round(v)),opts:o};
}

// Composição de uma máscara (média das concentrações e frações acima do limiar).
export function maskComposition(maps,mask){
  let n=0,sn=0,sr=0,sb=0,fr=0,fb=0;const{rustThreshold,bioThreshold}=maps.opts;
  for(let i=0;i<mask.length;i++){if(!mask[i])continue;n++;sn+=maps.neutral[i];sr+=maps.rust[i];sb+=maps.biological[i];if(maps.rust[i]>rustThreshold)fr++;if(maps.biological[i]>bioThreshold)fb++}
  if(!n)return null;
  const r3=v=>+v.toFixed(3);
  return{pixels:n,neutral_mean:r3(sn/n),rust_mean:r3(sr/n),biological_mean:r3(sb/n),rust_fraction:r3(fr/n),biological_fraction:r3(fb/n)};
}
