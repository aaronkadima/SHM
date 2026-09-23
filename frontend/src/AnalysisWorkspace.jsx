import React,{useEffect,useRef,useState} from "react";
import {Camera,ChevronLeft,ChevronRight,Download,ImagePlus,Layers3,Maximize2,Minus,Move,Play,Plus,Settings2,X,VideoOff} from "lucide-react";
import ModelViewport from "./ModelViewport.jsx";

const MODEL_EXT=/\.(glb|gltf|obj|ply|stl)$/i;
export function detectAsset(file){
  if(!file)return null;
  const name=file.name.toLowerCase();
  if(file.type.startsWith("image/")||/\.(png|jpe?g|webp|tiff?|bmp)$/i.test(name))return "2d";
  if(MODEL_EXT.test(name))return "3d";
  return "unknown";
}

export default function AnalysisWorkspace({file,prev,res,busy,progress,selected,engines,onFile,onRun,onCancel,onSettings,error,onExport}){
  const [kind,setKind]=useState(null),[layersOpen,setLayersOpen]=useState(true),[resultOpen,setResultOpen]=useState(true);
  const [cameraOpen,setCameraOpen]=useState(false),[cameraError,setCameraError]=useState("");
  const [zoom,setZoom]=useState(1),[opacity,setOpacity]=useState(.75),[comparison,setComparison]=useState("overlay");
  const [active,setActive]=useState(null),[visible,setVisible]=useState({}),[position,setPosition]=useState({x:0,y:0});
  const [startAt,setStartAt]=useState(null),[elapsed,setElapsed]=useState(0);
  const video=useRef(null),stream=useRef(null),picker=useRef(null),surface=useRef(null),drag=useRef(null);
  useEffect(()=>setKind(detectAsset(file)),[file]);
  useEffect(()=>{if(busy)setStartAt(Date.now());else setStartAt(null)},[busy]);
  useEffect(()=>{if(!startAt)return;const tick=()=>setElapsed(Math.floor((Date.now()-startAt)/1000));tick();const id=setInterval(tick,250);return()=>clearInterval(id)},[startAt]);
  useEffect(()=>{if(!cameraOpen)return;let cancelled=false;setCameraError("");
    if(!navigator.mediaDevices?.getUserMedia){setCameraError("Câmera indisponível neste navegador ou fora de uma conexão segura.");return}
    navigator.mediaDevices.getUserMedia({video:true,audio:false}).then(s=>{
      if(cancelled){s.getTracks().forEach(t=>t.stop());return}
      stream.current=s;if(video.current){video.current.srcObject=s;video.current.play().catch(()=>{})}
    }).catch(e=>setCameraError("Não foi possível acessar a câmera: "+e.message));
    return()=>{cancelled=true;stream.current?.getTracks().forEach(t=>t.stop());stream.current=null}
  },[cameraOpen]);
  const results=res?.results||[];
  const shown=results.filter(r=>visible[r.engine_id]!==false);
  const chosen=shown.find(r=>r.engine_id===active)||shown[0];
  const image=chosen?.overlay_png_base64?"data:image/png;base64,"+chosen.overlay_png_base64:null;
  const boxes=(chosen?.detections||[]).filter(d=>Array.isArray(d.box)&&d.box.length>=4);
  const pct=progress?.total?Math.min(100,Math.round(progress.completed/progress.total*100)):0;
  function capture(){const v=video.current;if(!v?.videoWidth)return;const c=document.createElement("canvas");c.width=v.videoWidth;c.height=v.videoHeight;c.getContext("2d").drawImage(v,0,0);c.toBlob(blob=>{if(blob)onFile(new File([blob],"captura-"+Date.now()+".png",{type:"image/png"}))},"image/png");setCameraOpen(false)}
  function dragStart(e){if(e.target.closest("button"))return;drag.current={x:e.clientX-position.x,y:e.clientY-position.y};e.currentTarget.setPointerCapture(e.pointerId)}
  function dragMove(e){if(drag.current)setPosition({x:e.clientX-drag.current.x,y:e.clientY-drag.current.y})}
  function dragEnd(){drag.current=null}
  return <section className="analysisEditor" aria-label="Workspace de análise">
    <div className="editorTop">
      <div><strong>Workspace de inspeção</strong><span>{file?.name||"Nenhum arquivo aberto"} {kind&&"· "+kind.toUpperCase()}</span></div>
      <div className="editorTopActions">
        <input ref={picker} hidden type="file" accept="image/*,.glb,.gltf,.obj,.ply,.stl" onChange={e=>onFile(e.target.files?.[0]||null)}/>
        <button onClick={()=>picker.current?.click()}><ImagePlus size={16}/> Importar</button>
        <button onClick={()=>setCameraOpen(true)}><Camera size={16}/> Câmera</button>
        <button onClick={onSettings}><Settings2 size={16}/> Configurar motores</button>
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
      </aside>}
      <div className="editorViewport" ref={surface}>
        {!layersOpen&&<button className="editorExpand" onClick={()=>setLayersOpen(true)} title="Mostrar camadas"><ChevronRight size={18}/></button>}
        {!file?<div className="editorEmpty"><ImagePlus size={38}/><h2>Importe uma imagem ou modelo</h2><p>A imagem 2D pode ser analisada pelos motores selecionados. O tipo de arquivo é reconhecido automaticamente.</p><button onClick={()=>picker.current?.click()}>Selecionar arquivo</button></div>:
        kind==="3d"?<ModelViewport file={file}/>:
        <div className={"editorImage "+(comparison==="side"?"editorSide":"")} style={{transform:`scale(${zoom})`}}>
          <div className="editorImagePane"><img src={prev} alt="Arquivo original da inspeção"/></div>
          {image&&<div className="editorImagePane overlayPane"><img src={image} alt={"Sobreposição de "+chosen.name} style={{opacity}}/>
            {boxes.map((d,i)=><button key={i} className={"editorDetection "+(active===chosen.engine_id?"selected":"")} title={d.label||"Achado"} style={{left:(d.box[0]/res.image_width*100)+"%",top:(d.box[1]/res.image_height*100)+"%",width:((d.box[2]-d.box[0])/res.image_width*100)+"%",height:((d.box[3]-d.box[1])/res.image_height*100)+"%"}} onClick={()=>setActive(chosen.engine_id)}/>)}
          </div>}
        </div>}
        {file&&kind==="2d"&&<div className="editorZoom"><button onClick={()=>setZoom(z=>Math.max(.25,z-.25))}>−</button><span>{Math.round(zoom*100)}%</span><button onClick={()=>setZoom(z=>Math.min(4,z+.25))}>＋</button></div>}
        {resultOpen&&(busy||results.length>0)&&<div className="editorFloating" style={{transform:`translate(${position.x}px,${position.y}px)`}}>
          <div className="editorFloatHead" onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={dragEnd}><b>Resultados</b><button title="Recolher resultados" onClick={()=>setResultOpen(false)}><Minus size={16}/></button></div>
          {busy&&<div className="editorProgress"><span>{progress?.current_engine||"Processando motores"} · {progress?.completed||0}/{progress?.total||selected.length}</span><strong>{String(Math.floor(elapsed/60)).padStart(2,"0")}:{String(elapsed%60).padStart(2,"0")}</strong><div><i style={{width:pct+"%"}}/></div>{onCancel&&<button onClick={onCancel}>Cancelar</button>}</div>}
          {results.map(r=><button key={r.engine_id} className={"editorResultRow "+(chosen?.engine_id===r.engine_id?"active":"")} onClick={()=>{setActive(r.engine_id);setVisible(v=>({...v,[r.engine_id]:true}))}}><span>{r.name}</span><b>{r.detections?.length||0} achados</b><small>{Number(r.latency_ms||0).toFixed(0)} ms</small></button>)}
          {results.length>0&&<div className="editorCompare"><button className={comparison==="overlay"?"active":""} onClick={()=>setComparison("overlay")}>Sobrepor</button><button className={comparison==="side"?"active":""} onClick={()=>setComparison("side")}>Lado a lado</button><button onClick={onExport} title="Exportar JSON"><Download size={15}/></button></div>}
        </div>}
        {!resultOpen&&results.length>0&&<button className="editorResultsTab" onClick={()=>setResultOpen(true)}>Resultados · {results.length}</button>}
      </div>
    </div>
    <div className="editorStatus"><span>{error|| (kind==="3d"?"Arquivo 3D reconhecido; análise 2D indisponível":selected.length?selected.length+" motor(es) configurado(s)":"Configure os motores antes de analisar")}</span><span>Zoom {Math.round(zoom*100)}% · {kind?.toUpperCase()||"—"}</span></div>
    {cameraOpen&&<div className="editorModalBackdrop"><div className="editorCamera"><header><b>Modo câmera</b><button title="Fechar câmera" onClick={()=>setCameraOpen(false)}><X size={19}/></button></header>{cameraError?<p role="alert">{cameraError}</p>:<video ref={video} autoPlay playsInline muted/>}<footer><span>{cameraError?"Verifique a permissão da câmera":"Prévia ao vivo · capture um quadro para análise 2D"}</span><button onClick={capture} disabled={!!cameraError}><Camera size={16}/> Capturar imagem</button></footer></div></div>}
  </section>
}
