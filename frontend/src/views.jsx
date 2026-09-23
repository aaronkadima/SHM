import React,{useMemo}from"react";
import{
  Layers3,LayoutDashboard,Camera,Activity,Bell,FileText,Cpu,Settings,
  CheckCircle2,Wifi,WifiOff,Clock3,ExternalLink,Download,FileJson,FileSpreadsheet,
  ShieldCheck,MonitorCog,CloudCog,AlertTriangle,Search,Database,Image as ImageIcon
}from"lucide-react";

const NAV=[
  ["dashboard",LayoutDashboard,"Dashboard"],
  ["cameras",Camera,"Câmeras"],
  ["analysis",Activity,"Análise"],
  ["alerts",Bell,"Alertas"],
  ["reports",FileText,"Relatórios"],
  ["engines",Cpu,"Motores"],
  ["settings",Settings,"Config."]
];

function engineModeLabel(e){
  if(e.domain_mode==="public_shm_checkpoint")return"Checkpoint SHM público";
  if(e.domain_mode==="zero_shot")return"Zero-shot";
  if(e.domain_mode==="classical")return"Baseline clássico";
  if(e.domain_mode==="shm_checkpoint")return"Checkpoint SHM local";
  if(e.domain_mode==="generic_pretrained")return"Pré-treinado genérico";
  if(e.domain_mode==="optional_runtime")return"Runtime opcional";
  return e.domain_mode||"Registrado";
}
const CDM_PATHOLOGY_LABELS={cracks:"Fissuras",spalling_dark:"Desplacamento",exposed_rebar:"Armadura exposta",corrosion_rust:"Corrosão",efflorescence_white:"Eflorescência"};
function campaignSummaries(history){
  const groups=new Map();
  for(const row of history||[]){
    const oae=String(row.inspection?.oae_id||"").trim();
    const element=String(row.inspection?.element_id||"").trim();
    if(!oae||!element)continue;
    const key=oae+"::"+element;
    if(!groups.has(key))groups.set(key,{key,oae,element,items:[]});
    groups.get(key).items.push(row);
  }
  return [...groups.values()].map(group=>{
    group.items.sort((a,b)=>new Date(a.created_at||0)-new Date(b.created_at||0));
    const latest=group.items.at(-1),first=group.items[0];
    const validated=group.items.filter(x=>x.summary?.temporal_quality?.validated===true).length;
    const failed=group.items.filter(x=>x.summary?.temporal_quality?.status==="fail").length;
    return {...group,latest,first,validated,failed};
  }).sort((a,b)=>new Date(b.latest?.created_at||0)-new Date(a.latest?.created_at||0));
}
function formatCampaignDate(value){
  if(!value)return"—";
  const date=new Date(value);
  return Number.isNaN(date.getTime())?"—":date.toLocaleDateString("pt-BR");
}
function formatSigned(value,digits=1){
  if(value==null||value==="")return"—";
  const n=Number(value);
  if(!Number.isFinite(n))return"—";
  return (n>0?"+":"")+n.toFixed(digits);
}

function campaignConditionSeries(group){
  return (group.items||[]).map(item=>{
    const condition=item.summary?.cdm_snapshot?.condition;
    return condition?{
      id:item.id,
      created_at:item.created_at,
      label:item.inspection?.inspection_label||item.inspection?.source_id||item.file_meta?.name||"inspeção",
      NT:condition.NT_img==null?null:Number(condition.NT_img),
      EC:condition.EC_DNIT_img==null?null:Number(condition.EC_DNIT_img),
      GDE:Number(condition.GDE_img||0),
      GDE_level:condition.GDE_level||""
    }:null;
  }).filter(Boolean);
}
function campaignTemporalEvents(group){
  const events=[];
  for(const item of group.items||[]){
    if(item.summary?.temporal_quality?.validated!==true)continue;
    const snapshot=item.summary?.cdm_snapshot;
    for(const [cls,st] of Object.entries(snapshot?.validated_temporal_by_class||{})){
      events.push({
        id:item.id+"::"+cls,
        inspection_id:item.id,
        created_at:item.created_at,
        inspection_label:item.inspection?.inspection_label||"",
        source_id:item.inspection?.source_id||"",
        pathology:cls,
        pathology_label:CDM_PATHOLOGY_LABELS[cls]||cls,
        previous_area_px2:st.previous_area_px2,
        current_area_px2:st.current_area_px2,
        net_area_change_px2:st.net_area_change_px2,
        net_area_change_vs_t0_pct:st.net_area_change_vs_t0_pct,
        previous_area_mm2:st.previous_area_mm2,
        current_area_mm2:st.current_area_mm2,
        net_area_change_mm2:st.net_area_change_mm2,
        quality:item.summary?.temporal_quality||null,
        alignment:item.summary?.temporal_alignment||null
      });
    }
  }
  return events.sort((a,b)=>new Date(a.created_at||0)-new Date(b.created_at||0));
}
function downloadCampaignFile(name,type,text){
  const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),500);
}
function campaignFileStem(group){
  const clean=value=>String(value||"campanha").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9_-]+/g,"-").replace(/^-+|-+$/g,"").toLowerCase();
  return "shm-campanha-"+clean(group.oae)+"-"+clean(group.element);
}
function exportCampaignJson(group){
  const condition_series=campaignConditionSeries(group);
  const validated_temporal_events=campaignTemporalEvents(group);
  const payload={
    schema:"shm_cdm_campaign_v1",
    generated_at:new Date().toISOString(),
    oae_id:group.oae,
    element_id:group.element,
    inspection_count:group.items.length,
    first_inspection_at:group.first?.created_at||null,
    latest_inspection_at:group.latest?.created_at||null,
    note:"Somente snapshots persistidos e deltas temporais previamente validados. Não há interpolação, extrapolação ou acumulação de crescimento.",
    condition_series,
    validated_temporal_events,
    inspections:group.items.map(item=>({
      id:item.id,
      created_at:item.created_at,
      inspection:item.inspection||{},
      file_meta:item.file_meta||{},
      summary:item.summary||{}
    }))
  };
  downloadCampaignFile(campaignFileStem(group)+".json","application/json;charset=utf-8",JSON.stringify(payload,null,2));
}
function campaignCsvCell(value){
  const text=value==null?"":String(value);
  return '"'+text.replaceAll('"','""')+'"';
}
function exportCampaignCsv(group){
  const rows=[[
    "record_type","inspection_id","date","oae_id","element_id","inspection_label","source_id",
    "pathology","metric","value","unit","quality_status","validated","notes"
  ]];
  for(const point of campaignConditionSeries(group)){
    for(const [metric,value] of [["NT_img",point.NT],["EC_DNIT_img",point.EC],["GDE_img",point.GDE]]){
      rows.push(["condition",point.id,point.created_at,group.oae,group.element,point.label,"","",metric,value,"", "",true,point.GDE_level||""]);
    }
  }
  for(const event of campaignTemporalEvents(group)){
    const calibrated=event.net_area_change_mm2!=null;
    const metrics=[
      ["net_area_change",calibrated?event.net_area_change_mm2:event.net_area_change_px2,calibrated?"mm2":"px2"],
      ["net_area_change_vs_t0_pct",event.net_area_change_vs_t0_pct,"%"]
    ];
    for(const [metric,value,unit] of metrics){
      rows.push(["temporal",event.inspection_id,event.created_at,group.oae,group.element,event.inspection_label,event.source_id,event.pathology,metric,value,unit,event.quality?.status||"",true,event.pathology_label]);
    }
  }
  const body="\uFEFF"+rows.map(row=>row.map(campaignCsvCell).join(";")).join("\n");
  downloadCampaignFile(campaignFileStem(group)+".csv","text/csv;charset=utf-8",body);
}
function CampaignSparkline({points}){
  const values=(points||[]).map(p=>Number(p.GDE)).filter(Number.isFinite);
  if(values.length<2)return <span className="campaignSparkEmpty">tendência insuficiente</span>;
  const width=150,height=34,pad=3,min=Math.min(...values),max=Math.max(...values),span=Math.max(max-min,1);
  const coords=values.map((v,i)=>{
    const x=pad+i*(width-2*pad)/Math.max(1,values.length-1);
    const y=height-pad-(v-min)*(height-2*pad)/span;
    return [x,y];
  });
  return <svg className="campaignSpark" viewBox={"0 0 "+width+" "+height} role="img" aria-label="Tendência GDE registrada"><polyline points={coords.map(p=>p.join(",")).join(" ")} fill="none" stroke="currentColor" strokeWidth="1.7"/>{coords.map((p,i)=><circle key={i} cx={p[0]} cy={p[1]} r="2" fill="currentColor"/>)}</svg>;
}

function detectionsFrom(res){
  const out=[];
  for(const r of res?.results||[]){
    for(const d of r.detections||[])out.push({...d,engine_id:r.engine_id,engine_name:r.name,status:r.status});
  }
  return out.sort((a,b)=>(b.score||0)-(a.score||0));
}
function SectionHead({eyebrow,title,description,actions}){
  return <div className="viewHead">
    <div><span>{eyebrow}</span><h2>{title}</h2>{description&&<p>{description}</p>}</div>
    {actions&&<div className="viewActions">{actions}</div>}
  </div>
}
function EmptyView({icon:Icon=Database,title,children,action}){
  return <div className="viewEmpty"><Icon size={30}/><b>{title}</b><p>{children}</p>{action}</div>
}

export function NavRail({active,onSelect}){
  return <aside className="navRail">
    <button className="navLogo" onClick={()=>onSelect("dashboard")} title="SHM Vision Lab"><Layers3 size={22}/></button>
    <nav>{NAV.map(([key,Icon,label])=><button key={key} onClick={()=>onSelect(key)} className={active===key?"active":""} title={label}><Icon size={19}/><span>{label}</span></button>)}</nav>
  </aside>
}

export function DashboardView({engines,res,selected,prev,comparatorOnline,individualOnline,history,inspection,onNavigate}){
  const detections=detectionsFrom(res);
  const successful=(res?.results||[]).filter(r=>r.status==="ok").length;
  const failed=(res?.results||[]).filter(r=>r.status!=="ok").length;
  const preview=res?.consensus_overlay_png_base64
    ?"data:image/png;base64,"+res.consensus_overlay_png_base64
    :(res?.results||[]).find(r=>r.overlay_png_base64)?.overlay_png_base64
      ?"data:image/png;base64,"+(res.results.find(r=>r.overlay_png_base64)?.overlay_png_base64)
      :prev;
  return <section className="viewPage">
    <SectionHead eyebrow="VISÃO OPERACIONAL" title="Dashboard" description="Estado atual da sessão de inspeção e dos runtimes configurados." actions={<button onClick={()=>onNavigate("analysis")}>Abrir análise <Activity size={14}/></button>}/>
    <div className="kpiGrid">
      <div className="kpiCard"><span>MOTORES REGISTRADOS</span><b>{engines.length}</b><small>{engines.filter(e=>e.recommended).length} recomendados</small></div>
      <div className="kpiCard"><span>SELECIONADOS</span><b>{selected.length}</b><small>{selected.length===1?"modo individual":selected.length>=2?"comparação multi-engine":"nenhum"}</small></div>
      <div className="kpiCard"><span>ACHADOS DA SESSÃO</span><b>{detections.length}</b><small>{res?"dados da última execução":"sem execução nesta sessão"}</small></div>
      <div className="kpiCard"><span>INSPEÇÕES SALVAS</span><b>{history?.length||0}</b><small>{successful?successful+" motores concluídos na sessão":failed?failed+" com pendência/erro":"histórico local persistente"}</small></div>
    </div>
    <div className="dashboardGrid">
      <article className="surface liveSurface">
        <div className="surfaceHead"><div><b>INSPEÇÃO DA SESSÃO</b><span>{res?"Último resultado disponível":"Nenhum resultado processado"}</span></div><span className={"statusPill "+(res?"success":"neutral")}>{res?"RESULTADO":"AGUARDANDO"}</span></div>
        <div className="dashboardPreview">{preview?<img src={preview} alt="Inspeção atual"/>:<EmptyView icon={ImageIcon} title="Nenhuma imagem carregada">Carregue uma imagem na tela de Análise para iniciar a sessão.</EmptyView>}</div>
        <div className="previewFoot"><span>{res?res.image_width+" × "+res.image_height+" px":"Entrada visual não definida"} · {inspection?.oae_id||"OAE não identificada"} · {inspection?.element_id||"elemento não identificado"}</span><span>{res?.metadata?.generated_at?new Date(res.metadata.generated_at).toLocaleString("pt-BR"):"—"}</span></div>
      </article>
      <div className="dashboardSide">
        <article className="surface runtimeSummary">
          <div className="surfaceHead"><div><b>RUNTIMES</b><span>Conectividade observada nesta sessão</span></div></div>
          <div className="runtimeLine"><MonitorCog size={16}/><div><b>Standalone</b><span>Inferência individual</span></div><strong className={individualOnline===true?"good":individualOnline===false?"bad":""}>{individualOnline===true?"ONLINE":individualOnline===false?"OFFLINE":"NÃO TESTADO"}</strong></div>
          <div className="runtimeLine"><CloudCog size={16}/><div><b>Railway Comparator</b><span>Somente 2+ motores</span></div><strong className={comparatorOnline===true?"good":comparatorOnline===false?"bad":""}>{comparatorOnline===true?"ONLINE":comparatorOnline===false?"OFFLINE":"NÃO TESTADO"}</strong></div>
          <div className="runtimeLine"><ShieldCheck size={16}/><div><b>Browser</b><span>Execução sem servidor</span></div><strong className="good">{engines.filter(e=>e.browser_ready).length} MOTORES</strong></div>
        </article>
        <article className="surface">
          <div className="surfaceHead"><div><b>ACHADOS RECENTES</b><span>Somente dados reais da última execução</span></div></div>
          <div className="eventList">{detections.length?detections.slice(0,6).map((d,i)=><div className="eventRow" key={(d.engine_id||"e")+"-"+i}><i/><div><b>{d.canonical_label||d.label||"Achado"}</b><span>{d.engine_name||d.engine_id||"motor"} · {d.score!=null?(d.score*100).toFixed(1)+"%":"sem confiança"}</span></div><small>REVISAR</small></div>):<div className="compactEmpty">Nenhum achado disponível nesta sessão.</div>}</div>
        </article>
      </div>
    </div>
  </section>
}

export function CamerasView({prev,res,inspection,onNavigate}){
  return <section className="viewPage">
    <SectionHead eyebrow="ENTRADA VISUAL" title="Câmeras & fontes" description="A versão atual trabalha com imagem de inspeção carregada pelo usuário; streaming de câmera ainda não está conectado ao backend." actions={<button onClick={()=>onNavigate("analysis")}>Carregar imagem <Camera size={14}/></button>}/>
    <div className="cameraGrid">
      <article className="surface cameraPrimary">
        <div className="surfaceHead"><div><b>FONTE DA SESSÃO</b><span>Imagem usada pelos motores selecionados</span></div><span className={"statusPill "+(prev?"success":"neutral")}>{prev?"CARREGADA":"SEM FONTE"}</span></div>
        <div className="cameraViewport">{prev?<img src={prev} alt="Fonte de inspeção"/>:<EmptyView icon={Camera} title="Sem fonte de câmera">Nenhuma imagem foi carregada nesta sessão.</EmptyView>}</div>
      </article>
      <article className="surface sourceMeta">
        <div className="surfaceHead"><div><b>METADADOS</b><span>Disponíveis na sessão atual</span></div></div>
        <dl><div><dt>Origem</dt><dd>{prev?"Upload do navegador":"—"}</dd></div><div><dt>OAE / estrutura</dt><dd>{inspection?.oae_id||"—"}</dd></div><div><dt>Elemento</dt><dd>{inspection?.element_id||"—"}</dd></div><div><dt>Fonte / câmera</dt><dd>{inspection?.source_id||"—"}</dd></div><div><dt>Campanha</dt><dd>{inspection?.inspection_label||"—"}</dd></div><div><dt>Dimensão processada</dt><dd>{res?res.image_width+" × "+res.image_height+" px":"—"}</dd></div><div><dt>Análise</dt><dd>{res?.metadata?.analysis_id?String(res.metadata.analysis_id).slice(0,18):"—"}</dd></div><div><dt>Streaming</dt><dd>Não configurado</dd></div></dl>
        <div className="scienceWarning"><AlertTriangle size={16}/><span>O painel não declara uma transmissão ao vivo enquanto nenhuma fonte de vídeo estiver implementada.</span></div>
      </article>
    </div>
  </section>
}

export function EnginesView({engines,visibleEng,engineQuery,setEngineQuery,engineFilter,setEngineFilter,browserReady,recommended,cloudVerified,sel,toggle,selectRecommended,selectVerified,clearSelection,individualOnline,comparatorOnline}){
  return <section className="viewPage">
    <SectionHead eyebrow="CATÁLOGO & RUNTIME" title="Motores" description="Inventário dos motores registrados no repositório, seus modos de execução e disponibilidade declarada."/>
    <div className="kpiGrid engineKpis">
      <div className="kpiCard"><span>TOTAL</span><b>{engines.length}</b><small>motores registrados</small></div>
      <div className="kpiCard"><span>BROWSER</span><b>{browserReady}</b><small>execução sem servidor</small></div>
      <div className="kpiCard"><span>RECOMENDADOS</span><b>{recommended}</b><small>marcados no catálogo</small></div>
      <div className="kpiCard"><span>CLOUD VERIFICADO</span><b>{cloudVerified}</b><small>perfil cloud validado</small></div>
    </div>
    <div className="runtimeStrip">
      <span><MonitorCog size={15}/> Standalone <b className={individualOnline===true?"good":individualOnline===false?"bad":""}>{individualOnline===true?"online":individualOnline===false?"offline":"não testado"}</b></span>
      <span><CloudCog size={15}/> Comparator <b className={comparatorOnline===true?"good":comparatorOnline===false?"bad":""}>{comparatorOnline===true?"online":comparatorOnline===false?"offline":"não testado"}</b></span>
    </div>
    <article className="surface enginesSurface">
      <div className="catalogToolbar">
        <div className="searchBox"><Search size={14}/><input value={engineQuery} onChange={e=>setEngineQuery(e.target.value)} placeholder="Buscar motor, família ou tarefa..."/></div>
        <select value={engineFilter} onChange={e=>setEngineFilter(e.target.value)}>
          <option value="all">Todos ({engines.length})</option><option value="browser">Direto no navegador ({browserReady})</option><option value="recommended">Recomendados ({recommended})</option><option value="verified">Cloud verificados ({cloudVerified})</option><option value="public">Checkpoints SHM públicos</option><option value="optional">Requerem configuração/runtime</option>
        </select>
        <button onClick={selectRecommended}>Recomendados</button><button onClick={selectVerified}>Cloud</button><button onClick={clearSelection}>Limpar</button>
      </div>
      <div className="engineTable">
        <div className="engineTableHead"><span></span><span>Motor</span><span>Família / tarefa</span><span>Modo</span><span>Flags</span></div>
        {visibleEng.map(e=><label className="engineTableRow" key={e.id}>
          <input type="checkbox" checked={sel.has(e.id)} onChange={()=>toggle(e.id)}/>
          <div><b>{e.name}</b>{e.description&&<small>{e.description}</small>}</div>
          <span>{e.family} · {(e.task||"").replaceAll("_"," ")}</span>
          <span>{engineModeLabel(e)}</span>
          <div className="flagGroup">{e.browser_ready&&<em>browser</em>}{e.recommended&&<em>recomendado</em>}{e.cloud_verified&&<em>cloud</em>}{e.source_url&&<a href={e.source_url} target="_blank" rel="noreferrer">fonte <ExternalLink size={10}/></a>}</div>
        </label>)}
        {!visibleEng.length&&<div className="compactEmpty">Nenhum motor corresponde ao filtro atual.</div>}
      </div>
    </article>
  </section>
}

export function AlertsView({res,history,historyBusy,historyErr,onOpenHistory,onUseAsReference,onDeleteHistory,onClearHistory,onNavigate}){
  const detections=detectionsFrom(res);
  const errors=(res?.results||[]).filter(r=>r.status!=="ok");
  const campaigns=useMemo(()=>campaignSummaries(history),[history]);
  return <section className="viewPage">
    <SectionHead eyebrow="EVENTOS & PERSISTÊNCIA" title="Alertas & histórico" description="Achados da sessão atual e inspeções persistidas no IndexedDB deste navegador, incluindo imagem original, metadados e resultados." actions={<><button onClick={()=>onNavigate("analysis")}>Nova análise <Activity size={14}/></button>{history?.length>0&&<button className="dangerAction" onClick={onClearHistory}>Limpar histórico</button>}</>}/>
    <div className="alertSummary">
      <div><b>{detections.length}</b><span>achados da sessão</span></div>
      <div><b>{errors.length}</b><span>motores com pendência</span></div>
      <div><b>{history?.length||0}</b><span>inspeções persistidas</span></div>
      <div><b>{campaigns.length}</b><span>campanhas identificadas</span></div>
    </div>
    {campaigns.length>0&&<article className="surface campaignSurface">
      <div className="surfaceHead"><div><b>CAMPANHAS POR OAE / ELEMENTO</b><span>Agrupamento local baseado somente nas inspeções salvas; nenhuma imagem antiga é recalculada</span></div><span className="statusPill neutral">{campaigns.length} GRUPOS</span></div>
      <div className="campaignList">{campaigns.map(group=>{
        const latest=group.latest,condition=latest.summary?.cdm_snapshot?.condition;
        const latestTemporal=latest.summary?.temporal_quality;
        const conditionSeries=campaignConditionSeries(group);
        const temporalEvents=campaignTemporalEvents(group);
        return <details className="campaignCard" key={group.key}>
          <summary>
            <span><b>{group.oae}</b><small>{group.element}</small></span>
            <span><b>{group.items.length}</b><small>inspeções</small></span>
            <span><b>{formatCampaignDate(group.first?.created_at)} → {formatCampaignDate(group.latest?.created_at)}</b><small>{group.validated} temporal(is) validada(s){group.failed?" · "+group.failed+" reprovada(s)":""}</small></span>
            <span>{condition?<><b>NT {condition.NT_img} · EC {condition.EC_DNIT_img}</b><small>GDE {Number(condition.GDE_img||0).toFixed(2)} · {condition.GDE_level||"—"}</small></>:<><b>Sem classificação</b><small>snapshot CDM ausente</small></>}</span>
            <span className={"campaignQuality "+(latestTemporal?.status||"unknown")}>{latestTemporal?.status==="pass"?"APROVADA":latestTemporal?.status==="warning"?"RESSALVAS":latestTemporal?.status==="fail"?"NÃO VALIDADA":"SEM TEMPORAL"}</span>
          </summary>
          <div className="campaignOverview">
            <div className="campaignTrendBlock"><span>GDE REGISTRADO</span><CampaignSparkline points={conditionSeries}/><small>{conditionSeries.length>=2?formatSigned(conditionSeries.at(-1).GDE-conditionSeries[0].GDE,2)+" desde o primeiro snapshot":"mínimo de 2 snapshots classificados"}</small></div>
            <div className="campaignAuditStats"><span><b>{conditionSeries.length}</b><small>snapshots classificados</small></span><span><b>{temporalEvents.length}</b><small>deltas temporais validados</small></span><span><b>{group.items.length-conditionSeries.length}</b><small>sem snapshot de condição</small></span></div>
            <div className="campaignExportActions"><button onClick={e=>{e.preventDefault();onUseAsReference?.(group.latest.id)}}><Activity size={12}/> Nova t1 · último como t0</button><button onClick={e=>{e.preventDefault();exportCampaignCsv(group)}}><FileSpreadsheet size={12}/> CSV campanha</button><button onClick={e=>{e.preventDefault();exportCampaignJson(group)}}><FileJson size={12}/> JSON campanha</button></div>
          </div>
          {temporalEvents.length>0&&<div className="campaignTemporalEvents"><div className="campaignTemporalHead"><b>DELTAS TEMPORAIS VALIDADOS</b><span>Par a par; sem acumulação automática</span></div>{temporalEvents.slice().reverse().map(event=><div className="campaignTemporalRow" key={event.id}><span><b>{formatCampaignDate(event.created_at)}</b><small>{event.inspection_label||event.source_id||"inspeção"}</small></span><span><b>{event.pathology_label}</b><small>{event.quality?.status||"validada"}</small></span><span><b>{event.net_area_change_vs_t0_pct==null?"—":formatSigned(event.net_area_change_vs_t0_pct)+"%"}</b><small>Δ/t0</small></span><span><b>{event.net_area_change_mm2!=null?formatSigned(event.net_area_change_mm2,1)+" mm²":formatSigned(event.net_area_change_px2,0)+" px²"}</b><small>Δ líquido</small></span></div>)}</div>}
          <div className="campaignTimeline">{group.items.slice().reverse().map(item=>{
            const snap=item.summary?.cdm_snapshot,cond=snap?.condition,quality=item.summary?.temporal_quality;
            const deltas=snap?.validated_temporal_by_class||{};
            const strongest=Object.entries(deltas).sort((a,b)=>Math.abs(Number(b[1]?.net_area_change_vs_t0_pct||0))-Math.abs(Number(a[1]?.net_area_change_vs_t0_pct||0)))[0];
            return <div className="campaignEvent" key={item.id}>
              <span><b>{formatCampaignDate(item.created_at)}</b><small>{item.inspection?.inspection_label||item.inspection?.source_id||item.file_meta?.name||"inspeção"}</small></span>
              <span>{snap?<><b>{snap.total_objects} achados</b><small>{cond?"NT "+cond.NT_img+" · EC "+cond.EC_DNIT_img+" · GDE "+Number(cond.GDE_img||0).toFixed(2):"sem classificação"}</small></>:<><b>{item.summary?.detections||0} achados</b><small>registro anterior ao snapshot CDM</small></>}</span>
              <span>{strongest&&quality?.validated?<><b>{CDM_PATHOLOGY_LABELS[strongest[0]]||strongest[0]}</b><small>Δ/t0 {strongest[1]?.net_area_change_vs_t0_pct==null?"—":formatSigned(strongest[1]?.net_area_change_vs_t0_pct)+"%"}</small></>:<><b>{quality?.status==="fail"?"Temporal não validada":"Sem Δ validado"}</b><small>{quality?.issues?.join(", ")||"—"}</small></>}</span>
              <button onClick={()=>onOpenHistory(item.id,"reports")}>Abrir</button>
            </div>
          })}</div>
        </details>
      })}</div>
    </article>}
    <article className="surface historySurface">
      <div className="surfaceHead"><div><b>HISTÓRICO DE INSPEÇÕES</b><span>{historyBusy?"Carregando registros...":"Persistência local independente do Railway"}</span></div><span className="statusPill success">INDEXEDDB</span></div>
      {historyErr&&<div className="historyError">{historyErr}</div>}
      {history?.length?<div className="historyList">
        <div className="historyRow historyHeader"><span>Data</span><span>OAE / elemento</span><span>Fonte</span><span>Modo</span><span>Achados</span><span>Ações</span></div>
        {history.map(h=><div className="historyRow" key={h.id}>
          <span>{h.created_at?new Date(h.created_at).toLocaleString("pt-BR"):"—"}</span>
          <span><b>{h.inspection?.oae_id||"OAE não identificada"}</b><small>{h.inspection?.element_id||"elemento não identificado"}{h.inspection?.inspection_label?" · "+h.inspection.inspection_label:""}</small></span>
          <span>{h.inspection?.source_id||h.file_meta?.name||"—"}{h.summary?.has_reference_image?<small>t0: {h.reference_file_meta?.name||"referência salva"}</small>:null}</span>
          <span>{h.summary?.mode||"—"} · {h.summary?.engines_total||0} motor(es){h.summary?.temporal_comparison?<small>t0→t1{h.summary?.temporal_alignment?.accepted?` · Δx ${h.summary.temporal_alignment.dx_px}px · Δy ${h.summary.temporal_alignment.dy_px}px`:" · sem translação"} · {h.summary?.temporal_quality?.status==="pass"?"qualidade aprovada":h.summary?.temporal_quality?.status==="warning"?"com ressalvas":h.summary?.temporal_quality?.status==="fail"?"não validada":"qualidade não informada"}</small>:null}</span>
          <span>{h.summary?.detections||0}</span>
          <span className="historyActions"><button onClick={()=>onOpenHistory(h.id,"reports")}>Abrir</button><button className="dangerAction" onClick={()=>onDeleteHistory(h.id)}>Excluir</button></span>
        </div>)}
      </div>:<div className="compactEmpty">{historyBusy?"Carregando histórico...":"Nenhuma inspeção persistida ainda."}</div>}
    </article>
    <article className="surface alertSurface">
      <div className="surfaceHead"><div><b>LINHA DO TEMPO DA SESSÃO ATUAL</b><span>Achados normalizados da inspeção aberta</span></div></div>
      {detections.length?<div className="alertList">{detections.map((d,i)=><div className="alertRow" key={(d.engine_id||"e")+"-"+i}><i/><div className="alertTime">{res?.metadata?.generated_at?new Date(res.metadata.generated_at).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"—"}</div><div className="alertMain"><b>{d.canonical_label||d.label||"Achado sem classe"}</b><span>{d.engine_name||d.engine_id||"motor"} · {d.score!=null?"confiança "+(d.score*100).toFixed(1)+"%":"confiança não informada"}</span></div><span className="statusPill warning">REVISAR</span></div>)}</div>:<EmptyView icon={Bell} title="Nenhum alerta da sessão">Execute uma análise ou abra uma inspeção do histórico.</EmptyView>}
      {errors.length>0&&<div className="runtimeIssues"><b>Pendências de runtime</b>{errors.map(r=><span key={r.engine_id}><AlertTriangle size={13}/>{r.name}: {r.message||r.status}</span>)}</div>}
    </article>
  </section>
}

export function ReportsView({res,inspection,onJson,onCsv,onMap,onNavigate}){
  const det=detectionsFrom(res);
  const ok=(res?.results||[]).filter(r=>r.status==="ok").length;
  return <section className="viewPage">
    <SectionHead eyebrow="RELATÓRIO DA SESSÃO" title="Relatórios & exportação" description="Exportação rastreável dos resultados existentes, sem preenchimento de dados ausentes." actions={<button onClick={()=>onNavigate("analysis")}>Abrir análise <Activity size={14}/></button>}/>
    {!res?<EmptyView icon={FileText} title="Nenhum relatório disponível">Uma execução precisa ser concluída antes de gerar arquivos de relatório.</EmptyView>:<>
      <div className="reportHero surface">
        <div><span>ANÁLISE</span><h3>{String(res.metadata?.analysis_id||"sessão atual").slice(0,24)}</h3><p>{res.image_width} × {res.image_height}px · {res.metadata?.generated_at?new Date(res.metadata.generated_at).toLocaleString("pt-BR"):"data não informada"}</p></div>
        <div className="reportStats"><div><b>{(res.results||[]).length}</b><span>motores</span></div><div><b>{ok}</b><span>concluídos</span></div><div><b>{det.length}</b><span>achados</span></div><div><b>{Object.keys(res.consensus||{}).length}</b><span>classes em consenso</span></div></div>
      </div>
      <div className="reportGrid">
        <button className="exportCard" onClick={onJson}><FileJson size={23}/><div><b>JSON técnico</b><span>Resultados, metadados, boxes e métricas</span></div><Download size={16}/></button>
        <button className="exportCard" onClick={onCsv}><FileSpreadsheet size={23}/><div><b>CSV tabular</b><span>Uma linha por detecção e motor</span></div><Download size={16}/></button>
        <button className="exportCard" onClick={onMap} disabled={!res.consensus_overlay_png_base64}><ImageIcon size={23}/><div><b>Mapa de consenso</b><span>{res.consensus_overlay_png_base64?"PNG da sobreposição espacial":"Não disponível nesta execução"}</span></div><Download size={16}/></button>
      </div>
      <article className="surface reportTrace"><div className="surfaceHead"><div><b>RASTREABILIDADE</b><span>Identificação da OAE e metadados fornecidos pela execução</span></div></div><dl><div><dt>OAE / estrutura</dt><dd>{inspection?.oae_id||"—"}</dd></div><div><dt>Elemento</dt><dd>{inspection?.element_id||"—"}</dd></div><div><dt>Fonte / câmera</dt><dd>{inspection?.source_id||"—"}</dd></div><div><dt>Campanha</dt><dd>{inspection?.inspection_label||"—"}</dd></div><div><dt>API</dt><dd>{res.metadata?.api_version||"—"}</dd></div><div><dt>Modo</dt><dd>{res.metadata?.mode||"—"}</dd></div><div><dt>ID</dt><dd>{res.metadata?.analysis_id||"—"}</dd></div><div><dt>Motores</dt><dd>{(res.metadata?.engine_ids||[]).join(", ")||"—"}</dd></div></dl></article>
    </>}
  </section>
}

export function SettingsView({individualDraft,setIndividualDraft,comparatorDraft,setComparatorDraft,saveIndividual,saveComparator,testIndividual,testComparator,individualOnline,comparatorOnline,err}){
  return <section className="viewPage">
    <SectionHead eyebrow="CONFIGURAÇÃO" title="Runtimes & endpoints" description="Endereços usados pelo modo individual e pelo comparador. As configurações ficam salvas neste navegador."/>
    <div className="settingsGrid">
      <article className="surface settingsCard">
        <div className="settingsIcon"><MonitorCog size={22}/></div><div><h3>Standalone Backend</h3><p>Usado por um único motor quando não houver execução direta no navegador.</p></div>
        <input value={individualDraft} onChange={e=>setIndividualDraft(e.target.value)} placeholder="http://127.0.0.1:8001"/>
        <div className="settingsActions"><button onClick={saveIndividual}>Salvar</button><button className="outline" onClick={testIndividual}>Testar conexão</button><span className={"statusPill "+(individualOnline===true?"success":individualOnline===false?"danger":"neutral")}>{individualOnline===true?<><Wifi size={11}/> ONLINE</>:individualOnline===false?<><WifiOff size={11}/> OFFLINE</>:"NÃO TESTADO"}</span></div>
      </article>
      <article className="surface settingsCard">
        <div className="settingsIcon"><CloudCog size={22}/></div><div><h3>Railway Comparator</h3><p>Usado somente quando dois ou mais motores forem selecionados.</p></div>
        <input value={comparatorDraft} onChange={e=>setComparatorDraft(e.target.value)} placeholder="https://...up.railway.app"/>
        <div className="settingsActions"><button onClick={saveComparator}>Salvar</button><button className="outline" onClick={testComparator}>Testar conexão</button><span className={"statusPill "+(comparatorOnline===true?"success":comparatorOnline===false?"danger":"neutral")}>{comparatorOnline===true?<><Wifi size={11}/> ONLINE</>:comparatorOnline===false?<><WifiOff size={11}/> OFFLINE</>:"NÃO TESTADO"}</span></div>
      </article>
    </div>
    <div className="scienceWarning"><ShieldCheck size={16}/><span>O Railway permanece reservado à comparação multi-engine. O modo individual não é redirecionado silenciosamente para o comparador.</span></div>
    {err&&<div className="error">{err}</div>}
  </section>
}
