// CDM-4 · análise do campo do random walker numa área quadrada (ferramenta "Campo do walker").
//
// 1) Recorte quadrado da imagem processada; o walker é resolvido DE NOVO em resolução cheia dentro
//    do recorte, com os mesmos polos do motor (potencial global = 1 → dano, = 0 → saudável) e a borda
//    do recorte presa ao lado decidido pelo motor. Assim o campo local é coerente com a análise.
// 2) Campo de direção: −∇u (do polo de dano para o saudável), intensidade |∇u|.
// 3) Desvio angular de cada seta em relação à direção "saindo do polo de dano mais próximo",
//    coerência R (comprimento do vetor médio ponderado por |∇u|) e dispersão local 1 − R (janela 9×9).
// 4) Tabela por região: área do motor × área em resolução cheia, R da faixa da fronteira, |∇u|
//    mediano e fração de "platô" (interior sem gradiente = halo sem evidência).
import{RW_DEFAULTS,robustZ,shannonRank,solveWalker}from"./cdm4RandomWalker.js";

export const FIELD_DEFAULTS={maxSide:720,seedHi:.999,seedLo:.001,transLo:.02,transHi:.98,dispWin:9,bins:36,bandOut:12,bandIn:6,plateauFrac:.2,minRegionFrac:.002};

function boxMean(src,w,h,k){
  const r=k>>1,W=w+1,I=new Float64Array(W*(h+1)),out=new Float32Array(w*h);
  for(let y=0;y<h;y++){let row=0;for(let x=0;x<w;x++){row+=src[y*w+x];I[(y+1)*W+x+1]=I[y*W+x+1]+row}}
  for(let y=0;y<h;y++){const y0=Math.max(0,y-r),y1=Math.min(h-1,y+r);for(let x=0;x<w;x++){const x0=Math.max(0,x-r),x1=Math.min(w-1,x+r);
    out[y*w+x]=(I[(y1+1)*W+x1+1]-I[y0*W+x1+1]-I[(y1+1)*W+x0]+I[y0*W+x0])/((y1-y0+1)*(x1-x0+1))}}
  return out;
}
function morph(src,w,h,r,isMax){
  const tmp=new Uint8Array(w*h),out=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=isMax?0:1;for(let d=-r;d<=r;d++){const xx=x+d;const s=xx<0||xx>=w?0:src[y*w+xx];if(isMax?s:!s){v=isMax?1:0;break}}tmp[y*w+x]=v}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=isMax?0:1;for(let d=-r;d<=r;d++){const yy=y+d;const s=yy<0||yy>=h?0:tmp[yy*w+x];if(isMax?s:!s){v=isMax?1:0;break}}out[y*w+x]=v}
  return out;
}
function median(arr){if(!arr.length)return 0;const s=Float32Array.from(arr).sort();return s[s.length>>1]}
// potencial global (escala do walker) amostrado num ponto da imagem processada
function sampleGlobal(rw,x,y){
  const f=rw.f||Math.max(1,Math.round(rw.imgW/rw.W)),u=Math.min(rw.W-1,Math.max(0,(x+.5)/f-.5)),v=Math.min(rw.H-1,Math.max(0,(y+.5)/f-.5));
  const x0=Math.floor(u),y0=Math.floor(v),x1=Math.min(rw.W-1,x0+1),y1=Math.min(rw.H-1,y0+1),fx=u-x0,fy=v-y0,P=rw.prob;
  return(P[y0*rw.W+x0]*(1-fx)+P[y0*rw.W+x1]*fx)*(1-fy)+(P[y1*rw.W+x0]*(1-fx)+P[y1*rw.W+x1]*fx)*fy;
}

// rgba: imagem processada (w×h); rw: {prob,W,H,threshold,f?}; roi: {x,y,size} em px da imagem processada.
export function analyzeWalkerField(rgba,w,h,rw,roi,opts={}){
  const o={...FIELD_DEFAULTS,...opts},t0=Date.now();
  const size=Math.max(8,Math.min(roi.size,w,h)),X0=Math.max(0,Math.min(w-size,Math.round(roi.x))),Y0=Math.max(0,Math.min(h-size,Math.round(roi.y)));
  const k=Math.max(1,Math.ceil(size/o.maxSide)),n=Math.floor(size/k),N=n*n,thr=rw.threshold??.5;
  const G={...rw,imgW:w,f:rw.f||Math.max(1,Math.round(w/rw.W))};
  // recorte (média em blocos k×k quando a área é muito grande)
  const R=new Float32Array(N),Gc=new Float32Array(N),B=new Float32Array(N),img=new Uint8ClampedArray(N*4),Pg=new Float32Array(N);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    let r=0,g=0,b=0;for(let dy=0;dy<k;dy++)for(let dx=0;dx<k;dx++){const j=4*((Y0+y*k+dy)*w+X0+x*k+dx);r+=rgba[j];g+=rgba[j+1];b+=rgba[j+2]}
    const i=y*n+x,c=k*k;R[i]=r/c;Gc[i]=g/c;B[i]=b/c;img[4*i]=R[i];img[4*i+1]=Gc[i];img[4*i+2]=B[i];img[4*i+3]=255;
    Pg[i]=sampleGlobal(G,X0+(x+.5)*k-.5,Y0+(y+.5)*k-.5);
  }
  // planos do walker (os mesmos do motor): L, oponentes e Shannon das espécies de Ataky
  const L=new Float32Array(N),o1=new Float32Array(N),o2=new Float32Array(N);
  for(let i=0;i<N;i++){L[i]=.299*R[i]+.587*Gc[i]+.114*B[i];o1[i]=R[i]-Gc[i];o2[i]=(R[i]+Gc[i])/2-B[i]}
  const Ls=Float32Array.from(L).sort(),p1=Ls[Math.floor(.01*(N-1))],p99=Ls[Math.floor(.99*(N-1))],sp=new Uint8Array(N);
  for(let i=0;i<N;i++){const q=Math.floor(Math.min(.999,Math.max(0,(L[i]-p1)/Math.max(1e-6,p99-p1)))*8);let hb=0;if(Math.hypot(o1[i],o2[i])>=12){let a=Math.atan2(o2[i],o1[i]);if(a<0)a+=2*Math.PI;hb=Math.min(6,Math.floor(a/(2*Math.PI)*6)+1)}sp[i]=q*7+hb}
  const Hs=shannonRank(sp,n,n,RW_DEFAULTS.shannonWin,56),X=[robustZ(L),robustZ(o1),robustZ(o2),robustZ(Hs)];
  // polos: os do motor; a borda do recorte fica presa ao lado decidido pelo motor
  const label=new Int8Array(N),seedD=new Uint8Array(N),seedH=new Uint8Array(N);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){const i=y*n+x,p=Pg[i];
    if(p>=o.seedHi){label[i]=2;seedD[i]=1}else if(p<=o.seedLo){label[i]=1;seedH[i]=1}
    else if(x===0||y===0||x===n-1||y===n-1)label[i]=p>thr?2:1}
  let nd=0,nh=0;for(let i=0;i<N;i++){if(label[i]===2)nd++;else if(label[i]===1)nh++}
  let P;
  if(nd&&nh){const S=solveWalker(X,n,n,label,{...RW_DEFAULTS});P=S.prob}else{P=Float32Array.from(Pg)}
  // campo −∇u (suavização 3×3 dupla ≈ gaussiana σ≈1)
  const Ps=boxMean(boxMean(P,n,n,3),n,n,3),vx=new Float32Array(N),vy=new Float32Array(N),mag=new Float32Array(N);
  const at=(x,y)=>Ps[Math.min(n-1,Math.max(0,y))*n+Math.min(n-1,Math.max(0,x))];
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){const i=y*n+x,gx=(at(x+1,y)-at(x-1,y))/2,gy=(at(x,y+1)-at(x,y-1))/2;vx[i]=-gx/k;vy[i]=-gy/k;mag[i]=Math.hypot(vx[i],vy[i])}
  // polo de dano mais próximo (varredura em largura multi-fonte, vizinhança 8)
  const near=new Int32Array(N).fill(-1),q=new Int32Array(N);let hd=0,tl=0;
  for(let i=0;i<N;i++)if(seedD[i]||Pg[i]>=o.seedHi){near[i]=i;q[tl++]=i}
  while(hd<tl){const p=q[hd++],y=(p/n)|0,x=p-y*n;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const yy=y+dy,xx=x+dx;if(yy<0||xx<0||yy>=n||xx>=n)continue;const t=yy*n+xx;if(near[t]<0){near[t]=near[p];q[tl++]=t}}}
  const trans=new Uint8Array(N),dev=new Float32Array(N);
  let Sx=0,Sy=0,Sw=0;const hist=new Float64Array(o.bins);
  for(let i=0;i<N;i++){
    if(seedD[i]||seedH[i]||!(P[i]>o.transLo&&P[i]<o.transHi)||mag[i]<=1e-6||near[i]<0)continue;
    const y=(i/n)|0,x=i-y*n,s=near[i],sy=(s/n)|0,sx=s-sy*n,ref=Math.atan2(y-sy,x-sx),a=Math.atan2(vy[i],vx[i]);
    let d=a-ref;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;
    trans[i]=1;dev[i]=d;Sx+=mag[i]*Math.cos(d);Sy+=mag[i]*Math.sin(d);Sw+=mag[i];
    hist[Math.min(o.bins-1,Math.floor((d+Math.PI)/(2*Math.PI)*o.bins))]+=mag[i];
  }
  const Rglob=Sw>0?Math.hypot(Sx,Sy)/Sw:0;
  // dispersão local 1 − R
  const ux=new Float32Array(N),uy=new Float32Array(N),valid=new Float32Array(N);
  for(let i=0;i<N;i++)if(mag[i]>1e-6){ux[i]=vx[i]/mag[i];uy[i]=vy[i]/mag[i];valid[i]=1}
  const mx=boxMean(ux,n,n,o.dispWin),my=boxMean(uy,n,n,o.dispWin),mv=boxMean(valid,n,n,o.dispWin),disp=new Float32Array(N).fill(NaN);
  for(let i=0;i<N;i++)if(trans[i])disp[i]=1-Math.min(1,Math.hypot(mx[i],my[i])/Math.max(1e-9,mv[i]));
  // máscaras: contorno do motor (potencial global) × resolução cheia (potencial local)
  const engine=new Uint8Array(N),local=new Uint8Array(N);for(let i=0;i<N;i++){engine[i]=Pg[i]>thr?1:0;local[i]=P[i]>thr?1:0}
  // regiões e tabela de coerência
  const lab=new Int32Array(N),regions=[];let id=0;
  const bOut=Math.max(1,Math.round(o.bandOut/k)),bIn=Math.max(1,Math.round(o.bandIn/k)),dil=morph(local,n,n,bOut,true),ero=morph(local,n,n,bIn,false);
  for(let s=0;s<N;s++){
    if(!local[s]||lab[s])continue;id++;hd=0;tl=0;q[tl++]=s;lab[s]=id;
    while(hd<tl){const p=q[hd++],y=(p/n)|0,x=p-y*n;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const yy=y+dy,xx=x+dx;if(yy<0||xx<0||yy>=n||xx>=n)continue;const t=yy*n+xx;if(local[t]&&!lab[t]){lab[t]=id;q[tl++]=t}}}
    if(tl<Math.max(12,o.minRegionFrac*N))continue;
    let cx=0,cy=0,ea=0,bx=0,by=0,bw=0;const bmag=[],borderMag=[],members=q.slice(0,tl);
    for(const p of members){cx+=p%n;cy+=(p/n)|0;const y=(p/n)|0,x=p-y*n;if(x===0||y===0||x===n-1||y===n-1||!local[p-1]||!local[p+1]||!local[p-n]||!local[p+n])borderMag.push(mag[p])}
    // faixa da fronteira: perto da região (dilatada) e fora do seu interior profundo
    const near2=morph(lab.map(v=>v===id?1:0),n,n,bOut,true);
    for(let i=0;i<N;i++){if(engine[i]&&near2[i])ea++;if(near2[i]&&!(ero[i]&&lab[i]===id)&&trans[i]){bx+=mag[i]*Math.cos(dev[i]);by+=mag[i]*Math.sin(dev[i]);bw+=mag[i];bmag.push(mag[i])}}
    const tau=o.plateauFrac*median(borderMag);let plateau=0;for(const p of members)if(!seedD[p]&&mag[p]<tau)plateau++;
    regions.push({center:[Math.round(X0+(cx/tl+.5)*k),Math.round(Y0+(cy/tl+.5)*k)],area_engine_px:ea*k*k,area_local_px:tl*k*k,R:bw>0?Math.hypot(bx,by)/bw:0,grad_median:median(bmag),plateau_frac:plateau/tl});
  }
  regions.sort((a,b)=>b.area_local_px-a.area_local_px);
  let me=0,ml=0;for(let i=0;i<N;i++){me+=engine[i];ml+=local[i]}
  return{roi:{x:X0,y:Y0,size:n*k},n,k,img,P,Pg,vx,vy,mag,trans,dev,disp,engine,local,seedD,seedH,hist:Array.from(hist),R:Rglob,circVar:1-Rglob,regions,
    area_engine_px:me*k*k,area_local_px:ml*k*k,threshold:thr,ms:Date.now()-t0};
}
