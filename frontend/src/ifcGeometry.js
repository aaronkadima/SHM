import * as THREE from "three";

const WEB_IFC_VERSION="0.0.77";
const WEB_IFC_MODULE=`https://cdn.jsdelivr.net/npm/web-ifc@${WEB_IFC_VERSION}/+esm`;
const WEB_IFC_WASM=`https://cdn.jsdelivr.net/npm/web-ifc@${WEB_IFC_VERSION}/`;

function vectorItems(vector){
  const out=[];
  for(let i=0;i<vector.size();i++)out.push(vector.get(i));
  return out;
}

function materialFor(color){
  const r=Number.isFinite(color?.x)?color.x:.58;
  const g=Number.isFinite(color?.y)?color.y:.64;
  const b=Number.isFinite(color?.z)?color.z:.67;
  const a=Number.isFinite(color?.w)?color.w:1;
  return new THREE.MeshStandardMaterial({
    color:new THREE.Color(r,g,b),
    opacity:a,
    transparent:a<.999,
    side:THREE.DoubleSide,
    roughness:.82,
    metalness:.04
  });
}

function geometryFromIfc(api,modelID,geometryExpressID){
  const source=api.GetGeometry(modelID,geometryExpressID);
  const vertices=api.GetVertexArray(source.GetVertexData(),source.GetVertexDataSize());
  const indices=api.GetIndexArray(source.GetIndexData(),source.GetIndexDataSize());
  if(!vertices?.length||!indices?.length)return null;
  const count=Math.floor(vertices.length/6);
  const positions=new Float32Array(count*3),normals=new Float32Array(count*3);
  for(let i=0;i<count;i++){
    positions[i*3]=vertices[i*6];
    positions[i*3+1]=vertices[i*6+1];
    positions[i*3+2]=vertices[i*6+2];
    normals[i*3]=vertices[i*6+3];
    normals[i*3+1]=vertices[i*6+4];
    normals[i*3+2]=vertices[i*6+5];
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.BufferAttribute(positions,3));
  geometry.setAttribute("normal",new THREE.BufferAttribute(normals,3));
  geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(indices),1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export async function loadIfcThreeModel(file,{onProgress=null}={}){
  onProgress?.({loaded:5,total:100});
  const WebIFC=await import(/* @vite-ignore */ WEB_IFC_MODULE);
  const api=new WebIFC.IfcAPI();
  api.SetWasmPath(WEB_IFC_WASM,true);
  await api.Init();
  const bytes=new Uint8Array(await file.arrayBuffer());
  onProgress?.({loaded:18,total:100});
  let modelID=null;
  try{
    modelID=api.OpenModel(bytes,{
      COORDINATE_TO_ORIGIN:true,
      USE_FAST_BOOLS:true,
      CIRCLE_SEGMENTS_LOW:8,
      CIRCLE_SEGMENTS_MEDIUM:16,
      CIRCLE_SEGMENTS_HIGH:24
    });
    const root=new THREE.Group();
    const elementIndex={};
    root.name=file.name;
    const meshes=api.LoadAllGeometry(modelID);
    const meshCount=meshes.size();
    let geometryCount=0,triangleCount=0;
    for(let i=0;i<meshCount;i++){
      const flat=meshes.get(i);
      const placements=vectorItems(flat.geometries);
      for(const placed of placements){
        const geometry=geometryFromIfc(api,modelID,placed.geometryExpressID);
        if(!geometry)continue;
        const mesh=new THREE.Mesh(geometry,materialFor(placed.color));
        mesh.matrixAutoUpdate=false;
        mesh.matrix.fromArray(placed.flatTransformation);
        let line=null;
        try{line=api.GetLine(modelID,flat.expressID,false)}catch{}
        const info={expressID:flat.expressID,geometryExpressID:placed.geometryExpressID,type:line?.type||null,globalId:line?.GlobalId?.value||null,name:line?.Name?.value||null,description:line?.Description?.value||null,objectType:line?.ObjectType?.value||null};
        mesh.userData.ifc=info;
        if(!elementIndex[flat.expressID])elementIndex[flat.expressID]={...info,meshCount:0};
        elementIndex[flat.expressID].meshCount++;
        root.add(mesh);
        geometryCount++;
        triangleCount+=Math.floor((geometry.index?.count||0)/3);
      }
      if(i%25===0)onProgress?.({loaded:18+Math.round(72*(i+1)/Math.max(meshCount,1)),total:100});
    }
    let alignments=[];
    try{alignments=api.GetAllAlignments?.(modelID)||[]}catch{}
    if(!root.children.length)throw new Error("O IFC foi lido, mas nenhuma geometria tessellável foi produzida.");
    root.userData.ifc={
      engine:"web-ifc",
      engineVersion:api.GetVersion?.()||WEB_IFC_VERSION,
      meshCount,
      geometryCount,
      triangleCount,
      alignmentCount:Array.isArray(alignments)?alignments.length:0,
      coordinateToOrigin:true,
      elements:Object.values(elementIndex),
      elementCount:Object.keys(elementIndex).length
    };
    onProgress?.({loaded:100,total:100});
    return root;
  }finally{
    if(modelID!=null)try{api.CloseModel(modelID)}catch{}
  }
}
