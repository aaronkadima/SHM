// CDM-4 no modo Live: as etapas do fluxo por evidência como FILTROS em tempo quase real.
// Cada quadro (lado 240–480 px) gera os mapas de evidência e, se o filtro pedir, o potencial do walker.
// Velocidade: o walker é resolvido primeiro em meia resolução e a solução ampliada é o ponto de partida
// na resolução do quadro (grossa → fina); entre quadros, o potencial anterior é reaproveitado quando
// ajuda. Mesmas equações e polos do motor; só as janelas espaciais são escaladas ao tamanho do quadro.
import{evidenceMaps,evidenceSeeds,EVIDENCE_DEFAULTS}from"./cdm4Evidence.js";
import{solveWalker,RW_DEFAULTS}from"./cdm4RandomWalker.js";

export const LIVE_FILTERS=[
  {id:"rough",label:"Rugosidade normalizada",walker:false},
  {id:"div",label:"Diversidade de Ataky",walker:false},
  {id:"poles",label:"Polos do walker",walker:false},
  {id:"walker",label:"Potencial do walker",walker:true},
  {id:"final",label:"Contorno do desplacamento",walker:true}
];
const INFERNO=[[0,0,4],[40,11,84],[101,21,110],[159,42,99],[212,72,66],[245,125,21],[250,193,39],[252,255,164]];
const VIRIDIS=[[68,1,84],[72,40,120],[62,74,137],[49,104,142],[38,130,142],[31,158,137],[53,183,121],[110,206,88],[181,222,43],[253,231,37]];
export const LIVE_LEGENDS={
  rough:{stops:INFERNO,min:-2,max:8,ticks:[-2,0,2,4,6,8],threshold:3,title:"Rugosidade (z, saudável = 0)",thresholdLabel:"polo z ≥ 3"},
  div:{stops:INFERNO,min:-2,max:5,ticks:[-2,0,1,3,5],threshold:1,title:"Diversidade de Shannon (z)",thresholdLabel:"polo z ≥ 1"},
  walker:{stops:VIRIDIS,min:0,max:1,ticks:[0,.25,.5,.75,1],title:"u = P(chegar primeiro ao polo de dano)",thresholdLabel:"τ"}
};
const ramp=(stops,t)=>{t=Math.min(1,Math.max(0,t))*(stops.length-1);const i=Math.min(stops.length-2,Math.floor(t)),f=t-i,a=stops[i],b=stops[i+1];return[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f,a[2]+(b[2]-a[2])*f]};
const odd=v=>Math.max(3,Math.round(v)|1);

// janelas do fluxo por evidência estão calibradas para o mapa de evidência do motor (≈ 800 px de lado)
export function liveEvidenceOpts(side,threshold=.5){
  const k=side/800;
  // janelas com piso (5 px rugosidade, 9 px Shannon): abaixo disso a entropia das 56 espécies fica ruidosa.
  // Foto 24 com GT, quadro de 320 px: IoU 73,6 % (escalado puro 70,9 %; janelas do motor 70,1 %).
  return{...EVIDENCE_DEFAULTS,roughWin:Math.max(5,odd(7*k)),shannonWin:Math.max(9,odd(11*k)),seedCore:Math.max(3,Math.round(9*k)),seedOpen:Math.max(1,Math.round(3*k)),healthyGap:Math.max(2,Math.round(4*k)),threshold};
}
function half(a,W,H){const w=W>>1,h=H>>1,o=new Float32Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=2*y*W+2*x;o[y*w+x]=(a[i]+a[i+1]+a[i+W]+a[i+W+1])/4}return{o,w,h}}
function halfLabel(lab,W,H){const w=W>>1,h=H>>1,o=new Int8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=2*y*W+2*x,q=[lab[i],lab[i+1],lab[i+W],lab[i+W+1]];
  o[y*w+x]=q.every(v=>v===2)?2:q.every(v=>v===1)?1:0}return o}
function upsample(p,w,h,W,H){const o=new Float32Array(W*H);for(let y=0;y<H;y++){const v=Math.min(h-1,Math.max(0,(y+.5)/2-.5)),y0=Math.floor(v),y1=Math.min(h-1,y0+1),fy=v-y0;
  for(let x=0;x<W;x++){const s=Math.min(w-1,Math.max(0,(x+.5)/2-.5)),x0=Math.floor(s),x1=Math.min(w-1,x0+1),fx=s-x0;o[y*W+x]=(p[y0*w+x0]*(1-fx)+p[y0*w+x1]*fx)*(1-fy)+(p[y1*w+x0]*(1-fx)+p[y1*w+x1]*fx)*fy}}return o}

// potencial do walker com partida grossa → fina (e, se houver, o potencial do quadro anterior)
export function liveWalker(E,label,{prev=null,coarse=true,opts={}}={}){
  const o={...RW_DEFAULTS,...opts},W=E.W,H=E.H,t0=performance.now();let x0=null,itC=0;
  const X=[E.L,E.o1,E.o2,E.Hs];
  if(prev&&prev.length===W*H)x0=prev;
  else if(coarse&&W>=64&&H>=64){
    const Xc=X.map(a=>half(a,W,H).o),w=W>>1,h=H>>1,lc=halfLabel(label,W,H);
    let nd=0,nh=0;for(const v of lc){if(v===2)nd++;else if(v===1)nh++}
    if(nd&&nh){const Rc=solveWalker(Xc,w,h,lc,o);itC=Rc.iterations;x0=upsample(Rc.prob,w,h,W,H)}
  }
  const R=solveWalker(X,W,H,label,{...o,x0});
  return{prob:R.prob,iterations:R.iterations,coarseIterations:itC,converged:R.converged,ms:performance.now()-t0};
}

// regiões conexas (8-vizinhança) com u > t e área mínima
export function countRegions(P,W,H,t,minArea){
  const N=W*H,seen=new Uint8Array(N),q=new Int32Array(N);let k=0;
  for(let s=0;s<N;s++){if(seen[s]||P[s]<=t)continue;let hd=0,tl=0;q[tl++]=s;seen[s]=1;
    while(hd<tl){const p=q[hd++],y=(p/W)|0,x=p-y*W;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const yy=y+dy,xx=x+dx;if(yy<0||xx<0||yy>=H||xx>=W)continue;const j=yy*W+xx;if(!seen[j]&&P[j]>t){seen[j]=1;q[tl++]=j}}}
    if(tl>=minArea)k++}
  return k;
}
// um quadro: devolve a camada RGBA do filtro, a legenda e métricas; state guarda o potencial anterior
export function runCdm4FilterLive(frame,{filter="walker",threshold=.5,warm=true}={},state={}){
  const{width:w,height:h,data}=frame,t0=performance.now(),side=Math.max(w,h),eo=liveEvidenceOpts(side,threshold);
  const E=evidenceMaps(data,w,h,{scale:1,opts:eo}),seeds=evidenceSeeds(E,eo),t1=performance.now();
  const N=E.W*E.H,rgba=new Uint8ClampedArray(N*4),f=LIVE_FILTERS.find(x=>x.id===filter)||LIVE_FILTERS[3];
  let nd=0,nh=0;for(let i=0;i<N;i++){if(seeds.damage[i])nd++;if(seeds.healthy[i])nh++}
  const metrics={filter:f.id,frame:[E.W,E.H],evidence_ms:+(t1-t0).toFixed(1),damage_seed_px:nd,healthy_seed_px:nh};
  let legend=LIVE_LEGENDS[f.id]?{...LIVE_LEGENDS[f.id]}:null,area=0;
  if(f.id==="rough"||f.id==="div"){
    const v=f.id==="rough"?E.rough:E.div,L=LIVE_LEGENDS[f.id],span=L.max-L.min;
    // concreto típico (z ≤ 0) transparente; opaco a partir do limiar do polo
    for(let i=0;i<N;i++){const t=(v[i]-L.min)/span,[r,g,b]=ramp(L.stops,t),j=4*i;rgba[j]=r;rgba[j+1]=g;rgba[j+2]=b;rgba[j+3]=Math.round(255*Math.min(1,Math.max(0,v[i]/L.threshold)))}
  }else if(f.id==="poles"){
    for(let i=0;i<N;i++){const j=4*i;if(seeds.damage[i]){rgba[j]=255;rgba[j+1]=120;rgba[j+2]=0;rgba[j+3]=235}else if(seeds.healthy[i]){rgba[j]=40;rgba[j+1]=150;rgba[j+2]=255;rgba[j+3]=110}}
    legend={kind:"poles",title:"Polos: laranja = dano · azul = saudável"};
  }else{
    const label=new Int8Array(N);for(let i=0;i<N;i++)label[i]=seeds.damage[i]?2:seeds.healthy[i]?1:0;
    if(!nd||!nh){state.prev=null;metrics.walker="sem polos";legend=f.id==="walker"?{...legend,threshold}:null}
    else{
      const R=liveWalker(E,label,{prev:warm?state.prev:null});state.prev=warm?R.prob:null;
      Object.assign(metrics,{walker_ms:+R.ms.toFixed(1),iterations:R.iterations,coarse_iterations:R.coarseIterations,converged:R.converged});
      const P=R.prob;
      if(f.id==="walker"){const L=LIVE_LEGENDS.walker;for(let i=0;i<N;i++){const[r,g,b]=ramp(L.stops,P[i]),j=4*i;rgba[j]=r;rgba[j+1]=g;rgba[j+2]=b;rgba[j+3]=Math.round(255*Math.min(1,P[i]*2.5))}legend={...L,threshold,thresholdLabel:"τ = "+threshold}}
      else{for(let y=0;y<E.H;y++)for(let x=0;x<E.W;x++){const i=y*E.W+x;if(P[i]<=threshold)continue;area++;const j=4*i,edge=x===0||y===0||x===E.W-1||y===E.H-1||P[i-1]<=threshold||P[i+1]<=threshold||P[i-E.W]<=threshold||P[i+E.W]<=threshold;
        if(edge){rgba[j]=255;rgba[j+1]=255;rgba[j+2]=255;rgba[j+3]=255}else{rgba[j]=255;rgba[j+1]=140;rgba[j+2]=0;rgba[j+3]=150}}
        legend={kind:"final",title:"Contorno: u > τ · branco = contorno",threshold};metrics.area_frac=+(area/N).toFixed(4);metrics.regions=countRegions(P,E.W,E.H,threshold,Math.max(8,Math.round(N*.002)))}
    }
  }
  metrics.total_ms=+(performance.now()-t0).toFixed(1);
  return{rgba,w:E.W,h:E.H,legend,metrics,areaFrac:area/N};
}
