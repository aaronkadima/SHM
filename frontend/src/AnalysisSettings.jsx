import React from "react";
import {ArrowLeft,Check,Settings2} from "lucide-react";
import "./analysis-settings.css";

export default function AnalysisSettings({engines,selected,toggle,onBack,individualDraft,setIndividualDraft,comparatorDraft,setComparatorDraft,saveIndividual,saveComparator,testIndividual,testComparator,individualOnline,comparatorOnline,inspectionMeta,updateInspectionMeta,error}){
  return <section className="analysisSettings" aria-label="Configurações da análise">
    <header className="settingsTop"><div><span className="editorMark">S</span><b>SHM Studio</b></div><button onClick={onBack}><ArrowLeft size={16}/> Voltar ao canvas</button></header>
    <main className="settingsContent">
      <div className="settingsHeading"><Settings2 size={22}/><div><h1>Configurações da análise</h1><p>Defina os motores antes de executar a inspeção.</p></div></div>
      <div className="analysisSettingsCard"><h2>Motores disponíveis</h2><p>Um motor executa uma análise individual. Dois ou mais ativam a comparação.</p>
        <div className="settingsEngines">{engines.map(e=><label key={e.id} className="settingsEngine"><span><b>{e.name}</b><small>{e.family} · {e.task.replaceAll("_"," ")}</small></span><input type="checkbox" checked={selected.includes(e.id)} onChange={()=>toggle(e.id)}/><span className="settingsSwitch" aria-hidden="true"/></label>)}</div>
      </div>
      <details className="analysisSettingsCard"><summary>Conexões dos motores</summary><p>A execução individual usa o navegador quando o motor oferece essa opção. Outros motores exigem um backend independente. A comparação de vários motores usa o comparador configurado.</p>
        <label className="settingsField">Backend individual<input value={individualDraft} onChange={e=>setIndividualDraft(e.target.value)}/></label><div className="analysisSettingsActions"><button onClick={saveIndividual}>Salvar endereço</button><button onClick={testIndividual}>Testar conexão</button><span>{individualOnline===true?"Conectado":individualOnline===false?"Indisponível":""}</span></div>
        <label className="settingsField">Comparador<input value={comparatorDraft} onChange={e=>setComparatorDraft(e.target.value)}/></label><div className="analysisSettingsActions"><button onClick={saveComparator}>Salvar endereço</button><button onClick={testComparator}>Testar conexão</button><span>{comparatorOnline===true?"Conectado":comparatorOnline===false?"Indisponível":""}</span></div>
      </details>
      <details className="analysisSettingsCard"><summary>Identificação da inspeção</summary><div className="settingsMeta">{[["oae_id","OAE / estrutura"],["element_id","Elemento"],["source_id","Fonte / câmera"],["inspection_label","Campanha / inspeção"]].map(([key,label])=><label className="settingsField" key={key}>{label}<input value={inspectionMeta[key]} onChange={e=>updateInspectionMeta(key,e.target.value)}/></label>)}</div></details>
      {error&&<p className="settingsError" role="alert">{error}</p>}
      <div className="settingsBottom"><span>{selected.length} motor(es) selecionado(s)</span><button onClick={onBack}><Check size={16}/> Aplicar e voltar ao canvas</button></div>
    </main>
  </section>
}
