// Estudo comparativo "binarização × potencial do walker" (CDM-4): mesma imagem, dois conceitos de corte.
// - Binarização: cada pixel julgado sozinho pela escuridão normalizada (Otsu global).
// - Potencial u: probabilidade de o caminhante chegar primeiro ao polo de dano (Laplace com polos).
// Saídas: mapas de base, perfis ao longo de n linhas de corte, curvas de corte (área e IoU × nível)
// e notas numéricas usadas nas interpretações das figuras. Funções puras (testáveis em Node).

export const CUT_DEFAULTS={sigma:2,bins:1000,poleless:.05,minRun:6,levels:[.3,.5]};

// escuridão normalizada 0..1 (luminância suavizada, cortes p1/p99) — a variável da binarização
export function darknessMap(rgba,w,h,{sigma=CUT_DEFAULTS.sigma}={}){
  const n=w*h;let L=new Float32Array(n);
  for(let i=0,j=0;i<n;i++,j+=4)L[i]=.299*rgba[j]+.587*rgba[j+1]+.114*rgba[j+2];
  const r=Math.max(1,Math.round(sigma));for(let k=0;k<3;k++)L=boxBlur(L,w,h,r); // 3 caixas ≈ gaussiana
  const hist=new Uint32Array(256);for(let i=0;i<n;i++)hist[Math.min(255,Math.max(0,L[i]|0))]++;
  const pct=q=>{let a=0,t=q*n;for(let v=0;v<256;v++){a+=hist[v];if(a>=t)return v}return 255};
  const p1=pct(.01),p99=pct(.99),d=new Float32Array(n),den=Math.max(1,p99-p1);
  for(let i=0;i<n;i++)d[i]=Math.min(1,Math.max(0,(p99-L[i])/den));
  return d;
}
function boxBlur(a,w,h,r){
  const t=new Float32Array(a.length),o=new Float32Array(a.length);
  for(let y=0;y<h;y++){let s=0,row=y*w;for(let x=-r;x<=r;x++)s+=a[row+Math.min(w-1,Math.max(0,x))];
    for(let x=0;x<w;x++){t[row+x]=s/(2*r+1);s+=a[row+Math.min(w-1,x+r+1)]-a[row+Math.max(0,x-r)]}}
  for(let x=0;x<w;x++){let s=0;for(let y=-r;y<=r;y++)s+=t[Math.min(h-1,Math.max(0,y))*w+x];
    for(let y=0;y<h;y++){o[y*w+x]=s/(2*r+1);s+=t[Math.min(h-1,y+r+1)*w+x]-t[Math.max(0,y-r)*w+x]}}
  return o;
}
export function otsu(v,bins=256){
  const hist=new Float64Array(bins);for(const x of v)hist[Math.min(bins-1,Math.max(0,Math.floor(x*bins)))]++;
  let tot=0,sum=0;for(let i=0;i<bins;i++){tot+=hist[i];sum+=i*hist[i]}
  let wB=0,sB=0,best=0,th=.5;
  for(let i=0;i<bins;i++){wB+=hist[i];if(!wB)continue;const wF=tot-wB;if(!wF)break;sB+=i*hist[i];
    const mB=sB/wB,mF=(sum-sB)/wF,b=wB*wF*(mB-mF)**2;if(b>best){best=b;th=(i+1)/bins}}
  return th;
}
// potencial do motor (grade reduzida) → resolução da imagem processada (bilinear)
export function upsamplePotential(rw,w,h){
  const f=rw.f||Math.max(1,Math.round(w/rw.W)),P=rw.prob,u=new Float32Array(w*h);
  for(let y=0;y<h;y++){const v=Math.min(rw.H-1,Math.max(0,(y+.5)/f-.5)),y0=Math.floor(v),y1=Math.min(rw.H-1,y0+1),fy=v-y0;
    for(let x=0;x<w;x++){const s=Math.min(rw.W-1,Math.max(0,(x+.5)/f-.5)),x0=Math.floor(s),x1=Math.min(rw.W-1,x0+1),fx=s-x0;
      u[y*w+x]=(P[y0*rw.W+x0]*(1-fx)+P[y0*rw.W+x1]*fx)*(1-fy)+(P[y1*rw.W+x0]*(1-fx)+P[y1*rw.W+x1]*fx)*fy}}
  return u;
}

export function cutBase(rgba,w,h,rw,{gt=null,levels=CUT_DEFAULTS.levels,mmPerPx=0,metric=null}={}){
  const t0=Date.now(),dark=darknessMap(rgba,w,h),u=upsamplePotential(rw,w,h),th=otsu(dark);
  const tau=rw.threshold??.5,lv=[...new Set([...levels,tau].map(v=>+(+v).toFixed(3)))].filter(v=>v>0&&v<1).sort((a,b)=>a-b);
  let gtN=0;if(gt)for(const v of gt)gtN+=v?1:0;
  const G=gtN>0?gt:null;
  return{w,h,dark,u,otsu:th,tau,levels:lv,gt:G,gtN,mmPerPx:mmPerPx>0?mmPerPx:0,metric:metric||(mmPerPx>0?{kind:"mmpx",scale:{kind:"mmpx",mmPerPx},len:(p,q)=>Math.hypot(q[0]-p[0],q[1]-p[1])*mmPerPx}:null),global:globalStats(dark,u,th,tau,lv,G,w,h),ms:Date.now()-t0};
}

// curvas de corte por histograma: área(v>t) e, com GT, IoU(v>t) para qualquer nível t
function curve(v,gt,bins){
  const all=new Float64Array(bins+1),inG=new Float64Array(bins+1);
  for(let i=0;i<v.length;i++){const b=Math.min(bins,Math.max(0,Math.floor(v[i]*bins)));all[b]++;if(gt&&gt[i])inG[b]++}
  const above=new Float64Array(bins+2),aboveG=new Float64Array(bins+2);
  for(let b=bins;b>=0;b--){above[b]=above[b+1]+all[b];aboveG[b]=aboveG[b+1]+inG[b]}
  return{above,aboveG,bins,n:v.length};
}
function atLevel(C,t,gtN){
  const b=Math.min(C.bins+1,Math.max(0,Math.ceil(t*C.bins))),a=C.above[b],tp=C.aboveG[b];
  return{area:a/C.n,iou:gtN?tp/(a+gtN-tp):null};
}
export function globalStats(dark,u,th,tau,levels,gt,w,h,bins=CUT_DEFAULTS.bins){
  const gtN=gt?gt.reduce((a,v)=>a+(v?1:0),0):0,Cd=curve(dark,gt,bins),Cu=curve(u,gt,bins);
  const ts=[];for(let t=.02;t<.9801;t+=.02)ts.push(+t.toFixed(2));
  const curves={t:ts,binArea:ts.map(t=>atLevel(Cd,t,gtN).area),uArea:ts.map(t=>atLevel(Cu,t,gtN).area),
    binIoU:gtN?ts.map(t=>atLevel(Cd,t,gtN).iou):null,uIoU:gtN?ts.map(t=>atLevel(Cu,t,gtN).iou):null};
  const n=w*h;let inter=0,uni=0,per=0;
  for(let i=0;i<n;i++){const a=dark[i]>th,b=u[i]>tau;if(a&&b)inter++;if(a||b)uni++;
    if(b){const x=i%w;if(x===0||x===w-1||i<w||i>=n-w||!(u[i-1]>tau&&u[i+1]>tau&&u[i-w]>tau&&u[i+w]>tau))per++}}
  const lo=levels[0],hi=levels[levels.length-1],ringPx=(atLevel(Cu,lo,0).area-atLevel(Cu,hi,0).area)*n;
  const at=t=>atLevel(Cu,t,gtN),atB=t=>atLevel(Cd,t,gtN);
  // sensibilidade: variação relativa de área quando o nível sobe 0,1 em torno do corte de cada método
  const sens=(f,t)=>{const a=f(Math.max(.02,t-.05)).area,b=f(Math.min(.98,t+.05)).area;return a>0?(a-b)/a:0};
  const range=arr=>arr?{min:Math.min(...arr),max:Math.max(...arr)}:null;
  const mid=(arr)=>arr?arr.filter((_,i)=>ts[i]>=.3-1e-9&&ts[i]<=.7+1e-9):null;
  return{curves,gtN,
    bin:{threshold:th,near:atB(Math.max(0,th-.05)).area-atB(Math.min(1,th+.05)).area,area:atB(th).area,iou:atB(th).iou,bestIoU:curves.binIoU?Math.max(...curves.binIoU):null,sens:sens(atB,th)},
    walker:{threshold:tau,near:at(Math.max(0,tau-.05)).area-at(Math.min(1,tau+.05)).area,area:at(tau).area,iou:at(tau).iou,bestIoU:curves.uIoU?Math.max(...curves.uIoU):null,sens:sens(at,tau),iouRange:range(mid(curves.uIoU))},
    agreement:uni?inter/uni:1,gtArea:gtN/n,edgeShiftPx:per?ringPx/per:0,levelLo:lo,levelHi:hi};
}

// perfil ao longo de uma linha de corte (coordenadas da imagem processada), passo de 1 px
export function profile(B,line){
  const{x1,y1,x2,y2}=line,len=Math.hypot(x2-x1,y2-y1),m=Math.max(2,Math.round(len)+1),{w,h}=B;
  const s=new Float32Array(m),d=new Float32Array(m),u=new Float32Array(m),g=B.gt?new Uint8Array(m):null,X=new Float32Array(m),Y=new Float32Array(m);
  const bil=(A,x,y)=>{x=Math.min(w-1,Math.max(0,x));y=Math.min(h-1,Math.max(0,y));const x0=Math.floor(x),y0=Math.floor(y),xa=Math.min(w-1,x0+1),ya=Math.min(h-1,y0+1),fx=x-x0,fy=y-y0;
    return(A[y0*w+x0]*(1-fx)+A[y0*w+xa]*fx)*(1-fy)+(A[ya*w+x0]*(1-fx)+A[ya*w+xa]*fx)*fy};
  for(let i=0;i<m;i++){const t=i/(m-1),x=x1+(x2-x1)*t,y=y1+(y2-y1)*t;s[i]=t*len;X[i]=x;Y[i]=y;d[i]=bil(B.dark,x,y);u[i]=bil(B.u,x,y);
    if(g)g[i]=B.gt[Math.min(h-1,Math.max(0,Math.round(y)))*w+Math.min(w-1,Math.max(0,Math.round(x)))]}
  const notes=profileNotes({s,dark:d,u,gt:g},B);
  // mm de cada largura pelos pontos das fronteiras na imagem (homografia: corrige a perspectiva ao longo do corte)
  if(B.metric){const pt=sv=>{const t=len>0?sv/len:0;return[x1+(x2-x1)*t,y1+(y2-y1)*t]};
    for(const r of notes.regions){r.a=pt(r.sL);r.b=pt(r.sR);r.width_mm=B.metric.len(r.a,r.b);const k=r.width>0?r.width_mm/r.width:0;r.min_mm=r.wMin*k;r.max_mm=r.wMax*k}}
  notes.hasScale=!!B.metric;
  return{...line,len,s,dark:d,u,gt:g,X,Y,notes};
}
const runs=(on,s)=>{const r=[];let a=-1;for(let i=0;i<=on.length;i++){const v=i<on.length&&on[i];if(v&&a<0)a=i;if(!v&&a>=0){r.push([a,i-1,s[i-1]-s[a]]);a=-1}}return r};
const crossings=(v,t)=>{let c=0;for(let i=1;i<v.length;i++)if((v[i-1]>t)!==(v[i]>t))c++;return c};
const iou1=(a,b)=>{let i=0,u=0;for(let k=0;k<a.length;k++){if(a[k]&&b[k])i++;if(a[k]||b[k])u++}return u?i/u:null};
// posição (s, interpolada) onde a curva cruza o nível t perto do índice k
function crossAt(v,s,t,k,dir){
  for(let i=k;i>0&&i<v.length;i+=dir){const a=v[i-1],b=v[i];if((a>t)!==(b>t)){const f=(t-a)/(b-a||1e-9);return s[i-1]+(s[i]-s[i-1])*f}}
  return null;
}
export function profileNotes(P,B){
  const{s,dark,u,gt}=P,m=s.length,tau=B.tau,lo=B.levels[0],hi=B.levels[B.levels.length-1],o=CUT_DEFAULTS;
  const binOn=Array.from(dark,v=>v>B.otsu),uOn=Array.from(u,v=>v>tau);
  const uRuns=runs(uOn,s).filter(r=>r[2]>=2),binRuns=runs(binOn,s).filter(r=>r[2]>=2);
  const poleless=runs(Array.from(dark,(v,i)=>v>B.otsu&&u[i]<o.poleless),s).filter(r=>r[2]>=o.minRun);
  // inclinação na borda (|du/ds| máximo em ±4 px do cruzamento de τ)
  const slopes=[];for(const[a,b]of uRuns)for(const k of[a,b]){let g=0;for(let i=Math.max(1,k-4);i<=Math.min(m-1,k+4);i++)g=Math.max(g,Math.abs(u[i]-u[i-1])/(s[i]-s[i-1]||1));slopes.push(g)}
  const plateau=u.reduce((a,v)=>a+(v>.1&&v<.9?1:0),0)/m;
  // larguras: fronteiras em u = τ interpoladas entre pixels; em cada borda, a busca de um nível segue para fora
  // se o pixel da borda já está acima do nível, e para dentro se está abaixo. Faixa = menor e maior largura entre os níveis.
  const edgeAt=(a,b,lv,side)=>{
    if(side<0){if(a===0)return s[0];return u[a]>lv?crossAt(u,s,lv,a,-1):crossAt(u,s,lv,a+1,1)}
    if(b===m-1)return s[m-1];return u[b]>lv?crossAt(u,s,lv,b+1,1):crossAt(u,s,lv,b,-1);
  };
  const shifts=[],regions=uRuns.map(([a,b])=>{
    const sL=edgeAt(a,b,tau,-1)??s[a],sR=edgeAt(a,b,tau,1)??s[b],ws=[sR-sL];
    for(const lv of B.levels){if(Math.abs(lv-tau)<1e-9)continue;const l=edgeAt(a,b,lv,-1),r=edgeAt(a,b,lv,1);ws.push(l==null||r==null||r<=l?0:r-l)}
    const L0=edgeAt(a,b,lo,-1),L1=edgeAt(a,b,hi,-1),R0=edgeAt(a,b,lo,1),R1=edgeAt(a,b,hi,1);
    if(a>0&&L0!=null&&L1!=null&&lo!==hi)shifts.push({at:sL,px:Math.abs(L1-L0),side:"in"});
    if(b<m-1&&R0!=null&&R1!=null&&lo!==hi)shifts.push({at:sR,px:Math.abs(R1-R0),side:"out"});
    return{sL,sR,width:sR-sL,wMin:Math.min(...ws),wMax:Math.max(...ws),open:a===0||b===m-1};
  });
  return{len:s[m-1],binCross:crossings(dark,B.otsu),uCross:crossings(u,tau),binRuns,uRuns,poleless,shifts,regions,
    shiftMean:shifts.length?shifts.reduce((a,x)=>a+x.px,0)/shifts.length:null,shiftMax:shifts.length?Math.max(...shifts.map(x=>x.px)):null,shiftMin:shifts.length?Math.min(...shifts.map(x=>x.px)):null,
    slopeMin:slopes.length?Math.min(...slopes):null,plateau,
    binFrac:binOn.filter(Boolean).length/m,uFrac:uOn.filter(Boolean).length/m,
    iouBin:gt?iou1(binOn,Array.from(gt)):null,iouU:gt?iou1(uOn,Array.from(gt)):null,gtRuns:gt?runs(Array.from(gt,Boolean),s).length:null,lo,hi,tau,otsu:B.otsu};
}

// ---------- interpretações (texto; números no idioma ativo) ----------
const pc=(v,f)=>v==null?"—":f(v*100,1)+" %";
export function interpretMaps(B,f){
  const g=B.global,o=[];
  o.push(["Binarização: cada pixel é julgado sozinho pela escuridão (Otsu {t}); {a} da imagem passa no corte.",{t:f(B.otsu,2),a:pc(g.bin.area,f)}]);
  o.push(["Potencial: o corte u > {tau} mantém {a} da imagem, só regiões ligadas a um polo de dano (princípio do máximo).",{tau:f(B.tau,1),a:pc(g.walker.area,f)}]);
  if(B.gt)o.push(["Contra o GT: IoU da binarização {b}; IoU do walker {u}.",{b:pc(g.bin.iou,f),u:pc(g.walker.iou,f)}]);
  else o.push(["Sem GT: os dois cortes concordam em {a} (IoU de concordância), o que não mede acurácia.",{a:pc(g.agreement,f)}]);
  o.push(["Curvas de nível juntas = encosta íngreme (borda firme); espaçadas = platô, onde o limiar decide a borda.",{}]);
  return o;
}
export function interpretProfile(P,f){
  const N=P.notes,o=[];
  o.push(["Escuridão cruza o corte de Otsu {n} vezes; o potencial cruza τ = {tau} {m} vezes.",{n:N.binCross,m:N.uCross,tau:f(N.tau,1)}]);
  if(N.shiftMean!=null)o.push(["De u = {lo} a {hi}, a borda anda {mean} px em média (máx. {max} px): {verdict}.",{lo:f(N.lo,1),hi:f(N.hi,1),mean:f(N.shiftMean,1),max:f(N.shiftMax,1),verdict:N.shiftMax<=6?"encosta íngreme, borda pouco sensível ao limiar":N.shiftMin<=3?"uma borda é íngreme e outra tem platô, onde o limiar decide a posição":"há platô, o limiar desloca a borda"}]);
  else if(!N.uRuns.length)o.push(["Nenhuma região do walker nesta linha: o potencial fica abaixo de τ em todo o corte.",{}]);
  if(N.poleless.length)o.push(["{k} trecho(s) escuro(s) sem polo ({len} px no total): a binarização marca, o walker fica em u ≈ 0.",{k:N.poleless.length,len:f(N.poleless.reduce((a,r)=>a+r[2],0),0)}]);
  if(N.regions.length){
    const list=N.regions.slice(0,4).map((r,i)=>"R"+(i+1)+" "+widthText(r,f)).join("; ");
    o.push(["Larguras em u = {tau} (faixa entre os níveis {lo} e {hi}): {list}.",{tau:f(N.tau,1),lo:f(N.lo,1),hi:f(N.hi,1),list}]);
    if(N.regions.some(r=>r.open))o.push(["Região que toca a ponta do corte tem largura truncada: prolongue a linha para medir.",{}]);
    if(!N.hasScale)o.push(["Sem calibração de escala, as larguras ficam em pixels (informe mm/px nas configurações).",{}]);
  }
  if(N.iouBin!=null)o.push(["Ao longo da linha, contra o GT: binarização {b}, walker {u}.",{b:pc(N.iouBin,f),u:pc(N.iouU,f)}]);
  return o;
}
export function interpretCurves(B,f){
  const g=B.global,o=[];
  o.push(["Subindo o nível em 0,1 em torno de cada corte, a área da binarização cai {b} e a do walker {u}.",{b:pc(g.bin.sens,f),u:pc(g.walker.sens,f)}]);
  if(B.gt){
    o.push(["Melhor IoU possível: binarização {b} em qualquer limiar; walker {u}.",{b:pc(g.bin.bestIoU,f),u:pc(g.walker.bestIoU,f)}]);
    if(g.walker.iouRange)o.push(["Com t entre 0,3 e 0,7, a IoU do walker fica entre {a} e {b}: o resultado não depende de um ajuste fino do limiar.",{a:pc(g.walker.iouRange.min,f),b:pc(g.walker.iouRange.max,f)}]);
  }else{
    o.push(["Pixels a até 0,05 do corte: binarização {b} da imagem, walker {u}; quanto menos pixels no nível do corte, mais estável a borda.",{b:pc(g.bin.near,f),u:pc(g.walker.near,f)}]);
    o.push(["Anote o desplacamento (GT) para ver a IoU em cada nível.",{}]);
  }
  o.push(["Entre u = {lo} e {hi}, a borda do walker anda {px} px em média em todo o contorno.",{lo:f(g.levelLo,1),hi:f(g.levelHi,1),px:f(g.edgeShiftPx,1)}]);
  return o;
}

// texto de uma largura: "212,4 px (205,1–219,0)" e, com escala, "· 106,2 mm (102,6–109,5)"
export function widthText(r,f){
  const px=`${f(r.width,1)} px (${f(r.wMin,1)}–${f(r.wMax,1)})`+(r.open?" *":"");
  return r.width_mm!=null?px+` · ${f(r.width_mm,1)} mm (${f(r.min_mm,1)}–${f(r.max_mm,1)})`:px;
}
// todas as medidas em linhas (CSV e figura de tabela); coordenadas na imagem processada
export function measureRows(P,labelOf=i=>String.fromCharCode(65+i)){
  const rows=[];
  P.forEach((p,ci)=>p.notes.regions.forEach((r,ri)=>{
    const pt=sv=>{const t=p.len>0?sv/p.len:0;return[p.x1+(p.x2-p.x1)*t,p.y1+(p.y2-p.y1)*t]};
    const a=pt(r.sL),b=pt(r.sR);
    rows.push({cut:labelOf(ci),region:"R"+(ri+1),x1:a[0],y1:a[1],x2:b[0],y2:b[1],width_px:r.width,min_px:r.wMin,max_px:r.wMax,
      width_mm:r.width_mm??null,min_mm:r.min_mm??null,max_mm:r.max_mm??null,open:r.open,tau:p.notes.tau,level_lo:p.notes.lo,level_hi:p.notes.hi});
  }));
  return rows;
}
export function measuresCsv(rows,scaleLabel=""){
  const h=["corte","regiao","x_inicio_px","y_inicio_px","x_fim_px","y_fim_px","largura_px","faixa_min_px","faixa_max_px","largura_mm","faixa_min_mm","faixa_max_mm","truncada","tau","nivel_baixo","nivel_alto","escala"];
  const n=v=>v==null?"":(+v).toFixed(2);
  return[h.join(";"),...rows.map(r=>[r.cut,r.region,n(r.x1),n(r.y1),n(r.x2),n(r.y2),n(r.width_px),n(r.min_px),n(r.max_px),n(r.width_mm),n(r.min_mm),n(r.max_mm),r.open?"sim":"nao",r.tau,r.level_lo,r.level_hi,scaleLabel].join(";"))].join("\n")+"\n";
}
