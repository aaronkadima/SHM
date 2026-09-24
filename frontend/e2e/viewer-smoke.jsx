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

const fakeResult={
  image_width:320,image_height:180,
  results:[{
    engine_id:"cdm_1",name:"CDM-1",status:"ok",latency_ms:12,detections:[],
    overlay_png_base64:transparentPng,
    metrics:{overlay_semantics:"transparent_layers",layers:[{id:"cracks",name:"Fissuras",color:"#e64b4b",count:1,overlay_png_base64:transparentPng},{id:"corrosion_rust",name:"Corrosão",color:"#b66a2a",count:1,overlay_png_base64:transparentPng}],summary:{total_objects:2,crack_count:1,crack_length_total_px:12,spalling_area_px2:0},runtime:"browser-smoke",temporal:{enabled:true,alignment:{accepted:false,dx_px:0,dy_px:0,improvement:0},quality:{status:"pass",validated_for_change_quantification:true,issues:[],warnings:[],metrics:{}},stats:{},layers:[{id:"growth:cracks",name:"Crescimento · Fissuras",color:"#ff8b55",count:1,overlay_png_base64:transparentPng}]}}
  }]
};

function App(){
  const[result,setResult]=useState("VIEWER_SMOKE_PENDING");
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
          const devStampOk=devStamp?.textContent.replace(/\s+/g," ").trim()==="DEV · abc12345 ✓"&&devStamp?.classList.contains("synced")&&devStamp?.title.includes("catálogo v1.2.0")&&devStamp?.title.includes("deploy synced")&&deployState?.getAttribute("aria-label")==="Deploy synced"&&!document.querySelector(".editorStatus")?.textContent?.includes("CDM-1");
          const sidebarEngines=document.querySelector(".editorSidebarEngines");
          const engineStatusPersistent=!!sidebarEngines&&sidebarEngines.textContent.includes("CDM-1")&&!document.querySelector(".editorStatusEngines");
          const engineNames=[...document.querySelectorAll(".editorSidebarEngineName")].map(node=>node.textContent.trim());
          const expectedEngineCount=engineCatalog.engines.length;
          const engineOverflow=document.querySelector(".editorSidebarEngineOverflow");
          const multiEngineFooterOk=document.querySelector(".editorLayers")?.dataset.engineCount===String(expectedEngineCount)&&engineNames.length===12&&engineNames[0]==="CDM-1"&&engineOverflow?.textContent.trim()==="+22 motores"&&sidebarEngines?.title.includes("FastFlow")&&getComputedStyle(document.querySelector(".editorSidebarEngineList")).overflow==="hidden"&&document.querySelector(".editorLayers")?.classList.contains("engineDensityUltra")&&parseFloat(getComputedStyle(document.querySelector(".editorSidebarEngineName")).fontSize)>=5.5;
          const sidebarStyle=getComputedStyle(document.querySelector(".editorLayers"));
          const sidebarResizeStyle=getComputedStyle(document.querySelector(".editorLayerResizeHandle"));
          const narrowSidebar=window.matchMedia("(max-width: 900px)").matches;
          const phoneSidebar=window.matchMedia("(max-width: 560px)").matches;
          const compactOverlay=window.matchMedia("(max-width: 740px)").matches;
          const sidebarRect=document.querySelector(".editorLayers")?.getBoundingClientRect();
          const sidebarFixedOk=sidebarStyle.overflow==="hidden"&&sidebarStyle.overscrollBehavior==="none"&&(narrowSidebar?sidebarStyle.position==="absolute":sidebarStyle.position==="sticky");
          const mobileSidebarOk=!narrowSidebar||(sidebarResizeStyle.display==="none"&&Math.abs((sidebarRect?.left||0)-56)<2&&(!phoneSidebar||(sidebarRect?.width||0)<=240));
          const topBar=document.querySelector(".editorTop");
          const topActions=document.querySelector(".editorTopActions");
          const brand=document.querySelector(".editorBrand");
          const topRect=topBar?.getBoundingClientRect();
          const actionsRect=topActions?.getBoundingClientRect();
          const brandRect=brand?.getBoundingClientRect();
          const topButtons=[...document.querySelectorAll(".editorTopActions button")];
          const topActionsFit=!!topRect&&!!actionsRect&&!!brandRect&&actionsRect.right<=topRect.right+1&&brandRect.left>=topRect.left-1&&topButtons.every(button=>{const r=button.getBoundingClientRect();return r.left>=topRect.left-1&&r.right<=topRect.right+1})&&topBar.scrollWidth<=topBar.clientWidth+1;
          const phoneTopCompactOk=!phoneSidebar||(getComputedStyle(document.querySelector(".editorBrand strong")).display==="none"&&topButtons.every(button=>Math.abs(button.getBoundingClientRect().width-32)<1));
          const responsiveDiag=`iw=${window.innerWidth},narrow=${narrowSidebar},phone=${phoneSidebar},compact=${compactOverlay},sidebar=${sidebarRect?Math.round(sidebarRect.left)+"/"+Math.round(sidebarRect.width):"none"},resize=${sidebarResizeStyle.display},brand=${getComputedStyle(document.querySelector(".editorBrand strong")).display},buttons=${topButtons.map(button=>Math.round(button.getBoundingClientRect().width)).join("/")}`;
          const resultsPanel=document.querySelector(".editorFloating");
          const compactOverlayArbitrationInitial=!compactOverlay||getComputedStyle(resultsPanel).visibility==="hidden";
          const rect=pane.getBoundingClientRect();
          if(rect.width>100&&rect.height>80){
            const stack=document.querySelector(".editorOverlayStack");
            const stackRect=stack?.getBoundingClientRect();
            const overlayGeometryOk=!!stackRect&&Math.abs(stackRect.width-rect.width)<1&&Math.abs(stackRect.height-rect.height)<1;
            const engineStatusOk=!!document.querySelector(".editorSidebarEngines")?.textContent?.includes("CDM-1")&&!document.querySelector(".editorStatusEngines");
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
            canvas?.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,button:1,buttons:4,clientX:100,clientY:100}));
            canvas?.dispatchEvent(new MouseEvent("mousemove",{bubbles:true,button:0,buttons:4,clientX:145,clientY:128}));
            canvas?.dispatchEvent(new MouseEvent("mouseup",{bubbles:true,button:1,buttons:0,clientX:145,clientY:128}));
            await sleep(60);
            const panTransform=canvas?.style.transform||"";
            const panOk=panTransform.includes("translate(45px, 28px)")&&panTransform.includes("scale(1.25)");
            const fitButton=[...document.querySelectorAll("button")].find(b=>b.getAttribute("aria-label")==="Ajustar à tela");
            fitButton?.click();
            await sleep(60);
            const zoomAfterFit=[...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim();
            const fitPaneRect=document.querySelector(".editorImagePane")?.getBoundingClientRect();
            const fitTransform=document.querySelector(".editorImage")?.style.transform||"";
            const fitButtonOk=zoomAfterFit==="100%"&&fitTransform.includes("translate(0px, 0px)")&&fitTransform.includes("scale(1)")&&!!fitPaneRect&&fitPaneRect.width>100&&fitPaneRect.height>80;
            zoomPlus?.click();
            await sleep(40);
            const zoomBeforeSide=[...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim();
            const side=document.querySelector('button[aria-label="Lado a lado"]');
            side?.click();
            await sleep(80);
            const panes=[...document.querySelectorAll(".editorImagePane")];
            const images=[...document.querySelectorAll(".editorBaseImage")];
            const sideOk=panes.length===2&&images.length===2&&panes.every(p=>{const r=p.getBoundingClientRect();return r.width>80&&r.height>80});
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
            const unifiedExportOk=!!exportSummary&&exportSummary.getAttribute("data-tooltip")==="Exportar"&&!!exportSummary.querySelector("svg")&&exportLabels.includes("JSON")&&exportLabels.includes("CSV")&&exportLabels.includes("SVG camadas")&&exportLabels.includes("CSV técnico")&&exportLabels.includes("COCO")&&exportLabels.includes("DXF")&&exportLabels.includes("BIM JSON")&&exportLabels.includes("IFC")&&exportLabels.includes("HTML")&&!document.querySelector(".editorCdmExports");
            exportSummary?.click();
            const wipe=document.querySelector('button[aria-label="Deslizar"]');
            wipe?.click();
            await sleep(80);
            const wipePane=document.querySelector(".editorWipePane");
            const wipeStack=document.querySelector(".editorWipePane .editorOverlayStack");
            const wipeDivider=document.querySelector(".editorWipeDivider");
            const wipeHandle=document.querySelector(".editorWipeHandle");
            const wipeInitialOk=!!wipePane&&!!wipeStack&&!!wipeDivider&&!!wipeHandle&&!document.querySelector(".editorWipeControl")&&document.querySelectorAll(".editorImagePane").length===1&&document.querySelectorAll(".editorBaseImage").length===1;
            for(let n=0;n<9;n++)wipeHandle?.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"ArrowRight"}));
            await sleep(90);
            const wipePct=parseFloat(document.querySelector(".editorWipeDivider")?.style.left||"0");
            const wipeMovedOk=Math.abs(wipePct-68)<.6&&document.querySelector(".editorWipePane .editorOverlayStack")?.style.clipPath?.includes(wipePct.toFixed(0)+"%");
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
            const zoomAfterTemporal=[...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim();
            const original=document.querySelector('button[aria-label="Original"]');
            original?.click();
            await sleep(80);
            const originalPanes=document.querySelectorAll(".editorImagePane").length;
            const originalImages=document.querySelectorAll(".editorBaseImage").length;
            const originalStacks=document.querySelectorAll(".editorOverlayStack").length;
            const zoomAfterOriginal=[...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim();
            const reset=document.querySelector(".viewerReset");
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
            const resetOk=resetMode==="Sobrepor"&&resetLayers===2&&resetOrder==="Corrosão>Fissuras"&&resetZoom==="100%"&&Math.abs(Number(resetOpacity)-0.75)<0.01&&!resetLock&&!!resetLockButton&&savedPrefs.wipePosition===50&&savedPrefs.layersWidth===360&&savedPrefs.resultPanelOpen===true&&savedPrefs.resultPanelPosition?.x===0&&savedPrefs.resultPanelPosition?.y===0&&savedPrefs.resultPanelSize?.width===360&&savedPrefs.resultPanelSize?.height===null;
            let compactOverlayArbitrationToggle=true;
            if(compactOverlay){
              const layersToggle=[...document.querySelectorAll(".editorTools button")].find(button=>button.title==="Mostrar ou ocultar camadas");
              layersToggle?.click();
              await sleep(50);
              const floatingAfterLayersClose=document.querySelector(".editorFloating");
              compactOverlayArbitrationToggle=!document.querySelector(".editorLayers")&&!!floatingAfterLayersClose&&getComputedStyle(floatingAfterLayersClose).visibility==="visible"&&getComputedStyle(floatingAfterLayersClose).pointerEvents!=="none";
            }
            const floatingPanel=document.querySelector(".editorFloating");
            const floatingHead=floatingPanel?.querySelector(".editorFloatMoveHandle");
            const viewport=document.querySelector(".editorViewport");
            const viewportRect=viewport?.getBoundingClientRect();
            const floatingRect=floatingPanel?.getBoundingClientRect();
            const floatingClampDiag=viewportRect&&floatingRect?`vp=${Math.round(viewportRect.left)}/${Math.round(viewportRect.top)}/${Math.round(viewportRect.right)}/${Math.round(viewportRect.bottom)} panel=${Math.round(floatingRect.left)}/${Math.round(floatingRect.top)}/${Math.round(floatingRect.right)}/${Math.round(floatingRect.bottom)}`:"no-rect";
            const floatingHorizontalOk=!!viewportRect&&!!floatingRect&&(phoneSidebar?(floatingRect.left>=viewportRect.left+7&&floatingRect.right<=viewportRect.right-7):(floatingRect.left>=viewportRect.left-1&&floatingRect.right<=viewportRect.right+1))&&floatingRect.width<=viewportRect.width+1;
            const floatingVerticalOk=!!viewportRect&&!!floatingRect&&floatingRect.top>=viewportRect.top+7&&floatingRect.bottom<=viewportRect.bottom-7;
            const floatingMaxWidthOk=!!floatingPanel&&getComputedStyle(floatingPanel).maxWidth!=="none";
            const floatingHandleOk=!!floatingHead&&floatingHead.tagName==="BUTTON"&&floatingHead.getAttribute("aria-label")==="Mover painel de resultados";
            const floatingResizeHandle=floatingPanel?.querySelector(".editorFloatResizeHandle");
            const floatingResizeModeOk=!!floatingPanel&&getComputedStyle(floatingPanel).resize==="none"&&!!floatingResizeHandle&&(phoneSidebar?getComputedStyle(floatingResizeHandle).display==="none":getComputedStyle(floatingResizeHandle).cursor==="nwse-resize");
            const floatingPreferenceGeometryOk=!!floatingPanel&&floatingPanel.dataset.panelWidth==="360"&&floatingPanel.dataset.panelHeight===""&&(!phoneSidebar?getComputedStyle(floatingPanel).width==="360px":true);
            let floatingResizeInteractionOk=true;
            if(!phoneSidebar&&floatingPanel&&floatingResizeHandle){
              const beforeResizeWidth=Math.round(floatingPanel.offsetWidth);
              const beforeResizeHeight=Math.round(floatingPanel.offsetHeight);
              const handleRect=floatingResizeHandle.getBoundingClientRect();
              const hx=handleRect.left+Math.max(1,handleRect.width/2),hy=handleRect.top+Math.max(1,handleRect.height/2);
              floatingResizeHandle.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,pointerId:81,pointerType:"pen",isPrimary:true,button:0,buttons:1,clientX:hx,clientY:hy}));
              window.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,pointerId:82,pointerType:"pen",isPrimary:true,button:0,buttons:1,clientX:hx+90,clientY:hy+90}));
              await sleep(20);
              const foreignResizeIgnored=Math.round(floatingPanel.offsetWidth)===beforeResizeWidth;
              window.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,pointerId:81,pointerType:"pen",isPrimary:true,button:0,buttons:1,clientX:hx+40,clientY:hy+20}));
              window.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,pointerId:81,pointerType:"pen",isPrimary:true,button:0,buttons:0,clientX:hx+40,clientY:hy+20}));
              await sleep(80);
              const pointerWidth=Math.round(floatingPanel.offsetWidth);
              const pointerPrefs=JSON.parse(localStorage.getItem("shm.viewer.preferences.v1")||"{}");
              const pointerResizePersisted=foreignResizeIgnored&&pointerWidth>=beforeResizeWidth&&pointerPrefs.resultPanelSize?.width===Number(floatingPanel.dataset.panelWidth)&&Number(floatingPanel.dataset.panelHeight)>=65;

              const cancelRect=floatingResizeHandle.getBoundingClientRect();
              const cx=cancelRect.left+Math.max(1,cancelRect.width/2),cy=cancelRect.top+Math.max(1,cancelRect.height/2);
              const cancelWidth=Math.round(floatingPanel.offsetWidth);
              floatingResizeHandle.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,pointerId:83,pointerType:"pen",isPrimary:true,button:0,buttons:1,clientX:cx,clientY:cy}));
              window.dispatchEvent(new PointerEvent("pointercancel",{bubbles:true,pointerId:83,pointerType:"pen",isPrimary:true,button:0,buttons:0,clientX:cx,clientY:cy}));
              window.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,pointerId:83,pointerType:"pen",isPrimary:true,button:0,buttons:1,clientX:cx+100,clientY:cy+100}));
              await sleep(30);
              const resizeCancelReleased=Math.round(floatingPanel.offsetWidth)===cancelWidth;

              floatingResizeHandle.focus();
              floatingResizeHandle.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"Home"}));
              await sleep(60);
              const resizeHomeOk=floatingPanel.dataset.panelWidth==="360"&&floatingPanel.dataset.panelHeight==="";
              floatingResizeHandle.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"ArrowRight"}));
              await sleep(50);
              const resizeArrowOk=floatingPanel.dataset.panelWidth==="380";
              floatingResizeHandle.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"End"}));
              await sleep(60);
              const endWidth=Number(floatingPanel.dataset.panelWidth),endHeight=Number(floatingPanel.dataset.panelHeight);
              const resizeEndOk=Number.isFinite(endWidth)&&Number.isFinite(endHeight)&&endWidth>=380&&endHeight>=65;
              floatingResizeHandle.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"Home"}));
              await sleep(60);
              const resizeRestored= floatingPanel.dataset.panelWidth==="360"&&floatingPanel.dataset.panelHeight==="";
              floatingResizeInteractionOk=pointerResizePersisted&&resizeCancelReleased&&resizeHomeOk&&resizeArrowOk&&resizeEndOk&&resizeRestored&&floatingResizeHandle.getAttribute("aria-label")==="Redimensionar painel de resultados";
            }
            const floatingClampOk=floatingHorizontalOk&&floatingVerticalOk&&floatingMaxWidthOk&&floatingHandleOk&&floatingResizeModeOk&&floatingResizeInteractionOk;
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
            setBusy(false);
            setRunProgress(null);
            setAnalysisRes(fakeResult);
            await sleep(100);
            const afterBusyPrefs=JSON.parse(localStorage.getItem("shm.viewer.preferences.v1")||"{}");
            const busyPreferenceRestored=afterBusyPrefs.resultPanelOpen===false&&!document.querySelector(".editorFloating")&&!!document.querySelector(".editorResultsTab");
            const checks={
              initialImageNoticeOk,imageNoticeCleared,devStampOk,engineStatusPersistent,multiEngineFooterOk,sidebarFixedOk,mobileSidebarOk,topActionsFit,phoneTopCompactOk,compactOverlayArbitrationInitial,compactOverlayArbitrationToggle,floatingClampOk,floatingHorizontalOk,floatingVerticalOk,floatingMaxWidthOk,floatingHandleOk,floatingResizeModeOk,floatingPreferenceGeometryOk,floatingResizeInteractionOk,resultVisibilityPersistenceOk,busyAutoOpened,busyCollapsedTabOk,busyPreferenceRestored,overlayGeometryOk,engineStatusOk,
              layerBefore:layerBefore===2,layerHidden,layerRestored,layerSoloOk,layerOrderOk,layerOpacityOk,lockStateOk,lockedOpacityStable,lockedVisibilityStillEditable,noFloatingLayersButton,layerResizeOk,layerWidthPersistenceOk,layerNoWrapOk,selectedActionsVisible,sidebarContentFits,
              zoomBefore:zoomBefore==="125%",panOk,fitButtonOk,zoomBeforeSide:zoomBeforeSide==="125%",sideOk,zoomAfterSide:zoomAfterSide==="100%",
              overlayPanes:overlayPanes===1,overlayImages:overlayImages===1,overlayStacks:overlayStacks===1,zoomAfterOverlay:zoomAfterOverlay==="100%",iconActionsOk,unifiedExportOk,
              wipeInitialOk,wipeMovedOk,wipeDirectionOk,wipeStatusOk,zoomAfterWipe:zoomAfterWipe==="100%",
              temporalOk,zoomAfterTemporal:zoomAfterTemporal==="100%",originalPanes:originalPanes===1,originalImages:originalImages===1,originalStacks:originalStacks===0,zoomAfterOriginal:zoomAfterOriginal==="100%",resetOk
            };
            const failed=Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name);
            if(!failed.length){
              setResult("VIEWER_SMOKE_PASS natural=320x180 status=transient-image+dev-build topbar=mobile-fit overlays=compact-single-panel results=viewport-clamped+custom-resize+persistent+collapse-state+busy-tab sidebar=engines+full-catalog-summary+fixed+responsive+short-fit layers=min340+mobile-overlay+nowrap+touch-actions+toggle+solo+order+opacity+lock+resize+persistent-width+keyboard+pointer no-floating-layer-button controls=icons export=unified results=static-guarded wipe=compact+keyboard-direction-68 zoom=visible original=1 overlay=1 side=2 temporal=2 reset=ok fit=button+viewport+100% pan=middle-drag");
            }else{
              setResult("VIEWER_SMOKE_FAIL "+failed.join(",")+" ["+responsiveDiag+"]"+(failed.some(name=>name.startsWith("floating"))?" ["+floatingClampDiag+"]":""));
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
    <div style={{height:"760px"}}>
      <AnalysisWorkspace
        appInfo={{channel:"development",buildSha:"abc123456789",catalogVersion:"1.2.0",deployment:{status:"synced",manifest:{sha:"abc123456789",channel:"development",branch:"feat/cdm-1",catalogVersion:"1.2.0"}}}}
        selectedEngineLabels={selectedEngineLabels}
        file={file} prev={null} referenceFile={referenceFile} referencePrev={referencePrev}
        referenceInspectionId={null} referenceInspectionMeta={null}
        inspectionMeta={{oae_id:"SMOKE",element_id:"E1",source_id:"CI"}}
        res={analysisRes} busy={busy} progress={runProgress} selected={selected}
        onFile={()=>{}} onReferenceFile={()=>{}} onRun={()=>{setAnalysisRes(null);setRunProgress({completed:0,total:selectedEngineLabels.length,state:"running"});setBusy(true)}} onCancel={()=>{setBusy(false);setRunProgress({completed:0,total:selectedEngineLabels.length,state:"cancelled"});setAnalysisRes(fakeResult)}}
        onSettings={()=>{}} error="" onExport={()=>{}} onExportCsv={()=>{}}
        onExportMap={()=>{}} onExportCdm={()=>{}}
      />
    </div>
    <pre id="viewer-smoke-state">{result}</pre>
  </>;
}
createRoot(document.getElementById("root")).render(<App/>);
