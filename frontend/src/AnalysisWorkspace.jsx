import React,{Suspense,useEffect,useRef,useState} from "react";
import {Camera,ChevronLeft,ChevronRight,Download,ImagePlus,Layers3,Maximize2,Minus,Play,Plus,Settings2,X} from "lucide-react";
const ModelViewport=React.lazy(()=>import("./ModelViewport.jsx"));

const MODEL_EXT=/\.(glb|gltf|obj|ply|stl)$/i;
export function detectAsset(file){
  if(!file)return null;
  const name=file.name.toLowerCase();
  if(file.type.startsWith("image/")||/\.(png|jpe?g|webp|tiff?|bmp)$/i.test(name))return "2d";
  if(MODEL_EXT.test(name))return "3d";
  return "unknown";
}

export default function AnalysisWorkspace({file,prev,res,busy,progress,selected,selectedEngines=[],onFile,onRun,onCancel,onSettings,error,onExport,onExportCsv,onExportMap}){
  const [kind,setKind]=useState(null),[layersOpen,setLayersOpen]=useState(()=>window.innerWidth>=760),[resultOpen,setResultOpen]=useState(true);
  const [cameraOpen,setCameraOpen]=useState(false),[cameraError,setCameraError]=useState(""),[cameraReady,setCameraReady]=useState(false);
  const [zoom,setZoom]=useState(1),[opacity,setOpacity]=useState(.75),[comparison,setComparison]=useState("overlay");
  const [active,setActive]=useState(null),[visible,setVisible]=useState({}),[position,setPosition]=useState({x:0,y:0});
  const [selectedDetection,setSelectedDetection]=useState(null);
  const [imageSize,setImageSize]=useState({width:1,height:1});
  const [viewportSize,setViewportSize]=useState({width:1000,height:700});
  const [startAt,setStartAt]=useState(null),[elapsed,setElapsed]=useState(0),[durationMs,setDurationMs]=useState(null);
  const runStarted=useRef(null),narrowLayout=useRef(window.innerWidth<760);
  const video=useRef(null),stream=useRef(null),picker=useRef(null),surface=useRef(null),floating=useRef(null),drag=useRef(null);
  useEffect(()=>setKind(detectAsset(file)),[file]);
  useEffect(()=>{setSelectedDetection(null);setActive(null);setVisible({});setZoom(1)},[file]);
  useEffect(()=>{if(!surface.current)return;const observer=new ResizeObserver(([entry])=>setViewportSize({width:entry.contentRect.width,height:entry.contentRect.height}));observer.observe(surface.current);return()=>observer.disconnect()},[]);
  useEffect(()=>{const onResize=()=>{const narrow=window.innerWidth<760;if(narrow&&!narrowLayout.current)setLayersOpen(false);narrowLayout.current=narrow};window.addEventListener("resize",onResize);return()=>window.removeEventListener("resize",onResize)},[]);
  useEffect(()=>{if(busy){const now=performance.now();runStarted.current=now;setStartAt(now);setElapsed(0);setDurationMs(null)}
    else{if(runStarted.current!=null){setDurationMs(performance.now()-runStarted.current);runStarted.current=null}setStartAt(null)}},[busy]);
  useEffect(()=>{if(startAt==null)return;const tick=()=>setElapsed(Math.floor((performance.now()-startAt)/1000));tick();const id=setInterval(tick,250);return()=>clearInterval(id)},[startAt]);
  useEffect(()=>{if(!cameraOpen)return;let cancelled=false;setCameraError("");setCameraReady(false);
    if(!navigator.mediaDevices?.getUserMedia){setCameraError("Câmera indisponível neste navegador ou fora de uma conexão segura.");return}
    navigator.mediaDevices.getUserMedia({video:true,audio:false}).then(s=>{
      if(cancelled){s.getTracks().forEach(t=>t.stop());return}
      stream.current=s;if(video.current){video.current.srcObject=s;video.current.play().catch(e=>setCameraError("Não foi possível iniciar a prévia: "+e.message))}
    }).catch(e=>setCameraError("Não foi possível acessar a câmera: "+e.message));
    return()=>{cancelled=true;stream.current?.getTracks().forEach(t=>t.stop());stream.current=null}
  },[cameraOpen]);
  useEffect(()=>{if(!cameraOpen)return;const onKey=e=>{if(e.key==="Escape")setCameraOpen(false)};window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey)},[cameraOpen]);
  const results=res?.results||[];
  const shown=results.filter(r=>visible[r.engine_id]!==false);
  const chosen=shown.find(r=>r.engine_id===active)||shown[0];
  const image=chosen?.overlay_png_base64?"data:image/png;base64,"+chosen.overlay_png_base64:null;
  const boxes=(chosen?.detections||[]).filter(d=>Array.isArray(d.box)&&d.box.length>=4);
  const detail=selectedDetection&&chosen&&selectedDetection.engineId===chosen.engine_id?boxes[selectedDetection.index]:null;
  const panes=comparison==="side"?2:1;
  const fit=Math.min(viewportSize.width*.83/(imageSize.width*panes),viewportSize.height*.8/imageSize.height);
  const displaySize={width:Math.max(1,imageSize.width*fit*panes),height:Math.max(1,imageSize.height*fit)};
  const pct=progress?.total?Math.min(100,Math.round(progress.completed/progress.total*100)):0;
  const selectedEnginePreview=selectedEngines.slice(0,8),hiddenSelectedEngines=Math.max(0,selectedEngines.length-selectedEnginePreview.length);
  function capture(){const v=video.current;if(!v?.videoWidth)return;const c=document.createElement("canvas");c.width=v.videoWidth;c.height=v.videoHeight;c.getContext("2d").drawImage(v,0,0);c.toBlob(blob=>{if(blob){onFile(new File([blob],"captura-"+Date.now()+".png",{type:"image/png"}));setCameraOpen(false)}else setCameraError("Falha ao converter o quadro capturado.")},"image/png")}
  function dragStart(e){if(e.target.closest("button"))return;const host=surface.current?.getBoundingClientRect(),panel=floating.current?.getBoundingClientRect();if(!host||!panel)return;drag.current={startX:e.clientX,startY:e.clientY,startPosX:position.x,startPosY:position.y,minDx:host.left-panel.left+8,maxDx:host.right-panel.right-8,minDy:host.top-panel.top+8,maxDy:host.bottom-panel.bottom-8};e.currentTarget.setPointerCapture(e.pointerId)}
  function dragMove(e){if(!drag.current)return;const d=drag.current,dx=Math.max(d.minDx,Math.min(d.maxDx,e.clientX-d.startX)),dy=Math.max(d.minDy,Math.min(d.maxDy,e.clientY-d.startY));setPosition({x:d.startPosX+dx,y:d.startPosY+dy})}
  function dragEnd(){drag.current=null}
  return <section className="analysisEditor" aria-label="Workspace de análise">
    <div className="editorTop">
      <div className="editorBrand"><span className="editorMark">S</span><strong>SHM Studio</strong><span className="editorMenus"><span>Arquivo</span><span>Editar</span><span>Visualizar</span><span>Análise</span></span></div>
      <div className="editorFileTitle">{file?.name||"Nova inspeção"} {kind&&"· "+kind.toUpperCase()}</div>
      <div className="editorTopActions">
        <input ref={picker} hidden type="file" accept="image/*,.glb,.gltf,.obj,.ply,.stl" onChange={e=>onFile(e.target.files?.[0]||null)}/>
        <button onClick={()=>picker.current?.click()}><ImagePlus size={16}/> Importar</button>
        <button onClick={onSettings}><Settings2 size={16}/> Configurar</button>
        <button className="editorPrimary" disabled={!file||kind!=="2d"||!selected.length||busy} onClick={onRun}><Play size={16}/> Analisar</button>
      </div>
    </div>
    <div className="editorBody">
      <div className="editorTools" aria-label="Ferramentas"><button title="Mostrar ou ocultar camadas" onClick={()=>setLayersOpen(v=>!v)}><Layers3/></button><button title="Ampliar" onClick={()=>setZoom(z=>Math.min(4,z+.25))}><Plus/></button><button title="Reduzir" onClick={()=>setZoom(z=>Math.max(.25,z-.25))}><Minus/></button><button title="Ajustar imagem" onClick={()=>setZoom(1)}><Maximize2/></button><button title="Modo câmera" onClick={()=>setCameraOpen(true)}><Camera/></button></div>
      {layersOpen&&<aside className="editorLayers"><div className="editorPanelTitle"><b>Camadas</b><button title="Recolher camadas" onClick={()=>setLayersOpen(false)}><ChevronLeft size={17}/></button></div>
        <div className="layerRow"><span>◉</span> Arquivo original</div>
        {results.map(r=><label className="layerRow" key={r.engine_id}><input type="checkbox" checked={visible[r.engine_id]!==false} onChange={e=>setVisible(v=>({...v,[r.engine_id]:e.target.checked}))}/>{r.name}</label>)}
        <div className="editorPanelTitle"><b>Propriedades</b></div>
        <p>Tipo reconhecido: <b>{kind==="2d"?"Imagem 2D":kind==="3d"?"Modelo 3D":"Indefinido"}</b></p>
        {kind==="unknown"&&<div className="editorTypeChoice"><button onClick={()=>setKind("2d")}>Tratar como 2D</button><button onClick={()=>setKind("3d")}>Tratar como 3D</button></div>}
        <p>Sobreposição: {Math.round(opacity*100)}%</p><input aria-label="Opacidade da sobreposição" type="range" min="0" max="1" step=".05" value={opacity} onChange={e=>setOpacity(Number(e.target.value))}/>
        <div className="editorSelectedEngines" aria-label="Motores selecionados"><span>Motores ativos</span>{selectedEnginePreview.length?selectedEnginePreview.map(e=><small key={e.id} title={e.name}>{e.name}</small>):<small>Nenhum motor</small>}{hiddenSelectedEngines>0&&<small className="editorSelectedMore" title={selectedEngines.slice(8).map(e=>e.name).join(", ")}>+ {hiddenSelectedEngines} outro(s)</small>}</div>
      </aside>}
      <div className="editorViewport" ref={surface}>
        {!layersOpen&&<button className="editorExpand" onClick={()=>setLayersOpen(true)} title="Mostrar camadas"><ChevronRight size={18}/></button>}
        <button className="editorCameraEntry" onClick={()=>setCameraOpen(true)}><Camera size={16}/> Câmera</button>
        {file&&<div className="editorTypeBadge">{kind==="2d"?"▧  2D detectado":kind==="3d"?"◇  3D detectado":"Tipo indefinido"}</div>}
        {file&&kind==="3d"?<Suspense fallback={<div className="editorEmpty">Preparando visualizador 3D…</div>}><ModelViewport file={file}/></Suspense>:<div className="editorCanvasScroll">
        {!file?<div className="editorEmpty"><ImagePlus size={38}/><h2>Importe uma imagem ou modelo</h2><p>A imagem 2D pode ser analisada pelos motores selecionados. O tipo de arquivo é reconhecido automaticamente.</p><button onClick={()=>picker.current?.click()}>Selecionar arquivo</button></div>:
        <div className={"editorImage "+(comparison==="side"?"editorSide":"")} style={{transform:`scale(${zoom})`,width:displaySize.width,height:displaySize.height}}>
          <div className="editorImagePane"><img src={prev} alt="Arquivo original da inspeção" onLoad={e=>setImageSize({width:e.currentTarget.naturalWidth||1,height:e.currentTarget.naturalHeight||1})}/></div>
          {image&&<div className="editorImagePane overlayPane"><img src={image} alt={"Sobreposição de "+chosen.name} style={{opacity}}/>
            {boxes.map((d,i)=><button key={i} className={"editorDetection "+(selectedDetection?.engineId===chosen.engine_id&&selectedDetection.index===i?"selected":"")} title={d.label||"Achado"} aria-label={`Achado ${i+1}: ${d.label||"sem classificação"}`} style={{left:(d.box[0]/res.image_width*100)+"%",top:(d.box[1]/res.image_height*100)+"%",width:((d.box[2]-d.box[0])/res.image_width*100)+"%",height:((d.box[3]-d.box[1])/res.image_height*100)+"%"}} onClick={()=>{setActive(chosen.engine_id);setSelectedDetection({engineId:chosen.engine_id,index:i})}}/>)}
          </div>}
        </div>}
        </div>}
        {file&&kind==="2d"&&<div className="editorZoom"><button aria-label="Reduzir zoom" onClick={()=>setZoom(z=>Math.max(.25,z-.25))}>−</button><span>{Math.round(zoom*100)}%</span><button aria-label="Ampliar zoom" onClick={()=>setZoom(z=>Math.min(4,z+.25))}><Plus size={15}/></button></div>}
        {resultOpen&&(busy||results.length>0)&&<div ref={floating} className="editorFloating" style={{transform:`translate(${position.x}px,${position.y}px)`}}>
          <div className="editorFloatHead" onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={dragEnd}><b>Resultados</b><button title="Recolher resultados" onClick={()=>setResultOpen(false)}><Minus size={16}/></button></div>
          {busy&&<div className="editorProgress"><span>{progress?.current_engine||"Processando motores"} · {progress?.completed||0}/{progress?.total||selected.length}</span><strong>{String(Math.floor(elapsed/60)).padStart(2,"0")}:{String(elapsed%60).padStart(2,"0")}</strong><div><i style={{width:pct+"%"}}/></div>{onCancel&&<button onClick={onCancel}>Cancelar</button>}</div>}
          {!busy&&res&&durationMs!=null&&<div className="editorRunTime">Tempo medido da rodada: <b>{(durationMs/1000).toFixed(2)} s</b></div>}
          {results.map(r=><button key={r.engine_id} className={"editorResultRow "+(chosen?.engine_id===r.engine_id?"active":"")} onClick={()=>{setActive(r.engine_id);setVisible(v=>({...v,[r.engine_id]:true}))}}><span>{r.name}</span><b>{r.detections?.length||0} achados</b><small>{Number(r.latency_ms||0).toFixed(0)} ms</small></button>)}
          {detail&&<div className="editorFinding"><b>{detail.label||detail.canonical_label||"Achado"} #{selectedDetection.index+1}</b><span>Motor: {chosen.name}</span><span>Confiança: {detail.score==null?"não informada":(Number(detail.score)*100).toFixed(1)+"%"}</span><span>Coordenadas: {detail.box.map(v=>Math.round(v)).join(", ")} px</span></div>}
          {results.length>0&&<div className="editorCompare"><button className={comparison==="overlay"?"active":""} onClick={()=>setComparison("overlay")}>Sobrepor</button><button className={comparison==="side"?"active":""} onClick={()=>setComparison("side")}>Lado a lado</button><button onClick={onExport} title="Exportar JSON">JSON</button><button onClick={onExportCsv} title="Exportar CSV">CSV</button>{res.consensus_overlay_png_base64&&<button onClick={onExportMap} title="Exportar mapa"><Download size={15}/></button>}</div>}
        </div>}
        {!resultOpen&&results.length>0&&<button className="editorResultsTab" onClick={()=>setResultOpen(true)}>Resultados · {results.length}</button>}
      </div>
    </div>
    <div className="editorStatus"><span>{error||(kind==="3d"?"Arquivo 3D reconhecido; análise 2D indisponível":busy?"Análise em execução":file?"Arquivo pronto para análise":"Importe um arquivo para iniciar")}</span><span>Zoom {Math.round(zoom*100)}% · {kind?.toUpperCase()||"—"}</span></div>
    {cameraOpen&&<div className="editorModalBackdrop"><div className="editorCamera"><header><b>Modo câmera</b><button title="Fechar câmera" onClick={()=>setCameraOpen(false)}><X size={19}/></button></header>{cameraError&&<p role="alert">{cameraError}</p>}<video ref={video} autoPlay playsInline muted onLoadedMetadata={()=>setCameraReady(true)}/><footer><span>{cameraError?"Verifique a permissão da câmera":cameraReady?"Prévia ao vivo · capture um quadro para análise 2D":"Aguardando câmera…"}</span><button onClick={capture} disabled={!!cameraError||!cameraReady}><Camera size={16}/> Capturar imagem</button></footer></div></div>}
  </section>
}
