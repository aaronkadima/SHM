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
