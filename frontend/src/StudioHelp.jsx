import React,{useEffect,useMemo,useRef,useState}from"react";
import{X,Search,Lightbulb,ChevronLeft,ChevronRight}from"lucide-react";

// Ícone com as iniciais "CDM" (mesmo traço dos ícones lucide).
export function CdmIcon({size=24,strokeWidth=2,className,...rest}){
  // só as letras, sem moldura: ocupam quase toda a largura do ícone
  return <svg className={"cdmIcon "+(className||"")} width={size} height={size} viewBox="0 0 24 24" fill="none" overflow="visible" aria-hidden="true" {...rest}>
    <text x="12" y="16.8" textAnchor="middle" fontSize="13" fontWeight="800" fontFamily="system-ui,-apple-system,Segoe UI,sans-serif" fill="currentColor" stroke="currentColor" strokeWidth={Math.max(0,(Number(strokeWidth)||2)-1.7)} letterSpacing="-.6" textLength="24" lengthAdjust="spacingAndGlyphs">CDM</text>
  </svg>;
}

// Ícone de cada item de menu (coluna fixa, como no GIMP).
export function MenuIcon({icon:Icon}){return <i className="editorMenuIcon" aria-hidden="true">{Icon?<Icon size={15} strokeWidth={1.9}/>:null}</i>}

export const STUDIO_TIPS=[
  ["Roda do mouse como em CAD","A roda faz zoom no ponto do cursor; Shift + roda move a imagem; duplo clique no botão do meio ajusta à tela."],
  ["Réguas em milímetros","Ctrl/Cmd+Shift+R mostra as réguas. Calibre a escala mm/px em Configurações → Réguas e escala para medir em mm — a mesma escala alimenta as medidas do CDM-1."],
  ["Botão direito","O menu de contexto muda conforme o elemento: no canvas traz zoom, réguas e modos de exibição; nas camadas, mostrar/ocultar patologias."],
  ["Listas de achados","Nos Resultados, clique em uma patologia para listar todos os achados com comprimento, largura ou área; clique num item para destacá-lo no canvas."],
  ["Rótulos e caixas","Ative Rótulos e Caixas na barra lateral; cada camada também tem os seus no ⚙. Com muitos achados, os rótulos pequenos aparecem ao passar o mouse."],
  ["Imagem antes da análise","O painel Imagem mostra histograma, curva S, propriedades e a qualidade para análise — corrija exposição e contraste antes para evitar falsos positivos."],
  ["Etapas do motor","As miniaturas à direita mostram cada etapa do CDM (cinza, black-hat, máscara candidata…). Clique para ampliar e comparar."],
  ["Comparação t0 → t1","Carregue uma referência t0 (Arquivo → Referência t0) para medir crescimento das patologias entre inspeções, com registro automático."],
  ["Paridade CDM","O painel CDM compara o motor do navegador com a referência Python: nas cenas do CI ou em variações da própria imagem (Pyodide)."],
  ["Live detecção","Abra o Live para detectar em tempo real pela câmera; as capturas podem ser salvas na galeria do dispositivo."],
  ["Procurar comando","Pressione / para procurar e executar qualquer comando do Studio pelo nome."],
  ["Recentes","Arquivo → Recentes reabre as últimas 10 inspeções; Alt+1 … Alt+0 abre direto."],
];

function Modal({title,onClose,children,className=""}){
  const ref=useRef(null);
  const closeRef=useRef(onClose);closeRef.current=onClose;
  useEffect(()=>{const prev=document.activeElement;(ref.current?.querySelector("input")||ref.current?.querySelector("footer button,button"))?.focus();const key=e=>{if(e.key==="Escape"){e.preventDefault();e.stopPropagation();closeRef.current()}};window.addEventListener("keydown",key,true);return()=>{window.removeEventListener("keydown",key,true);prev?.focus?.()}},[]);
  return <div className="studioHelpScrim" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <div ref={ref} className={"studioHelpDialog "+className} role="dialog" aria-modal="true" aria-label={title}>
      <header><b>{title}</b><button type="button" onClick={onClose} aria-label="Fechar"><X size={16}/></button></header>
      {children}
    </div>
  </div>;
}

// Aulas (Noções de Programação para SHM) em popup grande, com o curso em iframe.
export function AulasDialog({onClose,crumb="",children}){
  return <Modal title={"Noções de Programação para SHM"+(crumb?" · "+crumb:"")} onClose={onClose} className="large aulas">
    <div className="studioAulasBody">{children}</div>
  </Modal>;
}

export function TipOfDayDialog({onClose}){
  const[i,setI]=useState(()=>{const d=new Date();return(d.getFullYear()*372+d.getMonth()*31+d.getDate())%STUDIO_TIPS.length});
  const[t,body]=STUDIO_TIPS[i];
  return <Modal title="Dica do dia" onClose={onClose} className="tip">
    <div className="studioTip"><span><Lightbulb size={22}/></span><div><b>{t}</b><p>{body}</p></div></div>
    <footer><small>{i+1} / {STUDIO_TIPS.length}</small><button type="button" onClick={()=>setI((i-1+STUDIO_TIPS.length)%STUDIO_TIPS.length)}><ChevronLeft size={14}/> Anterior</button><button type="button" className="primary" onClick={()=>setI((i+1)%STUDIO_TIPS.length)}>Próxima <ChevronRight size={14}/></button></footer>
  </Modal>;
}

export function AboutDialog({onClose,appInfo={}}){
  const rows=[["Canal",appInfo.channel==="development"?"Desenvolvimento":"Produção"],["Build",String(appInfo.buildSha||"—").slice(0,12)],["Catálogo de motores",appInfo.catalogVersion||"—"],["Motor morfológico","CDM 2.10 (JavaScript no navegador; referência Python cdm_v285.py)"],["Execução","No dispositivo — as imagens não saem do navegador"]];
  return <Modal title="Sobre o SHM Studio" onClose={onClose} className="about">
    <div className="studioAbout"><span className="studioAboutLogo">S</span><div><b>SHM Vision Lab · Studio</b><p>Detecção de patologias em estruturas de concreto (fissuras, desplacamento, armadura exposta, corrosão, eflorescência) com motores morfológicos e de aprendizado profundo.</p></div></div>
    <div className="studioAboutProject">
      <p>Projeto de pós-doutorado de <b>Aaron Kadima Lukanu Lwa Nzambi</b>, sob supervisão do <b>Prof. Dr. Túlio Nogueira Bittencourt</b> · subárea Infraestrutura de Transportes.</p>
      <p>Financiamento: <b>FAPESP</b> · Pós-Doutorado, processo nº 2026/04082-1 (vigência 01/07/2026 a 30/06/2029).</p>
    </div>
    <dl className="studioAboutRows">{rows.map(([k,v])=><React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>
    <footer><a href="https://github.com/aaronkadima/SHM" target="_blank" rel="noreferrer">Repositório no GitHub</a><button type="button" className="primary" onClick={onClose}>Fechar</button></footer>
  </Modal>;
}

export function ShortcutsDialog({onClose,shortcuts}){
  return <Modal title="Atalhos de teclado e mouse" onClose={onClose} className="shortcuts">
    <div className="studioShortcuts">{shortcuts.map(([group,items])=><section key={group}><b>{group}</b>{items.map(([k,v])=><div key={k}><kbd>{k}</kbd><span>{v}</span></div>)}</section>)}</div>
  </Modal>;
}

// "Procurar e executar um comando" (como o / do GIMP).
export function CommandPalette({onClose,commands}){
  const[q,setQ]=useState(""),[i,setI]=useState(0),listRef=useRef(null);
  const norm=s=>String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();
  const items=useMemo(()=>{const t=norm(q).trim();return commands.filter(c=>!t||t.split(/\s+/).every(w=>norm(c.label+" "+c.group+" "+(c.keywords||"")).includes(w)))},[q,commands]);
  useEffect(()=>setI(0),[q]);
  useEffect(()=>{listRef.current?.querySelector(".active")?.scrollIntoView({block:"nearest"})},[i]);
  const run=c=>{if(!c||c.disabled)return;onClose();setTimeout(()=>c.run(),0)};
  return <Modal title="Procurar e executar um comando" onClose={onClose} className="palette">
    <label className="studioPaletteSearch"><Search size={15}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Digite o nome do comando…" aria-label="Procurar comando"
      onKeyDown={e=>{if(e.key==="ArrowDown"){e.preventDefault();setI(v=>Math.min(items.length-1,v+1))}else if(e.key==="ArrowUp"){e.preventDefault();setI(v=>Math.max(0,v-1))}else if(e.key==="Enter"){e.preventDefault();run(items[i])}}}/></label>
    <div ref={listRef} className="studioPaletteList" role="listbox">
      {items.map((c,k)=>{const Icon=c.icon;return <button type="button" role="option" aria-selected={k===i} key={c.group+c.label} className={(k===i?"active ":"")+(c.disabled?"disabled":"")} disabled={c.disabled} onMouseEnter={()=>setI(k)} onClick={()=>run(c)}>
        <i aria-hidden="true">{Icon?<Icon size={15}/>:null}</i><span>{c.label}<small>{c.group}</small></span>{c.hint&&<kbd>{c.hint}</kbd>}
      </button>})}
      {!items.length&&<p className="studioPaletteEmpty">Nenhum comando encontrado.</p>}
    </div>
  </Modal>;
}

// Ajuda por contexto: o próximo clique mostra o que é o elemento (como Shift+F1 no GIMP).
export function describeElement(el){
  const target=el?.closest?.("button,[role=menuitem],[aria-label],[title],[data-tooltip],input,select,canvas,img,section,aside");
  if(!target)return null;
  const label=target.getAttribute("aria-label")||target.getAttribute("data-tooltip")||target.getAttribute("title")||target.textContent?.trim().slice(0,80)||target.tagName.toLowerCase();
  const extra=target.getAttribute("title")&&target.getAttribute("title")!==label?target.getAttribute("title"):"";
  const area=el.closest(".editorTools")?"Barra lateral":el.closest(".editorLayers")?"Painel de camadas":el.closest(".editorFloating,.editorResultsTab")?"Resultados":el.closest(".imgInspector,.editorImageEntry")?"Painel Imagem":el.closest(".engineStages")?"Etapas do motor":el.closest(".parityPanel")?"Paridade CDM":el.closest(".editorViewport")?"Canvas":el.closest(".editorTopbar,.editorMenus,.editorTopActions")?"Barra superior":"Studio";
  return{label,extra,area};
}
