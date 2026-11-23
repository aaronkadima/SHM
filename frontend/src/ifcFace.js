// Face plana de um elemento IFC escolhida com um clique no visualizador (web-ifc → three.js).
// Malhas do web-ifc (COORDINATE_TO_ORIGIN): metros, Y para cima, transladadas. Conversão para o modelo:
//   modelo_m = (x − t0, −(z − t2), y − t1), t = translação da matriz de coordenação; direções: (dx, −dz, dy).
// Verificado com IfcOpenShell em IFC4 e IFC4X3_ADD2 (pilar girado 30°, unidades em mm).

const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=v=>{const l=Math.hypot(v[0],v[1],v[2])||1;return[v[0]/l,v[1]/l,v[2]/l]};
const tf=(m,p)=>[m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12],m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13],m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]];
const tfDir=(m,v)=>norm([m[0]*v[0]+m[4]*v[1]+m[8]*v[2],m[1]*v[0]+m[5]*v[1]+m[9]*v[2],m[2]*v[0]+m[6]*v[1]+m[10]*v[2]]);

// triângulos da malha em coordenadas do visualizador; matrix = mesh.matrixWorld.elements (coluna-maior)
export function worldTriangles(positions,index,matrix,normals=null){
  const out=[],n=index?index.length:positions.length/3,at=i=>index?index[i]:i;
  for(let k=0;k+2<n;k+=3){
    const ids=[at(k),at(k+1),at(k+2)],P=ids.map(i=>tf(matrix,[positions[i*3],positions[i*3+1],positions[i*3+2]]));
    let g=cross(sub(P[1],P[0]),sub(P[2],P[0]));const area=Math.hypot(...g)/2;if(area<1e-12){out.push({P,n:[0,0,0],area:0});continue}g=norm(g); // degenerado fica no lugar: índice = faceIndex do three.js
    if(normals){const a=ids.reduce((s,i)=>[s[0]+normals[i*3],s[1]+normals[i*3+1],s[2]+normals[i*3+2]],[0,0,0]),an=tfDir(matrix,a);if(dot(an,g)<0)g=g.map(v=>-v)}
    out.push({P,n:g,area});
  }
  return out;
}
/**
 * Face plana que contém o triângulo clicado: todos os triângulos coplanares (normal e plano) da malha.
 * Moldura: n = normal para fora; ex = "direita" de quem olha a face (cima × n, com cima = +Y do visualizador = +Z do modelo);
 * faces horizontais usam a maior direção da face. rot gira ex em passos de 90° em torno de n.
 */
export function planarFace(tris,hitTri,{rot=0,angTol=.999,distTol=.002}={}){
  const t0=tris[hitTri];if(!t0)return null;const n=t0.n,d0=dot(n,t0.P[0]);
  const face=tris.filter(t=>dot(t.n,n)>angTol&&t.P.every(p=>Math.abs(dot(n,p)-d0)<distTol));
  const pts=face.flatMap(t=>t.P);
  let ex;
  if(Math.abs(n[1])<.9)ex=norm(cross([0,1,0],n));
  else{ // horizontal: maior aresta da face (direção dominante)
    let best=null,bl=0;for(const t of face)for(let i=0;i<3;i++){const e=sub(t.P[(i+1)%3],t.P[i]),l=Math.hypot(...e);if(l>bl){bl=l;best=e}}
    ex=norm(sub(best,best.map((_,i)=>dot(best,n)*n[i])));
  }
  for(let k=0;k<((rot%4)+4)%4;k++)ex=norm(cross(n,ex)); // +90° em torno de n
  const ey=cross(n,ex); // para cima na face
  let u0=Infinity,u1=-Infinity,v0=Infinity,v1=-Infinity;for(const p of pts){const u=dot(p,ex),v=dot(p,ey);u0=Math.min(u0,u);u1=Math.max(u1,u);v0=Math.min(v0,v);v1=Math.max(v1,v)}
  const origin=[0,1,2].map(i=>ex[i]*u0+ey[i]*v1+n[i]*d0); // canto superior esquerdo do retângulo envolvente
  return{origin,ex,ey,n,width:u1-u0,height:v1-v0,area:face.reduce((s,t)=>s+t.area,0),triangles:face};
}
// visualizador (m) → modelo (unidades do modelo)
export function viewerToModel(p,coordination,unitMeters=1){
  const t=coordination?[coordination[12],coordination[13],coordination[14]]:[0,0,0];
  return[(p[0]-t[0])/unitMeters,-(p[2]-t[2])/unitMeters,(p[1]-t[1])/unitMeters];
}
export const viewerDirToModel=v=>norm([v[0],-v[2],v[1]]);
export function faceToModel(F,coordination,unitMeters=1){
  return{origin:viewerToModel(F.origin,coordination,unitMeters),ex:viewerDirToModel(F.ex),n:viewerDirToModel(F.n)};
}
// ponto do plano da face (u, v em mm; v para baixo) → visualizador (m)
export const facePoint=(F,u,v,h=0)=>[0,1,2].map(i=>F.origin[i]+F.ex[i]*u/1000-F.ey[i]*v/1000+F.n[i]*h/1000);

/**
 * Imagem processada (px) → plano da face (mm). fit: "contain" encaixa a imagem inteira na face, centralizada;
 * "metric": usa a escala/perspectiva da foto (homografia ou mm/px), com a origem no canto do retângulo de referência.
 * dx, dy deslocam (mm, direita/baixo); mirror espelha horizontalmente (foto tirada do outro lado).
 */
export function imageToFace({W,H,faceWmm,faceHmm,fit="contain",metric=null,dx=0,dy=0,mirror=false}){
  let map;
  if(fit==="metric"&&metric)map=(x,y)=>metric.map(x,y);
  else{const s=Math.min(faceWmm/W,faceHmm/H),ox=(faceWmm-W*s)/2,oy=(faceHmm-H*s)/2;map=(x,y)=>[ox+x*s,oy+y*s]}
  return(x,y)=>{const[u,v]=map(x,y);return[(mirror?faceWmm-u:u)+dx,v+dy]};
}
