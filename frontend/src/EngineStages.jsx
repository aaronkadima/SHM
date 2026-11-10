import React,{useEffect,useRef,useState}from"react";
import{ChevronLeft,ChevronRight,Download,X}from"lucide-react";
import{computeEngineStages,engineStagesSupported,releaseEngineStages}from"./engineStages.js";

// Miniaturas flutuantes das etapas de processamento do motor escolhido; clique amplia.
export default function EngineStages({engineId,engineName,file,result,options,control,hidden=false,onState}){
  const[stages,setStages]=useState([]);
  const[status,setStatus]=useState("idle");
  const[open,setOpen]=useState(-1);
  const[collapsed,setCollapsed]=useState(false);
  const key=[engineId,file?.size,file?.lastModified,file?.type,result?.latency_ms].join("|");
  const stagesRef=useRef([]);
  useEffect(()=>{const previous=stagesRef.current;stagesRef.current=stages;if(previous!==stages)releaseEngineStages(previous.filter(p=>!stages.includes(p)))},[stages]);
  useEffect(()=>()=>releaseEngineStages(stagesRef.current),[]);
  // Pré-decodifica todas as etapas: trocar na ampliação fica instantâneo.
  useEffect(()=>{for(const s of stages){const img=new Image();img.src=s.url;img.decode?.().catch(()=>{})}},[stages]);

  useEffect(()=>{
    let cancelled=false;setStages([]);setOpen(-1);
    if(!engineId||!file||!result||!engineStagesSupported(engineId)){setStatus("idle");onState?.(false);return}
    setStatus("loading");onState?.(true);
    // Deixa o resultado principal aparecer antes de reprocessar as etapas.
    const t=setTimeout(()=>{
      computeEngineStages(engineId,file,{options,control,result}).then(list=>{if(!cancelled){setStages(list);setStatus("ready")}})
        .catch(e=>{if(!cancelled){setStatus("error:"+String(e?.message||e))}});
    },250);
    return()=>{cancelled=true;clearTimeout(t)};
  },[key]);// eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>()=>onState?.(false),[]);// eslint-disable-line react-hooks/exhaustive-deps

  useEffect(()=>{
    if(open<0)return;
    const onKey=e=>{
      if(e.key==="Escape"){e.stopPropagation();setOpen(-1)}
      else if(e.key==="ArrowRight")setOpen(i=>Math.min(stages.length-1,i+1));
      else if(e.key==="ArrowLeft")setOpen(i=>Math.max(0,i-1));
    };
    window.addEventListener("keydown",onKey,true);return()=>window.removeEventListener("keydown",onKey,true);
  },[open,stages.length]);

  if(hidden||status==="idle")return null;
  const current=open>=0?stages[open]:null,baseUrl=stages[0]?.url,baseThumb=stages[0]?.thumb||baseUrl;
  return <>
    <aside className={"engineStages"+(collapsed?" collapsed":"")} aria-label={"Etapas de processamento · "+(engineName||engineId)}>
      <button className="engineStagesHead" onClick={()=>setCollapsed(v=>!v)} aria-expanded={!collapsed} title={collapsed?"Mostrar etapas":"Recolher etapas"}>
        <b>Etapas</b><span>{status==="loading"?"…":stages.length}</span>
      </button>
      {!collapsed&&<div className="engineStagesList">
        {status==="loading"&&[0,1,2,3].map(i=><span key={i} className="engineStageSkeleton"/>)}
        {status.startsWith("error")&&<p className="engineStagesError" title={status.slice(6)}>Etapas indisponíveis</p>}
        {stages.map((s,i)=><button key={s.id} className="engineStageThumb" onClick={()=>setOpen(i)} title={s.label+" — "+s.detail} aria-label={"Ampliar etapa "+s.label}>
          <span className={"engineStageImg"+(s.transparent?" transparent":"")} style={s.transparent&&baseThumb?{backgroundImage:"url("+baseThumb+")"}:undefined}><img src={s.thumb||s.url} alt="" loading="lazy" decoding="async" className={s.lowres?"lowres":""}/></span>
          <small>{s.label.replace(/^\d+\s·\s/,"")}</small>
        </button>)}
      </div>}
    </aside>
    {current&&<div className="engineStageLightbox" role="dialog" aria-modal="true" aria-label={current.label} onClick={e=>{if(e.target===e.currentTarget)setOpen(-1)}}>
      <figure>
        <header>
          <div><b>{current.label}</b><span>{engineName||engineId} · etapa {open+1} de {stages.length}</span></div>
          <a href={current.url} download={(engineId+"-"+current.id+".png")} title="Baixar imagem da etapa" aria-label="Baixar imagem da etapa"><Download size={16}/></a>
          <button onClick={()=>setOpen(-1)} aria-label="Fechar"><X size={18}/></button>
        </header>
        <div className="engineStageLarge">
          {/* todas montadas e decodificadas; só a atual fica visível */}
          {stages.map((s,i)=><div key={s.id} className={"engineStageLayer"+(i===open?" current":"")+(s.transparent?" transparent":"")} style={s.transparent&&baseUrl?{backgroundImage:"url("+baseUrl+")"}:undefined} aria-hidden={i!==open}><img src={s.url} alt={i===open?s.label:""} decoding="async" className={s.lowres?"lowres":""}/></div>)}
        </div>
        <figcaption>{current.detail}</figcaption>
        <button className="engineStageNav prev" disabled={open===0} onClick={()=>setOpen(i=>i-1)} aria-label="Etapa anterior"><ChevronLeft size={22}/></button>
        <button className="engineStageNav next" disabled={open===stages.length-1} onClick={()=>setOpen(i=>i+1)} aria-label="Próxima etapa"><ChevronRight size={22}/></button>
      </figure>
    </div>}
  </>;
}
