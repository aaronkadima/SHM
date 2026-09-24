import React,{useEffect,useMemo,useState} from "react";
import{createRoot}from"react-dom/client";
import AnalysisWorkspace from"../src/AnalysisWorkspace.jsx";
import"../src/styles.css";

const svg='<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#c9d7dc"/><rect x="40" y="30" width="240" height="120" rx="8" fill="#71858d"/><path d="M70 120 L150 70 L240 125" stroke="#ffffff" stroke-width="5" fill="none"/></svg>';
const file=new File([svg],"viewer-smoke.svg",{type:"image/svg+xml"});
const transparentPng="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9WQAAAABJRU5ErkJggg==";
const fakeResult={
  image_width:320,image_height:180,
  results:[{
    engine_id:"cdm_1",name:"CDM-1",status:"ok",latency_ms:12,detections:[],
    overlay_png_base64:transparentPng,
    metrics:{overlay_semantics:"transparent_layers",layers:[],summary:{total_objects:0,crack_count:0,crack_length_total_px:0,spalling_area_px2:0},runtime:"browser-smoke"}
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
            const zoomPlus=[...document.querySelectorAll("button")].find(b=>b.getAttribute("aria-label")==="Ampliar zoom");
            zoomPlus?.click();
            await sleep(40);
            const zoomBefore=[...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim();
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
            const original=[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Original");
            original?.click();
            await sleep(80);
            const originalPanes=document.querySelectorAll(".editorImagePane").length;
            const originalImages=document.querySelectorAll(".editorBaseImage").length;
            const originalStacks=document.querySelectorAll(".editorOverlayStack").length;
            const zoomAfterOriginal=[...document.querySelectorAll(".editorZoom span")][0]?.textContent?.trim();
            if(overlayGeometryOk&&zoomBefore==="125%"&&sideOk&&zoomAfterSide==="100%"&&overlayPanes===1&&overlayImages===1&&overlayStacks===1&&zoomAfterOverlay==="100%"&&originalPanes===1&&originalImages===1&&originalStacks===0&&zoomAfterOriginal==="100%"){
              setResult("VIEWER_SMOKE_PASS natural=320x180 original=1 overlay=1 side=2 fit=100%");
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
        file={file} prev={null} referenceFile={null} referencePrev={null}
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
