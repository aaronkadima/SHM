// CDM-4 · detector linear de armadura exposta.
//
// Barra exposta = vale escuro, estreito e LONGO dentro do desplacamento. Passos:
//  1) black-hat k = 21 (vales mais estreitos que 21 px);
//  2) abertura linear em 12 orientações, segmento L = 61 px: só sobrevive o que é longo em alguma
//     direção (máximo das 12 aberturas);
//  3) zona = desplacamento dilatado em 7 px; porta de escuridão por pixel: média 5×5 do cinza abaixo
//     do percentil q do cinza da zona (barra corroída é mais escura que o agregado ao redor);
//  4) histerese (resposta > T_baixo, componente com algum pixel > T_alto), fechamento 3×3;
//  5) forma de barra: comprimento 4·√λ₁ ≥ 30 px e alongamento √(λ₁/λ₂) ≥ 3 (covariância do componente).
// Validação (foto 24, GT do autor): IoU da armadura 13,2 % (CDM 2.11) → 45,0 % (q = 15).

export const REBAR_DEFAULTS={k:21,L:61,orientations:12,tLow:30,tHigh:80,q:15,pad:7,minLength:30,minElongation:3,minPixels:20};

function lineOffsets(L,theta){
  const r=L>>1,t=theta*Math.PI/180,set=new Set(),out=[];
  for(let k=0;k<4*L;k++){const s=-r+2*r*k/(4*L-1),dy=Math.round(s*Math.sin(t)),dx=Math.round(s*Math.cos(t)),key=dy*1e4+dx;if(!set.has(key)){set.add(key);out.push([dx,dy])}}
  return out;
}
function boxMean(src,w,h,k){
  const r=k>>1,W=w+1,I=new Float64Array(W*(h+1)),out=new Float32Array(w*h);
  for(let y=0;y<h;y++){let row=0;for(let x=0;x<w;x++){row+=src[y*w+x];I[(y+1)*W+x+1]=I[y*W+x+1]+row}}
  for(let y=0;y<h;y++){const y0=Math.max(0,y-r),y1=Math.min(h-1,y+r);
    for(let x=0;x<w;x++){const x0=Math.max(0,x-r),x1=Math.min(w-1,x+r);
      out[y*w+x]=(I[(y1+1)*W+x1+1]-I[y0*W+x1+1]-I[(y1+1)*W+x0]+I[y0*W+x0])/((y1-y0+1)*(x1-x0+1))}}
  return out;
}
function dilateBox(src,w,h,k){
  const r=k>>1,tmp=new Uint8Array(w*h),out=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=0;for(let d=-r;d<=r&&!v;d++){const xx=x+d;if(xx>=0&&xx<w&&src[y*w+xx])v=1}tmp[y*w+x]=v}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=0;for(let d=-r;d<=r&&!v;d++){const yy=y+d;if(yy>=0&&yy<h&&tmp[yy*w+x])v=1}out[y*w+x]=v}
  return out;
}
function erodeBox(src,w,h,k){
  const r=k>>1,tmp=new Uint8Array(w*h),out=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=1;for(let d=-r;d<=r&&v;d++){const xx=x+d;if(xx<0||xx>=w||!src[y*w+xx])v=0}tmp[y*w+x]=v}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=1;for(let d=-r;d<=r&&v;d++){const yy=y+d;if(yy<0||yy>=h||!tmp[yy*w+x])v=0}out[y*w+x]=v}
  return out;
}
function components(mask,w,h){
  const lab=new Int32Array(w*h),q=new Int32Array(w*h),comps=[];let id=0;
  for(let s=0;s<w*h;s++){
    if(!mask[s]||lab[s])continue;id++;let hd=0,tl=0;q[tl++]=s;lab[s]=id;
    while(hd<tl){const p=q[hd++],y=(p/w)|0,x=p-y*w;
      for(let ny=Math.max(0,y-1);ny<=Math.min(h-1,y+1);ny++)for(let nx=Math.max(0,x-1);nx<=Math.min(w-1,x+1);nx++){const t=ny*w+nx;if(mask[t]&&!lab[t]){lab[t]=id;q[tl++]=t}}}
    comps.push(q.slice(0,tl));
  }
  return comps;
}

// gray: cinza estirado do CDM; blackhat21: black-hat k = REBAR_DEFAULTS.k; spalling: máscara final.
export function linearRebar(gray,blackhatK,w,h,spalling,opts={}){
  const o={...REBAR_DEFAULTS,...opts},n=w*h,t0=Date.now(),out=new Uint8Array(n);
  if(!spalling||!spalling.some(v=>v))return{mask:out,log:{applied:false,reason:"sem desplacamento"}};
  const zone=dilateBox(spalling,w,h,2*o.pad+1);
  // caixa da zona (a abertura só precisa ser calculada ali)
  let zx0=w,zy0=h,zx1=-1,zy1=-1;const zg=[];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(zone[y*w+x]){if(x<zx0)zx0=x;if(x>zx1)zx1=x;if(y<zy0)zy0=y;if(y>zy1)zy1=y;zg.push(gray[y*w+x])}
  zg.sort((a,b)=>a-b);
  const qi=o.q/100*(zg.length-1),gcut=zg[Math.floor(qi)]+(zg[Math.ceil(qi)]-zg[Math.floor(qi)])*(qi-Math.floor(qi));
  const r=o.L>>1,ex0=Math.max(0,zx0-r),ey0=Math.max(0,zy0-r),ex1=Math.min(w-1,zx1+r),ey1=Math.min(h-1,zy1+r);
  // buffers com margem r replicada: o laço interno só soma deslocamentos lineares (sem testes de borda)
  const EW=ex1-ex0+1,EH=ey1-ey0+1,PW=EW+2*r,PH=EH+2*r,src=new Float32Array(PW*PH),ero=new Float32Array(PW*PH),R=new Float32Array(n);
  for(let y=0;y<PH;y++){const sy=Math.min(h-1,Math.max(0,ey0+y-r))*w;for(let x=0;x<PW;x++)src[y*PW+x]=blackhatK[sy+Math.min(w-1,Math.max(0,ex0+x-r))]}
  const zp=[];for(let y=zy0;y<=zy1;y++)for(let x=zx0;x<=zx1;x++)if(zone[y*w+x])zp.push(y*w+x);
  for(let a=0;a<o.orientations;a++){
    const off=Int32Array.from(lineOffsets(o.L,a*180/o.orientations).map(([dx,dy])=>dy*PW+dx)),K=off.length;
    for(let y=0;y<EH;y++){let base=(y+r)*PW+r;for(let x=0;x<EW;x++,base++){let m=src[base+off[0]];for(let k=1;k<K;k++){const v=src[base+off[k]];if(v<m)m=v}ero[base]=m}}
    // margem replicada da erosão (equivale a limitar a leitura à caixa calculada)
    for(let y=0;y<PH;y++){const yy=Math.min(EH-1,Math.max(0,y-r))+r;for(let x=0;x<PW;x++){if(y>=r&&y<r+EH&&x>=r&&x<r+EW)continue;ero[y*PW+x]=ero[yy*PW+Math.min(EW-1,Math.max(0,x-r))+r]}}
    for(const i of zp){const y=(i/w)|0,x=i-y*w,base=(y-ey0+r)*PW+(x-ex0+r);let m=ero[base+off[0]];for(let k=1;k<K;k++){const v=ero[base+off[k]];if(v>m)m=v}if(m>R[i])R[i]=m}
  }
  const gs=boxMean(gray,w,h,5),low=new Uint8Array(n);
  for(let i=0;i<n;i++)low[i]=zone[i]&&R[i]>o.tLow&&gs[i]<gcut?1:0;
  const hyst=new Uint8Array(n);let seeds=0;
  for(const c of components(low,w,h)){let strong=false;for(const p of c)if(R[p]>o.tHigh){strong=true;break}if(strong){seeds++;for(const p of c)hyst[p]=1}}
  const closed=erodeBox(dilateBox(hyst,w,h,3),w,h,3);let kept=0,area=0;
  for(const c of components(closed,w,h)){
    if(c.length<o.minPixels)continue;
    let mx=0,my=0;for(const p of c){mx+=p%w;my+=(p/w)|0}mx/=c.length;my/=c.length;
    let sxx=0,syy=0,sxy=0;for(const p of c){const dx=p%w-mx,dy=((p/w)|0)-my;sxx+=dx*dx;syy+=dy*dy;sxy+=dx*dy}
    const d=Math.max(1,c.length-1);sxx/=d;syy/=d;sxy/=d;
    const tr=(sxx+syy)/2,det=Math.sqrt(Math.max(0,(sxx-syy)*(sxx-syy)/4+sxy*sxy)),l1=tr+det,l2=Math.max(1e-6,tr-det);
    if(4*Math.sqrt(Math.max(l1,1e-6))>=o.minLength&&Math.sqrt(l1/l2)>=o.minElongation){kept++;area+=c.length;for(const p of c)out[p]=1}
  }
  return{mask:out,log:{applied:true,q:o.q,darkness_cut:+gcut.toFixed(2),seeds,bars:kept,area_px:area,ms:Date.now()-t0}};
}
