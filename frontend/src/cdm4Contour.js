// CDM-4 · afinamento automático do contorno (loop de limiar por componente).
//
// Para cada região do random walker, o limiar t do potencial é ajustado em passos decimais
// (0,08 → 0,04 → … → 0,005) por subida de encosta, dentro de ±maxDelta do limiar inicial. Critério
// padrão no motor ("fisher"): contraste entre a faixa logo DENTRO do contorno e a faixa logo FORA
// (luminância e rugosidade em z). Alternativas testadas: "band" (Chan–Vese local) e "edge" (gradiente).
// Um halo sobre concreto saudável deixa as duas faixas parecidas (J baixo); a borda real do
// desplacamento as separa (J alto). O loop para quando a distância simétrica média entre o contorno
// atual e o anterior fica abaixo de stopDist px (convergência) ou quando o passo chega ao mínimo.
// Determinístico: mesma entrada ⇒ mesmos limiares.

export const CONTOUR_DEFAULTS={criterion:"band",band:6,tMin:.15,tMax:.9,step0:.08,minStep:.005,stopDist:.25,ring:2,maxIter:40,support:.15,minArea:30};

function morph(src,w,h,r,isMax){
  const k=2*r+1,tmp=new Uint8Array(w*h),out=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=isMax?0:1;for(let d=-r;d<=r;d++){const xx=x+d;const s=xx<0||xx>=w?0:src[y*w+xx];if(isMax?s:!s){v=isMax?1:0;break}}tmp[y*w+x]=v}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=isMax?0:1;for(let d=-r;d<=r;d++){const yy=y+d;const s=yy<0||yy>=h?0:tmp[yy*w+x];if(isMax?s:!s){v=isMax?1:0;break}}out[y*w+x]=v}
  return out;
}
// distância de chanfro (3-4)/3 até o pixel de fronteira mais próximo
function chamfer(border,w,h){
  const INF=1e9,d=new Float32Array(w*h);for(let i=0;i<w*h;i++)d[i]=border[i]?0:INF;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;let v=d[i];if(x>0)v=Math.min(v,d[i-1]+3);if(y>0){v=Math.min(v,d[i-w]+3);if(x>0)v=Math.min(v,d[i-w-1]+4);if(x<w-1)v=Math.min(v,d[i-w+1]+4)}d[i]=v}
  for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){const i=y*w+x;let v=d[i];if(x<w-1)v=Math.min(v,d[i+1]+3);if(y<h-1){v=Math.min(v,d[i+w]+3);if(x<w-1)v=Math.min(v,d[i+w+1]+4);if(x>0)v=Math.min(v,d[i+w-1]+4)}d[i]=v}
  for(let i=0;i<w*h;i++)d[i]/=3;return d;
}
function borderOf(m,w,h){const b=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(!m[i])continue;if(x===0||y===0||x===w-1||y===h-1||!m[i-1]||!m[i+1]||!m[i-w]||!m[i+w])b[i]=1}return b}
// distância simétrica média entre duas fronteiras (px na escala do mapa)
export function symmetricBoundaryDistance(a,b,w,h){
  const ba=borderOf(a,w,h),bb=borderOf(b,w,h),da=chamfer(ba,w,h),db=chamfer(bb,w,h);let s=0,n=0;
  for(let i=0;i<w*h;i++){if(ba[i]){s+=db[i];n++}if(bb[i]){s+=da[i];n++}}
  return n?s/n:0;
}

// |∇| de Sobel sobre suavização 3×3, padronizado (mediana/MAD) — uma borda forte vale o mesmo em qualquer foto
export function gradientMagnitude(F,W,H){
  const sm=new Float32Array(W*H),g=new Float32Array(W*H);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){let s=0,c=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const yy=y+dy,xx=x+dx;if(yy<0||xx<0||yy>=H||xx>=W)continue;s+=F[yy*W+xx];c++}sm[y*W+x]=s/c}
  const at=(x,y)=>sm[Math.min(H-1,Math.max(0,y))*W+Math.min(W-1,Math.max(0,x))];
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const gx=at(x+1,y-1)+2*at(x+1,y)+at(x+1,y+1)-at(x-1,y-1)-2*at(x-1,y)-at(x-1,y+1),gy=at(x-1,y+1)+2*at(x,y+1)+at(x+1,y+1)-at(x-1,y-1)-2*at(x,y-1)-at(x+1,y-1);g[y*W+x]=Math.hypot(gx,gy)}
  const st=[];for(let i=0;i<W*H;i+=Math.max(1,Math.floor(W*H/40000)))st.push(g[i]);st.sort((a,b)=>a-b);const med=st[st.length>>1],mad=Math.max(1e-6,1.4826*st.map(v=>Math.abs(v-med)).sort((a,b)=>a-b)[st.length>>1]);
  for(let i=0;i<W*H;i++)g[i]=(g[i]-med)/mad;return g;
}
// prob: potencial (W×H); feats: planos em z na mesma escala (ex.: [L, rough]); base: limiar inicial.
// Devolve um mapa de limiar por pixel (cada componente com o seu) e o registro do loop.
export function refineContourThresholds(prob,W,H,feats,base,opts={}){
  const o={...CONTOUR_DEFAULTS,...opts},N=W*H,tMap=new Float32Array(N).fill(base),log=[];
  // suporte: componentes com p > support (o limiar de cada um só varia dentro do próprio suporte)
  const sup=new Uint8Array(N);for(let i=0;i<N;i++)sup[i]=prob[i]>o.support?1:0;
  const lab=new Int32Array(N),q=new Int32Array(N);let id=0;
  for(let s=0;s<N;s++){
    if(!sup[s]||lab[s])continue;id++;let hd=0,tl=0,x0=W,y0=H,x1=0,y1=0,pmax=0;q[tl++]=s;lab[s]=id;
    while(hd<tl){const p=q[hd++],y=(p/W)|0,x=p-y*W;if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;if(prob[p]>pmax)pmax=prob[p];
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const yy=y+dy,xx=x+dx;if(yy<0||xx<0||yy>=H||xx>=W)continue;const t=yy*W+xx;if(sup[t]&&!lab[t]){lab[t]=id;q[tl++]=t}}}
    if(tl<o.minArea||pmax<=base)continue;
    const pad=o.ring+3,X0=Math.max(0,x0-pad),Y0=Math.max(0,y0-pad),X1=Math.min(W-1,x1+pad),Y1=Math.min(H-1,y1+pad),w=X1-X0+1,h=Y1-Y0+1,G=(x,y)=>(Y0+y)*W+X0+x;
    const maskAt=t=>{const m=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const g=G(x,y);if(lab[g]===id&&prob[g]>t)m[y*w+x]=1}return m};
    // faixa fixa em torno do contorno inicial (Chan–Vese local): sem viés de encolher ou crescer
    const m0=maskAt(base),bandOut=morph(m0,w,h,o.band,true),bandIn=morph(m0,w,h,o.band,false);
    const J=t=>{const m=maskAt(t);let a=0;for(const v of m)a+=v;if(a<o.minArea)return -Infinity;
      if(o.criterion==="band"){let sse=0,nb=0;
        for(const F of feats){let ni=0,no=0,si=0,so=0,qi=0,qo=0;
          for(let l=0;l<w*h;l++){if(!bandOut[l]||bandIn[l])continue;const v=F[G(l%w,(l/w)|0)];if(m[l]){ni++;si+=v;qi+=v*v}else{no++;so+=v;qo+=v*v}}
          if(ni<4||no<4)return -Infinity;sse+=(qi-si*si/ni)+(qo-so*so/no);nb=ni+no}
        return -sse/(nb*feats.length)}
      if(o.criterion==="edge"){ // média do gradiente sobre a fronteira (contorno ativo por borda)
        const b=borderOf(m,w,h);let n=0,sc=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const l=y*w+x;if(!b[l])continue;n++;const g=G(x,y);for(const F of feats)sc+=F[g]}
        return n?sc/(n*feats.length):-1}
      const inner=morph(m,w,h,o.ring,false),outer=morph(m,w,h,o.ring,true);let score=0;
      for(const F of feats){let ni=0,no=0,si=0,so=0,qi=0,qo=0;
        for(let y=0;y<h;y++)for(let x=0;x<w;x++){const l=y*w+x,v=F[G(x,y)];
          if(m[l]&&!inner[l]){ni++;si+=v;qi+=v*v}else if(outer[l]&&!m[l]){no++;so+=v;qo+=v*v}}
        if(ni<4||no<4)return -1;const mi=si/ni,mo=so/no,vi=Math.max(1e-3,qi/ni-mi*mi),vo=Math.max(1e-3,qo/no-mo*mo);score+=(mi-mo)**2/(vi+vo)}
      return score/feats.length};
    let t=base,jt,step=o.step0,it=0,prev=maskAt(t),dist=null,moves=0;
    const lo=o.maxDelta!=null?Math.max(o.tMin,base-o.maxDelta):o.tMin,hi=o.maxDelta!=null?Math.min(o.tMax,base+o.maxDelta):o.tMax;
    const clampT=v=>Math.min(Math.min(hi,pmax-1e-3),Math.max(lo,v));
    jt=J(t);
    while(step>=o.minStep-1e-9&&it<o.maxIter){
      it++;const tl2=clampT(t-step),th2=clampT(t+step),jl=J(tl2),jh=J(th2);
      let nt=t,nj=jt;if(jl>nj){nt=tl2;nj=jl}if(jh>nj){nt=th2;nj=jh}
      if(nt===t){step/=2;continue}
      const m=maskAt(nt);dist=symmetricBoundaryDistance(prev,m,w,h);prev=m;t=nt;jt=nj;moves++;
      if(dist<o.stopDist&&step<=o.minStep*2)break;
    }
    for(let i=0;i<N;i++)if(lab[i]===id)tMap[i]=t;
    log.push({bbox:[X0,Y0,X1,Y1],threshold:+t.toFixed(3),score:+jt.toFixed(4),iterations:it,moves,last_shift_px:dist==null?0:+dist.toFixed(3)});
  }
  return{tMap,log};
}

// Potencial → máscara na resolução da imagem com limiar por pixel (mapa de limiar em vizinho mais próximo).
export function upsampleWithThresholdMap(prob,tMap,W,H,f,w,h,forbid=[]){
  const out=new Uint8Array(w*h);
  for(let y=0;y<h;y++){const v=Math.min(H-1,Math.max(0,(y+.5)/f-.5)),y0=Math.floor(v),y1=Math.min(H-1,y0+1),fy=v-y0,ny=Math.min(H-1,Math.floor(y/f));
    for(let x=0;x<w;x++){const i=y*w+x;let skip=false;for(const m of forbid)if(m&&m[i]){skip=true;break}if(skip)continue;
      const u=Math.min(W-1,Math.max(0,(x+.5)/f-.5)),x0=Math.floor(u),x1=Math.min(W-1,x0+1),fx=u-x0;
      const pv=(prob[y0*W+x0]*(1-fx)+prob[y0*W+x1]*fx)*(1-fy)+(prob[y1*W+x0]*(1-fx)+prob[y1*W+x1]*fx)*fy;
      if(pv>tMap[ny*W+Math.min(W-1,Math.floor(x/f))])out[i]=1}}
  return out;
}
