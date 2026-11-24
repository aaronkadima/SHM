// Vista realista da cavidade (projeção côncava) sem biblioteca de CSG: o recorte só atinge a face plana escolhida, então
// basta (1) retriangular essa face com a boca da cavidade como furo, (2) desenhar paredes e pisos dos degraus do recorte com
// o material do elemento e (3) furar também a foto projetada. É o mesmo volume gravado no IFC como IfcVoidingFeature.
// Coordenadas do plano: (u, v) em mm, v para baixo; profundidade positiva para dentro da face.
import*as THREE from"three";
import{facePoint,faceUV}from"./ifcFace.js";
import{pointInRing,ringArea}from"./levelSolid.js";

const v2=([u,v])=>new THREE.Vector2(u,-v);
// contornos da face a partir dos triângulos coplanares (arestas usadas uma vez), no plano (u, v)
export function faceOutline(face,tris){
  const key=p=>p.map(x=>x.toFixed(5)).join(","),pts=new Map(),E=new Map();
  for(const t of tris){const ks=t.P.map(p=>{const k=key(p);if(!pts.has(k))pts.set(k,faceUV(face,p));return k});
    for(let i=0;i<3;i++){const a=ks[i],b=ks[(i+1)%3];if(a===b)continue;const back=b+"|"+a;if(E.has(back))E.delete(back);else E.set(a+"|"+b,[a,b])}}
  const next=new Map();for(const[a,b]of E.values())next.set(a,b);
  const loops=[],seen=new Set();for(const s of next.keys()){if(seen.has(s))continue;const L=[];let k=s,g=0;while(k&&!seen.has(k)&&g++<1e6){seen.add(k);L.push(pts.get(k));k=next.get(k)}if(L.length>=3)loops.push(L)}
  loops.sort((a,b)=>Math.abs(ringArea(b))-Math.abs(ringArea(a)));
  return{outer:loops[0]||[],holes:loops.slice(1)};
}
// bocas (degrau mais raso de cada região) e ilhas intactas dentro delas
export function mouthsOf(cavity){
  const mouths=[],islands=[];
  for(const r of cavity?.regions||[]){const st=r.steps?.[0];if(!st)continue;for(const p of st.polys){mouths.push(p.outer);islands.push(...p.holes)}}
  return{mouths,islands};
}
export const ringsInside=(rings,outer)=>rings.every(r=>r.every(p=>pointInRing(p,outer)));
// triângulos de um polígono com furos (earcut do three) → posições no mundo, com uv opcional
function fillPolygon(face,outer,holes,depthMm,{uvOf=null,flip=false}={}){
  // triangulateShape remove pontos finais repetidos dos próprios vetores: os índices valem para c e hs depois da chamada
  const c=outer.map(v2),hs=holes.map(h=>h.map(v2)),tri=THREE.ShapeUtils.triangulateShape(c,hs),all=[...c,...hs.flat()].map(p=>[p.x,-p.y]),pos=[],uv=[];
  for(const[a,b,d]of tri)for(const i of flip?[a,d,b]:[a,b,d]){const[u,v]=all[i];pos.push(...facePoint(face,u,v,-depthMm));if(uvOf)uv.push(...uvOf(u,v))}
  return{pos,uv};
}
// face do elemento com as bocas como furos (+ ilhas intactas), mais as demais faces do elemento sem alteração
export function cutHostGeometry(face,hostTris,faceTris,cavity){
  const inFace=new Set(faceTris),pos=[];
  for(const t of hostTris){if(inFace.has(t)||!t.area)continue;for(const p of t.P)pos.push(...p)}
  const out=faceOutline(face,faceTris),{mouths,islands}=mouthsOf(cavity);
  if(!out.outer.length||!ringsInside(mouths,out.outer))return null; // boca fora da face: sem recorte na vista
  pos.push(...fillPolygon(face,out.outer,[...out.holes,...mouths],0).pos);
  for(const isl of islands)pos.push(...fillPolygon(face,isl,[],0).pos);
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));g.computeVertexNormals();return g;
}
// paredes e pisos de cada degrau do recorte (concreto cortado)
export function cavityWallsGeometry(face,cavity){
  const pos=[];
  for(const r of cavity?.regions||[])r.steps.forEach((st,k)=>{
    const top=k?r.steps[k-1].depthMm:0,bot=st.depthMm,deeper=r.steps[k+1]?.polys.map(p=>p.outer)||[];
    for(const p of st.polys){
      for(const ring of[p.outer,...p.holes])for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];
        const A=facePoint(face,a[0],a[1],-top),B=facePoint(face,b[0],b[1],-top),C=facePoint(face,b[0],b[1],-bot),D=facePoint(face,a[0],a[1],-bot);pos.push(...A,...B,...C,...A,...C,...D)}
      // piso só onde não há degrau mais fundo dentro (os pisos intermediários ficam sob o fundo colorido, que cobre a boca
      // inteira; com a dilatação, o contorno do degrau seguinte pode cruzar este e o piso tamparia o fundo)
      if(!deeper.some(d=>d.some(q=>pointInRing(q,p.outer))))try{pos.push(...fillPolygon(face,p.outer,p.holes,bot).pos)}catch{}
    }});
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));g.computeVertexNormals();return g;
}
// volume removido (fatias dos degraus), para o modo transparente
export function cavityGhostGeometry(face,cavity){
  const geos=[];
  for(const r of cavity?.regions||[])r.steps.forEach((st,k)=>{const top=k?r.steps[k-1].depthMm:0;
    for(const p of st.polys){const sh=new THREE.Shape(p.outer.map(v2));sh.holes=p.holes.map(h=>new THREE.Path(h.map(v2)));
      const g=new THREE.ExtrudeGeometry(sh,{depth:(st.depthMm-top)/1000,bevelEnabled:false,curveSegments:1});g.scale(.001,.001,1);g.translate(0,0,-st.depthMm/1000);geos.push(g)}});
  const basis=new THREE.Matrix4().makeBasis(new THREE.Vector3(...face.ex),new THREE.Vector3(...face.ey),new THREE.Vector3(...face.n)).setPosition(...face.origin);
  return geos.map(g=>g.applyMatrix4(basis));
}
// foto projetada com as bocas furadas (contorno da imagem amostrado pelo mapeamento: vale para a homografia)
export function photoWithHoles(face,mapping,W,H,cavity,liftMm=.3,N=24){
  const ring=[];for(let i=0;i<N;i++)ring.push(mapping.toPlane(i/N*W,0));for(let j=0;j<N;j++)ring.push(mapping.toPlane(W,j/N*H));
  for(let i=N;i>0;i--)ring.push(mapping.toPlane(i/N*W,H));for(let j=N;j>0;j--)ring.push(mapping.toPlane(0,j/N*H));
  const{mouths,islands}=mouthsOf(cavity),uvOf=(u,v)=>{const[x,y]=mapping.toImage(u,v);return[x/W,1-y/H]};
  const a=fillPolygon(face,ring,mouths.filter(m=>m.every(p=>pointInRing(p,ring))),-liftMm,{uvOf}),pos=[...a.pos],uv=[...a.uv];
  for(const isl of islands){const b=fillPolygon(face,isl,[],-liftMm,{uvOf});pos.push(...b.pos);uv.push(...b.uv)}
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));g.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));return g;
}
