// Eixos das barras de armadura exposta a partir da máscara do CDM-4 (exposed_rebar), para projetá-las dentro da cavidade.
// Esqueleto por afinamento de Zhang–Suen, raio pela transformada de distância (chanfro 3-4), trechos entre pontas e
// junções rastreados como polilinhas, ramos curtos podados e Douglas–Peucker. Tudo em px da imagem processada.


// diâmetros nominais de barras e fios (ABNT NBR 7480), mm
export const REBAR_GAUGES=[5,6.3,8,10,12.5,16,20,25,32,40];
export const nearestGauge=d=>REBAR_GAUGES.reduce((b,g)=>Math.abs(g-d)<Math.abs(b-d)?g:b,REBAR_GAUGES[0]);

function distance(mask,w,h){ // distância (px) até o fundo, chanfro 3-4
  const INF=1e9,d=new Float32Array(w*h);for(let i=0;i<w*h;i++)d[i]=mask[i]?INF:0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(!d[i])continue;let m=d[i];
    if(x>0)m=Math.min(m,d[i-1]+3);if(y>0){m=Math.min(m,d[i-w]+3);if(x>0)m=Math.min(m,d[i-w-1]+4);if(x<w-1)m=Math.min(m,d[i-w+1]+4)}d[i]=m}
  for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){const i=y*w+x;if(!d[i])continue;let m=d[i];
    if(x<w-1)m=Math.min(m,d[i+1]+3);if(y<h-1){m=Math.min(m,d[i+w]+3);if(x<w-1)m=Math.min(m,d[i+w+1]+4);if(x>0)m=Math.min(m,d[i+w-1]+4)}d[i]=m}
  for(let i=0;i<w*h;i++)d[i]/=3;return d;
}
function thin(mask,w,h){ // Zhang–Suen
  const s=new Uint8Array(mask.length);for(let i=0;i<s.length;i++)s[i]=mask[i]?1:0;
  const del=[];let changed=true,guard=0;
  while(changed&&guard++<200){changed=false;
    for(let pass=0;pass<2;pass++){del.length=0;
      for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;if(!s[i])continue;
        const p2=s[i-w],p3=s[i-w+1],p4=s[i+1],p5=s[i+w+1],p6=s[i+w],p7=s[i+w-1],p8=s[i-1],p9=s[i-w-1];
        const B=p2+p3+p4+p5+p6+p7+p8+p9;if(B<2||B>6)continue;
        const A=(!p2&&p3)+(!p3&&p4)+(!p4&&p5)+(!p5&&p6)+(!p6&&p7)+(!p7&&p8)+(!p8&&p9)+(!p9&&p2);if(A!==1)continue;
        if(pass===0?(p2*p4*p6||p4*p6*p8):(p2*p4*p8||p2*p6*p8))continue;del.push(i)}
      if(del.length){changed=true;for(const i of del)s[i]=0}}}
  return s;
}
const N8=[[-1,-1],[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0]];
/**
 * mask: Uint8Array w×h. Devolve [{pts:[[x,y],…], r: raio mediano em px, len}] (px da imagem).
 * minLenPx: trechos mais curtos que isso (e que 3× o raio) são descartados; join liga trechos alinhados a até maxGapPx.
 */
export function rebarCenterlines(mask,w,h,{minLenPx=14,simplifyPx=1.2,join=true,maxGapPx=48}={}){
  let any=0;for(let i=0;i<mask.length;i++)if(mask[i]){any=1;break}if(!any)return[];
  const dist=distance(mask,w,h),sk=thin(mask,w,h),deg=new Uint8Array(w*h);
  const on=(x,y)=>x>=0&&y>=0&&x<w&&y<h&&sk[y*w+x];
  // ordem: ortogonais primeiro (em escadas do esqueleto o passo ortogonal visita todos os pixels)
  const ORDER=[[0,-1],[1,0],[0,1],[-1,0],[-1,-1],[1,-1],[1,1],[-1,1]];
  const nb=(x,y)=>ORDER.map(([dx,dy])=>[x+dx,y+dy]).filter(([a,b])=>on(a,b));
  // classe do pixel pelo número de transições 0→1 no anel de 8 vizinhos (1 = ponta, 2 = linha, ≥ 3 = junção)
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(sk[y*w+x]){let t=0;for(let k=0;k<8;k++){const[a1,b1]=N8[k],[a2,b2]=N8[(k+1)%8];if(!on(x+a1,y+b1)&&on(x+a2,y+b2))t++}deg[y*w+x]=t===0?(nb(x,y).length?2:0):t}
  const seen=new Uint8Array(w*h),paths=[];
  const walk=(start,first)=>{const pts=[start];let prev=start,cur=first;
    while(true){pts.push(cur);if(deg[cur]!==2)break;seen[cur]=1;const x=cur%w,y=(cur/w)|0;
      const nx=nb(x,y).map(([a,b])=>b*w+a).find(j=>j!==prev&&!seen[j]&&!pts.includes(j));if(nx==null)break;prev=cur;cur=nx}
    return pts};
  // trechos a partir de pontas e junções; depois laços e linhas sem pontas
  for(let i=0;i<w*h;i++){if(!sk[i]||deg[i]===2)continue;seen[i]=1;const x=i%w,y=(i/w)|0;for(const[a,b]of nb(x,y)){const j=b*w+a;if(!seen[j]||deg[j]!==2&&j>i)paths.push(walk(i,j))}}
  for(let i=0;i<w*h;i++){if(!sk[i]||seen[i])continue;seen[i]=1;const x=i%w,y=(i/w)|0,nn=nb(x,y);if(nn.length)paths.push(walk(i,nn[0][1]*w+nn[0][0]))}
  // trechos em px com raio; depois liga trechos alinhados (cruzamento com estribo, falha curta da detecção)
  let segs=paths.map(p=>{const pts=p.map(i=>[i%w,(i/w)|0]),rs=p.map(i=>dist[i]).sort((x,y)=>x-y);return{pts,r:Math.max(.5,rs[rs.length>>1]||1)}}).filter(sg=>sg.pts.length>=2);
  const endDir=(pts,atEnd)=>{const n=pts.length,k=Math.min(n-1,8),a=atEnd?pts[n-1]:pts[0],b=atEnd?pts[n-1-k]:pts[k],dx=a[0]-b[0],dy=a[1]-b[1],L=Math.hypot(dx,dy)||1;return[dx/L,dy/L]};
  if(join){const cosOpp=Math.cos(30*Math.PI/180),cosGap=Math.cos(35*Math.PI/180);
    for(let guard=0;guard<1000;guard++){let best=null;
      for(let i=0;i<segs.length;i++)for(let j=i+1;j<segs.length;j++)for(const ei of[0,1])for(const ej of[0,1]){
        const A=segs[i],B=segs[j],pa=ei?A.pts.at(-1):A.pts[0],pb=ej?B.pts.at(-1):B.pts[0],gap=Math.hypot(pb[0]-pa[0],pb[1]-pa[1]),G=Math.max(maxGapPx,4*Math.max(A.r,B.r));
        if(gap>G)continue;const ta=endDir(A.pts,!!ei),tb=endDir(B.pts,!!ej);if(ta[0]*tb[0]+ta[1]*tb[1]>-cosOpp)continue;
        if(gap>2&&((pb[0]-pa[0])*ta[0]+(pb[1]-pa[1])*ta[1])/gap<cosGap)continue;
        if(!best||gap<best.gap)best={i,j,ei,ej,gap}}
      if(!best)break;const A=segs[best.i],B=segs[best.j];
      const pa=best.ei?A.pts:[...A.pts].reverse(),pb=best.ej?[...B.pts].reverse():B.pts;
      const merged={pts:[...pa,...pb],r:(A.r*A.pts.length+B.r*B.pts.length)/(A.pts.length+B.pts.length)};
      segs=segs.filter((_,k)=>k!==best.i&&k!==best.j);segs.push(merged)}}
  const out=[];
  for(const sg of segs){
    const pts=sg.pts,r=sg.r;let len=0;for(let k=1;k<pts.length;k++)len+=Math.hypot(pts[k][0]-pts[k-1][0],pts[k][1]-pts[k-1][1]);
    // espora do afinamento ou fragmento isolado
    if(len<Math.max(minLenPx,3*r))continue;
    out.push({pts:simplifyOpen(pts,simplifyPx),r,len});
  }
  return out.sort((a,b)=>b.len-a.len);
}
function simplifyOpen(pts,tol){ // Douglas–Peucker em linha aberta
  if(pts.length<=2)return pts;const keep=new Uint8Array(pts.length);keep[0]=keep[pts.length-1]=1;const st=[[0,pts.length-1]];
  while(st.length){const[a,b]=st.pop();let md=0,mi=-1;const[ax,ay]=pts[a],[bx,by]=pts[b],dx=bx-ax,dy=by-ay,L=Math.hypot(dx,dy)||1e-9;
    for(let i=a+1;i<b;i++){const d=Math.abs(dy*(pts[i][0]-ax)-dx*(pts[i][1]-ay))/L;if(d>md){md=d;mi=i}}
    if(md>tol&&mi>0){keep[mi]=1;st.push([a,mi],[mi,b])}}
  return pts.filter((_,i)=>keep[i]);
}


/**
 * Tubos das barras no plano da face: bars = [{pts:[[u,v,depth],…] (mm), d: diâmetro mm}].
 * Devolve uma malha fechada {positions (u, v, profundidade em mm), indices}; sides = lados do polígono da seção.
 */
export function rebarTubes(bars,sides=10){
  const pos=[],idx=[];
  for(const bar of bars){
    const P=bar.pts,r=bar.d/2;if(P.length<2)continue;const base=pos.length/3,ring=[];
    for(let k=0;k<P.length;k++){
      const a=P[Math.max(0,k-1)],b=P[Math.min(P.length-1,k+1)];let t=[b[0]-a[0],b[1]-a[1],b[2]-a[2]];const tl=Math.hypot(...t)||1;t=t.map(x=>x/tl);
      // referência: eixo da profundidade (perpendicular à face); se a barra for quase perpendicular à face, usa u
      let ref=Math.abs(t[2])>.9?[1,0,0]:[0,0,1];let n1=[t[1]*ref[2]-t[2]*ref[1],t[2]*ref[0]-t[0]*ref[2],t[0]*ref[1]-t[1]*ref[0]];const nl=Math.hypot(...n1)||1;n1=n1.map(x=>x/nl);
      const n2=[t[1]*n1[2]-t[2]*n1[1],t[2]*n1[0]-t[0]*n1[2],t[0]*n1[1]-t[1]*n1[0]];
      for(let j=0;j<sides;j++){const ang=j/sides*Math.PI*2,c=Math.cos(ang)*r,s=Math.sin(ang)*r;pos.push(P[k][0]+n1[0]*c+n2[0]*s,P[k][1]+n1[1]*c+n2[1]*s,P[k][2]+n1[2]*c+n2[2]*s)}
      ring.push(base+k*sides);
    }
    for(let k=0;k+1<P.length;k++)for(let j=0;j<sides;j++){const a=ring[k]+j,b=ring[k]+(j+1)%sides,c=ring[k+1]+(j+1)%sides,d=ring[k+1]+j;idx.push(a,b,c,a,c,d)}
    // tampas (leque a partir de um vértice central)
    for(const[k,flip]of[[0,true],[P.length-1,false]]){const c=pos.length/3;pos.push(...P[k]);for(let j=0;j<sides;j++){const a=ring[k]+j,b=ring[k]+(j+1)%sides;flip?idx.push(c,b,a):idx.push(c,a,b)}}
  }
  return{positions:Float32Array.from(pos),indices:Uint32Array.from(idx)};
}
