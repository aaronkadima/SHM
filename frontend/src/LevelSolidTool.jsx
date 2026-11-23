import React,{useEffect,useMemo,useRef,useState}from"react";
import*as THREE from"three";
import{OrbitControls}from"three/addons/controls/OrbitControls.js";
import{Download,FolderOpen,RotateCw,Server,X}from"lucide-react";
import{__cdm4Test,cdm4Config,cdm4StageData}from"./cdm4Core.js";
import{loadIfcThreeModel}from"./ifcGeometry.js";
import{worldTriangles,planarFace,faceToModel,imageToFace}from"./ifcFace.js";
import{buildLevelSolid}from"./levelSolid.js";
import{parseStep,lengthUnitMeters,writeLevelSolid,levelColor}from"./ifcLevelSolidWriter.js";
import{makeMetric,quadOk}from"./measureGeometry.js";
import{parseLevels}from"./CutLevelTool.jsx";
import{tr}from"./i18n.js";

// Sólido de níveis (CDM-4 → IFC): as curvas de nível do potencial do walker viram camadas empilhadas sobre a face
// de um elemento do modelo IFC, como o bloco-diagrama de uma topografia. É a FORMA APROXIMADA do dano para achá-lo
// no modelo; a altura de cada camada é nível × espessura escolhida, não profundidade medida.
const SCHEMA_OK=s=>/^IFC4($|X3)/i.test(String(s||""));
const save=(name,blob)=>{const u=URL.createObjectURL(blob),a=document.createElement("a");a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),4000)};
const fmt=(v,d=2)=>Number(v).toLocaleString(undefined,{maximumFractionDigits:d,minimumFractionDigits:d});

export default function LevelSolidTool({active,onClose,result,file,options,serverEndpoint=null}){
  const host=useRef(null),three=useRef(null),[ifc,setIfc]=useState(null),[loading,setLoading]=useState(0),[err,setErr]=useState(""),[busy,setBusy]=useState("");
  const[pick,setPick]=useState(null),[rot,setRot]=useState(0),[levels,setLevels]=useState("0,1; 0,3; 0,5; 0,7; 0,9"),[layerMm,setLayerMm]=useState(10),[minArea,setMinArea]=useState(4);
  const[fit,setFit]=useState("contain"),[dx,setDx]=useState(0),[dy,setDy]=useState(0),[mirror,setMirror]=useState(false),[done,setDone]=useState("");
  const W=result?.metrics?.processed_width||0,H=result?.metrics?.processed_height||0,[rw,setRw]=useState(null);
  // potencial do walker: o guardado no resultado ou, se não houver, recalculado com a mesma configuração (como no Corte de nível)
  useEffect(()=>{if(!active||!result||!file||!W)return;let live=true;
    (async()=>{try{let d=cdm4StageData(result);
      if(!d?.random_walker?.prob){const bmp=await createImageBitmap(file,{imageOrientation:"from-image"}),c=document.createElement("canvas");c.width=W;c.height=H;const ctx=c.getContext("2d",{willReadFrequently:true});ctx.drawImage(bmp,0,0,W,H);bmp.close?.();
        const cfg=cdm4Config({...(options||{}),cdm_context_filter:"off",cdm4_flow:result?.metrics?.protocol?.flow||options?.cdm4_flow});cfg.returnStages=true;d={...__cdm4Test.computeCdm4Core(ctx.getImageData(0,0,W,H),null,cfg).stages}}
      if(live)setRw(d?.random_walker?.prob?d.random_walker:false)}catch(e){if(live){setRw(false);setErr(e?.message||String(e))}}})();
    return()=>{live=false}},[active,result,file,W,H]);
  const metric=useMemo(()=>{if(!file)return null;try{const v=JSON.parse(localStorage.getItem("shmScale:"+file.name+":"+file.size)||"null");
    return v?.quad?.length===4&&quadOk(v.quad)?{m:makeMetric({kind:"homography",quad:v.quad,wmm:+v.wmm,hmm:+v.hmm}),label:`${v.wmm} × ${v.hmm} mm`}:null}catch{return null}},[file,active]);
  useEffect(()=>{if(!active)return;const k=e=>{if(e.key==="Escape"&&e.target?.tagName!=="INPUT"){e.stopPropagation();onClose?.()}};window.addEventListener("keydown",k,true);return()=>window.removeEventListener("keydown",k,true)},[active,onClose]);

  // ---------- cena 3D ----------
  useEffect(()=>{
    if(!active||!host.current)return;const el=host.current;let renderer;
    try{renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true})}catch{setErr(tr("WebGL indisponível neste navegador."));return}
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));el.appendChild(renderer.domElement);
    const scene=new THREE.Scene();scene.background=new THREE.Color(0xeef2f4);
    const camera=new THREE.PerspectiveCamera(45,1,.01,5000);camera.position.set(8,6,8);
    const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.screenSpacePanning=true;
    scene.add(new THREE.HemisphereLight(0xffffff,0x6b7a80,1.1));const sun=new THREE.DirectionalLight(0xffffff,1.4);sun.position.set(5,10,7);scene.add(sun);
    const model=new THREE.Group(),solid=new THREE.Group(),mark=new THREE.Group();scene.add(model,solid,mark);
    const size=()=>{const w=el.clientWidth||800,h=el.clientHeight||600;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()};size();
    const ro=new ResizeObserver(size);ro.observe(el);let raf=0;const loop=()=>{raf=requestAnimationFrame(loop);controls.update();renderer.render(scene,camera)};loop();
    const ray=new THREE.Raycaster();let down=null;
    const onDown=e=>{down=[e.clientX,e.clientY]};
    const onUp=e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>4)return;const r=renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);
      const hit=ray.intersectObjects(model.children,false).find(h=>h.object.userData?.ifc?.globalId);if(hit)three.current?.onPick?.(hit)};
    renderer.domElement.addEventListener("pointerdown",onDown);renderer.domElement.addEventListener("pointerup",onUp);
    three.current={scene,camera,controls,model,solid,mark,renderer};
    return()=>{cancelAnimationFrame(raf);ro.disconnect();controls.dispose();renderer.dispose();renderer.domElement.remove();three.current=null};
  },[active]);
  const fitView=obj=>{const T=three.current;if(!T)return;const b=new THREE.Box3().setFromObject(obj);if(b.isEmpty())return;const c=b.getCenter(new THREE.Vector3()),r=b.getSize(new THREE.Vector3()).length()/2||1;
    T.controls.target.copy(c);T.camera.position.copy(c.clone().add(new THREE.Vector3(1,.7,1).normalize().multiplyScalar(r*3.2)));T.camera.near=r/500;T.camera.far=r*80;T.camera.updateProjectionMatrix()};

  async function openIfc(f){
    setErr("");setDone("");setPick(null);if(!f)return;
    try{
      setLoading(1);const text=await f.text(),M=parseStep(text);
      if(!SCHEMA_OK(M.schema))throw new Error(tr("Esquema não suportado")+`: ${M.schema||"?"} — ${tr("use IFC4 ou IFC 4.3")}`);
      const group=await loadIfcThreeModel(f,{onProgress:p=>setLoading(Math.max(1,p.loaded))}),T=three.current;
      group.traverse(n=>{if(n.isMesh)n.updateMatrixWorld(true)});
      if(T){T.model.clear();T.solid.clear();T.mark.clear();while(group.children.length)T.model.add(group.children[0]);T.model.updateMatrixWorld(true);fitView(T.model)}
      setIfc({name:f.name,text,schema:M.schema,unitM:lengthUnitMeters(M),coordination:group.userData.ifc?.coordination||null,elements:group.userData.ifc?.elementCount||0});
    }catch(e){setErr(e?.message||String(e))}finally{setLoading(0)}
  }
  // clique: elemento + face plana sob o cursor
  useEffect(()=>{if(three.current)three.current.onPick=hit=>{const m=hit.object,g=m.geometry;m.updateMatrixWorld(true);
    const tris=worldTriangles(g.attributes.position.array,g.index?.array||null,m.matrixWorld.elements,g.attributes.normal?.array||null);
    setPick({tris,tri:hit.faceIndex,info:m.userData.ifc});setDone("")}},[ifc,active]);
  const face=useMemo(()=>pick?planarFace(pick.tris,pick.tri,{rot}):null,[pick,rot]);

  // sólido no plano da face
  const built=useMemo(()=>{
    if(!face||!rw?.prob||!W)return null;
    const lv=parseLevels(levels);if(!lv.length)return{error:tr("Informe ao menos um nível entre 0 e 1.")};
    const toPlane=imageToFace({W,H,faceWmm:face.width*1000,faceHmm:face.height*1000,fit:fit==="metric"&&metric?"metric":"contain",metric:metric?.m,dx:+dx||0,dy:+dy||0,mirror});
    const f=rw.f||Math.max(1,Math.round(W/rw.W));
    return buildLevelSolid({prob:rw.prob,W:rw.W,H:rw.H,f},toPlane,{levels:lv,layerMm:Math.max(.1,+layerMm||10),minAreaMm2:Math.max(0,+minArea||0)*1e4});
  },[face,rw,W,H,levels,layerMm,minArea,fit,metric,dx,dy,mirror]);

  // pré-visualização: face destacada + camadas extrudadas na moldura da face
  useEffect(()=>{const T=three.current;if(!T)return;T.mark.clear();T.solid.clear();if(!face)return;
    const pos=new Float32Array(face.triangles.flatMap(t=>t.P.flatMap(p=>[p[0]+face.n[0]*.0004,p[1]+face.n[1]*.0004,p[2]+face.n[2]*.0004]))),g=new THREE.BufferGeometry();
    g.setAttribute("position",new THREE.BufferAttribute(pos,3));T.mark.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:0x2a9db0,transparent:true,opacity:.28,side:THREE.DoubleSide,depthWrite:false})));
    if(!built?.regions)return;
    const basis=new THREE.Matrix4().makeBasis(new THREE.Vector3(...face.ex),new THREE.Vector3(...face.ey),new THREE.Vector3(...face.n)).setPosition(...face.origin);
    built.levels.forEach((t,k)=>{const[r,gg,b]=levelColor(k,built.levels.length),mat=new THREE.MeshStandardMaterial({color:new THREE.Color(r,gg,b),roughness:.7,side:THREE.DoubleSide});
      for(const R of built.regions)for(const L of R.layers){if(L.level!==t)continue;for(const p of L.polys){
        const sh=new THREE.Shape(p.outer.map(([u,v])=>new THREE.Vector2(u/1000,-v/1000)));sh.holes=p.holes.map(h=>new THREE.Path(h.map(([u,v])=>new THREE.Vector2(u/1000,-v/1000))));
        const geo=new THREE.ExtrudeGeometry(sh,{depth:(L.z1-L.z0)/1000,bevelEnabled:false,curveSegments:1});geo.translate(0,0,(L.z0+.5)/1000);
        const mesh=new THREE.Mesh(geo,mat);mesh.matrixAutoUpdate=false;mesh.matrix.copy(basis);T.solid.add(mesh)}}});
  },[face,built]);

  const payload=()=>({host_guid:pick.info.globalId,face:faceToModel(face,ifc.coordination,ifc.unitM),solid:built,
    meta:{className:tr("Desplacamento"),image:file?.name||"",scale:fit==="metric"&&metric?metric.label:tr("imagem encaixada na face"),date:new Date().toISOString().slice(0,10)}});
  const outName=()=>ifc.name.replace(/\.ifc$/i,"")+"_CDM4_forma_dano.ifc";
  function exportBrowser(){setErr("");try{const p=payload(),r=writeLevelSolid(ifc.text,{hostGuid:p.host_guid,face:p.face,solid:p.solid,meta:p.meta});
    save(outName(),new Blob([r.text],{type:"application/x-step"}));setDone(`${r.schema} · ${r.features.length} ${tr("características")} · ${r.relation} · ${r.predefinedType}`)}catch(e){setErr(e?.message||String(e))}}
  async function exportServer(){setErr("");setBusy("server");try{const base=serverEndpoint();const fd=new FormData();fd.append("ifc",new Blob([ifc.text],{type:"application/x-step"}),ifc.name);fd.append("payload_json",JSON.stringify(payload()));
    const r=await fetch(base+"/cdm3/ifc/level-solid",{method:"POST",body:fd});if(!r.ok)throw new Error(await r.text());save(outName(),await r.blob());
    setDone(`${r.headers.get("X-CDM4-Schema")||""} · ${r.headers.get("X-CDM4-Features")||"?"} ${tr("características")} · IfcOpenShell`)}catch(e){setErr(tr("Servidor")+": "+(e?.message||String(e)))}finally{setBusy("")}}

  if(!active)return null;
  const nFeat=built?.regions?.length||0,canExport=!!(ifc&&face&&nFeat&&pick?.info?.globalId);
  return <div className="solidTool" role="dialog" aria-label={tr("Sólido de níveis (IFC)")}>
    <aside className="solidToolSide">
      <header><b>{tr("Sólido de níveis (IFC)")}</b><button onClick={onClose} aria-label={tr("Fechar")}><X size={16}/></button></header>
      <p className="solidToolNote">{tr("Forma aproximada do dano para identificação visual no modelo. A altura de cada camada é o nível do potencial × a espessura escolhida; não é profundidade medida.")}</p>
      <label className="solidToolFile"><FolderOpen size={15}/><span>{ifc?ifc.name:tr("Abrir modelo IFC (IFC4 ou IFC 4.3)")}</span><input type="file" accept=".ifc" onChange={e=>openIfc(e.target.files?.[0])}/></label>
      {loading>0&&<div className="solidToolProgress"><i style={{width:loading+"%"}}/></div>}
      {ifc&&<small>{ifc.schema} · {ifc.elements} {tr("elementos")} · {tr("unidade")} {ifc.unitM===1?"m":ifc.unitM===.001?"mm":ifc.unitM+" m"}</small>}
      {rw===false&&<p className="solidToolErr">{tr("O random walker não gerou potencial nesta imagem.")}</p>}
      {ifc&&<div className="solidToolStep"><b>1 · {tr("Face")}</b>{face?<><span>{pick.info.name||pick.info.type} · {fmt(face.width)} × {fmt(face.height)} m</span>
        <button onClick={()=>setRot(r=>(r+1)%4)} title={tr("Gira a orientação da foto na face em 90°")}><RotateCw size={14}/>{rot*90}°</button>
        <label><input type="checkbox" checked={mirror} onChange={e=>setMirror(e.target.checked)}/>{tr("Espelhar (foto do lado oposto)")}</label></>:<span>{tr("Clique na face do elemento onde a foto foi tirada.")}</span>}</div>}
      {face&&<div className="solidToolStep"><b>2 · {tr("Posição da foto")}</b>
        <label><input type="radio" checked={fit!=="metric"||!metric} onChange={()=>setFit("contain")}/>{tr("Encaixar a imagem na face")}</label>
        <label title={metric?"":tr("Defina a escala por 4 pontos no Corte de nível")}><input type="radio" disabled={!metric} checked={fit==="metric"&&!!metric} onChange={()=>setFit("metric")}/>{tr("Usar a escala da foto")}{metric?` (${metric.label})`:" — "+tr("sem escala")}</label>
        <span className="solidToolRow">{tr("Deslocar")} →<input type="number" value={dx} onChange={e=>setDx(e.target.value)} aria-label={tr("Deslocamento horizontal (mm)")}/>↓<input type="number" value={dy} onChange={e=>setDy(e.target.value)} aria-label={tr("Deslocamento vertical (mm)")}/>mm</span></div>}
      {face&&<div className="solidToolStep"><b>3 · {tr("Camadas")}</b>
        <span className="solidToolRow">{tr("Níveis do walker")}<input className="wide" value={levels} onChange={e=>setLevels(e.target.value)} aria-label={tr("Níveis do walker")}/></span>
        <span className="solidToolRow">{tr("Espessura por camada")}<input type="number" min=".1" value={layerMm} onChange={e=>setLayerMm(e.target.value)} aria-label={tr("Espessura por camada (mm)")}/>mm</span>
        <span className="solidToolRow">{tr("Área mínima")}<input type="number" min="0" step=".5" value={minArea} onChange={e=>setMinArea(e.target.value)} aria-label={tr("Área mínima (dm²)")}/>dm²</span>
        {built?.error?<p className="solidToolErr">{built.error}</p>:built&&<div className="solidToolLegend">{built.levels.map((t,k)=>{const c=levelColor(k,built.levels.length).map(v=>Math.round(v*255));return <span key={t}><i style={{background:`rgb(${c})`}}/>u ≥ {String(t).replace(".",",")}</span>})}</div>}
        {built?.regions&&<small>{nFeat} {tr("regiões")} · {built.regions.map(R=>fmt((R.areaByLevel[0]?.area_mm2||0)/1e6,3)+" m²").join(" · ")}</small>}</div>}
      {face&&<div className="solidToolStep"><b>4 · {tr("Exportar")}</b>
        <button className="primary" disabled={!canExport} onClick={exportBrowser}><Download size={14}/>{tr("IFC (no navegador)")}</button>
        {serverEndpoint&&<button disabled={!canExport||busy==="server"} onClick={exportServer}><Server size={14}/>{busy==="server"?tr("Enviando…"):tr("IFC (servidor · IfcOpenShell)")}</button>}
        <small>{/X3/i.test(ifc?.schema)?tr("IFC 4.3: IfcSurfaceFeature DEFECT ligada ao elemento por IfcRelAdheresToElement."):tr("IFC4: IfcSurfaceFeature USERDEFINED (DEFECT) ligada ao elemento por IfcRelAggregates.")}</small></div>}
      {done&&<p className="solidToolOk">{tr("Arquivo gerado")}: {done}</p>}
      {err&&<p className="solidToolErr">{err}</p>}
    </aside>
    <div className="solidToolView" ref={host}>{!ifc&&!loading&&<div className="solidToolEmpty">{tr("Abra o IFC da estrutura para posicionar o sólido.")}</div>}</div>
  </div>;
}
