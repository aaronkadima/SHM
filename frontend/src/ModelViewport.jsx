import React,{useEffect,useRef,useState} from "react";
import * as THREE from "three";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js";
import {OBJLoader} from "three/addons/loaders/OBJLoader.js";
import {PLYLoader} from "three/addons/loaders/PLYLoader.js";
import {STLLoader} from "three/addons/loaders/STLLoader.js";
import {SVGRenderer} from "three/addons/renderers/SVGRenderer.js";
import {standaloneGltfIssue} from "./modelAssetValidation.js";
import {parseSpatialAsset,spatialExtension} from "./spatialAsset.js";
import {registeredPointColors,projectPathologyToPoints,buildSpatialPathologyRecords,CDM3_PATHOLOGY_PRIORITY} from "./cdm3RegisteredProjection.js";

const CLASS_COLORS={
  0:[.58,.62,.64],1:[.63,.66,.68],2:[.48,.37,.24],
  3:[.46,.68,.30],4:[.27,.58,.22],5:[.12,.42,.16],
  6:[.62,.62,.62],7:[.25,.25,.25],9:[.15,.48,.76],
  10:[.40,.40,.40],11:[.36,.36,.36],13:[.72,.60,.24],
  17:[.90,.46,.16]
};
function classificationColors(values){
  if(!values?.length)return null;
  const out=new Float32Array(values.length*3);
  for(let i=0;i<values.length;i++){
    const c=CLASS_COLORS[values[i]]||[.55,.60,.63];
    out[i*3]=c[0];out[i*3+1]=c[1];out[i*3+2]=c[2];
  }
  return out;
}
function intensityColors(values){
  if(!values?.length)return null;
  let min=Infinity,max=-Infinity;
  for(const v of values){const n=Number(v);if(Number.isFinite(n)){if(n<min)min=n;if(n>max)max=n}}
  if(!Number.isFinite(min)||!Number.isFinite(max))return null;
  const span=Math.max(max-min,1);
  const out=new Float32Array(values.length*3);
  for(let i=0;i<values.length;i++){
    const q=Math.max(0,Math.min(1,(Number(values[i])-min)/span));
    const g=.12+.88*Math.sqrt(q);
    out[i*3]=g;out[i*3+1]=g;out[i*3+2]=g;
  }
  return out;
}
function elevationColors(positions){
  const count=(positions?.length||0)/3;if(!count)return null;
  let min=Infinity,max=-Infinity;
  for(let i=2;i<positions.length;i+=3){const z=positions[i];if(z<min)min=z;if(z>max)max=z}
  const span=Math.max(max-min,1e-9),out=new Float32Array(count*3);
  for(let i=0;i<count;i++){
    const t=Math.max(0,Math.min(1,(positions[i*3+2]-min)/span));
    out[i*3]=.12+.78*t;
    out[i*3+1]=.35+.48*(1-Math.abs(t-.5)*2);
    out[i*3+2]=.82-.62*t;
  }
  return out;
}
function visualColors(parsed,mode,registeredColors=null,pathologyColors=null){
  if(mode==="pathology_3d"&&pathologyColors)return pathologyColors;
  if(mode==="registered_rgb"&&registeredColors)return registeredColors;
  if(mode==="rgb"&&parsed.colors)return parsed.colors;
  if(mode==="intensity"&&parsed.intensities)return intensityColors(parsed.intensities);
  if(mode==="classification"&&parsed.classifications)return classificationColors(parsed.classifications);
  return elevationColors(parsed.positions);
}
function pointModes(parsed,hasRegistered=false,hasPathology=false){
  return [
    ...(hasPathology?[{id:"pathology_3d",label:"Patologias 3D"}]:[]),
    ...(hasRegistered?[{id:"registered_rgb",label:"RGB registrado"}]:[]),
    ...(parsed.colors?[{id:"rgb",label:"RGB"}]:[]),
    ...(parsed.intensities?[{id:"intensity",label:"Intensidade"}]:[]),
    ...(parsed.classifications?[{id:"classification",label:"Classificação"}]:[]),
    {id:"elevation",label:"Elevação Z"}
  ];
}
async function imagePixels(file){
  if(!file)throw new Error("Imagem RGB externa ausente.");
  if(typeof createImageBitmap==="function"){
    const bitmap=await createImageBitmap(file);
    try{
      const canvas=document.createElement("canvas");canvas.width=bitmap.width;canvas.height=bitmap.height;
      const ctx=canvas.getContext("2d",{willReadFrequently:true});
      if(!ctx)throw new Error("Canvas 2D indisponível.");
      ctx.drawImage(bitmap,0,0);
      return {width:bitmap.width,height:bitmap.height,data:ctx.getImageData(0,0,bitmap.width,bitmap.height).data};
    }finally{bitmap.close?.()}
  }
  const url=URL.createObjectURL(file);
  try{
    const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error("Falha ao decodificar imagem RGB."));img.src=url});
    const canvas=document.createElement("canvas");canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const ctx=canvas.getContext("2d",{willReadFrequently:true});
    if(!ctx)throw new Error("Canvas 2D indisponível.");
    ctx.drawImage(image,0,0);
    return {width:canvas.width,height:canvas.height,data:ctx.getImageData(0,0,canvas.width,canvas.height).data};
  }finally{URL.revokeObjectURL(url)}
}
export default function ModelViewport({file,pickEnabled=false,onPointPick=null,rgbReferenceFile=null,registration=null,rgbPathologyAnalysis=null,onSpatialPathologyRecords=null}){
  const mount=useRef(null),view=useRef(null),pickEnabledRef=useRef(pickEnabled),onPointPickRef=useRef(onPointPick),onSpatialPathologyRecordsRef=useRef(onSpatialPathologyRecords);
  const[error,setError]=useState(""),[fallback,setFallback]=useState(false),[loading,setLoading]=useState(false),[loadProgress,setLoadProgress]=useState(null);
  const[modes,setModes]=useState([]),[mode,setMode]=useState("elevation"),[spatialNotice,setSpatialNotice]=useState(""),[pathologyStats,setPathologyStats]=useState(null);
  useEffect(()=>{pickEnabledRef.current=pickEnabled},[pickEnabled]);
  useEffect(()=>{onPointPickRef.current=onPointPick},[onPointPick]);
  useEffect(()=>{onSpatialPathologyRecordsRef.current=onSpatialPathologyRecords},[onSpatialPathologyRecords]);
  useEffect(()=>{
    if(!file||!mount.current)return;
    setError("");setFallback(false);setLoading(true);setLoadProgress(null);setModes([]);setSpatialNotice("");setPathologyStats(null);
    const el=mount.current,scene=new THREE.Scene();scene.background=new THREE.Color(0xdce4e7);
    const camera=new THREE.PerspectiveCamera(45,1,.01,100000);
    const pickMarkers=new THREE.Group();scene.add(pickMarkers);
    let renderer,vectorFallback=false,dirty=true;
    try{renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2))}
    catch{renderer=new SVGRenderer();vectorFallback=true;setFallback(true)}
    el.appendChild(renderer.domElement);
    const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
    scene.add(new THREE.HemisphereLight(0xffffff,0x8195a0,2));
    const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(3,5,7);scene.add(light);
    const resize=()=>{const w=Math.max(1,el.clientWidth),h=Math.max(1,el.clientHeight);camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);dirty=true};
    const observer=new ResizeObserver(resize);observer.observe(el);resize();
    let disposed=false,model=null,urlRevoked=false;const url=URL.createObjectURL(file),ext=file.name.split(".").pop().toLowerCase();
    const releaseUrl=()=>{if(!urlRevoked){URL.revokeObjectURL(url);urlRevoked=true}};
    const disposeMaterial=material=>{if(!material)return;for(const value of Object.values(material)){if(value?.isTexture)value.dispose?.()}material.dispose?.()};
    const fit=(obj,extras={})=>{
      if(disposed){releaseUrl();return}model=obj;releaseUrl();setLoading(false);setLoadProgress(100);
      if(vectorFallback)obj.traverse?.(n=>{if(n.isMesh){
        const originals=Array.isArray(n.material)?n.material:[n.material];
        const source=originals[0];
        const replacement=new THREE.MeshBasicMaterial({color:source?.color?.clone()||new THREE.Color(0x689aa4),side:THREE.DoubleSide});
        originals.forEach(disposeMaterial);
        n.material=replacement;
      }});
      scene.add(obj);
      const bounds=new THREE.Box3().setFromObject(obj),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
      if(!Number.isFinite(size.length())||size.length()===0){scene.remove(obj);fail(new Error("Geometria vazia."));return}
      const radius=Math.max(size.length(),.01)*1.35;
      view.current={camera,controls,center:center.clone(),radius,...extras};
      controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(radius,radius*.65,radius));camera.near=Math.max(.001,size.length()/10000);camera.far=Math.max(100,size.length()*100);camera.updateProjectionMatrix();controls.update();dirty=true
    };
    const fail=e=>{releaseUrl();if(!disposed){setLoading(false);setLoadProgress(null);setError("Não foi possível abrir o ativo espacial/3D: "+(e?.message||String(e)))} };
    const onProgress=event=>{if(disposed)return;const total=Number(event?.total)||0,loaded=Number(event?.loaded)||0;setLoadProgress(total>0?Math.max(0,Math.min(99,Math.round(loaded/total*100))):null)};
    const loadSpatial=async()=>{
      try{
        const parsed=await parseSpatialAsset(file,{maxPoints:250000});
        if(disposed)return;
        let registeredColors=null,pathologyColors=null;
        const available=pointModes(parsed,false,false);
        const preferred=parsed.colors?"rgb":parsed.intensities?"intensity":parsed.classifications?"classification":"elevation";
        setModes(available);setMode(preferred);
        const extension=spatialExtension(file);
        setSpatialNotice(parsed.colors
          ?"RGB por ponto ativo · segmentação visual pode combinar cor + geometria."
          :extension==="ifc"
            ?"IFC sem textura raster no preview · use geometria/semântica; patologias visuais exigem imagem ou nuvem RGB registrada."
            :"Nuvem sem RGB · geometria/intensidade/classificação não substituem textura para fissuras, corrosão e manchas."
        );
        const geometry=new THREE.BufferGeometry();
        geometry.setAttribute("position",new THREE.BufferAttribute(parsed.positions,3));
        const initialColors=visualColors(parsed,preferred,registeredColors,pathologyColors);
        if(initialColors)geometry.setAttribute("color",new THREE.BufferAttribute(initialColors,3));
        geometry.computeBoundingSphere();
        const radius=Math.max(Number(geometry.boundingSphere?.radius)||1,1e-6);
        const pointSize=Math.max(radius/420,0.001);
        const material=new THREE.PointsMaterial({size:pointSize,sizeAttenuation:true,vertexColors:!!initialColors,color:0xffffff});
        const points=new THREE.Points(geometry,material);
        const applyPointMode=nextMode=>{
          const colors=visualColors(parsed,nextMode,registeredColors,pathologyColors);
          if(colors){
            geometry.setAttribute("color",new THREE.BufferAttribute(colors,3));
            geometry.attributes.color.needsUpdate=true;material.vertexColors=true;
          }else{
            geometry.deleteAttribute("color");material.vertexColors=false;material.color.setHex(0x6f858e);
          }
          material.needsUpdate=true;dirty=true;
        };
        const setRegisteredColors=payload=>{
          registeredColors=payload?.colors||null;
          if(!registeredColors)return;
          setModes(pointModes(parsed,true,!!pathologyColors));
          setMode("registered_rgb");
          applyPointMode("registered_rgb");
          setSpatialNotice("RGB externo projetado pela pose registrada · "+Number(payload.colored||0).toLocaleString("pt-BR")+"/"+Number(payload.total||0).toLocaleString("pt-BR")+" pontos receberam cor da imagem.");
        };
        const setPathologyProjection=payload=>{
          pathologyColors=payload?.colors||null;
          if(!pathologyColors)return;
          setModes(pointModes(parsed,!!registeredColors,true));
          setPathologyStats(payload);
          setMode("pathology_3d");
          applyPointMode("pathology_3d");
          setSpatialNotice("Segmentação espacial CDM-3 · "+Number(payload.matched_points||0).toLocaleString("pt-BR")+" pontos classificados entre "+Number(payload.visible_points??payload.in_frame_points??0).toLocaleString("pt-BR")+" pontos visíveis após teste de profundidade.");
        };
        points.userData.spatialAsset={
          extension,
          ...parsed.metadata,
          bounds:parsed.bounds,
          sampled_points:parsed.sampled_points,
          active_visual_channel:preferred
        };
        fit(points,{setPointMode:applyPointMode,setRegisteredColors,setPathologyProjection,parsed,points,pointModes:available});
      }catch(e){fail(e)}
    };
    const handlePointPick=e=>{
      if(!pickEnabledRef.current||!model||!onPointPickRef.current)return;
      const rect=renderer.domElement.getBoundingClientRect();
      if(rect.width<1||rect.height<1)return;
      const mouse=new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-((e.clientY-rect.top)/rect.height*2-1));
      const raycaster=new THREE.Raycaster();raycaster.params.Points.threshold=Math.max((view.current?.radius||1)/180,.002);raycaster.setFromCamera(mouse,camera);
      const hit=raycaster.intersectObject(model,true).find(item=>item.object?.isPoints&&Number.isInteger(item.index));
      if(!hit)return;
      const attr=hit.object.geometry?.getAttribute("position");if(!attr)return;
      const centered=[attr.getX(hit.index),attr.getY(hit.index),attr.getZ(hit.index)];
      const origin=hit.object.userData?.spatialAsset?.bounds?.center||[0,0,0];
      const xyz=[centered[0]+Number(origin[0]||0),centered[1]+Number(origin[1]||0),centered[2]+Number(origin[2]||0)];
      const markerRadius=Math.max((view.current?.radius||1)/120,.004);
      const marker=new THREE.Mesh(new THREE.SphereGeometry(markerRadius,10,8),new THREE.MeshBasicMaterial({color:0xf0a93c}));
      marker.position.set(...centered);pickMarkers.add(marker);dirty=true;
      onPointPickRef.current({xyz,index:hit.index,distance:Number(hit.distance||0)});
    };
    renderer.domElement.addEventListener("click",handlePointPick);
    const loadGltf=async()=>{
      if(ext==="gltf"){
        let text;
        try{text=await file.text()}catch(e){fail(new Error("Não foi possível ler o arquivo GLTF: "+(e?.message||String(e))));return}
        if(disposed){releaseUrl();return}
        try{
          const issue=standaloneGltfIssue(text);
          if(issue){fail(new Error(issue));return}
        }catch(e){fail(new Error("GLTF inválido: "+(e?.message||String(e))));return}
      }
      if(disposed){releaseUrl();return}
      new GLTFLoader().load(url,g=>fit(g.scene),onProgress,fail);
    };
    try{
      if(spatialExtension(file))loadSpatial().catch(fail);
      else if(ext==="glb"||ext==="gltf")loadGltf().catch(fail);
      else if(ext==="obj")new OBJLoader().load(url,fit,onProgress,fail);
      else if(ext==="stl"||ext==="ply"){
        const loader=ext==="stl"?new STLLoader():new PLYLoader();
        loader.load(url,g=>{g.computeVertexNormals();fit(new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:0x8aaeb3,side:THREE.DoubleSide})))},onProgress,fail)
      }else fail(new Error("Formato 3D não suportado pelo visualizador."));
    }catch(e){fail(e)}
    controls.addEventListener("change",()=>{dirty=true});
    let animation;const draw=()=>{animation=requestAnimationFrame(draw);controls.update();if(!vectorFallback||dirty){renderer.render(scene,camera);dirty=false}};draw();
    return()=>{disposed=true;view.current=null;cancelAnimationFrame(animation);observer.disconnect();controls.dispose();renderer.domElement.removeEventListener("click",handlePointPick);scene.remove(model);model?.traverse?.(n=>{n.geometry?.dispose();if(n.material){const materials=Array.isArray(n.material)?n.material:[n.material];materials.forEach(disposeMaterial)}});pickMarkers.traverse(n=>{n.geometry?.dispose?.();disposeMaterial(n.material)});renderer.dispose?.();renderer.domElement.remove();releaseUrl()}
  },[file]);
  useEffect(()=>{
    if(!rgbReferenceFile||!registration?.registration||!view.current?.parsed||!view.current?.setRegisteredColors)return;
    let cancelled=false;
    imagePixels(rgbReferenceFile)
      .then(pixels=>{
        const parsed=view.current?.parsed;
        const registered=registeredPointColors(parsed,registration,pixels);
        const pathology=rgbPathologyAnalysis
          ?projectPathologyToPoints(parsed,registration,rgbPathologyAnalysis,pixels.width,pixels.height)
          :null;
        const records=rgbPathologyAnalysis
          ?buildSpatialPathologyRecords(parsed,registration,rgbPathologyAnalysis,pixels.width,pixels.height,{sourceImageName:rgbReferenceFile.name})
          :[];
        return {registered,pathology,records};
      })
      .then(({registered,pathology,records})=>{
        if(cancelled)return;
        if(registered)view.current?.setRegisteredColors?.(registered);
        if(pathology)view.current?.setPathologyProjection?.(pathology);
        onSpatialPathologyRecordsRef.current?.(records);
      })
      .catch(e=>{if(!cancelled)setError("Falha ao projetar RGB/patologias no 3D: "+(e?.message||String(e)))});
    return()=>{cancelled=true};
  },[rgbReferenceFile,registration,rgbPathologyAnalysis,file]);
  function setView(direction){
    const data=view.current;if(!data)return;
    const {camera,controls,center,radius}=data;
    const offsets={perspective:[1,.65,1],front:[0,0,1],top:[0,1,0],side:[1,0,0]};
    const offset=new THREE.Vector3(...offsets[direction]).normalize().multiplyScalar(radius*1.7);
    camera.position.copy(center).add(offset);camera.up.set(0,1,0);
    if(direction==="top")camera.up.set(0,0,-1);
    controls.target.copy(center);camera.lookAt(center);controls.update()
  }
  function setPointMode(next){
    setMode(next);view.current?.setPointMode?.(next);
  }
  return <div className={"modelViewport "+(pickEnabled?"pointPickMode":"")} ref={mount} role="region" aria-label={pickEnabled?"Visualizador espacial 3D; selecione o ponto correspondente":"Visualizador espacial 3D do arquivo importado"} aria-busy={loading}>
    {loading&&<div className="modelLoading" role="status" aria-live="polite"><b>Carregando ativo espacial / 3D</b><span>{loadProgress==null?"Preparando geometria…":loadProgress+"%"}</span>{loadProgress!=null&&<i><b style={{width:loadProgress+"%"}}/></i>}</div>}
    {error&&<div className="modelError" role="alert">{error}</div>}
    <div className="modelViews" aria-label="Vistas do modelo 3D"><button disabled={loading||!!error} onClick={()=>setView("perspective")}>Perspectiva</button><button disabled={loading||!!error} onClick={()=>setView("front")}>Frontal</button><button disabled={loading||!!error} onClick={()=>setView("top")}>Superior</button><button disabled={loading||!!error} onClick={()=>setView("side")}>Lateral</button></div>
    {modes.length>0&&<div className="pointCloudModes" aria-label="Canal visual da nuvem de pontos"><label htmlFor="point-cloud-mode">Visual</label><select id="point-cloud-mode" value={mode} onChange={e=>setPointMode(e.target.value)}>{modes.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select><span>{spatialNotice}</span></div>}{pathologyStats&&<div className="pointPathologyLegend" aria-label="Resumo da segmentação patológica 3D"><b>CDM-3 · pontos patológicos</b>{CDM3_PATHOLOGY_PRIORITY.filter(cls=>Number(pathologyStats.counts?.[cls]||0)>0).map(cls=><span key={cls}><i data-pathology={cls}/>{cls.replace("spalling_dark","desplacamento").replace("exposed_rebar","armadura exposta").replace("corrosion_rust","corrosão").replace("efflorescence_white","eflorescência").replace("cracks","fissuras")} <strong>{Number(pathologyStats.counts?.[cls]||0).toLocaleString("pt-BR")}</strong></span>)}</div>}
    {pickEnabled&&<div className="modelPickHint">Selecione na nuvem o ponto correspondente ao pixel marcado</div>}
    {fallback&&<div className="modelFallback">Visualização vetorial · WebGL indisponível</div>}
    <div className="modelHint">3D · arraste para orbitar · roda para ampliar · botão direito para deslocar</div>
  </div>
}
