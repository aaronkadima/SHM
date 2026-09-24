import React,{Suspense,useEffect,useRef,useState} from "react";
import {Camera,ChevronDown,ChevronLeft,ChevronRight,ChevronUp,Columns2,Download,Image as ImageIcon,ImagePlus,Layers3,Lock,Maximize2,Minus,MoveHorizontal,Play,Plus,RefreshCw,Settings2,Unlock,X} from "lucide-react";
import{DEFAULT_VIEWER_PREFERENCES,clampCanvasPan,clampFloatingPanelPosition,clampLayersPanelWidth,clampResultPanelSize,loadViewerPreferences,saveViewerPreferences,zoomCanvasPanAroundPoint}from"./viewerPreferences.js";
const ModelViewport=React.lazy(()=>import("./ModelViewport.jsx"));

const MODEL_EXT=/\.(glb|gltf|obj|ply|stl)$/i;
const TEMPORAL_ISSUE_LABELS={
  registration_unreliable:"registro geométrico não confiável",
  insufficient_overlap:"sobreposição espacial insuficiente",
  illumination_mismatch:"diferença excessiva de iluminação",
  sharpness_mismatch:"diferença excessiva de nitidez",
  geometric_mismatch:"consistência geométrica residual insuficiente",
  exposure_clipping:"saturação/exposição inadequada"
};
const TEMPORAL_WARNING_LABELS={
  reduced_overlap:"sobreposição reduzida",
  illumination_difference:"diferença moderada de iluminação",
  sharpness_difference:"diferença moderada de nitidez",
  geometric_consistency_low:"consistência geométrica residual baixa",
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
export default function AnalysisWorkspace({appInfo=null,selectedEngineLabels=[],file,prev,referenceFile,referencePrev,referenceInspectionId,referenceInspectionMeta,inspectionMeta,res,busy,progress,selected,onFile,onReferenceFile,onRun,onCancel,onSettings,error,onExport,onExportCsv,onExportMap,onExportCdm}){
  const [initialViewerPrefs]=useState(()=>loadViewerPreferences());
  const [kind,setKind]=useState(null),[layersOpen,setLayersOpen]=useState(initialViewerPrefs.layersOpen),[layersWidth,setLayersWidth]=useState(initialViewerPrefs.layersWidth??DEFAULT_VIEWER_PREFERENCES.layersWidth),[resultOpen,setResultOpen]=useState(initialViewerPrefs.resultPanelOpen);
  const [cameraOpen,setCameraOpen]=useState(false),[cameraError,setCameraError]=useState(""),[cameraReady,setCameraReady]=useState(false);
  const [zoom,setZoom]=useState(1),[canvasPan,setCanvasPan]=useState({x:0,y:0}),[spacePanHeld,setSpacePanHeld]=useState(false),[canvasPointerPanning,setCanvasPointerPanning]=useState(false),[opacity,setOpacity]=useState(initialViewerPrefs.opacity),[comparison,setComparison]=useState(initialViewerPrefs.comparison),[preferredComparison,setPreferredComparison]=useState(initialViewerPrefs.comparison),[wipePosition,setWipePosition]=useState(initialViewerPrefs.wipePosition??50),[wipeDirection,setWipeDirection]=useState(null),[wipeDragging,setWipeDragging]=useState(false),[showRawT0,setShowRawT0]=useState(false);
  const [active,setActive]=useState(null),[visible,setVisible]=useState({}),[position,setPosition]=useState(initialViewerPrefs.resultPanelPosition||DEFAULT_VIEWER_PREFERENCES.resultPanelPosition),[resultPanelSize,setResultPanelSize]=useState(initialViewerPrefs.resultPanelSize||DEFAULT_VIEWER_PREFERENCES.resultPanelSize);
  const [pathologyOrder,setPathologyOrder]=useState(initialViewerPrefs.pathologyOrder),[pathologyOpacity,setPathologyOpacity]=useState(initialViewerPrefs.pathologyOpacity||{}),[pathologyLocked,setPathologyLocked]=useState(new Set(initialViewerPrefs.pathologyLocked||[])),[selectedPathologyId,setSelectedPathologyId]=useState(null);
  const [selectedDetection,setSelectedDetection]=useState(null);
  const [localPreview,setLocalPreview]=useState(null),[previewError,setPreviewError]=useState(""),[statusNotice,setStatusNotice]=useState("");
  const [imageSize,setImageSize]=useState({width:1,height:1});
  const imageDecoded=imageSize.width>1&&imageSize.height>1;
  const [viewportSize,setViewportSize]=useState({width:0,height:0});
  const [startAt,setStartAt]=useState(null),[elapsed,setElapsed]=useState(0),[durationMs,setDurationMs]=useState(null);
  const runStarted=useRef(null);
  const video=useRef(null),stream=useRef(null),picker=useRef(null),referencePicker=useRef(null),surface=useRef(null),canvasElement=useRef(null),resultPanel=useRef(null),exportMenu=useRef(null),drag=useRef(null),resultResizeDrag=useRef(null),resultOpenPreference=useRef(initialViewerPrefs.resultPanelOpen),busyForcedResults=useRef(false),canvasDrag=useRef(null),canvasTouch=useRef({points:new Map(),mode:null}),spacePan=useRef(false),zoomRef=useRef(1),statusTimer=useRef(null),wipeDirectionTimer=useRef(null);
  useEffect(()=>setKind(detectAsset(file)),[file]);
  useEffect(()=>{
    const onEscape=e=>{
      if(e.key!=="Escape")return;
      let handled=false;
      if(cameraOpen){
        setCameraOpen(false);
        handled=true;
      }
      if(exportMenu.current?.open){
        exportMenu.current.open=false;
        handled=true;
      }
      if(spacePan.current||canvasDrag.current?.source==="space"){
        const pointerId=canvasDrag.current?.pointerId;
        if(pointerId!=null)try{canvasElement.current?.releasePointerCapture?.(pointerId)}catch{}
        canvasDrag.current=null;
        spacePan.current=false;
        setSpacePanHeld(false);
        setCanvasPointerPanning(false);
        handled=true;
      }
      if(handled){
        e.preventDefault();
        showStatusNotice("Ação cancelada",700);
      }
    };
    window.addEventListener("keydown",onEscape);
    return()=>window.removeEventListener("keydown",onEscape);
  },[cameraOpen]);

  useEffect(()=>{
    let cancelled=false;
    setPreviewError("");
    setLocalPreview(null);
    setImageSize({width:1,height:1});
    if(!file||detectAsset(file)!=="2d")return()=>{cancelled=true};
    const reader=new FileReader();
    reader.onload=()=>{
      if(cancelled)return;
      const src=typeof reader.result==="string"?reader.result:null;
      setLocalPreview(src);
      if(!src)return;
      const probe=new Image();
      probe.onload=()=>{if(!cancelled)setImageSize({width:probe.naturalWidth||1,height:probe.naturalHeight||1})};
      probe.onerror=()=>{if(!cancelled)setPreviewError("A imagem foi lida, mas o navegador não conseguiu decodificá-la.")};
      probe.src=src;
    };
    reader.onerror=()=>{if(!cancelled)setPreviewError("Não foi possível ler a imagem importada.")};
    reader.readAsDataURL(file);
    return()=>{cancelled=true;try{reader.abort()}catch{}};
  },[file]);
  useEffect(()=>{
    if(!file||kind!=="2d"||!imageDecoded||previewError)return;
    showStatusNotice(`Imagem carregada · ${file.name} · ${imageSize.width}×${imageSize.height} px`,1800);
  },[file,kind,imageDecoded,imageSize.width,imageSize.height,previewError]);
  useEffect(()=>()=>{if(statusTimer.current)clearTimeout(statusTimer.current);if(wipeDirectionTimer.current)clearTimeout(wipeDirectionTimer.current)},[]);
  useEffect(()=>{setSelectedDetection(null);setActive(null);setVisible({});applyCanvasZoom(1);setCanvasPan({x:0,y:0});setComparison(preferredComparison);setShowRawT0(false)},[file,referenceFile]);
  useEffect(()=>{if(!surface.current)return;const observer=new ResizeObserver(([entry])=>setViewportSize({width:entry.contentRect.width,height:entry.contentRect.height}));observer.observe(surface.current);return()=>observer.disconnect()},[]);
  useEffect(()=>{
    if(!resultOpen)return;
    const id=requestAnimationFrame(()=>setPosition(current=>{
      const next=clampResultPosition(current);
      return next.x===current.x&&next.y===current.y?current:next;
    }));
    return()=>cancelAnimationFrame(id);
  },[viewportSize.width,viewportSize.height,resultOpen]);
  useEffect(()=>{
    if(!resultOpen||!resultPanel.current)return;
    let frame=0;
    const reclamp=()=>{
      if(frame)cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>{
        setPosition(current=>{
          const next=clampResultPosition(current);
          return next.x===current.x&&next.y===current.y?current:next;
        });
      });
    };
    const observer=new ResizeObserver(reclamp);
    observer.observe(resultPanel.current);
    reclamp();
    return()=>{observer.disconnect();if(frame)cancelAnimationFrame(frame)};
  },[resultOpen,busy,res]);
  useEffect(()=>{saveViewerPreferences({opacity,layersOpen,layersWidth,comparison:preferredComparison,wipePosition,pathologyOrder,pathologyOpacity,pathologyLocked:[...pathologyLocked],resultPanelOpen:resultOpenPreference.current,resultPanelPosition:position,resultPanelSize})},[opacity,layersOpen,layersWidth,preferredComparison,wipePosition,pathologyOrder,pathologyOpacity,pathologyLocked,resultOpen,position,resultPanelSize]);
  useEffect(()=>{
    if(busy){
      busyForcedResults.current=true;
      setResultOpen(true);
    }else if(busyForcedResults.current){
      busyForcedResults.current=false;
      setResultOpen(resultOpenPreference.current);
    }
  },[busy]);
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
  const linkedReferenceCompatibility=referenceInspectionId&&referenceInspectionMeta?(()=>{
    const norm=v=>String(v||"").trim();
    const refOae=norm(referenceInspectionMeta.oae_id),refElement=norm(referenceInspectionMeta.element_id),refSource=norm(referenceInspectionMeta.source_id);
    const curOae=norm(inspectionMeta?.oae_id),curElement=norm(inspectionMeta?.element_id),curSource=norm(inspectionMeta?.source_id);
    const sameOae=!!refOae&&curOae===refOae,sameElement=!!refElement&&curElement===refElement;
    const sameSource=!!refSource&&curSource===refSource;
    const ok=sameOae&&sameElement;
    return {
      ok,sameSource,
      status:ok?(sameSource?"pass":"warning"):"fail",
      text:ok?(sameSource?"vínculo histórico compatível":"mesma OAE/elemento · fonte diferente"):"OAE/elemento incompatível",
      refLabel:[refOae,refElement].filter(Boolean).join(" / ")
    };
  })():null;
  const results=res?.results||[];
  const shown=results.filter(r=>visible[r.engine_id]!==false);
  const chosen=shown.find(r=>r.engine_id===active)||shown[0];
  const basePreview=localPreview||prev;
  const pathologyLayers=chosen?.engine_id==="cdm_1"?chosen.metrics?.layers||[]:[];
  const pathologyIdsKey=pathologyLayers.map(layer=>layer.id).join("|");
  useEffect(()=>{
    const incoming=pathologyLayers.map(layer=>layer.id);
    setPathologyOrder(current=>{
      if(incoming.length===0)return current.length?[]:current;
      const incomingSet=new Set(incoming);
      const kept=current.filter(id=>incomingSet.has(id));
      const next=[...kept,...incoming.filter(id=>!kept.includes(id))];
      return next.length===current.length&&next.every((id,i)=>id===current[i])?current:next;
    });
  },[chosen?.engine_id,pathologyIdsKey]);
  useEffect(()=>{
    const incoming=pathologyLayers.map(layer=>layer.id);
    setSelectedPathologyId(current=>current&&incoming.includes(current)?current:(incoming[0]||null));
  },[chosen?.engine_id,pathologyIdsKey]);
  const orderedPathologyLayers=pathologyOrder.length
    ? pathologyOrder.map(id=>pathologyLayers.find(layer=>layer.id===id)).filter(Boolean)
    : pathologyLayers;
  const selectedPathology=orderedPathologyLayers.find(layer=>layer.id===selectedPathologyId)||null;
  const selectedPathologyIndex=selectedPathology?orderedPathologyLayers.findIndex(layer=>layer.id===selectedPathology.id):-1;
  const selectedPathologyOpacity=selectedPathology?Number(pathologyOpacity[selectedPathology.id]??1):1;
  const selectedPathologyLocked=selectedPathology?pathologyLocked.has(selectedPathology.id):false;
  const temporal=chosen?.engine_id==="cdm_1"?chosen.metrics?.temporal:null;
  const temporalAlignment=temporal?.alignment||null;
  const temporalQuality=temporal?.quality||null;
  const temporalAlignedPreview=temporal?.aligned_reference_png_base64?"data:image/png;base64,"+temporal.aligned_reference_png_base64:null;
  const temporalLayers=temporal?.enabled?temporal.layers||[]:[];
  const temporalLayerIsVisible=id=>temporalQuality?.status==="fail"?visible["cdm_1:temporal:"+id]===true:visible["cdm_1:temporal:"+id]!==false;
  const pathologyVisibleCount=orderedPathologyLayers.filter(layer=>visible["cdm_1:"+layer.id]!==false).length;
  const temporalVisibleCount=temporalLayers.filter(layer=>temporalLayerIsVisible(layer.id)).length;
  const temporalStats=temporal?.stats||{};
  const temporalCalibrated=Number(chosen?.metrics?.mm_per_px)>0;
  const temporalUnit=temporalCalibrated?"mm²":"px²";
  const temporalGrowth=Object.values(temporalStats).reduce((sum,row)=>sum+Number(temporalCalibrated&&row.growth_area_mm2!=null?row.growth_area_mm2:row.growth_area_px2||0),0);
  const temporalReduction=Object.values(temporalStats).reduce((sum,row)=>sum+Number(temporalCalibrated&&row.reduction_area_mm2!=null?row.reduction_area_mm2:row.reduction_area_px2||0),0);
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
  const temporalMetricRows=Object.entries(temporalStats).map(([cls,row])=>({
    cls,
    label:pathologyLayers.find(l=>l.id===cls)?.name||cls,
    previous:temporalCalibrated&&row.previous_area_mm2!=null?Number(row.previous_area_mm2):Number(row.previous_area_px2||0),
    current:temporalCalibrated&&row.current_area_mm2!=null?Number(row.current_area_mm2):Number(row.current_area_px2||0),
    net:temporalCalibrated&&row.net_area_change_mm2!=null?Number(row.net_area_change_mm2):Number(row.net_area_change_px2||0),
    growthRate:row.growth_rate_vs_t0_pct==null?null:Number(row.growth_rate_vs_t0_pct),
    reductionRate:row.reduction_rate_vs_t0_pct==null?null:Number(row.reduction_rate_vs_t0_pct),
    netRate:row.net_area_change_vs_t0_pct==null?null:Number(row.net_area_change_vs_t0_pct),
    iou:Number(row.iou||0)
  }));
  const cdmSummary=chosen?.engine_id==="cdm_1"?chosen.metrics?.summary:null;
  const cdmRating=cdmSummary?.condition_rating;
  const engineOverlay=chosen?.overlay_png_base64?"data:image/png;base64,"+chosen.overlay_png_base64:null;
  const overlaySemantics=chosen?.metrics?.overlay_semantics||"composite_or_unknown";
  const useCombinedEngineOverlay=!!engineOverlay&&pathologyLayers.length===0;
  const boxes=(chosen?.detections||[]).filter(d=>Array.isArray(d.box)&&d.box.length>=4&&(!pathologyLayers.length||visible["cdm_1:"+d.label]!==false));
  const detail=selectedDetection&&chosen&&selectedDetection.engineId===chosen.engine_id?boxes[selectedDetection.index]:null;
  const panes=comparison==="side"||comparison==="temporal"?2:1;
  const safeViewport={width:Math.max(1,Number(viewportSize.width)||1),height:Math.max(1,Number(viewportSize.height)||1)};
  const safeImage={width:Math.max(1,Number(imageSize.width)||1),height:Math.max(1,Number(imageSize.height)||1)};
  const fit=Math.min(safeViewport.width*.83/(safeImage.width*panes),safeViewport.height*.8/safeImage.height);
  const displaySize={width:Math.max(96,safeImage.width*fit*panes),height:Math.max(72,safeImage.height*fit)};
  useEffect(()=>{setCanvasPan(current=>{const next=clampCanvasPan(current,{viewportWidth:surface.current?.clientWidth||viewportSize.width,viewportHeight:surface.current?.clientHeight||viewportSize.height,canvasWidth:displaySize.width,canvasHeight:displaySize.height,zoom,minVisible:56});return next.x===current.x&&next.y===current.y?current:next})},[zoom,viewportSize.width,viewportSize.height,displaySize.width,displaySize.height]);
  const pct=progress?.total?Math.min(100,Math.round(progress.completed/progress.total*100)):0;
  function capture(){const v=video.current;if(!v?.videoWidth)return;const c=document.createElement("canvas");c.width=v.videoWidth;c.height=v.videoHeight;c.getContext("2d").drawImage(v,0,0);c.toBlob(blob=>{if(blob){onFile(new File([blob],"captura-"+Date.now()+".png",{type:"image/png"}));setCameraOpen(false)}else setCameraError("Falha ao converter o quadro capturado.")},"image/png")}
  function showStatusNotice(message,ms=1800){
    if(statusTimer.current)clearTimeout(statusTimer.current);
    setStatusNotice(message);
    statusTimer.current=setTimeout(()=>{setStatusNotice("");statusTimer.current=null},ms);
  }
  function markWipeDirection(direction){
    if(wipeDirectionTimer.current)clearTimeout(wipeDirectionTimer.current);
    setWipeDirection(direction);
    wipeDirectionTimer.current=setTimeout(()=>{if(!wipeDragging)setWipeDirection(null);wipeDirectionTimer.current=null},260);
  }
  function canvasViewportPoint(clientX,clientY){
    const rect=surface.current?.getBoundingClientRect();
    if(!rect)return{x:0,y:0};
    return{x:clientX-(rect.left+rect.width/2),y:clientY-(rect.top+rect.height/2)};
  }
  function applyCanvasZoom(next){
    const value=Math.max(.25,Math.min(4,Number(next)||1));
    zoomRef.current=value;
    setZoom(value);
    return value;
  }
  function changeZoom(delta,anchor=null){
    const current=zoomRef.current;
    const next=Math.max(.25,Math.min(4,current+delta));
    if(next===current)return;
    const focus=anchor||{x:0,y:0};
    setCanvasPan(currentPan=>clampCanvasPosition(zoomCanvasPanAroundPoint(currentPan,current,next,focus),next));
    applyCanvasZoom(next);
    showStatusNotice("Zoom · "+Math.round(next*100)+"%",1000);
  }
  function canvasPanGeometry(zoomValue=zoomRef.current){
    return{
      viewportWidth:surface.current?.clientWidth||viewportSize.width,
      viewportHeight:surface.current?.clientHeight||viewportSize.height,
      canvasWidth:displaySize.width,
      canvasHeight:displaySize.height,
      zoom:zoomValue,
      minVisible:56
    };
  }
  function clampCanvasPosition(next,zoomValue=zoomRef.current){
    return clampCanvasPan(next,canvasPanGeometry(zoomValue));
  }
  function clampResultPosition(next){
    const panel=resultPanel.current,viewport=surface.current;
    if(!panel||!viewport)return next;
    return clampFloatingPanelPosition(next,{
      viewportWidth:viewport.clientWidth,
      viewportHeight:viewport.clientHeight,
      panelLeft:panel.offsetLeft,
      panelTop:panel.offsetTop,
      panelWidth:panel.offsetWidth,
      panelHeight:panel.offsetHeight
    });
  }
  function dragStart(e){
    if(e.button!==0||e.isPrimary===false)return;
    e.preventDefault();
    drag.current={pointerId:e.pointerId,clientX:e.clientX,clientY:e.clientY,startX:position.x,startY:position.y};
    try{e.currentTarget.setPointerCapture?.(e.pointerId)}catch{}
  }
  function dragMove(e){
    const dragState=drag.current;
    if(!dragState||e.pointerId!==dragState.pointerId)return;
    setPosition(clampResultPosition({x:dragState.startX+e.clientX-dragState.clientX,y:dragState.startY+e.clientY-dragState.clientY}));
  }
  function dragEnd(e){
    const dragState=drag.current;
    if(!dragState||e?.pointerId!==dragState.pointerId)return;
    drag.current=null;
    try{e?.currentTarget?.releasePointerCapture?.(e.pointerId)}catch{}
  }
  function resultResizeGeometry(){
    const panel=resultPanel.current,viewport=surface.current;
    if(!panel||!viewport)return null;
    const viewportRect=viewport.getBoundingClientRect();
    const panelRect=panel.getBoundingClientRect();
    return{
      minWidth:340,
      minHeight:65,
      maxWidth:Math.max(1,Math.min(900,panelRect.right-viewportRect.left-8)),
      maxHeight:Math.max(1,Math.min(900,viewport.clientHeight*.75,viewportRect.bottom-8-panelRect.top))
    };
  }
  function beginResultResize(e){
    if(e.button!==0||e.isPrimary===false||window.matchMedia("(max-width:560px)").matches)return;
    const panel=resultPanel.current,geometry=resultResizeGeometry();
    if(!panel||!geometry)return;
    e.preventDefault();
    e.stopPropagation();
    const pointerId=e.pointerId;
    resultResizeDrag.current={pointerId,startX:e.clientX,startY:e.clientY,startWidth:panel.offsetWidth,startHeight:panel.offsetHeight,geometry};
    const move=ev=>{
      const dragState=resultResizeDrag.current;
      if(!dragState||ev.pointerId!==dragState.pointerId)return;
      setResultPanelSize(clampResultPanelSize({
        width:dragState.startWidth+ev.clientX-dragState.startX,
        height:dragState.startHeight+ev.clientY-dragState.startY
      },dragState.geometry));
    };
    const finish=ev=>{
      const dragState=resultResizeDrag.current;
      if(!dragState||ev.pointerId!==dragState.pointerId)return;
      resultResizeDrag.current=null;
      const panelNow=resultPanel.current;
      if(panelNow)showStatusNotice("Resultados · "+Math.round(panelNow.offsetWidth)+"×"+Math.round(panelNow.offsetHeight)+" px",800);
      window.removeEventListener("pointermove",move);
      window.removeEventListener("pointerup",finish);
      window.removeEventListener("pointercancel",finish);
    };
    window.addEventListener("pointermove",move);
    window.addEventListener("pointerup",finish);
    window.addEventListener("pointercancel",finish);
  }
  function resizeResultPanelKey(e){
    const panel=resultPanel.current,geometry=resultResizeGeometry();
    if(!panel||!geometry||window.matchMedia("(max-width:560px)").matches)return;
    if(e.key==="Home"){
      e.preventDefault();
      setResultPanelSize({...DEFAULT_VIEWER_PREFERENCES.resultPanelSize});
      return;
    }
    if(e.key==="End"){
      e.preventDefault();
      setResultPanelSize(clampResultPanelSize({width:geometry.maxWidth,height:geometry.maxHeight},geometry));
      return;
    }
    const delta={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]}[e.key];
    if(!delta)return;
    e.preventDefault();
    setResultPanelSize(current=>clampResultPanelSize({
      width:(Number(current.width)||panel.offsetWidth)+delta[0],
      height:(Number(current.height)||panel.offsetHeight)+delta[1]
    },geometry));
  }
  function moveResultPanelKey(e){
    if(e.key==="Home"||e.key==="End"){
      e.preventDefault();
      const edge=e.key==="Home"?-1e6:1e6;
      setPosition(clampResultPosition({x:edge,y:edge}));
      return;
    }
    const delta={ArrowLeft:[-24,0],ArrowRight:[24,0],ArrowUp:[0,-24],ArrowDown:[0,24]}[e.key];
    if(!delta)return;
    e.preventDefault();
    setPosition(current=>clampResultPosition({x:current.x+delta[0],y:current.y+delta[1]}));
  }
  function canvasTouchExcluded(target){
    return !!target?.closest?.("button,input,summary,details,a,[role=slider]");
  }
  function canvasPanStart(e){
    if(e.pointerType==="touch"){
      if(canvasTouchExcluded(e.target))return;
      const gesture=canvasTouch.current;
      gesture.points.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(gesture.points.size===1){
        if(zoomRef.current>1){
          e.preventDefault();
          gesture.mode="pan";
          gesture.startPoint={x:e.clientX,y:e.clientY};
          gesture.startPan={...canvasPan};
          try{e.currentTarget.setPointerCapture?.(e.pointerId)}catch{}
        }else gesture.mode="idle";
      }else if(gesture.points.size===2){
        e.preventDefault();
        const points=[...gesture.points.values()];
        gesture.mode="pinch";
        gesture.startDistance=Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y)||1;
        gesture.startZoom=zoomRef.current;
        gesture.startMidpoint=canvasViewportPoint((points[0].x+points[1].x)/2,(points[0].y+points[1].y)/2);
        gesture.startPan={...canvasPan};
        gesture.lastZoom=zoomRef.current;
        gesture.lastPan={...canvasPan};
        for(const id of gesture.points.keys())try{e.currentTarget.setPointerCapture?.(id)}catch{}
      }
      return;
    }
    const spacePrimary=e.button===0&&spacePan.current;
    if((e.button!==1&&!spacePrimary)||e.isPrimary===false)return;
    e.preventDefault();
    canvasDrag.current={pointerId:e.pointerId,x:e.clientX-canvasPan.x,y:e.clientY-canvasPan.y,source:spacePrimary?"space":"middle"};
    setCanvasPointerPanning(true);
    try{e.currentTarget.setPointerCapture?.(e.pointerId)}catch{}
  }
  function canvasPanMove(e){
    if(e.pointerType==="touch"){
      const gesture=canvasTouch.current;
      if(!gesture.points.has(e.pointerId))return;
      gesture.points.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(gesture.mode==="pinch"&&gesture.points.size>=2){
        e.preventDefault();
        const points=[...gesture.points.values()].slice(0,2);
        const distance=Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y)||1;
        const midpoint=canvasViewportPoint((points[0].x+points[1].x)/2,(points[0].y+points[1].y)/2);
        const nextZoom=Math.max(1,Math.min(4,gesture.startZoom*distance/gesture.startDistance));
        const nextPan=clampCanvasPosition(
          zoomCanvasPanAroundPoint(gesture.startPan,gesture.startZoom,nextZoom,gesture.startMidpoint,midpoint),
          nextZoom
        );
        gesture.lastZoom=nextZoom;
        gesture.lastPan=nextPan;
        applyCanvasZoom(nextZoom);
        setCanvasPan(nextPan);
      }else if(gesture.mode==="pan"&&gesture.points.size===1&&zoomRef.current>1){
        e.preventDefault();
        setCanvasPan(clampCanvasPosition({
          x:gesture.startPan.x+e.clientX-gesture.startPoint.x,
          y:gesture.startPan.y+e.clientY-gesture.startPoint.y
        }));
      }
      return;
    }
    const dragState=canvasDrag.current;
    if(!dragState||e.pointerId!==dragState.pointerId)return;
    e.preventDefault();
    setCanvasPan(clampCanvasPosition({x:e.clientX-dragState.x,y:e.clientY-dragState.y}));
  }
  function canvasPanEnd(e){
    if(e.pointerType==="touch"){
      const gesture=canvasTouch.current;
      if(!gesture.points.has(e.pointerId))return;
      if(e.type==="pointercancel"){
        const ids=[...gesture.points.keys()];
        gesture.points.clear();
        gesture.mode=null;
        gesture.startPoint=null;
        gesture.startPan=null;
        for(const id of ids)try{e?.currentTarget?.releasePointerCapture?.(id)}catch{}
        return;
      }
      gesture.points.delete(e.pointerId);
      try{e?.currentTarget?.releasePointerCapture?.(e.pointerId)}catch{}
      if(gesture.points.size===0){
        gesture.mode=null;
        gesture.startPoint=null;
        gesture.startPan=null;
      }else if(gesture.mode==="pinch"){
        const [remainingId,remainingPoint]=gesture.points.entries().next().value;
        if((gesture.lastZoom??zoomRef.current)>1){
          gesture.mode="pan";
          gesture.startPoint={...remainingPoint};
          gesture.startPan={...(gesture.lastPan||canvasPan)};
          try{e?.currentTarget?.setPointerCapture?.(remainingId)}catch{}
        }else gesture.mode="idle";
      }
      return;
    }
    const dragState=canvasDrag.current;
    if(!dragState||e?.pointerId!==dragState.pointerId)return;
    canvasDrag.current=null;
    setCanvasPointerPanning(false);
    try{e?.currentTarget?.releasePointerCapture?.(e.pointerId)}catch{}
  }
  function canvasKeyDown(e){
    if(e.target!==e.currentTarget||e.ctrlKey||e.metaKey||e.altKey)return;
    if(e.key===" "){
      e.preventDefault();
      if(!spacePan.current){
        spacePan.current=true;
        setSpacePanHeld(true);
      }
      return;
    }
    const panDelta={ArrowLeft:[-32,0],ArrowRight:[32,0],ArrowUp:[0,-32],ArrowDown:[0,32]}[e.key];
    if(panDelta){
      e.preventDefault();
      setCanvasPan(current=>clampCanvasPosition({x:current.x+panDelta[0],y:current.y+panDelta[1]}));
      showStatusNotice("Canvas · "+(panDelta[0]?"X ":"Y ")+(panDelta[0]||panDelta[1])+" px",600);
      return;
    }
    if(e.key==="+"||e.key==="="){
      e.preventDefault();
      changeZoom(.25);
    }else if(e.key==="-"||e.key==="_"){
      e.preventDefault();
      changeZoom(-.25);
    }else if(e.key==="0"){
      e.preventDefault();
      fitView();
    }
  }
  function canvasKeyUp(e){
    if(e.key!==" "||e.target!==e.currentTarget)return;
    e.preventDefault();
    spacePan.current=false;
    setSpacePanHeld(false);
  }
  function canvasBlur(){
    spacePan.current=false;
    setSpacePanHeld(false);
  }
  function canvasWheel(e){
    if(e.target!==e.currentTarget&&canvasTouchExcluded(e.target))return;
    if(e.ctrlKey||e.metaKey){
      e.preventDefault();
      changeZoom(e.deltaY<0?.25:-.25,canvasViewportPoint(e.clientX,e.clientY));
      return;
    }
    if(zoomRef.current>1&&(Math.abs(e.deltaX)>.1||Math.abs(e.deltaY)>.1)){
      e.preventDefault();
      setCanvasPan(current=>clampCanvasPosition({x:current.x-e.deltaX,y:current.y-e.deltaY}));
    }
  }
  function beginLayersResize(e){
    if(e.button!==0||e.isPrimary===false)return;
    e.preventDefault();
    const pointerId=e.pointerId;
    const startX=e.clientX;
    const startWidth=layersWidth;
    let currentWidth=startWidth;
    const move=ev=>{
      if(ev.pointerId!==pointerId)return;
      currentWidth=clampLayersPanelWidth(startWidth+ev.clientX-startX);
      setLayersWidth(currentWidth);
    };
    const finish=ev=>{
      if(ev.pointerId!==pointerId)return;
      showStatusNotice("Painel de camadas · "+Math.round(currentWidth)+" px",900);
      window.removeEventListener("pointermove",move);
      window.removeEventListener("pointerup",finish);
      window.removeEventListener("pointercancel",finish);
    };
    window.addEventListener("pointermove",move);
    window.addEventListener("pointerup",finish);
    window.addEventListener("pointercancel",finish);
  }
  function resizeLayersKey(e){
    const next=e.key==="Home"?340:e.key==="End"?600:e.key==="ArrowLeft"?layersWidth-20:e.key==="ArrowRight"?layersWidth+20:null;
    if(next==null)return;
    e.preventDefault();
    const width=clampLayersPanelWidth(next);
    setLayersWidth(width);
    showStatusNotice("Painel de camadas · "+width+" px",700);
  }
  function beginWipeDrag(e){
    if(e.button!==0||e.isPrimary===false)return;
    e.preventDefault();
    e.stopPropagation();
    const pane=e.currentTarget.closest(".editorWipePane");
    const rect=pane?.getBoundingClientRect();
    if(!rect?.width)return;
    const pointerId=e.pointerId;
    const startX=e.clientX;
    const startPosition=wipePosition;
    setWipeDragging(true);
    const update=clientX=>{
      const deltaPx=clientX-startX;
      const next=Math.max(5,Math.min(95,startPosition+deltaPx/rect.width*100));
      if(Math.abs(deltaPx)>.5)markWipeDirection(deltaPx<0?"left":"right");
      setWipePosition(next);
      return next;
    };
    const move=ev=>{
      if(ev.pointerId!==pointerId)return;
      ev.preventDefault();
      update(ev.clientX);
    };
    const finish=ev=>{
      if(ev.pointerId!==pointerId)return;
      const next=ev.type==="pointercancel"?wipePosition:update(ev.clientX);
      setWipeDragging(false);
      setWipeDirection(null);
      if(ev.type!=="pointercancel")showStatusNotice("Divisor · "+Math.round(next)+"%",900);
      window.removeEventListener("pointermove",move);
      window.removeEventListener("pointerup",finish);
      window.removeEventListener("pointercancel",finish);
    };
    window.addEventListener("pointermove",move);
    window.addEventListener("pointerup",finish);
    window.addEventListener("pointercancel",finish);
  }
  function wipeHandleKey(e){
    if(e.key==="ArrowLeft"||e.key==="ArrowRight"){
      e.preventDefault();
      const direction=e.key==="ArrowLeft"?"left":"right";
      markWipeDirection(direction);
      setWipePosition(v=>Math.max(5,Math.min(95,v+(direction==="left"?-2:2))));
    }else if(e.key==="Home"){e.preventDefault();markWipeDirection("left");setWipePosition(5)}
    else if(e.key==="End"){e.preventDefault();markWipeDirection("right");setWipePosition(95)}
  }
  function fitView(){
    const rect=surface.current?.getBoundingClientRect();
    if(rect&&rect.width>0&&rect.height>0)setViewportSize({width:rect.width,height:rect.height});
    applyCanvasZoom(1);
    setCanvasPan({x:0,y:0});
    showStatusNotice("Ajustado à tela · 100%",1000);
  }
  function changeComparison(mode){
    setComparison(mode);
    if(mode!=="temporal")setPreferredComparison(mode);
    fitView();
    showStatusNotice("Visualização · "+({original:"Original",overlay:"Sobrepor",wipe:"Deslizar",side:"Lado a lado",temporal:"t0 / t1"}[mode]||mode),1400);
  }
  function setPathologyGroupVisible(next){
    setVisible(current=>{
      const updated={...current};
      for(const layer of orderedPathologyLayers)updated["cdm_1:"+layer.id]=next;
      return updated;
    });
  }
  function setTemporalGroupVisible(next){
    setVisible(current=>{
      const updated={...current};
      for(const layer of temporalLayers)updated["cdm_1:temporal:"+layer.id]=next;
      return updated;
    });
  }
  function isolatePathologyLayer(id){
    setVisible(current=>{
      const updated={...current};
      for(const layer of orderedPathologyLayers)updated["cdm_1:"+layer.id]=layer.id===id;
      return updated;
    });
  }
  function movePathologyLayer(id,delta){
    if(pathologyLocked.has(id))return;
    setPathologyOrder(current=>{
      const index=current.indexOf(id);
      const target=index+delta;
      if(index<0||target<0||target>=current.length)return current;
      const next=[...current];
      [next[index],next[target]]=[next[target],next[index]];
      return next;
    });
  }
  function setSelectedPathologyOpacity(value){
    if(!selectedPathologyId||pathologyLocked.has(selectedPathologyId))return;
    const next=Math.min(1,Math.max(0,Number(value)));
    setPathologyOpacity(current=>({...current,[selectedPathologyId]:Number.isFinite(next)?next:1}));
  }
  function toggleSelectedPathologyLock(){
    if(!selectedPathologyId)return;
    setPathologyLocked(current=>{
      const next=new Set(current);
      if(next.has(selectedPathologyId))next.delete(selectedPathologyId);else next.add(selectedPathologyId);
      return next;
    });
  }
  function setResultOpenPreference(next){
    const value=typeof next==="function"?!!next(resultOpenPreference.current):!!next;
    resultOpenPreference.current=value;
    setResultOpen(value);
  }
  function resetViewerPreferences(){
    setOpacity(DEFAULT_VIEWER_PREFERENCES.opacity);
    setLayersOpen(DEFAULT_VIEWER_PREFERENCES.layersOpen);
    setLayersWidth(DEFAULT_VIEWER_PREFERENCES.layersWidth);
    setPreferredComparison(DEFAULT_VIEWER_PREFERENCES.comparison);
    setComparison(DEFAULT_VIEWER_PREFERENCES.comparison);
    setWipePosition(DEFAULT_VIEWER_PREFERENCES.wipePosition);
    setPathologyOrder(pathologyLayers.map(layer=>layer.id));
    setPathologyOpacity({});
    setPathologyLocked(new Set());
    setSelectedPathologyId(pathologyLayers[0]?.id||null);
    setVisible({});
    applyCanvasZoom(1);
    setCanvasPan({x:0,y:0});
    setShowRawT0(false);
    resultOpenPreference.current=DEFAULT_VIEWER_PREFERENCES.resultPanelOpen;
    setResultOpen(DEFAULT_VIEWER_PREFERENCES.resultPanelOpen);
    setPosition({...DEFAULT_VIEWER_PREFERENCES.resultPanelPosition});
    setResultPanelSize({...DEFAULT_VIEWER_PREFERENCES.resultPanelSize});
  }
  const hasOverlayContent=useCombinedEngineOverlay||pathologyLayers.length>0||temporalLayers.length>0||boxes.length>0;
  function renderOverlayStack(stackStyle=null){
    if(!hasOverlayContent)return null;
    return <div className="editorOverlayStack" aria-label="Camadas de detecção sobre a imagem original" style={stackStyle||undefined}>
      {useCombinedEngineOverlay&&<img className={"engineOverlayImage "+(overlaySemantics==="transparent_layers"?"transparentOverlay":"compositeOverlay")} src={engineOverlay} alt={"Sobreposição de "+(chosen?.name||"motor")} style={{opacity}}/>}
      {[...orderedPathologyLayers].reverse().filter(layer=>visible["cdm_1:"+layer.id]!==false).map(layer=><img className="pathologyOverlay" key={layer.id} src={"data:image/png;base64,"+layer.overlay_png_base64} alt={layer.name} data-layer-id={layer.id} style={{opacity:opacity*Number(pathologyOpacity[layer.id]??1)}}/>)}
      {temporalLayers.filter(layer=>temporalLayerIsVisible(layer.id)).map(layer=><img className="pathologyOverlay temporalOverlay" key={"temporal-"+layer.id} src={"data:image/png;base64,"+layer.overlay_png_base64} alt={layer.name} style={{opacity}}/>)}
      {boxes.map((d,i)=><button key={i} className={"editorDetection "+(selectedDetection?.engineId===chosen?.engine_id&&selectedDetection.index===i?"selected":"")} title={d.label||"Achado"} aria-label={`Achado ${i+1}: ${d.label||"sem classificação"}`} style={{left:(d.box[0]/res.image_width*100)+"%",top:(d.box[1]/res.image_height*100)+"%",width:((d.box[2]-d.box[0])/res.image_width*100)+"%",height:((d.box[3]-d.box[1])/res.image_height*100)+"%"}} onClick={()=>{setActive(chosen.engine_id);setSelectedDetection({engineId:chosen.engine_id,index:i})}}/>)}
    </div>;
  }
  function renderBasePane(src,alt,badge,onMeasure=false,withOverlay=false){
    const resolvedSrc=src||localPreview;
    if(!resolvedSrc)return <div className={"editorImagePane editorImageMissing "+(withOverlay?"compositePane":"")}><span>Imagem base indisponível</span></div>;
    return <div className={"editorImagePane "+(withOverlay?"compositePane":"")}>
      <img className="editorBaseImage" src={resolvedSrc} alt={alt}
        onLoad={e=>{setPreviewError("");if(onMeasure)setImageSize({width:e.currentTarget.naturalWidth||1,height:e.currentTarget.naturalHeight||1})}}
        onError={()=>{if(resolvedSrc===prev&&localPreview&&localPreview!==prev)setPreviewError("Preview principal indisponível; usando cópia local do arquivo.");else setPreviewError("Não foi possível decodificar a imagem importada.")}}/>
      {withOverlay&&renderOverlayStack()}
      {badge&&<span className="editorPaneBadge">{badge}</span>}
    </div>;
  }
  function exportCdm(format,label){
    showStatusNotice("Exportação CDM · "+label,1200);
    onExportCdm(chosen,format);
  }
  function renderWipePane(src){
    const resolvedSrc=src||localPreview;
    if(!resolvedSrc)return <div className="editorImagePane editorImageMissing"><span>Imagem base indisponível</span></div>;
    return <div className="editorImagePane editorWipePane">
      <img className="editorBaseImage" src={resolvedSrc} alt="Comparação deslizante com imagem original"
        onLoad={e=>{setPreviewError("");setImageSize({width:e.currentTarget.naturalWidth||1,height:e.currentTarget.naturalHeight||1})}}
        onError={()=>setPreviewError("Não foi possível decodificar a imagem importada.")}/>
      {renderOverlayStack({clipPath:`inset(0 0 0 ${wipePosition}%)`})}
      <div className="editorWipeDivider" style={{left:wipePosition+"%"}}>
        <button className={"editorWipeHandle "+(wipeDragging?"dragging":"")} type="button" role="slider" aria-orientation="horizontal" aria-label="Divisor original e detecção" aria-valuemin="5" aria-valuemax="95" aria-valuenow={Math.round(wipePosition)} aria-valuetext={Math.round(wipePosition)+"%"} title="Arraste ou use ← →, Home e End" onPointerDown={beginWipeDrag} onKeyDown={wipeHandleKey}>
          <ChevronLeft className={"wipeArrowIcon left "+(wipeDirection==="left"?"active":"")} size={7} strokeWidth={2.4} aria-hidden="true"/>
          <ChevronRight className={"wipeArrowIcon right "+(wipeDirection==="right"?"active":"")} size={7} strokeWidth={2.4} aria-hidden="true"/>
        </button>
      </div>
      <span className="editorPaneBadge">original ↔ detecção</span>
    </div>;
  }
  const statusMessage=error
    ||previewError
    ||(progress?.state==="cancelled"?"Análise cancelada":"")
    ||(busy?("Processando análise · "+(progress?.total===100?pct+"%":(progress?.completed||0)+"/"+(progress?.total||selected.length))):"")
    ||statusNotice
    ||(kind==="3d"?"Arquivo 3D reconhecido · análise 2D indisponível":"Pronto");
  return <section className="analysisEditor" aria-label="Workspace de análise">
    <div className="editorTop">
      <div className="editorBrand"><span className="editorMark">S</span><strong>SHM Studio</strong><span className="editorMenus"><span>Arquivo</span><span>Editar</span><span>Visualizar</span><span>Análise</span></span></div>
      <div className="editorFileTitle">{file?.name||"Nova inspeção"} {kind&&"· "+kind.toUpperCase()}<span className="editorEngineState">{selectedEngineLabels.length===0?"Nenhum motor":selectedEngineLabels.length===1?selectedEngineLabels[0].name+(selectedEngineLabels[0].browser_ready?" · browser local":""):selectedEngineLabels.length+" motores · comparação"}</span></div>
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
      <div className="editorTools" aria-label="Ferramentas">
        <div className="editorToolButtons">
          <button aria-label="Mostrar ou ocultar painel de camadas" title="Mostrar ou ocultar camadas" onClick={()=>setLayersOpen(v=>{const next=!v;showStatusNotice(next?"Camadas abertas":"Camadas recolhidas",900);return next})}><Layers3/></button>
          <button aria-label="Ampliar zoom" title="Ampliar" onClick={()=>changeZoom(.25)}><Plus/></button>
          <button aria-label="Reduzir zoom" title="Reduzir" onClick={()=>changeZoom(-.25)}><Minus/></button>
          <button title="Ajustar à tela" aria-label="Ajustar à tela" onClick={fitView}><Maximize2/></button>
          <button aria-label="Abrir modo câmera" title="Modo câmera" disabled={busy} onClick={()=>setCameraOpen(true)}><Camera/></button>
        </div>
      </div>
      {layersOpen&&<><aside className={"editorLayers "+(selectedEngineLabels.length>=24?"engineDensityUltra":selectedEngineLabels.length>=12?"engineDensityDense":"")} data-engine-count={selectedEngineLabels.length} data-layer-width={layersWidth} style={{width:layersWidth,"--engine-count":Math.max(1,selectedEngineLabels.length)}}><div className="editorLayersContent"><div className="editorPanelTitle"><b>Camadas</b><button aria-label="Recolher painel de camadas" title="Recolher camadas" onClick={()=>setLayersOpen(false)}><ChevronLeft size={17}/></button></div>
        <div className="layerRow"><span>◉</span> Arquivo atual · t1</div>
        {referenceFile&&<div className="layerRow referenceLayer"><span>○</span><span>Referência · t0 <small>{referenceFile.name}</small>{linkedReferenceCompatibility&&<em className={"referenceCompatibility "+linkedReferenceCompatibility.status} title={linkedReferenceCompatibility.refLabel}>{linkedReferenceCompatibility.text}</em>}</span><button className="layerClear" aria-label="Remover referência temporal t0" disabled={busy} title="Remover referência t0" onClick={()=>onReferenceFile(null)}><X size={13}/></button></div>}
        {results.map(r=><label className="layerRow" key={r.engine_id}><input type="checkbox" checked={visible[r.engine_id]!==false} onChange={e=>setVisible(v=>({...v,[r.engine_id]:e.target.checked}))}/>{r.name}</label>)}
        {pathologyLayers.length>0&&<details open className="pathologyLayerGroup"><summary><span>CDM-1 · Patologias</span><small>{pathologyVisibleCount}/{pathologyLayers.length} visíveis</small></summary><div className="layerGroupActions"><button type="button" onClick={()=>setPathologyGroupVisible(true)}>Mostrar todas</button><button type="button" onClick={()=>setPathologyGroupVisible(false)}>Ocultar todas</button></div>{orderedPathologyLayers.map((layer,index)=><div className={"layerRow pathologyLayer "+(selectedPathologyId===layer.id?"selected":"")} key={layer.id} onClick={()=>setSelectedPathologyId(layer.id)}><label className="pathologyToggle"><input type="checkbox" checked={visible["cdm_1:"+layer.id]!==false} onChange={e=>setVisible(v=>({...v,["cdm_1:"+layer.id]:e.target.checked}))}/><span className="pathologySwatch" style={{background:layer.color}}/><span className="pathologyName">{layer.name}</span><small>({layer.count})</small></label><span className="layerStackLabel">{index===0?"TOPO":index===orderedPathologyLayers.length-1?"FUNDO":index+1}</span>{pathologyLocked.has(layer.id)&&<span className="layerLockState" title="Camada bloqueada"><Lock size={10}/></span>}<span className="layerOrderControls"><button type="button" disabled={pathologyLocked.has(layer.id)||index===0} aria-label={"Subir camada "+layer.name} title={"Subir "+layer.name} onClick={()=>movePathologyLayer(layer.id,-1)}><ChevronUp size={11}/></button><button type="button" disabled={pathologyLocked.has(layer.id)||index===orderedPathologyLayers.length-1} aria-label={"Descer camada "+layer.name} title={"Descer "+layer.name} onClick={()=>movePathologyLayer(layer.id,1)}><ChevronDown size={11}/></button></span><button className="layerSolo" type="button" title={"Isolar "+layer.name} onClick={()=>isolatePathologyLayer(layer.id)}>Só</button></div>)}</details>}
        {temporalLayers.length>0&&<details className={"temporalLayerGroup "+(temporalQuality?.status||"")}><summary><span>Mudança t0→t1</span><small>{temporalQuality?.status==="fail"?"não validada":temporalQuality?.status==="warning"?"ressalvas":temporalQuality?.status==="pass"?temporalVisibleCount+"/"+temporalLayers.length+" visíveis":temporalLayers.length+" camadas"}</small></summary><div className="layerGroupActions"><button type="button" onClick={()=>setTemporalGroupVisible(true)}>Mostrar todas</button><button type="button" onClick={()=>setTemporalGroupVisible(false)}>Ocultar todas</button></div>{temporalLayers.map(layer=><label className="layerRow pathologyLayer temporalLayer" key={"temporal-"+layer.id}><input type="checkbox" checked={temporalLayerIsVisible(layer.id)} onChange={e=>setVisible(v=>({...v,["cdm_1:temporal:"+layer.id]:e.target.checked}))}/><span className="pathologySwatch" style={{background:layer.color}}/>{layer.name} <small>({layer.count})</small></label>)}</details>}
        <div className="editorPanelTitle"><b>Propriedades</b></div>
        <p>Tipo reconhecido: <b>{kind==="2d"?"Imagem 2D":kind==="3d"?"Modelo 3D":"Indefinido"}</b></p>
        {kind==="unknown"&&<div className="editorTypeChoice"><button onClick={()=>setKind("2d")}>Tratar como 2D</button><button onClick={()=>setKind("3d")}>Tratar como 3D</button></div>}
        {selectedPathology&&<div className={"layerInspector "+(selectedPathologyLocked?"locked":"")}><div className="layerInspectorHeader"><span className="pathologySwatch" style={{background:selectedPathology.color}}/><b>{selectedPathology.name}</b><small>{selectedPathology.count} achado(s) · {selectedPathologyIndex===0?"topo":selectedPathologyIndex===orderedPathologyLayers.length-1?"fundo":"posição "+(selectedPathologyIndex+1)}</small></div><label><span>Opacidade da camada</span><b>{Math.round(selectedPathologyOpacity*100)}%</b><input aria-label={"Opacidade de "+selectedPathology.name} type="range" min="0" max="1" step=".05" value={selectedPathologyOpacity} disabled={selectedPathologyLocked} onChange={e=>setSelectedPathologyOpacity(e.target.value)}/></label><div className="layerInspectorActions"><button type="button" className="layerOpacityReset" disabled={selectedPathologyLocked} onClick={()=>setSelectedPathologyOpacity(1)}>Restaurar 100%</button><button type="button" className="layerLockToggle" title={selectedPathologyLocked?"Desbloquear camada":"Bloquear camada"} onClick={toggleSelectedPathologyLock}>{selectedPathologyLocked?<><Unlock size={10}/> Desbloquear</>:<><Lock size={10}/> Bloquear</>}</button></div></div>}
        <p>Sobreposição global: {Math.round(opacity*100)}%</p><input aria-label="Opacidade da sobreposição" type="range" min="0" max="1" step=".05" value={opacity} onChange={e=>setOpacity(Number(e.target.value))}/><button className="viewerReset" type="button" onClick={resetViewerPreferences}>Restaurar visualização</button>
        </div>
        <div className="editorSidebarEngines" aria-label="Motores ativos" title={selectedEngineLabels.map(engine=>engine.name).join(", ")||"Nenhum motor selecionado"}>
          <small>MOTORES ATIVOS</small>
          <div className="editorSidebarEngineList">
            {selectedEngineLabels.length?selectedEngineLabels.slice(0,12).map(engine=><span className="editorSidebarEngineName" key={engine.id}>{engine.name}</span>):<span className="editorSidebarEngineName">—</span>}
            {selectedEngineLabels.length>12&&<span className="editorSidebarEngineOverflow">+{selectedEngineLabels.length-12} motores</span>}
          </div>
        </div>
      </aside><div className="editorLayerResizeHandle" role="separator" tabIndex="0" aria-orientation="vertical" aria-label="Redimensionar painel de camadas" aria-valuemin="340" aria-valuemax="600" aria-valuenow={Math.round(layersWidth)} aria-valuetext={Math.round(layersWidth)+" pixels"} title="Arraste ou use ← →, Home e End" onKeyDown={resizeLayersKey} onPointerDown={beginLayersResize}/></>}
      <div className="editorViewport" ref={surface}>
        <button className="editorCameraEntry" disabled={busy} onClick={()=>setCameraOpen(true)}><Camera size={16}/> Câmera</button>
        {file&&<div className="editorTypeBadge">{kind==="2d"?"▧  2D detectado":kind==="3d"?"◇  3D detectado":"Tipo indefinido"}</div>}
        {!file?<div className="editorEmpty"><ImagePlus size={38}/><h2>Importe uma imagem ou modelo</h2><p>A imagem 2D pode ser analisada pelos motores selecionados. O tipo de arquivo é reconhecido automaticamente.</p><button onClick={()=>picker.current?.click()}>Selecionar arquivo</button></div>:
        kind==="3d"?<Suspense fallback={<div className="editorEmpty">Preparando visualizador 3D…</div>}><ModelViewport file={file}/></Suspense>:
        <div ref={canvasElement} className={"editorImage "+((comparison==="side"||comparison==="temporal")?"editorSide":"")} role="region" tabIndex="0" aria-label="Canvas de análise; botão do meio, Espaço mais arraste, setas, roda/trackpad ou toque para deslocar; Ctrl ou Command com roda, pinça, mais e menos para zoom; zero para ajustar à tela" aria-keyshortcuts="Space ArrowLeft ArrowRight ArrowUp ArrowDown + - 0" data-touch-mode={zoom>1?"pan-pinch":"pinch-scroll"} data-pan-mode={canvasPointerPanning?"grabbing":spacePanHeld?"ready":"idle"} onKeyDown={canvasKeyDown} onKeyUp={canvasKeyUp} onBlur={canvasBlur} onWheel={canvasWheel} onPointerDown={canvasPanStart} onPointerMove={canvasPanMove} onPointerUp={canvasPanEnd} onPointerCancel={canvasPanEnd} onAuxClick={e=>{if(e.button===1)e.preventDefault()}} style={{transform:`translate(${canvasPan.x}px, ${canvasPan.y}px) scale(${zoom})`,width:displaySize.width,height:displaySize.height}}>
          {comparison==="original"&&renderBasePane(basePreview,"Imagem original da inspeção","original",true,false)}
          {comparison==="overlay"&&renderBasePane(basePreview,"Imagem original da inspeção","original + camadas",true,true)}
          {comparison==="wipe"&&renderWipePane(basePreview)}
          {comparison==="side"&&<>
            {renderBasePane(basePreview,"Imagem original da inspeção","original",true,false)}
            {renderBasePane(basePreview,"Imagem original com camadas de detecção","original + detecções",false,true)}
          </>}
          {comparison==="temporal"&&<>
            {renderBasePane(showRawT0?referencePrev:(temporalAlignedPreview||referencePrev),showRawT0?"Referência temporal t0 bruta":temporalAlignedPreview?"Referência temporal t0 alinhada":"Referência temporal t0","t0 "+(showRawT0?"bruto":temporalAlignedPreview?"alinhado":"referência"),false,false)}
            {renderBasePane(basePreview,"Imagem atual t1 com camadas de detecção","t1 atual + camadas",true,true)}
          </>}
        </div>}
        {file&&kind==="2d"&&<div className="editorZoom"><button aria-label="Reduzir zoom" onClick={()=>changeZoom(-.25)}>−</button><span>{Math.round(zoom*100)}%</span><button aria-label="Ampliar zoom" onClick={()=>changeZoom(.25)}><Plus size={15}/></button></div>}
        {resultOpen&&(busy||results.length>0)&&<div ref={resultPanel} className="editorFloating" data-position-x={position.x} data-position-y={position.y} data-panel-width={resultPanelSize.width} data-panel-height={resultPanelSize.height||""} style={{transform:`translate(${position.x}px,${position.y}px)`,"--result-panel-width":resultPanelSize.width+"px",...(resultPanelSize.height?{"--result-panel-height":resultPanelSize.height+"px"}:{})}}>
          <div className="editorFloatHead"><button type="button" className="editorFloatMoveHandle" aria-label="Mover painel de resultados" title="Arraste ou use setas, Home e End para mover" onKeyDown={moveResultPanelKey} onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={dragEnd}><b>Resultados</b></button><button type="button" className="editorFloatResizeHandle" aria-label="Redimensionar painel de resultados" title="Arraste ou use setas; Home restaura e End maximiza" onKeyDown={resizeResultPanelKey} onPointerDown={beginResultResize}><Maximize2 size={13}/></button><button type="button" aria-label="Recolher painel de resultados" title="Recolher resultados" onClick={()=>setResultOpenPreference(false)}><Minus size={16}/></button></div>
          {busy&&<div className="editorProgress"><span>{progress?.current_engine||"Processando motores"} · {progress?.total===100?pct+"%":(progress?.completed||0)+"/"+(progress?.total||selected.length)}</span><strong>{String(Math.floor(elapsed/60)).padStart(2,"0")}:{String(elapsed%60).padStart(2,"0")}</strong><div><i style={{width:pct+"%"}}/></div>{onCancel&&<button onClick={onCancel} disabled={progress?.state==="cancel_requested"}>{progress?.state==="cancel_requested"?"Cancelando…":"Cancelar"}</button>}</div>}
          {!busy&&res&&durationMs!=null&&<div className="editorRunTime editorMetricRow"><span className="editorMetricLabel">Tempo medido</span><b className="editorMetricValue">{(durationMs/1000).toFixed(2)} s</b></div>}
          {results.map(r=><button key={r.engine_id} className={"editorResultRow "+(chosen?.engine_id===r.engine_id?"active":"")} onClick={()=>{setActive(r.engine_id);setVisible(v=>({...v,[r.engine_id]:true}))}}><span className="editorResultEngine">{r.name}</span><span className="editorResultMetric"><small>Achados</small><b>{r.detections?.length||0}</b></span><span className="editorResultMetric"><small>Latência</small><b>{Number(r.latency_ms||0).toFixed(0)} ms</b></span></button>)}
          {cdmSummary&&<div className="editorCdmSummary"><b className="editorCdmTitle">CDM-1 · resumo morfológico</b><div className="editorMetricsGrid"><div className="editorMetricRow accentA"><span className="editorMetricLabel">Achados</span><b className="editorMetricValue">{cdmSummary.total_objects}</b></div><div className="editorMetricRow accentB"><span className="editorMetricLabel">Fissuras</span><b className="editorMetricValue">{cdmSummary.crack_count}</b></div><div className="editorMetricRow accentC"><span className="editorMetricLabel">Comprimento</span><b className="editorMetricValue">{Number(cdmSummary.crack_length_total_px||0).toFixed(1)} px</b></div><div className="editorMetricRow accentD"><span className="editorMetricLabel">Desplacamento</span><b className="editorMetricValue">{Number(cdmSummary.spalling_area_px2||0).toFixed(0)} px²</b></div></div>{cdmRating?.enabled&&<p>Estimativa por imagem: NT {cdmRating.NT_img} · EC {cdmRating.EC_DNIT_img} · GDE {Number(cdmRating.GDE_img||0).toFixed(2)}. Confirme em inspeção técnica.</p>}{temporal?.enabled&&<p><b>t0→t1:</b> crescimento {temporalGrowth.toFixed(temporalCalibrated?1:0)} {temporalUnit} · redução {temporalReduction.toFixed(temporalCalibrated?1:0)} {temporalUnit} · {temporalAlignment?.accepted?<>registro automático Δx={Number(temporalAlignment.dx_px||0).toFixed(0)} px, Δy={Number(temporalAlignment.dy_px||0).toFixed(0)} px · ganho {(Number(temporalAlignment.improvement||0)*100).toFixed(1)}%</>:<>alinhamento {temporal?.alignment_method==="translation_auto"?"automático sem translação aplicada":"por redimensionamento"}</>}.</p>}{temporalMetricRows.length>0&&<details className="editorTemporalMetrics"><summary>Quantificação por patologia <small>{temporalUnit}</small></summary><div className="editorTemporalTable"><span className="head">Patologia</span><span className="head">t0</span><span className="head">t1</span><span className="head">Δ</span><span className="head">Δ/t0</span>{temporalMetricRows.map(row=><React.Fragment key={row.cls}><span title={"IoU "+row.iou.toFixed(3)}>{row.label}</span><span>{row.previous.toFixed(1)}</span><span>{row.current.toFixed(1)}</span><span className={row.net>0?"positive":row.net<0?"negative":""}>{row.net>0?"+":""}{row.net.toFixed(1)}</span><span>{row.netRate==null?"—":(row.netRate>0?"+":"")+row.netRate.toFixed(1)+"%"}</span></React.Fragment>)}</div></details>}{temporalQualityLabel&&<p className={"editorTemporalQuality "+temporalQuality.status}><b>{temporalQualityLabel}</b>{temporalQuality?.metrics&&<> · sobreposição {(Number(temporalQuality.metrics.overlap_ratio||0)*100).toFixed(1)}% · Δ iluminação {(Number(temporalQuality.metrics.illumination_delta||0)*100).toFixed(1)}% · razão de nitidez {Number(temporalQuality.metrics.sharpness_ratio||0).toFixed(2)} · similaridade geométrica {Number(temporalQuality.metrics.edge_similarity||0).toFixed(2)}</>}{temporalQualityNotes.length>0&&<span> · {temporalQualityNotes.join("; ")}</span>}</p>}{temporalRegistrationWarning&&<p className="editorCdmWarning">{temporalRegistrationWarning}</p>}{chosen?.metrics?.performance_ms&&<div className="editorPerf"><b className="editorPerfTitle">Tempo real</b><div className="editorMetricsGrid performance"><div className="editorMetricRow accentDecode"><span className="editorMetricLabel">Decodificação</span><b className="editorMetricValue">{(Number(chosen.metrics.performance_ms.decode||0)/1000).toFixed(2)} s</b></div><div className="editorMetricRow accentCore"><span className="editorMetricLabel">Núcleo</span><b className="editorMetricValue">{(Number(chosen.metrics.performance_ms.core||0)/1000).toFixed(2)} s</b></div><div className="editorMetricRow accentRender"><span className="editorMetricLabel">Renderização</span><b className="editorMetricValue">{(Number(chosen.metrics.performance_ms.render||0)/1000).toFixed(2)} s</b></div><div className="editorMetricRow accentTotal"><span className="editorMetricLabel">Total</span><b className="editorMetricValue">{(Number(chosen.metrics.performance_ms.total||0)/1000).toFixed(2)} s</b></div><div className="editorMetricRow accentRuntime"><span className="editorMetricLabel">Runtime</span><b className="editorMetricValue">{chosen.metrics.runtime||"browser"}</b></div></div></div>}</div>}
          {detail&&<div className="editorFinding"><b>{pathologyLayers.find(l=>l.id===detail.label)?.name||detail.label||detail.canonical_label||"Achado"} #{selectedDetection.index+1}</b><span>Motor: {chosen.name}</span><span>Confiança: {chosen.engine_id==="cdm_1"?"não calibrada":detail.score==null?"não informada":(Number(detail.score)*100).toFixed(1)+"%"}</span><span>Coordenadas: {detail.box.map(v=>Math.round(v)).join(", ")} px</span></div>}
          {results.length>0&&<div className="editorCompare editorViewActions">
            <button className={"editorIconButton "+(comparison==="original"?"active":"")} aria-label="Original" title="Original" data-tooltip="Original" onClick={()=>changeComparison("original")}><ImageIcon size={15}/></button>
            <button className={"editorIconButton "+(comparison==="overlay"?"active":"")} aria-label="Sobrepor" title="Sobrepor" data-tooltip="Sobrepor" onClick={()=>changeComparison("overlay")}><Layers3 size={15}/></button>
            <button className={"editorIconButton "+(comparison==="wipe"?"active":"")} aria-label="Deslizar" title="Deslizar" data-tooltip="Deslizar" onClick={()=>changeComparison("wipe")}><MoveHorizontal size={15}/></button>
            <button className={"editorIconButton "+(comparison==="side"?"active":"")} aria-label="Lado a lado" title="Lado a lado" data-tooltip="Lado a lado" onClick={()=>changeComparison("side")}><Columns2 size={15}/></button>
            {temporal?.enabled&&referencePrev&&<button className={comparison==="temporal"?"active temporalModeButton":"temporalModeButton"} title="Comparação temporal t0 / t1" onClick={()=>changeComparison("temporal")}>t0 / t1</button>}
            {comparison==="temporal"&&temporalAlignedPreview&&<button title={showRawT0?"Usar t0 alinhado":"Ver t0 bruto"} onClick={()=>setShowRawT0(v=>!v)}>{showRawT0?"Alinhado":"Bruto"}</button>}
            <details ref={exportMenu} className="editorExportMenu editorExportUnified">
              <summary className="editorIconButton" aria-label="Exportar" title="Exportar" data-tooltip="Exportar"><Download size={15}/></summary>
              <div>
                <span className="editorExportSection">Comparação</span>
                <button onClick={()=>{showStatusNotice("Exportação · JSON",1200);onExport()}}>JSON</button>
                <button onClick={()=>{showStatusNotice("Exportação · CSV",1200);onExportCsv()}}>CSV</button>
                {res.consensus_overlay_png_base64&&<button onClick={()=>{showStatusNotice("Exportação · Mapa PNG",1200);onExportMap()}}>Mapa PNG</button>}
                {cdmSummary&&<>
                  <span className="editorExportSection">CDM-1</span>
                  <button onClick={()=>exportCdm("svg","SVG camadas")}>SVG camadas</button>
                  <button onClick={()=>exportCdm("csv","CSV técnico")}>CSV técnico</button>
                  <button onClick={()=>exportCdm("coco","COCO")}>COCO</button>
                  <button onClick={()=>exportCdm("dxf","DXF")}>DXF</button>
                  <button onClick={()=>exportCdm("bim","BIM JSON")}>BIM JSON</button>
                  <button disabled={!Number(chosen.metrics?.mm_per_px)} title={!Number(chosen.metrics?.mm_per_px)?"Calibre mm/px para exportar IFC":""} onClick={()=>exportCdm("ifc","IFC")}>IFC</button>
                  <button onClick={()=>exportCdm("html","HTML")}>HTML</button>
                  {temporalAlignedPreview&&<button onClick={()=>exportCdm("aligned_t0","PNG t0 alinhado")}>PNG t0 alinhado</button>}
                </>}
              </div>
            </details>
          </div>}
        </div>}
        {!resultOpen&&(busy||results.length>0)&&<button className={"editorResultsTab "+(busy?"busy":"")} aria-live={busy?"polite":undefined} aria-label={busy?"Reabrir resultados · análise em andamento":"Reabrir resultados · "+results.length+" resultado"+(results.length===1?"":"s")} onClick={()=>setResultOpenPreference(true)}>
          <span>Resultados</span>
          <strong>{busy?(progress?.total===100?pct+"%":(progress?.completed||0)+"/"+(progress?.total||selected.length)):results.length}</strong>
          {busy&&<i aria-hidden="true"><b style={{width:pct+"%"}}/></i>}
        </button>}
      </div>
    </div>
    <div className="editorStatus"><span className={"editorStatusMessage "+(statusNotice&&!busy&&!error&&!previewError?"transient":"")} title={statusMessage}>{statusMessage}</span><span className="editorStatusMeta">Zoom {Math.round(zoom*100)}% · {kind?.toUpperCase()||"—"}{comparison==="wipe"?" · divisor "+Math.round(wipePosition)+"%":""}{appInfo?.deployment?.status==="divergent"&&<button className="editorUpdateAvailable" type="button" title="Há uma versão publicada mais recente. Recarregar sem usar o HTML em cache." onClick={()=>{const url=new URL(window.location.href);url.searchParams.set("build",String(appInfo?.deployment?.manifest?.sha||Date.now()));window.location.replace(url.toString())}}><RefreshCw size={11}/> Atualizar</button>}{appInfo?.channel==="development"&&<span className={"editorDevStamp "+(appInfo?.deployment?.status||"")} title={"Build de desenvolvimento · "+(appInfo?.buildSha||"—")+" · catálogo v"+(appInfo?.catalogVersion||"—")+" · deploy "+(appInfo?.deployment?.status||"não verificado")+(appInfo?.deployment?.manifest?.sha?" · publicado "+appInfo.deployment.manifest.sha:"")}>DEV · {String(appInfo?.buildSha||"—").slice(0,8)}{" "}<i className="editorDeployState" aria-label={"Deploy "+(appInfo?.deployment?.status||"não verificado")}>{appInfo?.deployment?.status==="synced"?"✓":appInfo?.deployment?.status==="divergent"?"!":appInfo?.deployment?.status==="unavailable"?"?":appInfo?.deployment?.status==="checking"?"…":""}</i></span>}</span></div>
    {cameraOpen&&<div className="editorModalBackdrop"><div className="editorCamera" role="dialog" aria-modal="true" aria-label="Modo câmera"><header><b>Modo câmera</b><button aria-label="Fechar modo câmera" title="Fechar câmera" onClick={()=>setCameraOpen(false)}><X size={19}/></button></header>{cameraError&&<p role="alert">{cameraError}</p>}<video ref={video} autoPlay playsInline muted onLoadedMetadata={()=>setCameraReady(true)}/><footer><span>{cameraError?"Verifique a permissão da câmera":cameraReady?"Prévia ao vivo · capture um quadro para análise 2D":"Aguardando câmera…"}</span><button onClick={capture} disabled={!!cameraError||!cameraReady}><Camera size={16}/> Capturar imagem</button></footer></div></div>}
  </section>
}
