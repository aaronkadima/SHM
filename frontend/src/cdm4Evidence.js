// CDM-4 · fluxo por evidência (modo experimental cdm4_flow = "evidence").
//
// Ordem: normalização → contexto como domínio → evidências → polos → random walker → juiz de
// biodiversidade → recorte → vetorização. A morfologia deixa de decidir o desplacamento; o black-hat
// entra só como mais uma evidência. Tudo é medido contra o concreto saudável da própria foto
// (referência = pixels claros do domínio), não contra a foto inteira — assim uma foto dominada por
// um desplacamento grande não "normaliza" o próprio dano.

export const EVIDENCE_DEFAULTS={
  refQuantile:.4,        // referência saudável = pixels do domínio acima deste quantil de luminância
  bgFrac:.2,             // fundo local = média em janela de 20 % do maior lado (sombra/vinheta)
  shannonWin:11,roughWin:7,
  seedRough:3,seedDiv:1,seedDarkMin:-.5,  // polo de dano: áspero E diverso E não mais claro que o fundo
  healthyRough:.5,healthyDiv:.3,healthyGap:4, // polo saudável: liso E homogêneo, a ≥ healthyGap px do dano
  seedOpen:3,seedCore:9,seedMinFrac:.0004,
  threshold:.5
};

function percentileSorted(s,p){if(!s.length)return 0;const i=p*(s.length-1),lo=Math.floor(i),hi=Math.ceil(i);return s[lo]+(s[hi]-s[lo])*(i-lo)}
function robustOf(a,sel){const v=[];for(let i=0;i<a.length;i++)if(sel[i])v.push(a[i]);v.sort((x,y)=>x-y);const m=percentileSorted(v,.5);const d=v.map(x=>Math.abs(x-m)).sort((x,y)=>x-y);return{med:m,mad:Math.max(1e-3,1.4826*percentileSorted(d,.5))}}
function boxMeanMasked(src,valid,w,h,k){
  const r=k>>1,W=w+1,S=new Float64Array(W*(h+1)),C=new Float64Array(W*(h+1)),out=new Float32Array(w*h);
  for(let y=0;y<h;y++){let rs=0,rc=0;for(let x=0;x<w;x++){const i=y*w+x,v=valid?valid[i]:1;rs+=v?src[i]:0;rc+=v;S[(y+1)*W+x+1]=S[y*W+x+1]+rs;C[(y+1)*W+x+1]=C[y*W+x+1]+rc}}
  for(let y=0;y<h;y++){const y0=Math.max(0,y-r),y1=Math.min(h-1,y+r);for(let x=0;x<w;x++){const x0=Math.max(0,x-r),x1=Math.min(w-1,x+r);
    const s=S[(y1+1)*W+x1+1]-S[y0*W+x1+1]-S[(y1+1)*W+x0]+S[y0*W+x0],c=C[(y1+1)*W+x1+1]-C[y0*W+x1+1]-C[(y1+1)*W+x0]+C[y0*W+x0];out[y*w+x]=c>0?s/c:src[y*w+x]}}
  return out;
}
function shannonRank(sp,w,h,k,nSpecies){
  const r=k>>1,out=new Float32Array(w*h),hist=new Int32Array(nSpecies),clog=new Float64Array(k*(k+1)+2);
  for(let c=1;c<clog.length;c++)clog[c]=c*Math.log2(c);
  for(let y=0;y<h;y++){const y0=Math.max(0,y-r),y1=Math.min(h-1,y+r);hist.fill(0);let N=0,S=0;
    const add=(x,sgn)=>{for(let yy=y0;yy<=y1;yy++){const s=sp[yy*w+x],c=hist[s];S+=clog[c+sgn]-clog[c];hist[s]=c+sgn;N+=sgn}};
    for(let x=0;x<=Math.min(w-1,r);x++)add(x,1);
    for(let x=0;x<w;x++){if(x>0){if(x+r<w)add(x+r,1);if(x-r-1>=0)add(x-r-1,-1)}out[y*w+x]=N>0?Math.log2(N)-S/N:0}}
  return out;
}
const nearestIdx=(i,from,to)=>Math.min(from-1,Math.floor((i+.5)*from/to));
export function downMask(m,w,h,W,H){const o=new Uint8Array(W*H);if(!m)return o;for(let y=0;y<H;y++){const sy=nearestIdx(y,h,H)*w;for(let x=0;x<W;x++)o[y*W+x]=m[sy+nearestIdx(x,w,W)]?1:0}return o}
function resample(rgba,w,h,f){
  const W=Math.max(1,Math.floor(w/f)),H=Math.max(1,Math.floor(h/f)),N=W*H,taps=[];
  for(let i=0;i<Math.max(W,H);i++){const c=(i+.5)*f,lo=Math.floor(c-f),hi=Math.ceil(c+f),t=[];let s=0;for(let j=lo;j<=hi;j++){const wt=f===1?(j===i?1:0):Math.max(0,1-Math.abs(j+.5-c)/f);if(wt>0){t.push([j,wt]);s+=wt}}taps.push(t.map(([j,wt])=>[j,wt/s]))}
  const ch=c=>{const tmp=new Float32Array(W*h),out=new Float32Array(N);
    for(let y=0;y<h;y++)for(let x=0;x<W;x++){let v=0;for(const[j,wt]of taps[x])v+=wt*rgba[4*(y*w+Math.min(w-1,Math.max(0,j)))+c];tmp[y*W+x]=v}
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){let v=0;for(const[j,wt]of taps[y])v+=wt*tmp[Math.min(h-1,Math.max(0,j))*W+x];out[y*W+x]=Math.round(Math.min(255,Math.max(0,v)))}
    return out};
  return{R:ch(0),G:ch(1),B:ch(2),W,H};
}

// Planos de evidência na escala do walker. domain: Uint8Array w×h (1 = conta) ou null.
export function evidenceMaps(rgba,w,h,{domain=null,scale=1,opts={}}={}){
  const o={...EVIDENCE_DEFAULTS,...opts},{R,G,B,W,H}=resample(rgba,w,h,scale),N=W*H;
  const dom=domain?downMask(domain,w,h,W,H):new Uint8Array(N).fill(1);
  const L=new Float32Array(N),o1=new Float32Array(N),o2=new Float32Array(N);
  for(let i=0;i<N;i++){L[i]=.299*R[i]+.587*G[i]+.114*B[i];o1[i]=R[i]-G[i];o2[i]=(R[i]+G[i])/2-B[i]}
  // 1) normalização: referência saudável = pixels claros do domínio
  const Ld=[];for(let i=0;i<N;i++)if(dom[i])Ld.push(L[i]);Ld.sort((a,b)=>a-b);
  const cut=percentileSorted(Ld,o.refQuantile),ref=new Uint8Array(N);for(let i=0;i<N;i++)ref[i]=dom[i]&&L[i]>=cut?1:0;
  const p1=percentileSorted(Ld,.01),p99=percentileSorted(Ld,.99);
  // fundo local (só domínio): remove sombra e vinheta antes de medir escuridão
  const k=Math.max(15,Math.round(Math.max(W,H)*o.bgFrac))|1,bg=boxMeanMasked(L,ref,W,H,k);
  const rL=robustOf(L,ref),dark=new Float32Array(N);for(let i=0;i<N;i++)dark[i]=(bg[i]-L[i])/rL.mad;
  // espécies de Ataky e diversidade de Shannon
  const sp=new Uint8Array(N);
  for(let i=0;i<N;i++){const q=Math.floor(Math.min(.999,Math.max(0,(L[i]-p1)/Math.max(1e-6,p99-p1)))*8);let hb=0;if(Math.hypot(o1[i],o2[i])>=12){let a=Math.atan2(o2[i],o1[i]);if(a<0)a+=2*Math.PI;hb=Math.min(6,Math.floor(a/(2*Math.PI)*6)+1)}sp[i]=q*7+hb}
  const Hs=shannonRank(sp,W,H,o.shannonWin,56),rH=robustOf(Hs,ref),div=new Float32Array(N);for(let i=0;i<N;i++)div[i]=(Hs[i]-rH.med)/rH.mad;
  // rugosidade: desvio-padrão local de L
  const m1=boxMeanMasked(L,null,W,H,o.roughWin),L2=new Float32Array(N);for(let i=0;i<N;i++)L2[i]=L[i]*L[i];
  const m2=boxMeanMasked(L2,null,W,H,o.roughWin),sd=new Float32Array(N);for(let i=0;i<N;i++)sd[i]=Math.sqrt(Math.max(0,m2[i]-m1[i]*m1[i]));
  const rS=robustOf(sd,ref),rough=new Float32Array(N);for(let i=0;i<N;i++)rough[i]=(sd[i]-rS.med)/rS.mad;
  return{W,H,f:scale,L,o1,o2,Hs,dark,div,rough,dom,ref,refCut:cut};
}

// morfologia binária quadrada separável (borda = 0)
function binMorph(src,w,h,k,isMax){
  const r=k>>1,tmp=new Uint8Array(w*h),out=new Uint8Array(w*h);
  for(let y=0;y<h;y++){const row=y*w;for(let x=0;x<w;x++){let v=isMax?0:1;for(let d=-r;d<=r;d++){const xx=x+d;const s=xx<0||xx>=w?0:src[row+xx];if(isMax?s:!s){v=isMax?1:0;break}}tmp[row+x]=v}}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=isMax?0:1;for(let d=-r;d<=r;d++){const yy=y+d;const s=yy<0||yy>=h?0:tmp[yy*w+x];if(isMax?s:!s){v=isMax?1:0;break}}out[y*w+x]=v}
  return out;
}
function dropSmall(m,w,h,minArea){
  const seen=new Uint8Array(w*h),q=new Int32Array(w*h),out=new Uint8Array(w*h);
  for(let s=0;s<w*h;s++){if(!m[s]||seen[s])continue;let hd=0,tl=0;q[tl++]=s;seen[s]=1;
    while(hd<tl){const p=q[hd++],y=(p/w)|0,x=p-y*w;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const yy=y+dy,xx=x+dx;if(yy<0||xx<0||yy>=h||xx>=w)continue;const t=yy*w+xx;if(m[t]&&!seen[t]){seen[t]=1;q[tl++]=t}}}
    if(tl>=minArea)for(let k=0;k<tl;k++)out[q[k]]=1}
  return out;
}
// Polos por evidência forte (na escala do walker). Dano: áspero E diverso E não mais claro que o fundo.
// Saudável: liso E pouco diverso, no domínio. Opções em EVIDENCE_DEFAULTS.
export function evidenceSeeds(E,opts={}){
  const o={...EVIDENCE_DEFAULTS,...opts},{W,H}=E,N=W*H,raw=new Uint8Array(N),healthy=new Uint8Array(N);
  for(let i=0;i<N;i++){
    if(!E.dom[i])continue;
    if(E.rough[i]>=o.seedRough&&E.div[i]>=o.seedDiv&&E.dark[i]>=o.seedDarkMin)raw[i]=1;
    else if(E.rough[i]<=o.healthyRough&&E.div[i]<=o.healthyDiv)healthy[i]=1;
  }
  const k=o.seedOpen,op0=k>1?binMorph(binMorph(raw,W,H,k,false),W,H,k,true):raw;
  // espessura: só fica o componente que contém um núcleo de seedCore×seedCore (bordas e quinas são faixas finas);
  // o componente volta inteiro (reconstrução), sem perder a forma
  let op=op0;
  if(o.seedCore>1){
    const core=binMorph(op0,W,H,o.seedCore,false),keep=new Uint8Array(N),q=new Int32Array(N);let hd=0,tl=0;
    for(let i=0;i<N;i++)if(core[i]&&op0[i]){keep[i]=1;q[tl++]=i}
    while(hd<tl){const p=q[hd++],y=(p/W)|0,x=p-y*W;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const yy=y+dy,xx=x+dx;if(yy<0||xx<0||yy>=H||xx>=W)continue;const t=yy*W+xx;if(op0[t]&&!keep[t]){keep[t]=1;q[tl++]=t}}}
    op=keep;
  }
  const dmg=dropSmall(op,W,H,Math.max(4,Math.round(o.seedMinFrac*N)));
  // saudável longe dos polos de dano (o walker decide a faixa entre eles)
  const near=binMorph(dmg,W,H,2*o.healthyGap+1,true);for(let i=0;i<N;i++)if(near[i])healthy[i]=0;
  return{damage:dmg,healthy};
}

// Probabilidade (escala do walker) → máscara na resolução da imagem, por interpolação bilinear.
export function upsampleThreshold(prob,W,H,f,w,h,t,forbid=[]){
  const out=new Uint8Array(w*h);
  for(let y=0;y<h;y++){const v=Math.min(H-1,Math.max(0,(y+.5)/f-.5)),y0=Math.floor(v),y1=Math.min(H-1,y0+1),fy=v-y0;
    for(let x=0;x<w;x++){const i=y*w+x;let skip=false;for(const m of forbid)if(m&&m[i]){skip=true;break}if(skip)continue;
      const u=Math.min(W-1,Math.max(0,(x+.5)/f-.5)),x0=Math.floor(u),x1=Math.min(W-1,x0+1),fx=u-x0;
      const pv=(prob[y0*W+x0]*(1-fx)+prob[y0*W+x1]*fx)*(1-fy)+(prob[y1*W+x0]*(1-fx)+prob[y1*W+x1]*fx)*fy;if(pv>t)out[i]=1}}
  return out;
}
