// Sólido de camadas de nível (forma aproximada do dano, não profundidade):
// o potencial u (grade do motor) é cortado em níveis; cada nível vira polígonos com furos (marching squares
// com interpolação linear, como curvas de nível); a faixa de cada nível é extrudada e empilhada sobre a anterior,
// como o bloco-diagrama de uma topografia. Coordenadas de saída no plano da face, em mm (u → direita, v → para baixo).

// ---------- curvas de nível fechadas (marching squares com borda zerada) ----------
export function contourRings(P,W,H,t){
  const PW=W+2,PH=H+2,val=(x,y)=>(x<=0||y<=0||x>W||y>H)?-1:P[(y-1)*W+(x-1)]-t; // borda abaixo do nível: anéis sempre fechados
  const ekey=(x,y,d)=>(d?"v":"h")+x+","+y; // aresta horizontal (x,y)-(x+1,y) ou vertical (x,y)-(x,y+1)
  const pt=(x,y,d)=>{if(!d){const a=val(x,y),b=val(x+1,y);return[x+a/(a-b),y]}const a=val(x,y),b=val(x,y+1);return[x,y+a/(a-b)]};
  const next=new Map(),coords=new Map();
  const seg=(e1,e2)=>{next.set(e1,e2)};
  for(let y=0;y<PH-1;y++)for(let x=0;x<PW-1;x++){
    const a=val(x,y)>=0,b=val(x+1,y)>=0,c=val(x+1,y+1)>=0,d=val(x,y+1)>=0,k=(a?8:0)|(b?4:0)|(c?2:0)|(d?1:0);if(k===0||k===15)continue;
    const T=ekey(x,y,0),R=ekey(x+1,y,1),B=ekey(x,y+1,0),L=ekey(x,y,1);
    for(const[e,xx,yy,dd]of[[T,x,y,0],[R,x+1,y,1],[B,x,y+1,0],[L,x,y,1]])if(!coords.has(e))coords.set(e,pt(xx,yy,dd));
    // segmentos orientados com o "dentro" (u ≥ t) à esquerda → anéis externos anti-horários (em y para baixo: horários)
    const center=(val(x,y)+val(x+1,y)+val(x+1,y+1)+val(x,y+1))/4>=0;
    switch(k){
      case 1:seg(B,L);break;case 2:seg(R,B);break;case 3:seg(R,L);break;case 4:seg(T,R);break;
      case 5:if(center){seg(T,L);seg(B,R)}else{seg(T,R);seg(B,L)}break;
      case 6:seg(T,B);break;case 7:seg(T,L);break;case 8:seg(L,T);break;case 9:seg(B,T);break;
      case 10:if(center){seg(L,B);seg(R,T)}else{seg(L,T);seg(R,B)}break;
      case 11:seg(R,T);break;case 12:seg(L,R);break;case 13:seg(B,R);break;case 14:seg(L,B);break;
    }
  }
  const rings=[],used=new Set();
  for(const start of next.keys()){
    if(used.has(start))continue;const ring=[];let e=start,guard=0;
    while(e&&!used.has(e)&&guard++<1e7){used.add(e);const p=coords.get(e);ring.push([p[0]-1,p[1]-1]);e=next.get(e)}
    if(ring.length>=3)rings.push(ring);
  }
  return rings; // em coordenadas da grade (centro do pixel = inteiro)
}
export function ringArea(r){let a=0;for(let i=0,j=r.length-1;i<r.length;j=i++)a+=(r[j][0]*r[i][1]-r[i][0]*r[j][1]);return a/2}
export function pointInRing(p,r){let ins=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const[xi,yi]=r[i],[xj,yj]=r[j];if((yi>p[1])!==(yj>p[1])&&p[0]<(xj-xi)*(p[1]-yi)/(yj-yi)+xi)ins=!ins}return ins}
// Douglas–Peucker em anel fechado (mantém pelo menos 4 vértices)
export function simplifyRing(r,tol){
  if(r.length<=8||tol<=0)return r;
  const dp=(pts)=>{const keep=new Uint8Array(pts.length);keep[0]=keep[pts.length-1]=1;const st=[[0,pts.length-1]];
    while(st.length){const[a,b]=st.pop();let md=0,mi=-1;const[ax,ay]=pts[a],[bx,by]=pts[b],dx=bx-ax,dy=by-ay,L=Math.hypot(dx,dy)||1e-12;
      for(let i=a+1;i<b;i++){const d=Math.abs(dy*(pts[i][0]-ax)-dx*(pts[i][1]-ay))/L;if(d>md){md=d;mi=i}}
      if(md>tol&&mi>0){keep[mi]=1;st.push([a,mi],[mi,b])}}
    return pts.filter((_,i)=>keep[i])};
  let far=0,fi=0;for(let i=1;i<r.length;i++){const d=Math.hypot(r[i][0]-r[0][0],r[i][1]-r[0][1]);if(d>far){far=d;fi=i}}
  const out=[...dp(r.slice(0,fi+1)).slice(0,-1),...dp([...r.slice(fi),r[0]]).slice(0,-1)];
  return out.length>=4?out:r;
}
// anéis → polígonos {outer, holes}: externo = área de um sinal, furo = do outro; furo vai ao menor externo que o contém
export function ringsToPolygons(rings){
  if(!rings.length)return[];
  const areas=rings.map(ringArea),sign=Math.sign(areas[areas.reduce((bi,a,i)=>Math.abs(a)>Math.abs(areas[bi])?i:bi,0)]);
  const outers=[],holes=[];rings.forEach((r,i)=>(Math.sign(areas[i])===sign?outers:holes).push({r,a:Math.abs(areas[i])}));
  const polys=outers.map(o=>({outer:o.r,area:o.a,holes:[]}));
  for(const h of holes){let best=null;for(const p of polys)if(pointInRing(h.r[0],p.outer)&&(!best||p.area<best.area))best=p;if(best){best.holes.push(h.r);best.area-=h.a}}
  return polys;
}

// ---------- sólido em camadas ----------
// rw = {prob,W,H,f}: potencial do motor; toPlane(x,y) = px da imagem processada → [u,v] mm no plano da face.
export const SOLID_DEFAULTS={levels:[.1,.3,.5,.7,.9],layerMm:10,minAreaMm2:400,simplifyPx:.75};
export function buildLevelSolid(rw,toPlane,opts={}){
  const o={...SOLID_DEFAULTS,...opts},f=rw.f||1,levels=[...o.levels].filter(v=>v>0&&v<1).sort((a,b)=>a-b);
  const g2img=([gx,gy])=>[(gx+.5)*f-.5,(gy+.5)*f-.5],plane=r=>r.map(p=>toPlane(...g2img(p)));
  const perLevel=levels.map(t=>ringsToPolygons(contourRings(rw.prob,rw.W,rw.H,t).map(r=>simplifyRing(r,o.simplifyPx))).map(p=>{
    const outer=plane(p.outer),holes=p.holes.map(plane);
    const area=Math.abs(ringArea(outer))-holes.reduce((s,h)=>s+Math.abs(ringArea(h)),0);
    return{outer,holes,area,gridOuter:p.outer};
  }));
  // regiões = polígonos do nível mais baixo com área suficiente; níveis acima entram na região que os contém
  const base=(perLevel[0]||[]).filter(p=>p.area>=o.minAreaMm2);
  const regions=base.map((b,i)=>({id:i+1,layers:[],areaByLevel:[]}));
  perLevel.forEach((polys,k)=>{
    regions.forEach(R=>R.layers.push({level:levels[k],z0:k*o.layerMm,z1:(k+1)*o.layerMm,polys:[]}));
    for(const p of polys){const probe=p.gridOuter[0],idx=base.findIndex(b=>pointInRing(probe,b.gridOuter)||b===p);if(idx<0)continue;regions[idx].layers[k].polys.push({outer:p.outer,holes:p.holes,area:p.area})}
  });
  for(const R of regions){R.layers=R.layers.filter(L=>L.polys.length);R.areaByLevel=R.layers.map(L=>({level:L.level,area_mm2:L.polys.reduce((s,p)=>s+p.area,0)}));
    const xs=R.layers[0].polys.flatMap(p=>p.outer.map(q=>q[0])),ys=R.layers[0].polys.flatMap(p=>p.outer.map(q=>q[1]));R.bbox=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]}
  return{regions,levels,layerMm:o.layerMm,units:"mm",note:"forma aproximada; altura = nível do potencial × espessura da camada, não é profundidade"};
}

// camadas que cobrem um ponto (u, v em mm) do plano da face: [{region, level, z0, z1, area}] do nível mais baixo ao mais alto
export function layersAtPoint(solid,u,v){
  const out=[],p=[u,v];
  for(const R of solid?.regions||[])for(const L of R.layers)for(const poly of L.polys)
    if(pointInRing(p,poly.outer)&&!poly.holes.some(h=>pointInRing(p,h))){out.push({region:R.id,level:L.level,z0:L.z0,z1:L.z1,area:poly.area});break}
  return out.sort((a,b)=>a.level-b.level);
}

// ---------- relevo contínuo (superfície irregular, com vales) ----------
// Em vez de camadas planas, a altura acompanha o potencial: z = H·(u − t0)/(1 − t0) dentro da curva do nível mais baixo t0
// (z = 0 na curva). Triângulos da grade (reamostrada com passo `stride`) recortados em u ≥ t0 por interpolação linear;
// a base é a mesma malha achatada em z = 0, que fecha a casca. Cada região do sólido em camadas vira uma malha.
// detail: células-alvo por imagem (alto ≈ 60 mil, médio ≈ 20 mil, baixo ≈ 6 mil).
export const RELIEF_DETAIL={alto:60000,medio:20000,baixo:6000};
export function buildRelief(rw,toPlane,solid,{heightMm=null,detail="medio",stride=null,quantize=false}={}){
  const levels=solid?.levels||[];if(!levels.length||!solid.regions.length)return{regions:[],stride:1,heightMm:0};
  const t0=levels[0],H=heightMm??levels.length*solid.layerMm,f=rw.f||1,P=rw.prob,GW=rw.W,GH=rw.H;
  let inside=0;for(let i=0;i<P.length;i++)if(P[i]>=t0)inside++;
  const s=stride||Math.max(1,Math.ceil(Math.sqrt(inside/(RELIEF_DETAIL[detail]||20000))));
  const NX=Math.floor((GW-1)/s)+1,NY=Math.floor((GH-1)/s)+1,val=(i,j)=>P[Math.min(GH-1,j*s)*GW+Math.min(GW-1,i*s)];
  const g2img=(gx,gy)=>[(gx+.5)*f-.5,(gy+.5)*f-.5],plane=(gx,gy)=>toPlane(...g2img(gx,gy)),
    // contínuo (vales) ou em degraus (camadas planas: espessura × nº de níveis abaixo de u)
    zOf=quantize?u=>{let k=0;for(const t of levels)if(u>=t)k++;return k*solid.layerMm}:u=>Math.max(0,H*(u-t0)/(1-t0));
  // regiões: anéis do nível base no plano (com caixa envolvente para teste rápido)
  const regs=solid.regions.map(R=>{const polys=R.layers[0]?.polys||[];return{R,polys,bb:R.bbox}});
  const regionOf=(x,y)=>{for(let k=0;k<regs.length;k++){const{bb,polys}=regs[k];if(x<bb[0]||y<bb[1]||x>bb[2]||y>bb[3])continue;
    for(const p of polys)if(pointInRing([x,y],p.outer)&&!p.holes.some(h=>pointInRing([x,y],h)))return k}return -1};
  const bandOf=u=>{let b=0;for(let k=0;k<levels.length;k++)if(u>=levels[k])b=k;return b};
  // 1) malha do topo inteira (u ≥ t0), com vértices compartilhados: nó da grade ("n"), corte numa aresta ("e"); z = 0 no corte.
  //    Fora da grade o potencial vale −1 (como nas curvas de nível): a borda da imagem também fecha em z = 0.
  const pos=[],tris=[],tband=[],map=new Map();
  const vtx=(key,gx,gy,u)=>{let id=map.get(key);if(id==null){const[x,y]=plane(gx,gy);id=pos.length/4;pos.push(x,y,u<=t0?0:zOf(u),u);map.set(key,id)}return id};
  const node=(a,b)=>{const ins=a>=0&&b>=0&&a<NX&&b<NY,ca=Math.max(0,Math.min(NX-1,a)),cb=Math.max(0,Math.min(NY-1,b));
    return{gx:Math.min(GW-1,ca*s),gy:Math.min(GH-1,cb*s),u:ins?val(a,b):-1,k:ins?"n"+(b*NX+a):"o"+a+","+b}};
  const clip=tri=>{const res=[];for(let a=0;a<3;a++){const A=tri[a],B=tri[(a+1)%3],ia=A.u>=t0,ib=B.u>=t0;
      if(ia)res.push(A);if(ia!==ib){const t=(t0-A.u)/(B.u-A.u),k=A.k<B.k?A.k+"|"+B.k:B.k+"|"+A.k;res.push({gx:A.gx+(B.gx-A.gx)*t,gy:A.gy+(B.gy-A.gy)*t,u:t0,k:"e"+k})}}
    return res};
  for(let j=-1;j<NY;j++)for(let i=-1;i<NX;i++){
    const q=[node(i,j),node(i+1,j),node(i+1,j+1),node(i,j+1)];if(q.every(v=>v.u<t0))continue;
    for(const tri of[[q[0],q[1],q[2]],[q[0],q[2],q[3]]]){const poly=clip(tri);if(poly.length<3)continue;
      const ids=poly.map(v=>vtx(v.k,v.gx,v.gy,v.u)),um=poly.reduce((s2,v)=>s2+v.u,0)/poly.length;
      for(let k=1;k+1<ids.length;k++){tris.push(ids[0],ids[k],ids[k+1]);tband.push(bandOf(um))}}
  }
  // 2) componentes conexos (union-find nos vértices) → região do sólido em camadas pela maioria dos centroides;
  //    componente sem região (menor que a área mínima) sai inteiro, para a casca continuar fechada
  const nv=pos.length/4,par=new Int32Array(nv).map((_,i)=>i),find=x=>{while(par[x]!==x){par[x]=par[par[x]];x=par[x]}return x};
  for(let t=0;t<tris.length;t+=3){const a=find(tris[t]);par[find(tris[t+1])]=a;par[find(tris[t+2])]=a}
  const votes=new Map();for(let t=0;t<tris.length;t+=3){const c=find(tris[t]),cx=(pos[tris[t]*4]+pos[tris[t+1]*4]+pos[tris[t+2]*4])/3,cy=(pos[tris[t]*4+1]+pos[tris[t+1]*4+1]+pos[tris[t+2]*4+1])/3,r=regionOf(cx,cy);
    if(r<0)continue;let v=votes.get(c);if(!v)votes.set(c,v=new Map());v.set(r,(v.get(r)||0)+1)}
  const compRegion=new Map();for(const[c,v]of votes){let best=-1,bn=0;for(const[r,nn]of v)if(nn>bn){bn=nn;best=r}compRegion.set(c,best)}
  const out=regs.map(()=>({pos:[],idx:[],band:[],map:new Map()}));
  for(let t=0;t<tris.length;t+=3){const r=compRegion.get(find(tris[t]));if(r==null||r<0)continue;const o=out[r];
    for(let k=0;k<3;k++){const v=tris[t+k];let id=o.map.get(v);if(id==null){id=o.pos.length/4;o.pos.push(pos[v*4],pos[v*4+1],pos[v*4+2],pos[v*4+3]);o.map.set(v,id)}o.idx.push(id)}
    o.band.push(tband[t/3])}
  // base: cópia achatada dos vértices internos (os de corte já têm z = 0 e são compartilhados), triângulos invertidos
  const regions=out.map((o,k)=>{const nTop=o.idx.length/3,nv=o.pos.length/4,base=new Int32Array(nv).fill(-1),pos=o.pos.slice();
    for(let v=0;v<nv;v++)if(o.pos[v*4+2]>1e-9){base[v]=pos.length/4;pos.push(o.pos[v*4],o.pos[v*4+1],0,o.pos[v*4+3])}else base[v]=v;
    const idx=o.idx.slice(),band=o.band.slice();for(let t=0;t<nTop;t++){idx.push(base[o.idx[t*3]],base[o.idx[t*3+2]],base[o.idx[t*3+1]]);band.push(0)}
    const n=pos.length/4,P3=new Float32Array(n*3),U=new Float32Array(n);for(let v=0;v<n;v++){P3[v*3]=pos[v*4];P3[v*3+1]=pos[v*4+1];P3[v*3+2]=pos[v*4+2];U[v]=pos[v*4+3]}
    return{id:regs[k].R.id,positions:P3,u:U,indices:Uint32Array.from(idx),band:Uint8Array.from(band),topCount:nTop}}).filter(r=>r.topCount>0);
  return{regions,stride:s,heightMm:H,t0,levels};
}

// ---------- cavidade (projeção côncava) ----------
// Para dentro da face, a forma do dano vira uma cavidade:
//  · lining: o fundo colorido (superfície aberta = topo do relevo, contínuo ou em degraus), profundidade positiva para dentro;
//  · steps: o volume a remover do elemento, em degraus extrudados — um polígono (com furos) por nível, da tampa 1 mm FORA da
//    face até abaixo do fundo naquele trecho. Degraus extrudados são o que os motores booleanos dos visualizadores IFC
//    processam bem (um vazio triangulado com milhares de faces faz o IfcOpenShell desistir do recorte).
// Profundidade do degrau k: relevo = H·(t(k+1) − t0)/(1 − t0) + margem (u < t(k+1) dentro do degrau), degraus = (k+1)·espessura + margem.
export function buildCavity(rw,toPlane,solid,{style="relief",detail="medio",stride=null,capMm=1,extraMm=1.5,simplifyMm=5}){
  const R=buildRelief(rw,toPlane,solid,{detail,stride,quantize:style!=="relief"}),levels=solid.levels,t0=levels[0],H=R.heightMm;
  const depthOf=k=>style==="relief"?(k+1<levels.length?H*(levels[k+1]-t0)/(1-t0):H):(k+1)*solid.layerMm;
  // dilatação de uma célula da grade do relevo: o recorte cobre a rampa da borda (anel externo cresce, furos encolhem)
  const c0=toPlane(0,0),c1=toPlane((rw.f||1)*R.stride,0),grow=Math.hypot(c1[0]-c0[0],c1[1]-c0[1]);
  const simp=r=>{const o=simplifyRing(r,simplifyMm);return o.length>=3?o:r};
  const offset=(r,d)=>{const n=r.length,sg=Math.sign(ringArea(r))||1;return r.map((p,i)=>{const a=r[(i+n-1)%n],b=r[(i+1)%n],tx=b[0]-a[0],ty=b[1]-a[1],L=Math.hypot(tx,ty)||1;
    // normal para fora do anel (depende do sentido); deslocamento d (>0 cresce a área do anel)
    return[p[0]+sg*ty/L*d,p[1]-sg*tx/L*d]})};
  const regions=R.regions.map(M=>{
    const nTop=M.topCount,used=new Map(),lp=[],lu=[],li=[];
    for(let t=0;t<nTop*3;t++){const v=M.indices[t];let id=used.get(v);if(id==null){id=lp.length/3;used.set(v,id);lp.push(M.positions[v*3],M.positions[v*3+1],M.positions[v*3+2]);lu.push(M.u[v])}li.push(id)}
    const SR=solid.regions.find(x=>x.id===M.id);
    const steps=(SR?.layers||[]).map(L=>{const k=levels.indexOf(L.level);return{level:L.level,depthMm:depthOf(k),
      polys:L.polys.map(p=>({outer:offset(simp(p.outer),grow),holes:p.holes.map(simp).filter(h=>Math.abs(ringArea(h))>Math.max(simplifyMm,grow*2)**2*4).map(h=>offset(h,-grow))}))}});
    // calibração: cada degrau desce até o vértice do fundo mais fundo que cai nele (a grade do relevo e o polígono simplificado
    // não coincidem exatamente na borda entre níveis); depois a margem
    for(let v=0;v<lp.length;v+=3){let best=-1;for(let k=0;k<steps.length;k++)if(steps[k].polys.some(p=>pointInRing([lp[v],lp[v+1]],p.outer)&&!p.holes.some(h=>pointInRing([lp[v],lp[v+1]],h))))best=k;
      if(best>=0)steps[best].depthMm=Math.max(steps[best].depthMm,lp[v+2])}
    for(let k=0;k<steps.length;k++)steps[k].depthMm=Math.max(steps[k].depthMm+extraMm,k?steps[k-1].depthMm:0);
    // fatias: cada degrau começa 0,5 mm acima do fundo do anterior (o primeiro, na tampa fora da face) — sem colunas sobrepostas
    for(let k=0;k<steps.length;k++)steps[k].topMm=k?Math.max(-capMm,steps[k-1].depthMm-.5):-capMm;
    return{id:M.id,lining:{positions:Float32Array.from(lp),u:Float32Array.from(lu),indices:Uint32Array.from(li),band:M.band.slice(0,nTop)},steps};
  });
  return{regions,stride:R.stride,style,levels,capMm,extraMm,depthMm:H};
}
// profundidade do recorte num ponto do plano (o degrau mais fundo que contém o ponto); 0 fora
export function cavityDepthAt(region,u,v){let d=0;for(const st of region.steps)for(const p of st.polys)if(st.depthMm>d&&pointInRing([u,v],p.outer)&&!p.holes.some(h=>pointInRing([u,v],h)))d=st.depthMm;return d}
