import React,{useEffect,useRef,useState} from "react";
import {ArrowLeft,Check,Code2,Download,ExternalLink,Info,RefreshCw,Settings2,X} from "lucide-react";
import {engineCodePackage} from "./engineCodeCatalog.js";
import "./analysis-settings.css";
import {ADE_CLASS_NAMES,DEFAULT_EXCLUDE,DEFAULT_STRUCTURE,ptLabel} from "./contextFilter.js";

// Configurações › IA de contexto (filtro SegFormer-B0 ADE20K aplicado após a morfologia do CDM).
const CONTEXT_DEFAULTS={cdm_context_filter:"conservative",cdm_context_share:0.6,cdm_context_min_confidence:0.35,cdm_context_input:512,cdm_context_abstain:true,cdm_context_show_discarded:false,cdm_context_live_every:6,cdm_context_clip:true,cdm_context_clip_cracks:false,cdm_context_exclude:null,cdm_context_structure:null};
function ClassChips({title,hint,value,fallback,onChange,disabled}){
  const list=Array.isArray(value)&&value.length?value:fallback;
  const avail=ADE_CLASS_NAMES().filter(n=>!list.includes(n)).sort((a,b)=>ptLabel(a).localeCompare(ptLabel(b),"pt"));
  return <div className={"settingsField contextChips"+(disabled?" disabled":"")}><span>{title}</span><small>{hint}</small>
    <div className="contextChipList">{list.map(n=><button key={n} type="button" disabled={disabled} title={n+" (ADE20K) · remover"} onClick={()=>onChange(list.filter(x=>x!==n))}>{ptLabel(n)} <b aria-hidden="true">×</b></button>)}</div>
    <div className="contextChipAdd"><select value="" disabled={disabled} aria-label={"Adicionar a "+title} onChange={e=>{if(e.target.value)onChange([...list,e.target.value])}}><option value="">+ adicionar classe…</option>{avail.map(n=><option key={n} value={n}>{ptLabel(n)} · {n}</option>)}</select>
      <button type="button" disabled={disabled} onClick={()=>onChange(null)}>Padrão</button></div>
  </div>;
}
function ContextAiCard({cdmOptions,setCdmOptions}){
  const o={...CONTEXT_DEFAULTS,...cdmOptions},off=(o.cdm_context_filter||"off")==="off";
  const set=(k,v)=>setCdmOptions(x=>({...x,[k]:v}));
  return <details className="analysisSettingsCard contextAiCard" open><summary>IA de contexto · filtro de cena</summary>
    <p>Segmentação semântica por pixel (SegFormer-B0 · ADE20K, 150 classes) executada no navegador. O CDM roda na imagem inteira e, depois, cada achado com a fração mínima da área em região irrelevante é descartado — a IA nunca cria nem altera medidas. Vale para CDM-1, CDM-3 (2D) e Live detecção (CDM-1).</p>
    <div className="settingsGrid">
      <label className="settingsField">Modo<select value={o.cdm_context_filter} onChange={e=>set("cdm_context_filter",e.target.value)}><option value="conservative">Conservador · descarta só o que está em classes irrelevantes</option><option value="strict">Estrito · mantém só achados sobre classes de estrutura</option><option value="off">Desligado · só morfologia</option></select></label>
      <label className="settingsField">Fração mínima em região irrelevante<input type="number" min="0.2" max="1" step="0.05" value={o.cdm_context_share} disabled={off} onChange={e=>set("cdm_context_share",Math.max(.2,Math.min(1,Number(e.target.value)||.6)))}/><small>Achado é descartado se ≥ {Math.round(100*o.cdm_context_share)} % da área cair em região irrelevante.</small></label>
      <label className="settingsField">Confiança mínima do pixel<input type="range" min="0.1" max="0.9" step="0.05" value={o.cdm_context_min_confidence} disabled={off} onChange={e=>set("cdm_context_min_confidence",Number(e.target.value))}/><small>{Math.round(100*o.cdm_context_min_confidence)} % — pixels com probabilidade menor não contam como irrelevantes.</small></label>
      <label className="settingsField">Resolução de entrada do modelo<select value={o.cdm_context_input} disabled={off} onChange={e=>set("cdm_context_input",Number(e.target.value))}><option value="384">384 px · mais rápido</option><option value="512">512 px · padrão</option><option value="768">768 px · mais detalhe, mais lento</option></select></label>
      <label className="settingsField">Live · recalcular a cena a cada<input type="number" min="1" max="30" step="1" value={o.cdm_context_live_every} disabled={off} onChange={e=>set("cdm_context_live_every",Math.max(1,Math.min(30,Math.round(Number(e.target.value)||6))))}/><small>quadros (o mapa de cena muda devagar; valores maiores aliviam o processamento).</small></label>
      <label className="settingsCheck"><input type="checkbox" checked={o.cdm_context_clip!==false} disabled={off} onChange={e=>set("cdm_context_clip",e.target.checked)}/> Recortar regiões de área pela máscara de contexto <small>(desplacamento, armadura, corrosão e eflorescência perdem os pixels sobre a cena irrelevante; manchas ligadas só pelo fundo ficam separadas)</small></label>
      <label className="settingsCheck"><input type="checkbox" checked={o.cdm_context_clip_cracks===true} disabled={off||o.cdm_context_clip===false} onChange={e=>set("cdm_context_clip_cracks",e.target.checked)}/> Recortar também fissuras <small>(pode fragmentar fissuras que cruzam a borda da cena)</small></label>
      <label className="settingsCheck"><input type="checkbox" checked={o.cdm_context_abstain!==false} disabled={off} onChange={e=>set("cdm_context_abstain",e.target.checked)}/> Abster-se em cenas não reconhecidas <small>(&gt; 90 % irrelevante e &lt; 3 % estrutura, típico de close-ups)</small></label>
      <label className="settingsCheck"><input type="checkbox" checked={o.cdm_context_show_discarded===true} disabled={off} onChange={e=>set("cdm_context_show_discarded",e.target.checked)}/> Exibir caixas dos achados descartados no canvas e no Live <small>(IA1, IA2… continuam listados em Resultados)</small></label>
    </div>
    <ClassChips title="Classes irrelevantes (modo conservador)" hint="Achados sobre estas classes são descartados." value={o.cdm_context_exclude} fallback={DEFAULT_EXCLUDE} disabled={off} onChange={v=>set("cdm_context_exclude",v)}/>
    <ClassChips title="Classes de estrutura (modo estrito)" hint="No modo estrito, só achados sobre estas classes são mantidos." value={o.cdm_context_structure} fallback={DEFAULT_STRUCTURE} disabled={off} onChange={v=>set("cdm_context_structure",v)}/>
    <div className="contextAiFoot"><button type="button" onClick={()=>setCdmOptions(x=>({...x,...CONTEXT_DEFAULTS}))}>Restaurar padrões da IA de contexto</button></div>
  </details>;
}

export default function AnalysisSettings({appInfo,engines,selected,toggle,onBack,individualDraft,setIndividualDraft,comparatorDraft,setComparatorDraft,saveIndividual,saveComparator,testIndividual,testComparator,individualOnline,comparatorOnline,inspectionMeta,updateInspectionMeta,cdmOptions,setCdmOptions,embedded=false,rulers={visible:false,unit:"mm"},setRulers=null,error}){
  const ownedEngines=engines.filter(e=>e.catalog_owned===true);
  const otherEngines=engines.filter(e=>e.catalog_owned!==true);
  const selectedEngine=selected.length===1?engines.find(e=>e.id===selected[0]):null;
  const localBrowser=!!selectedEngine?.browser_ready;
  const needsIndividual=selected.length===1&&!localBrowser;
  const needsComparator=selected.length>=2;
  const [openCode,setOpenCode]=useState(null);
  const [openInfo,setOpenInfo]=useState(null);
  const [syncState,setSyncState]=useState({});
  const syncRequests=useRef(new Map());
  const selectedStatus="Motores selecionados: "+selected.length;
  const repositoryRef=appInfo?.channel==="development"?"dev":"main";
  useEffect(()=>()=>{for(const request of syncRequests.current.values())request.abort();syncRequests.current.clear()},[]);
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
    const pkg=engineCodePackage(engine),engineId=engine.id;
    if(!pkg?.repositoryPath&&!engine.browser_ready){
      setSyncState(v=>({...v,[engineId]:{status:"unavailable",message:"Sem implementação local publicada para verificar."}}));
      return;
    }
    syncRequests.current.get(engineId)?.abort();
    const controller=new AbortController();
    syncRequests.current.set(engineId,controller);
    let timedOut=false;
    const timeout=setTimeout(()=>{timedOut=true;controller.abort()},12000);
    setSyncState(v=>({...v,[engineId]:{status:"checking",message:"Verificando publicação "+repositoryRef+"…"}}));
    try{
      const base=String(import.meta.env.BASE_URL||"/").replace(/\/?$/,"/");
      const buildUrl=new URL(base+"build.json",window.location.origin);
      buildUrl.searchParams.set("ts",String(Date.now()));
      const buildResponse=await fetch(buildUrl,{cache:"no-store",credentials:"same-origin",signal:controller.signal});
      if(!buildResponse.ok)throw new Error("build.json HTTP "+buildResponse.status);
      const published=await buildResponse.json();
      const publishedSha=String(published?.sha||"").trim();
      const localSha=String(appInfo?.buildSha||"").trim();
      const buildCurrent=!!publishedSha&&!!localSha&&(publishedSha===localSha||publishedSha.startsWith(localSha)||localSha.startsWith(publishedSha));

      let modelInfo=null;
      if(engine.browser_ready&&engine.browser_manifest_asset){
        const manifestUrl=new URL(base+"browser-models/"+encodeURIComponent(engine.browser_manifest_asset),window.location.origin);
        manifestUrl.searchParams.set("ts",String(Date.now()));
        const response=await fetch(manifestUrl,{cache:"no-store",credentials:"same-origin",signal:controller.signal});
        if(!response.ok)throw new Error("manifesto "+engine.name+" HTTP "+response.status);
        const manifest=await response.json();
        if(manifest.engine_id!==engineId)throw new Error("manifesto publicado pertence a "+String(manifest.engine_id||"outro motor"));
        const sha=String(manifest.sha256||"");
        if(!/^[0-9a-f]{64}$/i.test(sha))throw new Error("manifesto publicado sem SHA-256 válido");
        modelInfo={sha,bytes:Number(manifest.bytes||0)};
      }

      if(syncRequests.current.get(engineId)!==controller)return;
      if(!buildCurrent){
        setSyncState(v=>({...v,[engineId]:{
          status:"different",
          message:"Atualização disponível · página "+(localSha||"—")+" · publicada "+(publishedSha||"—")+". Recarregue a aplicação."
        }}));
      }else{
        const modelText=modelInfo?" · modelo "+(modelInfo.bytes?((modelInfo.bytes/1e6).toFixed(1)+" MB · "):"")+modelInfo.sha.slice(0,8):"";
        setSyncState(v=>({...v,[engineId]:{
          status:"current",
          message:"Atualizado · build "+publishedSha+modelText+"."
        }}));
      }
    }catch(err){
      if(syncRequests.current.get(engineId)!==controller)return;
      if(controller.signal.aborted&&!timedOut)return;
      setSyncState(v=>({...v,[engineId]:{
        status:"error",
        message:timedOut?"Tempo limite ao verificar a publicação.":"Falha na publicação local · "+(err?.message||"erro de rede")
      }}));
    }finally{
      clearTimeout(timeout);
      if(syncRequests.current.get(engineId)===controller)syncRequests.current.delete(engineId);
    }
  }
  function EngineCard({engine,owned=false}){
    const pkg=engineCodePackage(engine),opened=openCode===engine.id,infoOpen=openInfo===engine.id,sync=syncState[engine.id];
    const browserComparable=!!pkg?.repositoryPath||!!engine.browser_ready;
    return <div className={"settingsEngineCard "+(owned?"settingsEngineCardOwned":"")} data-engine-id={engine.id}>
      <label className={"settingsEngine "+(owned?"settingsEnginePinned settingsOwnedEngine":"")}>
        <span><b>{engine.name}{owned&&<em className="settingsOwnBadge">{engine.id==="cdm_3"?"PRÓPRIO · ESPACIAL DEV":"PRÓPRIO · BROWSER"}</em>}{!owned&&engine.browser_ready&&<em className="settingsOwnBadge">BROWSER</em>}{!owned&&!engine.browser_ready&&engine.browser_candidate&&<em className="settingsCandidateBadge">ONNX · CANDIDATO</em>}</b><small>{engine.family} · {engine.task.replaceAll("_"," ")}</small>{owned&&<small className="settingsEngineDescription">{engine.description}</small>}</span>
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
        <div><span>Runtime</span><b>{engine.browser_ready?"Browser local":engine.browser_candidate?"Candidato browser · "+(engine.browser_target||"ONNX"):"Backend / modelo externo"}</b></div>{engine.browser_candidate&&<div><span>Estágio browser</span><b>{engine.browser_stage||"candidato"}</b></div>}{engine.browser_release_asset&&<div><span>Artefato ONNX</span><b>{engine.browser_release_asset}</b></div>}
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
  return <section className={"analysisSettings"+(embedded?" embedded":"")} aria-label="Configurações da análise">
    <header className="settingsTop"><div><span className="editorMark">S</span><b>SHM Studio</b><em className={"settingsEnvBadge "+(appInfo?.channel||"production")}>{appInfo?.channel==="development"?"DEV":"PROD"} · v{appInfo?.catalogVersion||"—"} · {appInfo?.buildSha||"—"}</em><a className="settingsEnvSwitch" href={environmentHref} title={environmentLabel+" em outra rota"}><ExternalLink size={11}/>{environmentLabel}</a></div><button onClick={onBack}><ArrowLeft size={16}/> Voltar ao canvas</button></header>
    <main className="settingsContent">
      <div className="settingsHeading"><Settings2 size={22}/><div><h1>Configurações da análise</h1><p>Defina os motores antes de executar a inspeção.</p></div></div>
      <div className="analysisSettingsCard settingsMotorsCard"><h2>Motores disponíveis</h2><p>Um motor executa uma análise individual. Dois ou mais ativam a comparação.</p>
        <div className="settingsOwnedGroup">
          <div className="settingsGroupTitle"><span>MOTORES PRÓPRIOS</span><small>CDM-1 determinístico + CDM-3 espacial 2D/3D</small></div>
          {ownedEngines.length?ownedEngines.map(engine=><EngineCard key={engine.id} engine={engine} owned/>):<div className="settingsCatalogError">Nenhum motor próprio CDM foi encontrado no catálogo carregado nesta versão.</div>}
        </div>
        <div className="settingsGroupTitle settingsOtherTitle"><span>OUTROS MOTORES</span><small>{otherEngines.length} registrados</small></div>
        <div className="settingsEngines">{otherEngines.map(e=><EngineCard key={e.id} engine={e}/>)}</div>
      </div>
      {selected.includes("cdm_3")&&<details className="analysisSettingsCard" open><summary>CDM-3 · Entrada espacial</summary><p>Motor próprio espacial em desenvolvimento. No DEV, imagens 2D usam o bootstrap morfológico rastreável; arquivos <b>.LAS</b>, <b>.XYZ</b> e <b>.IFC</b> são importados diretamente no canvas 3D e entram no pipeline CDM-3.</p><div className="settingsMeta"><div className="settingsRuntimeNotice"><b>Formatos espaciais ativos</b><p>LAS · nuvem de pontos não comprimida; XYZ · coordenadas X Y Z; IFC · prévia espacial + indexação para resolução por IfcElement no backend CDM-3.</p></div><div className="settingsRuntimeNotice"><b>Pipeline profundo</b><p>Alinhamento LAS↔IFC, resolução do elemento hospedeiro e exportação IfcAnnotation/SVG permanecem disponíveis no backend CDM-3. O frontend não simula checkpoint IA ausente.</p></div></div></details>}
      {selected.includes("cdm_1")&&<details className="analysisSettingsCard"><summary>CDM-1 · Parâmetros morfológicos</summary><p>Valores iniciais da extensão CDM 2.8.5. Na análise individual, o CDM-1 executa localmente no navegador; na comparação com outros motores, o comparador usa os valores iniciais.</p><div className="settingsMeta">
        {[["cdm_threshold","Limiar T",1,255,1],["cdm_kernel_size","Kernel black-hat",3,99,1],["cdm_min_area","Área mínima (px²)",1,1000000,1],["cdm_min_aspect_ratio","Alongamento mínimo",1,50,.1],["cdm_mm_per_px","Calibração (mm/px; 0 = sem escala)",0,1000,.001]].map(([key,label,min,max,step])=><label key={key} className="settingsField">{label}<input type="number" min={min} max={max} step={step} value={cdmOptions[key]} onChange={e=>setCdmOptions(v=>({...v,[key]:Number(e.target.value)}))}/></label>)}
        <label className="settingsField">Tipo de elemento<select value={cdmOptions.cdm_element_family} onChange={e=>setCdmOptions(v=>({...v,cdm_element_family:e.target.value}))}><option value="barreiras_guarda_corpo_pista">Barreiras/pista · Fr=1</option><option value="juntas_dilatacao">Juntas · Fr=2</option><option value="transversinas_cortinas_alas">Transversinas/cortinas · Fr=3</option><option value="lajes_vigas_secundarias_apoios">Lajes/vigas secundárias/apoios · Fr=4</option><option value="vigas_pilares_principais">Vigas/pilares principais · Fr=5</option></select></label>
        <label className="settingsField">Alinhamento temporal<select value={cdmOptions.cdm_alignment_method||"translation_auto"} onChange={e=>setCdmOptions(v=>({...v,cdm_alignment_method:e.target.value}))}><option value="translation_auto">Automático · translação t0→t1</option><option value="resize">Somente redimensionar</option></select><small>O modo automático corrige translação da câmera antes de medir crescimento/redução e recua para redimensionamento quando não encontra ganho confiável. O CDM-1 também verifica sobreposição, iluminação, nitidez e exposição antes de considerar a mudança temporal válida. Rotação, mudança de escala e perspectiva ainda exigem captura compatível ou revisão externa.</small></label>
      </div></details>}
      {(selected.includes("cdm_1")||selected.includes("cdm_3"))&&<ContextAiCard cdmOptions={cdmOptions} setCdmOptions={setCdmOptions}/>}
      <RulerScaleCard cdmOptions={cdmOptions} setCdmOptions={setCdmOptions} rulers={rulers} setRulers={setRulers}/>
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

// Réguas do canvas e escala da imagem (mm/px). A mesma calibração alimenta as medidas do CDM-1.
function RulerScaleCard({cdmOptions,setCdmOptions,rulers,setRulers}){
  const mm=Math.max(0,Number(cdmOptions?.cdm_mm_per_px)||0);
  const[refPx,setRefPx]=React.useState(""),[refMm,setRefMm]=React.useState("");
  const pxN=Number(String(refPx).replace(",",".")),mmN=Number(String(refMm).replace(",","."));
  const derived=pxN>0&&mmN>0?mmN/pxN:null;
  const setScale=v=>setCdmOptions(o=>({...o,cdm_mm_per_px:Math.max(0,Math.min(1000,Number(v)||0))}));
  return <details className="analysisSettingsCard rulerScaleCard" open><summary>Réguas e escala do canvas</summary>
    <p>Réguas horizontal e vertical no canvas, como no Inkscape, com origem no canto superior esquerdo da imagem. Em mm ou cm usam a escala abaixo; sem escala, mostram pixels da imagem. Atalho: Ctrl/Cmd+Shift+R.</p>
    <div className="settingsMeta">
      <label className="settingsField settingsSwitchRow"><input type="checkbox" role="switch" checked={!!rulers.visible} onChange={e=>setRulers?.(r=>({...r,visible:e.target.checked}))}/><span className="settingsSwitch" aria-hidden="true"/><span>Mostrar réguas no canvas</span></label>
      <label className="settingsField">Unidade<select value={rulers.unit||"mm"} onChange={e=>setRulers?.(r=>({...r,unit:e.target.value}))}><option value="mm">Milímetros (mm)</option><option value="cm">Centímetros (cm)</option><option value="px">Pixels da imagem (px)</option></select></label>
      <label className="settingsField">Escala (mm por pixel; 0 = sem escala)<input type="number" min="0" max="1000" step="0.0001" value={mm} onChange={e=>setScale(e.target.value)}/><small>{mm>0?"1 px = "+mm.toLocaleString("pt-BR",{maximumFractionDigits:6})+" mm · 1 mm = "+(1/mm).toLocaleString("pt-BR",{maximumFractionDigits:3})+" px. Também usada nas medidas do CDM-1 (comprimento, abertura, área).":"Sem escala: as réguas ficam em px e o CDM-1 mede em pixels."}</small></label>
      <div className="settingsField rulerCalibrate"><span>Calibrar por uma medida conhecida</span>
        <div><input type="number" min="0" step="any" inputMode="decimal" placeholder="px" aria-label="Comprimento de referência em pixels" value={refPx} onChange={e=>setRefPx(e.target.value)}/><b>px =</b><input type="number" min="0" step="any" inputMode="decimal" placeholder="mm" aria-label="Comprimento de referência em milímetros" value={refMm} onChange={e=>setRefMm(e.target.value)}/><b>mm</b>
        <button type="button" disabled={!derived} onClick={()=>{setScale(derived.toFixed(6));setRefPx("");setRefMm("")}}>Aplicar{derived?" · "+derived.toLocaleString("pt-BR",{maximumFractionDigits:5})+" mm/px":""}</button>
        {mm>0&&<button type="button" onClick={()=>setScale(0)}>Remover escala</button>}</div>
        <small>Ex.: uma régua ou trena de 200 mm que ocupa 1 450 px na foto → 0,13793 mm/px. Meça os pixels com as réguas em px.</small>
      </div>
    </div>
  </details>;
}
