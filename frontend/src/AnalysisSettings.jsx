import React,{useState} from "react";
import {ArrowLeft,Check,Code2,Download,ExternalLink,Info,RefreshCw,Settings2,X} from "lucide-react";
import {engineCodePackage} from "./engineCodeCatalog.js";
import "./analysis-settings.css";

export default function AnalysisSettings({appInfo,engines,selected,toggle,onBack,individualDraft,setIndividualDraft,comparatorDraft,setComparatorDraft,saveIndividual,saveComparator,testIndividual,testComparator,individualOnline,comparatorOnline,inspectionMeta,updateInspectionMeta,cdmOptions,setCdmOptions,error}){
  const ownedEngine=engines.find(e=>e.id==="cdm_1")||null;
  const otherEngines=engines.filter(e=>e.id!=="cdm_1");
  const selectedEngine=selected.length===1?engines.find(e=>e.id===selected[0]):null;
  const localBrowser=!!selectedEngine?.browser_ready;
  const needsIndividual=selected.length===1&&!localBrowser;
  const needsComparator=selected.length>=2;
  const [openCode,setOpenCode]=useState(null);
  const [openInfo,setOpenInfo]=useState(null);
  const [syncState,setSyncState]=useState({});
  const selectedStatus="Motores selecionados: "+selected.length;
  const repositoryRef=appInfo?.channel==="development"?"dev":"main";
  function exportEngineCode(engine){
    const pkg=engineCodePackage(engine);
    if(!pkg)return;
    const blob=new Blob([pkg.source],{type:"text/plain;charset=utf-8"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download=pkg.fileName;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),500);
  }
  function normalizeSource(value){return String(value||"").replace(/\r\n/g,"\n")}
  async function checkBrowserUpdate(engine){
    const pkg=engineCodePackage(engine);
    if(!pkg?.repositoryPath||pkg.repositorySource==null){
      setSyncState(v=>({...v,[engine.id]:{status:"unavailable",message:"Sem código browser local para comparar."}}));
      return;
    }
    setSyncState(v=>({...v,[engine.id]:{status:"checking",message:"Verificando repositório…"}}));
    try{
      const url="https://api.github.com/repos/aaronkadima/SHM/contents/"+pkg.repositoryPath+"?ref="+encodeURIComponent(repositoryRef);
      const response=await fetch(url+"&ts="+Date.now(),{cache:"no-store",headers:{Accept:"application/vnd.github+json","Cache-Control":"no-cache"}});
      if(!response.ok)throw new Error("GitHub "+response.status);
      const payload=await response.json();
      const encoded=String(payload.content||"").replace(/\n/g,"");
      const bytes=Uint8Array.from(atob(encoded),char=>char.charCodeAt(0));
      const remoteSource=new TextDecoder().decode(bytes);
      const same=normalizeSource(remoteSource)===normalizeSource(pkg.repositorySource);
      setSyncState(v=>({...v,[engine.id]:same
        ?{status:"current",message:"Atualizado · código browser igual ao repositório."}
        :{status:"different",message:"Diferente · o build browser não coincide com o repositório."}
      }));
    }catch(err){
      setSyncState(v=>({...v,[engine.id]:{status:"error",message:"Falha ao verificar · "+(err?.message||"erro de rede")}}));
    }
  }
  function EngineCard({engine,owned=false}){
    const pkg=engineCodePackage(engine),opened=openCode===engine.id,infoOpen=openInfo===engine.id,sync=syncState[engine.id];
    const browserComparable=!!pkg?.repositoryPath&&pkg?.repositorySource!=null;
    return <div className={"settingsEngineCard "+(owned?"settingsEngineCardOwned":"")}>
      <label className={"settingsEngine "+(owned?"settingsEnginePinned settingsOwnedEngine":"")}>
        <span><b>{engine.name}{owned&&<em className="settingsOwnBadge">PRÓPRIO · BROWSER</em>}</b><small>{engine.family} · {engine.task.replaceAll("_"," ")}</small>{owned&&<small className="settingsEngineDescription">{engine.description}</small>}</span>
        <input type="checkbox" checked={selected.includes(engine.id)} onChange={()=>toggle(engine.id)}/><span className="settingsSwitch" aria-hidden="true"/>
      </label>
      <div className="settingsEngineCodeActions">
        <button type="button" className={opened?"active":""} onClick={()=>setOpenCode(opened?null:engine.id)}><Code2 size={13}/>{opened?"Ocultar código":"Ver código"}</button>
        <button type="button" onClick={()=>exportEngineCode(engine)}><Download size={13}/>Exportar código</button>
        <button type="button" className={infoOpen?"active":""} onClick={()=>setOpenInfo(infoOpen?null:engine.id)}><Info size={13}/>Informações</button>
        <button type="button" className={"settingsSyncButton "+(sync?.status||"")} disabled={!browserComparable||sync?.status==="checking"} title={browserComparable?"Comparar código browser com o repositório":"Disponível para motores com código browser local"} onClick={()=>checkBrowserUpdate(engine)}><RefreshCw size={13} className={sync?.status==="checking"?"spin":""}/>Atualização</button>
      </div>
      {sync&&<div className={"settingsSyncState "+sync.status} role="status">{sync.message}</div>}
      {infoOpen&&<div className="settingsEngineInfo">
        <div><span>ID</span><b>{engine.id}</b></div>
        <div><span>Família</span><b>{engine.family||"—"}</b></div>
        <div><span>Tarefa</span><b>{String(engine.task||"—").replaceAll("_"," ")}</b></div>
        <div><span>Runtime</span><b>{engine.browser_ready?"Browser local":"Backend / modelo externo"}</b></div>
        <div><span>Implementação</span><b>{pkg?.kind||"—"}</b></div>
        <div><span>Licença</span><b>{engine.license||"Não informada"}</b></div>
        {pkg?.repositoryPath&&<div><span>Arquivo no repositório</span><b>{pkg.repositoryPath}</b></div>}
        {engine.description&&<p>{engine.description}</p>}
        {engine.source_url&&<a href={engine.source_url} target="_blank" rel="noreferrer"><ExternalLink size={12}/> Abrir origem do motor</a>}
      </div>}
      {opened&&pkg&&<div className="settingsCodePanel">
        <div className="settingsCodeHead"><div><b>{pkg.kind}</b><small>{pkg.fileName} · {pkg.language}</small></div><div>{engine.source_url&&<a href={engine.source_url} target="_blank" rel="noreferrer" title="Abrir origem do modelo"><ExternalLink size={13}/>Origem</a>}<button type="button" title="Fechar código" onClick={()=>setOpenCode(null)}><X size={13}/></button></div></div>
        <p>Os comentários no início do arquivo descrevem as etapas de entrada, inferência, pós-processamento e serialização para facilitar implementação isolada ou migração para outra plataforma.</p>
        <pre tabIndex="0"><code>{pkg.source}</code></pre>
      </div>}
    </div>;
  }
  const appBase=import.meta.env.BASE_URL||"/";
  const rootBase=appBase.replace(/dev\/?$/,"");
  const environmentHref=appInfo?.channel==="development"?rootBase+"#/settings":rootBase+"dev/#/settings";
  const environmentLabel=appInfo?.channel==="development"?"Abrir PROD":"Abrir DEV";
  return <section className="analysisSettings" aria-label="Configurações da análise">
    <header className="settingsTop"><div><span className="editorMark">S</span><b>SHM Studio</b><em className={"settingsEnvBadge "+(appInfo?.channel||"production")}>{appInfo?.channel==="development"?"DEV":"PROD"} · v{appInfo?.catalogVersion||"—"} · {appInfo?.buildSha||"—"}</em><a className="settingsEnvSwitch" href={environmentHref} title={environmentLabel+" em outra rota"}><ExternalLink size={11}/>{environmentLabel}</a></div><button onClick={onBack}><ArrowLeft size={16}/> Voltar ao canvas</button></header>
    <main className="settingsContent">
      <div className="settingsHeading"><Settings2 size={22}/><div><h1>Configurações da análise</h1><p>Defina os motores antes de executar a inspeção.</p></div></div>
      <div className="analysisSettingsCard settingsMotorsCard"><h2>Motores disponíveis</h2><p>Um motor executa uma análise individual. Dois ou mais ativam a comparação.</p>
        <div className="settingsOwnedGroup">
          <div className="settingsGroupTitle"><span>MOTOR PRÓPRIO</span><small>Execução determinística local no navegador</small></div>
          {ownedEngine?<EngineCard engine={ownedEngine} owned/>:<div className="settingsCatalogError">CDM-1 não foi encontrado no catálogo carregado nesta versão.</div>}
        </div>
        <div className="settingsGroupTitle settingsOtherTitle"><span>OUTROS MOTORES</span><small>{otherEngines.length} registrados</small></div>
        <div className="settingsEngines">{otherEngines.map(e=><EngineCard key={e.id} engine={e}/>)}</div>
      </div>
      {selected.includes("cdm_1")&&<details className="analysisSettingsCard"><summary>CDM-1 · Parâmetros morfológicos</summary><p>Valores iniciais da extensão CDM 2.8.5. Na análise individual, o CDM-1 executa localmente no navegador; na comparação com outros motores, o comparador usa os valores iniciais.</p><div className="settingsMeta">
        {[["cdm_threshold","Limiar T",1,255,1],["cdm_kernel_size","Kernel black-hat",3,99,1],["cdm_min_area","Área mínima (px²)",1,1000000,1],["cdm_min_aspect_ratio","Alongamento mínimo",1,50,.1],["cdm_mm_per_px","Calibração (mm/px; 0 = sem escala)",0,1000,.001]].map(([key,label,min,max,step])=><label key={key} className="settingsField">{label}<input type="number" min={min} max={max} step={step} value={cdmOptions[key]} onChange={e=>setCdmOptions(v=>({...v,[key]:Number(e.target.value)}))}/></label>)}
        <label className="settingsField">Tipo de elemento<select value={cdmOptions.cdm_element_family} onChange={e=>setCdmOptions(v=>({...v,cdm_element_family:e.target.value}))}><option value="barreiras_guarda_corpo_pista">Barreiras/pista · Fr=1</option><option value="juntas_dilatacao">Juntas · Fr=2</option><option value="transversinas_cortinas_alas">Transversinas/cortinas · Fr=3</option><option value="lajes_vigas_secundarias_apoios">Lajes/vigas secundárias/apoios · Fr=4</option><option value="vigas_pilares_principais">Vigas/pilares principais · Fr=5</option></select></label>
        <label className="settingsField">Alinhamento temporal<select value={cdmOptions.cdm_alignment_method||"translation_auto"} onChange={e=>setCdmOptions(v=>({...v,cdm_alignment_method:e.target.value}))}><option value="translation_auto">Automático · translação t0→t1</option><option value="resize">Somente redimensionar</option></select><small>O modo automático corrige translação da câmera antes de medir crescimento/redução e recua para redimensionamento quando não encontra ganho confiável. O CDM-1 também verifica sobreposição, iluminação, nitidez e exposição antes de considerar a mudança temporal válida. Rotação, mudança de escala e perspectiva ainda exigem captura compatível ou revisão externa.</small></label>
      </div></details>}
      <details className="analysisSettingsCard" open={needsIndividual||needsComparator}><summary>Conexão de execução</summary>
        {selected.length===0&&<p>Selecione pelo menos um motor para definir o modo de execução.</p>}
        {localBrowser&&<div className="settingsRuntimeNotice"><b>{selectedEngine.name} · execução local</b><p>Este motor roda diretamente no navegador. Não é necessário configurar backend individual e a imagem não é enviada ao Railway.</p></div>}
        {needsIndividual&&<><p>Este motor exige um backend standalone acessível por HTTPS.</p><label className="settingsField">Backend individual<input type="url" placeholder="https://seu-backend-standalone.exemplo" value={individualDraft} onChange={e=>setIndividualDraft(e.target.value)}/></label><div className="analysisSettingsActions"><button onClick={saveIndividual}>Salvar endereço</button><button onClick={testIndividual}>Testar conexão</button><span>{individualOnline===true?"Conectado":individualOnline===false?"Indisponível":""}</span></div></>}
        {needsComparator&&<><p>Dois ou mais motores ativam exclusivamente o comparador cloud.</p><label className="settingsField">Comparador<input value={comparatorDraft} onChange={e=>setComparatorDraft(e.target.value)}/></label><div className="analysisSettingsActions"><button onClick={saveComparator}>Salvar endereço</button><button onClick={testComparator}>Testar conexão</button><span>{comparatorOnline===true?"Conectado":comparatorOnline===false?"Indisponível":""}</span></div></>}
      </details>
      <details className="analysisSettingsCard"><summary>Identificação da inspeção</summary><div className="settingsMeta">{[["oae_id","OAE / estrutura"],["element_id","Elemento"],["source_id","Fonte / câmera"],["inspection_label","Campanha / inspeção"]].map(([key,label])=><label className="settingsField" key={key}>{label}<input value={inspectionMeta[key]} onChange={e=>updateInspectionMeta(key,e.target.value)}/></label>)}</div></details>
      {error&&<p className="settingsError" role="alert">{error}</p>}
    </main>
    <footer className="settingsBottom" aria-label="Barra de status das configurações"><span className="settingsStatusMessage">Configurações da análise</span><span className="settingsStatusEngines" title={selectedStatus}>{selectedStatus}</span><button className="settingsApply" onClick={onBack}><Check size={14}/> Aplicar</button></footer>
  </section>
}
