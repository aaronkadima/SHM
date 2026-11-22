// CDM-4 · random walker de Grady (2006) para o contorno do desplacamento.
//
// Analogia física: a foto é uma rede de resistores entre pixels vizinhos; a condutância cai com a
// diferença de cor e de diversidade local (Shannon de Ataky). Os polos são fixados por regras do
// próprio CDM: núcleo do desplacamento detectado = potencial 1 (dano); concreto longe de qualquer
// candidato, ou homogêneo (Shannon baixo) e longe do desplacamento = potencial 0 (saudável).
// O potencial de equilíbrio (equação de Laplace, ∇·(c∇u)=0) é a probabilidade de o pixel pertencer
// ao dano. Sem treino, sem aleatoriedade: mesma entrada ⇒ mesma saída (CG com pré-condicionador de
// Jacobi, tolerância e número de iterações fixos). Mesmas equações de skimage.segmentation.random_walker
// (beta/(10·σ·√C), vizinhança 4, ε = 1e-10).
//
// Validação (foto 24, GT do autor): IoU do desplacamento 26,6 % (CDM 2.11) → 69,5 % (p > 0,3).

export const RW_DEFAULTS={maxGrowPx:null,scale:2,beta:30,threshold:.3,shannonWin:11,healthyFarPx:10,healthyShannonZ:-.5,siteGuardPx:10,tol:1e-3,maxIter:3000};

function sortedCopy(a){return Float32Array.from(a).sort()}
function medianOf(s){const n=s.length;if(!n)return 0;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2}
function robustZ(a){
  const s=sortedCopy(a),m=medianOf(s),d=new Float32Array(a.length);
  for(let i=0;i<a.length;i++)d[i]=Math.abs(a[i]-m);
  let mad=1.4826*medianOf(d.sort());
  // canal quase constante (MAD ≈ 0): usa o desvio-padrão para não explodir a escala
  if(mad<1e-3){let m1=0,m2=0;for(let i=0;i<a.length;i++){m1+=a[i];m2+=a[i]*a[i]}m1/=a.length;mad=Math.sqrt(Math.max(0,m2/a.length-m1*m1))}
  mad+=1e-6;const out=new Float32Array(a.length);
  for(let i=0;i<a.length;i++)out[i]=(a[i]-m)/mad;
  return out;
}
function percentile(s,p){const i=p/100*(s.length-1),lo=Math.floor(i),hi=Math.ceil(i);return s[lo]+(s[hi]-s[lo])*(i-lo)}
// morfologia binária quadrada separável; borda = 0 (como scipy.ndimage)
function binMorph(src,w,h,k,isMax){
  const r=k>>1,tmp=new Uint8Array(w*h),out=new Uint8Array(w*h);
  for(let y=0;y<h;y++){const row=y*w;
    for(let x=0;x<w;x++){let v=isMax?0:1;
      for(let d=-r;d<=r;d++){const xx=x+d;const s=xx<0||xx>=w?0:src[row+xx];if(isMax?s:!s){v=isMax?1:0;break}}
      tmp[row+x]=v}}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=isMax?0:1;
    for(let d=-r;d<=r;d++){const yy=y+d;const s=yy<0||yy>=h?0:tmp[yy*w+x];if(isMax?s:!s){v=isMax?1:0;break}}
    out[y*w+x]=v}
  return out;
}
// entropia de Shannon (bits) das espécies numa janela k×k; fora da imagem não conta (skimage.filters.rank)
function shannonRank(sp,w,h,k,nSpecies){
  const r=k>>1,out=new Float32Array(w*h),hist=new Int32Array(nSpecies),clog=new Float64Array(k*(k+1)+2);// a janela tem k+1 colunas entre a entrada e a saída
  for(let c=1;c<clog.length;c++)clog[c]=c*Math.log2(c);
  for(let y=0;y<h;y++){
    const y0=Math.max(0,y-r),y1=Math.min(h-1,y+r);hist.fill(0);let N=0,S=0;
    const add=(x,sgn)=>{for(let yy=y0;yy<=y1;yy++){const s=sp[yy*w+x],c=hist[s];S+=clog[c+sgn]-clog[c];hist[s]=c+sgn;N+=sgn}};
    for(let x=0;x<=Math.min(w-1,r);x++)add(x,1);
    for(let x=0;x<w;x++){
      if(x>0){if(x+r<w)add(x+r,1);if(x-r-1>=0)add(x-r-1,-1)}
      out[y*w+x]=N>0?Math.log2(N)-S/N:0;
    }
  }
  return out;
}
const nearestIdx=(i,from,to)=>Math.min(from-1,Math.floor((i+.5)*from/to));
function downMask(m,w,h,W,H){
  const o=new Uint8Array(W*H);if(!m)return o;
  for(let y=0;y<H;y++){const sy=nearestIdx(y,h,H)*w;for(let x=0;x<W;x++)o[y*W+x]=m[sy+nearestIdx(x,w,W)]?1:0}
  return o;
}

// Probabilidade de dano por pixel (resolução reduzida) a partir de polos dano/saudável.
export function randomWalkerProbability(rgba,w,h,{site,integrated,opts={}}){
  const o={...RW_DEFAULTS,...opts},f=Math.max(1,Math.round(o.scale)),W=Math.max(1,Math.floor(w/f)),H=Math.max(1,Math.floor(h/f)),N=W*H;
  // redução f× com filtro triangular separável (equivalente ao BILINEAR com antialias do Pillow)
  const taps=[];for(let i=0;i<Math.max(W,H);i++){const c=(i+.5)*f,lo=Math.floor(c-f),hi=Math.ceil(c+f),t=[];let s=0;for(let j=lo;j<=hi;j++){const wt=Math.max(0,1-Math.abs(j+.5-c)/f);if(wt>0){t.push([j,wt]);s+=wt}}taps.push(t.map(([j,wt])=>[j,wt/s]))}
  const resample=ch=>{const tmp=new Float32Array(W*h),out=new Float32Array(N);
    for(let y=0;y<h;y++)for(let x=0;x<W;x++){let v=0;for(const[j,wt]of taps[x])v+=wt*rgba[4*(y*w+Math.min(w-1,Math.max(0,j)))+ch];tmp[y*W+x]=v}
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){let v=0;for(const[j,wt]of taps[y])v+=wt*tmp[Math.min(h-1,Math.max(0,j))*W+x];out[y*W+x]=Math.round(Math.min(255,Math.max(0,v)))}
    return out};
  const Rc=resample(0),Gc=resample(1),Bc=resample(2),L=new Float32Array(N),o1=new Float32Array(N),o2=new Float32Array(N);
  for(let i=0;i<N;i++){const r=Rc[i],g=Gc[i],b=Bc[i];L[i]=.299*r+.587*g+.114*b;o1[i]=r-g;o2[i]=(r+g)/2-b}
  // espécies de Ataky: 8 níveis de luminância × (6 matizes + acromático)
  const Ls=sortedCopy(L),p1=percentile(Ls,1),p99=percentile(Ls,99),sp=new Uint8Array(N);
  for(let i=0;i<N;i++){
    const q=Math.floor(Math.min(.999,Math.max(0,(L[i]-p1)/Math.max(1e-6,p99-p1)))*8);
    let hb=0;if(Math.hypot(o1[i],o2[i])>=12){let a=Math.atan2(o2[i],o1[i]);if(a<0)a+=2*Math.PI;hb=Math.min(6,Math.floor(a/(2*Math.PI)*6)+1)}
    sp[i]=q*7+hb;
  }
  const Hs=shannonRank(sp,W,H,o.shannonWin,56);
  const X=[robustZ(L),robustZ(o1),robustZ(o2),robustZ(Hs)],C=X.length;
  // polos
  const S=downMask(site,w,h,W,H),I=downMask(integrated||site,w,h,W,H);
  const dmg=binMorph(S,W,H,3,false);
  const farK=2*o.healthyFarPx+1,guardK=2*o.siteGuardPx+1;
  const nearI=binMorph(I,W,H,farK,true),nearS=binMorph(S,W,H,guardK,true);
  const label=new Int8Array(N);let nd=0,nh=0;// 0 = livre, 1 = saudável, 2 = dano
  for(let i=0;i<N;i++){
    if(dmg[i]){label[i]=2;nd++;continue}
    if(!nearI[i]||(X[3][i]<o.healthyShannonZ&&!nearS[i])){label[i]=1;nh++}
  }
  if(!nd||!nh)return{prob:null,W,H,f,seeds:{damage:nd,healthy:nh},iterations:0,converged:false};
  const S2=solveWalker(X,W,H,label,o);
  return{prob:S2.prob,W,H,f,seeds:{damage:nd,healthy:nh},iterations:S2.iterations,converged:S2.converged};
}

// Solver comum: X = planos de característica, label: 0 livre, 1 saudável, 2 dano.
export function solveWalker(X,W,H,label,o){
  const N=W*H,C=X.length;
  // condutâncias (vizinhos à direita e abaixo), escala igual ao skimage
  let sum=0,sum2=0;for(const a of X)for(let i=0;i<N;i++){sum+=a[i];sum2+=a[i]*a[i]}
  const mean=sum/(C*N),std=Math.sqrt(Math.max(1e-12,sum2/(C*N)-mean*mean));
  const scale=-o.beta/(10*std)/Math.sqrt(C),wr=new Float32Array(N),wd=new Float32Array(N);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;
    if(x<W-1){let g=0;for(const a of X){const d=a[i+1]-a[i];g+=d*d}wr[i]=Math.exp(scale*g)+1e-10}
    if(y<H-1){let g=0;for(const a of X){const d=a[i+W]-a[i];g+=d*d}wd[i]=Math.exp(scale*g)+1e-10}
  }
  // sistema L_uu x = b (b = condutância para polos de dano); PCG Jacobi
  const deg=new Float64Array(N),b=new Float64Array(N);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;
    if(x<W-1){deg[i]+=wr[i];deg[i+1]+=wr[i]}
    if(y<H-1){deg[i]+=wd[i];deg[i+W]+=wd[i]}
  }
  const free=new Uint8Array(N);for(let i=0;i<N;i++)free[i]=label[i]===0?1:0;
  const nb=(i,fn)=>{const y=(i/W)|0,x=i-y*W;if(x>0)fn(i-1,wr[i-1]);if(x<W-1)fn(i+1,wr[i]);if(y>0)fn(i-W,wd[i-W]);if(y<H-1)fn(i+W,wd[i])};
  for(let i=0;i<N;i++)if(free[i])nb(i,(j,c)=>{if(label[j]===2)b[i]+=c});
  const xs=new Float64Array(N),r=new Float64Array(N),z=new Float64Array(N),p=new Float64Array(N),Ap=new Float64Array(N);
  const mul=(v,out)=>{for(let i=0;i<N;i++){if(!free[i]){out[i]=0;continue}let s=deg[i]*v[i];const y=(i/W)|0,x=i-y*W;
    if(x>0&&free[i-1])s-=wr[i-1]*v[i-1];if(x<W-1&&free[i+1])s-=wr[i]*v[i+1];if(y>0&&free[i-W])s-=wd[i-W]*v[i-W];if(y<H-1&&free[i+W])s-=wd[i]*v[i+W];out[i]=s}};
  let bn=0;for(let i=0;i<N;i++)if(free[i]){r[i]=b[i];bn+=b[i]*b[i]}bn=Math.sqrt(bn)||1;
  let rz=0;for(let i=0;i<N;i++)if(free[i]){z[i]=r[i]/deg[i];p[i]=z[i];rz+=r[i]*z[i]}
  let it=0,converged=false;
  for(;it<o.maxIter;it++){
    let rn=0;for(let i=0;i<N;i++)if(free[i])rn+=r[i]*r[i];
    if(Math.sqrt(rn)<=o.tol*bn){converged=true;break}
    mul(p,Ap);let pAp=0;for(let i=0;i<N;i++)if(free[i])pAp+=p[i]*Ap[i];
    if(!(pAp>0))break;const alpha=rz/pAp;
    for(let i=0;i<N;i++)if(free[i]){xs[i]+=alpha*p[i];r[i]-=alpha*Ap[i]}
    let rz2=0;for(let i=0;i<N;i++)if(free[i]){z[i]=r[i]/deg[i];rz2+=r[i]*z[i]}
    const beta=rz2/rz;rz=rz2;for(let i=0;i<N;i++)if(free[i])p[i]=z[i]+beta*p[i];
  }
  const prob=new Float32Array(N);
  for(let i=0;i<N;i++)prob[i]=label[i]===2?1:label[i]===1?0:Math.min(1,Math.max(0,xs[i]));
  return{prob,iterations:it,converged};
}
// Walker a partir de polos já definidos (fluxo por evidência).
export function walkerFromSeeds(planes,W,H,damage,healthy,opts={}){
  const o={...RW_DEFAULTS,...opts},N=W*H,label=new Int8Array(N);let nd=0,nh=0;
  for(let i=0;i<N;i++){if(damage[i]){label[i]=2;nd++}else if(healthy[i]){label[i]=1;nh++}}
  if(!nd||!nh)return{prob:null,seeds:{damage:nd,healthy:nh},iterations:0,converged:false};
  const X=planes.map(robustZ),S=solveWalker(X,W,H,label,o);
  return{...S,seeds:{damage:nd,healthy:nh}};
}

// Máscara final de desplacamento (resolução da imagem): probabilidade > limiar, fora da exclusão.
export function randomWalkerSpalling(rgba,w,h,{site,integrated,exclusion=null,forbid=null,opts={}}){
  const o={...RW_DEFAULTS,...opts},t0=Date.now();
  if(!site||!site.some(v=>v))return{mask:null,log:{applied:false,reason:"sem núcleo de desplacamento"}};
  const R=randomWalkerProbability(rgba,w,h,{site,integrated,opts:o});
  if(!R.prob)return{mask:null,log:{applied:false,reason:"polos insuficientes",seeds:R.seeds}};
  const{prob,W,H,f}=R,out=new Uint8Array(w*h);let area=0;
  // limite de crescimento: o potencial só pode ocupar até maxGrowPx além da máscara morfológica
  let allowed=null;
  if(o.maxGrowPx>0){const u=new Uint8Array(w*h),I=integrated||site;for(let i=0;i<w*h;i++)u[i]=site[i]||I[i]?1:0;allowed=binMorph(u,w,h,2*o.maxGrowPx+1,true)}
  for(let y=0;y<h;y++){
    const v=Math.min(H-1,Math.max(0,(y+.5)/f-.5)),y0=Math.floor(v),y1=Math.min(H-1,y0+1),fy=v-y0;
    for(let x=0;x<w;x++){
      const i=y*w+x;if((exclusion&&exclusion[i])||(forbid&&forbid[i])||(allowed&&!allowed[i]))continue;
      const u=Math.min(W-1,Math.max(0,(x+.5)/f-.5)),x0=Math.floor(u),x1=Math.min(W-1,x0+1),fx=u-x0;
      const pv=(prob[y0*W+x0]*(1-fx)+prob[y0*W+x1]*fx)*(1-fy)+(prob[y1*W+x0]*(1-fx)+prob[y1*W+x1]*fx)*fy;
      if(pv>o.threshold){out[i]=1;area++}
    }
  }
  return{mask:out,prob,W,H,log:{applied:true,threshold:o.threshold,max_grow_px:o.maxGrowPx||null,beta:o.beta,scale:f,seeds:R.seeds,iterations:R.iterations,converged:R.converged,area_px:area,ms:Date.now()-t0}};
}
