import React from "react";
import {ArrowLeft,Check,Settings2} from "lucide-react";
import "./analysis-settings.css";

export default function AnalysisSettings({engines,selected,toggle,onBack,individualDraft,setIndividualDraft,comparatorDraft,setComparatorDraft,saveIndividual,saveComparator,testIndividual,testComparator,individualOnline,comparatorOnline,inspectionMeta,updateInspectionMeta,cdmOptions,setCdmOptions,error}){
  const selectedEngine=selected.length===1?engines.find(e=>e.id===selected[0]):null;
  const localBrowser=!!selectedEngine?.browser_ready;
  const needsIndividual=selected.length===1&&!localBrowser;
  const needsComparator=selected.length>=2;
  return <section className="analysisSettings" aria-label="Configurações da análise">
    <header className="settingsTop"><div><span className="editorMark">S</span><b>SHM Studio</b></div><button onClick={onBack}><ArrowLeft size={16}/> Voltar ao canvas</button></header>
    <main className="settingsContent">
      <div className="settingsHeading"><Settings2 size={22}/><div><h1>Configurações da análise</h1><p>Defina os motores antes de executar a inspeção.</p></div></div>
      <div className="analysisSettingsCard"><h2>Motores disponíveis</h2><p>Um motor executa uma análise individual. Dois ou mais ativam a comparação.</p>
        <div className="settingsEngines">{engines.map(e=><label key={e.id} className="settingsEngine"><span><b>{e.name}</b><small>{e.family} · {e.task.replaceAll("_"," ")}</small></span><input type="checkbox" checked={selected.includes(e.id)} onChange={()=>toggle(e.id)}/><span className="settingsSwitch" aria-hidden="true"/></label>)}</div>
      </div>
      {selected.includes("cdm_1")&&<details className="analysisSettingsCard"><summary>CDM-1 · Parâmetros morfológicos</summary><p>Valores iniciais da extensão CDM 2.8.5. Na análise individual, o CDM-1 executa localmente no navegador; na comparação com outros motores, o comparador usa os valores iniciais.</p><div className="settingsMeta">
        {[["cdm_threshold","Limiar T",1,255,1],["cdm_kernel_size","Kernel black-hat",3,99,1],["cdm_min_area","Área mínima (px²)",1,1000000,1],["cdm_min_aspect_ratio","Alongamento mínimo",1,50,.1],["cdm_mm_per_px","Calibração (mm/px; 0 = sem escala)",0,1000,.001]].map(([key,label,min,max,step])=><label key={key} className="settingsField">{label}<input type="number" min={min} max={max} step={step} value={cdmOptions[key]} onChange={e=>setCdmOptions(v=>({...v,[key]:Number(e.target.value)}))}/></label>)}
        <label className="settingsField">Tipo de elemento<select value={cdmOptions.cdm_element_family} onChange={e=>setCdmOptions(v=>({...v,cdm_element_family:e.target.value}))}><option value="barreiras_guarda_corpo_pista">Barreiras/pista · Fr=1</option><option value="juntas_dilatacao">Juntas · Fr=2</option><option value="transversinas_cortinas_alas">Transversinas/cortinas · Fr=3</option><option value="lajes_vigas_secundarias_apoios">Lajes/vigas secundárias/apoios · Fr=4</option><option value="vigas_pilares_principais">Vigas/pilares principais · Fr=5</option></select></label>
        <label className="settingsField">Alinhamento temporal<select value={cdmOptions.cdm_alignment_method||"translation_auto"} onChange={e=>setCdmOptions(v=>({...v,cdm_alignment_method:e.target.value}))}><option value="translation_auto">Automático · translação t0→t1</option><option value="resize">Somente redimensionar</option></select><small>O modo automático corrige translação da câmera antes de medir crescimento/redução e recua para redimensionamento quando não encontra ganho confiável. O CDM-1 também verifica sobreposição, iluminação, nitidez e exposição antes de considerar a mudança temporal válida. Rotação, mudança de escala e perspectiva ainda exigem captura compatível ou revisão externa.</small></label>
      </div></details>}
      <details className="analysisSettingsCard"><summary>Conexão de execução</summary>
        {selected.length===0&&<p>Selecione pelo menos um motor para definir o modo de execução.</p>}
        {localBrowser&&<div className="settingsRuntimeNotice"><b>{selectedEngine.name} · execução local</b><p>Este motor roda diretamente no navegador. Não é necessário configurar backend individual e a imagem não é enviada ao Railway.</p></div>}
        {needsIndividual&&<><p>Este motor exige um backend standalone acessível por HTTPS.</p><label className="settingsField">Backend individual<input type="url" placeholder="https://seu-backend-standalone.exemplo" value={individualDraft} onChange={e=>setIndividualDraft(e.target.value)}/></label><div className="analysisSettingsActions"><button onClick={saveIndividual}>Salvar endereço</button><button onClick={testIndividual}>Testar conexão</button><span>{individualOnline===true?"Conectado":individualOnline===false?"Indisponível":""}</span></div></>}
        {needsComparator&&<><p>Dois ou mais motores ativam exclusivamente o comparador cloud.</p><label className="settingsField">Comparador<input value={comparatorDraft} onChange={e=>setComparatorDraft(e.target.value)}/></label><div className="analysisSettingsActions"><button onClick={saveComparator}>Salvar endereço</button><button onClick={testComparator}>Testar conexão</button><span>{comparatorOnline===true?"Conectado":comparatorOnline===false?"Indisponível":""}</span></div></>}
      </details>
      <details className="analysisSettingsCard"><summary>Identificação da inspeção</summary><div className="settingsMeta">{[["oae_id","OAE / estrutura"],["element_id","Elemento"],["source_id","Fonte / câmera"],["inspection_label","Campanha / inspeção"]].map(([key,label])=><label className="settingsField" key={key}>{label}<input value={inspectionMeta[key]} onChange={e=>updateInspectionMeta(key,e.target.value)}/></label>)}</div></details>
      {error&&<p className="settingsError" role="alert">{error}</p>}
      <div className="settingsBottom"><span>{selected.length} motor(es) selecionado(s)</span><button onClick={onBack}><Check size={16}/> Aplicar e voltar ao canvas</button></div>
    </main>
  </section>
}
