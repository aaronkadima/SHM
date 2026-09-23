import React,{useMemo,useState,useEffect}from"react";
import{Layers3}from"lucide-react";
import catalog from"./engines.json";
import AnalysisWorkspace from"./AnalysisWorkspace.jsx";
import AnalysisSettings from"./AnalysisSettings.jsx";
import{browserEngineSupported,runBrowserEngine}from"./browserEngines.js";
import{buildCdmSvg,buildCdmCsv,buildCdmCoco,buildCdmDxf,buildCdmBimJson,buildCdmIfc,buildCdmHtml}from"./cdmExports.js";
import{NavRail,DashboardView,CamerasView,EnginesView,AlertsView,ReportsView}from"./views.jsx";
import{saveInspection,listInspectionSummaries,getInspection,deleteInspection,clearInspections,requestPersistentStorage}from"./historyStore.js";

const DEFAULT_COMPARATOR="https://shm-api-production-01f8.up.railway.app";
const DEFAULT_INDIVIDUAL="";
const EMPTY_INSPECTION={oae_id:"",element_id:"",source_id:"",inspection_label:""};
const CDM_DEFAULTS={cdm_threshold:35,cdm_kernel_size:15,cdm_min_area:30,cdm_min_aspect_ratio:2,cdm_mm_per_px:0,cdm_element_family:"lajes_vigas_secundarias_apoios"};

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
function csvCell(v){const s=v==null?"":String(v);return '"'+s.replaceAll('"','""')+'"'}
function exportJson(res){downloadBlob("shm-comparison.json","application/json",JSON.stringify(res,null,2))}
function exportCsv(res){
  const rows=[["engine","status","latency_ms","detections","label","canonical_label","score","x1","y1","x2","y2","area_px"]];
  for(const r of res.results||[]){
    if(!r.detections?.length)rows.push([r.name,r.status,r.latency_ms,0,"","","","","","","",""]);
    else for(const d of r.detections){
      const b=d.box||[];
      rows.push([r.name,r.status,r.latency_ms,r.detections.length,d.label,d.canonical_label||"",d.score,b[0],b[1],b[2],b[3],d.area_px]);
    }
  }
  downloadBlob("shm-comparison.csv","text/csv;charset=utf-8","\uFEFF"+rows.map(x=>x.map(csvCell).join(",")).join("\n"));
}
function downloadConsensus(res){if(res.consensus_overlay_png_base64)saveBase64("shm-consensus.png",res.consensus_overlay_png_base64)}
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
  }catch(e){window.alert(e?.message||String(e))}
}

export default function App(){
  const engines=catalog.engines||[];
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
  const[activeView,setActiveView]=useState(()=>{
    const v=window.location.hash.replace(/^#\//,"");
    return ["dashboard","cameras","analysis","alerts","reports","engines","settings"].includes(v)?v:"analysis";
  });

  useEffect(()=>()=>{if(prev)URL.revokeObjectURL(prev)},[prev]);
  useEffect(()=>()=>{if(referencePrev)URL.revokeObjectURL(referencePrev)},[referencePrev]);
  useEffect(()=>{localStorage.setItem("shmSelectedEngines",JSON.stringify([...sel]))},[sel]);
  useEffect(()=>{localStorage.setItem("shmInspectionMetaDraft",JSON.stringify(inspectionMeta))},[inspectionMeta]);
  useEffect(()=>{localStorage.setItem("shmCdm1Options",JSON.stringify(cdmOptions))},[cdmOptions]);
  useEffect(()=>{refreshHistory()},[]);
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
    try{setHistory(await listInspectionSummaries(75))}
    catch(e){setHistoryErr("Histórico local indisponível: "+String(e))}
    finally{setHistoryBusy(false)}
  }
  async function openHistory(id,target="reports"){
    setHistoryErr("");
    try{
      const record=await getInspection(id);
      if(!record)throw new Error("Inspeção não encontrada.");
      const blob=record.image_blob;
      let restoredFile=null;
      let restoredPreview=null;
      if(blob){
        const meta=record.file_meta||{};
        restoredFile=new File([blob],meta.name||"inspecao",{type:meta.type||blob.type||"application/octet-stream",lastModified:meta.lastModified||Date.now()});
        restoredPreview=URL.createObjectURL(blob);
      }
      setFile(restoredFile);
      setPrev(restoredPreview);
      setReferenceFile(null);
      if(referencePrev)URL.revokeObjectURL(referencePrev);
      setReferencePrev(null);
      setRes(record.result||null);
      setInspectionMeta({...EMPTY_INSPECTION,...(record.inspection||{})});
      setSel(new Set(record.summary?.engine_ids||record.result?.metadata?.engine_ids||[]));
      setProgress(null);setJobId(null);setErr("");
      navigate(target);
    }catch(e){setHistoryErr("Falha ao abrir inspeção: "+String(e))}
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
  const runMode=selected.length===1?"individual":selected.length>=2?"comparison":"none";
  const recommended=engines.filter(e=>e.recommended).length;
  const cloudVerified=engines.filter(e=>e.cloud_verified).length;
  const browserReady=engines.filter(e=>e.browser_ready).length;
  const visibleEng=useMemo(()=>{
    const q=engineQuery.trim().toLowerCase();
    return engines.filter(e=>{
      if(engineFilter==="recommended"&&!e.recommended)return false;
      if(engineFilter==="verified"&&!e.cloud_verified)return false;
      if(engineFilter==="browser"&&!e.browser_ready)return false;
      if(engineFilter==="public"&&e.domain_mode!=="public_shm_checkpoint")return false;
      if(engineFilter==="optional"&&e.domain_mode!=="optional_runtime"&&e.domain_mode!=="shm_checkpoint"&&e.domain_mode!=="generic_pretrained")return false;
      if(!q)return true;
      return [e.name,e.family,e.task,e.description,e.domain_mode].filter(Boolean).join(" ").toLowerCase().includes(q);
    });
  },[engines,engineQuery,engineFilter]);

  function saveIndividual(){
    const v=individualDraft.trim().replace(/\/$/,"");localStorage.setItem("shmIndividualApiUrl",v);setIndividualApi(v);setIndividualOnline(null);
  }
  function individualEndpoint(){
    if(!individualApi)throw new Error("Configure o endereço HTTPS de um backend standalone em Configurações → Conexões dos motores. Este motor não executa no navegador.");
    let url;
    try{url=new URL(individualApi)}catch{throw new Error("O endereço do backend individual não é uma URL válida.")}
    if((url.protocol!=="https:" || ["localhost","127.0.0.1"].includes(url.hostname)) && !(location.hostname==="localhost"||location.hostname==="127.0.0.1")){
      throw new Error("O site público exige um backend individual acessível por HTTPS; o endereço local não funciona para outros usuários.");
    }
    if(!["https:","http:"].includes(url.protocol))throw new Error("O backend deve usar HTTP ou HTTPS.");
    return individualApi;
  }
  function saveComparator(){
    const v=comparatorDraft.trim().replace(/\/$/,"");localStorage.setItem("shmComparatorApiUrl",v);setComparatorApi(v);setComparatorOnline(null);
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
  async function ensureComparator(){
    const r=await fetch(comparatorApi+"/health",{signal:AbortSignal.timeout(12000)});
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
    setFile(f);setRes(null);setProgress(null);setJobId(null);setErr("");
    if(prev)URL.revokeObjectURL(prev);setPrev(f?URL.createObjectURL(f):null);
  }
  function pickReference(f){
    setReferenceFile(f);setRes(null);setProgress(null);setJobId(null);setErr("");
    if(referencePrev)URL.revokeObjectURL(referencePrev);
    setReferencePrev(f?URL.createObjectURL(f):null);
  }
  function toggle(id){setSel(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n})}
  function selectRecommended(){setSel(new Set(engines.filter(e=>e.recommended).map(e=>e.id)))}
  function selectVerified(){setSel(new Set(engines.filter(e=>e.cloud_verified).map(e=>e.id)))}
  function clearSelection(){setSel(new Set())}

  async function runIndividual(){
    const engineId=selected[0];
    const meta=engines.find(e=>e.id===engineId);
    if(meta?.browser_ready&&browserEngineSupported(engineId)){
      const result=await runBrowserEngine(engineId,file);
      setRes(result);
      return result;
    }
    const fd=new FormData();fd.append("file",file);fd.append("engine_id",engineId);
    if(engineId==="cdm_1"){
      for(const [key,value] of Object.entries(cdmOptions))fd.append(key,String(value));
      if(referenceFile)fd.append("previous_file",referenceFile);
    }
    const r=await fetch(individualEndpoint()+"/infer",{method:"POST",body:fd});
    if(!r.ok)throw new Error(await r.text());
    const x=await r.json();setIndividualOnline(true);
    const result={
      image_width:x.image_width,image_height:x.image_height,results:[x.result],
      consensus:{},spatial_consensus:[],consensus_overlay_png_base64:null,
      metadata:{analysis_id:"standalone-"+Date.now(),api_version:"standalone",generated_at:new Date().toISOString(),mode:"individual",engine_ids:[engineId]}
    };
    setRes(result);
    return result;
  }

  async function runComparison(){
    await ensureComparator();
    const fd=new FormData();fd.append("file",file);fd.append("engines",selected.join(","));
    const start=await fetch(comparatorApi+"/jobs/compare",{method:"POST",body:fd});
    if(!start.ok)throw new Error(await start.text());
    const j=await start.json();setJobId(j.job_id);let attempts=0;let finished=false;let finalResult=null;
    while(attempts<1200){
      await new Promise(r=>setTimeout(r,750));attempts++;
      const poll=await fetch(comparatorApi+"/jobs/"+j.job_id,{signal:AbortSignal.timeout(12000)});
      if(!poll.ok)throw new Error(await poll.text());
      const st=await poll.json();
      setProgress({state:st.state,completed:st.completed,total:st.total,current_engine:st.current_engine});
      if(st.state==="done"){setRes(st.result);finalResult=st.result;finished=true;break}
      if(st.state==="cancelled"){finished=true;throw new Error("Comparação cancelada pelo usuário.")}
      if(st.state==="error"){finished=true;throw new Error(st.error||"Falha no processamento")}
    }
    if(!finished)throw new Error("Tempo limite excedido para a comparação.");
    return finalResult;
  }

  async function run(){
    if(!file||!selected.length)return;
    setBusy(true);setErr("");setRes(null);setProgress(null);
    try{
      const result=runMode==="individual"?await runIndividual():await runComparison();
      if(result){
        try{
          await requestPersistentStorage();
          await saveInspection({result,file,inspection:inspectionMeta});
          await refreshHistory();
        }catch(storageError){
          setHistoryErr("A análise foi concluída, mas não pôde ser persistida no histórico local: "+String(storageError));
        }
      }
    }catch(e){
      if(runMode==="individual")setIndividualOnline(false);
      else setComparatorOnline(false);
      setErr(String(e));
    }finally{setBusy(false);setJobId(null)}
  }
  async function cancelRun(){
    if(!jobId||runMode!=="comparison")return;
    try{
      setProgress(p=>p?{...p,state:"cancel_requested"}:p);
      const r=await fetch(comparatorApi+"/jobs/"+jobId+"/cancel",{method:"POST"});
      if(!r.ok)throw new Error(await r.text());
    }catch(e){setErr("Falha ao solicitar cancelamento: "+String(e))}
  }

  return <div className={"appShell "+(["analysis","settings"].includes(activeView)?"editorShell":"")}>
    {! ["analysis","settings"].includes(activeView)&&<NavRail active={activeView} onSelect={navigate}/>}
    <main className="appMain">
    {! ["analysis","settings"].includes(activeView)&&<header className="topbar">
      <div className="brandBlock">
        <div className="eye"><Layers3 size={15}/> SHM · OAEs · COMPUTER VISION</div>
        <h1>PLATAFORMA SHM · OAE BRASIL</h1>
        <p>Inspeção visual multi-motor com execução individual independente e comparação cloud controlada.</p>
      </div>
      <div className="liveStatus"><i/> SISTEMA ONLINE</div>
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
    <AnalysisWorkspace file={file} prev={prev} referenceFile={referenceFile} referencePrev={referencePrev} res={res} busy={busy} progress={progress} selected={selected} onFile={pick} onReferenceFile={pickReference} onRun={run} onCancel={jobId?cancelRun:null} onSettings={()=>navigate("settings")} error={err} onExport={()=>res&&exportJson(res)} onExportCsv={()=>res&&exportCsv(res)} onExportMap={()=>res&&downloadConsensus(res)} onExportCdm={(result,format)=>exportCdm(result,file?.name||"inspecao.png",format,inspectionMeta)}/>
    </>}
    {activeView==="engines"&&<EnginesView engines={engines} visibleEng={visibleEng} engineQuery={engineQuery} setEngineQuery={setEngineQuery} engineFilter={engineFilter} setEngineFilter={setEngineFilter} browserReady={browserReady} recommended={recommended} cloudVerified={cloudVerified} sel={sel} toggle={toggle} selectRecommended={selectRecommended} selectVerified={selectVerified} clearSelection={clearSelection} individualOnline={individualOnline} comparatorOnline={comparatorOnline}/>}
    {activeView==="alerts"&&<AlertsView res={res} history={history} historyBusy={historyBusy} historyErr={historyErr} onOpenHistory={openHistory} onDeleteHistory={removeHistory} onClearHistory={clearHistory} onNavigate={navigate}/>}
    {activeView==="reports"&&<ReportsView res={res} inspection={inspectionMeta} onJson={()=>res&&exportJson(res)} onCsv={()=>res&&exportCsv(res)} onMap={()=>res&&downloadConsensus(res)} onNavigate={navigate}/>}
    {activeView==="settings"&&<AnalysisSettings engines={engines} selected={selected} toggle={toggle} onBack={()=>navigate("analysis")} individualDraft={individualDraft} setIndividualDraft={setIndividualDraft} comparatorDraft={comparatorDraft} setComparatorDraft={setComparatorDraft} saveIndividual={saveIndividual} saveComparator={saveComparator} testIndividual={testIndividual} testComparator={testComparator} individualOnline={individualOnline} comparatorOnline={comparatorOnline} inspectionMeta={inspectionMeta} updateInspectionMeta={updateInspectionMeta} cdmOptions={cdmOptions} setCdmOptions={setCdmOptions} error={err}/>}
    </main>
  </div>
}
