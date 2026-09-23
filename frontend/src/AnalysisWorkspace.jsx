import React,{Suspense,useEffect,useRef,useState} from "react";
import {Camera,ChevronLeft,ChevronRight,Download,ImagePlus,Layers3,Maximize2,Minus,Play,Plus,Settings2,X} from "lucide-react";
const ModelViewport=React.lazy(()=>import("./ModelViewport.jsx"));

const MODEL_EXT=/\.(glb|gltf|obj|ply|stl)$/i;
const TEMPORAL_ISSUE_LABELS={
  registration_unreliable:"registro geométrico não confiável",
  insufficient_overlap:"sobreposição espacial insuficiente",
  illumination_mismatch:"diferença excessiva de iluminação",
  sharpness_mismatch:"diferença excessiva de nitidez",
  exposure_clipping:"saturação/exposição inadequada"
};
const TEMPORAL_WARNING_LABELS={
  reduced_overlap:"sobreposição reduzida",
  illumination_difference:"diferença moderada de iluminação",
  sharpness_difference:"diferença moderada de nitidez",
  exposure_warning:"exposição próxima do limite",
  low_texture:"baixa textura para registro"
};
export function detectAsset(file){
  if(!file)return null;
  const name=file.name.toLowerCase();
  if(file.type.startsWith("image/")||/\.(png|jpe?g|webp|tiff?|bmp)$/i.test(name))return "2d";
  if(MODEL_EXT.test(name))return "3d";
  return "unknown";
}

export default function AnalysisWorkspace({file,prev,referenceFile,referencePrev,res,busy,progress,selected,onFile,onReferenceFile,onRun,onCancel,onSettings,error,onExport,onExportCsv,onExportMap,onExportCdm}){
  const [kind,setKind]=useState(null),[layersOpen,setLayersOpen]=useState(true),[resultOpen,setResultOpen]=useState(true);
  const [cameraOpen,setCameraOpen]=useState(false),[cameraError,setCameraError]=useState(""),[cameraReady,setCameraReady]=useState(false);
  const [zoom,setZoom]=useState(1),[opacity,setOpacity]=useState(.75),[comparison,setComparison]=useState("overlay"),[showRawT0,setShowRawT0]=useState(false);
  const [active,setActive]=useState(null),[visible,setVisible]=useState({}),[position,setPosition]=useState({x:0,y:0});
  const [selectedDetection,setSelectedDetection]=useState(null);
  const [imageSize,setImageSize]=useState({width:1,height:1});
  const [viewportSize,setViewportSize]=useState({width:1000,height:700});
  const [startAt,setStartAt]=useState(null),[elapsed,setElapsed]=useState(0),[durationMs,setDurationMs]=useState(null);
  const runStarted=useRef(null);
  const video=useRef(null),stream=useRef(null),picker=useRef(null),referencePicker=useRef(null),surface=useRef(null),drag=useRef(null);
  useEffect(()=>setKind(detectAsset(file)),[file]);
  useEffect(()=>{setSelectedDetection(null);setActive(null);setVisible({});setZoom(1);setShowRawT0(false)},[file,referenceFile]);
  useEffect(()=>{if(!surface.current)return;const observer=new ResizeObserver(([entry])=>setViewportSize({width:entry.contentRect.width,height:entry.contentRect.height}));observer.observe(surface.current);return()=>observer.disconnect()},[]);
  useEffect(()=>{if(busy)setResultOpen(true)},[busy]);
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
  const pathologyLayers=chosen?.engine_id==="cdm_1"?chosen.metrics?.layers||[]:[];
  const temporal=chosen?.engine_id==="cdm_1"?chosen.metrics?.temporal:null;
  const temporalAlignment=temporal?.alignment||null;
  const temporalQuality=temporal?.quality||null;
  const temporalAlignedPreview=temporal?.aligned_reference_png_base64?"data:image/png;base64,"+temporal.aligned_reference_png_base64:null;
  const temporalLayers=temporal?.enabled?temporal.layers||[]:[];
  const temporalStats=temporal?.stats||{};
  const temporalGrowth=Object.values(temporalStats).reduce((sum,row)=>sum+Number(row.growth_area_px2||0),0);
  const temporalReduction=Object.values(temporalStats).reduce((sum,row)=>sum+Number(row.reduction_area_px2||0),0);
  const temporalRegistrationWarning=temporalAlignment?.reason==="search_boundary_hit"
    ?"Registro t0→t1 rejeitado: o deslocamento estimado atingiu o limite da busca. Considere recaptura com enquadramento mais próximo ou revisão manual."
    :null;
  const temporalQualityNotes=[
    ...(temporalQuality?.issues||[]).map(x=>TEMPORAL_ISSUE_LABELS[x]||x),
    ...(temporalQuality?.warnings||[]).map(x=>TEMPORAL_WARNING_LABELS[x]||x)
  ];
  const temporalQualityLabel=temporalQuality?.status==="fail"
    ?"NÃO VALIDADA para quantificação temporal"
    :temporalQuality?.status==="warning"
      ?"Válida com ressalvas"
      :temporalQuality?.status==="pass"?"Qualidade temporal aprovada":null;
  const cdmSummary=chosen?.engine_id==="cdm_1"?chosen.metrics?.summary:null;
  const cdmRating=cdmSummary?.condition_rating;
  const image=pathologyLayers.length?null:chosen?.overlay_png_base64?"data:image/png;base64,"+chosen.overlay_png_base64:null;
  const boxes=(chosen?.detections||[]).filter(d=>Array.isArray(d.box)&&d.box.length>=4&&(!pathologyLayers.length||visible["cdm_1:"+d.label]!==false));
  const detail=selectedDetection&&chosen&&selectedDetection.engineId===chosen.engine_id?boxes[selectedDetection.index]:null;
  const panes=comparison==="side"||comparison==="temporal"?2:1;
  const fit=Math.min(viewportSize.width*.83/(imageSize.width*panes),viewportSize.height*.8/imageSize.height);
  const displaySize={width:Math.max(1,imageSize.width*fit*panes),height:Math.max(1,imageSize.height*fit)};
  const pct=progress?.total?Math.min(100,Math.round(progress.completed/progress.total*100)):0;
  function capture(){const v=video.current;if(!v?.videoWidth)return;const c=document.createElement("canvas");c.width=v.videoWidth;c.height=v.videoHeight;c.getContext("2d").drawImage(v,0,0);c.toBlob(blob=>{if(blob){onFile(new File([blob],"captura-"+Date.now()+".png",{type:"image/png"}));setCameraOpen(false)}else setCameraError("Falha ao converter o quadro capturado.")},"image/png")}
  function dragStart(e){if(e.target.closest("button"))return;drag.current={x:e.clientX-position.x,y:e.clientY-position.y};e.currentTarget.setPointerCapture(e.pointerId)}
  function dragMove(e){if(drag.current)setPosition({x:e.clientX-drag.current.x,y:e.clientY-drag.current.y})}
  function dragEnd(){drag.current=null}
  return <section className="analysisEditor" aria-label="Workspace de análise">
    <div className="editorTop">
      <div className="editorBrand"><span className="editorMark">S</span><strong>SHM Studio</strong><span className="editorMenus"><span>Arquivo</span><span>Editar</span><span>Visualizar</span><span>Análise</span></span></div>
      <div className="editorFileTitle">{file?.name||"Nova inspeção"} {kind&&"· "+kind.toUpperCase()}</div>
      <div className="editorTopActions">
        <input ref={picker} hidden type="file" accept="image/*,.glb,.gltf,.obj,.ply,.stl" onChange={e=>onFile(e.target.files?.[0]||null)}/>
        <input ref={referencePicker} hidden type="file" accept="image/*" onChange={e=>onReferenceFile(e.target.files?.[0]||null)}/>
        <button disabled={busy} onClick={()=>picker.current?.click()}><ImagePlus size={16}/> Importar</button>
        {selected.length===1&&selected[0]==="cdm_1"&&<button disabled={busy} title="Carregar imagem anterior para comparação temporal" onClick={()=>referencePicker.current?.click()}><ImagePlus size={16}/> {referenceFile?"t0: "+referenceFile.name:"Referência t0"}</button>}
        <button disabled={busy} onClick={onSettings}><Settings2 size={16}/> Configurar</button>
        <button className="editorPrimary" disabled={!file||kind!=="2d"||!selected.length||busy} onClick={onRun}><Play size={16}/> Analisar</button>
      </div>
    </div>
    <div className="editorBody">
      <div className="editorTools" aria-label="Ferramentas"><button title="Mostrar ou ocultar camadas" onClick={()=>setLayersOpen(v=>!v)}><Layers3/></button><button title="Ampliar" onClick={()=>setZoom(z=>Math.min(4,z+.25))}><Plus/></button><button title="Reduzir" onClick={()=>setZoom(z=>Math.max(.25,z-.25))}><Minus/></button><button title="Ajustar imagem" onClick={()=>setZoom(1)}><Maximize2/></button><button title="Modo câmera" disabled={busy} onClick={()=>setCameraOpen(true)}><Camera/></button></div>
      {layersOpen&&<aside className="editorLayers"><div className="editorPanelTitle"><b>Camadas</b><button title="Recolher camadas" onClick={()=>setLayersOpen(false)}><ChevronLeft size={17}/></button></div>
        <div className="layerRow"><span>◉</span> Arquivo atual · t1</div>
        {referenceFile&&<div className="layerRow referenceLayer"><span>○</span><span>Referência · t0 <small>{referenceFile.name}</small></span><button className="layerClear" disabled={busy} title="Remover referência t0" onClick={()=>onReferenceFile(null)}><X size={13}/></button></div>}
        {results.map(r=><label className="layerRow" key={r.engine_id}><input type="checkbox" checked={visible[r.engine_id]!==false} onChange={e=>setVisible(v=>({...v,[r.engine_id]:e.target.checked}))}/>{r.name}</label>)}
        {pathologyLayers.map(layer=><label className="layerRow pathologyLayer" key={layer.id}><input type="checkbox" checked={visible["cdm_1:"+layer.id]!==false} onChange={e=>setVisible(v=>({...v,["cdm_1:"+layer.id]:e.target.checked}))}/><span className="pathologySwatch" style={{background:layer.color}}/>{layer.name} <small>({layer.count})</small></label>)}
        {temporalLayers.length>0&&<details className={"temporalLayerGroup "+(temporalQuality?.status||"")}><summary>Mudança t0→t1 <small>{temporalQuality?.status==="fail"?"não validada":temporalQuality?.status==="warning"?"ressalvas":temporalQuality?.status==="pass"?"aprovada":temporalLayers.length+" camadas"}</small></summary>{temporalLayers.map(layer=><label className="layerRow pathologyLayer temporalLayer" key={"temporal-"+layer.id}><input type="checkbox" checked={visible["cdm_1:temporal:"+layer.id]!==false} onChange={e=>setVisible(v=>({...v,["cdm_1:temporal:"+layer.id]:e.target.checked}))}/><span className="pathologySwatch" style={{background:layer.color}}/>{layer.name} <small>({layer.count})</small></label>)}</details>}
        <div className="editorPanelTitle"><b>Propriedades</b></div>
        <p>Tipo reconhecido: <b>{kind==="2d"?"Imagem 2D":kind==="3d"?"Modelo 3D":"Indefinido"}</b></p>
        {kind==="unknown"&&<div className="editorTypeChoice"><button onClick={()=>setKind("2d")}>Tratar como 2D</button><button onClick={()=>setKind("3d")}>Tratar como 3D</button></div>}
        <p>Sobreposição: {Math.round(opacity*100)}%</p><input aria-label="Opacidade da sobreposição" type="range" min="0" max="1" step=".05" value={opacity} onChange={e=>setOpacity(Number(e.target.value))}/>
      </aside>}
      <div className="editorViewport" ref={surface}>
        {!layersOpen&&<button className="editorExpand" onClick={()=>setLayersOpen(true)} title="Mostrar camadas"><ChevronRight size={18}/></button>}
        <button className="editorCameraEntry" disabled={busy} onClick={()=>setCameraOpen(true)}><Camera size={16}/> Câmera</button>
        {file&&<div className="editorTypeBadge">{kind==="2d"?"▧  2D detectado":kind==="3d"?"◇  3D detectado":"Tipo indefinido"}</div>}
        {!file?<div className="editorEmpty"><ImagePlus size={38}/><h2>Importe uma imagem ou modelo</h2><p>A imagem 2D pode ser analisada pelos motores selecionados. O tipo de arquivo é reconhecido automaticamente.</p><button onClick={()=>picker.current?.click()}>Selecionar arquivo</button></div>:
        kind==="3d"?<Suspense fallback={<div className="editorEmpty">Preparando visualizador 3D…</div>}><ModelViewport file={file}/></Suspense>:
        <div className={"editorImage "+((comparison==="side"||comparison==="temporal")?"editorSide":"")} style={{transform:`scale(${zoom})`,width:displaySize.width,height:displaySize.height}}>
          <div className="editorImagePane"><img src={comparison==="temporal"?(showRawT0?referencePrev:(temporalAlignedPreview||referencePrev)):prev} alt={comparison==="temporal"?(showRawT0?"Referência temporal t0 bruta":temporalAlignedPreview?"Referência temporal t0 alinhada":"Referência temporal t0"):"Arquivo original da inspeção"} onLoad={e=>setImageSize({width:e.currentTarget.naturalWidth||1,height:e.currentTarget.naturalHeight||1})}/>{comparison==="temporal"&&<span className="editorPaneBadge">t0 {showRawT0?"bruto":temporalAlignedPreview?"alinhado":"referência"}</span>}</div>
          {(image||pathologyLayers.length>0||temporalLayers.length>0)&&<div className="editorImagePane overlayPane">
            {comparison==="temporal"&&<><img src={prev} alt="Imagem atual t1"/><span className="editorPaneBadge">t1 atual</span></>}
            {image&&<img src={image} alt={"Sobreposição de "+chosen.name} style={{opacity}}/>}
            {pathologyLayers.filter(layer=>visible["cdm_1:"+layer.id]!==false).map(layer=><img className="pathologyOverlay" key={layer.id} src={"data:image/png;base64,"+layer.overlay_png_base64} alt={layer.name} style={{opacity}}/>)}
            {temporalLayers.filter(layer=>visible["cdm_1:temporal:"+layer.id]!==false).map(layer=><img className="pathologyOverlay temporalOverlay" key={"temporal-"+layer.id} src={"data:image/png;base64,"+layer.overlay_png_base64} alt={layer.name} style={{opacity}}/>)}
            {boxes.map((d,i)=><button key={i} className={"editorDetection "+(selectedDetection?.engineId===chosen.engine_id&&selectedDetection.index===i?"selected":"")} title={d.label||"Achado"} aria-label={`Achado ${i+1}: ${d.label||"sem classificação"}`} style={{left:(d.box[0]/res.image_width*100)+"%",top:(d.box[1]/res.image_height*100)+"%",width:((d.box[2]-d.box[0])/res.image_width*100)+"%",height:((d.box[3]-d.box[1])/res.image_height*100)+"%"}} onClick={()=>{setActive(chosen.engine_id);setSelectedDetection({engineId:chosen.engine_id,index:i})}}/>)}
          </div>}
        </div>}
        {file&&kind==="2d"&&<div className="editorZoom"><button aria-label="Reduzir zoom" onClick={()=>setZoom(z=>Math.max(.25,z-.25))}>−</button><span>{Math.round(zoom*100)}%</span><button aria-label="Ampliar zoom" onClick={()=>setZoom(z=>Math.min(4,z+.25))}><Plus size={15}/></button></div>}
        {resultOpen&&(busy||results.length>0)&&<div className="editorFloating" style={{transform:`translate(${position.x}px,${position.y}px)`}}>
          <div className="editorFloatHead" onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={dragEnd}><b>Resultados</b><button title="Recolher resultados" onClick={()=>setResultOpen(false)}><Minus size={16}/></button></div>
          {busy&&<div className="editorProgress"><span>{progress?.current_engine||"Processando motores"} · {progress?.total===100?pct+"%":(progress?.completed||0)+"/"+(progress?.total||selected.length)}</span><strong>{String(Math.floor(elapsed/60)).padStart(2,"0")}:{String(elapsed%60).padStart(2,"0")}</strong><div><i style={{width:pct+"%"}}/></div>{onCancel&&<button onClick={onCancel} disabled={progress?.state==="cancel_requested"}>{progress?.state==="cancel_requested"?"Cancelando…":"Cancelar"}</button>}</div>}
          {!busy&&res&&durationMs!=null&&<div className="editorRunTime">Tempo medido da rodada: <b>{(durationMs/1000).toFixed(2)} s</b></div>}
          {results.map(r=><button key={r.engine_id} className={"editorResultRow "+(chosen?.engine_id===r.engine_id?"active":"")} onClick={()=>{setActive(r.engine_id);setVisible(v=>({...v,[r.engine_id]:true}))}}><span>{r.name}</span><b>{r.detections?.length||0} achados</b><small>{Number(r.latency_ms||0).toFixed(0)} ms</small></button>)}
          {cdmSummary&&<div className="editorCdmSummary"><b>CDM-1 · resumo morfológico</b><div><span>{cdmSummary.total_objects} achados</span><span>Fissuras: {cdmSummary.crack_count}</span><span>Comprimento: {Number(cdmSummary.crack_length_total_px||0).toFixed(1)} px</span><span>Desplacamento: {Number(cdmSummary.spalling_area_px2||0).toFixed(0)} px²</span></div>{cdmRating?.enabled&&<p>Estimativa por imagem: NT {cdmRating.NT_img} · EC {cdmRating.EC_DNIT_img} · GDE {Number(cdmRating.GDE_img||0).toFixed(2)}. Confirme em inspeção técnica.</p>}{temporal?.enabled&&<p><b>t0→t1:</b> crescimento {temporalGrowth.toFixed(0)} px² · redução {temporalReduction.toFixed(0)} px² · {temporalAlignment?.accepted?<>registro automático Δx={Number(temporalAlignment.dx_px||0).toFixed(0)} px, Δy={Number(temporalAlignment.dy_px||0).toFixed(0)} px · ganho {(Number(temporalAlignment.improvement||0)*100).toFixed(1)}%</>:<>alinhamento {temporal?.alignment_method==="translation_auto"?"automático sem translação aplicada":"por redimensionamento"}</>}.</p>}{temporalQualityLabel&&<p className={"editorTemporalQuality "+temporalQuality.status}><b>{temporalQualityLabel}</b>{temporalQuality?.metrics&&<> · sobreposição {(Number(temporalQuality.metrics.overlap_ratio||0)*100).toFixed(1)}% · Δ iluminação {(Number(temporalQuality.metrics.illumination_delta||0)*100).toFixed(1)}% · razão de nitidez {Number(temporalQuality.metrics.sharpness_ratio||0).toFixed(2)}</>}{temporalQualityNotes.length>0&&<span> · {temporalQualityNotes.join("; ")}</span>}</p>}{temporalRegistrationWarning&&<p className="editorCdmWarning">{temporalRegistrationWarning}</p>}{chosen?.metrics?.performance_ms&&<p className="editorPerf"><b>Tempo real:</b> decodificação {(Number(chosen.metrics.performance_ms.decode||0)/1000).toFixed(2)} s · núcleo {(Number(chosen.metrics.performance_ms.core||0)/1000).toFixed(2)} s · renderização {(Number(chosen.metrics.performance_ms.render||0)/1000).toFixed(2)} s · total {(Number(chosen.metrics.performance_ms.total||0)/1000).toFixed(2)} s · {chosen.metrics.runtime||"browser"}</p>}</div>}
          {detail&&<div className="editorFinding"><b>{pathologyLayers.find(l=>l.id===detail.label)?.name||detail.label||detail.canonical_label||"Achado"} #{selectedDetection.index+1}</b><span>Motor: {chosen.name}</span><span>Confiança: {chosen.engine_id==="cdm_1"?"não calibrada":detail.score==null?"não informada":(Number(detail.score)*100).toFixed(1)+"%"}</span><span>Coordenadas: {detail.box.map(v=>Math.round(v)).join(", ")} px</span></div>}
          {results.length>0&&<div className="editorCompare"><button className={comparison==="overlay"?"active":""} onClick={()=>setComparison("overlay")}>Sobrepor</button><button className={comparison==="side"?"active":""} onClick={()=>setComparison("side")}>Lado a lado</button>{temporal?.enabled&&referencePrev&&<button className={comparison==="temporal"?"active":""} onClick={()=>setComparison("temporal")}>t0 / t1</button>}{comparison==="temporal"&&temporalAlignedPreview&&<button onClick={()=>setShowRawT0(v=>!v)}>{showRawT0?"Usar t0 alinhado":"Ver t0 bruto"}</button>}<button onClick={onExport} title="Exportar JSON">JSON</button><button onClick={onExportCsv} title="Exportar CSV da comparação">CSV</button>{res.consensus_overlay_png_base64&&<button onClick={onExportMap} title="Exportar mapa"><Download size={15}/></button>}</div>}
          {cdmSummary&&<div className="editorCompare editorCdmExports"><details className="editorExportMenu"><summary>Exportar CDM</summary><div><button onClick={()=>onExportCdm(chosen,"svg")}>SVG camadas</button><button onClick={()=>onExportCdm(chosen,"csv")}>CSV técnico</button><button onClick={()=>onExportCdm(chosen,"coco")}>COCO</button><button onClick={()=>onExportCdm(chosen,"dxf")}>DXF</button><button onClick={()=>onExportCdm(chosen,"bim")}>BIM JSON</button><button disabled={!Number(chosen.metrics?.mm_per_px)} title={!Number(chosen.metrics?.mm_per_px)?"Calibre mm/px para exportar IFC":""} onClick={()=>onExportCdm(chosen,"ifc")}>IFC</button><button onClick={()=>onExportCdm(chosen,"html")}>HTML</button>{temporalAlignedPreview&&<button onClick={()=>onExportCdm(chosen,"aligned_t0")}>PNG t0 alinhado</button>}</div></details></div>}
        </div>}
        {!resultOpen&&results.length>0&&<button className="editorResultsTab" onClick={()=>setResultOpen(true)}>Resultados · {results.length}</button>}
      </div>
    </div>
    <div className="editorStatus"><span>{error|| (progress?.state==="cancelled"?"Análise cancelada":kind==="3d"?"Arquivo 3D reconhecido; análise 2D indisponível":selected.length?selected.length+" motor(es) configurado(s)":"Configure os motores antes de analisar")}</span><span>Zoom {Math.round(zoom*100)}% · {kind?.toUpperCase()||"—"}</span></div>
    {cameraOpen&&<div className="editorModalBackdrop"><div className="editorCamera"><header><b>Modo câmera</b><button title="Fechar câmera" onClick={()=>setCameraOpen(false)}><X size={19}/></button></header>{cameraError&&<p role="alert">{cameraError}</p>}<video ref={video} autoPlay playsInline muted onLoadedMetadata={()=>setCameraReady(true)}/><footer><span>{cameraError?"Verifique a permissão da câmera":cameraReady?"Prévia ao vivo · capture um quadro para análise 2D":"Aguardando câmera…"}</span><button onClick={capture} disabled={!!cameraError||!cameraReady}><Camera size={16}/> Capturar imagem</button></footer></div></div>}
  </section>
}
