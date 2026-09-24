import React,{useEffect,useState} from "react";
import{createRoot}from"react-dom/client";
import AnalysisWorkspace from "../src/AnalysisWorkspace.jsx";
import "../src/styles.css";

const objText="o SmokeTriangle\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
const file=new File([objText],"viewer-smoke.obj",{type:"text/plain"});

function App(){
  const[result,setResult]=useState("MODEL_SMOKE_PENDING");
  useEffect(()=>{
    let cancelled=false;
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    (async()=>{
      for(let i=0;i<50&&!cancelled;i++){
        const viewport=document.querySelector(".editorViewport");
        const model=document.querySelector(".modelViewport");
        const badge=document.querySelector(".editorTypeBadge");
        const camera=document.querySelector(".editorCameraEntry");
        const views=document.querySelector(".modelViews");
        const renderer=model?.querySelector("canvas,svg");
        if(viewport&&model&&badge&&camera&&views&&renderer){
          await sleep(120);
          const vp=viewport.getBoundingClientRect(),mr=model.getBoundingClientRect(),br=badge.getBoundingClientRect(),cr=camera.getBoundingClientRect(),vr=views.getBoundingClientRect();
          const buttons=[...views.querySelectorAll("button")];
          const hint=document.querySelector(".modelHint");
          const hr=hint?.getBoundingClientRect();
          const status=document.querySelector(".editorStatusMessage")?.textContent?.trim();
          const controlsWithin=buttons.length===4&&buttons.every(btn=>{const r=btn.getBoundingClientRect();return r.left>=vp.left-1&&r.right<=vp.right+1&&r.top>=vp.top-1&&r.bottom<=vp.bottom+1});
          const noTopCollision=vr.top>=Math.max(br.bottom,cr.bottom)+4;
          const rendererFits=Math.abs(mr.left-vp.left)<1&&Math.abs(mr.top-vp.top)<1&&Math.abs(mr.width-vp.width)<2&&Math.abs(mr.height-vp.height)<2;
          const hintFits=!!hr&&hr.left>=vp.left-1&&hr.right<=vp.right+1&&hr.bottom<=vp.bottom+1;
          const loadingDone=model.getAttribute("aria-busy")==="false"&&!document.querySelector(".modelLoading")&&buttons.every(btn=>!btn.disabled);
          const checks={badgeOk:badge.textContent.includes("3D detectado"),statusOk:status==="Arquivo 3D reconhecido · análise 2D indisponível",rendererFits,controlsWithin,noTopCollision,hintFits,loadingDone,buttonsOk:buttons.map(b=>b.textContent.trim()).join("|")==="Perspectiva|Frontal|Superior|Lateral"};
          const failed=Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name);
          const diag=" vp="+Math.round(vp.width)+"x"+Math.round(vp.height)+" views="+Math.round(vr.left)+"/"+Math.round(vr.top)+"/"+Math.round(vr.right)+"/"+Math.round(vr.bottom);
          setResult(failed.length?"MODEL_SMOKE_FAIL "+failed.join(",")+diag:"MODEL_SMOKE_PASS viewport="+Math.round(vp.width)+"x"+Math.round(vp.height)+" renderer="+renderer.tagName.toLowerCase()+" load=done");
          return;
        }
        await sleep(100);
      }
      if(!cancelled)setResult("MODEL_SMOKE_FAIL timeout");
    })().catch(err=>!cancelled&&setResult("MODEL_SMOKE_ERROR "+(err?.stack||err?.message||String(err))));
    return()=>{cancelled=true};
  },[]);
  return <>
    <div style={{height:"100dvh"}}>
      <AnalysisWorkspace
        appInfo={{channel:"development",buildSha:"3dsmoke",catalogVersion:"1.2.0",deployment:{status:"synced",manifest:{sha:"3dsmoke"}}}}
        executionIssue="Selecione pelo menos um motor em Configurações."
        selectedEngineLabels={[]}
        file={file} prev={null} referenceFile={null} referencePrev={null}
        referenceInspectionId={null} referenceInspectionMeta={null}
        inspectionMeta={{}} res={null} busy={false} progress={null} selected={[]}
        onFile={()=>{}} onReferenceFile={()=>{}} onRun={()=>{}} onCancel={null} onSettings={()=>{}}
        error="" onExport={()=>{}} onExportCsv={()=>{}} onExportMap={()=>{}} onExportCdm={()=>{}}
      />
    </div>
    <pre id="model-smoke-state">{result}</pre>
  </>;
}
createRoot(document.getElementById("root")).render(<App/>);
