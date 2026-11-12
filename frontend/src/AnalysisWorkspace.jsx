import React,{Suspense,useCallback,useEffect,useRef,useState} from "react";
import {FolderOpen,History,PencilLine,Save,Printer,LogOut,RotateCcw,Trash2,Mouse,CircleHelp,MousePointerClick,Lightbulb,Info,Search,Keyboard,Cpu,Globe,Bug,ExternalLink,Ruler,SquareDashed,Tag,Layers2,FlipHorizontal2,Camera,ChevronDown,ChevronLeft,ChevronRight,ChevronUp,Columns2,Download,Image as ImageIcon,ImagePlus,Layers3,BookOpen,Lock,Maximize2,Minus,MoveHorizontal,Play,Plus,Radio,RefreshCw,Settings2,SlidersHorizontal,Unlock,X} from "lucide-react";
import ImageInspector from "./ImageInspector.jsx";
import EngineStages from "./EngineStages.jsx";
import CanvasRulers,{RULER_UNITS} from "./CanvasRulers.jsx";
import ContextMenu from "./ContextMenu.jsx";
import {CdmIcon,MenuIcon,TipOfDayDialog,AboutDialog,ShortcutsDialog,CommandPalette,describeElement} from "./StudioHelp.jsx";
const ParityPanel=React.lazy(()=>import("./ParityPanel.jsx"));
import{DEFAULT_VIEWER_PREFERENCES,clampCanvasPan,clampFloatingPanelPosition,clampLayersPanelWidth,clampResultPanelSize,loadViewerPreferences,saveViewerPreferences,zoomCanvasPanAroundPoint,CANVAS_ZOOM_MIN,CANVAS_ZOOM_MAX}from"./viewerPreferences.js";
import{detectAsset,isCdm3SpatialAsset,SUPPORTED_IMAGE_EXTENSIONS,SUPPORTED_MODEL_EXTENSIONS}from"./assetDetection.js";
import{buildDamageTimeline,matchTemporalDamageCampaigns}from"./cdm3RegisteredProjection.js";
const IMAGE_ACCEPT=SUPPORTED_IMAGE_EXTENSIONS.map(ext=>"."+ext).join(",");
const ASSET_ACCEPT=[...SUPPORTED_IMAGE_EXTENSIONS,...SUPPORTED_MODEL_EXTENSIONS].map(ext=>"."+ext).join(",");
const ModelViewport=React.lazy(()=>import("./ModelViewport.jsx"));
function formatFileSize(bytes){
  const value=Number(bytes);
  if(!Number.isFinite(value)||value<0)return"—";
  if(value<1024)return value.toFixed(0)+" B";
  if(value<1024**2)return (value/1024).toFixed(1)+" KB";
  if(value<1024**3)return (value/1024**2).toFixed(1)+" MB";
  return (value/1024**3).toFixed(2)+" GB";
}
function imageLoadProfile(width,height){
  const w=Number(width),h=Number(height);
  if(!Number.isFinite(w)||!Number.isFinite(h)||w<1||h<1)return null;
  const decodedBytes=w*h*4;
  const level=decodedBytes>=128*1024**2?"high":decodedBytes>=48*1024**2?"moderate":"low";
  return {decodedBytes,level,label:level==="high"?"Alta":level==="moderate"?"Moderada":"Baixa"};
}

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
// Nome longo encurtado para 5 caracteres + "…" + extensão (ex.: "OAE-1….jpg").
function shortFileName(name){
  const s=String(name||""),m=s.match(/^(.*?)(\.[^.]{1,8})?$/),stem=m?.[1]||s,ext=m?.[2]||"";
  return stem.length>5?stem.slice(0,5)+"…"+ext:s;
}
const FINDING_PREFIX={cracks:"F",spalling_dark:"D",exposed_rebar:"A",corrosion_rust:"C",efflorescence_white:"E"};
function hexToRgba(hex,a){const m=/^#?([0-9a-f]{6})$/i.exec(String(hex||""));if(!m)return`rgba(13,118,110,${a})`;const n=parseInt(m[1],16);return`rgba(${n>>16&255},${n>>8&255},${n&255},${Math.max(0,Math.min(1,a)).toFixed(3)})`}
function formatMeasure(v,unit){const n=Number(v)||0,d=unit.startsWith("px")?(n<10?1:0):(n<10?2:n<100?1:0);return n.toLocaleString("pt-BR",{minimumFractionDigits:0,maximumFractionDigits:d})+" "+unit}

const HELP_LINKS=[["Repositório no GitHub","https://github.com/aaronkadima/SHM"],["SHM Studio · produção","https://aaronkadima.github.io/SHM/"],["SHM Studio · desenvolvimento","https://aaronkadima.github.io/SHM/dev/"],["Notas de versão (commits)","https://github.com/aaronkadima/SHM/commits/main"]];
const SHORTCUTS=[
  ["Arquivo",[["Ctrl/Cmd+O","Importar"],["Ctrl/Cmd+S","Salvar"],["Ctrl/Cmd+P","Imprimir"],["Ctrl/Cmd+Shift+W","Fechar visualização"],["Ctrl/Cmd+Q","Sair"],["Alt+1 … Alt+0","Abrir recente 1 a 10"]]],
  ["Análise",[["Ctrl/Cmd+Enter","Executar análise"],["Ctrl/Cmd+,","Configurações"]]],
  ["Visualização",[["Roda","Zoom no cursor (CAD)"],["Shift+roda","Mover a imagem"],["Botão do meio · arrastar","Mover"],["Duplo clique no meio · 0","Ajustar à tela"],["Espaço+arrastar","Mover"],["Ctrl/Cmd+Shift+R","Réguas"]]],
  ["Ajuda",[["F1","Ajuda (Aulas)"],["Shift+F1","Ajuda por contexto"],["/","Procurar e executar um comando"],["?","Esta lista"],["Botão direito","Menu de contexto"],["Shift+botão direito","Menu do navegador"]]],
];

// Largura comum da coluna esquerda: propriedades da imagem e resultados.
// Botões flutuantes Imagem/Resultados: 124 px; expandidos, o dobro.
export const FLOAT_BUTTON_WIDTH=124,IMAGE_PANEL_WIDTH=FLOAT_BUTTON_WIDTH*2;
const LEFT_DOCK_QUERY="(min-width:741px) and (min-height:621px)";

export default function AnalysisWorkspace({appInfo=null,executionIssue="",referenceValidating=false,selectedEngineLabels=[],file,prev,referenceFile,referencePrev,spatialRgbFile=null,spatialRgbPrev=null,onSpatialRgbFile=null,spatialRegistration=null,spatialTransform=null,spatialFrameAssets=null,onSolveSpatialFrameAlignment=null,spatialRgbAnalysis=null,spatialPhotoViews=[],activeSpatialPhotoId=null,onAddSpatialPhotos=null,onSelectSpatialPhoto=null,onRemoveSpatialPhoto=null,spatialAutoRegistrationBusy=false,spatialAutoRegistrationStatus=null,onAutoRegisterSpatialPhotos=null,spatialRegistrationPointCount=0,photometricSummary=null,onPhotometricSummary=null,onSpatialRegistrationSample=null,spatialPathologyRecords=[],onSpatialPathologyRecords=null,onSolveSpatialRegistration=null,referenceInspectionId,referenceInspectionMeta,inspectionMeta,res,busy,progress,selected,onFile,onReferenceFile,onRun,onCancel,onSettings,onLive=null,onRenameFile=null,onSaveFile=null,onApplyCorrection=null,onRestoreOriginal=null,hasOriginalFile=false,appliedCorrection=null,onImageDiagnostics=null,cdmOptions={},stageControl={},page=null,onNavigate=null,onCloseFile=null,onExit=null,rulers={visible:false,unit:"mm"},onRulersChange=null,aulasOpen=false,onToggleAulas=null,recentHistory=[],onOpenRecent=null,aulasHref="",onAulasNav=null,aulasCrumb="",error,onExport,onExportCsv,onExportMap,onExportCdm,onExportCdm3=null}){
  const [initialViewerPrefs]=useState(()=>loadViewerPreferences());
  const [initialCompactLayout]=useState(()=>typeof window!=="undefined"&&window.innerWidth<900);
  const [kind,setKind]=useState(null),[layersOpen,setLayersOpen]=useState(initialCompactLayout?false:initialViewerPrefs.layersOpen),[layersWidth,setLayersWidth]=useState(initialViewerPrefs.layersWidth??DEFAULT_VIEWER_PREFERENCES.layersWidth),[resultOpen,setResultOpen]=useState(initialViewerPrefs.resultPanelOpen);
  const [inspectorOpen,setInspectorOpen]=useState(()=>{try{return localStorage.getItem("shmImageInspectorOpen")==="1"}catch{return false}}),[inspectorTab,setInspectorTab]=useState("histogram"),[correctionPreview,setCorrectionPreview]=useState(null);
  const [imageQuality,setImageQuality]=useState(null),[qualityAck,setQualityAck]=useState(false),[renaming,setRenaming]=useState(false),[nameDraft,setNameDraft]=useState(""),[stagesActive,setStagesActive]=useState(false);
  const [recentOpen,setRecentOpen]=useState(false);
  const [wheelMode,setWheelMode]=useState(()=>{try{return localStorage.getItem("shmWheelMode")==="pan"?"pan":"zoom"}catch{return"zoom"}});
  const lastMiddleDown=useRef(null);
  const [showLabels,setShowLabels]=useState(()=>{try{return localStorage.getItem("shmShowDetectionLabels")!=="0"}catch{return true}}),[findingList,setFindingList]=useState(null);
  const [showBoxes,setShowBoxes]=useState(()=>{try{return localStorage.getItem("shmShowDetectionBoxes")!=="0"}catch{return true}}),[layerSettingsId,setLayerSettingsId]=useState(null);
  const aulasFrame=useRef(null),aulasLockRef=useRef(false);
  // Páginas do Studio (histórico, motores, relatórios, configurações) usam a mesma moldura: o canvas sai,
  // menus, barra lateral e status ficam. Atalhos do canvas ficam desligados enquanto a página está aberta.
  const pageOpen=!!page&&!aulasOpen,helpLockRef=useRef(false);helpLockRef.current=aulasOpen;
  aulasLockRef.current=aulasOpen||pageOpen;
  const [cameraOpen,setCameraOpen]=useState(false),[cameraError,setCameraError]=useState(""),[cameraReady,setCameraReady]=useState(false),[cameraFacing,setCameraFacing]=useState("environment"),[cameraCapturing,setCameraCapturing]=useState(false),[cameraResolution,setCameraResolution]=useState("");
  const [registrationOpen,setRegistrationOpen]=useState(false),[registrationPairs,setRegistrationPairs]=useState([]),[registrationPendingUv,setRegistrationPendingUv]=useState(null),[registrationBusy,setRegistrationBusy]=useState(false),[registrationError,setRegistrationError]=useState("");
  const [registrationIntrinsics,setRegistrationIntrinsics]=useState({fx:"",fy:"",cx:"",cy:""});
  const [spatialFramePairs,setSpatialFramePairs]=useState([]),[spatialFrameDraft,setSpatialFrameDraft]=useState({source:"",target:""}),[spatialFrameBusy,setSpatialFrameBusy]=useState(false),[spatialFrameError,setSpatialFrameError]=useState(""),[spatialFrameCollapsed,setSpatialFrameCollapsed]=useState(true);
  const [spatialFramePickMode,setSpatialFramePickMode]=useState(null),[spatialFramePendingSource,setSpatialFramePendingSource]=useState(null);
  const [zoom,setZoom]=useState(1),[canvasPan,setCanvasPan]=useState({x:0,y:0}),[spacePanHeld,setSpacePanHeld]=useState(false),[canvasPointerPanning,setCanvasPointerPanning]=useState(false),[opacity,setOpacity]=useState(initialViewerPrefs.opacity),[comparison,setComparison]=useState(initialViewerPrefs.comparison),[preferredComparison,setPreferredComparison]=useState(initialViewerPrefs.comparison),[wipePosition,setWipePosition]=useState(initialViewerPrefs.wipePosition??50),[wipeDirection,setWipeDirection]=useState(null),[wipeDragging,setWipeDragging]=useState(false),[showRawT0,setShowRawT0]=useState(false);
  const [active,setActive]=useState(null),[visible,setVisible]=useState({}),[position,setPosition]=useState(initialViewerPrefs.resultPanelPosition||DEFAULT_VIEWER_PREFERENCES.resultPanelPosition),[resultPanelSize,setResultPanelSize]=useState(initialViewerPrefs.resultPanelSize||DEFAULT_VIEWER_PREFERENCES.resultPanelSize);
  const [pathologyOrder,setPathologyOrder]=useState(initialViewerPrefs.pathologyOrder),[pathologyOpacity,setPathologyOpacity]=useState(initialViewerPrefs.pathologyOpacity||{}),[pathologyLocked,setPathologyLocked]=useState(new Set(initialViewerPrefs.pathologyLocked||[])),[selectedPathologyId,setSelectedPathologyId]=useState(null);
  const [selectedDetection,setSelectedDetection]=useState(null);
  const [spatialBaseline,setSpatialBaseline]=useState(null),[spatial4dRecords,setSpatial4dRecords]=useState([]),[spatialCampaigns,setSpatialCampaigns]=useState([]),[spatialTimelineIndex,setSpatialTimelineIndex]=useState(0),[spatialTimelinePlaying,setSpatialTimelinePlaying]=useState(false);
  const spatialTimeline=spatialCampaigns.length>1?buildDamageTimeline(spatialCampaigns):null,spatialTimelineSnapshot=spatialTimeline?.snapshots?.[Math.min(spatialTimelineIndex,Math.max(0,(spatialTimeline?.snapshots?.length||1)-1))]||null,displaySpatial4dRecords=spatialTimelineSnapshot?.records||spatial4dRecords;
  const [pathologyGroupOpen,setPathologyGroupOpen]=useState(()=>typeof window==="undefined"||window.innerHeight>=620);
  const [localPreview,setLocalPreview]=useState(null),[previewError,setPreviewError]=useState(""),[statusNotice,setStatusNotice]=useState(""),[statusNoticeTone,setStatusNoticeTone]=useState("info"),[fileDragActive,setFileDragActive]=useState(false);
  const [imageSize,setImageSize]=useState({width:1,height:1});
  const imageDecoded=imageSize.width>1&&imageSize.height>1;
  const imageMegapixels=imageDecoded?(imageSize.width*imageSize.height/1e6):null;
  const imageLoad=imageDecoded?imageLoadProfile(imageSize.width,imageSize.height):null;
  const [viewportSize,setViewportSize]=useState({width:0,height:0});
  const [startAt,setStartAt]=useState(null),[elapsed,setElapsed]=useState(0);
  const compactLayout=useRef(initialCompactLayout),desktopLayersPreference=useRef(initialViewerPrefs.layersOpen);
  const video=useRef(null),stream=useRef(null),picker=useRef(null),referencePicker=useRef(null),spatialRgbPicker=useRef(null),spatialMultiPicker=useRef(null),analyzeButton=useRef(null),surface=useRef(null),canvasElement=useRef(null),resultPanel=useRef(null),exportMenu=useRef(null),drag=useRef(null),resultResizeDrag=useRef(null),resultOpenPreference=useRef(initialViewerPrefs.resultPanelOpen),busyForcedResults=useRef(false),canvasDrag=useRef(null),canvasTouch=useRef({points:new Map(),mode:null}),spacePan=useRef(false),zoomRef=useRef(1),statusTimer=useRef(null),wipeDirectionTimer=useRef(null),fileDragDepth=useRef(0),cameraCaptureSeq=useRef(0),registrationImage=useRef(null);
  useEffect(()=>{if(!spatialTimelinePlaying||!spatialTimeline?.snapshots?.length)return;const timer=setInterval(()=>setSpatialTimelineIndex(index=>{const last=spatialTimeline.snapshots.length-1;if(index>=last){setSpatialTimelinePlaying(false);return last}return index+1}),1200);return()=>clearInterval(timer)},[spatialTimelinePlaying,spatialTimeline?.snapshots?.length]);
  useEffect(()=>setKind(detectAsset(file)),[file]);
  useEffect(()=>{setRegistrationOpen(false);setRegistrationPairs([]);setRegistrationPendingUv(null);setRegistrationBusy(false);setRegistrationError("");setRegistrationIntrinsics({fx:"",fy:"",cx:"",cy:""})},[file,spatialRgbFile]);
  useEffect(()=>{if(busy){fileDragDepth.current=0;setFileDragActive(false);setCameraOpen(false)}},[busy]);
  useEffect(()=>{
    const syncCompactLayout=()=>{
      const next=window.innerWidth<900;
      if(next===compactLayout.current)return;
      compactLayout.current=next;
      setLayersOpen(next?false:desktopLayersPreference.current);
    };
    window.addEventListener("resize",syncCompactLayout);
    return()=>window.removeEventListener("resize",syncCompactLayout);
  },[]);
  useEffect(()=>{
    const onPaste=e=>{
      if(aulasLockRef.current)return;
      const target=e.target;
      if(target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement||target?.isContentEditable)return;
      const files=[...(e.clipboardData?.files||[])].filter(item=>detectAsset(item)==="2d");
      if(!files.length)return;
      e.preventDefault();
      if(busy){showStatusNotice("Aguarde a análise atual terminar para colar outra imagem.",1800,"warning");return}
      if(files.length!==1){showStatusNotice("Cole apenas uma imagem por vez.",1800,"warning");return}
      onFile(files[0]);
      showStatusNotice("Imagem colada da área de transferência",1500);
    };
    window.addEventListener("paste",onPaste);
    return()=>window.removeEventListener("paste",onPaste);
  },[busy,onFile]);
  useEffect(()=>{
    const onShortcut=e=>{
      if(!(e.ctrlKey||e.metaKey)||e.altKey)return;
      if(aulasLockRef.current)return;
      const target=e.target;
      if(target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement||target instanceof HTMLSelectElement||target?.isContentEditable)return;
      if(cameraOpen)return;
      const key=String(e.key||"").toLowerCase();
      if(key==="o"&&!e.shiftKey){
        e.preventDefault();
        if(busy){showStatusNotice("Aguarde a análise atual terminar para importar outro arquivo.",1800,"warning");return}
        picker.current?.click();
        return;
      }
      if(key==="s"&&!e.shiftKey){
        e.preventDefault();
        if(!file){showStatusNotice("Nenhum arquivo para salvar.",1400,"warning");return}
        onSaveFile?.();showStatusNotice("Arquivo salvo · "+file.name,1600);
        return;
      }
      if(key==="r"&&e.shiftKey){
        e.preventDefault();toggleRulers();
        return;
      }
      if(key===","&&!e.shiftKey){
        e.preventDefault();
        if(busy){showStatusNotice("Configurações indisponíveis durante a análise.",1600,"warning");return}
        onSettings?.();
        return;
      }
      if(e.key==="Enter"&&!e.shiftKey){
        e.preventDefault();
        const button=analyzeButton.current;
        if(!button||button.disabled){showStatusNotice("Análise indisponível com a configuração atual.",1600,"warning");return}
        button.click();
      }
    };
    window.addEventListener("keydown",onShortcut);
    return()=>window.removeEventListener("keydown",onShortcut);
  },[busy,cameraOpen,onSettings,onSaveFile,file,rulers,onRulersChange,cdmOptions]);
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
      const openEditorMenus=[...document.querySelectorAll(".editorMenu[open]")];
      if(openEditorMenus.length){
        openEditorMenus.forEach(menu=>menu.removeAttribute("open"));
        handled=true;
      }
      if(compactLayout.current&&layersOpen){
        setLayersOpen(false);
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
  },[cameraOpen,layersOpen]);
  useEffect(()=>{
    const closeMenus=e=>{
      if(e.target?.closest?.(".editorMenus"))return;
      document.querySelectorAll(".editorMenu[open]").forEach(menu=>menu.removeAttribute("open"));
    };
    window.addEventListener("pointerdown",closeMenus);
    return()=>window.removeEventListener("pointerdown",closeMenus);
  },[]);

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
  // Arquivo novo sem análise abre em "Original": modos com detecções só depois de analisar.
  useEffect(()=>{setSelectedDetection(null);setActive(null);setVisible({});applyCanvasZoom(1);setCanvasPan({x:0,y:0});setComparison(res||preferredComparison==="temporal"?preferredComparison:"original");setShowRawT0(false)},[file,referenceFile]);
  useEffect(()=>{if(!res&&(comparison==="overlay"||comparison==="wipe"||comparison==="side"))setComparison("original")},[res,comparison]);
  useEffect(()=>{
    const rows=Array.isArray(res?.results)?res.results:[];
    if(!rows.length)return;
    resultOpenPreference.current=true;
    setResultOpen(true);
    setSelectedDetection(null);
    setActive(current=>current&&rows.some(row=>row.engine_id===current)?current:(rows[0]?.engine_id||null));
    setVisible(current=>{
      const next={...current};
      for(const row of rows)next[row.engine_id]=true;
      return next;
    });
    const hasResultOverlay=rows.some(row=>!!row?.overlay_png_base64||Number(row?.detections?.length||0)>0);
    if(hasResultOverlay)setComparison(current=>(current==="original"||(current==="temporal"&&!referenceFile))?(["overlay","wipe","side"].includes(preferredComparison)?preferredComparison:"overlay"):current);
  },[res,referenceFile]);
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
  useEffect(()=>{saveViewerPreferences({opacity,layersOpen:compactLayout.current?desktopLayersPreference.current:layersOpen,layersWidth,comparison:preferredComparison,wipePosition,pathologyOrder,pathologyOpacity,pathologyLocked:[...pathologyLocked],resultPanelOpen:resultOpenPreference.current,resultPanelPosition:position,resultPanelSize})},[opacity,layersOpen,layersWidth,preferredComparison,wipePosition,pathologyOrder,pathologyOpacity,pathologyLocked,resultOpen,position,resultPanelSize]);
  useEffect(()=>{
    if(busy){
      busyForcedResults.current=true;
      setResultOpen(true);
    }else if(busyForcedResults.current){
      busyForcedResults.current=false;
      setResultOpen(resultOpenPreference.current);
    }
  },[busy]);
  const measuredDurationMs=Number(res?.metadata?.client_elapsed_ms),hasMeasuredDuration=Number.isFinite(measuredDurationMs)&&measuredDurationMs>=0;
  useEffect(()=>{
    if(busy&&!res){const now=performance.now();setStartAt(now);setElapsed(0);return}
    if(res&&hasMeasuredDuration)setElapsed(Math.floor(measuredDurationMs/1000));
    setStartAt(null);
  },[busy,res,hasMeasuredDuration,measuredDurationMs]);
  useEffect(()=>{if(startAt==null)return;const tick=()=>setElapsed(Math.floor((performance.now()-startAt)/1000));tick();const id=setInterval(tick,250);return()=>clearInterval(id)},[startAt]);
  useEffect(()=>{if(!cameraOpen)return;let cancelled=false;setCameraError("");setCameraReady(false);setCameraCapturing(false);setCameraResolution("");
    if(!navigator.mediaDevices?.getUserMedia){setCameraError("Câmera indisponível neste navegador ou fora de uma conexão segura.");return}
    const constraints={video:{facingMode:{ideal:cameraFacing},width:{ideal:1920},height:{ideal:1080}},audio:false};
    navigator.mediaDevices.getUserMedia(constraints).then(s=>{
      if(cancelled){s.getTracks().forEach(t=>t.stop());return}
      stream.current=s;
      const track=s.getVideoTracks()[0];
      track?.addEventListener?.("ended",()=>{if(!cancelled){setCameraReady(false);setCameraError("A câmera foi desconectada ou interrompida.")}},{once:true});
      if(video.current){video.current.srcObject=s;video.current.play().catch(e=>setCameraError("Não foi possível iniciar a prévia: "+e.message))}
    }).catch(e=>{
      const name=String(e?.name||"");
      const message=name==="NotAllowedError"?"Permissão de câmera negada. Autorize o acesso nas configurações do navegador.":name==="NotFoundError"?"Nenhuma câmera compatível foi encontrada.":"Não foi possível acessar a câmera: "+(e?.message||String(e));
      setCameraError(message);
    });
    return()=>{cancelled=true;cameraCaptureSeq.current++;setCameraCapturing(false);setCameraReady(false);stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;if(video.current)video.current.srcObject=null}
  },[cameraOpen,cameraFacing]);
  useEffect(()=>{if(!cameraOpen)return;const onKey=e=>{if(e.key==="Escape")setCameraOpen(false)};window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey)},[cameraOpen]);
  useEffect(()=>{if(!cameraOpen)return;
    const closeHidden=()=>{if(document.visibilityState==="hidden")setCameraOpen(false)};
    const closePage=()=>setCameraOpen(false);
    document.addEventListener("visibilitychange",closeHidden);
    window.addEventListener("pagehide",closePage);
    return()=>{document.removeEventListener("visibilitychange",closeHidden);window.removeEventListener("pagehide",closePage)}
  },[cameraOpen]);
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
  const basePreview=correctionPreview||localPreview||prev;
  const pathologyEngineId=(chosen?.engine_id==="cdm_1"||chosen?.engine_id==="cdm_3")?chosen.engine_id:null;
  const pathologyLayers=pathologyEngineId?chosen.metrics?.layers||[]:[];
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
  const pathologyVisibleCount=orderedPathologyLayers.filter(layer=>visible[pathologyEngineId+":"+layer.id]!==false).length;
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
  const cdmSummary=pathologyEngineId?chosen.metrics?.summary:null;
  const spatialSummary=chosen?.engine_id==="cdm_3"&&chosen?.metrics?.runtime_mode==="spatial_browser_ingestion"?chosen.metrics?.spatial_asset:null;
  const cdmRating=cdmSummary?.condition_rating;
  const engineOverlay=chosen?.overlay_png_base64?"data:image/png;base64,"+chosen.overlay_png_base64:null;
  const overlaySemantics=chosen?.metrics?.overlay_semantics||"composite_or_unknown";
  const useCombinedEngineOverlay=!!engineOverlay&&pathologyLayers.length===0;
  // Caixas seguem a visibilidade da camada do motor ativo (antes a chave era fixa em cdm_1 e o CDM-3 não escondia nada).
  const boxLayerVisible=label=>!pathologyLayers.length||(visible[pathologyEngineId+":"+label]!==false&&visible[pathologyEngineId+":boxes:"+label]!==false);
  const labelLayerVisible=label=>showLabels&&(!pathologyLayers.length||(visible[pathologyEngineId+":"+label]!==false&&visible[pathologyEngineId+":labels:"+label]!==false));
  // Achados: índice estável (= registro CDM), código por classe (F1, D2…) e medidas formatadas.
  const findingRecords=chosen?.metrics?.records||[];
  const findingMmPerPx=Number(chosen?.metrics?.mm_per_px)>0?Number(chosen.metrics.mm_per_px):0;
  const findings=(()=>{const seen={};return(chosen?.detections||[]).map((d,i)=>{const cls=d.label||d.canonical_label||"achado";seen[cls]=(seen[cls]||0)+1;return{...d,_i:i,code:(FINDING_PREFIX[cls]||String(cls)[0]?.toUpperCase()||"A")+seen[cls],record:findingRecords[i]||null}})})();
  const boxScaleW=Number(chosen?.metrics?.processed_width)||res?.image_width||1,boxScaleH=Number(chosen?.metrics?.processed_height)||res?.image_height||1;
  const boxes=findings.filter(d=>Array.isArray(d.box)&&d.box.length>=4&&boxLayerVisible(d.label));
  const layerColorById=Object.fromEntries(pathologyLayers.map(l=>[l.id,l.color]));
  const detail=selectedDetection&&chosen&&selectedDetection.engineId===chosen.engine_id?findings[selectedDetection.index]||null:null;
  const panes=comparison==="side"||comparison==="temporal"?2:1;
  const liveViewportWidth=Number(surface.current?.clientWidth)||Number(viewportSize.width)||1;
  const liveViewportHeight=Number(surface.current?.clientHeight)||Number(viewportSize.height)||1;
  const safeViewport={width:Math.max(1,liveViewportWidth),height:Math.max(1,liveViewportHeight)};
  const safeImage={width:Math.max(1,Number(imageSize.width)||1),height:Math.max(1,Number(imageSize.height)||1)};
  const fit=Math.min(safeViewport.width*.83/(safeImage.width*panes),safeViewport.height*.8/safeImage.height);
  const displaySize={width:Math.max(96,safeImage.width*fit*panes),height:Math.max(72,safeImage.height*fit)};
  useEffect(()=>{setCanvasPan(current=>{const next=clampCanvasPan(current,{viewportWidth:surface.current?.clientWidth||viewportSize.width,viewportHeight:surface.current?.clientHeight||viewportSize.height,canvasWidth:displaySize.width,canvasHeight:displaySize.height,zoom,minVisible:56});return next.x===current.x&&next.y===current.y?current:next})},[zoom,viewportSize.width,viewportSize.height,displaySize.width,displaySize.height]);
  const pct=progress?.total?Math.min(100,Math.round(progress.completed/progress.total*100)):0;
  function capture(){
    const v=video.current;
    if(cameraCapturing)return;
    if(!v?.videoWidth||!v?.videoHeight){setCameraError("A prévia ainda não possui resolução válida para captura.");return}
    const canvas=document.createElement("canvas");canvas.width=v.videoWidth;canvas.height=v.videoHeight;
    const context=canvas.getContext("2d");
    if(!context){setCameraError("O navegador não conseguiu preparar a captura.");return}
    const captureToken=++cameraCaptureSeq.current;
    setCameraCapturing(true);
    context.drawImage(v,0,0);
    canvas.toBlob(blob=>{
      if(captureToken!==cameraCaptureSeq.current)return;
      if(blob){
        onFile(new File([blob],"captura-"+new Date().toISOString().replace(/[:.]/g,"-")+".png",{type:"image/png",lastModified:Date.now()}));
        setCameraOpen(false);
      }else{setCameraCapturing(false);setCameraError("Falha ao converter o quadro capturado.")}
    },"image/png");
  }
  function fileDragHasFiles(e){
    const types=[...(e?.dataTransfer?.types||[])];
    return types.includes("Files");
  }
  function fileDragEnter(e){
    if(!fileDragHasFiles(e))return;
    e.preventDefault();
    fileDragDepth.current++;
    if(!busy)setFileDragActive(true);
  }
  function fileDragOver(e){
    if(!fileDragHasFiles(e))return;
    e.preventDefault();
    e.dataTransfer.dropEffect=busy?"none":"copy";
  }
  function fileDragLeave(e){
    if(!fileDragHasFiles(e))return;
    e.preventDefault();
    fileDragDepth.current=Math.max(0,fileDragDepth.current-1);
    if(fileDragDepth.current===0)setFileDragActive(false);
  }
  function fileDrop(e){
    if(!fileDragHasFiles(e))return;
    e.preventDefault();
    fileDragDepth.current=0;
    setFileDragActive(false);
    if(busy){showStatusNotice("Aguarde a análise atual terminar para importar outro arquivo.",1800,"warning");return}
    const files=[...(e.dataTransfer.files||[])];
    if(files.length!==1){showStatusNotice("Solte apenas um arquivo por vez.",1800,"warning");return}
    const dropped=files[0];
    if(detectAsset(dropped)==="unknown"){showStatusNotice("Formato não suportado · use um formato listado em Importar.",1800,"warning");return}
    onFile(dropped);
    showStatusNotice("Arquivo importado por arrastar e soltar",1600);
  }
  useEffect(()=>{try{localStorage.setItem("shmImageInspectorOpen",inspectorOpen?"1":"0")}catch{}},[inspectorOpen]);
  // Resultados ficam logo abaixo do botão/painel "Imagem" (coluna esquerda do canvas).
  const [contextMenu,setContextMenu]=useState(null),[parityOpen,setParityOpen]=useState(false);
  const [helpDialog,setHelpDialog]=useState(null),[helpSubmenu,setHelpSubmenu]=useState(null),[contextHelp,setContextHelp]=useState(null);
  const closeContextMenu=useCallback(()=>setContextMenu(null),[]);
  const [leftStackTop,setLeftStackTop]=useState(null);
  const resultUserMoved=useRef(!!(initialViewerPrefs.resultPanelPosition?.x||initialViewerPrefs.resultPanelPosition?.y));
  useEffect(()=>{
    const vp=surface.current;
    if(!vp||kind!=="2d"||!file||typeof ResizeObserver==="undefined"){setLeftStackTop(null);return}
    let anchor=null;
    const measure=()=>{
      const a=vp.querySelector(".imgInspector")||vp.querySelector(".editorImageEntry");
      if(a!==anchor){if(anchor)ro.unobserve(anchor);anchor=a;if(a)ro.observe(a)}
      if(!a){setLeftStackTop(null);return}
      const next=Math.round(a.offsetTop+a.offsetHeight+8);setLeftStackTop(current=>current===next?current:next);
    };
    const ro=new ResizeObserver(measure);ro.observe(vp);
    const mo=new MutationObserver(measure);mo.observe(vp,{childList:true});
    measure();
    return()=>{ro.disconnect();mo.disconnect()};
  },[kind,file,inspectorOpen,aulasOpen]);
  // Painel encaixado sob "Imagem": quando a coluna muda de altura, volta ao encaixe (salvo se o usuário o moveu).
  useEffect(()=>{
    if(leftStackTop==null||resultUserMoved.current)return;
    setPosition(current=>current.x===0&&current.y===0?current:{x:0,y:0});
  },[leftStackTop]);
  useEffect(()=>{try{localStorage.setItem("shmShowDetectionBoxes",showBoxes?"1":"0")}catch{}},[showBoxes]);
  useEffect(()=>{try{localStorage.setItem("shmWheelMode",wheelMode)}catch{}},[wheelMode]);
  useEffect(()=>{try{localStorage.setItem("shmShowDetectionLabels",showLabels?"1":"0")}catch{}},[showLabels]);
  useEffect(()=>{setFindingList(null)},[res]);
  useEffect(()=>{setQualityAck(false);setCorrectionPreview(null);setImageQuality(null);setRenaming(false)},[file]);
  function handleDiagnostics(info){setImageQuality(info?.quality||null);onImageDiagnostics?.(info)}
  // Barreira de qualidade: imagem inadequada exige confirmação explícita (segundo clique).
  function runWithQualityGate(){
    if(kind==="2d"&&imageQuality?.verdict==="bad"&&!qualityAck){
      setQualityAck(true);setInspectorOpen(true);setInspectorTab("quality");
      showStatusNotice("Imagem inadequada (nota "+imageQuality.score+"/100): alto risco de falsos positivos. Corrija a imagem ou clique em Analisar de novo para prosseguir.",7000,"warning");
      return;
    }
    if(correctionPreview)showStatusNotice("Ajustes da prévia não aplicados: a análise usa a imagem sem eles.",3500,"warning");
    onRun();
  }
  function startRename(){if(!file||busy)return;setNameDraft(file.name);setRenaming(true)}
  function commitRename(){
    const v=nameDraft.trim();setRenaming(false);
    if(!v||v===file?.name)return;
    onRenameFile?.(v);showStatusNotice("Arquivo renomeado",1400);
  }
  function showStatusNotice(message,ms=1800,tone="info"){
    if(statusTimer.current)clearTimeout(statusTimer.current);
    setStatusNoticeTone(tone);
    setStatusNotice(message);
    statusTimer.current=setTimeout(()=>{setStatusNotice("");setStatusNoticeTone("info");statusTimer.current=null},ms);
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
    const value=Math.max(CANVAS_ZOOM_MIN,Math.min(CANVAS_ZOOM_MAX,Number(next)||1));
    zoomRef.current=value;
    setZoom(value);
    return value;
  }
  // Zoom absoluto ancorado num ponto (roda do mouse no estilo CAD).
  function zoomTo(target,anchor=null){
    const current=zoomRef.current;
    const next=Math.max(CANVAS_ZOOM_MIN,Math.min(CANVAS_ZOOM_MAX,Number(target)||1));
    if(Math.abs(next-current)<1e-4)return;
    const focus=anchor||{x:0,y:0};
    setCanvasPan(currentPan=>clampCanvasPosition(zoomCanvasPanAroundPoint(currentPan,current,next,focus),next));
    applyCanvasZoom(next);
    showStatusNotice("Zoom · "+Math.round(next*100)+"%",900);
  }
  function changeZoom(delta,anchor=null){
    const current=zoomRef.current;
    // Acima de 400% os passos são multiplicativos (+25% do valor atual) para chegar a 3200%.
    const step=current>=4?current*.25*Math.sign(delta):delta;
    const next=Math.max(CANVAS_ZOOM_MIN,Math.min(CANVAS_ZOOM_MAX,current+step));
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
    resultUserMoved.current=true;
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
      minWidth:IMAGE_PANEL_WIDTH,
      minHeight:65,
      // Encaixado à esquerda (desktop) cresce para a direita; no compacto, ancorado à direita, cresce para a esquerda.
      maxWidth:Math.max(1,Math.min(900,window.matchMedia(LEFT_DOCK_QUERY).matches?viewportRect.right-panelRect.left-8:panelRect.right-viewportRect.left-8)),
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
    e.preventDefault();resultUserMoved.current=true;
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
    if(e.button===1){
      const now=performance.now();
      const last=lastMiddleDown.current;
      if(last&&now-last.t<350&&Math.hypot(e.clientX-last.x,e.clientY-last.y)<6){lastMiddleDown.current=null;fitView();showStatusNotice("Enquadrar · duplo clique no botão do meio",1000);return}
      lastMiddleDown.current={t:now,x:e.clientX,y:e.clientY};
    }
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
        const nextZoom=Math.max(1,Math.min(CANVAS_ZOOM_MAX,gesture.startZoom*distance/gesture.startDistance));
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
    // Shift+roda (ou preferência "rolagem") move o canvas; a roda sozinha dá zoom no cursor (CAD).
    if(e.shiftKey||wheelMode==="pan"){
      if(zoomRef.current>1&&(Math.abs(e.deltaX)>.1||Math.abs(e.deltaY)>.1)){
        e.preventDefault();
        setCanvasPan(current=>clampCanvasPosition({x:current.x-e.deltaX,y:current.y-e.deltaY}));
      }
      return;
    }
    if(Math.abs(e.deltaY)<.01)return;
    e.preventDefault();
    const unit=e.deltaMode===1?40:e.deltaMode===2?800:1;
    const factor=Math.max(.5,Math.min(2,Math.exp(-e.deltaY*unit*.0015)));
    zoomTo(zoomRef.current*factor,canvasViewportPoint(e.clientX,e.clientY));
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
  function runEditorMenuAction(e,action){
    e.currentTarget.closest(".editorMenu")?.removeAttribute("open");
    action?.();
  }
  const showRulers=!!rulers.visible&&!!file&&kind==="2d"&&!aulasOpen;
  const rulerMmPerPx=Math.max(0,Number(cdmOptions?.cdm_mm_per_px)||0);
  // ---------- Arquivo: imprimir; Ajuda: contexto, comandos e atalhos ----------
  function printView(){
    if(!file)return;
    document.body.classList.add("shmPrinting");
    const done=()=>{document.body.classList.remove("shmPrinting");window.removeEventListener("afterprint",done)};
    window.addEventListener("afterprint",done);
    setTimeout(()=>{window.print();setTimeout(done,1500)},60);
  }
  function startContextHelp(){setContextHelp({armed:true});showStatusNotice("Ajuda por contexto: clique em qualquer elemento · Esc cancela",2600)}
  useEffect(()=>{
    if(!contextHelp?.armed)return;
    document.body.classList.add("shmContextHelp");
    const pick=e=>{
      if(e.target.closest?.(".studioContextHelpTip"))return;
      e.preventDefault();e.stopPropagation();
      const info=describeElement(e.target);
      setContextHelp(info?{x:e.clientX,y:e.clientY,...info}:null);
    };
    const esc=e=>{if(e.key==="Escape"){e.preventDefault();setContextHelp(null)}};
    window.addEventListener("pointerdown",pick,true);window.addEventListener("click",swallow,true);window.addEventListener("keydown",esc,true);
    function swallow(e){if(!e.target.closest?.(".studioContextHelpTip")){e.preventDefault();e.stopPropagation()}}
    return()=>{document.body.classList.remove("shmContextHelp");window.removeEventListener("pointerdown",pick,true);setTimeout(()=>window.removeEventListener("click",swallow,true),0);window.removeEventListener("keydown",esc,true)};
  },[contextHelp?.armed]);
  useEffect(()=>{
    if(!contextHelp||contextHelp.armed)return;
    const close=e=>{if(!e.target.closest?.(".studioContextHelpTip"))setContextHelp(null)};
    const esc=e=>{if(e.key==="Escape")setContextHelp(null)};
    const t=setTimeout(()=>{window.addEventListener("pointerdown",close,true);window.addEventListener("keydown",esc)},0);
    return()=>{clearTimeout(t);window.removeEventListener("pointerdown",close,true);window.removeEventListener("keydown",esc)};
  },[contextHelp]);
  // Atalhos de Arquivo e Ajuda (fora de campos de texto e das Aulas)
  const shortcutRef=useRef({});shortcutRef.current={printView,startContextHelp,onCloseFile,onExit,onToggleAulas,onOpenRecent,recentHistory,busy,file,kind};
  useEffect(()=>{
    const onKey=e=>{
      if(e.defaultPrevented||helpLockRef.current)return;
      const t=e.target,typing=t?.closest?.("input,textarea,select,[contenteditable=true]");
      const r=shortcutRef.current,mod=e.ctrlKey||e.metaKey;
      if(e.key==="F1"){e.preventDefault();if(e.shiftKey)r.startContextHelp();else r.onToggleAulas?.();return}
      if(typing)return;
      if(mod&&!e.shiftKey&&e.key.toLowerCase()==="p"&&r.file&&r.kind==="2d"){e.preventDefault();r.printView();return}
      if(mod&&e.shiftKey&&e.key.toLowerCase()==="w"&&r.file&&!r.busy&&r.onCloseFile){e.preventDefault();r.onCloseFile();return}
      if(mod&&!e.shiftKey&&e.key.toLowerCase()==="q"&&r.onExit&&!r.busy){e.preventDefault();r.onExit();return}
      if(e.altKey&&!mod&&/^Digit\d$/.test(e.code)){const n=Number(e.code.slice(5)),idx=n===0?9:n-1,item=r.recentHistory[idx];if(item&&!r.busy){e.preventDefault();r.onOpenRecent?.(item.id)}return}
      if(!mod&&!e.altKey&&e.key==="/"){e.preventDefault();setHelpDialog("palette");return}
      if(!mod&&!e.altKey&&e.key==="?"){e.preventDefault();setHelpDialog("shortcuts")}
    };
    window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey);
  },[]);
  function toggleRulers(){
    const next=!rulers.visible;onRulersChange?.({...rulers,visible:next});
    showStatusNotice(next?(rulerMmPerPx>0?"Réguas em "+(rulers.unit||"mm")+" · escala "+rulerMmPerPx+" mm/px":"Réguas em px · defina a escala mm/px em Configurações"):"Réguas ocultas",2000);
  }
  function cycleRulerUnit(){
    const i=RULER_UNITS.indexOf(rulers.unit||"mm"),next=RULER_UNITS[(i+1)%RULER_UNITS.length];
    onRulersChange?.({...rulers,unit:next});
    showStatusNotice(next!=="px"&&!(rulerMmPerPx>0)?"Sem escala mm/px: as réguas continuam em px":"Réguas em "+next,1600);
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
      for(const layer of orderedPathologyLayers)updated[pathologyEngineId+":"+layer.id]=next;
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
      for(const layer of orderedPathologyLayers)updated[pathologyEngineId+":"+layer.id]=layer.id===id;
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
  function setLayerOpacity(id,value){
    if(!id||pathologyLocked.has(id))return;
    const next=Math.min(1,Math.max(0,Number(value)));
    setPathologyOpacity(current=>({...current,[id]:Number.isFinite(next)?next:1}));
  }
  function toggleLayerLock(id){
    setPathologyLocked(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next});
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
  function setLayersPanelOpen(next){
    setLayersOpen(current=>{
      const value=typeof next==="function"?!!next(current):!!next;
      if(!compactLayout.current)desktopLayersPreference.current=value;
      return value;
    });
  }
  function setResultOpenPreference(next){
    const value=typeof next==="function"?!!next(resultOpenPreference.current):!!next;
    resultOpenPreference.current=value;
    setResultOpen(value);
  }
  function resetViewerPreferences(){
    setOpacity(DEFAULT_VIEWER_PREFERENCES.opacity);
    desktopLayersPreference.current=DEFAULT_VIEWER_PREFERENCES.layersOpen;
    setLayersOpen(compactLayout.current?false:DEFAULT_VIEWER_PREFERENCES.layersOpen);
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
    resultUserMoved.current=false;
    setPosition({...DEFAULT_VIEWER_PREFERENCES.resultPanelPosition});
    setResultPanelSize({...DEFAULT_VIEWER_PREFERENCES.resultPanelSize});
  }
  const layerNameById=Object.fromEntries(pathologyLayers.map(l=>[l.id,l.name]));
  const fLen=px=>findingMmPerPx>0?formatMeasure(px*findingMmPerPx,"mm"):formatMeasure(px,"px");
  const fArea=px2=>findingMmPerPx>0?formatMeasure(px2*findingMmPerPx*findingMmPerPx,"mm²"):formatMeasure(px2,"px²");
  function findingShort(d){
    const r=d.record;if(!r)return d.code;
    if(d.label==="cracks")return d.code+" · L "+fLen(r.length_px)+" · w "+fLen(r.width_px);
    return d.code+" · "+fArea(r.area_px2);
  }
  function findingTitle(d){
    const r=d.record,name=layerNameById[d.label]||d.label||"Achado";if(!r)return name+" "+d.code;
    return d.label==="cracks"?`${name} ${d.code}\nComprimento ${fLen(r.length_px)} · largura média ${fLen(r.width_px)}\nCaixa ${fLen(r.bbox[2])} × ${fLen(r.bbox[3])}`:`${name} ${d.code}\nÁrea ${fArea(r.area_px2)} · caixa ${fLen(r.bbox[2])} × ${fLen(r.bbox[3])}`;
  }
  function selectFinding(d){setActive(chosen.engine_id);setSelectedDetection({engineId:chosen.engine_id,index:d._i})}
  // Linhas do resumo: total de achados e, por patologia, quantidade + total (comprimento ou área).
  const findingRows=(()=>{
    const rows=[{id:"all",accent:"accentA",label:"Achados",count:findings.length||cdmSummary?.total_objects||0,total:null}];
    const ids=pathologyLayers.length?orderedPathologyLayers.map(l=>l.id).reverse():[...new Set(findings.map(d=>d.label))];
    for(const id of ids){
      const items=findings.filter(d=>d.label===id);if(!items.length)continue;
      const total=id==="cracks"?fLen(items.reduce((a,d)=>a+(d.record?.length_px||0),0)):fArea(items.reduce((a,d)=>a+(d.record?.area_px2||0),0));
      rows.push({id,accent:"",color:layerColorById[id],label:(layerNameById[id]||id).split("/")[0],count:items.length,total});
    }
    return rows;
  })();
  function renderFindingList(kindId){
    let rows=findings,cols;
    if(kindId==="cracks"){rows=findings.filter(d=>d.label==="cracks").sort((a,b)=>(b.record?.length_px||0)-(a.record?.length_px||0));cols=[["Comp.",d=>fLen(d.record?.length_px||0)],["Larg. méd.",d=>fLen(d.record?.width_px||0)]]}
    else if(kindId!=="all"){rows=findings.filter(d=>d.label===kindId).sort((a,b)=>(b.record?.area_px2||0)-(a.record?.area_px2||0));cols=[["Área",d=>fArea(d.record?.area_px2||0)],["Caixa",d=>d.record?fLen(d.record.bbox[2]).replace(/ \S+$/,"")+"×"+fLen(d.record.bbox[3]):"—"]]}
    else cols=[["Tipo",d=>layerNameById[d.label]?.split("/")[0]||d.label],["Medida",d=>!d.record?"—":d.label==="cracks"?fLen(d.record.length_px):fArea(d.record.area_px2)]];
    if(!rows.length)return <p className="editorFindingEmpty">Nenhum item.</p>;
    return <div className="editorFindingList" role="list">
      <div className="editorFindingHead" aria-hidden="true"><span>#</span>{cols.map(c=><span key={c[0]}>{c[0]}</span>)}</div>
      {rows.map(d=>{const sel=selectedDetection?.engineId===chosen?.engine_id&&selectedDetection.index===d._i;
        return <button type="button" role="listitem" key={d._i} className={"editorFindingItem"+(sel?" selected":"")} title={findingTitle(d)} onClick={()=>selectFinding(d)}><span className="code" style={{"--dot":layerColorById[d.label]||"#0d766e"}}>{d.code}</span>{cols.map(c=><span key={c[0]}>{c[1](d)}</span>)}</button>})}
      {findingMmPerPx>0?null:<small className="editorFindingNote">Medidas em px · calibre mm/px em Configurações para obter mm.</small>}
    </div>;
  }
  const hasOverlayContent=useCombinedEngineOverlay||pathologyLayers.length>0||temporalLayers.length>0||boxes.length>0;
  function renderOverlayStack(stackStyle=null){
    if(!hasOverlayContent)return null;
    return <div className="editorOverlayStack" aria-label="Camadas de detecção sobre a imagem original" style={{...(stackStyle||{}),"--canvas-zoom":zoom}}>
      {useCombinedEngineOverlay&&<img className={"engineOverlayImage "+(overlaySemantics==="transparent_layers"?"transparentOverlay":"compositeOverlay")} src={engineOverlay} alt={"Sobreposição de "+(chosen?.name||"motor")} style={{opacity}}/>}
      {[...orderedPathologyLayers].reverse().filter(layer=>visible[pathologyEngineId+":"+layer.id]!==false).map(layer=><img className="pathologyOverlay" key={layer.id} src={"data:image/png;base64,"+layer.overlay_png_base64} alt={layer.name} data-layer-id={layer.id} style={{opacity:opacity*Number(pathologyOpacity[layer.id]??1)}}/>)}
      {temporalLayers.filter(layer=>temporalLayerIsVisible(layer.id)).map(layer=><img className="pathologyOverlay temporalOverlay" key={"temporal-"+layer.id} src={"data:image/png;base64,"+layer.overlay_png_base64} alt={layer.name} style={{opacity}}/>)}
      {boxes.map(d=>{const color=layerColorById[d.label]||"#0d766e",op=Math.max(.15,opacity*Number(pathologyOpacity[d.label]??1)),sel=selectedDetection?.engineId===chosen?.engine_id&&selectedDetection.index===d._i;
        const small=boxes.length>12&&((d.box[2]-d.box[0])*(d.box[3]-d.box[1]))/(boxScaleW*boxScaleH)<.004;
        return <button key={d._i} className={"editorDetection "+(sel?"selected ":"")+(showBoxes?"":"boxesHidden ")+(small?"labelOnHover":"")} data-finding={d.code} title={findingTitle(d)} aria-label={`Achado ${d.code}: ${layerNameById[d.label]||d.label||"sem classificação"}`} style={{left:(d.box[0]/boxScaleW*100)+"%",top:(d.box[1]/boxScaleH*100)+"%",width:((d.box[2]-d.box[0])/boxScaleW*100)+"%",height:((d.box[3]-d.box[1])/boxScaleH*100)+"%","--box-color":color,"--box-stroke":hexToRgba(color,.45+.55*op),"--box-fill":hexToRgba(color,.22*op)}} onClick={()=>{setActive(chosen.engine_id);setSelectedDetection({engineId:chosen.engine_id,index:d._i})}}>{labelLayerVisible(d.label)&&<span className="editorDetectionLabel" style={{"--label-bg":hexToRgba(color,.9)}}>{findingShort(d)}</span>}</button>})}
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
  const persisting=busy&&progress?.state==="persisting";
  const spatialCdm3Ready=kind==="3d"&&selected.length===1&&selected[0]==="cdm_3"&&isCdm3SpatialAsset(file);
  const analysisBlockedReason=kind==="3d"
    ?(isCdm3SpatialAsset(file)?(spatialCdm3Ready?executionIssue:"Ativo espacial CDM-3 reconhecido · selecione somente o CDM-3"):"Arquivo 3D reconhecido · análise 2D indisponível")
    :kind==="unknown"
      ?"Formato de arquivo não suportado"
      :kind==="2d"&&!imageDecoded
        ?previewError||"Aguardando decodificação da imagem"
        :referenceValidating
          ?"Validando referência t0…"
          :executionIssue;
  const statusMessage=pageOpen?page.title+" · SHM Studio":aulasOpen?"Aulas · ferramentas de análise desativadas · progresso salvo neste navegador":error
    ||previewError
    ||(progress?.state==="cancelled"?"Análise cancelada":"")
    ||(persisting?"Análise concluída · salvando histórico local":"")
    ||(busy?("Processando análise · "+(progress?.total===100?pct+"%":(progress?.completed||0)+"/"+(progress?.total||selected.length))):"")
    ||statusNotice
    ||analysisBlockedReason
    ||"Pronto";
  const analysisDisabled=!file||!selected.length||busy||referenceValidating||!!executionIssue||!((kind==="2d"&&imageDecoded&&!previewError)||spatialCdm3Ready);
  function pickRegistrationPixel(e){
    const image=registrationImage.current;
    if(!image?.naturalWidth||!image?.naturalHeight)return;
    const rect=image.getBoundingClientRect();
    if(rect.width<1||rect.height<1)return;
    const u=(e.clientX-rect.left)/rect.width*image.naturalWidth;
    const v=(e.clientY-rect.top)/rect.height*image.naturalHeight;
    setRegistrationPendingUv([Math.max(0,Math.min(image.naturalWidth-1,u)),Math.max(0,Math.min(image.naturalHeight-1,v))]);
    setRegistrationError("");
  }
  function pickRegistrationWorldPoint(point){
    if(!registrationPendingUv||!point?.xyz)return;
    setRegistrationPairs(rows=>[...rows,{uv:registrationPendingUv,xyz:point.xyz,point_index:point.index??null}]);
    setRegistrationPendingUv(null);
    setRegistrationError("");
  }
  function undoRegistrationPair(){
    if(registrationPendingUv){setRegistrationPendingUv(null);return}
    setRegistrationPairs(rows=>rows.slice(0,-1));
  }
  function resetRegistrationPairs(){
    setRegistrationPairs([]);setRegistrationPendingUv(null);setRegistrationError("");
  }
  async function solveRegistration(){
    const image=registrationImage.current;
    if(registrationPairs.length<6){setRegistrationError("São necessários pelo menos 6 pares 2D–3D.");return}
    if(!image?.naturalWidth||!image?.naturalHeight){setRegistrationError("Dimensões da imagem RGB indisponíveis.");return}
    if(!onSolveSpatialRegistration){setRegistrationError("Solver de registro indisponível.");return}
    const fx=Number(registrationIntrinsics.fx),fy=Number(registrationIntrinsics.fy),cx=Number(registrationIntrinsics.cx),cy=Number(registrationIntrinsics.cy);
    const intrinsics=Number.isFinite(fx)&&fx>0
      ?{fx,fy:Number.isFinite(fy)&&fy>0?fy:fx,cx:Number.isFinite(cx)?cx:image.naturalWidth/2,cy:Number.isFinite(cy)?cy:image.naturalHeight/2}
      :null;
    setRegistrationBusy(true);setRegistrationError("");
    try{
      await onSolveSpatialRegistration({correspondences:registrationPairs,imageWidth:image.naturalWidth,imageHeight:image.naturalHeight,intrinsics});
    }catch(e){setRegistrationError(e?.message||String(e))}
    finally{setRegistrationBusy(false)}
  }
  const studioCommands=[
    {group:"Arquivo",label:"Importar…",icon:FolderOpen,hint:"Ctrl+O",disabled:busy,run:()=>picker.current?.click()},
    {group:"Arquivo",label:"Câmera",icon:Camera,disabled:busy,run:()=>setCameraOpen(true)},
    onLive&&{group:"Arquivo",label:"Live detecção",icon:Radio,disabled:busy,run:onLive},
    {group:"Arquivo",label:"Renomear…",icon:PencilLine,disabled:!file||busy,run:startRename},
    {group:"Arquivo",label:"Salvar",icon:Save,hint:"Ctrl+S",disabled:!file,run:()=>onSaveFile?.()},
    {group:"Arquivo",label:"Imprimir…",icon:Printer,hint:"Ctrl+P",disabled:!file||kind!=="2d",run:printView},
    {group:"Arquivo",label:"Fechar visualização",icon:X,hint:"Ctrl+Shift+W",disabled:!file||busy||!onCloseFile,run:()=>onCloseFile?.()},
    {group:"Arquivo",label:"Sair",icon:LogOut,hint:"Ctrl+Q",disabled:busy||!onExit,run:()=>onExit?.()},
    {group:"Arquivo",label:"Histórico de inspeções",icon:History,run:()=>onNavigate?.("alerts")},
    {group:"Análise",label:"Relatórios e exportação",icon:Save,keywords:"relatorio exportar",run:()=>onNavigate?.("reports")},
    ...recentHistory.slice(0,10).map((item,k)=>({group:"Recentes",label:"Abrir "+(item.file_meta?.name||"inspeção"),keywords:"recente",icon:History,hint:"Alt+"+((k+1)%10),disabled:busy,run:()=>onOpenRecent?.(item.id)})),
    {group:"Editar",label:"Restaurar visualização",icon:RotateCcw,disabled:kind!=="2d",run:resetViewerPreferences},
    {group:"Visualizar",label:layersOpen?"Recolher camadas":"Mostrar camadas",icon:Layers3,run:()=>setLayersPanelOpen(v=>!v)},
    {group:"Visualizar",label:"Ajustar à tela",icon:Maximize2,hint:"0",disabled:kind!=="2d",run:fitView},
    {group:"Visualizar",label:rulers.visible?"Ocultar réguas":"Mostrar réguas",icon:Ruler,hint:"Ctrl+Shift+R",disabled:kind!=="2d",run:toggleRulers},
    {group:"Visualizar",label:showBoxes?"Ocultar caixas delimitadoras":"Mostrar caixas delimitadoras",icon:SquareDashed,disabled:kind!=="2d",run:()=>setShowBoxes(v=>!v)},
    {group:"Visualizar",label:showLabels?"Ocultar rótulos":"Mostrar rótulos",icon:Tag,disabled:kind!=="2d",run:()=>setShowLabels(v=>!v)},
    ...[["original","Original",ImageIcon],["overlay","Sobrepor (original + detecções)",Layers2],["wipe","Deslizar",FlipHorizontal2],["side","Lado a lado",Columns2]].map(([id,label,icon])=>({group:"Visualizar",label,icon,disabled:kind!=="2d"||(id!=="original"&&!res),run:()=>changeComparison(id)})),
    {group:"Análise",label:"Executar análise",icon:Play,hint:"Ctrl+Enter",disabled:analysisDisabled,run:()=>analyzeButton.current?.click()},
    {group:"Análise",label:"Configurações",icon:Settings2,hint:"Ctrl+,",disabled:busy,run:()=>onSettings?.()},
    {group:"Análise",label:"Paridade CDM (Python ⇄ navegador)",icon:CdmIcon,keywords:"pyodide indicadores",run:()=>setParityOpen(true)},
    {group:"Ajuda",label:"Ajuda (Aulas)",icon:CircleHelp,hint:"F1",run:()=>onToggleAulas?.()},
    {group:"Ajuda",label:"Ajuda por contexto",icon:MousePointerClick,hint:"Shift+F1",run:startContextHelp},
    {group:"Ajuda",label:"Dica do dia",icon:Lightbulb,run:()=>setHelpDialog("tip")},
    {group:"Ajuda",label:"Atalhos de teclado e mouse",icon:Keyboard,hint:"?",run:()=>setHelpDialog("shortcuts")},
    {group:"Ajuda",label:"Sobre o SHM Studio",icon:Info,run:()=>setHelpDialog("about")},
    {group:"Ajuda",label:"Navegador de motores (Configurações)",icon:Cpu,keywords:"motores catalogo",run:()=>onSettings?.()},
  ].filter(Boolean);
  // Menu de contexto (botão direito): opções do elemento sob o cursor + atalhos gerais.
  function openContextMenu(e){
    const t=e.target;
    if(e.shiftKey||t.closest?.("input,textarea,select,[contenteditable=true],.editorAulasFrame,.studioContextMenu"))return;
    e.preventDefault();
    const is2d=file&&kind==="2d",sections=[];
    const anchor=surface.current&&surface.current.contains(t)?canvasViewportPoint(e.clientX,e.clientY):null;
    if(t.closest(".editorFloating,.editorResultsTab")&&results.length){
      sections.push({title:"Resultados",items:[
        {label:resultOpen?"Recolher resultados":"Abrir resultados",onSelect:()=>setResultOpenPreference(!resultOpen)},
        {label:"Restaurar tamanho e posição",onSelect:()=>{resultUserMoved.current=false;setPosition({x:0,y:0});setResultPanelSize({width:IMAGE_PANEL_WIDTH,height:null})}},
        {label:layersOpen?"Ocultar camadas":"Mostrar camadas",onSelect:()=>setLayersPanelOpen(!layersOpen)},
      ]});
    }else if(t.closest(".imgInspector,.editorImageEntry")&&is2d){
      sections.push({title:"Imagem",items:[
        ...[["histogram","Histograma e curva S"],["properties","Propriedades"],["quality","Qualidade para análise"],["correction","Correção da imagem"]].map(([id,label])=>({label,checked:inspectorOpen&&inspectorTab===id,onSelect:()=>{setInspectorTab(id);setInspectorOpen(true)}})),
        inspectorOpen&&{label:"Fechar painel Imagem",onSelect:()=>setInspectorOpen(false)},
      ]});
    }else if(t.closest(".editorLayers")){
      sections.push({title:"Camadas",items:[
        pathologyLayers.length>0&&{label:"Mostrar todas as patologias",onSelect:()=>setPathologyGroupVisible(true)},
        pathologyLayers.length>0&&{label:"Ocultar todas as patologias",onSelect:()=>setPathologyGroupVisible(false)},
        pathologyLayers.length>0&&{label:"Caixas de detecção",checked:showBoxes,onSelect:()=>setShowBoxes(v=>!v)},
        pathologyLayers.length>0&&{label:"Rótulos dos achados",checked:showLabels,onSelect:()=>setShowLabels(v=>!v)},
        {label:"Recolher painel de camadas",onSelect:()=>setLayersPanelOpen(false)},
      ]});
    }
    if(is2d&&surface.current?.contains(t)){
      sections.push({title:"Visualização",items:[
        {label:"Ajustar à tela",hint:"0",onSelect:fitView},
        {label:"Ampliar aqui",hint:"roda ↑",onSelect:()=>zoomTo(zoomRef.current*2,anchor)},
        {label:"Reduzir aqui",hint:"roda ↓",onSelect:()=>zoomTo(zoomRef.current/2,anchor)},
        {label:"Réguas",hint:"Ctrl+Shift+R",checked:!!rulers.visible,onSelect:toggleRulers},
        {label:"Roda do mouse faz zoom",checked:wheelMode==="zoom",onSelect:()=>setWheelMode(m=>m==="zoom"?"pan":"zoom")},
        pathologyLayers.length>0&&{label:"Caixas de detecção",checked:showBoxes,onSelect:()=>setShowBoxes(v=>!v)},
        pathologyLayers.length>0&&{label:"Rótulos dos achados",checked:showLabels,onSelect:()=>setShowLabels(v=>!v)},
      ]});
      sections.push({title:"Modo de exibição",items:[["original","Original"],["overlay","Original + detecções"],["wipe","Deslizar"],["side","Lado a lado"]].map(([id,label])=>({label,checked:comparison===id,disabled:id!=="original"&&!res,title:id!=="original"&&!res?"Disponível após a análise":undefined,onSelect:()=>changeComparison(id)}))});
      if(!t.closest(".imgInspector,.editorImageEntry"))sections.push({title:"Imagem",items:[{label:"Propriedades e qualidade",onSelect:()=>{setInspectorTab("properties");setInspectorOpen(true)}},{label:"Corrigir imagem",onSelect:()=>{setInspectorTab("correction");setInspectorOpen(true)}}]});
    }
    sections.push({title:"Studio",items:[
      {label:"Executar análise",hint:"Ctrl+Enter",disabled:analysisDisabled,onSelect:runWithQualityGate},
      {label:"Importar…",hint:"Ctrl+O",disabled:busy,onSelect:()=>picker.current?.click()},
      onLive&&{label:"Live detecção",disabled:busy,onSelect:onLive},
      {label:"Câmera",disabled:busy,onSelect:()=>setCameraOpen(true)},
      {label:"Paridade CDM (Python ⇄ navegador)",checked:parityOpen,onSelect:()=>setParityOpen(v=>!v)},
      {label:"Configurações",hint:"Ctrl+,",onSelect:()=>onSettings?.()},
    ]});
    setContextMenu({x:e.clientX,y:e.clientY,sections});
  }
  return <section className="analysisEditor" aria-label="Workspace de análise" onContextMenu={aulasOpen?undefined:openContextMenu}>
    {helpDialog==="tip"&&<TipOfDayDialog onClose={()=>setHelpDialog(null)}/>}
    {helpDialog==="about"&&<AboutDialog appInfo={appInfo||{}} onClose={()=>setHelpDialog(null)}/>}
    {helpDialog==="shortcuts"&&<ShortcutsDialog shortcuts={SHORTCUTS} onClose={()=>setHelpDialog(null)}/>}
    {helpDialog==="palette"&&<CommandPalette commands={studioCommands} onClose={()=>setHelpDialog(null)}/>}
    {contextHelp&&!contextHelp.armed&&<div className="studioContextHelpTip" role="status" style={{left:Math.min(contextHelp.x+12,window.innerWidth-300),top:Math.min(contextHelp.y+12,window.innerHeight-120)}}><small>{contextHelp.area}</small><b>{contextHelp.label}</b>{contextHelp.extra&&<p>{contextHelp.extra}</p>}<button type="button" onClick={()=>startContextHelp()}>Outro elemento</button></div>}
    {contextMenu&&<ContextMenu x={contextMenu.x} y={contextMenu.y} sections={contextMenu.sections} onClose={closeContextMenu}/>}
    <div className="editorTop">
      <div className="editorBrand"><span className="editorMark">S</span><strong>SHM Studio</strong><nav className={"editorMenus"+(aulasOpen?" studioLocked":"")} aria-label="Menu do editor" inert={aulasOpen||undefined} aria-disabled={aulasOpen||undefined}>
        <details className="editorMenu" name="shm-editor-menu"><summary>Arquivo</summary><div className="editorMenuPanel" role="menu">
          <button type="button" role="menuitem" disabled={busy} onClick={e=>runEditorMenuAction(e,()=>picker.current?.click())}><MenuIcon icon={FolderOpen}/><span>Importar…</span><small>Ctrl/Cmd+O</small></button>
          <button type="button" role="menuitem" disabled={busy} onClick={e=>runEditorMenuAction(e,()=>setCameraOpen(true))}><MenuIcon icon={Camera}/><span>Câmera</span></button>
          {onLive&&<button type="button" role="menuitem" disabled={busy} onClick={e=>runEditorMenuAction(e,onLive)}><MenuIcon icon={Radio}/><span>Live detecção</span></button>}
          {recentHistory.length>0&&<div className={"editorSubmenu"+(recentOpen?" open":"")} onMouseEnter={()=>setRecentOpen(true)} onMouseLeave={()=>setRecentOpen(false)}>
            <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={recentOpen} disabled={busy} onClick={e=>{e.preventDefault();e.stopPropagation();setRecentOpen(v=>!v)}}><MenuIcon icon={History}/><span>Recentes</span><small aria-hidden="true">›</small></button>
            {recentOpen&&<div className="editorMenuPanel editorSubmenuPanel" role="menu" aria-label="Arquivos recentes">
              {recentHistory.slice(0,10).map((item,recentIndex)=>{const name=item.file_meta?.name||"inspeção";const when=item.created_at?new Date(item.created_at).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"}).replace(",",""):"";const where=[item.inspection?.oae_id,item.inspection?.element_id].filter(Boolean).join(" · ");return <button key={item.id} type="button" role="menuitem" className="editorRecentItem" title={name+(where?" · "+where:"")+(when?" · "+when:"")} onClick={e=>{setRecentOpen(false);runEditorMenuAction(e,()=>onOpenRecent?.(item.id))}}><span className="editorRecentThumb">{item.thumbnail?<img src={item.thumbnail} alt="" loading="lazy"/>:<ImageIcon size={16}/>}</span><span className="editorRecentText"><b>{shortFileName(name)}</b><small>{when}</small></span><kbd>Alt+{(recentIndex+1)%10}</kbd></button>})}
              <hr/>
              <button type="button" role="menuitem" className="editorRecentHistory" onClick={e=>{setRecentOpen(false);runEditorMenuAction(e,()=>onNavigate?.("alerts"))}}><MenuIcon icon={History}/><span>Histórico de inspeções</span></button>
            </div>}
          </div>}
          <hr/>
          <button type="button" role="menuitem" disabled={!file||busy} onClick={e=>runEditorMenuAction(e,startRename)}><MenuIcon icon={PencilLine}/><span>Renomear…</span></button>
          <button type="button" role="menuitem" disabled={!file} onClick={e=>runEditorMenuAction(e,()=>{onSaveFile?.();showStatusNotice("Arquivo salvo · "+file.name,1600)})}><MenuIcon icon={Save}/><span>Salvar</span><small>Ctrl/Cmd+S</small></button>
          {kind==="2d"&&selected.length===1&&selected[0]==="cdm_1"&&<button type="button" role="menuitem" disabled={busy||referenceValidating} onClick={e=>runEditorMenuAction(e,()=>referencePicker.current?.click())}><MenuIcon icon={ImagePlus}/><span>Referência t0…</span></button>}
          <hr/>
          <button type="button" role="menuitem" disabled={!file||kind!=="2d"} onClick={e=>runEditorMenuAction(e,printView)}><MenuIcon icon={Printer}/><span>Imprimir…</span><small>Ctrl/Cmd+P</small></button>
          <hr/>
          <button type="button" role="menuitem" disabled={!file||busy||!onCloseFile} onClick={e=>runEditorMenuAction(e,()=>onCloseFile?.())}><MenuIcon icon={X}/><span>Fechar visualização</span><small>Ctrl/Cmd+Shift+W</small></button>
          <button type="button" role="menuitem" disabled={busy||!onExit} onClick={e=>runEditorMenuAction(e,()=>onExit?.())}><MenuIcon icon={LogOut}/><span>Sair</span><small>Ctrl/Cmd+Q</small></button>
        </div></details>
        <details className="editorMenu" name="shm-editor-menu"><summary>Editar</summary><div className="editorMenuPanel" role="menu">
          <button type="button" role="menuitem" disabled={kind!=="2d"} onClick={e=>runEditorMenuAction(e,resetViewerPreferences)}><MenuIcon icon={RotateCcw}/><span>Restaurar visualização</span></button>
          {kind==="2d"&&referenceFile&&<button type="button" role="menuitem" disabled={busy} onClick={e=>runEditorMenuAction(e,()=>onReferenceFile(null))}><MenuIcon icon={Trash2}/><span>Remover referência t0</span></button>}
        </div></details>
        <details className="editorMenu" name="shm-editor-menu"><summary>Visualizar</summary><div className="editorMenuPanel" role="menu">
          <button type="button" role="menuitem" onClick={e=>runEditorMenuAction(e,()=>setLayersPanelOpen(v=>!v))}><MenuIcon icon={Layers3}/><span>{layersOpen?"Recolher camadas":"Mostrar camadas"}</span></button>
          <button type="button" role="menuitem" disabled={kind!=="2d"} onClick={e=>runEditorMenuAction(e,fitView)}><MenuIcon icon={Maximize2}/><span>Ajustar à tela</span><small>0 · duplo clique no meio</small></button>
          <button type="button" role="menuitem" aria-checked={!!rulers.visible} disabled={kind!=="2d"} onClick={e=>runEditorMenuAction(e,toggleRulers)}><MenuIcon icon={Ruler}/><span>{rulers.visible?"Ocultar réguas":"Mostrar réguas"}</span><small>Ctrl/Cmd+Shift+R</small></button>
          <button type="button" role="menuitem" aria-checked={showBoxes} disabled={kind!=="2d"} onClick={e=>runEditorMenuAction(e,()=>setShowBoxes(v=>!v))}><MenuIcon icon={SquareDashed}/><span>{showBoxes?"Ocultar caixas delimitadoras":"Mostrar caixas delimitadoras"}</span></button>
          <button type="button" role="menuitem" aria-checked={showLabels} disabled={kind!=="2d"} onClick={e=>runEditorMenuAction(e,()=>setShowLabels(v=>!v))}><MenuIcon icon={Tag}/><span>{showLabels?"Ocultar rótulos":"Mostrar rótulos"}</span></button>
          <button type="button" role="menuitem" aria-checked={wheelMode==="zoom"} onClick={e=>runEditorMenuAction(e,()=>{const next=wheelMode==="zoom"?"pan":"zoom";setWheelMode(next);showStatusNotice(next==="zoom"?"Roda do mouse: zoom no cursor (CAD) · Shift+roda move":"Roda do mouse: rolagem · Ctrl+roda dá zoom",2200)})}><MenuIcon icon={Mouse}/><span>Roda do mouse: {wheelMode==="zoom"?"zoom (CAD)":"rolagem"}</span><small>alternar</small></button>
          <hr/>
          <button type="button" role="menuitem" disabled={kind!=="2d"} onClick={e=>runEditorMenuAction(e,()=>changeComparison("original"))}><MenuIcon icon={ImageIcon}/><span>Original</span></button>
          <button type="button" role="menuitem" disabled={kind!=="2d"||!res} title={res?undefined:"Disponível após a análise"} onClick={e=>runEditorMenuAction(e,()=>changeComparison("overlay"))}><MenuIcon icon={Layers2}/><span>Sobrepor</span></button>
          <button type="button" role="menuitem" disabled={kind!=="2d"||!res} title={res?undefined:"Disponível após a análise"} onClick={e=>runEditorMenuAction(e,()=>changeComparison("wipe"))}><MenuIcon icon={FlipHorizontal2}/><span>Deslizar</span></button>
          <button type="button" role="menuitem" disabled={kind!=="2d"||!res} title={res?undefined:"Disponível após a análise"} onClick={e=>runEditorMenuAction(e,()=>changeComparison("side"))}><MenuIcon icon={Columns2}/><span>Lado a lado</span></button>
        </div></details>
        <details className="editorMenu" name="shm-editor-menu"><summary>Análise</summary><div className="editorMenuPanel" role="menu">
          <button type="button" role="menuitem" disabled={busy} onClick={e=>runEditorMenuAction(e,onSettings)}><MenuIcon icon={Settings2}/><span>Configurações</span><small>Ctrl/Cmd+,</small></button>
          <button type="button" role="menuitem" disabled={analysisDisabled} onClick={e=>runEditorMenuAction(e,()=>analyzeButton.current?.click())}><MenuIcon icon={Play}/><span>Executar análise</span><small>Ctrl/Cmd+Enter</small></button>
          <button type="button" role="menuitem" aria-checked={parityOpen} onClick={e=>runEditorMenuAction(e,()=>setParityOpen(v=>!v))}><MenuIcon icon={CdmIcon}/><span>Paridade CDM (Python ⇄ navegador)</span><small>indicadores</small></button>
        </div></details>
        <details className="editorMenu" name="shm-editor-menu"><summary>Ajuda</summary><div className="editorMenuPanel" role="menu">
          <button type="button" role="menuitem" onClick={e=>runEditorMenuAction(e,()=>onToggleAulas?.())}><MenuIcon icon={CircleHelp}/><span>Ajuda</span><small>F1</small></button>
          <button type="button" role="menuitem" onClick={e=>runEditorMenuAction(e,startContextHelp)}><MenuIcon icon={MousePointerClick}/><span>Ajuda por contexto</span><small>Shift+F1</small></button>
          <button type="button" role="menuitem" onClick={e=>runEditorMenuAction(e,()=>setHelpDialog("tip"))}><MenuIcon icon={Lightbulb}/><span>Dica do dia</span></button>
          <button type="button" role="menuitem" onClick={e=>runEditorMenuAction(e,()=>setHelpDialog("about"))}><MenuIcon icon={Info}/><span>Sobre o SHM Studio</span></button>
          <hr/>
          <button type="button" role="menuitem" onClick={e=>runEditorMenuAction(e,()=>setHelpDialog("palette"))}><MenuIcon icon={Search}/><span>Procurar e executar um comando</span><small>/</small></button>
          <button type="button" role="menuitem" onClick={e=>runEditorMenuAction(e,()=>setHelpDialog("shortcuts"))}><MenuIcon icon={Keyboard}/><span>Atalhos de teclado e mouse</span><small>?</small></button>
          <hr/>
          <button type="button" role="menuitem" onClick={e=>runEditorMenuAction(e,()=>onSettings?.())}><MenuIcon icon={Cpu}/><span>Navegador de motores</span><small>Configurações</small></button>
          <button type="button" role="menuitem" onClick={e=>runEditorMenuAction(e,()=>setParityOpen(true))}><MenuIcon icon={CdmIcon}/><span>Paridade CDM (Python ⇄ navegador)</span></button>
          <hr/>
          <div className={"editorSubmenu"+(helpSubmenu==="online"?" open":"")} onMouseEnter={()=>setHelpSubmenu("online")} onMouseLeave={()=>setHelpSubmenu(null)}>
            <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={helpSubmenu==="online"} onClick={e=>{e.preventDefault();e.stopPropagation();setHelpSubmenu(v=>v==="online"?null:"online")}}><MenuIcon icon={Globe}/><span>SHM online</span><small aria-hidden="true">›</small></button>
            {helpSubmenu==="online"&&<div className="editorMenuPanel editorSubmenuPanel editorSubmenuLeft" role="menu" aria-label="SHM online">
              {HELP_LINKS.map(([label,href])=><a key={href} role="menuitem" className="editorMenuLink" href={href} target="_blank" rel="noreferrer" onClick={e=>e.currentTarget.closest(".editorMenu")?.removeAttribute("open")}><MenuIcon icon={ExternalLink}/><span>{label}</span></a>)}
            </div>}
          </div>
          <a role="menuitem" className="editorMenuLink" href="https://github.com/aaronkadima/SHM/issues/new" target="_blank" rel="noreferrer" onClick={e=>e.currentTarget.closest(".editorMenu")?.removeAttribute("open")}><MenuIcon icon={Bug}/><span>Relatórios de bugs e pedidos de recursos</span></a>
          <div className={"editorSubmenu"+(helpSubmenu==="manual"?" open":"")} onMouseEnter={()=>setHelpSubmenu("manual")} onMouseLeave={()=>setHelpSubmenu(null)}>
            <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={helpSubmenu==="manual"} onClick={e=>{e.preventDefault();e.stopPropagation();setHelpSubmenu(v=>v==="manual"?null:"manual")}}><MenuIcon icon={BookOpen}/><span>Manual do usuário</span><small aria-hidden="true">›</small></button>
            {helpSubmenu==="manual"&&<div className="editorMenuPanel editorSubmenuPanel editorSubmenuLeft" role="menu" aria-label="Manual do usuário">
              <button type="button" role="menuitem" onClick={e=>runEditorMenuAction(e,()=>onToggleAulas?.())}><MenuIcon icon={BookOpen}/><span>Aulas · Trilha Dev SHM</span></button>
              <button type="button" role="menuitem" onClick={e=>runEditorMenuAction(e,()=>setHelpDialog("shortcuts"))}><MenuIcon icon={Keyboard}/><span>Atalhos de teclado e mouse</span></button>
              <button type="button" role="menuitem" onClick={e=>runEditorMenuAction(e,()=>setHelpDialog("tip"))}><MenuIcon icon={Lightbulb}/><span>Dicas do Studio</span></button>
            </div>}
          </div>
        </div></details>
      </nav></div>
      <div className="editorFileTitle">{pageOpen?<span className="editorFileName static">{page.title}</span>:aulasOpen?<span className="editorFileName static">Aulas · Trilha Dev SHM{aulasCrumb?" · "+aulasCrumb:""}</span>:renaming?<input className="editorFileNameInput" autoFocus value={nameDraft} aria-label="Nome do arquivo" onChange={e=>setNameDraft(e.target.value)} onBlur={commitRename} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();commitRename()}else if(e.key==="Escape"){e.preventDefault();setRenaming(false)}}}/>:<button type="button" className="editorFileName" disabled={!file||busy} onClick={startRename} title={file?"Clique para renomear":"Nenhum arquivo"}>{file?.name||"Nova inspeção"}</button>} {!aulasOpen&&<span className="editorEngineState srOnly">{selectedEngineLabels.length===0?"Nenhum motor":selectedEngineLabels.length===1?selectedEngineLabels[0].name+(selectedEngineLabels[0].browser_ready?" · browser local":""):selectedEngineLabels.length+" motores · comparação"}</span>}</div>
      <div className={"editorTopActions"+(aulasOpen?" studioLocked":"")} inert={aulasOpen||undefined} aria-disabled={aulasOpen||undefined} title={aulasOpen?"Ferramentas de análise desativadas durante as aulas":undefined}>
        <input ref={picker} hidden type="file" accept={ASSET_ACCEPT} onChange={e=>{const next=e.target.files?.[0]||null;e.target.value="";onFile(next)}}/>
        <input ref={referencePicker} hidden type="file" accept={IMAGE_ACCEPT} onChange={e=>{const next=e.target.files?.[0]||null;e.target.value="";onReferenceFile(next)}}/>
        <input ref={spatialRgbPicker} hidden type="file" accept={IMAGE_ACCEPT} onChange={e=>{const next=e.target.files?.[0]||null;e.target.value="";onSpatialRgbFile?.(next)}}/>
        <input ref={spatialMultiPicker} hidden multiple type="file" accept={IMAGE_ACCEPT} onChange={e=>{const next=[...(e.target.files||[])];e.target.value="";onAddSpatialPhotos?.(next)}}/>
        <button disabled={busy} aria-keyshortcuts="Control+O Meta+O" title="Importar arquivo · Ctrl/Cmd+O" onClick={()=>picker.current?.click()}><ImagePlus size={16}/> Importar</button>
        {kind==="2d"&&selected.length===1&&selected[0]==="cdm_1"&&<button disabled={busy||referenceValidating} title={referenceValidating?"Validando referência t0…":"Carregar imagem anterior para comparação temporal"} onClick={()=>referencePicker.current?.click()}><ImagePlus size={16}/> {referenceValidating?"Validando t0…":referenceFile?"t0: "+referenceFile.name:"Referência t0"}</button>}
        {kind==="3d"&&isCdm3SpatialAsset(file)&&selected.length===1&&selected[0]==="cdm_3"&&<button className={spatialPhotoViews.length?"spatialRgbAttached":""} disabled={busy} title="Adicionar até 8 fotografias para registro e texturização fotométrica multivista" onClick={()=>spatialMultiPicker.current?.click()}><ImagePlus size={16}/> {spatialPhotoViews.length?"Fotos 3D · "+spatialPhotoViews.length:"Adicionar fotos"}</button>}
        <button disabled={busy} aria-keyshortcuts="Control+, Meta+," title="Configurações · Ctrl/Cmd+," onClick={onSettings}><Settings2 size={16}/> Configurar</button>
        <button ref={analyzeButton} className="editorPrimary" aria-keyshortcuts="Control+Enter Meta+Enter" disabled={analysisDisabled} title={(analysisBlockedReason||"Executar análise")+" · Ctrl/Cmd+Enter"} onClick={runWithQualityGate}><Play size={16}/> {qualityAck&&imageQuality?.verdict==="bad"?"Analisar mesmo assim":"Analisar"}</button>
      </div>
    </div>
    <div className="editorBody">
      <div className="editorTools" aria-label="Ferramentas">
        <div className={"editorToolButtons"+(aulasOpen||pageOpen?" studioLocked":"")} inert={aulasOpen||pageOpen||undefined} aria-disabled={aulasOpen||pageOpen||undefined}>
          <button aria-label="Mostrar ou ocultar painel de camadas" title="Mostrar ou ocultar camadas" onClick={()=>setLayersPanelOpen(v=>{const next=!v;showStatusNotice(next?"Camadas abertas":"Camadas recolhidas",900);return next})}><Layers3/></button>
          <button aria-label="Ampliar zoom" title={kind==="2d"?"Ampliar":"Zoom 2D indisponível"} disabled={kind!=="2d"} onClick={()=>changeZoom(.25)}><Plus/></button>
          <button aria-label="Reduzir zoom" title={kind==="2d"?"Reduzir":"Zoom 2D indisponível"} disabled={kind!=="2d"} onClick={()=>changeZoom(-.25)}><Minus/></button>
          <button title={kind==="2d"?"Ajustar à tela":"Ajuste 2D indisponível"} aria-label="Ajustar à tela" disabled={kind!=="2d"} onClick={fitView}><Maximize2/></button>
          <button className={rulers.visible?"active":""} aria-label={rulers.visible?"Ocultar réguas":"Mostrar réguas"} aria-pressed={!!rulers.visible} title={(rulers.visible?"Ocultar":"Mostrar")+" réguas · Ctrl/Cmd+Shift+R"} disabled={kind!=="2d"} onClick={toggleRulers}><Ruler/></button>
          <span className="editorToolSep" aria-hidden="true"/>
          <button className={showBoxes?"active":""} aria-label={showBoxes?"Ocultar caixas delimitadoras":"Mostrar caixas delimitadoras"} aria-pressed={showBoxes} title={(showBoxes?"Ocultar":"Mostrar")+" caixas delimitadoras"} disabled={kind!=="2d"} onClick={()=>setShowBoxes(v=>{showStatusNotice(v?"Caixas ocultas":"Caixas visíveis",900);return !v})}><SquareDashed/></button>
          <button className={showLabels?"active":""} aria-label={showLabels?"Ocultar rótulos":"Mostrar rótulos"} aria-pressed={showLabels} title={(showLabels?"Ocultar":"Mostrar")+" rótulos dos achados"} disabled={kind!=="2d"} onClick={()=>setShowLabels(v=>{showStatusNotice(v?"Rótulos ocultos":"Rótulos visíveis",900);return !v})}><Tag/></button>
          <span className="editorToolSep" aria-hidden="true"/>
          {[["original",ImageIcon,"Original"],["overlay",Layers2,"Sobrepor (original + detecções)"],["wipe",FlipHorizontal2,"Deslizar"],["side",Columns2,"Lado a lado"]].map(([id,Icon,label])=><button key={id} className={"editorToolMode"+(comparison===id?" active":"")} aria-label={"Visualização: "+label} aria-pressed={comparison===id} title={id!=="original"&&!res?label+" · disponível após a análise":label} disabled={kind!=="2d"||(id!=="original"&&!res)} onClick={()=>changeComparison(id)}><Icon/></button>)}
          <span className="editorToolSep" aria-hidden="true"/>
          <button className={parityOpen?"active":""} aria-label="Paridade CDM Python ⇄ navegador" aria-pressed={parityOpen} title="Paridade CDM · indicadores e gráficos Python ⇄ navegador" onClick={()=>setParityOpen(v=>!v)}><CdmIcon/></button>
          <button aria-label="Abrir modo câmera" title="Modo câmera" disabled={busy} onClick={()=>setCameraOpen(true)}><Camera/></button>
          {onLive&&<button className="editorToolLive" aria-label="Abrir Live detecção" title="Live detecção · tempo real com câmera ou vídeo" disabled={busy} onClick={onLive}><Radio/></button>}
        </div>
        {aulasOpen?<button type="button" className="editorAulasLink active" onClick={onToggleAulas} aria-pressed="true" aria-label="Voltar à análise" title="Voltar à análise"><BookOpen size={20} aria-hidden="true"/></button>
          :<button type="button" className="editorAulasLink editorAboutLink" onClick={()=>setHelpDialog("about")} aria-label="Sobre o SHM Studio" title="Sobre o SHM Studio · versão, projeto e financiamento"><Info size={20} aria-hidden="true"/></button>}
      </div>
      {layersOpen&&!aulasOpen&&!pageOpen&&<><button type="button" className="editorLayersScrim" aria-label="Fechar painel de camadas" title="Fechar camadas" onClick={()=>setLayersPanelOpen(false)}/><aside className={"editorLayers "+(selectedEngineLabels.length>=24?"engineDensityUltra":selectedEngineLabels.length>=12?"engineDensityDense":"")} data-engine-count={selectedEngineLabels.length} data-layer-width={layersWidth} style={{width:layersWidth,"--engine-count":Math.max(1,selectedEngineLabels.length)}}><div className="editorLayersContent"><div className="editorPanelTitle"><b>Camadas</b><button aria-label="Recolher painel de camadas" title="Recolher camadas" onClick={()=>setLayersPanelOpen(false)}><ChevronLeft size={17}/></button></div>
        <div className="layerRow"><span>◉</span> {kind==="2d"?"Imagem atual · t1":kind==="3d"?"Modelo 3D atual":"Arquivo atual"}</div>
        {kind==="2d"&&referenceFile&&<div className="layerRow referenceLayer"><span>○</span><span>Referência · t0 <small>{referenceFile.name}</small>{linkedReferenceCompatibility&&<em className={"referenceCompatibility "+linkedReferenceCompatibility.status} title={linkedReferenceCompatibility.refLabel}>{linkedReferenceCompatibility.text}</em>}</span><button className="layerClear" aria-label="Remover referência temporal t0" disabled={busy} title="Remover referência t0" onClick={()=>onReferenceFile(null)}><X size={13}/></button></div>}
        {kind==="3d"&&spatialPhotoViews.map(view=><div className={"layerRow referenceLayer spatialRgbLayer "+(view.id===activeSpatialPhotoId?"selected":"")} key={view.id}><span>{view.id===activeSpatialPhotoId?"◉":"○"}</span><span>{view.file?.name}<small>{view.registration?.registration?(view.registration?.method==="orb_anchor_projection_pnp"?"auto registrada":"registrada"):view.auto_registration_error?"auto falhou · manual disponível":"registro pendente"}</small><em className={"referenceCompatibility "+(view.registration?.registration?"pass":"warning")}>{view.registration?.registration?"fotometria elegível":"selecione e registre"}</em></span><button className="layerSolo" type="button" disabled={busy||view.id===activeSpatialPhotoId} onClick={()=>onSelectSpatialPhoto?.(view.id)}>Ativar</button><button className="layerClear" aria-label={"Remover "+view.file?.name} disabled={busy} title="Remover vista" onClick={()=>onRemoveSpatialPhoto?.(view.id)}><X size={13}/></button></div>)}
        {results.map(r=><label className="layerRow" key={r.engine_id}><input type="checkbox" checked={visible[r.engine_id]!==false} onChange={e=>setVisible(v=>({...v,[r.engine_id]:e.target.checked}))}/>{r.name}</label>)}
        {pathologyLayers.length>0&&<details open={pathologyGroupOpen} onToggle={e=>setPathologyGroupOpen(e.currentTarget.open)} className="pathologyLayerGroup"><summary><span>{chosen?.name||"CDM"} · Patologias</span><small>{pathologyVisibleCount}/{pathologyLayers.length} visíveis</small></summary><div className="layerGroupActions"><button type="button" onClick={()=>setPathologyGroupVisible(true)}>Mostrar todas</button><button type="button" onClick={()=>setPathologyGroupVisible(false)}>Ocultar todas</button><button type="button" className={"layerBoxesToggle"+(showBoxes?" active":"")} aria-pressed={showBoxes} title="Mostrar ou ocultar as caixas delimitadoras dos achados (continuam clicáveis)" onClick={()=>setShowBoxes(v=>!v)}>Caixas</button><button type="button" className={"layerBoxesToggle"+(showLabels?" active":"")} aria-pressed={showLabels} title="Mostrar ou ocultar os rótulos dos achados no canvas (código e medida resumida)" onClick={()=>setShowLabels(v=>!v)}>Rótulos</button></div>{orderedPathologyLayers.map((layer,index)=><React.Fragment key={layer.id}><div className={"layerRow pathologyLayer "+(selectedPathologyId===layer.id?"selected":"")} onClick={()=>setSelectedPathologyId(layer.id)}><label className="pathologyToggle"><input type="checkbox" checked={visible[pathologyEngineId+":"+layer.id]!==false} onChange={e=>setVisible(v=>({...v,[pathologyEngineId+":"+layer.id]:e.target.checked}))}/><span className="pathologySwatch" style={{background:layer.color}}/><span className="pathologyName">{layer.name}</span><small>({layer.count})</small></label><span className="layerStackLabel">{index===0?"TOPO":index===orderedPathologyLayers.length-1?"FUNDO":index+1}</span>{pathologyLocked.has(layer.id)&&<span className="layerLockState" title="Camada bloqueada"><Lock size={10}/></span>}<span className="layerOrderControls"><button type="button" disabled={pathologyLocked.has(layer.id)||index===0} aria-label={"Subir camada "+layer.name} title={"Subir "+layer.name} onClick={()=>movePathologyLayer(layer.id,-1)}><ChevronUp size={11}/></button><button type="button" disabled={pathologyLocked.has(layer.id)||index===orderedPathologyLayers.length-1} aria-label={"Descer camada "+layer.name} title={"Descer "+layer.name} onClick={()=>movePathologyLayer(layer.id,1)}><ChevronDown size={11}/></button></span><button type="button" className={"layerSettingsToggle"+(layerSettingsId===layer.id?" active":"")} aria-expanded={layerSettingsId===layer.id} aria-label={"Configurar exibição de "+layer.name} title={"Exibição de "+layer.name} onClick={e=>{e.stopPropagation();setLayerSettingsId(id=>id===layer.id?null:layer.id)}}><Settings2 size={12}/></button><button className="layerSolo" type="button" title={"Isolar "+layer.name} onClick={()=>isolatePathologyLayer(layer.id)}>Só</button></div>{layerSettingsId===layer.id&&(()=>{const locked=pathologyLocked.has(layer.id),value=Number(pathologyOpacity[layer.id]??1),boxesOn=visible[pathologyEngineId+":boxes:"+layer.id]!==false;return <div className={"layerSettingsPanel"+(locked?" locked":"")} onClick={e=>e.stopPropagation()}>
          <label><span>Opacidade</span><b>{Math.round(value*100)}%</b><input aria-label={"Opacidade de "+layer.name} type="range" min="0" max="1" step=".05" value={value} disabled={locked} onChange={e=>setLayerOpacity(layer.id,e.target.value)}/></label>
          <label className="layerSettingsCheck"><input type="checkbox" checked={boxesOn} onChange={e=>setVisible(v=>({...v,[pathologyEngineId+":boxes:"+layer.id]:e.target.checked}))}/> Caixas delimitadoras desta camada</label>
          <label className="layerSettingsCheck"><input type="checkbox" checked={visible[pathologyEngineId+":labels:"+layer.id]!==false} onChange={e=>setVisible(v=>({...v,[pathologyEngineId+":labels:"+layer.id]:e.target.checked}))}/> Rótulos desta camada</label>
          <div className="layerSettingsActions"><button type="button" disabled={locked||value===1} onClick={()=>setLayerOpacity(layer.id,1)}>Restaurar 100%</button><button type="button" onClick={()=>toggleLayerLock(layer.id)}>{locked?<><Unlock size={10}/> Desbloquear</>:<><Lock size={10}/> Bloquear</>}</button></div>
        </div>})()}</React.Fragment>)}</details>}
        {temporalLayers.length>0&&<details className={"temporalLayerGroup "+(temporalQuality?.status||"")}><summary><span>Mudança t0→t1</span><small>{temporalQuality?.status==="fail"?"não validada":temporalQuality?.status==="warning"?"ressalvas":temporalQuality?.status==="pass"?temporalVisibleCount+"/"+temporalLayers.length+" visíveis":temporalLayers.length+" camadas"}</small></summary><div className="layerGroupActions"><button type="button" onClick={()=>setTemporalGroupVisible(true)}>Mostrar todas</button><button type="button" onClick={()=>setTemporalGroupVisible(false)}>Ocultar todas</button></div>{temporalLayers.map(layer=><label className="layerRow pathologyLayer temporalLayer" key={"temporal-"+layer.id}><input type="checkbox" checked={temporalLayerIsVisible(layer.id)} onChange={e=>setVisible(v=>({...v,["cdm_1:temporal:"+layer.id]:e.target.checked}))}/><span className="pathologySwatch" style={{background:layer.color}}/>{layer.name} <small>({layer.count})</small></label>)}</details>}
        <div className="editorPanelTitle"><b>Propriedades</b></div>
        <p>Tipo reconhecido: <b>{kind==="2d"?"Imagem 2D":kind==="3d"?"Modelo 3D":kind==="unknown"?"Não suportado":"Indefinido"}</b></p>
        {file&&<div className="editorAssetMeta" aria-label="Metadados do arquivo importado"><div><span>Arquivo</span><b title={file.name}>{file.name}</b></div><div><span>Tamanho</span><b>{formatFileSize(file.size)}</b></div>{kind==="2d"&&imageDecoded&&<><div><span>Resolução</span><b>{imageSize.width} × {imageSize.height} px</b></div><div><span>Imagem</span><b>{imageMegapixels.toFixed(2)} MP</b></div><div><span>Memória 2D</span><b title="Estimativa RGBA: largura × altura × 4 bytes">{formatFileSize(imageLoad.decodedBytes)}</b></div><div><span>Carga</span><b className={"assetLoad "+imageLoad.level} title="Orientação baseada apenas na memória RGBA estimada; não bloqueia a análise">{imageLoad.label}</b></div></>}</div>}
        {kind==="unknown"&&<p className="editorUnsupportedProperty">Selecione outro arquivo usando um formato 2D ou 3D suportado.</p>}
        {kind==="2d"&&<><p>Sobreposição global: {Math.round(opacity*100)}%</p><input aria-label="Opacidade da sobreposição" type="range" min="0" max="1" step=".05" value={opacity} onChange={e=>setOpacity(Number(e.target.value))}/></>}
        </div>
        {kind==="2d"&&<div className="editorSidebarActions"><button className="viewerReset" type="button" onClick={resetViewerPreferences}>Restaurar visualização</button></div>}
        <div className="editorSidebarEngines" aria-label="Motores ativos" title={selectedEngineLabels.map(engine=>engine.name).join(", ")||"Nenhum motor selecionado"}>
          <small>MOTORES ATIVOS</small>
          <div className="editorSidebarEngineList">
            {selectedEngineLabels.length?selectedEngineLabels.map((engine,index)=><span className={"editorSidebarEngineName "+(index>=12?"editorSidebarEngineExtra":"")} key={engine.id}>{engine.name}</span>):<span className="editorSidebarEngineName">—</span>}
            {selectedEngineLabels.length>12&&<span className="editorSidebarEngineOverflow">+{selectedEngineLabels.length-12} motores</span>}
          </div>
        </div>
      </aside><div className="editorLayerResizeHandle" role="separator" tabIndex="0" aria-orientation="vertical" aria-label="Redimensionar painel de camadas" aria-valuemin="340" aria-valuemax="600" aria-valuenow={Math.round(layersWidth)} aria-valuetext={Math.round(layersWidth)+" pixels"} title="Arraste ou use ← →, Home e End" onKeyDown={resizeLayersKey} onPointerDown={beginLayersResize}/></>}
      {pageOpen?<div className="editorViewport studioPageViewport"><div className={"studioPage studioPage-"+page.id}>
        {page.header!==false&&<header className="studioPageHead"><div><small>SHM Studio</small><b>{page.title}</b></div><button type="button" onClick={()=>onNavigate?.("analysis")}><ChevronLeft size={15}/> Voltar ao canvas</button></header>}
        {page.node}
      </div></div>:aulasOpen?<div className="editorViewport editorAulasViewport"><iframe ref={aulasFrame} src={aulasHref} title="Trilha Dev SHM · aulas" className="editorAulasFrame" onLoad={()=>onAulasNav?.(aulasFrame.current)}/></div>:
      <div className={"editorViewport "+(fileDragActive?"fileDragActive":"")+(stagesActive?" hasStages":"")+(inspectorOpen&&kind==="2d"?" hasInspector":"")+(resultOpen&&(busy||results.length>0)?" hasResultStack":"")+(showRulers?" hasRulers":"")} style={leftStackTop!=null?{"--left-stack-top":leftStackTop+"px"}:undefined} ref={surface} onDragEnter={fileDragEnter} onDragOver={fileDragOver} onDragLeave={fileDragLeave} onDrop={fileDrop}>
        {parityOpen&&!aulasOpen&&<React.Suspense fallback={null}><ParityPanel onClose={()=>setParityOpen(false)} boundsRef={surface} file={kind==="2d"?file:null} cdmOptions={cdmOptions} imageReady={kind==="2d"&&!!file}/></React.Suspense>}
        {showRulers&&<CanvasRulers viewportRef={surface} mmPerPx={rulerMmPerPx} unit={rulers.unit||"mm"} onCycleUnit={cycleRulerUnit}/>}
        <div className="editorCanvasEntries">
          {onLive&&<button className="editorLiveEntry" disabled={busy} title="Live · detecção em tempo real com câmera ou vídeo (foto e gravação)" aria-label="Abrir Live detecção" onClick={onLive}><Radio size={16}/> Live detecção</button>}
          <button className="editorCameraEntry" disabled={busy} onClick={()=>setCameraOpen(true)}><Camera size={16}/> Câmera</button>
        </div>
        {file&&kind==="2d"&&!inspectorOpen&&<button className={"editorImageEntry "+(imageQuality?"q-"+imageQuality.verdict:"")} onClick={()=>setInspectorOpen(true)} title="Histograma, propriedades, qualidade e correção da imagem"><SlidersHorizontal size={15}/> Imagem{imageQuality&&<i aria-label={"Qualidade "+imageQuality.score}>{imageQuality.score}</i>}</button>}
        {file&&kind==="2d"&&<ImageInspector file={file} open={inspectorOpen} tab={inspectorTab} onTab={setInspectorTab} onClose={()=>setInspectorOpen(false)} onPreview={setCorrectionPreview} onApplyCorrection={(next,info)=>{setCorrectionPreview(null);onApplyCorrection?.(next,info);showStatusNotice("Correção aplicada · "+info.description,2600)}} onRestoreOriginal={()=>{onRestoreOriginal?.();showStatusNotice("Imagem original restaurada",1600)}} hasOriginal={hasOriginalFile} appliedCorrection={appliedCorrection} onDiagnostics={handleDiagnostics} onRename={name=>{const f=onRenameFile?.(name);showStatusNotice("Arquivo renomeado",1400);return f}} onSave={f=>{onSaveFile?.(f);showStatusNotice("Arquivo salvo · "+(f?.name||file.name),1600)}}/>}
        {file&&kind==="2d"&&chosen&&<EngineStages engineId={chosen.engine_id} engineName={chosen.name} file={file} result={chosen} options={cdmOptions} control={stageControl} hidden={busy} onState={setStagesActive}/>}
        {fileDragActive&&<div className="editorDropOverlay" aria-hidden="true"><ImagePlus size={30}/><b>Solte para importar</b><span>Imagem 2D, modelo 3D ou LAS / XYZ / IFC</span></div>}
        {file&&<div className={"editorTypeBadge "+(kind==="unknown"?"unsupported":"")}>{kind==="2d"?"▧  2D detectado":kind==="3d"?(isCdm3SpatialAsset(file)?"◇  CDM-3 espacial":"◇  3D detectado"):"Formato não suportado"}</div>}
        {!file?<div className="editorEmpty"><ImagePlus size={38}/><h2>Importe uma imagem ou ativo espacial</h2><p>Imagens 2D usam os motores visuais. LAS, XYZ e IFC são reconhecidos como entradas espaciais do CDM-3. Também é possível arrastar o arquivo ou colar uma imagem.</p><button onClick={()=>picker.current?.click()}>Selecionar arquivo</button></div>:
        kind==="3d"?<><Suspense fallback={<div className="editorEmpty">Preparando visualizador 3D…</div>}><ModelViewport file={file} pickEnabled={registrationOpen&&!!registrationPendingUv} onPointPick={pickRegistrationWorldPoint} spatialFramePickMode={spatialFramePickMode} onSpatialFramePointPick={point=>{if(point.role==="source"){setSpatialFramePendingSource(point.xyz);setSpatialFramePickMode("target");setSpatialFrameError("")}else if(point.role==="target"&&spatialFramePendingSource){setSpatialFramePairs(p=>[...p,{source_xyz:spatialFramePendingSource,target_xyz:point.xyz}]);setSpatialFramePendingSource(null);setSpatialFramePickMode(null);setSpatialFrameError("")}}} rgbReferenceFile={spatialRgbFile} registration={spatialRegistration} spatialTransform={spatialTransform} rgbPathologyAnalysis={spatialRgbAnalysis} photometricViews={spatialPhotoViews} onPhotometricSummary={onPhotometricSummary} onSpatialRegistrationSample={onSpatialRegistrationSample} onSpatialPathologyRecords={records=>{onSpatialPathologyRecords?.(records);if(spatialBaseline?.records?.length)setSpatial4dRecords(matchTemporalDamageCampaigns(spatialBaseline.records,records))}} spatial4dRecords={displaySpatial4dRecords} timelineSnapshot={spatialTimelineSnapshot} temporalTracks={spatialTimeline?.tracks||[]}/></Suspense>{kind==="3d"&&<div className={"spatialFramePanel "+(spatialFrameCollapsed?"collapsed":"")}><header><button type="button" className="spatialFrameCollapse" onClick={()=>setSpatialFrameCollapsed(v=>!v)} aria-expanded={!spatialFrameCollapsed}><b>Referencial LAS/XYZ ↔ IFC</b><span>{spatialTransform?.frame_compatible?"validado":"não validado"}</span><i>{spatialFrameCollapsed?"⌃":"⌄"}</i></button></header>{!spatialFrameCollapsed&&<><div className="spatialFrameAssets"><span className={spatialFrameAssets?.source?"ready":""}>Fonte {spatialFrameAssets?.source?"✓":"—"}</span><span className={spatialFrameAssets?.target?"ready":""}>IFC {spatialFrameAssets?.target?"✓":"—"}</span></div><div className="spatialFramePickActions"><button type="button" className={spatialFramePickMode==="source"?"active":""} onClick={()=>{setSpatialFramePendingSource(null);setSpatialFramePickMode("source");setSpatialFrameError("")}}>1 · Capturar LAS/XYZ</button><button type="button" className={spatialFramePickMode==="target"?"active":""} disabled={!spatialFramePendingSource} onClick={()=>setSpatialFramePickMode("target")}>2 · Capturar IFC</button>{spatialFramePickMode&&<span>{spatialFramePickMode==="source"?"Clique em um ponto da nuvem":"Agora clique na superfície IFC correspondente"}</span>}</div><div className="spatialFramePairInput"><input value={spatialFrameDraft.source} onChange={e=>setSpatialFrameDraft(v=>({...v,source:e.target.value}))} placeholder="LAS/XYZ: X, Y, Z"/><input value={spatialFrameDraft.target} onChange={e=>setSpatialFrameDraft(v=>({...v,target:e.target.value}))} placeholder="IFC local: X, Y, Z"/><button type="button" onClick={()=>{const parse=v=>String(v).split(/[;,\s]+/).filter(Boolean).map(Number),source=parse(spatialFrameDraft.source),target=parse(spatialFrameDraft.target);if(source.length!==3||target.length!==3||![...source,...target].every(Number.isFinite)){setSpatialFrameError("Informe três coordenadas numéricas em cada ponto.");return}setSpatialFramePairs(p=>[...p,{source_xyz:source,target_xyz:target}]);setSpatialFrameDraft({source:"",target:""});setSpatialFrameError("")}}>Adicionar par</button></div><div className="spatialFramePairs">{spatialFramePairs.map((pair,index)=>{const source=Array.isArray(pair?.source_xyz)?pair.source_xyz:Array.isArray(pair?.source)?pair.source:[];const target=Array.isArray(pair?.target_xyz)?pair.target_xyz:Array.isArray(pair?.target)?pair.target:[];return <div className="spatialFramePairRow" key={index}><span>#{index+1}</span><code>L {source.length===3?source.map(v=>Number(v).toFixed(3)).join(", "):"—"}</code><code>I {target.length===3?target.map(v=>Number(v).toFixed(3)).join(", "):"—"}</code><button type="button" aria-label={"Remover par "+(index+1)} onClick={()=>setSpatialFramePairs(p=>p.filter((_,i)=>i!==index))}>×</button></div>})}</div><div className="spatialFrameStatus"><span>{spatialFramePairs.length} pares</span>{Number.isFinite(spatialTransform?.rmse)&&<span>RMSE <b>{Number(spatialTransform.rmse).toPrecision(4)}</b></span>}<button type="button" disabled={spatialFramePairs.length<3||!spatialFrameAssets?.source||!spatialFrameAssets?.target||spatialFrameBusy||!onSolveSpatialFrameAlignment} onClick={async()=>{setSpatialFrameBusy(true);setSpatialFrameError("");try{await onSolveSpatialFrameAlignment?.(spatialFramePairs)}catch(e){setSpatialFrameError(e?.message||String(e))}finally{setSpatialFrameBusy(false)}}}>{spatialFrameBusy?"Alinhando…":"Resolver referencial"}</button>{spatialFramePairs.length>0&&<button type="button" onClick={()=>{setSpatialFramePairs([]);setSpatialFramePendingSource(null);setSpatialFramePickMode(null);setSpatialFrameError("")}}>Limpar</button>}</div>{spatialFrameError&&<small className="spatialFrameError">{spatialFrameError}</small>}</>}</div>}{spatialRgbPrev&&<div className="spatialRgbPreview" title="Imagem RGB auxiliar para registro espacial"><img src={spatialRgbPrev} alt="Imagem RGB auxiliar do CDM-3"/><span><b>RGB externo</b><small>{spatialRegistration?.registration?"pose resolvida":"registro 2D→3D pendente"}</small><button type="button" className="spatialRgbRegister" onClick={()=>setRegistrationOpen(v=>!v)}>{registrationOpen?"Fechar":"Registrar"}</button></span><button type="button" aria-label="Remover imagem RGB espacial" onClick={()=>onSpatialRgbFile?.(null)}><X size={12}/></button></div>}{registrationOpen&&spatialRgbPrev&&<div className="spatialRegistrationPanel" role="dialog" aria-label="Registro da imagem RGB na nuvem 3D"><header><b>Registro RGB · 2D→3D</b><button type="button" aria-label="Fechar registro RGB" onClick={()=>setRegistrationOpen(false)}><X size={14}/></button></header><p>{registrationPendingUv?"Agora clique no ponto correspondente na nuvem 3D.":"Clique primeiro no ponto de controle na fotografia."}</p><button type="button" className={"spatialRegistrationImage "+(registrationPendingUv?"pointPending":"")} onClick={pickRegistrationPixel}><img ref={registrationImage} src={spatialRgbPrev} alt="Fotografia RGB para selecionar pontos de controle"/></button><div className="spatialRegistrationStats"><b>{registrationPairs.length}/6 pares mínimos</b>{registrationPendingUv&&<span>Pixel: {registrationPendingUv.map(v=>v.toFixed(1)).join(", ")}</span>}{registrationPairs.slice(-3).map((pair,index)=><small key={registrationPairs.length+"-"+index}>uv [{pair.uv.map(v=>v.toFixed(1)).join(", ")}] → XYZ [{pair.xyz.map(v=>Number(v).toFixed(3)).join(", ")}]</small>)}</div><details className="spatialRegistrationIntrinsics"><summary>Intrínsecos da câmera · opcional</summary><div><label>fx<input type="number" inputMode="decimal" value={registrationIntrinsics.fx} onChange={e=>setRegistrationIntrinsics(v=>({...v,fx:e.target.value}))}/></label><label>fy<input type="number" inputMode="decimal" value={registrationIntrinsics.fy} onChange={e=>setRegistrationIntrinsics(v=>({...v,fy:e.target.value}))}/></label><label>cx<input type="number" inputMode="decimal" value={registrationIntrinsics.cx} onChange={e=>setRegistrationIntrinsics(v=>({...v,cx:e.target.value}))}/></label><label>cy<input type="number" inputMode="decimal" value={registrationIntrinsics.cy} onChange={e=>setRegistrationIntrinsics(v=>({...v,cy:e.target.value}))}/></label></div><small>Sem fx/fy o solver usa intrínsecos aproximados apenas para prévia e marca o resultado como não métrico.</small></details><div className="spatialRegistrationActions"><button type="button" disabled={(!registrationPairs.length&&!registrationPendingUv)||registrationBusy} onClick={undoRegistrationPair}>Desfazer</button><button type="button" disabled={(!registrationPairs.length&&!registrationPendingUv)||registrationBusy} onClick={resetRegistrationPairs}>Limpar</button><button type="button" className="primary" disabled={registrationPairs.length<6||registrationBusy||spatialAutoRegistrationBusy} onClick={solveRegistration}>{registrationBusy?"Resolvendo…":"Resolver pose"}</button>{spatialRegistration?.registration&&spatialPhotoViews.some(view=>!view.registration?.registration)&&<button type="button" disabled={registrationBusy||spatialAutoRegistrationBusy||spatialRegistrationPointCount<20} title={spatialRegistrationPointCount<20?"Aguardando amostra espacial do viewer":"Usar esta vista como âncora e propagar poses por ORB + PnP/RANSAC"} onClick={()=>onAutoRegisterSpatialPhotos?.()}>{spatialAutoRegistrationBusy?"Auto registrando…":"Auto registrar restantes ("+spatialPhotoViews.filter(view=>!view.registration?.registration).length+")"}</button>}</div>{registrationError&&<p className="spatialRegistrationError">{registrationError}</p>}{spatialRegistration?.registration&&<div className="spatialRegistrationSolved"><b>Pose resolvida</b><span>Inliers: {spatialRegistration.registration.inlier_count} · RMSE {Number(spatialRegistration.registration.reprojection_rmse_px||0).toFixed(2)} px</span><span>{spatialRegistration.registration.metric_projection_valid?"Calibração métrica válida":"Prévia não métrica · intrínsecos estimados"}</span>{spatialRgbAnalysis?.results?.[0]&&<span>Segmentação RGB: {Number(spatialRgbAnalysis.results[0].metrics?.summary?.total_objects||0)} achados 2D preparados para projeção 3D</span>}{spatialAutoRegistrationStatus&&<span>Auto-registro: {spatialAutoRegistrationStatus.message}</span>}</div>}</div>}</>:
        kind==="unknown"?<div className="editorEmpty editorUnsupported"><ImageIcon size={34}/><h2>Formato não suportado</h2><p>Use imagem {SUPPORTED_IMAGE_EXTENSIONS.map(ext=>"."+ext).join(", ")} ou modelo 3D {SUPPORTED_MODEL_EXTENSIONS.map(ext=>"."+ext).join(", ")}.</p><button onClick={()=>picker.current?.click()}>Escolher outro arquivo</button></div>:
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
          {busy&&<div className={"editorProgress "+(persisting?"persisting":"")}><span>{persisting?"Salvando histórico local":(progress?.current_engine||"Processando motores")+" · "+(progress?.total===100?pct+"%":(progress?.completed||0)+"/"+(progress?.total||selected.length))}</span><strong>{String(Math.floor(elapsed/60)).padStart(2,"0")}:{String(elapsed%60).padStart(2,"0")}</strong><div><i style={{width:(persisting?100:pct)+"%"}}/></div>{onCancel&&!persisting&&<button onClick={onCancel} disabled={progress?.state==="cancel_requested"}>{progress?.state==="cancel_requested"?"Cancelando…":"Cancelar"}</button>}</div>}
          {!busy&&res&&hasMeasuredDuration&&<div className="editorRunTime editorMetricRow"><span className="editorMetricLabel">Tempo da análise</span><b className="editorMetricValue">{(measuredDurationMs/1000).toFixed(2)} s</b></div>}
          {results.map(r=>{const area=Number(r.metrics?.crack_area_ratio??r.metrics?.model_crack_area_ratio);const hasArea=Number.isFinite(area)&&area>=0;const spatial=r.metrics?.runtime_mode==="spatial_browser_ingestion";const spatialPoints=Number(r.metrics?.spatial_asset?.sampled_points||0);return <button key={r.engine_id} className={"editorResultRow "+(chosen?.engine_id===r.engine_id?"active":"")} onClick={()=>{setActive(r.engine_id);setVisible(v=>({...v,[r.engine_id]:true}))}}><span className="editorResultEngine">{r.name}</span><span className="editorResultMetric"><small>{spatial?"Pontos":hasArea?"Área fissura":"Achados"}</small><b>{spatial?spatialPoints.toLocaleString("pt-BR"):hasArea?(area*100).toFixed(area<.001?3:2)+"%":(r.detections?.length||0)}</b></span><span className="editorResultMetric"><small>Latência</small><b>{Number(r.latency_ms||0).toFixed(0)} ms</b></span></button>})}
          {kind==="3d"&&spatialTimeline&&(()=>{const timeline=spatialTimeline,snapshot=spatialTimelineSnapshot;return <div className="spatial4dTimeline"><b>Timeline 4D</b><button type="button" className="timelinePlay" aria-label={spatialTimelinePlaying?"Pausar timeline 4D":"Reproduzir timeline 4D"} onClick={()=>{if(!spatialTimelinePlaying&&spatialTimelineIndex>=timeline.snapshots.length-1)setSpatialTimelineIndex(0);setSpatialTimelinePlaying(v=>!v)}}>{spatialTimelinePlaying?"Ⅱ":"▶"}</button><button disabled={spatialTimelineIndex<=0} onClick={()=>setSpatialTimelineIndex(i=>Math.max(0,i-1))}>‹</button><input type="range" min="0" max={Math.max(0,timeline.snapshots.length-1)} value={Math.min(spatialTimelineIndex,timeline.snapshots.length-1)} onChange={e=>setSpatialTimelineIndex(Number(e.target.value))}/><button disabled={spatialTimelineIndex>=timeline.snapshots.length-1} onClick={()=>setSpatialTimelineIndex(i=>Math.min(timeline.snapshots.length-1,i+1))}>›</button><span>{snapshot?.campaign_id||"—"}{snapshot?.observed_at?" · "+snapshot.observed_at:""}</span><small>{timeline.tracks.length} tracks</small></div>})()}
          {kind==="3d"&&spatialPathologyRecords.length>0&&<div className="spatial4dControl"><b>CDM-3 · 4D</b>{!spatialBaseline?<button type="button" onClick={()=>{setSpatialBaseline({records:spatialPathologyRecords.map(record=>structuredClone(record)),inspection:inspectionMeta||null,id:referenceInspectionId||("campaign-"+Date.now())});setSpatial4dRecords([]);showStatusNotice("Campanha atual definida como baseline 4D",1600)}}>Definir campanha A</button>:<><span>A · {spatialBaseline.id}</span><button type="button" onClick={()=>setSpatial4dRecords(matchTemporalDamageCampaigns(spatialBaseline.records,spatialPathologyRecords))}>Comparar A × B</button><button type="button" onClick={()=>{const next={campaign_id:inspectionMeta?.id||("campaign-"+(spatialCampaigns.length+1)),observed_at:inspectionMeta?.date||inspectionMeta?.observed_at||null,records:spatialPathologyRecords.map(record=>structuredClone(record))};setSpatialCampaigns(list=>list.length?[...list,next]:[{campaign_id:spatialBaseline.id,observed_at:spatialBaseline.inspection?.date||null,records:spatialBaseline.records},next]);setSpatialTimelineIndex(spatialCampaigns.length?spatialCampaigns.length:1)}}>Adicionar à timeline</button><button type="button" onClick={()=>{setSpatialBaseline(null);setSpatial4dRecords([])}}>Limpar</button></>}</div>}
          {spatialSummary&&<div className="editorCdmSummary"><b className="editorCdmTitle">CDM-3 · ativo espacial</b><div className="editorMetricsGrid"><div className="editorMetricRow accentA"><span className="editorMetricLabel">Formato</span><b className="editorMetricValue">{String(chosen?.metrics?.source_format||"—").toUpperCase()}</b></div><div className="editorMetricRow accentB"><span className="editorMetricLabel">Pontos</span><b className="editorMetricValue">{Number(spatialSummary.sampled_points||0).toLocaleString("pt-BR")}</b></div><div className="editorMetricRow accentC"><span className="editorMetricLabel">RGB por ponto</span><b className="editorMetricValue">{spatialSummary.has_rgb?"Sim":"Não"}</b></div><div className="editorMetricRow accentD"><span className="editorMetricLabel">Canais</span><b className="editorMetricValue">{(spatialSummary.visual_channels||["elevation"]).map(x=>String(x).replace("classification","classe").replace("intensity","intensidade").replace("elevation","elevação").toUpperCase()).join(" · ")}</b></div><div className="editorMetricRow accentA"><span className="editorMetricLabel">Segmentação</span><b className="editorMetricValue">{spatialSummary.has_rgb?"visual + espacial":"geométrica / sem textura"}</b></div><div className="editorMetricRow accentB"><span className="editorMetricLabel">RGB externo</span><b className="editorMetricValue">{chosen?.metrics?.image_registration?.source?.name||"—"}</b></div><div className="editorMetricRow accentC"><span className="editorMetricLabel">Registro 2D→3D</span><b className="editorMetricValue">{chosen?.metrics?.image_registration?.state==="rgb_source_attached_pose_required"?"PnP/RANSAC pendente":chosen?.metrics?.image_registration?.state||"—"}</b></div><div className="editorMetricRow accentA"><span className="editorMetricLabel">Vistas fotométricas</span><b className="editorMetricValue">{Number(photometricSummary?.registered_views||0)} / {spatialPhotoViews.length}</b></div><div className="editorMetricRow accentB"><span className="editorMetricLabel">Cobertura textura</span><b className="editorMetricValue">{photometricSummary? (Number(photometricSummary.coverage_ratio||0)*100).toFixed(1)+"%":"—"}</b></div><div className="editorMetricRow accentC"><span className="editorMetricLabel">Patologias 3D</span><b className="editorMetricValue">{Number(spatialPathologyRecords.length||0).toLocaleString("pt-BR")}</b></div><div className="editorMetricRow accentD"><span className="editorMetricLabel">Comparação 4D</span><b className="editorMetricValue">{spatialBaseline?(spatial4dRecords.length+" pareados"):"Sem baseline"}</b></div><div className="editorMetricRow accentD"><span className="editorMetricLabel">Registro métrico</span><b className="editorMetricValue">{spatialRegistration?.registration?.metric_projection_valid?"Válido":"Não validado"}</b></div><div className="editorMetricRow accentC"><span className="editorMetricLabel">Schema IFC</span><b className="editorMetricValue">{spatialSummary.schema||"—"}</b></div><div className="editorMetricRow accentD"><span className="editorMetricLabel">Entidades IFC</span><b className="editorMetricValue">{Number(spatialSummary.entity_count||0).toLocaleString("pt-BR")}</b></div></div>{spatialSummary.bounds&&<p><b>Bounds:</b> min [{spatialSummary.bounds.min.map(v=>Number(v).toFixed(3)).join(", ")}] · max [{spatialSummary.bounds.max.map(v=>Number(v).toFixed(3)).join(", ")}].</p>}{chosen?.message&&<p>{chosen.message}</p>}</div>}
          {cdmSummary&&<div className="editorCdmSummary"><b className="editorCdmTitle">{chosen?.name||"CDM"} · resumo morfológico</b><div className="editorMetricsGrid">{findingRows.map(row=><React.Fragment key={row.id}><button type="button" className={"editorMetricRow editorMetricToggle "+row.accent+(findingList===row.id?" open":"")} style={row.color?{borderLeftColor:row.color,background:hexToRgba(row.color,.07)}:undefined} aria-expanded={findingList===row.id} onClick={()=>setFindingList(v=>v===row.id?null:row.id)} title={"Listar "+row.label.toLowerCase()}><span className="editorMetricLabel"><ChevronRight size={11} aria-hidden="true"/>{row.label}</span><b className="editorMetricValue">{row.total!=null&&<em className="editorMetricCount">{row.count}</em>}{row.total!=null?row.total:row.count}</b></button>
            {findingList===row.id&&renderFindingList(row.id)}</React.Fragment>)}</div>{cdmRating?.enabled&&<p>Estimativa por imagem: NT {cdmRating.NT_img} · EC {cdmRating.EC_DNIT_img} · GDE {Number(cdmRating.GDE_img||0).toFixed(2)}. Confirme em inspeção técnica.</p>}{temporal?.enabled&&<p><b>t0→t1:</b> crescimento {temporalGrowth.toFixed(temporalCalibrated?1:0)} {temporalUnit} · redução {temporalReduction.toFixed(temporalCalibrated?1:0)} {temporalUnit} · {temporalAlignment?.accepted?<>registro automático Δx={Number(temporalAlignment.dx_px||0).toFixed(0)} px, Δy={Number(temporalAlignment.dy_px||0).toFixed(0)} px · ganho {(Number(temporalAlignment.improvement||0)*100).toFixed(1)}%</>:<>alinhamento {temporal?.alignment_method==="translation_auto"?"automático sem translação aplicada":"por redimensionamento"}</>}.</p>}{temporalMetricRows.length>0&&<details className="editorTemporalMetrics"><summary>Quantificação por patologia <small>{temporalUnit}</small></summary><div className="editorTemporalTable"><span className="head">Patologia</span><span className="head">t0</span><span className="head">t1</span><span className="head">Δ</span><span className="head">Δ/t0</span>{temporalMetricRows.map(row=><React.Fragment key={row.cls}><span title={"IoU "+row.iou.toFixed(3)}>{row.label}</span><span>{row.previous.toFixed(1)}</span><span>{row.current.toFixed(1)}</span><span className={row.net>0?"positive":row.net<0?"negative":""}>{row.net>0?"+":""}{row.net.toFixed(1)}</span><span>{row.netRate==null?"—":(row.netRate>0?"+":"")+row.netRate.toFixed(1)+"%"}</span></React.Fragment>)}</div></details>}{temporalQualityLabel&&<p className={"editorTemporalQuality "+temporalQuality.status}><b>{temporalQualityLabel}</b>{temporalQuality?.metrics&&<> · sobreposição {(Number(temporalQuality.metrics.overlap_ratio||0)*100).toFixed(1)}% · Δ iluminação {(Number(temporalQuality.metrics.illumination_delta||0)*100).toFixed(1)}% · razão de nitidez {Number(temporalQuality.metrics.sharpness_ratio||0).toFixed(2)} · similaridade geométrica {Number(temporalQuality.metrics.edge_similarity||0).toFixed(2)}</>}{temporalQualityNotes.length>0&&<span> · {temporalQualityNotes.join("; ")}</span>}</p>}{temporalRegistrationWarning&&<p className="editorCdmWarning">{temporalRegistrationWarning}</p>}{chosen?.metrics?.performance_ms&&<div className="editorPerf"><b className="editorPerfTitle">Tempo real</b><div className="editorMetricsGrid performance"><div className="editorMetricRow accentDecode"><span className="editorMetricLabel">Decodificação</span><b className="editorMetricValue">{(Number(chosen.metrics.performance_ms.decode||0)/1000).toFixed(2)} s</b></div><div className="editorMetricRow accentCore"><span className="editorMetricLabel">Núcleo</span><b className="editorMetricValue">{(Number(chosen.metrics.performance_ms.core||0)/1000).toFixed(2)} s</b></div><div className="editorMetricRow accentRender"><span className="editorMetricLabel">Renderização</span><b className="editorMetricValue">{(Number(chosen.metrics.performance_ms.render||0)/1000).toFixed(2)} s</b></div><div className="editorMetricRow accentTotal"><span className="editorMetricLabel">Total</span><b className="editorMetricValue">{(Number(chosen.metrics.performance_ms.total||0)/1000).toFixed(2)} s</b></div><div className="editorMetricRow accentRuntime"><span className="editorMetricLabel">Runtime</span><b className="editorMetricValue">{chosen.metrics.runtime||"browser"}</b></div></div></div>}</div>}
          {detail&&<div className="editorFinding"><b>{(layerNameById[detail.label]||detail.label||detail.canonical_label||"Achado")+" "+detail.code}</b>{detail.record&&(detail.label==="cracks"?<><span>Comprimento: {fLen(detail.record.length_px)}</span><span>Largura média: {fLen(detail.record.width_px)}</span></>:<span>Área: {fArea(detail.record.area_px2)}</span>)}{detail.record&&<span>Caixa: {fLen(detail.record.bbox[2])} × {fLen(detail.record.bbox[3])}</span>}<span>Motor: {chosen.name}</span><span>Confiança: {chosen.engine_id==="cdm_1"||chosen.engine_id==="cdm_3"?"não calibrada":detail.score==null?"não informada":(Number(detail.score)*100).toFixed(1)+"%"}</span><span>Coordenadas: {detail.box.map(v=>Math.round(v)).join(", ")} px</span></div>}
          {results.length>0&&<div className="editorCompare editorViewActions">
            <button className={"editorIconButton "+(comparison==="original"?"active":"")} aria-label="Original" title="Original" data-tooltip="Original" onClick={()=>changeComparison("original")}><ImageIcon size={15}/></button>
            <button className={"editorIconButton "+(comparison==="overlay"?"active":"")} aria-label="Sobrepor" title="Sobrepor" data-tooltip={res?"Sobrepor":"Sobrepor · disponível após a análise"} disabled={!res} onClick={()=>changeComparison("overlay")}><Layers3 size={15}/></button>
            <button className={"editorIconButton "+(comparison==="wipe"?"active":"")} aria-label="Deslizar" title="Deslizar" data-tooltip={res?"Deslizar":"Deslizar · disponível após a análise"} disabled={!res} onClick={()=>changeComparison("wipe")}><MoveHorizontal size={15}/></button>
            <button className={"editorIconButton "+(comparison==="side"?"active":"")} aria-label="Lado a lado" title="Lado a lado" data-tooltip={res?"Lado a lado":"Lado a lado · disponível após a análise"} disabled={!res} onClick={()=>changeComparison("side")}><Columns2 size={15}/></button>
            {temporal?.enabled&&referencePrev&&<button className={comparison==="temporal"?"active temporalModeButton":"temporalModeButton"} title="Comparação temporal t0 / t1" onClick={()=>changeComparison("temporal")}>t0 / t1</button>}
            {comparison==="temporal"&&temporalAlignedPreview&&<button title={showRawT0?"Usar t0 alinhado":"Ver t0 bruto"} onClick={()=>setShowRawT0(v=>!v)}>{showRawT0?"Alinhado":"Bruto"}</button>}
            <details ref={exportMenu} className="editorExportMenu editorExportUnified">
              <summary className="editorIconButton" aria-label="Exportar" title="Exportar" data-tooltip="Exportar"><Download size={15}/></summary>
              <div>
                <span className="editorExportSection">Comparação</span>
                <button onClick={()=>{showStatusNotice("Exportação · JSON",1200);onExport()}}>JSON</button>
                <button onClick={()=>{showStatusNotice("Exportação · CSV",1200);onExportCsv()}}>CSV</button>
                {res.consensus_overlay_png_base64&&<button onClick={()=>{showStatusNotice("Exportação · Mapa PNG",1200);onExportMap()}}>Mapa PNG</button>}
                {chosen?.engine_id==="cdm_3"&&spatialPathologyRecords.length>0&&<><span className="editorExportSection">CDM-3 · espacial</span><button onClick={()=>{showStatusNotice("Exportação CDM-3 · JSON 3D",1200);onExportCdm3?.("json")}}>JSON 3D</button><button disabled={!String(file?.name||"").toLowerCase().endsWith(".ifc")} title={!String(file?.name||"").toLowerCase().endsWith(".ifc")?"A exportação IFC anotada requer que o ativo atual seja um arquivo .ifc":"Resolver elemento hospedeiro e exportar IfcAnnotation"} onClick={()=>{showStatusNotice("Exportação CDM-3 · IFC anotado",1200);onExportCdm3?.("ifc")}}>IFC anotado</button></>}
                {cdmSummary&&<>
                  <span className="editorExportSection">{chosen?.name||"CDM"}</span>
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
        {!resultOpen&&(busy||results.length>0)&&<button className={"editorResultsTab "+(persisting?"persisting":busy?"busy":"")} aria-live={busy?"polite":undefined} aria-label={persisting?"Reabrir resultados · salvando histórico":busy?"Reabrir resultados · análise em andamento":"Reabrir resultados · "+results.length+" resultado"+(results.length===1?"":"s")} onClick={()=>{setResultPanelSize(current=>({...current,width:IMAGE_PANEL_WIDTH}));setResultOpenPreference(true)}}>
          <span>Resultados</span>
          <strong>{persisting?"100%":busy?(progress?.total===100?pct+"%":(progress?.completed||0)+"/"+(progress?.total||selected.length)):results.length}</strong>
          {busy&&<i aria-hidden="true"><b style={{width:(persisting?100:pct)+"%"}}/></i>}
        </button>}
      </div>}
    </div>
    <div className="editorStatus"><span className={"editorStatusMessage "+(pageOpen?"":statusNotice&&!busy&&!error&&!previewError?(statusNoticeTone==="warning"?"warning ":"transient "):"")+(!pageOpen&&!statusNotice&&analysisBlockedReason&&!busy&&!error&&!previewError?"blocked":"")} title={statusMessage}>{statusMessage}</span><span className="editorStatusMeta">Zoom {Math.round(zoom*100)}% · {kind?.toUpperCase()||"—"}{comparison==="wipe"?" · divisor "+Math.round(wipePosition)+"%":""}{appInfo?.deployment?.status==="divergent"&&<button className="editorUpdateAvailable" type="button" title="Há uma versão publicada mais recente. Recarregar sem usar o HTML em cache." onClick={()=>{const url=new URL(window.location.href);url.searchParams.set("build",String(appInfo?.deployment?.manifest?.sha||Date.now()));window.location.replace(url.toString())}}><RefreshCw size={11}/> Atualizar</button>}{appInfo?.channel==="development"&&<span className={"editorDevStamp "+(appInfo?.deployment?.status||"")} title={"Build de desenvolvimento · "+(appInfo?.buildSha||"—")+" · catálogo v"+(appInfo?.catalogVersion||"—")+" · deploy "+(appInfo?.deployment?.status||"não verificado")+(appInfo?.deployment?.manifest?.sha?" · publicado "+appInfo.deployment.manifest.sha:"")}>DEV · {String(appInfo?.buildSha||"—").slice(0,8)}{" "}<i className="editorDeployState" aria-label={"Deploy "+(appInfo?.deployment?.status||"não verificado")}>{appInfo?.deployment?.status==="synced"?"✓":appInfo?.deployment?.status==="divergent"?"!":appInfo?.deployment?.status==="unavailable"?"?":appInfo?.deployment?.status==="checking"?"…":""}</i></span>}</span></div>
    {cameraOpen&&<div className="editorModalBackdrop"><div className="editorCamera" role="dialog" aria-modal="true" aria-label="Modo câmera"><header><b>Modo câmera</b><button aria-label="Fechar modo câmera" title="Fechar câmera" onClick={()=>setCameraOpen(false)}><X size={19}/></button></header>{cameraError&&<p role="alert">{cameraError}</p>}<video ref={video} autoPlay playsInline muted onLoadedMetadata={e=>{const v=e.currentTarget;setCameraResolution(v.videoWidth+"×"+v.videoHeight);setCameraReady(v.videoWidth>0&&v.videoHeight>0)}}/><footer><span>{cameraError?cameraError:cameraReady?"Prévia ao vivo"+(cameraResolution?" · "+cameraResolution:""):"Aguardando câmera…"}</span><div className="editorCameraActions"><button type="button" disabled={cameraCapturing} onClick={()=>setCameraFacing(value=>value==="environment"?"user":"environment")}>{cameraFacing==="environment"?"Frontal":"Traseira"}</button><button onClick={capture} disabled={!!cameraError||!cameraReady||cameraCapturing}><Camera size={16}/> {cameraCapturing?"Capturando…":"Capturar imagem"}</button></div></footer></div></div>}
  </section>
}
