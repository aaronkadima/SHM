import React,{useMemo,useState,useEffect}from"react";
import{
  Upload,Play,CheckCircle2,AlertTriangle,Clock3,Layers3,Server,Save,Wifi,WifiOff,
  FlaskConical,ExternalLink,HardDrive,Download,FileJson,FileSpreadsheet,MonitorCog,CloudCog
}from"lucide-react";
import catalog from"./engines.json";

const DEFAULT_COMPARATOR="https://shm-api-production-01f8.up.railway.app";
const DEFAULT_INDIVIDUAL="http://127.0.0.1:8001";
const txt={ok:"Concluído",missing_dependency:"Dependência ausente",missing_weights:"Pesos ausentes",error:"Erro",skipped:"Registrado"};

function stored(key,fallback){
  const v=localStorage.getItem(key);
  return (v||fallback).replace(/\/$/,"");
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

function Card({r}){
  return <article className="card">
    <div className="head">
      <div><h3>{r.name}</h3><span className={"badge "+r.status}>{txt[r.status]||r.status}</span></div>
      <div className="cardTools">
        <span className="lat"><Clock3 size={14}/>{Number(r.latency_ms||0).toFixed(0)} ms</span>
        {r.overlay_png_base64&&<button title="Baixar sobreposição" onClick={()=>saveBase64(`shm-${r.engine_id}.png`,r.overlay_png_base64)}><Download size={14}/></button>}
      </div>
    </div>
    {r.overlay_png_base64?<img src={"data:image/png;base64,"+r.overlay_png_base64}/>:<div className="empty">{r.message||"Sem visualização"}</div>}
    <div className="metrics"><b>{r.detections?.length||0}</b> achados {Object.entries(r.metrics||{}).slice(0,6).map(([k,v])=><span key={k}>{k}: {String(v)}</span>)}</div>
    {r.message&&<p className="msg">{r.message}</p>}
  </article>
}

export default function App(){
  const engines=catalog.engines||[];
  const[individualApi,setIndividualApi]=useState(()=>stored("shmIndividualApiUrl",DEFAULT_INDIVIDUAL));
  const[individualDraft,setIndividualDraft]=useState(()=>stored("shmIndividualApiUrl",DEFAULT_INDIVIDUAL));
  const[comparatorApi,setComparatorApi]=useState(()=>stored("shmComparatorApiUrl",DEFAULT_COMPARATOR));
  const[comparatorDraft,setComparatorDraft]=useState(()=>stored("shmComparatorApiUrl",DEFAULT_COMPARATOR));
  const[individualOnline,setIndividualOnline]=useState(null);
  const[comparatorOnline,setComparatorOnline]=useState(null);
  const[sel,setSel]=useState(new Set());
  const[engineQuery,setEngineQuery]=useState("");
  const[engineFilter,setEngineFilter]=useState("all");
  const[file,setFile]=useState(null);
  const[prev,setPrev]=useState(null);
  const[res,setRes]=useState(null);
  const[busy,setBusy]=useState(false);
  const[jobId,setJobId]=useState(null);
  const[progress,setProgress]=useState(null);
  const[err,setErr]=useState("");

  useEffect(()=>()=>{if(prev)URL.revokeObjectURL(prev)},[prev]);

  const selected=[...sel];
  const runMode=selected.length===1?"individual":selected.length>=2?"comparison":"none";
  const recommended=engines.filter(e=>e.recommended).length;
  const cloudVerified=engines.filter(e=>e.cloud_verified).length;
  const visibleEng=useMemo(()=>{
    const q=engineQuery.trim().toLowerCase();
    return engines.filter(e=>{
      if(engineFilter==="recommended"&&!e.recommended)return false;
      if(engineFilter==="verified"&&!e.cloud_verified)return false;
      if(engineFilter==="public"&&e.domain_mode!=="public_shm_checkpoint")return false;
      if(engineFilter==="optional"&&e.domain_mode!=="optional_runtime"&&e.domain_mode!=="shm_checkpoint"&&e.domain_mode!=="generic_pretrained")return false;
      if(!q)return true;
      return [e.name,e.family,e.task,e.description,e.domain_mode].filter(Boolean).join(" ").toLowerCase().includes(q);
    });
  },[engines,engineQuery,engineFilter]);

  function saveIndividual(){
    const v=individualDraft.trim().replace(/\/$/,"");localStorage.setItem("shmIndividualApiUrl",v);setIndividualApi(v);setIndividualOnline(null);
  }
  function saveComparator(){
    const v=comparatorDraft.trim().replace(/\/$/,"");localStorage.setItem("shmComparatorApiUrl",v);setComparatorApi(v);setComparatorOnline(null);
  }
  async function testIndividual(){
    setErr("");setIndividualOnline(null);
    try{
      const r=await fetch(individualApi+"/health",{signal:AbortSignal.timeout(8000)});
      if(!r.ok)throw new Error("HTTP "+r.status);
      const j=await r.json();
      if(j.role!=="standalone")throw new Error("O endpoint não declarou role=standalone.");
      setIndividualOnline(true);
    }catch(e){setIndividualOnline(false);setErr("Backend individual indisponível: "+String(e))}
  }
  async function ensureComparator(){
    const r=await fetch(comparatorApi+"/health",{signal:AbortSignal.timeout(12000)});
    if(!r.ok)throw new Error("Comparador respondeu HTTP "+r.status);
    const j=await r.json();
    if(j.role&&j.role!=="comparator")throw new Error("O backend informado não está em modo comparator.");
    setComparatorOnline(true);
    return j;
  }
  function pick(f){
    setFile(f);setRes(null);setProgress(null);setJobId(null);setErr("");
    if(prev)URL.revokeObjectURL(prev);setPrev(f?URL.createObjectURL(f):null);
  }
  function toggle(id){setSel(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n})}
  function selectRecommended(){setSel(new Set(engines.filter(e=>e.recommended).map(e=>e.id)))}
  function selectVerified(){setSel(new Set(engines.filter(e=>e.cloud_verified).map(e=>e.id)))}
  function clearSelection(){setSel(new Set())}

  async function runIndividual(){
    const engineId=selected[0];
    const fd=new FormData();fd.append("file",file);fd.append("engine_id",engineId);
    const r=await fetch(individualApi+"/infer",{method:"POST",body:fd});
    if(!r.ok)throw new Error(await r.text());
    const x=await r.json();setIndividualOnline(true);
    setRes({
      image_width:x.image_width,image_height:x.image_height,results:[x.result],
      consensus:{},spatial_consensus:[],consensus_overlay_png_base64:null,
      metadata:{analysis_id:"standalone-"+Date.now(),api_version:"standalone",generated_at:new Date().toISOString(),mode:"individual",engine_ids:[engineId]}
    });
  }

  async function runComparison(){
    await ensureComparator();
    const fd=new FormData();fd.append("file",file);fd.append("engines",selected.join(","));
    const start=await fetch(comparatorApi+"/jobs/compare",{method:"POST",body:fd});
    if(!start.ok)throw new Error(await start.text());
    const j=await start.json();setJobId(j.job_id);let attempts=0;let finished=false;
    while(attempts<1200){
      await new Promise(r=>setTimeout(r,750));attempts++;
      const poll=await fetch(comparatorApi+"/jobs/"+j.job_id,{signal:AbortSignal.timeout(12000)});
      if(!poll.ok)throw new Error(await poll.text());
      const st=await poll.json();
      setProgress({state:st.state,completed:st.completed,total:st.total,current_engine:st.current_engine});
      if(st.state==="done"){setRes(st.result);finished=true;break}
      if(st.state==="cancelled"){finished=true;throw new Error("Comparação cancelada pelo usuário.")}
      if(st.state==="error"){finished=true;throw new Error(st.error||"Falha no processamento")}
    }
    if(!finished)throw new Error("Tempo limite excedido para a comparação.");
  }

  async function run(){
    if(!file||!selected.length)return;
    setBusy(true);setErr("");setRes(null);setProgress(null);
    try{
      if(runMode==="individual")await runIndividual();
      else await runComparison();
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

  return <main>
    <header>
      <div><div className="eye"><Layers3 size={16}/> SHM · OAEs · COMPUTER VISION</div><h1>SHM Vision Lab</h1><p>Motor individual independente; Railway somente para comparação com dois ou mais motores.</p></div>
      <div className="sum"><b>{engines.length}</b><span>motores no repositório</span><b>{recommended}</b><span>recomendados</span><b>{cloudVerified}</b><span>verificados no perfil cloud</span></div>
    </header>

    <section className="runtimeGrid">
      <div className={"runtimeCard "+(runMode==="individual"?"active":"")}>
        <div className="runtimeTitle"><MonitorCog size={19}/><div><b>Motor individual</b><span>Execução standalone · sem Railway</span></div></div>
        <div className="runtimeInputs">
          <input value={individualDraft} onChange={e=>setIndividualDraft(e.target.value)} placeholder="http://127.0.0.1:8001"/>
          <button onClick={saveIndividual}><Save size={15}/> Salvar</button>
          <button className="secondary" onClick={testIndividual}>Testar</button>
        </div>
        <small>{individualOnline===true?<><Wifi size={12}/> Backend standalone conectado</>:individualOnline===false?<><WifiOff size={12}/> Backend standalone não acessível</>:"Selecione exatamente 1 motor para usar este backend."}</small>
      </div>

      <div className={"runtimeCard "+(runMode==="comparison"?"active":"")}>
        <div className="runtimeTitle"><CloudCog size={19}/><div><b>Comparador multi-engine</b><span>Railway · usado somente com ≥2 motores</span></div></div>
        <div className="runtimeInputs">
          <input value={comparatorDraft} onChange={e=>setComparatorDraft(e.target.value)} placeholder={DEFAULT_COMPARATOR}/>
          <button onClick={saveComparator}><Save size={15}/> Salvar</button>
        </div>
        <small>{comparatorOnline===true?<><Wifi size={12}/> Comparador online</>:comparatorOnline===false?<><WifiOff size={12}/> Comparador indisponível</>:"Não é consultado enquanto houver menos de 2 motores selecionados."}</small>
      </div>
    </section>

    <div className={"scienceNote "+(runMode==="individual"?"individualMode":runMode==="comparison"?"comparisonMode":"")}>
      <FlaskConical size={17}/><span><b>Modo atual:</b> {runMode==="individual"?"inferência individual pelo backend standalone do repositório; nenhum request de inferência é enviado ao Railway.":runMode==="comparison"?"comparação multi-engine; o Railway atua somente como orquestrador da mesma base de motores do repositório.":"selecione um motor para modo individual ou dois ou mais para comparação."}</span>
    </div>

    <section className="work">
      <div className="left">
        <label className="drop"><input type="file" accept="image/*" onChange={e=>pick(e.target.files?.[0])}/>{prev?<img src={prev}/>:<><Upload size={34}/><b>Selecionar imagem da inspeção</b><span>JPG, PNG ou WEBP</span></>}</label>
        <div className="runRow">
          <button className="run" disabled={!file||busy||!selected.length} onClick={run}><Play size={18}/>{busy&&progress?`Processando ${progress.completed}/${progress.total}...`:busy?"Processando...":runMode==="individual"?"Executar motor individual":runMode==="comparison"?"Comparar motores":"Executar"}</button>
          {busy&&jobId&&runMode==="comparison"&&<button className="cancelRun" onClick={cancelRun}>Cancelar</button>}
        </div>
        {busy&&progress&&<div className="jobProgress"><div className="jobProgressTop"><span>{progress.current_engine?`Motor: ${engines.find(e=>e.id===progress.current_engine)?.name||progress.current_engine}`:"Preparando fila..."}</span><b>{progress.completed}/{progress.total}</b></div><div className="jobTrack"><i style={{width:`${progress.total?Math.round(progress.completed/progress.total*100):0}%`}}/></div></div>}
        {runMode==="individual"&&<div className="localHint"><b>Backend individual:</b> no diretório <code>backend</code>, execute <code>python run_engine.py --engine {selected[0]||"ID_DO_MOTOR"} --port 8001</code>.</div>}
        {err&&<div className="error">{err}</div>}
      </div>

      <div className="panel">
        <div className="pt"><h2>Motores</h2><div className="selectBtns"><button onClick={selectRecommended}>Recomendados</button><button onClick={selectVerified}>Cloud verificados</button><button onClick={clearSelection}>Limpar</button></div></div>
        <div className="engineFilterBar">
          <input aria-label="Buscar motores" value={engineQuery} onChange={e=>setEngineQuery(e.target.value)} placeholder="Buscar motor, família ou tarefa..."/>
          <select value={engineFilter} onChange={e=>setEngineFilter(e.target.value)}>
            <option value="all">Todos ({engines.length})</option><option value="recommended">Recomendados ({recommended})</option><option value="verified">Cloud verificados ({cloudVerified})</option><option value="public">Checkpoints SHM públicos</option><option value="optional">Requerem configuração/runtime</option>
          </select>
        </div>
        <div className="elist">{visibleEng.map(e=><label className="engine" key={e.id}><input type="checkbox" checked={sel.has(e.id)} onChange={()=>toggle(e.id)}/><div><b>{e.name}{e.recommended&&<em> recomendado</em>}{e.cloud_verified&&<em className="verified"> cloud validado</em>}</b><span>{e.family} · {e.task.replaceAll("_"," ")} · {modeLabel(e)}</span><small>{e.description}</small>{e.license&&<small className="license">Licença: {e.license}{e.source_url&&<> · <a href={e.source_url} target="_blank" rel="noreferrer" onClick={ev=>ev.stopPropagation()}>fonte <ExternalLink size={10}/></a></>}</small>}</div><CheckCircle2 className="ok" size={18}/></label>)}{visibleEng.length===0&&<div className="engineEmpty">Nenhum motor corresponde ao filtro atual.</div>}</div>
      </div>
    </section>

    {res&&<section className="results">
      <div className="resultsHead"><div><h2>{runMode==="individual"?"Resultado individual":"Comparação"}</h2><p>{res.image_width} × {res.image_height}px · mesma entrada de inspeção</p>{res.metadata&&<small className="traceLine">Análise {String(res.metadata.analysis_id||"").slice(0,12)} · API {res.metadata.api_version||"—"} · {res.metadata.generated_at?new Date(res.metadata.generated_at).toLocaleString("pt-BR"):""}</small>}</div><div className="exportBtns"><button onClick={()=>exportJson(res)}><FileJson size={15}/> JSON</button><button onClick={()=>exportCsv(res)}><FileSpreadsheet size={15}/> CSV</button>{res.consensus_overlay_png_base64&&<button onClick={()=>downloadConsensus(res)}><Download size={15}/> Mapa</button>}</div></div>
      {Object.keys(res.consensus||{}).length>0&&<div className="consensus"><div className="consensusHead"><b>Concordância entre motores</b><span>Concordância não equivale a verdade-terreno; indica quantos motores sinalizaram a mesma categoria normalizada.</span></div><div className="consensusGrid">{Object.entries(res.consensus).map(([key,c])=><div className="consensusItem" key={key}><strong>{c.label}</strong><span>{c.engine_count}/{c.successful_engine_count} motores · {(c.agreement_ratio*100).toFixed(0)}%</span><small>{c.detections} achados{c.mean_score!=null?` · confiança média ${(c.mean_score*100).toFixed(0)}%`:""}</small></div>)}</div></div>}
      {res.consensus_overlay_png_base64&&<div className="ensembleView"><div><b>Mapa espacial de consenso</b><span>Caixas agrupadas por categoria e sobreposição espacial.</span></div><img src={"data:image/png;base64,"+res.consensus_overlay_png_base64}/>{res.spatial_consensus?.length>0&&<div className="clusterChips">{res.spatial_consensus.slice(0,12).map(c=><span key={c.id}>{c.label}: {c.engine_count}/{c.successful_engine_count} · IoU≥{c.iou_threshold}</span>)}</div>}</div>}
      <div className="compareTable"><div className="compareRow compareHeader"><span>Motor</span><span>Estado</span><span>Achados</span><span>Latência</span></div>{[...(res.results||[])].sort((a,b)=>(a.latency_ms||0)-(b.latency_ms||0)).map(r=><div className="compareRow" key={r.engine_id}><span>{r.name}</span><span>{txt[r.status]||r.status}</span><span>{r.detections?.length||0}</span><span>{Number(r.latency_ms||0).toFixed(0)} ms</span></div>)}</div>
      <div className="grid">{prev&&<article className="card originalCard"><div className="head"><div><h3>Imagem original</h3><span className="badge">Entrada comum</span></div></div><img src={prev}/><div className="metrics"><span>Fonte usada na inferência</span></div></article>}{(res.results||[]).map(r=><Card key={r.engine_id} r={r}/>)}</div>
    </section>}
  </main>
}
