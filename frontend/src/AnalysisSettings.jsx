import React,{useState} from "react";
import {ArrowLeft,Check,ExternalLink,Info,RefreshCw,Settings2,X} from "lucide-react";
import {browserEngineRevision} from "./browserEngines.js";
import "./analysis-settings.css";

const REMOTE_REVISIONS="https://raw.githubusercontent.com/aaronkadima/SHM/main/frontend/src/browser-engine-revisions.json";

export default function AnalysisSettings({engines,selected,toggle,onBack,individualDraft,setIndividualDraft,comparatorDraft,setComparatorDraft,saveIndividual,saveComparator,testIndividual,testComparator,individualOnline,comparatorOnline,inspectionMeta,updateInspectionMeta,error}){
  const[infoEngine,setInfoEngine]=useState(null);
  const[revisionState,setRevisionState]=useState({});

  async function checkRevision(engine){
    const local=browserEngineRevision(engine.id)||engine.browser_revision||null;
    if(!engine.browser_ready){
      setRevisionState(s=>({...s,[engine.id]:{status:"backend",local}}));
      return;
    }
    setRevisionState(s=>({...s,[engine.id]:{status:"checking",local}}));
    try{
      const r=await fetch(REMOTE_REVISIONS+"?ts="+Date.now(),{cache:"no-store"});
      if(!r.ok)throw new Error("HTTP "+r.status);
      const remote=await r.json(),repository=remote?.[engine.id]||null;
      const status=!repository?"unknown":local===repository?"current":"update";
      setRevisionState(s=>({...s,[engine.id]:{status,local,repository}}));
    }catch(e){
      setRevisionState(s=>({...s,[engine.id]:{status:"error",local,message:e?.message||String(e)}}));
    }
  }

  function revisionLabel(engine){
    const st=revisionState[engine.id];
    if(!st)return engine.browser_ready?"Browser local":"Backend";
    if(st.status==="checking")return"Verificando repositório…";
    if(st.status==="current")return"Código browser atualizado";
    if(st.status==="update")return"Atualização disponível no repositório";
    if(st.status==="backend")return"Execução gerenciada por backend";
    if(st.status==="unknown")return"Revisão não publicada no manifesto";
    if(st.status==="error")return"Falha ao verificar atualização";
    return"";
  }

  return <section className="analysisSettings" aria-label="Configurações da análise">
    <header className="settingsTop"><div><span className="editorMark">S</span><b>SHM Studio</b></div><button onClick={onBack}><ArrowLeft size={16}/> Voltar ao canvas</button></header>
    <main className="settingsContent">
      <div className="settingsHeading"><Settings2 size={22}/><div><h1>Configurações da análise</h1><p>Defina os motores antes de executar a inspeção.</p></div></div>
      <div className="analysisSettingsCard"><h2>Motores disponíveis</h2><p>Um motor executa uma análise individual. Dois ou mais ativam a comparação.</p>
        <div className="settingsEngines">{engines.map(e=>{
          const state=revisionState[e.id];
          return <div key={e.id} className={"settingsEngine "+(selected.includes(e.id)?"selected":"")}>
            <div className="settingsEngineCopy"><b>{e.name}</b><small>{e.family} · {e.task.replaceAll("_"," ")}</small><em>{e.browser_ready?"Browser":"Backend"}{e.recommended?" · recomendado":""}</em></div>
            <div className="settingsEngineTools">
              <button className="settingsIconButton" type="button" onClick={()=>checkRevision(e)} title={e.browser_ready?"Verificar se o código browser é o mesmo do repositório":"Ver informações de execução do backend"} aria-label={"Verificar atualização de "+e.name}><RefreshCw size={15} className={state?.status==="checking"?"spin":""}/></button>
              <button className="settingsIconButton" type="button" onClick={()=>setInfoEngine(e)} title="Informações do motor" aria-label={"Informações de "+e.name}><Info size={15}/></button>
              <label className="settingsToggle" title={selected.includes(e.id)?"Desativar motor":"Ativar motor"}>
                <input type="checkbox" checked={selected.includes(e.id)} onChange={()=>toggle(e.id)}/>
                <span className="settingsSwitch" aria-hidden="true"/>
              </label>
            </div>
            <div className={"settingsRevision "+(state?.status||"idle")}>{revisionLabel(e)}{state?.status==="update"&&<small>Local: {state.local||"—"} · Repositório: {state.repository||"—"}</small>}</div>
          </div>
        })}</div>
      </div>
      <details className="analysisSettingsCard"><summary>Conexões dos motores</summary><p>Os motores com execução no navegador funcionam diretamente. Os demais exigem um backend standalone acessível por HTTPS. O comparador atende apenas seleções de dois ou mais motores.</p>
        <label className="settingsField">Backend individual<input type="url" placeholder="https://seu-backend-standalone.exemplo" value={individualDraft} onChange={e=>setIndividualDraft(e.target.value)}/></label><div className="analysisSettingsActions"><button onClick={saveIndividual}>Salvar endereço</button><button onClick={testIndividual}>Testar conexão</button><span>{individualOnline===true?"Conectado":individualOnline===false?"Indisponível":""}</span></div>
        <label className="settingsField">Comparador<input value={comparatorDraft} onChange={e=>setComparatorDraft(e.target.value)}/></label><div className="analysisSettingsActions"><button onClick={saveComparator}>Salvar endereço</button><button onClick={testComparator}>Testar conexão</button><span>{comparatorOnline===true?"Conectado":comparatorOnline===false?"Indisponível":""}</span></div>
      </details>
      <details className="analysisSettingsCard"><summary>Identificação da inspeção</summary><div className="settingsMeta">{[["oae_id","OAE / estrutura"],["element_id","Elemento"],["source_id","Fonte / câmera"],["inspection_label","Campanha / inspeção"]].map(([key,label])=><label className="settingsField" key={key}>{label}<input value={inspectionMeta[key]} onChange={e=>updateInspectionMeta(key,e.target.value)}/></label>)}</div></details>
      {error&&<p className="settingsError" role="alert">{error}</p>}
      <div className="settingsBottom"><span>{selected.length} motor(es) selecionado(s)</span><button onClick={onBack}><Check size={16}/> Aplicar e voltar ao canvas</button></div>
    </main>

    {infoEngine&&<div className="engineInfoBackdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setInfoEngine(null)}}>
      <section className="engineInfoDialog" role="dialog" aria-modal="true" aria-label={"Informações de "+infoEngine.name}>
        <header><div><span>Motor</span><h2>{infoEngine.name}</h2></div><button type="button" onClick={()=>setInfoEngine(null)} aria-label="Fechar informações"><X size={18}/></button></header>
        <p>{infoEngine.description||"Sem descrição cadastrada."}</p>
        <dl>
          <div><dt>Família</dt><dd>{infoEngine.family||"—"}</dd></div>
          <div><dt>Tarefa</dt><dd>{(infoEngine.task||"—").replaceAll("_"," ")}</dd></div>
          <div><dt>Execução</dt><dd>{infoEngine.browser_ready?"Browser local":"Backend / runtime externo"}</dd></div>
          <div><dt>Modo</dt><dd>{infoEngine.domain_mode||"—"}</dd></div>
          <div><dt>Recomendado</dt><dd>{infoEngine.recommended?"Sim":"Não"}</dd></div>
          <div><dt>Revisão browser</dt><dd>{browserEngineRevision(infoEngine.id)||infoEngine.browser_revision||"—"}</dd></div>
          {infoEngine.license&&<div><dt>Licença</dt><dd>{infoEngine.license}</dd></div>}
        </dl>
        <footer>
          {infoEngine.source_url&&<a href={infoEngine.source_url} target="_blank" rel="noreferrer"><ExternalLink size={14}/> Fonte do modelo</a>}
          <button type="button" onClick={()=>checkRevision(infoEngine)}><RefreshCw size={14}/> Verificar atualização</button>
        </footer>
      </section>
    </div>}
  </section>
}
