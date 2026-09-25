import React,{useMemo,useState,useEffect,useRef}from"react";
import{Layers3}from"lucide-react";
import catalog from"./engines.json";
import AnalysisWorkspace from"./AnalysisWorkspace.jsx";
import AnalysisSettings from"./AnalysisSettings.jsx";
import{browserEngineSupported,runBrowserEngine}from"./browserEngines.js";
import{analysisExecutionIssue,executionEndpointIssue}from"./executionConfig.js";
import{buildComparisonCsv}from"./resultExport.js";
import{detectAsset,isCdm3SpatialAsset}from"./assetDetection.js";
import{sortEngines,engineMatchesFilter,engineMatchesQuery}from"./engineCatalog.js";
import{buildCdmSvg,buildCdmCsv,buildCdmCoco,buildCdmDxf,buildCdmBimJson,buildCdmIfc,buildCdmHtml}from"./cdmExports.js";
import{NavRail,DashboardView,CamerasView,EnginesView,AlertsView,ReportsView}from"./views.jsx";
import{saveInspection,listInspectionSummaries,getInspection,deleteInspection,clearInspections,requestPersistentStorage,getStorageStatus}from"./historyStore.js";

const APP_CHANNEL=import.meta.env.VITE_APP_CHANNEL||((import.meta.env.BASE_URL||"").includes("/dev/")?"development":"production");
const BUILD_SHA=import.meta.env.VITE_BUILD_SHA||"local";
const CATALOG_VERSION=catalog.version||"unknown";
const ENGINE_CATALOG=sortEngines(catalog.engines||[]);
const APP_INFO={channel:APP_CHANNEL,buildSha:BUILD_SHA,catalogVersion:CATALOG_VERSION};

const DEFAULT_COMPARATOR="https://shm-api-production-01f8.up.railway.app";
const DEFAULT_INDIVIDUAL="";
const EMPTY_INSPECTION={oae_id:"",element_id:"",source_id:"",inspection_label:""};
const CDM_DEFAULTS={cdm_threshold:35,cdm_kernel_size:15,cdm_min_area:30,cdm_min_aspect_ratio:2,cdm_mm_per_px:0,cdm_element_family:"lajes_vigas_secundarias_apoios",cdm_alignment_method:"translation_auto"};

function stored(key,fallback){
  const v=localStorage.getItem(key);
  return (v||fallback).replace(/\/$/,"");
}
function storedJson(key,fallback){
  try{return {...fallback,...JSON.parse(localStorage.getItem(key)||"{}")}}catch{return fallback}
}
function modeLabel(e){
  if(e.domain_mode==="public_shm_checkpoint")return"Checkpoint SHM público";
  if(e.domain_mode==="zero_shot")return"Zero-shot";
  if(e.domain_mode==="classical")return"Baseline clássico";
  if(e.domain_mode==="shm_checkpoint")return"Checkpoint SHM local";
  if(e.domain_mode==="generic_pretrained")return"Pré-treinado genérico";
  if(e.domain_mode==="optional_runtime")return"Runtime opcional";
  return e.domain_mode||"Registrado";
}
function saveBase64(name,b64){
  if(!b64)return;
  const a=document.createElement("a");a.href="data:image/png;base64,"+b64;a.download=name;a.click();
}
function downloadBlob(name,type,text){
  const b=new Blob([text],{type});const u=URL.createObjectURL(b);const a=document.createElement("a");
  a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),500);
}
function exportJson(res){downloadBlob("shm-comparison.json","application/json",JSON.stringify(res,null,2))}
function exportCsv(res){downloadBlob("shm-comparison.csv","text/csv;charset=utf-8",buildComparisonCsv(res))}
function downloadConsensus(res){if(res.consensus_overlay_png_base64)saveBase64("shm-consensus.png",res.consensus_overlay_png_base64)}
async function validateReferenceImage(file){
  if(!file)return;
  if(detectAsset(file)!=="2d")throw new Error("A referência t0 deve ser uma imagem 2D em formato suportado.");
  const url=URL.createObjectURL(file);
  try{
    await new Promise((resolve,reject)=>{
      const image=new Image();
      const timer=setTimeout(()=>{image.src="";reject(new Error("Tempo excedido ao decodificar a referência t0."))},12000);
      image.onload=()=>{
        clearTimeout(timer);
        if((image.naturalWidth||0)<2||(image.naturalHeight||0)<2)reject(new Error("A referência t0 não possui dimensões de imagem válidas."));
        else resolve();
      };
      image.onerror=()=>{clearTimeout(timer);reject(new Error("O navegador não conseguiu decodificar a referência t0."))};
      image.src=url;
    });
  }finally{URL.revokeObjectURL(url)}
}
function combinedSignal(signal,timeoutMs){
  const timeout=typeof AbortSignal!=="undefined"&&AbortSignal.timeout?AbortSignal.timeout(timeoutMs):null;
  if(signal&&timeout&&AbortSignal.any)return AbortSignal.any([signal,timeout]);
  return signal||timeout||undefined;
}
function isAbortError(error){return error?.name==="AbortError"||/cancelad|aborted|abort/i.test(String(error?.message||error||""))}
function abortableDelay(ms,signal){
  if(signal?.aborted)return Promise.reject(new DOMException("Execução cancelada.","AbortError"));
  return new Promise((resolve,reject)=>{
    const onAbort=()=>{clearTimeout(timer);signal?.removeEventListener("abort",onAbort);reject(new DOMException("Execução cancelada.","AbortError"))};
    const timer=setTimeout(()=>{signal?.removeEventListener("abort",onAbort);resolve()},ms);
    signal?.addEventListener("abort",onAbort,{once:true});
  });
}
function exportCdm(result,fileName,format,inspection={}){
  if(result?.engine_id!=="cdm_1")return;
  const payload={...result,width:result.metrics?.processed_width,height:result.metrics?.processed_height};
  try{
    if(format==="svg")downloadBlob("cdm-1-camadas.svg","image/svg+xml;charset=utf-8",buildCdmSvg(payload));
    if(format==="csv")downloadBlob("cdm-1-resultados.csv","text/csv;charset=utf-8",buildCdmCsv(payload));
    if(format==="coco")downloadBlob("cdm-1-coco.json","application/json",JSON.stringify(buildCdmCoco(payload,fileName),null,2));
    if(format==="dxf")downloadBlob("cdm-1-camadas.dxf","application/dxf;charset=utf-8",buildCdmDxf(payload));
    if(format==="bim")downloadBlob("cdm-1-bim-overlay.json","application/json",JSON.stringify(buildCdmBimJson(payload,inspection),null,2));
    if(format==="ifc")downloadBlob("cdm-1-anotacoes.ifc","application/x-step;charset=utf-8",buildCdmIfc(payload,inspection));
    if(format==="html")downloadBlob("cdm-1-relatorio.html","text/html;charset=utf-8",buildCdmHtml(payload,fileName,inspection));
    if(format==="aligned_t0"&&result.metrics?.temporal?.aligned_reference_png_base64)saveBase64("cdm-1-t0-alinhado.png",result.metrics.temporal.aligned_reference_png_base64);
  }catch(e){window.alert(e?.message||String(e))}
}

export default function App(){
  const engines=ENGINE_CATALOG;
  const[individualApi,setIndividualApi]=useState(()=>stored("shmIndividualApiUrl",DEFAULT_INDIVIDUAL));
  const[individualDraft,setIndividualDraft]=useState(()=>stored("shmIndividualApiUrl",DEFAULT_INDIVIDUAL));
  const[comparatorApi,setComparatorApi]=useState(()=>stored("shmComparatorApiUrl",DEFAULT_COMPARATOR));
  const[comparatorDraft,setComparatorDraft]=useState(()=>stored("shmComparatorApiUrl",DEFAULT_COMPARATOR));
  const[individualOnline,setIndividualOnline]=useState(null);
  const[comparatorOnline,setComparatorOnline]=useState(null);
  const[sel,setSel]=useState(()=>{try{return new Set(JSON.parse(localStorage.getItem("shmSelectedEngines")||"[]"))}catch{return new Set()}});
  const[engineQuery,setEngineQuery]=useState("");
  const[engineFilter,setEngineFilter]=useState("all");
  const[file,setFile]=useState(null);
  const[prev,setPrev]=useState(null);
  const[referenceFile,setReferenceFile]=useState(null);
  const[referencePrev,setReferencePrev]=useState(null);
  const[spatialRgbFile,setSpatialRgbFile]=useState(null);
  const[spatialRgbPrev,setSpatialRgbPrev]=useState(null);
  const[referenceInspectionId,setReferenceInspectionId]=useState(null);
  const[referenceInspectionMeta,setReferenceInspectionMeta]=useState(null);
  const[referenceValidating,setReferenceValidating]=useState(false);
  const[res,setRes]=useState(null);
  const[busy,setBusy]=useState(false);
  const[jobId,setJobId]=useState(null);
  const[progress,setProgress]=useState(null);
  const[err,setErr]=useState("");
  const[inspectionMeta,setInspectionMeta]=useState(()=>storedJson("shmInspectionMetaDraft",EMPTY_INSPECTION));
  const[cdmOptions,setCdmOptions]=useState(()=>storedJson("shmCdm1Options",CDM_DEFAULTS));
  const[history,setHistory]=useState([]);
  const[historyBusy,setHistoryBusy]=useState(false);
  const[historyErr,setHistoryErr]=useState("");
  const[storageStatus,setStorageStatus]=useState(null);
  const[deploymentCheck,setDeploymentCheck]=useState(()=>({status:BUILD_SHA==="local"?"local":"checking",manifest:null}));
  const activeRun=useRef(null),runSeq=useRef(0),referencePickSeq=useRef(0),historyOpenSeq=useRef(0);
  const[activeView,setActiveView]=useState(()=>{
    const v=window.location.hash.replace(/^#\//,"");
    return ["dashboard","cameras","analysis","alerts","reports","engines","settings"].includes(v)?v:"analysis";
  });

  useEffect(()=>()=>{if(prev)URL.revokeObjectURL(prev)},[prev]);
  useEffect(()=>()=>{if(referencePrev)URL.revokeObjectURL(referencePrev)},[referencePrev]);
  useEffect(()=>()=>{if(spatialRgbPrev)URL.revokeObjectURL(spatialRgbPrev)},[spatialRgbPrev]);
  useEffect(()=>()=>{activeRun.current?.controller?.abort()},[]);
  useEffect(()=>{localStorage.setItem("shmSelectedEngines",JSON.stringify([...sel]))},[sel]);
  useEffect(()=>{localStorage.setItem("shmInspectionMetaDraft",JSON.stringify(inspectionMeta))},[inspectionMeta]);
  useEffect(()=>{localStorage.setItem("shmCdm1Options",JSON.stringify(cdmOptions))},[cdmOptions]);
  useEffect(()=>{refreshHistory()},[]);
  useEffect(()=>{
    if(BUILD_SHA==="local")return;
    let cancelled=false;
    const base=import.meta.env.BASE_URL||"/";
    const expectedBranch=APP_CHANNEL==="development"?"dev":"main";
    fetch(base+"build.json?ts="+Date.now(),{cache:"no-store",headers:{Accept:"application/json","Cache-Control":"no-cache"}})
      .then(response=>{if(!response.ok)throw new Error("HTTP "+response.status);return response.json()})
      .then(manifest=>{
        if(cancelled)return;
        const publishedSha=String(manifest?.sha||"").trim();
        const shaOk=publishedSha===String(BUILD_SHA||"");
        const channelOk=manifest?.channel===APP_CHANNEL;
        const branchOk=manifest?.branch===expectedBranch;
        const catalogOk=String(manifest?.catalogVersion||"")===String(CATALOG_VERSION||"");
        const synced=shaOk&&channelOk&&branchOk&&catalogOk;
        setDeploymentCheck({status:synced?"synced":"divergent",manifest,expectedBranch});
        if(!synced&&publishedSha&&channelOk&&branchOk){
          const guardKey="shmAutoReloadBuild";
          const alreadyTried=sessionStorage.getItem(guardKey);
          if(alreadyTried!==publishedSha){
            sessionStorage.setItem(guardKey,publishedSha);
            const url=new URL(window.location.href);
            url.searchParams.set("build",publishedSha);
            window.location.replace(url.toString());
          }
        }else if(synced){
          sessionStorage.removeItem("shmAutoReloadBuild");
        }
      })
      .catch(error=>{if(!cancelled)setDeploymentCheck({status:"unavailable",manifest:null,error:String(error),expectedBranch})});
    return()=>{cancelled=true};
  },[]);
  useEffect(()=>{
    const sync=()=>{
      const v=window.location.hash.replace(/^#\//,"");
      if(["dashboard","cameras","analysis","alerts","reports","engines","settings"].includes(v))setActiveView(v);
    };
    window.addEventListener("hashchange",sync);
    return()=>window.removeEventListener("hashchange",sync);
  },[]);
  function navigate(view){
    setActiveView(view);
    if(window.location.hash!=="#/"+view)window.location.hash="#/"+view;
  }
  function updateInspectionMeta(key,value){setInspectionMeta(m=>({...m,[key]:value}))}
  async function refreshHistory(){
    setHistoryBusy(true);setHistoryErr("");
    try{
      const [items,storage]=await Promise.all([listInspectionSummaries(75),getStorageStatus()]);
      setHistory(items);setStorageStatus(storage);
    }
    catch(e){setHistoryErr("Histórico local indisponível: "+String(e))}
    finally{setHistoryBusy(false)}
  }
  async function openHistory(id,target="reports"){
    setHistoryErr("");
    const historyToken=++historyOpenSeq.current;
    let restoredPreview=null,restoredReferencePreview=null,historyCommitted=false;
    try{
      const record=await getInspection(id);
      if(historyToken!==historyOpenSeq.current)return;
      if(!record)throw new Error("Inspeção não encontrada.");
      const blob=record.image_blob;
      let referenceBlob=record.reference_image_blob;
      let linkedReferenceRecord=null;
      if(!referenceBlob&&record.reference_inspection_id){
        linkedReferenceRecord=await getInspection(record.reference_inspection_id);
        if(historyToken!==historyOpenSeq.current)return;
        referenceBlob=linkedReferenceRecord?.image_blob||null;
      }
      let restoredFile=null;
      let restoredReferenceFile=null;
      if(blob){
        const meta=record.file_meta||{};
        restoredFile=new File([blob],meta.name||"inspecao",{type:meta.type||blob.type||"application/octet-stream",lastModified:meta.lastModified||Date.now()});
        restoredPreview=URL.createObjectURL(blob);
      }
      let referenceRestoreWarning="";
      if(referenceBlob){
        const meta=(record.reference_file_meta&&Object.keys(record.reference_file_meta).length?record.reference_file_meta:linkedReferenceRecord?.file_meta)||{};
        const candidateReferenceFile=new File([referenceBlob],meta.name||"referencia-t0",{type:meta.type||referenceBlob.type||"application/octet-stream",lastModified:meta.lastModified||Date.now()});
        try{
          await validateReferenceImage(candidateReferenceFile);
          if(historyToken!==historyOpenSeq.current)return;
          restoredReferenceFile=candidateReferenceFile;
          restoredReferencePreview=URL.createObjectURL(referenceBlob);
        }catch(e){
          referenceRestoreWarning="Referência t0 armazenada ignorada: "+(e?.message||String(e));
        }
      }
      if(historyToken!==historyOpenSeq.current)return;
      if(prev)URL.revokeObjectURL(prev);
      if(referencePrev)URL.revokeObjectURL(referencePrev);
      setFile(restoredFile);
      setPrev(restoredPreview);
      referencePickSeq.current++;
      setReferenceFile(restoredReferenceFile);
      setReferencePrev(restoredReferencePreview);
      setReferenceInspectionId(restoredReferenceFile?(record.reference_inspection_id||record.summary?.reference_inspection_id||null):null);
      setReferenceInspectionMeta(restoredReferenceFile?(record.reference_inspection_meta||linkedReferenceRecord?.inspection||null):null);
      setRes(record.result||null);
      setInspectionMeta({...EMPTY_INSPECTION,...(record.inspection||{})});
      setSel(new Set(record.summary?.engine_ids||record.result?.metadata?.engine_ids||[]));
      setProgress(null);setJobId(null);setErr(referenceRestoreWarning);
      navigate(target);
      historyCommitted=true;
    }catch(e){if(historyToken===historyOpenSeq.current)setHistoryErr("Falha ao abrir inspeção: "+String(e))}
    finally{
      if(!historyCommitted){
        if(restoredPreview)URL.revokeObjectURL(restoredPreview);
        if(restoredReferencePreview)URL.revokeObjectURL(restoredReferencePreview);
      }
    }
  }
  async function useHistoryAsReference(id){
    historyOpenSeq.current++;
    setHistoryErr("");
    const referenceToken=++referencePickSeq.current;
    setReferenceValidating(true);
    setReferenceFile(null);setReferenceInspectionId(null);setReferenceInspectionMeta(null);setRes(null);setProgress(null);setJobId(null);
    if(referencePrev)URL.revokeObjectURL(referencePrev);
    setReferencePrev(null);
    try{
      const record=await getInspection(id);
      if(referenceToken!==referencePickSeq.current)return;
      if(!record)throw new Error("Inspeção não encontrada.");
      const blob=record.image_blob;
      if(!blob)throw new Error("A imagem original desta inspeção não está disponível no histórico.");
      const meta=record.file_meta||{};
      const restoredReferenceFile=new File([blob],meta.name||"referencia-t0",{type:meta.type||blob.type||"application/octet-stream",lastModified:meta.lastModified||Date.now()});
      await validateReferenceImage(restoredReferenceFile);
      if(referenceToken!==referencePickSeq.current)return;
      if(referencePrev)URL.revokeObjectURL(referencePrev);
      if(prev)URL.revokeObjectURL(prev);
      setReferenceFile(restoredReferenceFile);
      setReferencePrev(URL.createObjectURL(blob));
      setReferenceInspectionId(record.id);
      setReferenceInspectionMeta({...EMPTY_INSPECTION,...(record.inspection||{})});
      setFile(null);
      setPrev(null);
      setRes(null);
      setProgress(null);
      setJobId(null);
      setErr("");
      setInspectionMeta({...EMPTY_INSPECTION,...(record.inspection||{}),inspection_label:""});
      setSel(new Set(["cdm_1"]));
      navigate("analysis");
    }catch(e){if(referenceToken===referencePickSeq.current)setHistoryErr("Falha ao preparar referência t0: "+String(e))}
    finally{if(referenceToken===referencePickSeq.current)setReferenceValidating(false)}
  }
  async function removeHistory(id){
    try{await deleteInspection(id);await refreshHistory()}
    catch(e){setHistoryErr("Falha ao excluir inspeção: "+String(e))}
  }
  async function clearHistory(){
    if(!window.confirm("Excluir todo o histórico local de inspeções deste navegador?"))return;
    try{await clearInspections();await refreshHistory()}
    catch(e){setHistoryErr("Falha ao limpar histórico: "+String(e))}
  }

  const selected=[...sel];
  const selectedEngineLabels=selected.map(id=>engines.find(e=>e.id===id)).filter(Boolean).map(e=>({id:e.id,name:e.name,browser_ready:!!e.browser_ready}));
  const runMode=selected.length===1?"individual":selected.length>=2?"comparison":"none";
  const temporalValidationBlocksRun=referenceValidating&&runMode==="individual"&&selected[0]==="cdm_1";
  const executionIssue=analysisExecutionIssue({selected,engines,individualApi,comparatorApi,browserSupported:browserEngineSupported,hostname:window.location.hostname});
  const recommended=engines.filter(e=>e.recommended).length;
  const cloudVerified=engines.filter(e=>e.cloud_verified).length;
  const browserReady=engines.filter(e=>e.browser_ready).length;
  const visibleEng=useMemo(()=>engines.filter(e=>engineMatchesFilter(e,engineFilter)&&engineMatchesQuery(e,engineQuery)),[engines,engineQuery,engineFilter]);

  function saveIndividual(){
    const v=individualDraft.trim().replace(/\/$/,"");localStorage.setItem("shmIndividualApiUrl",v);setIndividualApi(v);setIndividualOnline(null);setErr("");
  }
  function individualEndpoint(){
    const issue=executionEndpointIssue(individualApi,{label:"backend individual",hostname:window.location.hostname});
    if(issue)throw new Error(issue);
    return individualApi;
  }
  function comparatorEndpoint(){
    const issue=executionEndpointIssue(comparatorApi,{label:"comparador cloud",hostname:window.location.hostname});
    if(issue)throw new Error(issue);
    return comparatorApi;
  }
  function saveComparator(){
    const v=comparatorDraft.trim().replace(/\/$/,"");localStorage.setItem("shmComparatorApiUrl",v);setComparatorApi(v);setComparatorOnline(null);setErr("");
  }
  async function testIndividual(){
    setErr("");setIndividualOnline(null);
    try{
      const r=await fetch(individualEndpoint()+"/health",{signal:AbortSignal.timeout(8000)});
      if(!r.ok)throw new Error("HTTP "+r.status);
      const j=await r.json();
      if(j.role!=="standalone")throw new Error("O endpoint não declarou role=standalone.");
      if(j.ready===false)throw new Error(j.reason||"O motor individual não está pronto.");
      if(selected.length===1&&j.engine_id&&j.engine_id!==selected[0])throw new Error("O serviço atende ao motor "+j.engine_id+", mas o motor selecionado é "+selected[0]+".");
      setIndividualOnline(true);
    }catch(e){setIndividualOnline(false);setErr("Backend individual indisponível: "+(e instanceof TypeError?"Não foi possível acessar o endereço. Confira HTTPS, disponibilidade do serviço e CORS.":e.message||String(e)))}
  }
  async function ensureComparator(signal=null){
    const r=await fetch(comparatorEndpoint()+"/health",{signal:combinedSignal(signal,12000)});
    if(!r.ok)throw new Error("Comparador respondeu HTTP "+r.status);
    const j=await r.json();
    if(j.role&&j.role!=="comparator")throw new Error("O backend informado não está em modo comparator.");
    setComparatorOnline(true);
    return j;
  }
  async function testComparator(){
    setErr("");setComparatorOnline(null);
    try{await ensureComparator()}
    catch(e){setComparatorOnline(false);setErr("Comparador indisponível: "+String(e))}
  }
  function pick(f){
    historyOpenSeq.current++;
    setFile(f);setRes(null);setProgress(null);setJobId(null);setErr("");
    setSpatialRgbFile(null);
    if(spatialRgbPrev)URL.revokeObjectURL(spatialRgbPrev);
    setSpatialRgbPrev(null);
    if(f&&isCdm3SpatialAsset(f))setSel(new Set(["cdm_3"]));
    if(prev)URL.revokeObjectURL(prev);
    setPrev(f&&detectAsset(f)==="2d"?URL.createObjectURL(f):null);
  }
  async function pickSpatialRgb(f){
    if(!f){
      setSpatialRgbFile(null);setRes(null);setProgress(null);setJobId(null);setErr("");
      if(spatialRgbPrev)URL.revokeObjectURL(spatialRgbPrev);
      setSpatialRgbPrev(null);
      return;
    }
    setErr("");
    try{
      await validateReferenceImage(f);
      const nextPreview=URL.createObjectURL(f);
      if(spatialRgbPrev)URL.revokeObjectURL(spatialRgbPrev);
      setSpatialRgbFile(f);setSpatialRgbPrev(nextPreview);setRes(null);setProgress(null);setJobId(null);
    }catch(e){setErr("Imagem RGB espacial inválida: "+(e?.message||String(e)))}
  }
  async function pickReference(f){
    historyOpenSeq.current++;
    const referenceToken=++referencePickSeq.current;
    if(!f){
      setReferenceValidating(false);
      setReferenceFile(null);setReferenceInspectionId(null);setReferenceInspectionMeta(null);setRes(null);setProgress(null);setJobId(null);setErr("");
      if(referencePrev)URL.revokeObjectURL(referencePrev);
      setReferencePrev(null);
      return;
    }
    setErr("");
    setReferenceValidating(true);
    setReferenceFile(null);setReferenceInspectionId(null);setReferenceInspectionMeta(null);setRes(null);setProgress(null);setJobId(null);
    if(referencePrev)URL.revokeObjectURL(referencePrev);
    setReferencePrev(null);
    try{
      await validateReferenceImage(f);
      if(referenceToken!==referencePickSeq.current)return;
      const nextPreview=URL.createObjectURL(f);
      if(referencePrev)URL.revokeObjectURL(referencePrev);
      setReferenceFile(f);setReferencePrev(nextPreview);setReferenceInspectionId(null);setReferenceInspectionMeta(null);setRes(null);setProgress(null);setJobId(null);
    }catch(e){if(referenceToken===referencePickSeq.current)setErr("Referência t0 inválida: "+(e?.message||String(e)))}
    finally{if(referenceToken===referencePickSeq.current)setReferenceValidating(false)}
  }
  function toggle(id){setErr("");setSel(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n})}
  function selectRecommended(){setSel(new Set(engines.filter(e=>e.recommended).map(e=>e.id)))}
  function selectVerified(){setSel(new Set(engines.filter(e=>e.cloud_verified).map(e=>e.id)))}
  function clearSelection(){setSel(new Set())}

  async function runIndividual(runId,signal,sourceFile,sourceReference,engineIds){
    const engineId=engineIds[0];
    const meta=engines.find(e=>e.id===engineId);
    const updateProgress=p=>{if(activeRun.current?.id===runId&&!signal.aborted)setProgress(p)};
    if(meta?.browser_ready&&browserEngineSupported(engineId)){
      updateProgress({state:"running",completed:0,total:100,current_engine:(meta.name||engineId)+" · preparando"});
      return await runBrowserEngine(
        engineId,sourceFile,
        engineId==="cdm_1"?cdmOptions:engineId==="cdm_3"?{rgbReferenceFile:spatialRgbFile}:{},
        engineId==="cdm_1"?sourceReference:null,
        {signal,onProgress:updateProgress,channel:APP_CHANNEL,buildSha:BUILD_SHA}
      );
    }
    updateProgress({state:"running",completed:0,total:1,current_engine:(meta?.name||engineId)+" · enviando"});
    const fd=new FormData();fd.append("file",sourceFile);fd.append("engine_id",engineId);
    if(engineId==="cdm_1"){
      for(const [key,value] of Object.entries(cdmOptions))fd.append(key,String(value));
      if(sourceReference)fd.append("previous_file",sourceReference);
    }
    const r=await fetch(individualEndpoint()+"/infer",{method:"POST",body:fd,signal});
    if(!r.ok)throw new Error(await r.text());
    const x=await r.json();
    if(activeRun.current?.id===runId&&!signal.aborted)setIndividualOnline(true);
    updateProgress({state:"done",completed:1,total:1,current_engine:(meta?.name||engineId)+" · concluído"});
    return {
      image_width:x.image_width,image_height:x.image_height,results:[x.result],
      consensus:{},spatial_consensus:[],consensus_overlay_png_base64:null,
      metadata:{analysis_id:"standalone-"+Date.now(),api_version:"standalone",generated_at:new Date().toISOString(),mode:"individual",engine_ids:[engineId]}
    };
  }

  async function runComparison(runId,signal,sourceFile,engineIds){
    const endpoint=comparatorEndpoint();
    await ensureComparator(signal);
    const fd=new FormData();fd.append("file",sourceFile);fd.append("engines",engineIds.join(","));
    const start=await fetch(endpoint+"/jobs/compare",{method:"POST",body:fd,signal});
    if(!start.ok)throw new Error(await start.text());
    const j=await start.json();
    if(activeRun.current?.id===runId&&!signal.aborted)setJobId(j.job_id);
    let attempts=0,finished=false,finalResult=null;
    while(attempts<1200){
      await abortableDelay(750,signal);
      attempts++;
      const poll=await fetch(endpoint+"/jobs/"+j.job_id,{signal:combinedSignal(signal,12000)});
      if(!poll.ok)throw new Error(await poll.text());
      const st=await poll.json();
      if(activeRun.current?.id===runId&&!signal.aborted)setProgress({state:st.state,completed:st.completed,total:st.total,current_engine:st.current_engine});
      if(st.state==="done"){finalResult=st.result;finished=true;break}
      if(st.state==="cancelled"){finished=true;throw new DOMException("Comparação cancelada pelo usuário.","AbortError")}
      if(st.state==="error"){finished=true;throw new Error(st.error||"Falha no processamento")}
    }
    if(!finished)throw new Error("Tempo limite excedido para a comparação.");
    return finalResult;
  }

  async function run(){
    if(!file||!selected.length||busy)return;
    if(temporalValidationBlocksRun){setErr("Aguarde a validação da referência t0 antes de iniciar a análise.");return}
    if(executionIssue){setErr(executionIssue);return}
    const mode=runMode,engineIds=[...selected],inspection={...inspectionMeta};
    const usesTemporalReference=mode==="individual"&&engineIds[0]==="cdm_1";
    const sourceFile=file;
    const sourceReference=usesTemporalReference?referenceFile:null;
    const sourceReferenceInspectionId=usesTemporalReference?referenceInspectionId:null;
    const sourceReferenceInspectionMeta=usesTemporalReference&&referenceInspectionMeta?{...referenceInspectionMeta}:null;
    if(usesTemporalReference&&sourceReference){
      try{await validateReferenceImage(sourceReference)}
      catch(e){setErr("Referência t0 inválida: "+(e?.message||String(e)));return}
    }
    if(usesTemporalReference&&sourceReferenceInspectionId&&sourceReferenceInspectionMeta){
      const same=(a,b)=>String(a||"").trim()===String(b||"").trim();
      const refOae=String(sourceReferenceInspectionMeta.oae_id||"").trim(),refElement=String(sourceReferenceInspectionMeta.element_id||"").trim();
      const curOae=String(inspection.oae_id||"").trim(),curElement=String(inspection.element_id||"").trim();
      if(!refOae||!refElement){
        setErr("A inspeção histórica usada como t0 não possui identificação completa de OAE e elemento. Use uma referência manual ou corrija o registro antes da comparação temporal.");
        return;
      }
      if(!same(curOae,refOae)||!same(curElement,refElement)){
        setErr("Referência t0 incompatível: a inspeção vinculada pertence a "+refOae+" / "+refElement+". O t1 deve manter a mesma OAE e o mesmo elemento.");
        return;
      }
    }
    const runId=++runSeq.current,controller=new AbortController();
    activeRun.current?.controller?.abort();
    activeRun.current={id:runId,controller,mode};
    setBusy(true);setErr("");setRes(null);setProgress({state:"starting",completed:0,total:mode==="individual"?100:engineIds.length,current_engine:"Preparando análise"});
    const analysisStarted=performance.now();
    try{
      const rawResult=mode==="individual"
        ?await runIndividual(runId,controller.signal,sourceFile,sourceReference,engineIds)
        :await runComparison(runId,controller.signal,sourceFile,engineIds);
      if(!rawResult||controller.signal.aborted||activeRun.current?.id!==runId)return;
      const clientElapsedMs=Math.max(0,performance.now()-analysisStarted);
      const result={...rawResult,metadata:{...(rawResult.metadata||{}),client_elapsed_ms:clientElapsedMs}};
      setRes(result);
      setProgress({state:"persisting",completed:100,total:100,current_engine:"Salvando histórico local"});
      try{
        await requestPersistentStorage();
        if(controller.signal.aborted||activeRun.current?.id!==runId)return;
        await saveInspection({result,file:sourceFile,referenceFile:sourceReference,referenceInspectionId:sourceReferenceInspectionId,referenceInspectionMeta:sourceReferenceInspectionMeta,inspection});
        await refreshHistory();
      }catch(storageError){
        if(activeRun.current?.id===runId)setHistoryErr("A análise foi concluída, mas não pôde ser persistida no histórico local: "+String(storageError));
      }
    }catch(e){
      if(activeRun.current?.id!==runId)return;
      if(isAbortError(e)){
        setProgress(p=>({...p,state:"cancelled",current_engine:"Análise cancelada"}));
        setErr("");
      }else{
        const meta=engines.find(x=>x.id===engineIds[0]);
        if(mode==="individual"&&!meta?.browser_ready)setIndividualOnline(false);
        if(mode==="comparison")setComparatorOnline(false);
        setErr(String(e));
      }
    }finally{
      if(activeRun.current?.id===runId){
        activeRun.current=null;setBusy(false);setJobId(null);
      }
    }
  }
  async function cancelRun(){
    const active=activeRun.current;
    if(!active)return;
    const remoteJob=jobId;
    setProgress(p=>p?{...p,state:"cancel_requested",current_engine:"Cancelando…"}:p);
    active.controller.abort();
    if(active.mode==="comparison"&&remoteJob){
      try{
        const r=await fetch(comparatorApi+"/jobs/"+remoteJob+"/cancel",{method:"POST"});
        if(!r.ok)throw new Error(await r.text());
      }catch(e){setErr("A execução local foi interrompida, mas houve falha ao solicitar cancelamento remoto: "+String(e))}
    }
  }

  return <div className={"appShell "+(["analysis","settings"].includes(activeView)?"editorShell ":"")+(activeView==="settings"?"settingsShell":"")}>
    {! ["analysis","settings"].includes(activeView)&&<NavRail active={activeView} onSelect={navigate}/>}
    <main className="appMain">
    {! ["analysis","settings"].includes(activeView)&&<header className="topbar">
      <div className="brandBlock">
        <div className="eye"><Layers3 size={15}/> SHM · OAEs · COMPUTER VISION</div>
        <h1>PLATAFORMA SHM · OAE BRASIL</h1>
        <p>Inspeção visual multi-motor com execução individual independente e comparação cloud controlada.</p>
      </div>
      <div className={"environmentStatus "+APP_CHANNEL}><b>{APP_CHANNEL==="development"?"DESENVOLVIMENTO":"PRODUÇÃO"}</b><span>catálogo v{CATALOG_VERSION} · {BUILD_SHA}</span></div>
      <div className="sum">
        <div><b>{engines.length}</b><span>motores</span></div>
        <div><b>{recommended}</b><span>recomendados</span></div>
        <div><b>{cloudVerified}</b><span>cloud</span></div>
        <div><b>{browserReady}</b><span>browser</span></div>
      </div>
    </header>}

    {activeView==="dashboard"&&<DashboardView engines={engines} res={res} selected={selected} prev={prev} comparatorOnline={comparatorOnline} individualOnline={individualOnline} history={history} inspection={inspectionMeta} onNavigate={navigate}/>}
    {activeView==="cameras"&&<CamerasView prev={prev} res={res} inspection={inspectionMeta} onNavigate={navigate}/>}
    {activeView==="analysis"&&<>
    <AnalysisWorkspace appInfo={{...APP_INFO,deployment:deploymentCheck}} executionIssue={executionIssue} referenceValidating={temporalValidationBlocksRun} selectedEngineLabels={selectedEngineLabels} file={file} prev={prev} referenceFile={referenceFile} referencePrev={referencePrev} spatialRgbFile={spatialRgbFile} spatialRgbPrev={spatialRgbPrev} onSpatialRgbFile={pickSpatialRgb} referenceInspectionId={referenceInspectionId} referenceInspectionMeta={referenceInspectionMeta} inspectionMeta={inspectionMeta} res={res} busy={busy} progress={progress} selected={selected} onFile={pick} onReferenceFile={pickReference} onRun={run} onCancel={busy&&!(runMode==="individual"&&selected[0]==="opencv_crack")?cancelRun:null} onSettings={()=>navigate("settings")} error={err} onExport={()=>res&&exportJson(res)} onExportCsv={()=>res&&exportCsv(res)} onExportMap={()=>res&&downloadConsensus(res)} onExportCdm={(result,format)=>exportCdm(result,file?.name||"inspecao.png",format,inspectionMeta)}/>
    </>}
    {activeView==="engines"&&<EnginesView appInfo={APP_INFO} engines={engines} visibleEng={visibleEng} engineQuery={engineQuery} setEngineQuery={setEngineQuery} engineFilter={engineFilter} setEngineFilter={setEngineFilter} browserReady={browserReady} recommended={recommended} cloudVerified={cloudVerified} sel={sel} toggle={toggle} selectRecommended={selectRecommended} selectVerified={selectVerified} clearSelection={clearSelection} individualOnline={individualOnline} comparatorOnline={comparatorOnline}/>}
    {activeView==="alerts"&&<AlertsView res={res} history={history} historyBusy={historyBusy} historyErr={historyErr} storageStatus={storageStatus} onOpenHistory={openHistory} onUseAsReference={useHistoryAsReference} onDeleteHistory={removeHistory} onClearHistory={clearHistory} onNavigate={navigate}/>} 
    {activeView==="reports"&&<ReportsView res={res} inspection={inspectionMeta} onJson={()=>res&&exportJson(res)} onCsv={()=>res&&exportCsv(res)} onMap={()=>res&&downloadConsensus(res)} onNavigate={navigate}/>}
    {activeView==="settings"&&<AnalysisSettings appInfo={APP_INFO} engines={engines} selected={selected} toggle={toggle} onBack={()=>navigate("analysis")} individualDraft={individualDraft} setIndividualDraft={setIndividualDraft} comparatorDraft={comparatorDraft} setComparatorDraft={setComparatorDraft} saveIndividual={saveIndividual} saveComparator={saveComparator} testIndividual={testIndividual} testComparator={testComparator} individualOnline={individualOnline} comparatorOnline={comparatorOnline} inspectionMeta={inspectionMeta} updateInspectionMeta={updateInspectionMeta} cdmOptions={cdmOptions} setCdmOptions={setCdmOptions} error={err}/>}
    </main>
  </div>
}
