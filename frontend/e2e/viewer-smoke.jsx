import React,{useEffect,useMemo,useState} from "react";
import{createRoot}from"react-dom/client";
import AnalysisWorkspace from"../src/AnalysisWorkspace.jsx";
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
  const selected=useMemo(()=>["cdm_1"],[]);
  useEffect(()=>{
    let cancelled=false;
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    (async()=>{
      for(let i=0;i<30&&!cancelled;i++){
        const img=document.querySelector(".editorBaseImage");
        const pane=document.querySelector(".editorImagePane");
        const status=document.querySelector(".editorCanvasStatus.ready");
        if(img&&pane&&status&&img.naturalWidth===320&&img.naturalHeight===180){
          const rect=pane.getBoundingClientRect();
          if(rect.width>100&&rect.height>80){
            const stack=document.querySelector(".editorOverlayStack");
            const stackRect=stack?.getBoundingClientRect();
            const overlayGeometryOk=!!stackRect&&Math.abs(stackRect.width-rect.width)<1&&Math.abs(stackRect.height-rect.height)<1;
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
            const zoomPlus=[...document.querySelectorAll("button")].find(b=>b.getAttribute("aria-label")==="Ampliar zoom");
            zoomPlus?.click();
            await sleep(40);
            const zoomBefore=[...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim();
            const fitButton=[...document.querySelectorAll("button")].find(b=>b.getAttribute("aria-label")==="Ajustar à tela");
            fitButton?.click();
            await sleep(60);
            const zoomAfterFit=[...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim();
            const fitPaneRect=document.querySelector(".editorImagePane")?.getBoundingClientRect();
            const fitButtonOk=zoomAfterFit==="100%"&&!!fitPaneRect&&fitPaneRect.width>100&&fitPaneRect.height>80;
            zoomPlus?.click();
            await sleep(40);
            const zoomBeforeSide=[...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim();
            const side=[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Lado a lado");
            side?.click();
            await sleep(80);
            const panes=[...document.querySelectorAll(".editorImagePane")];
            const images=[...document.querySelectorAll(".editorBaseImage")];
            const sideOk=panes.length===2&&images.length===2&&panes.every(p=>{const r=p.getBoundingClientRect();return r.width>80&&r.height>80});
            const zoomAfterSide=[...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim();
            const overlay=[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Sobrepor");
            overlay?.click();
            await sleep(80);
            const overlayPanes=document.querySelectorAll(".editorImagePane").length;
            const overlayImages=document.querySelectorAll(".editorBaseImage").length;
            const overlayStacks=document.querySelectorAll(".editorOverlayStack").length;
            const zoomAfterOverlay=[...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim();
            const wipe=[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Deslizar");
            wipe?.click();
            await sleep(80);
            const wipePane=document.querySelector(".editorWipePane");
            const wipeStack=document.querySelector(".editorWipePane .editorOverlayStack");
            const wipeDivider=document.querySelector(".editorWipeDivider");
            const wipeControl=document.querySelector('input[aria-label="Divisor original e detecção"]');
            const wipeInitialOk=!!wipePane&&!!wipeStack&&!!wipeDivider&&!!wipeControl&&document.querySelectorAll(".editorImagePane").length===1&&document.querySelectorAll(".editorBaseImage").length===1;
            setNativeValue(wipeControl,67);
            await sleep(50);
            const wipeMovedOk=wipeStack?.style.clipPath?.includes("67%")&&wipeDivider?.style.left==="67%"&&String(wipeControl?.value)==="67";
            const zoomAfterWipe=[...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim();
            const temporal=[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="t0 / t1");
            temporal?.click();
            await sleep(80);
            const temporalPanes=[...document.querySelectorAll(".editorImagePane")];
            const temporalBadges=[...document.querySelectorAll(".editorPaneBadge")].map(x=>x.textContent.trim());
            const temporalStacks=document.querySelectorAll(".editorOverlayStack").length;
            const temporalOk=temporalPanes.length===2&&temporalPanes.every(p=>{const r=p.getBoundingClientRect();return r.width>80&&r.height>80})&&temporalBadges.some(x=>x.startsWith("t0"))&&temporalBadges.some(x=>x.startsWith("t1"))&&temporalStacks===1;
            const zoomAfterTemporal=[...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim();
            const original=[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Original");
            original?.click();
            await sleep(80);
            const originalPanes=document.querySelectorAll(".editorImagePane").length;
            const originalImages=document.querySelectorAll(".editorBaseImage").length;
            const originalStacks=document.querySelectorAll(".editorOverlayStack").length;
            const zoomAfterOriginal=[...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim();
            const reset=document.querySelector(".viewerReset");
            reset?.click();
            await sleep(80);
            const resetMode=[...document.querySelectorAll(".editorCompare button")].find(b=>b.classList.contains("active"))?.textContent?.trim();
            const resetLayers=document.querySelectorAll(".pathologyOverlay:not(.temporalOverlay)").length;
            const resetOrder=[...document.querySelectorAll(".pathologyOverlay:not(.temporalOverlay)")].map(img=>img.alt).join(">");
            const resetZoom=[...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim();
            const resetOpacity=document.querySelector('.pathologyOverlay[data-layer-id="cracks"]')?.style.opacity;
            const resetLock=document.querySelector(".layerLockState");
            const resetLockButton=[...document.querySelectorAll(".layerInspectorActions button")].find(b=>b.textContent.includes("Bloquear"));
            const savedPrefs=JSON.parse(localStorage.getItem("shm.viewer.preferences.v1")||"{}");
            const resetOk=resetMode==="Sobrepor"&&resetLayers===2&&resetOrder==="Corrosão>Fissuras"&&resetZoom==="100%"&&Math.abs(Number(resetOpacity)-0.75)<0.01&&!resetLock&&!!resetLockButton&&savedPrefs.wipePosition===50;
            if(overlayGeometryOk&&layerBefore===2&&layerHidden&&layerRestored&&layerSoloOk&&layerOrderOk&&layerOpacityOk&&lockStateOk&&lockedOpacityStable&&lockedVisibilityStillEditable&&zoomBefore==="125%"&&fitButtonOk&&zoomBeforeSide==="125%"&&sideOk&&zoomAfterSide==="100%"&&overlayPanes===1&&overlayImages===1&&overlayStacks===1&&zoomAfterOverlay==="100%"&&wipeInitialOk&&wipeMovedOk&&zoomAfterWipe==="100%"&&temporalOk&&zoomAfterTemporal==="100%"&&originalPanes===1&&originalImages===1&&originalStacks===0&&zoomAfterOriginal==="100%"&&resetOk){
              setResult("VIEWER_SMOKE_PASS natural=320x180 original=1 overlay=1 wipe=67 side=2 temporal=2 layers=toggle+solo+order+opacity+lock reset=ok fit=button+viewport+100%");
              return;
            }
          }
        }
        await sleep(100);
      }
      if(!cancelled)setResult("VIEWER_SMOKE_FAIL");
    })();
    return()=>{cancelled=true};
  },[]);
  return <>
    <div style={{height:"760px"}}>
      <AnalysisWorkspace
        selectedEngineLabels={[{id:"cdm_1",name:"CDM-1",browser_ready:true}]}
        file={file} prev={null} referenceFile={referenceFile} referencePrev={referencePrev}
        referenceInspectionId={null} referenceInspectionMeta={null}
        inspectionMeta={{oae_id:"SMOKE",element_id:"E1",source_id:"CI"}}
        res={fakeResult} busy={false} progress={null} selected={selected}
        onFile={()=>{}} onReferenceFile={()=>{}} onRun={()=>{}} onCancel={null}
        onSettings={()=>{}} error="" onExport={()=>{}} onExportCsv={()=>{}}
        onExportMap={()=>{}} onExportCdm={()=>{}}
      />
    </div>
    <pre id="viewer-smoke-state">{result}</pre>
  </>;
}
createRoot(document.getElementById("root")).render(<App/>);
