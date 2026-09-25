import React,{useEffect,useMemo,useState} from "react";
import{createRoot}from"react-dom/client";
import AnalysisWorkspace from"../src/AnalysisWorkspace.jsx";
import engineCatalog from"../src/engines.json";
import"../src/styles.css";

const svg='<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#c9d7dc"/><rect x="40" y="30" width="240" height="120" rx="8" fill="#71858d"/><path d="M70 120 L150 70 L240 125" stroke="#ffffff" stroke-width="5" fill="none"/></svg>';
const file=new File([svg],"viewer-smoke.svg",{type:"image/svg+xml"});
const t0Svg='<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#d8c7b8"/><circle cx="160" cy="90" r="60" fill="#7b6655"/></svg>';
const referenceFile=new File([t0Svg],"viewer-smoke-t0.svg",{type:"image/svg+xml"});
const referencePrev="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(t0Svg);
const transparentPng="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9WQAAAABJRU5ErkJggg==";
function setNativeValue(input,value){
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set;
  setter?.call(input,String(value));
  input.dispatchEvent(new Event("input",{bubbles:true}));
  input.dispatchEvent(new Event("change",{bubbles:true}));
}
function canvasTransformValues(element){
  const text=element?.style.transform||"";
  const match=text.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\(([\d.]+)\)/);
  return match?{x:Number(match[1]),y:Number(match[2]),zoom:Number(match[3])}:null;
}

const fakeResult={
  image_width:320,image_height:180,
  results:[{
    engine_id:"cdm_1",name:"CDM-1",status:"ok",latency_ms:12,detections:[],
    overlay_png_base64:transparentPng,
    metrics:{overlay_semantics:"transparent_layers",layers:[{id:"cracks",name:"Fissuras",color:"#e64b4b",count:1,overlay_png_base64:transparentPng},{id:"corrosion_rust",name:"Corrosão",color:"#b66a2a",count:1,overlay_png_base64:transparentPng}],summary:{total_objects:2,crack_count:1,crack_length_total_px:12,spalling_area_px2:0},runtime:"browser-smoke",temporal:{enabled:true,alignment:{accepted:false,dx_px:0,dy_px:0,improvement:0},quality:{status:"pass",validated_for_change_quantification:true,issues:[],warnings:[],metrics:{}},stats:{},layers:[{id:"growth:cracks",name:"Crescimento · Fissuras",color:"#ff8b55",count:1,overlay_png_base64:transparentPng}]}}
  }],
  metadata:{client_elapsed_ms:1234}
};

function App(){
  const[result,setResult]=useState("VIEWER_SMOKE_PENDING");
  const[droppedName,setDroppedName]=useState("");
  const[busy,setBusy]=useState(false),[analysisRes,setAnalysisRes]=useState(fakeResult),[runProgress,setRunProgress]=useState(null);
  const selected=useMemo(()=>["cdm_1"],[]);
  const selectedEngineLabels=useMemo(()=>{
    const all=engineCatalog.engines.map(engine=>({id:engine.id,name:engine.name,browser_ready:!!engine.browser_ready}));
    const cdm=all.find(engine=>engine.id==="cdm_1");
    return cdm?[cdm,...all.filter(engine=>engine.id!=="cdm_1")]:all;
  },[]);
  useEffect(()=>{
    let cancelled=false;
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    (async()=>{
      for(let i=0;i<30&&!cancelled;i++){
        const img=document.querySelector(".editorBaseImage");
        const pane=document.querySelector(".editorImagePane");
        const status=document.querySelector(".editorStatusMessage");
        if(img&&pane&&status?.textContent?.includes("Imagem carregada")&&img.naturalWidth===320&&img.naturalHeight===180){
          const initialImageNoticeOk=status.textContent.includes("viewer-smoke.svg")&&status.textContent.includes("320×180");
          await sleep(1900);
          const imageNoticeCleared=!document.querySelector(".editorStatusMessage")?.textContent?.includes("Imagem carregada");
          const devStamp=document.querySelector(".editorDevStamp");
          const deployState=document.querySelector(".editorDeployState");
          const updateButton=document.querySelector(".editorUpdateAvailable");
          const statusBar=document.querySelector(".editorStatus");
          const statusMeta=document.querySelector(".editorStatusMeta");
          const devStampOk=devStamp?.textContent.replace(/\s+/g," ").trim()==="DEV · abc12345 !"&&devStamp?.classList.contains("divergent")&&devStamp?.title.includes("catálogo v1.2.0")&&devStamp?.title.includes("deploy divergent")&&deployState?.getAttribute("aria-label")==="Deploy divergent"&&!statusBar?.textContent?.includes("CDM-1");
          const staleUpdateVisible=!!updateButton&&updateButton.textContent.includes("Atualizar");
          const statusBarFit=!!statusBar&&!!statusMeta&&statusBar.scrollWidth<=statusBar.clientWidth+1&&statusMeta.scrollWidth<=statusMeta.clientWidth+1;
          let runTimeRow=document.querySelector(".editorRunTime");
          if(!runTimeRow){
            document.querySelector(".editorResultsTab")?.click();
            await sleep(50);
            runTimeRow=document.querySelector(".editorRunTime");
          }
          const measuredRuntimeOk=runTimeRow?.querySelector(".editorMetricLabel")?.textContent.trim()==="Tempo da análise"&&runTimeRow?.querySelector(".editorMetricValue")?.textContent.trim()==="1.23 s";
          const dropViewport=document.querySelector(".editorViewport");
          const dt=new DataTransfer();
          dt.items.add(new File([svg],"drag-smoke.svg",{type:"image/svg+xml"}));
          dropViewport?.dispatchEvent(new DragEvent("dragenter",{bubbles:true,cancelable:true,dataTransfer:dt}));
          await sleep(30);
          const dragOverlayVisible=!!document.querySelector(".editorDropOverlay")&&dropViewport?.classList.contains("fileDragActive");
          dropViewport?.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:dt}));
          await sleep(40);
          const dragDropOk=dragOverlayVisible&&!document.querySelector(".editorDropOverlay")&&!dropViewport?.classList.contains("fileDragActive")&&document.querySelector("#drop-received")?.textContent==="drag-smoke.svg";
          const narrowSidebar=window.matchMedia("(max-width: 900px)").matches;
          const mobileInitialLayersCollapsedOk=!narrowSidebar||!document.querySelector(".editorLayers");
          const savedInitialPrefs=JSON.parse(localStorage.getItem("shm.viewer.preferences.v1")||"{}");
          const desktopLayerPreferencePreserved=!narrowSidebar||savedInitialPrefs.layersOpen===true;
          let compactDrawerDismissOk=true;
          if(narrowSidebar){
            const layersToggle=document.querySelector('button[aria-label="Mostrar ou ocultar painel de camadas"]');
            layersToggle?.click();
            await sleep(60);
            const scrim=document.querySelector(".editorLayersScrim");
            const scrimVisible=!!scrim&&getComputedStyle(scrim).display!=="none";
            scrim?.click();
            await sleep(40);
            const scrimClosed=!document.querySelector(".editorLayers");
            layersToggle?.click();
            await sleep(40);
            window.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"Escape"}));
            await sleep(40);
            const escapeClosed=!document.querySelector(".editorLayers");
            layersToggle?.click();
            await sleep(60);
            compactDrawerDismissOk=scrimVisible&&scrimClosed&&escapeClosed&&!!document.querySelector(".editorLayers");
          }
          const sidebarEngines=document.querySelector(".editorSidebarEngines");
          const engineStatusPersistent=!!sidebarEngines&&sidebarEngines.textContent.includes("CDM-1")&&!document.querySelector(".editorStatusEngines");
          const engineNodes=[...document.querySelectorAll(".editorSidebarEngineName")];
          const engineNames=engineNodes.map(node=>node.textContent.trim());
          const visibleEngineNames=engineNodes.filter(node=>getComputedStyle(node).display!=="none").map(node=>node.textContent.trim());
          const expectedEngineCount=engineCatalog.engines.length;
          const engineOverflow=document.querySelector(".editorSidebarEngineOverflow");
          const shortViewport=window.innerHeight<=620;
          const compactUltraEngineFooter=expectedEngineCount>=24&&window.innerHeight<=820;
          const engineFooterCollapsed=shortViewport||compactUltraEngineFooter;
          const engineFooterVisibilityOk=engineFooterCollapsed
            ?visibleEngineNames.length===Math.min(12,expectedEngineCount)&&getComputedStyle(engineOverflow).display!=="none"
            :visibleEngineNames.length===expectedEngineCount&&getComputedStyle(engineOverflow).display==="none";
          const engineNameFontMin=compactUltraEngineFooter?4.5:5.5;
          const multiEngineFooterOk=document.querySelector(".editorLayers")?.dataset.engineCount===String(expectedEngineCount)&&engineNames.length===expectedEngineCount&&engineNames[0]==="CDM-1"&&engineOverflow?.textContent.trim()==="+22 motores"&&engineFooterVisibilityOk&&sidebarEngines?.title.includes("FastFlow")&&getComputedStyle(document.querySelector(".editorSidebarEngineList")).overflow==="hidden"&&document.querySelector(".editorLayers")?.classList.contains("engineDensityUltra")&&parseFloat(getComputedStyle(document.querySelector(".editorSidebarEngineName")).fontSize)>=engineNameFontMin;
          const sidebarStyle=getComputedStyle(document.querySelector(".editorLayers"));
          const sidebarResizeStyle=getComputedStyle(document.querySelector(".editorLayerResizeHandle"));
          const phoneSidebar=window.matchMedia("(max-width: 560px)").matches;
          const tinyPhone=window.matchMedia("(max-width: 340px)").matches;
          const compactOverlay=window.matchMedia("(max-width: 740px)").matches;
          const sidebarRect=document.querySelector(".editorLayers")?.getBoundingClientRect();
          const sidebarFixedOk=sidebarStyle.overflow==="hidden"&&sidebarStyle.overscrollBehavior==="none"&&(narrowSidebar?sidebarStyle.position==="absolute":sidebarStyle.position==="sticky");
          const expectedSidebarLeft=tinyPhone?50:56;
          const mobileSidebarOk=!narrowSidebar||(sidebarResizeStyle.display==="none"&&Math.abs((sidebarRect?.left||0)-expectedSidebarLeft)<2&&(!phoneSidebar||(sidebarRect?.width||0)<=240));
          const topBar=document.querySelector(".editorTop");
          const topActions=document.querySelector(".editorTopActions");
          const brand=document.querySelector(".editorBrand");
          const topRect=topBar?.getBoundingClientRect();
          const actionsRect=topActions?.getBoundingClientRect();
          const brandRect=brand?.getBoundingClientRect();
          const topButtons=[...document.querySelectorAll(".editorTopActions button")];
          const topActionsFit=!!topRect&&!!actionsRect&&!!brandRect&&actionsRect.right<=topRect.right+1&&brandRect.left>=topRect.left-1&&topButtons.every(button=>{const r=button.getBoundingClientRect();return r.left>=topRect.left-1&&r.right<=topRect.right+1})&&topBar.scrollWidth<=topBar.clientWidth+1;
          const brandTitle=document.querySelector(".editorBrand strong");
          const brandTitleStyle=brandTitle?getComputedStyle(brandTitle):null;
          const expectedTopButtonWidth=tinyPhone?30:32;
          const phoneTopCompactOk=!phoneSidebar||(brandTitleStyle?.display!=="none"&&brandTitle?.textContent.trim()==="SHM Studio"&&topButtons.every(button=>Math.abs(button.getBoundingClientRect().width-expectedTopButtonWidth)<1));
          const zoomControl=document.querySelector(".editorZoom");
          const zoomRect=zoomControl?.getBoundingClientRect();
          const cameraRect=document.querySelector(".editorCameraEntry")?.getBoundingClientRect();
          const typeRect=document.querySelector(".editorTypeBadge")?.getBoundingClientRect();
          const editorViewportRect=document.querySelector(".editorViewport")?.getBoundingClientRect();
          const phoneZoomCompactOk=!phoneSidebar||(!!zoomRect&&zoomRect.height<=42&&zoomRect.width<=140);
          const phoneFloatingControlsOk=!phoneSidebar||(
            !!cameraRect&&!!typeRect&&!!zoomRect&&!!editorViewportRect&&
            typeRect.right<=cameraRect.left-4&&
            zoomRect.left>=editorViewportRect.left-1&&zoomRect.right<=editorViewportRect.right+1&&
            zoomRect.bottom<=editorViewportRect.bottom+1
          );
          const responsiveDiag=`iw=${window.innerWidth},narrow=${narrowSidebar},phone=${phoneSidebar},tiny=${tinyPhone},compact=${compactOverlay},sidebar=${sidebarRect?Math.round(sidebarRect.left)+"/"+Math.round(sidebarRect.width):"none"},resize=${sidebarResizeStyle.display},brand=${brandTitleStyle?.display||"missing"},brandText=${brandTitle?.textContent.trim()||"missing"},zoom=${zoomRect?Math.round(zoomRect.width)+"x"+Math.round(zoomRect.height):"missing"},camera=${cameraRect?Math.round(cameraRect.left)+"/"+Math.round(cameraRect.right):"missing"},type=${typeRect?Math.round(typeRect.left)+"/"+Math.round(typeRect.right):"missing"},buttons=${topButtons.map(button=>Math.round(button.getBoundingClientRect().width)).join("/")}`;
          const editorRect=document.querySelector(".analysisEditor")?.getBoundingClientRect();
          const statusRect=document.querySelector(".editorStatus")?.getBoundingClientRect();
          const viewportLockOk=!!editorRect&&!!statusRect&&editorRect.top>=-1&&editorRect.bottom<=window.innerHeight+1&&statusRect.bottom<=window.innerHeight+1&&document.documentElement.scrollHeight<=window.innerHeight+1;
          const resultsPanel=document.querySelector(".editorFloating");
          const compactOverlayArbitrationInitial=!compactOverlay||getComputedStyle(resultsPanel).visibility==="hidden";
          const rect=pane.getBoundingClientRect();
          if(rect.width>100&&rect.height>80){
            const stack=document.querySelector(".editorOverlayStack");
            const stackRect=stack?.getBoundingClientRect();
            const overlayGeometryOk=!!stackRect&&Math.abs(stackRect.width-rect.width)<1&&Math.abs(stackRect.height-rect.height)<1;
            const engineStatusOk=!!document.querySelector(".editorSidebarEngines")?.textContent?.includes("CDM-1")&&!document.querySelector(".editorStatusEngines");
            const pathologyGroup=document.querySelector(".pathologyLayerGroup");
            const pathologyInitialStateOk=!!pathologyGroup&&(window.innerHeight<620?!pathologyGroup.open:pathologyGroup.open);
            if(pathologyGroup&&!pathologyGroup.open){
              pathologyGroup.querySelector("summary")?.click();
              await sleep(40);
            }
            const pathologyGroupInteractiveOk=!!pathologyGroup?.open&&!!document.querySelector(".layerInspector");
            const hideAll=[...document.querySelectorAll(".pathologyLayerGroup .layerGroupActions button")].find(b=>b.textContent.trim()==="Ocultar todas");
            const showAll=[...document.querySelectorAll(".pathologyLayerGroup .layerGroupActions button")].find(b=>b.textContent.trim()==="Mostrar todas");
            const layerBefore=document.querySelectorAll(".pathologyOverlay:not(.temporalOverlay)").length;
            hideAll?.click();
            await sleep(40);
            const layerHidden=document.querySelectorAll(".pathologyOverlay:not(.temporalOverlay)").length===0;
            showAll?.click();
            await sleep(40);
            const layerRestored=document.querySelectorAll(".pathologyOverlay:not(.temporalOverlay)").length===2;
            const solo=[...document.querySelectorAll(".pathologyLayer .layerSolo")][0];
            solo?.click();
            await sleep(40);
            const layerSoloOk=document.querySelectorAll(".pathologyOverlay:not(.temporalOverlay)").length===1;
            showAll?.click();
            await sleep(40);
            const orderBefore=[...document.querySelectorAll(".pathologyOverlay:not(.temporalOverlay)")].map(img=>img.alt).join(">");
            const moveDown=[...document.querySelectorAll(".layerOrderControls button")].find(b=>b.title==="Descer Fissuras");
            moveDown?.click();
            await sleep(40);
            const orderAfter=[...document.querySelectorAll(".pathologyOverlay:not(.temporalOverlay)")].map(img=>img.alt).join(">");
            const layerOrderOk=orderBefore==="Corrosão>Fissuras"&&orderAfter==="Fissuras>Corrosão";
            const layerOpacityInput=[...document.querySelectorAll('.layerInspector input[type="range"]')][0];
            setNativeValue(layerOpacityInput,.4);
            await sleep(60);
            const selectedLayer=document.querySelector('.pathologyOverlay[data-layer-id="cracks"]');
            const layerOpacityOk=!!selectedLayer&&Math.abs(Number(selectedLayer.style.opacity)-0.3)<0.01;
            const lockToggle=[...document.querySelectorAll(".layerInspectorActions button")].find(b=>b.textContent.includes("Bloquear"));
            lockToggle?.click();
            await sleep(40);
            const lockedInput=[...document.querySelectorAll('.layerInspector input[type="range"]')][0];
            const lockIcon=document.querySelector(".layerLockState");
            const lockedMove=[...document.querySelectorAll(".layerOrderControls button")].find(b=>b.title==="Subir Fissuras");
            const lockStateOk=!!lockIcon&&lockedInput?.disabled===true&&lockedMove?.disabled===true;
            setNativeValue(lockedInput,.9);
            await sleep(40);
            const lockedOpacityStable=Math.abs(Number(document.querySelector('.pathologyOverlay[data-layer-id="cracks"]')?.style.opacity)-0.3)<0.01;
            const cracksRow=[...document.querySelectorAll(".pathologyLayer")].find(row=>row.textContent.includes("Fissuras"));
            const cracksCheckbox=cracksRow?.querySelector('input[type="checkbox"]');
            cracksCheckbox?.click();
            await sleep(40);
            const lockedVisibilityStillEditable=document.querySelectorAll('.pathologyOverlay[data-layer-id="cracks"]').length===0;
            cracksCheckbox?.click();
            await sleep(40);
            const noFloatingLayersButton=!document.querySelector(".editorExpand");
            const layersPanel=document.querySelector(".editorLayers");
            const layersResize=document.querySelector(".editorLayerResizeHandle");
            const pathologyName=document.querySelector(".pathologyName");
            const referenceText=document.querySelector(".referenceLayer>span:nth-child(2)");
            const layerResizeOk=!!layersPanel&&!!layersResize&&(narrowSidebar?getComputedStyle(layersResize).display==="none":getComputedStyle(layersResize).cursor==="col-resize"&&layersPanel.getBoundingClientRect().width>=340);
            let layerWidthPersistenceOk=true;
            if(!narrowSidebar&&layersPanel&&layersResize){
              const beforeWidth=Math.round(layersPanel.getBoundingClientRect().width);
              const handleRect=layersResize.getBoundingClientRect();
              const startX=handleRect.left+Math.max(1,handleRect.width/2);
              layersResize.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,pointerId:71,pointerType:"pen",isPrimary:true,button:0,buttons:1,clientX:startX,clientY:handleRect.top+10}));
              window.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,pointerId:72,pointerType:"pen",isPrimary:true,button:0,buttons:1,clientX:startX+120,clientY:handleRect.top+10}));
              await sleep(20);
              const foreignPointerIgnored=Math.round(layersPanel.getBoundingClientRect().width)===beforeWidth;
              window.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,pointerId:71,pointerType:"pen",isPrimary:true,button:0,buttons:1,clientX:startX+40,clientY:handleRect.top+10}));
              window.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,pointerId:71,pointerType:"pen",isPrimary:true,button:0,buttons:0,clientX:startX+40,clientY:handleRect.top+10}));
              await sleep(80);
              const afterWidth=Math.round(layersPanel.getBoundingClientRect().width);
              const layerPrefs=JSON.parse(localStorage.getItem("shm.viewer.preferences.v1")||"{}");
              const pointerPersisted=foreignPointerIgnored&&afterWidth===Math.min(600,Math.max(340,beforeWidth+40))&&layerPrefs.layersWidth===afterWidth&&layersPanel.dataset.layerWidth===String(afterWidth);
              layersResize.focus();
              layersResize.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"End"}));
              await sleep(50);
              const endOk=Math.round(layersPanel.getBoundingClientRect().width)===600&&layersResize.getAttribute("aria-valuenow")==="600";
              layersResize.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"Home"}));
              await sleep(50);
              const homeOk=Math.round(layersPanel.getBoundingClientRect().width)===340&&layersResize.getAttribute("aria-valuenow")==="340";
              layersResize.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"ArrowRight"}));
              await sleep(50);
              const keyPrefs=JSON.parse(localStorage.getItem("shm.viewer.preferences.v1")||"{}");
              const arrowOk=Math.round(layersPanel.getBoundingClientRect().width)===360&&layersResize.getAttribute("aria-valuenow")==="360"&&keyPrefs.layersWidth===360;
              const cancelStart=Math.round(layersPanel.getBoundingClientRect().width);
              const cancelRect=layersResize.getBoundingClientRect();
              const cancelX=cancelRect.left+Math.max(1,cancelRect.width/2);
              layersResize.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,pointerId:73,pointerType:"pen",isPrimary:true,button:0,buttons:1,clientX:cancelX,clientY:cancelRect.top+10}));
              window.dispatchEvent(new PointerEvent("pointercancel",{bubbles:true,pointerId:73,pointerType:"pen",isPrimary:true,button:0,buttons:0,clientX:cancelX,clientY:cancelRect.top+10}));
              window.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,pointerId:73,pointerType:"pen",isPrimary:true,button:0,buttons:1,clientX:cancelX+100,clientY:cancelRect.top+10}));
              await sleep(30);
              const pointerCancelReleased=Math.round(layersPanel.getBoundingClientRect().width)===cancelStart;
              layerWidthPersistenceOk=pointerPersisted&&pointerCancelReleased&&endOk&&homeOk&&arrowOk&&layersResize.tabIndex===0&&layersResize.getAttribute("aria-valuemin")==="340"&&layersResize.getAttribute("aria-valuemax")==="600";
            }else if(narrowSidebar&&layersPanel){
              const responsiveWidth=layersPanel.getBoundingClientRect().width;
              const stored=JSON.parse(localStorage.getItem("shm.viewer.preferences.v1")||"{}").layersWidth;
              layerWidthPersistenceOk=responsiveWidth<=300&&stored===360;
            }
            const layerNoWrapOk=getComputedStyle(pathologyName).whiteSpace==="nowrap"&&getComputedStyle(referenceText).whiteSpace==="nowrap";
            const selectedLayerRow=document.querySelector(".pathologyLayer.selected");
            const selectedSolo=selectedLayerRow?.querySelector(".layerSolo");
            const selectedOrder=selectedLayerRow?.querySelector(".layerOrderControls");
            const selectedActionsVisible=!!selectedSolo&&!!selectedOrder&&getComputedStyle(selectedSolo).opacity==="1"&&getComputedStyle(selectedOrder).opacity==="1";
            const sidebarFooter=document.querySelector(".editorSidebarEngines");
            const viewerReset=document.querySelector(".viewerReset");
            const sidebarContentFits=!!layersPanel&&!!sidebarFooter&&!!viewerReset&&viewerReset.getBoundingClientRect().bottom<=sidebarFooter.getBoundingClientRect().top+1;
            const zoomPlus=[...document.querySelectorAll("button")].find(b=>b.getAttribute("aria-label")==="Ampliar zoom");
            zoomPlus?.click();
            await sleep(40);
            const zoomBefore=[...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim();
            const canvas=document.querySelector(".editorImage");
            canvas?.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,pointerId:91,pointerType:"mouse",isPrimary:true,button:1,buttons:4,clientX:100,clientY:100}));
            canvas?.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,pointerId:92,pointerType:"mouse",isPrimary:true,button:0,buttons:4,clientX:180,clientY:160}));
            await sleep(20);
            const foreignPanIgnored=(canvas?.style.transform||"").includes("translate(0px, 0px)");
            canvas?.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,pointerId:91,pointerType:"mouse",isPrimary:true,button:0,buttons:4,clientX:145,clientY:128}));
            canvas?.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,pointerId:91,pointerType:"mouse",isPrimary:true,button:1,buttons:0,clientX:145,clientY:128}));
            await sleep(40);
            const panTransform=canvas?.style.transform||"";
            const matchingPanOk=panTransform.includes("translate(45px, 28px)")&&panTransform.includes("scale(1.25)");
            canvas?.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,pointerId:93,pointerType:"mouse",isPrimary:true,button:1,buttons:4,clientX:145,clientY:128}));
            canvas?.dispatchEvent(new PointerEvent("pointercancel",{bubbles:true,pointerId:93,pointerType:"mouse",isPrimary:true,button:1,buttons:0,clientX:145,clientY:128}));
            canvas?.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,pointerId:93,pointerType:"mouse",isPrimary:true,button:0,buttons:4,clientX:200,clientY:200}));
            await sleep(20);
            const panCancelReleased=(canvas?.style.transform||"")===panTransform;
            const panOk=foreignPanIgnored&&matchingPanOk&&panCancelReleased;
            const fitButton=[...document.querySelectorAll("button")].find(b=>b.getAttribute("aria-label")==="Ajustar à tela");
            fitButton?.click();
            await sleep(60);
            const zoomAfterFit=[...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim();
            const fitPaneRect=document.querySelector(".editorImagePane")?.getBoundingClientRect();
            const fitCanvasRect=document.querySelector(".editorImage")?.getBoundingClientRect();
            const fitViewportRect=document.querySelector(".editorViewport")?.getBoundingClientRect();
            const fitTransform=document.querySelector(".editorImage")?.style.transform||"";
            const fitButtonOk=zoomAfterFit==="100%"&&fitTransform.includes("translate(0px, 0px)")&&fitTransform.includes("scale(1)")&&!!fitPaneRect&&fitPaneRect.width>100&&fitPaneRect.height>80;
            const phoneFitWithinViewportOk=!phoneSidebar||(!!fitCanvasRect&&!!fitViewportRect&&fitCanvasRect.left>=fitViewportRect.left-1&&fitCanvasRect.right<=fitViewportRect.right+1&&fitCanvasRect.top>=fitViewportRect.top-1&&fitCanvasRect.bottom<=fitViewportRect.bottom+1);
            let spaceDragPanOk=true;
            if(!phoneSidebar&&canvas){
              canvas.focus();
              const beforePrimary=canvas.style.transform||"";
              canvas.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,pointerId:101,pointerType:"mouse",isPrimary:true,button:0,buttons:1,clientX:120,clientY:120}));
              canvas.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,pointerId:101,pointerType:"mouse",isPrimary:true,button:0,buttons:1,clientX:156,clientY:144}));
              canvas.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,pointerId:101,pointerType:"mouse",isPrimary:true,button:0,buttons:0,clientX:156,clientY:144}));
              await sleep(20);
              const primaryWithoutSpaceIgnored=(canvas.style.transform||"")===beforePrimary;

              canvas.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:" "}));
              await sleep(10);
              const spaceReady=canvas.dataset.panMode==="ready";
              canvas.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,pointerId:102,pointerType:"mouse",isPrimary:true,button:0,buttons:1,clientX:120,clientY:120}));
              await sleep(10);
              const grabbing=canvas.dataset.panMode==="grabbing";
              canvas.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,pointerId:102,pointerType:"mouse",isPrimary:true,button:0,buttons:1,clientX:156,clientY:144}));
              canvas.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,pointerId:102,pointerType:"mouse",isPrimary:true,button:0,buttons:0,clientX:156,clientY:144}));
              await sleep(30);
              const spacePanTransform=canvasTransformValues(canvas);
              canvas.dispatchEvent(new KeyboardEvent("keyup",{bubbles:true,key:" "}));
              await sleep(10);
              const spaceReleased=canvas.dataset.panMode==="idle";
              canvas.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:" "}));
              await sleep(10);
              const escapeReady=canvas.dataset.panMode==="ready";
              window.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"Escape"}));
              await sleep(20);
              const escapeCancelledSpace=canvas.dataset.panMode==="idle";
              spaceDragPanOk=primaryWithoutSpaceIgnored&&spaceReady&&grabbing&&spaceReleased&&escapeReady&&escapeCancelledSpace&&!!spacePanTransform&&spacePanTransform.x===36&&spacePanTransform.y===24&&spacePanTransform.zoom===1;

              canvas.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"0"}));
              await sleep(30);
            }
            canvas?.focus();
            canvas?.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"ArrowRight"}));
            canvas?.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"ArrowDown"}));
            await sleep(30);
            const keyboardPanTransform=canvas?.style.transform||"";
            const keyboardPanOk=keyboardPanTransform.includes("translate(32px, 32px)")&&canvas?.tabIndex===0&&canvas?.getAttribute("role")==="region";
            canvas?.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"+"}));
            await sleep(30);
            const keyboardZoomInOk=[...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim()==="125%";
            canvas?.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"-"}));
            await sleep(30);
            const keyboardZoomOutOk=[...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim()==="100%";
            canvas?.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"0"}));
            await sleep(40);
            const keyboardResetTransform=canvas?.style.transform||"";
            const canvasKeyboardOk=keyboardPanOk&&keyboardZoomInOk&&keyboardZoomOutOk&&keyboardResetTransform.includes("translate(0px, 0px)")&&keyboardResetTransform.includes("scale(1)")&&canvas?.getAttribute("aria-keyshortcuts")?.includes("ArrowLeft");
            let canvasClampOk=true;
            if(canvas){
              for(let n=0;n<24;n++){
                canvas.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"ArrowRight"}));
                canvas.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"ArrowDown"}));
              }
              await sleep(40);
              const clampViewportRect=canvas.closest(".editorViewport")?.getBoundingClientRect();
              const clampCanvasRect=canvas.getBoundingClientRect();
              const visibleWidth=clampViewportRect?Math.max(0,Math.min(clampViewportRect.right,clampCanvasRect.right)-Math.max(clampViewportRect.left,clampCanvasRect.left)):0;
              const visibleHeight=clampViewportRect?Math.max(0,Math.min(clampViewportRect.bottom,clampCanvasRect.bottom)-Math.max(clampViewportRect.top,clampCanvasRect.top)):0;
              const clampHeld=visibleWidth>=55&&visibleHeight>=55;
              canvas.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"0"}));
              await sleep(30);
              const clampReset=(canvas.style.transform||"").includes("translate(0px, 0px)");
              canvasClampOk=clampHeld&&clampReset;
            }
            let canvasWheelOk=true;
            if(!phoneSidebar&&canvas){
              const wheelViewportRect=canvas.closest(".editorViewport")?.getBoundingClientRect();
              const fitBeforeWheel=canvas.style.transform||"";
              canvas.dispatchEvent(new WheelEvent("wheel",{bubbles:true,cancelable:true,deltaX:0,deltaY:40}));
              await sleep(20);
              const wheelAtFitIgnored=(canvas.style.transform||"")===fitBeforeWheel;
              const wheelAnchorX=wheelViewportRect?(wheelViewportRect.left+wheelViewportRect.right)/2+80:80;
              const wheelAnchorY=wheelViewportRect?(wheelViewportRect.top+wheelViewportRect.bottom)/2+40:40;
              for(let n=0;n<3;n++)canvas.dispatchEvent(new WheelEvent("wheel",{bubbles:true,cancelable:true,ctrlKey:true,deltaX:0,deltaY:-100,clientX:wheelAnchorX,clientY:wheelAnchorY}));
              await sleep(40);
              const wheelZoomTransform=canvasTransformValues(canvas);
              const ctrlWheelZoomOk=[...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim()==="175%"&&!!wheelZoomTransform&&Math.abs(wheelZoomTransform.x+60)<=1&&Math.abs(wheelZoomTransform.y+30)<=1&&Math.abs(wheelZoomTransform.zoom-1.75)<.001;
              canvas.dispatchEvent(new WheelEvent("wheel",{bubbles:true,cancelable:true,deltaX:12,deltaY:18}));
              await sleep(30);
              const wheelPanTransform=canvasTransformValues(canvas);
              const wheelPanOk=!!wheelPanTransform&&Math.abs(wheelPanTransform.x+72)<=1&&Math.abs(wheelPanTransform.y+48)<=1&&Math.abs(wheelPanTransform.zoom-1.75)<.001;
              canvas.focus();
              canvas.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"0"}));
              await sleep(30);
              const wheelReset=canvasTransformValues(canvas);
              const wheelResetOk=!!wheelReset&&wheelReset.x===0&&wheelReset.y===0&&wheelReset.zoom===1&&([...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim()==="100%");
              canvasWheelOk=wheelAtFitIgnored&&ctrlWheelZoomOk&&wheelPanOk&&wheelResetOk;
            }
            let canvasTouchOk=true;
            if(phoneSidebar&&canvas){
              const touchModeFit=canvas.dataset.touchMode==="pinch-scroll";
              canvas.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,pointerId:111,pointerType:"touch",isPrimary:true,button:0,buttons:1,clientX:100,clientY:100}));
              canvas.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,pointerId:112,pointerType:"touch",isPrimary:false,button:0,buttons:1,clientX:200,clientY:100}));
              canvas.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,pointerId:112,pointerType:"touch",isPrimary:false,button:0,buttons:1,clientX:250,clientY:100}));
              await sleep(50);
              const pinchTransform=canvasTransformValues(canvas);
              const touchViewportRect=canvas.closest(".editorViewport")?.getBoundingClientRect();
              const touchCenterX=touchViewportRect?(touchViewportRect.left+touchViewportRect.right)/2:0;
              const touchCenterY=touchViewportRect?(touchViewportRect.top+touchViewportRect.bottom)/2:0;
              const startMid={x:150-touchCenterX,y:100-touchCenterY};
              const endMid={x:175-touchCenterX,y:100-touchCenterY};
              const expectedPinchPan={x:Math.round(endMid.x-1.5*startMid.x),y:Math.round(endMid.y-1.5*startMid.y)};
              const pinchZoomOk=[...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim()==="150%"&&canvas.dataset.touchMode==="pan-pinch"&&!!pinchTransform&&Math.abs(pinchTransform.x-expectedPinchPan.x)<=1&&Math.abs(pinchTransform.y-expectedPinchPan.y)<=1&&Math.abs(pinchTransform.zoom-1.5)<.001;
              canvas.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,pointerId:112,pointerType:"touch",isPrimary:false,button:0,buttons:0,clientX:250,clientY:100}));
              canvas.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,pointerId:111,pointerType:"touch",isPrimary:true,button:0,buttons:1,clientX:130,clientY:125}));
              await sleep(40);
              const touchPanTransform=canvasTransformValues(canvas);
              const touchPanOk=!!touchPanTransform&&Math.abs(touchPanTransform.x-(expectedPinchPan.x+30))<=1&&Math.abs(touchPanTransform.y-(expectedPinchPan.y+25))<=1&&Math.abs(touchPanTransform.zoom-1.5)<.001;
              canvas.dispatchEvent(new PointerEvent("pointercancel",{bubbles:true,pointerId:111,pointerType:"touch",isPrimary:true,button:0,buttons:0,clientX:130,clientY:125}));
              const cancelledTransform=canvas.style.transform||"";
              canvas.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,pointerId:111,pointerType:"touch",isPrimary:true,button:0,buttons:1,clientX:180,clientY:170}));
              await sleep(20);
              const touchCancelOk=(canvas.style.transform||"")===cancelledTransform;
              canvas.focus();
              canvas.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"0"}));
              await sleep(40);
              const touchResetOk=canvas.dataset.touchMode==="pinch-scroll"&&(canvas.style.transform||"").includes("translate(0px, 0px)")&&([...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim()==="100%");
              canvasTouchOk=touchModeFit&&pinchZoomOk&&touchPanOk&&touchCancelOk&&touchResetOk;
            }
            zoomPlus?.click();
            await sleep(40);
            const zoomBeforeSide=[...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim();
            const side=document.querySelector('button[aria-label="Lado a lado"]');
            side?.click();
            await sleep(80);
            const panes=[...document.querySelectorAll(".editorImagePane")];
            const images=[...document.querySelectorAll(".editorBaseImage")];
            const sideOk=panes.length===2&&images.length===2&&panes.every(p=>{const r=p.getBoundingClientRect();return r.width>80&&r.height>80});
            const sideCanvasRect=document.querySelector(".editorImage")?.getBoundingClientRect();
            const sideViewportRect=document.querySelector(".editorViewport")?.getBoundingClientRect();
            const sideWithinViewportOk=!phoneSidebar||(!!sideCanvasRect&&!!sideViewportRect&&sideCanvasRect.left>=sideViewportRect.left-1&&sideCanvasRect.right<=sideViewportRect.right+1&&sideCanvasRect.top>=sideViewportRect.top-1&&sideCanvasRect.bottom<=sideViewportRect.bottom+1);
            const sideDiag=sideCanvasRect&&sideViewportRect?`side(canvas=${Math.round(sideCanvasRect.left)}/${Math.round(sideCanvasRect.top)}/${Math.round(sideCanvasRect.right)}/${Math.round(sideCanvasRect.bottom)},viewport=${Math.round(sideViewportRect.left)}/${Math.round(sideViewportRect.top)}/${Math.round(sideViewportRect.right)}/${Math.round(sideViewportRect.bottom)},transform=${document.querySelector(".editorImage")?.style.transform||"none"})`:"side(no-rect)";
            const zoomAfterSide=[...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim();
            const overlay=document.querySelector('button[aria-label="Sobrepor"]');
            overlay?.click();
            await sleep(80);
            const overlayPanes=document.querySelectorAll(".editorImagePane").length;
            const overlayImages=document.querySelectorAll(".editorBaseImage").length;
            const overlayStacks=document.querySelectorAll(".editorOverlayStack").length;
            const zoomAfterOverlay=[...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim();
            const iconActionsOk=["Original","Sobrepor","Deslizar","Lado a lado"].every(label=>{
              const button=document.querySelector('button[aria-label="'+label+'"]');
              return !!button&&!!button.querySelector("svg")&&button.getAttribute("title")===label&&button.getAttribute("data-tooltip")===label;
            });
            const exportSummary=document.querySelector('.editorExportUnified summary[aria-label="Exportar"]');
            exportSummary?.click();
            await sleep(40);
            const exportLabels=[...document.querySelectorAll(".editorExportUnified>div button")].map(b=>b.textContent.trim());
            const exportDetails=document.querySelector(".editorExportUnified");
            const exportOpenBeforeEscape=!!exportDetails?.open;
            window.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"Escape"}));
            await sleep(20);
            const exportEscapeOk=exportOpenBeforeEscape&&!exportDetails?.open;
            const unifiedExportOk=!!exportSummary&&exportSummary.getAttribute("data-tooltip")==="Exportar"&&!!exportSummary.querySelector("svg")&&exportLabels.includes("JSON")&&exportLabels.includes("CSV")&&exportLabels.includes("SVG camadas")&&exportLabels.includes("CSV técnico")&&exportLabels.includes("COCO")&&exportLabels.includes("DXF")&&exportLabels.includes("BIM JSON")&&exportLabels.includes("IFC")&&exportLabels.includes("HTML")&&!document.querySelector(".editorCdmExports");
            const wipe=document.querySelector('button[aria-label="Deslizar"]');
            wipe?.click();
            await sleep(80);
            const wipePane=document.querySelector(".editorWipePane");
            const wipeStack=document.querySelector(".editorWipePane .editorOverlayStack");
            const wipeDivider=document.querySelector(".editorWipeDivider");
            const wipeHandle=document.querySelector(".editorWipeHandle");
            const wipeInitialOk=!!wipePane&&!!wipeStack&&!!wipeDivider&&!!wipeHandle&&wipeHandle.getAttribute("role")==="slider"&&wipeHandle.getAttribute("aria-valuemin")==="5"&&wipeHandle.getAttribute("aria-valuemax")==="95"&&wipeHandle.getAttribute("aria-valuenow")==="50"&&!document.querySelector(".editorWipeControl")&&document.querySelectorAll(".editorImagePane").length===1&&document.querySelectorAll(".editorBaseImage").length===1;
            for(let n=0;n<9;n++)wipeHandle?.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"ArrowRight"}));
            await sleep(90);
            const wipePct=parseFloat(document.querySelector(".editorWipeDivider")?.style.left||"0");
            const wipeMovedOk=Math.abs(wipePct-68)<.6&&wipeHandle?.getAttribute("aria-valuenow")==="68"&&wipeHandle?.getAttribute("aria-valuetext")==="68%"&&document.querySelector(".editorWipePane .editorOverlayStack")?.style.clipPath?.includes(wipePct.toFixed(0)+"%");
            const wipeDirectionOk=!!document.querySelector(".editorWipeHandle .wipeArrowIcon.right.active")&&!document.querySelector(".editorWipeHandle .wipeArrowIcon.left.active");
            const zoomAfterWipe=[...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim();
            const wipeStatusOk=document.querySelector(".editorStatusMeta")?.textContent?.includes("divisor 68%");
            const temporal=[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="t0 / t1");
            temporal?.click();
            await sleep(80);
            const temporalPanes=[...document.querySelectorAll(".editorImagePane")];
            const temporalBadges=[...document.querySelectorAll(".editorPaneBadge")].map(x=>x.textContent.trim());
            const temporalStacks=document.querySelectorAll(".editorOverlayStack").length;
            const temporalOk=temporalPanes.length===2&&temporalPanes.every(p=>{const r=p.getBoundingClientRect();return r.width>80&&r.height>80})&&temporalBadges.some(x=>x.startsWith("t0"))&&temporalBadges.some(x=>x.startsWith("t1"))&&temporalStacks===1;
            const temporalCanvasRect=document.querySelector(".editorImage")?.getBoundingClientRect();
            const temporalViewportRect=document.querySelector(".editorViewport")?.getBoundingClientRect();
            const temporalWithinViewportOk=!phoneSidebar||(!!temporalCanvasRect&&!!temporalViewportRect&&temporalCanvasRect.left>=temporalViewportRect.left-1&&temporalCanvasRect.right<=temporalViewportRect.right+1&&temporalCanvasRect.top>=temporalViewportRect.top-1&&temporalCanvasRect.bottom<=temporalViewportRect.bottom+1);
            const zoomAfterTemporal=[...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim();
            const original=document.querySelector('button[aria-label="Original"]');
            original?.click();
            await sleep(80);
            const originalPanes=document.querySelectorAll(".editorImagePane").length;
            const originalImages=document.querySelectorAll(".editorBaseImage").length;
            const originalStacks=document.querySelectorAll(".editorOverlayStack").length;
            const zoomAfterOriginal=[...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim();
            let reset=document.querySelector(".viewerReset");
            if(!reset&&compactOverlay){
              const layersToggleForReset=[...document.querySelectorAll(".editorTools button")].find(button=>button.title==="Mostrar ou ocultar camadas");
              layersToggleForReset?.click();
              await sleep(50);
              reset=document.querySelector(".viewerReset");
            }
            reset?.click();
            await sleep(80);
            const resetMode=document.querySelector(".editorViewActions button.active")?.getAttribute("aria-label")||document.querySelector(".editorViewActions button.active")?.textContent?.trim();
            const resetLayers=document.querySelectorAll(".pathologyOverlay:not(.temporalOverlay)").length;
            const resetOrder=[...document.querySelectorAll(".pathologyOverlay:not(.temporalOverlay)")].map(img=>img.alt).join(">");
            const resetZoom=[...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim();
            const resetOpacity=document.querySelector('.pathologyOverlay[data-layer-id="cracks"]')?.style.opacity;
            const resetLock=document.querySelector(".layerLockState");
            const resetLockButton=[...document.querySelectorAll(".layerInspectorActions button")].find(b=>b.textContent.includes("Bloquear"));
            const savedPrefs=JSON.parse(localStorage.getItem("shm.viewer.preferences.v1")||"{}");
            const resetDrawerOk=!compactOverlay||!document.querySelector(".editorLayers");
            const resetLockControlOk=compactOverlay
              ?Array.isArray(savedPrefs.pathologyLocked)&&savedPrefs.pathologyLocked.length===0
              :!resetLock&&!!resetLockButton;
            const resetPositionOk=compactOverlay
              ?Number.isFinite(Number(savedPrefs.resultPanelPosition?.x))&&Number.isFinite(Number(savedPrefs.resultPanelPosition?.y))
              :savedPrefs.resultPanelPosition?.x===0&&savedPrefs.resultPanelPosition?.y===0;
            const resetOk=resetMode==="Sobrepor"&&resetLayers===2&&resetOrder==="Corrosão>Fissuras"&&resetZoom==="100%"&&Math.abs(Number(resetOpacity)-0.75)<0.01&&resetLockControlOk&&resetDrawerOk&&savedPrefs.wipePosition===50&&savedPrefs.layersWidth===360&&savedPrefs.resultPanelOpen===true&&resetPositionOk&&savedPrefs.resultPanelSize?.width===360&&savedPrefs.resultPanelSize?.height===null;
            const resetDiag=`reset(mode=${resetMode||"none"},layers=${resetLayers},order=${resetOrder||"none"},zoom=${resetZoom||"none"},opacity=${resetOpacity||"none"},lock=${resetLockControlOk},drawer=${resetDrawerOk},wipe=${savedPrefs.wipePosition},lw=${savedPrefs.layersWidth},ropen=${savedPrefs.resultPanelOpen},rpos=${savedPrefs.resultPanelPosition?.x}/${savedPrefs.resultPanelPosition?.y},rsize=${savedPrefs.resultPanelSize?.width}/${savedPrefs.resultPanelSize?.height})`;
            let compactOverlayArbitrationToggle=true;
            if(compactOverlay){
              const layersToggle=[...document.querySelectorAll(".editorTools button")].find(button=>button.title==="Mostrar ou ocultar camadas");
              const floatingAfterReset=document.querySelector(".editorFloating");
              const resetShowsResults=!document.querySelector(".editorLayers")&&!!floatingAfterReset&&getComputedStyle(floatingAfterReset).visibility==="visible"&&getComputedStyle(floatingAfterReset).pointerEvents!=="none";
              layersToggle?.click();
              await sleep(50);
              const floatingWithLayers=document.querySelector(".editorFloating");
              const openHidesResults=!!document.querySelector(".editorLayers")&&!!floatingWithLayers&&getComputedStyle(floatingWithLayers).visibility==="hidden"&&getComputedStyle(floatingWithLayers).pointerEvents==="none";
              layersToggle?.click();
              await sleep(50);
              const floatingAfterLayersClose=document.querySelector(".editorFloating");
              const closeRestoresResults=!document.querySelector(".editorLayers")&&!!floatingAfterLayersClose&&getComputedStyle(floatingAfterLayersClose).visibility==="visible"&&getComputedStyle(floatingAfterLayersClose).pointerEvents!=="none";
              compactOverlayArbitrationToggle=resetShowsResults&&openHidesResults&&closeRestoresResults;
            }
            const floatingPanel=document.querySelector(".editorFloating");
            const floatingHead=floatingPanel?.querySelector(".editorFloatMoveHandle");
            const viewport=document.querySelector(".editorViewport");
            const viewportRect=viewport?.getBoundingClientRect();
            const floatingRect=floatingPanel?.getBoundingClientRect();
            const floatingClampDiag=viewportRect&&floatingRect?`vp=${Math.round(viewportRect.left)}/${Math.round(viewportRect.top)}/${Math.round(viewportRect.right)}/${Math.round(viewportRect.bottom)} panel=${Math.round(floatingRect.left)}/${Math.round(floatingRect.top)}/${Math.round(floatingRect.right)}/${Math.round(floatingRect.bottom)}`:"no-rect";
            const floatingHorizontalOk=!!viewportRect&&!!floatingRect&&(phoneSidebar?(floatingRect.left>=viewportRect.left+7&&floatingRect.right<=viewportRect.right-7):(floatingRect.left>=viewportRect.left-1&&floatingRect.right<=viewportRect.right+1))&&floatingRect.width<=viewportRect.width+1;
            const floatingVerticalOk=!!viewportRect&&!!floatingRect&&floatingRect.top>=viewportRect.top+7&&floatingRect.bottom<=viewportRect.bottom-7;
            const currentZoomRect=document.querySelector(".editorZoom")?.getBoundingClientRect();
            const floatingNeedsZoomClearance=compactOverlay||window.innerHeight<=620;
            const floatingAvoidsZoomOk=!floatingNeedsZoomClearance||(!!floatingRect&&!!currentZoomRect&&floatingRect.bottom<=currentZoomRect.top-4);
            const floatingMaxWidthOk=!!floatingPanel&&getComputedStyle(floatingPanel).maxWidth!=="none";
            const floatingHandleOk=!!floatingHead&&floatingHead.tagName==="BUTTON"&&floatingHead.getAttribute("aria-label")==="Mover painel de resultados";
            const floatingResizeHandle=floatingPanel?.querySelector(".editorFloatResizeHandle");
            const floatingResizeModeOk=!!floatingPanel&&getComputedStyle(floatingPanel).resize!=="both"&&!!floatingResizeHandle&&(phoneSidebar?getComputedStyle(floatingResizeHandle).display==="none":getComputedStyle(floatingResizeHandle).display!=="none");
            const floatingPreferenceGeometryOk=!!floatingPanel&&floatingPanel.dataset.panelWidth==="360"&&floatingPanel.dataset.panelHeight===""&&(!phoneSidebar?getComputedStyle(floatingPanel).width==="360px":true);
            let floatingResizeInteractionOk=true;
            if(!phoneSidebar&&floatingPanel&&floatingResizeHandle){
              floatingResizeHandle.focus();
              floatingResizeHandle.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"Home"}));
              await sleep(30);
              const resizeHomeOk=floatingPanel.dataset.panelWidth==="360"&&floatingPanel.dataset.panelHeight==="";
              floatingResizeHandle.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"ArrowRight"}));
              await sleep(30);
              const resizeArrowWidthOk=floatingPanel.dataset.panelWidth==="380";
              floatingResizeHandle.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"ArrowUp"}));
              await sleep(30);
              const resizedHeight=Number(floatingPanel.dataset.panelHeight);
              const resizeArrowHeightOk=Number.isFinite(resizedHeight)&&resizedHeight>=65;
              const keyPrefs=JSON.parse(localStorage.getItem("shm.viewer.preferences.v1")||"{}");
              const resizePersisted=keyPrefs.resultPanelSize?.width===380&&keyPrefs.resultPanelSize?.height===resizedHeight;
              floatingResizeHandle.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"End"}));
              await sleep(30);
              const endWidth=Number(floatingPanel.dataset.panelWidth),endHeight=Number(floatingPanel.dataset.panelHeight);
              const resizeEndOk=Number.isFinite(endWidth)&&Number.isFinite(endHeight)&&endWidth>=380&&endHeight>=65;
              floatingResizeHandle.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"Home"}));
              await sleep(30);
              const resizeRestored=floatingPanel.dataset.panelWidth==="360"&&floatingPanel.dataset.panelHeight==="";
              floatingResizeInteractionOk=resizeHomeOk&&resizeArrowWidthOk&&resizeArrowHeightOk&&resizePersisted&&resizeEndOk&&resizeRestored&&floatingResizeHandle.getAttribute("aria-label")==="Redimensionar painel de resultados";
            }
            const floatingHeadBar=floatingPanel?.querySelector(".editorFloatHead");
            const collapseControl=floatingHeadBar?.querySelector('button[aria-label="Recolher painel de resultados"]');
            let floatingStickyHeadOk=!!floatingPanel&&!!floatingHeadBar&&!!collapseControl&&getComputedStyle(floatingHeadBar).position==="sticky";
            if(floatingPanel&&floatingHeadBar){
              floatingPanel.scrollTop=200;
              await sleep(30);
              const panelTop=floatingPanel.getBoundingClientRect().top;
              const headTop=floatingHeadBar.getBoundingClientRect().top;
              floatingStickyHeadOk=floatingStickyHeadOk&&Math.abs(headTop-panelTop)<=2;
              floatingPanel.scrollTop=0;
            }
            const floatingClampOk=floatingHorizontalOk&&floatingVerticalOk&&floatingAvoidsZoomOk&&floatingMaxWidthOk&&floatingHandleOk&&floatingResizeModeOk&&floatingResizeInteractionOk&&floatingStickyHeadOk;
            let floatingMoveInteractionOk=true;
            if(!phoneSidebar&&floatingPanel&&floatingHead&&viewportRect){
              floatingHead.focus();
              floatingHead.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"Home"}));
              await sleep(30);
              const homeRect=floatingPanel.getBoundingClientRect();
              const moveHomeOk=homeRect.left>=viewportRect.left+7&&homeRect.top>=viewportRect.top+7;

              const homeX=Number(floatingPanel.dataset.positionX),homeY=Number(floatingPanel.dataset.positionY);
              floatingHead.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"ArrowRight"}));
              floatingHead.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"ArrowDown"}));
              await sleep(30);
              const arrowX=Number(floatingPanel.dataset.positionX),arrowY=Number(floatingPanel.dataset.positionY);
              const moveArrowOk=arrowX===homeX+24&&arrowY===homeY+24;
              const movePrefs=JSON.parse(localStorage.getItem("shm.viewer.preferences.v1")||"{}");
              const movePersisted=movePrefs.resultPanelPosition?.x===arrowX&&movePrefs.resultPanelPosition?.y===arrowY;

              floatingHead.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"End"}));
              await sleep(30);
              const endRect=floatingPanel.getBoundingClientRect();
              const moveEndOk=endRect.right<=viewportRect.right-7&&endRect.bottom<=viewportRect.bottom-7;

              floatingHead.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"Home"}));
              await sleep(30);
              floatingMoveInteractionOk=moveHomeOk&&moveArrowOk&&movePersisted&&moveEndOk&&floatingHead.getAttribute("aria-label")==="Mover painel de resultados";
            }
            const collapseResults=[...document.querySelectorAll(".editorFloatHead button")].find(button=>button.title==="Recolher resultados");
            collapseResults?.click();
            await sleep(60);
            const collapsedTab=document.querySelector(".editorResultsTab");
            const collapsedPrefs=JSON.parse(localStorage.getItem("shm.viewer.preferences.v1")||"{}");
            const collapsedPersisted=!!collapsedTab&&collapsedPrefs.resultPanelOpen===false;
            collapsedTab?.click();
            await sleep(60);
            const reopenedPrefs=JSON.parse(localStorage.getItem("shm.viewer.preferences.v1")||"{}");
            const resultVisibilityPersistenceOk=collapsedPersisted&&!!document.querySelector(".editorFloating")&&reopenedPrefs.resultPanelOpen===true;

            const collapseBeforeBusy=[...document.querySelectorAll(".editorFloatHead button")].find(button=>button.title==="Recolher resultados");
            collapseBeforeBusy?.click();
            await sleep(50);
            const prefBeforeBusy=JSON.parse(localStorage.getItem("shm.viewer.preferences.v1")||"{}");
            setAnalysisRes(null);
            setRunProgress({completed:3,total:expectedEngineCount,state:"running"});
            setBusy(true);
            await sleep(100);
            const busyAutoOpened=!!document.querySelector(".editorFloating")&&JSON.parse(localStorage.getItem("shm.viewer.preferences.v1")||"{}").resultPanelOpen===false;
            const collapseDuringBusy=[...document.querySelectorAll(".editorFloatHead button")].find(button=>button.title==="Recolher resultados");
            collapseDuringBusy?.click();
            await sleep(60);
            const busyTab=document.querySelector(".editorResultsTab");
            const busyCollapsedTabOk=prefBeforeBusy.resultPanelOpen===false&&!!busyTab&&busyTab.classList.contains("busy")&&busyTab.querySelector("span")?.textContent.trim()==="Resultados"&&busyTab.querySelector("strong")?.textContent.trim()==="3/34"&&!busyTab.textContent.includes("CDM-1")&&busyTab.getAttribute("aria-label")==="Reabrir resultados · análise em andamento"&&!!busyTab.querySelector("i>b");
            setAnalysisRes(fakeResult);
            setRunProgress({completed:100,total:100,state:"persisting",current_engine:"Salvando histórico local"});
            await sleep(100);
            const persistingTab=document.querySelector(".editorResultsTab");
            const persistingStatus=document.querySelector(".editorStatusMessage")?.textContent?.trim();
            const persistencePhaseOk=!!persistingTab&&persistingTab.classList.contains("persisting")&&persistingTab.querySelector("strong")?.textContent.trim()==="100%"&&persistingTab.getAttribute("aria-label")==="Reabrir resultados · salvando histórico"&&!persistingTab.textContent.includes("Cancelar")&&persistingStatus==="Análise concluída · salvando histórico local";
            setBusy(false);
            setRunProgress(null);
            await sleep(100);
            const afterBusyPrefs=JSON.parse(localStorage.getItem("shm.viewer.preferences.v1")||"{}");
            const busyPreferenceRestored=afterBusyPrefs.resultPanelOpen===false&&!document.querySelector(".editorFloating")&&!!document.querySelector(".editorResultsTab");
            const alwaysPresentControlLabels=[
              "Mostrar ou ocultar painel de camadas",
              "Ampliar zoom",
              "Reduzir zoom",
              "Ajustar à tela",
              "Abrir modo câmera"
            ];
            const sidebarControlLabels=[
              "Recolher painel de camadas",
              "Remover referência temporal t0",
              "Subir camada Corrosão",
              "Descer camada Fissuras"
            ];
            const sidebarCurrentlyOpen=!!document.querySelector(".editorLayers");
            const compactControlA11yOk=
              alwaysPresentControlLabels.every(label=>!!document.querySelector(`button[aria-label="${label}"]`))&&
              (!sidebarCurrentlyOpen||sidebarControlLabels.every(label=>!!document.querySelector(`button[aria-label="${label}"]`)));
            document.querySelector('button[aria-label="Abrir modo câmera"]')?.click();
            await sleep(60);
            const cameraDialog=document.querySelector(".editorCamera");
            const cameraDialogRect=cameraDialog?.getBoundingClientRect();
            const cameraFooterRect=cameraDialog?.querySelector("footer")?.getBoundingClientRect();
            const cameraModalFitOk=!!cameraDialogRect&&!!cameraFooterRect&&cameraDialogRect.left>=-1&&cameraDialogRect.right<=window.innerWidth+1&&cameraDialogRect.top>=-1&&cameraDialogRect.bottom<=window.innerHeight+1&&cameraFooterRect.bottom<=cameraDialogRect.bottom+1;
            window.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"Escape"}));
            await sleep(40);
            const cameraEscapeOk=!document.querySelector(".editorCamera");
            const checks={
              initialImageNoticeOk,imageNoticeCleared,devStampOk,staleUpdateVisible,statusBarFit,measuredRuntimeOk,dragDropOk,mobileInitialLayersCollapsedOk,desktopLayerPreferencePreserved,compactDrawerDismissOk,engineStatusPersistent,multiEngineFooterOk,sidebarFixedOk,mobileSidebarOk,topActionsFit,phoneTopCompactOk,phoneZoomCompactOk,phoneFloatingControlsOk,viewportLockOk,compactControlA11yOk,cameraModalFitOk,cameraEscapeOk,compactOverlayArbitrationInitial,compactOverlayArbitrationToggle,floatingClampOk,floatingHorizontalOk,floatingVerticalOk,floatingAvoidsZoomOk,floatingMaxWidthOk,floatingHandleOk,floatingResizeModeOk,floatingPreferenceGeometryOk,floatingResizeInteractionOk,floatingStickyHeadOk,floatingMoveInteractionOk,resultVisibilityPersistenceOk,busyAutoOpened,busyCollapsedTabOk,persistencePhaseOk,busyPreferenceRestored,overlayGeometryOk,engineStatusOk,pathologyInitialStateOk,pathologyGroupInteractiveOk,
              layerBefore:layerBefore===2,layerHidden,layerRestored,layerSoloOk,layerOrderOk,layerOpacityOk,lockStateOk,lockedOpacityStable,lockedVisibilityStillEditable,noFloatingLayersButton,layerResizeOk,layerWidthPersistenceOk,layerNoWrapOk,selectedActionsVisible,sidebarContentFits,
              zoomBefore:zoomBefore==="125%",panOk,fitButtonOk,phoneFitWithinViewportOk,spaceDragPanOk,canvasKeyboardOk,canvasClampOk,canvasWheelOk,canvasTouchOk,zoomBeforeSide:zoomBeforeSide==="125%",sideOk,sideWithinViewportOk,zoomAfterSide:zoomAfterSide==="100%",
              overlayPanes:overlayPanes===1,overlayImages:overlayImages===1,overlayStacks:overlayStacks===1,zoomAfterOverlay:zoomAfterOverlay==="100%",iconActionsOk,unifiedExportOk,exportEscapeOk,
              wipeInitialOk,wipeMovedOk,wipeDirectionOk,wipeStatusOk,zoomAfterWipe:zoomAfterWipe==="100%",
              temporalOk,temporalWithinViewportOk,zoomAfterTemporal:zoomAfterTemporal==="100%",originalPanes:originalPanes===1,originalImages:originalImages===1,originalStacks:originalStacks===0,zoomAfterOriginal:zoomAfterOriginal==="100%",resetOk
            };
            const failed=Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name);
            if(!failed.length){
              setResult("VIEWER_SMOKE_PASS natural=320x180 status=transient-image+dev-build topbar=mobile-fit camera=viewport-fit+escape overlays=compact-single-panel results=viewport-clamped+sticky-head+custom-resize+pointer-safe-move+persistent+collapse-state+busy-tab+persistence-phase sidebar=engines+all-names+short-summary+fixed+responsive+short-fit layers=min340+mobile-overlay+short-collapse+nowrap+touch-actions+toggle+solo+order+opacity+lock+resize+persistent-width+keyboard+pointer no-floating-layer-button controls=icons export=unified results=static-guarded wipe=compact+keyboard-direction-68 zoom=visible original=1 overlay=1 side=2 temporal=2 reset=ok fit=button+viewport+100% pan=middle-drag");
            }else{
              setResult("VIEWER_SMOKE_FAIL "+failed.join(",")+" ["+responsiveDiag+"]"+(failed.includes("resetOk")?" ["+resetDiag+"]":"")+(failed.includes("sideWithinViewportOk")?" ["+sideDiag+"]":"")+(failed.some(name=>name.startsWith("floating"))?" ["+floatingClampDiag+"]":""));
            }
            return;
          }
        }
        await sleep(100);
      }
      if(!cancelled)setResult("VIEWER_SMOKE_FAIL");
    })().catch(e=>{if(!cancelled)setResult("VIEWER_SMOKE_ERROR "+(e?.stack||e?.message||String(e)))});
    return()=>{cancelled=true};
  },[]);
  return <>
    <div style={{height:"100dvh"}}>
      <AnalysisWorkspace
        appInfo={{channel:"development",buildSha:"abc123456789",catalogVersion:"1.2.0",deployment:{status:"divergent",manifest:{sha:"feedface987654",channel:"development",branch:"dev",catalogVersion:"1.2.0"}}}}
        selectedEngineLabels={selectedEngineLabels}
        file={file} prev={null} referenceFile={referenceFile} referencePrev={referencePrev}
        referenceInspectionId={null} referenceInspectionMeta={null}
        inspectionMeta={{oae_id:"SMOKE",element_id:"E1",source_id:"CI"}}
        res={analysisRes} busy={busy} progress={runProgress} selected={selected}
        onFile={f=>setDroppedName(f?.name||"")} onReferenceFile={()=>{}} onRun={()=>{setAnalysisRes(null);setRunProgress({completed:0,total:selectedEngineLabels.length,state:"running"});setBusy(true)}} onCancel={()=>{setBusy(false);setRunProgress({completed:0,total:selectedEngineLabels.length,state:"cancelled"});setAnalysisRes(fakeResult)}}
        onSettings={()=>{}} error="" onExport={()=>{}} onExportCsv={()=>{}}
        onExportMap={()=>{}} onExportCdm={()=>{}}
      />
    </div>
    <span id="drop-received" hidden>{droppedName}</span>
    <pre id="viewer-smoke-state" hidden>{result}</pre>
  </>;
}
createRoot(document.getElementById("root")).render(<App/>);
