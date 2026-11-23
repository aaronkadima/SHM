// Largura de fissura por perfil de intensidade perpendicular ao eixo (CDM-4 · Corte de nível, modo Fissura).
// O usuário traça o eixo ao longo da fissura; a cada `step` px, um perfil perpendicular de ±R px (média de 3 linhas
// paralelas, amostragem a 0,25 px) é analisado: fundo = mediana das pontas do perfil, vale = mínimo próximo do eixo,
// largura FWHM = distância entre os pontos em que a intensidade volta à meia profundidade (interpolada entre amostras),
// largura equivalente = área do vale ÷ profundidade. Uma fissura mais estreita que ~3 px fica abaixo da resolução:
// o borramento da óptica alarga o vale e a FWHM superestima a abertura real.
export const CRACK_DEFAULTS={R:20,step:2,ds:.25,minDepth:8,depthMad:3,bgFrom:.6,resolutionPx:3,searchFrac:.6};

export function grayOf(rgba,w,h){const g=new Float32Array(w*h);for(let i=0,j=0;i<w*h;i++,j+=4)g[i]=.299*rgba[j]+.587*rgba[j+1]+.114*rgba[j+2];return g}
function bil(g,w,h,x,y){x=Math.min(w-1,Math.max(0,x));y=Math.min(h-1,Math.max(0,y));const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),fx=x-x0,fy=y-y0;
  return(g[y0*w+x0]*(1-fx)+g[y0*w+x1]*fx)*(1-fy)+(g[y1*w+x0]*(1-fx)+g[y1*w+x1]*fx)*fy}
const median=a=>{const v=[...a].sort((p,q)=>p-q);const n=v.length;return n?(n%2?v[(n-1)/2]:(v[n/2-1]+v[n/2])/2):0};

// um perfil: d = deslocamento perpendicular (px), I = intensidade
export function analyzeProfile(d,I,o=CRACK_DEFAULTS){
  const n=d.length,R=Math.max(Math.abs(d[0]),Math.abs(d[n-1]));
  const bgS=[];for(let i=0;i<n;i++)if(Math.abs(d[i])>=o.bgFrom*R)bgS.push(I[i]);
  const bg=median(bgS),mad=median(bgS.map(v=>Math.abs(v-bg)))*1.4826;
  let k=-1,mn=Infinity;for(let i=0;i<n;i++)if(Math.abs(d[i])<=o.searchFrac*R&&I[i]<mn){mn=I[i];k=i}
  const depth=bg-mn;
  if(k<0||depth<Math.max(o.minDepth,o.depthMad*mad))return{valid:false,bg,depth,center:k<0?0:d[k]};
  const half=mn+depth/2;
  let l=null,r=null;
  for(let i=k;i>0;i--)if(I[i-1]>=half){l=d[i-1]+(d[i]-d[i-1])*(half-I[i-1])/(I[i]-I[i-1]||1e-9);break}
  for(let i=k;i<n-1;i++)if(I[i+1]>=half){r=d[i]+(d[i+1]-d[i])*(half-I[i])/(I[i+1]-I[i]||1e-9);break}
  if(l==null||r==null)return{valid:false,bg,depth,center:d[k]};
  // largura equivalente: área do déficit de luz no vale (até voltar a 90 % do fundo) ÷ profundidade
  let a=k,b=k;const back=bg-.1*depth;while(a>0&&I[a]<back)a--;while(b<n-1&&I[b]<back)b++;
  let area=0;for(let i=a;i<b;i++)area+=((bg-I[i])+(bg-I[i+1]))/2*(d[i+1]-d[i]);
  return{valid:true,bg,depth,min:mn,center:d[k],left:l,right:r,fwhm:r-l,eq:area/depth};
}

// eixo traçado (x1,y1)→(x2,y2) na imagem processada; devolve as estações e o resumo
export function crackWidth(gray,w,h,axis,opts={}){
  const o={...CRACK_DEFAULTS,...opts},{x1,y1,x2,y2}=axis,L=Math.hypot(x2-x1,y2-y1);
  if(L<2)return{stations:[],summary:null,axis,len:L};
  const tx=(x2-x1)/L,ty=(y2-y1)/L,nx=-ty,ny=tx,K=Math.max(1,Math.floor(L/o.step)),m=Math.round(2*o.R/o.ds)+1;
  const d=new Float32Array(m);for(let i=0;i<m;i++)d[i]=-o.R+i*o.ds;
  const stations=[],sumI=new Float64Array(m),cnt=new Float64Array(m);
  for(let k=0;k<=K;k++){
    const s=Math.min(L,k*o.step),cx=x1+tx*s,cy=y1+ty*s,I=new Float32Array(m);
    for(let i=0;i<m;i++){let v=0;for(const t of[-.5,0,.5])v+=bil(gray,w,h,cx+nx*d[i]+tx*t,cy+ny*d[i]+ty*t);I[i]=v/3}
    const P=analyzeProfile(d,I,o);
    const st={s,x:cx,y:cy,...P};
    if(P.valid){st.lx=cx+nx*P.left;st.ly=cy+ny*P.left;st.rx=cx+nx*P.right;st.ry=cy+ny*P.right;
      // perfil médio alinhado no mínimo do vale (para a figura)
      const sh=Math.round(P.center/o.ds);for(let i=0;i<m;i++){const j=i+sh;if(j>=0&&j<m){sumI[i]+=I[j]-P.bg;cnt[i]++}}}
    stations.push(st);
  }
  const ok=stations.filter(s=>s.valid),q=(a,p)=>{const v=[...a].sort((x,y)=>x-y);return v.length?v[Math.min(v.length-1,Math.floor(p*(v.length-1)+.5))]:null};
  const fw=ok.map(s=>s.fwhm),eq=ok.map(s=>s.eq);
  const mean=new Float32Array(m);for(let i=0;i<m;i++)mean[i]=cnt[i]?sumI[i]/cnt[i]:0;
  const summary=ok.length?{n:stations.length,valid:ok.length,median:q(fw,.5),p10:q(fw,.1),p90:q(fw,.9),max:Math.max(...fw),eqMedian:q(eq,.5),
    depthMedian:q(ok.map(s=>s.depth),.5),belowResolution:q(fw,.5)<o.resolutionPx}:{n:stations.length,valid:0};
  return{axis,len:L,stations,summary,profile:{d:Array.from(d),I:Array.from(mean)},opts:o};
}

// mm por perfil: largura FWHM convertida pelos pontos das bordas (homografia corrige a perspectiva local)
export function applyCrackMetric(K,metric){
  if(!metric||!K.summary?.valid)return K;
  const mm=[],eq=[];
  for(const s of K.stations)if(s.valid){s.fwhm_mm=metric.len([s.lx,s.ly],[s.rx,s.ry]);s.eq_mm=s.fwhm>0?s.eq*s.fwhm_mm/s.fwhm:null;mm.push(s.fwhm_mm);if(s.eq_mm!=null)eq.push(s.eq_mm)}
  const q=(a,p)=>{const v=[...a].sort((x,y)=>x-y);return v.length?v[Math.min(v.length-1,Math.floor(p*(v.length-1)+.5))]:null};
  K.summary.mm={median:q(mm,.5),p10:q(mm,.1),p90:q(mm,.9),max:Math.max(...mm),eqMedian:q(eq,.5)};
  return K;
}
