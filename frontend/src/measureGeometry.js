// Geometria de medição: escala (mm/px único ou homografia por 4 pontos), componentes por clique e
// menor distância entre dois contornos. Coordenadas sempre em pixels da imagem processada.

// ---------- homografia (DLT com 4 pares de pontos) ----------
function solve(A,b){ // eliminação de Gauss com pivotamento parcial
  const n=b.length,M=A.map((r,i)=>[...r,b[i]]);
  for(let c=0;c<n;c++){let p=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;[M[c],M[p]]=[M[p],M[c]];
    if(Math.abs(M[c][c])<1e-12)return null;for(let r=0;r<n;r++){if(r===c)continue;const f=M[r][c]/M[c][c];for(let k=c;k<=n;k++)M[r][k]-=f*M[c][k]}}
  return M.map((r,i)=>r[n]/r[i]);
}
// src: 4 pontos na imagem; dst: os mesmos 4 no plano métrico (mm). Devolve H (3×3, linha a linha) com H·src = dst
export function homography(src,dst){
  const A=[],b=[];
  for(let i=0;i<4;i++){const[x,y]=src[i],[u,v]=dst[i];
    A.push([x,y,1,0,0,0,-u*x,-u*y]);b.push(u);A.push([0,0,0,x,y,1,-v*x,-v*y]);b.push(v)}
  const h=solve(A,b);return h?[h[0],h[1],h[2],h[3],h[4],h[5],h[6],h[7],1]:null;
}
export function applyH(H,x,y){const w=H[6]*x+H[7]*y+H[8];return[(H[0]*x+H[1]*y+H[2])/w,(H[3]*x+H[4]*y+H[5])/w]}
export function invertH(H){
  const[a,b,c,d,e,f,g,h,i]=H,A=e*i-f*h,B=-(d*i-f*g),C=d*h-e*g,det=a*A+b*B+c*C;if(Math.abs(det)<1e-15)return null;
  return[A/det,-(b*i-c*h)/det,(b*f-c*e)/det,B/det,(a*i-c*g)/det,-(a*f-c*d)/det,C/det,-(a*h-b*g)/det,(a*e-b*d)/det];
}
// quadrilátero convexo e não degenerado (cantos em ordem)
export function quadOk(q){if(!q||q.length!==4)return false;let s=0;for(let i=0;i<4;i++){const[a,b]=q[i],[c,d]=q[(i+1)%4],[e,f]=q[(i+2)%4];const z=(c-a)*(f-d)-(d-b)*(e-c);if(Math.abs(z)<1)return false;s+=Math.sign(z)}return Math.abs(s)===4}

// ---------- métrica: converte segmentos da imagem em mm ----------
// scale = {kind:"homography", quad:[[x,y]×4], wmm, hmm} | {kind:"mmpx", mmPerPx}
export function makeMetric(scale){
  if(scale?.kind==="homography"&&quadOk(scale.quad)&&scale.wmm>0&&scale.hmm>0){
    const dst=[[0,0],[scale.wmm,0],[scale.wmm,scale.hmm],[0,scale.hmm]],H=homography(scale.quad,dst);
    if(H){const map=(x,y)=>applyH(H,x,y);
      return{kind:"homography",H,Hinv:invertH(H),map,len:(p,q)=>{const a=map(p[0],p[1]),b=map(q[0],q[1]);return Math.hypot(b[0]-a[0],b[1]-a[1])},
        // escala local (mm por px) num ponto: média das direções x e y
        mmPerPxAt:(x,y)=>{const a=map(x,y),b=map(x+1,y),c=map(x,y+1);return(Math.hypot(b[0]-a[0],b[1]-a[1])+Math.hypot(c[0]-a[0],c[1]-a[1]))/2},scale}}
  }
  if(scale?.kind==="mmpx"&&scale.mmPerPx>0){const k=scale.mmPerPx;return{kind:"mmpx",map:(x,y)=>[x*k,y*k],len:(p,q)=>Math.hypot(q[0]-p[0],q[1]-p[1])*k,mmPerPxAt:()=>k,scale}}
  return null;
}
// variação da escala local dentro do quadrilátero (indicador de perspectiva)
export function scaleSpread(metric,quad,n=8){
  if(!metric||metric.kind!=="homography")return null;const v=[];
  const lerp=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
  for(let i=0;i<=n;i++)for(let j=0;j<=n;j++){const top=lerp(quad[0],quad[1],i/n),bot=lerp(quad[3],quad[2],i/n),p=lerp(top,bot,j/n);v.push(metric.mmPerPxAt(p[0],p[1]))}
  const mn=Math.min(...v),mx=Math.max(...v);return{min:mn,max:mx,spread:(mx-mn)/((mx+mn)/2)};
}

// ---------- componentes e contornos ----------
// armadura primeiro (fica dentro do desplacamento e só é clicada de propósito); fissura por último: uma "fissura" detectada dentro
// do desplacamento não deve roubar o clique de quem quer o desplacamento
export const PICK_ORDER=["exposed_rebar","spalling_dark","corrosion_rust","efflorescence_white","cracks"];
function flood(mask,w,h,seed){
  const n=w*h,comp=new Uint8Array(n),q=new Int32Array(n);let hd=0,tl=0,x0=w,y0=h,x1=0,y1=0;q[tl++]=seed;comp[seed]=1;
  while(hd<tl){const p=q[hd++],y=(p/w)|0,x=p-y*w;if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const yy=y+dy,xx=x+dx;if(yy<0||xx<0||yy>=h||xx>=w)continue;const j=yy*w+xx;if(mask[j]&&!comp[j]){comp[j]=1;q[tl++]=j}}}
  return{comp,area:tl,bbox:[x0,y0,x1,y1]};
}
// componente sob o clique (ou o mais próximo num raio), pela ordem de prioridade das classes
export function pickComponent(masks,w,h,x,y,radius=20){
  const xi=Math.round(x),yi=Math.round(y),classes=PICK_ORDER.filter(c=>masks[c]instanceof Uint8Array&&masks[c].length===w*h);
  for(const c of classes){const i=yi*w+xi;if(xi>=0&&yi>=0&&xi<w&&yi<h&&masks[c][i])return{cls:c,...flood(masks[c],w,h,i),click:[x,y],distance:0}}
  let best=null;
  for(let r=1;r<=radius&&!best;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){if(Math.max(Math.abs(dx),Math.abs(dy))!==r)continue;const xx=xi+dx,yy=yi+dy;if(xx<0||yy<0||xx>=w||yy>=h)continue;
    const d=Math.hypot(dx,dy);for(const c of classes)if(masks[c][yy*w+xx]&&(!best||d<best.d||(d===best.d&&classes.indexOf(c)<classes.indexOf(best.c))))best={c,i:yy*w+xx,d}}
  return best?{cls:best.c,...flood(masks[best.c],w,h,best.i),click:[x,y],distance:best.d}:null;
}
export function boundary(comp,w,h,bbox){
  const pts=[],[x0,y0,x1,y1]=bbox;
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const i=y*w+x;if(!comp[i])continue;
    if(x===0||y===0||x===w-1||y===h-1||!comp[i-1]||!comp[i+1]||!comp[i-w]||!comp[i+w])pts.push([x,y])}
  return pts;
}
// menor distância entre dois contornos: nos pixels de borda, medida no plano métrico quando há homografia
// (a distância mínima em perspectiva não é a mesma da imagem). Grade de busca para não ser O(n·m) puro.
export function minDistance(A,B,w,h,metric=null){
  let overlap=false;const[ax0,ay0,ax1,ay1]=A.bbox;
  for(let y=ay0;y<=ay1&&!overlap;y++)for(let x=ax0;x<=ax1;x++){const i=y*w+x;if(A.comp[i]&&B.comp[i]){overlap=true;break}}
  const pa=boundary(A.comp,w,h,A.bbox),pb=boundary(B.comp,w,h,B.bbox);if(!pa.length||!pb.length)return null;
  const useH=metric?.kind==="homography",tr=p=>useH?metric.map(p[0],p[1]):p;
  const ta=pa.map(tr),tb=pb.map(tr);
  // grade sobre B no espaço da medida
  let mnx=Infinity,mny=Infinity,mxx=-Infinity,mxy=-Infinity;for(const[x,y]of tb){if(x<mnx)mnx=x;if(y<mny)mny=y;if(x>mxx)mxx=x;if(y>mxy)mxy=y}
  const cell=Math.max(1e-6,Math.sqrt(((mxx-mnx+1)*(mxy-mny+1))/Math.max(1,tb.length))*2),grid=new Map(),key=(i,j)=>i+","+j;
  tb.forEach((p,k)=>{const g=key(Math.floor((p[0]-mnx)/cell),Math.floor((p[1]-mny)/cell));(grid.get(g)||grid.set(g,[]).get(g)).push(k)});
  const gw=Math.ceil((mxx-mnx+1)/cell)+1,gh=Math.ceil((mxy-mny+1)/cell)+1;
  let best=Infinity,bi=-1,bj=-1;
  ta.forEach((p,i)=>{const ci=Math.floor((p[0]-mnx)/cell),cj=Math.floor((p[1]-mny)/cell);
    for(let r=0;r<=Math.max(gw,gh)+Math.abs(ci)+Math.abs(cj);r++){
      if((r-1)*cell>best)break;
      for(let di=-r;di<=r;di++)for(let dj=-r;dj<=r;dj++){if(Math.max(Math.abs(di),Math.abs(dj))!==r)continue;const L=grid.get(key(ci+di,cj+dj));if(!L)continue;
        for(const k of L){const d=Math.hypot(tb[k][0]-p[0],tb[k][1]-p[1]);if(d<best){best=d;bi=i;bj=k}}}
      if(r>gw+gh+2)break;
    }});
  const a=pa[bi],b=pb[bj],dpx=Math.hypot(b[0]-a[0],b[1]-a[1]);
  return{a,b,overlap,d_px:overlap?0:dpx,d_mm:metric?(overlap?0:metric.len(a,b)):null,boundaryA:pa.length,boundaryB:pb.length};
}
// imagem retificada (vista de frente) do quadrilátero, para conferir a calibração
export function rectify(img,metric,outW=360){
  if(metric?.kind!=="homography"||!metric.Hinv)return null;const{wmm,hmm}=metric.scale,k=outW/Math.max(wmm,hmm),W=Math.max(2,Math.round(wmm*k)),H=Math.max(2,Math.round(hmm*k));
  const out=new Uint8ClampedArray(W*H*4),src=img.data,iw=img.width,ih=img.height;
  for(let v=0;v<H;v++)for(let u=0;u<W;u++){const[x,y]=applyH(metric.Hinv,(u+.5)/k,(v+.5)/k),o=4*(v*W+u);
    if(x<0||y<0||x>iw-1||y>ih-1){out[o+3]=0;continue}const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(iw-1,x0+1),y1=Math.min(ih-1,y0+1),fx=x-x0,fy=y-y0;
    for(let c=0;c<3;c++)out[o+c]=(src[4*(y0*iw+x0)+c]*(1-fx)+src[4*(y0*iw+x1)+c]*fx)*(1-fy)+(src[4*(y1*iw+x0)+c]*(1-fx)+src[4*(y1*iw+x1)+c]*fx)*fy;out[o+3]=255}
  return{data:out,width:W,height:H,mmPerOutPx:1/k};
}
