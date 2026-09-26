const GEOMETRY_CLASSES=[
  {id:0,key:"low_support",label:"Baixa vizinhança",color:[.48,.52,.55]},
  {id:1,key:"linear_edge",label:"Linear / borda",color:[.94,.58,.16]},
  {id:2,key:"planar_surface",label:"Superfície planar",color:[.18,.62,.72]},
  {id:3,key:"irregular_volume",label:"Geometria irregular",color:[.82,.25,.20]},
  {id:4,key:"transitional",label:"Transição",color:[.52,.42,.72]}
];

function clamp(value,min,max){return Math.max(min,Math.min(max,value))}
function voxelKey(x,y,z){return x+","+y+","+z}
function emptyAggregate(ix=0,iy=0,iz=0){
  return {ix,iy,iz,n:0,sx:0,sy:0,sz:0,sxx:0,syy:0,szz:0,sxy:0,sxz:0,syz:0,indices:[]};
}
function addPoint(cell,x,y,z,index){
  cell.n++;cell.sx+=x;cell.sy+=y;cell.sz+=z;
  cell.sxx+=x*x;cell.syy+=y*y;cell.szz+=z*z;
  cell.sxy+=x*y;cell.sxz+=x*z;cell.syz+=y*z;
  cell.indices.push(index);
}
function addAggregate(target,source){
  if(!source)return;
  target.n+=source.n;target.sx+=source.sx;target.sy+=source.sy;target.sz+=source.sz;
  target.sxx+=source.sxx;target.syy+=source.syy;target.szz+=source.szz;
  target.sxy+=source.sxy;target.sxz+=source.sxz;target.syz+=source.syz;
}
function symmetricEigenvalues(a,b,c,d,e,f){
  // Symmetric matrix [[a,b,c],[b,d,e],[c,e,f]], returned descending.
  const p1=b*b+c*c+e*e;
  if(p1<=1e-24)return [Math.max(a,d,f,0),Math.max(0,[a,d,f].sort((x,y)=>y-x)[1]),Math.max(Math.min(a,d,f),0)];
  const q=(a+d+f)/3;
  const aq=a-q,dq=d-q,fq=f-q;
  const p2=aq*aq+dq*dq+fq*fq+2*p1;
  const p=Math.sqrt(Math.max(p2/6,0));
  if(p<=1e-12)return [Math.max(q,0),Math.max(q,0),Math.max(q,0)];
  const ba=aq/p,bd=dq/p,bf=fq/p,bb=b/p,bc=c/p,be=e/p;
  const det=ba*bd*bf+2*bb*bc*be-ba*be*be-bd*bc*bc-bf*bb*bb;
  const r=clamp(det/2,-1,1),phi=Math.acos(r)/3;
  const l1=q+2*p*Math.cos(phi);
  const l3=q+2*p*Math.cos(phi+2*Math.PI/3);
  const l2=3*q-l1-l3;
  return [l1,l2,l3].sort((x,y)=>y-x).map(v=>Math.max(0,v));
}
function classifyAggregate(local,minimumNeighbors){
  if(local.n<minimumNeighbors)return 0;
  const n=local.n,mx=local.sx/n,my=local.sy/n,mz=local.sz/n;
  const xx=Math.max(0,local.sxx/n-mx*mx),yy=Math.max(0,local.syy/n-my*my),zz=Math.max(0,local.szz/n-mz*mz);
  const xy=local.sxy/n-mx*my,xz=local.sxz/n-mx*mz,yz=local.syz/n-my*mz;
  const [l1,l2,l3]=symmetricEigenvalues(xx,xy,xz,yy,yz,zz);
  if(l1<=1e-14)return 0;
  const linearity=(l1-l2)/l1,planarity=(l2-l3)/l1,scattering=l3/l1;
  if(scattering>=.16)return 3;
  if(linearity>=.58&&planarity<.36)return 1;
  if(planarity>=.38&&scattering<=.12)return 2;
  return 4;
}

export function buildGeometricSegmentation(parsed,{minimumNeighbors=6,targetPointsPerVoxel=12}={}){
  const positions=parsed?.positions,count=Math.floor((positions?.length||0)/3);
  if(!count)return null;
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for(let i=0;i<count;i++){
    const x=Number(positions[i*3]),y=Number(positions[i*3+1]),z=Number(positions[i*3+2]);
    if(![x,y,z].every(Number.isFinite))continue;
    if(x<minX)minX=x;if(y<minY)minY=y;if(z<minZ)minZ=z;
    if(x>maxX)maxX=x;if(y>maxY)maxY=y;if(z>maxZ)maxZ=z;
  }
  const dx=maxX-minX,dy=maxY-minY,dz=maxZ-minZ,diagonal=Math.hypot(dx,dy,dz);
  if(!Number.isFinite(diagonal)||diagonal<=1e-12){
    const colors=new Float32Array(count*3),pointLabels=new Uint8Array(count);
    const c=GEOMETRY_CLASSES[0].color;
    for(let i=0;i<count;i++){colors[i*3]=c[0];colors[i*3+1]=c[1];colors[i*3+2]=c[2]}
    return {colors,pointLabels,classes:GEOMETRY_CLASSES,summary:{method:"voxel_neighborhood_covariance",point_count:count,voxel_size:0,occupied_voxels:1,minimum_neighbors:minimumNeighbors,counts:{low_support:count,linear_edge:0,planar_surface:0,irregular_volume:0,transitional:0},fractions:{low_support:1,linear_edge:0,planar_surface:0,irregular_volume:0,transitional:0},interpretation:"Classificação geométrica local; não representa diagnóstico de patologia visual."}};
  }
  const bins=clamp(Math.round(Math.cbrt(Math.max(1,count/Math.max(1,targetPointsPerVoxel)))*2.6),8,72);
  const voxelSize=Math.max(diagonal/bins,1e-9),cells=new Map();
  for(let i=0;i<count;i++){
    const x=Number(positions[i*3]),y=Number(positions[i*3+1]),z=Number(positions[i*3+2]);
    const ix=Math.floor((x-minX)/voxelSize),iy=Math.floor((y-minY)/voxelSize),iz=Math.floor((z-minZ)/voxelSize);
    const key=voxelKey(ix,iy,iz);let cell=cells.get(key);
    if(!cell){cell=emptyAggregate(ix,iy,iz);cells.set(key,cell)}
    addPoint(cell,x,y,z,i);
  }
  const pointLabels=new Uint8Array(count),colors=new Float32Array(count*3);
  const counts=Object.fromEntries(GEOMETRY_CLASSES.map(row=>[row.key,0]));
  for(const cell of cells.values()){
    const local=emptyAggregate();
    for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      addAggregate(local,cells.get(voxelKey(cell.ix+dx,cell.iy+dy,cell.iz+dz)));
    }
    const classId=classifyAggregate(local,minimumNeighbors),cls=GEOMETRY_CLASSES[classId];
    for(const index of cell.indices){
      pointLabels[index]=classId;colors[index*3]=cls.color[0];colors[index*3+1]=cls.color[1];colors[index*3+2]=cls.color[2];counts[cls.key]++;
    }
  }
  const fractions=Object.fromEntries(Object.entries(counts).map(([key,value])=>[key,value/Math.max(1,count)]));
  return {
    colors,pointLabels,classes:GEOMETRY_CLASSES,
    summary:{
      method:"voxel_neighborhood_covariance",
      point_count:count,
      voxel_size:voxelSize,
      occupied_voxels:cells.size,
      neighborhood_radius_voxels:1,
      minimum_neighbors:minimumNeighbors,
      counts,fractions,
      interpretation:"Classificação geométrica local de forma/superfície; não representa diagnóstico de fissura, corrosão, manchas ou outra patologia visual."
    }
  };
}

export const CDM3_GEOMETRY_CLASSES=GEOMETRY_CLASSES;
