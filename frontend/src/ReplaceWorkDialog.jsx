import React,{useEffect,useRef}from"react";
import{AlertTriangle,FolderOpen,Save,X}from"lucide-react";

// Pergunta antes de substituir o trabalho aberto por outro arquivo ou inspeção do histórico.
export default function ReplaceWorkDialog({current,next,analyzed=false,dirty=true,onChoose,mode="replace"}){
  const closing=mode==="close";
  const saveRef=useRef(null),dialogRef=useRef(null);
  useEffect(()=>{
    const previous=document.activeElement;saveRef.current?.focus();
    const onKey=e=>{
      if(e.key==="Escape"){e.preventDefault();e.stopPropagation();onChoose("cancel")}
      else if(e.key==="Tab"){
        const items=[...dialogRef.current?.querySelectorAll("button")||[]];if(!items.length)return;
        const i=items.indexOf(document.activeElement);
        if(e.shiftKey&&i<=0){e.preventDefault();items[items.length-1].focus()}
        else if(!e.shiftKey&&i===items.length-1){e.preventDefault();items[0].focus()}
      }
    };
    window.addEventListener("keydown",onKey,true);
    return()=>{window.removeEventListener("keydown",onKey,true);previous?.focus?.()};
  },[onChoose]);
  const status=!analyzed?"A imagem atual ainda não foi analisada. Salvar baixa uma cópia do arquivo.":dirty?"Há alterações desde o último salvamento (nome do arquivo ou correção da imagem).":"A análise já está salva no histórico local.";
  return <div className="replaceDialogScrim" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onChoose("cancel")}}>
    <div ref={dialogRef} className="replaceDialog" role="alertdialog" aria-modal="true" aria-labelledby="replaceDialogTitle" aria-describedby="replaceDialogText">
      <header><span className={"replaceDialogIcon"+(dirty?" warn":"")}>{dirty?<AlertTriangle size={18}/>:<FolderOpen size={18}/>}</span><b id="replaceDialogTitle">Fechar o trabalho atual?</b><button onClick={()=>onChoose("cancel")} aria-label="Cancelar"><X size={16}/></button></header>
      <div id="replaceDialogText" className="replaceDialogBody">
        {closing?<p>Fechar <b title={current}>{current}</b> e limpar o canvas.</p>:<p>Abrir <b title={next}>{next}</b> vai substituir <b title={current}>{current}</b> no canvas.</p>}
        <p className={"replaceDialogStatus"+(dirty?" warn":"")}>{status}</p>
      </div>
      <footer>
        <button onClick={()=>onChoose("cancel")}>Cancelar</button>
        <button onClick={()=>onChoose("discard")}>{closing?(dirty?"Fechar sem salvar":"Fechar"):(dirty?"Abrir sem salvar":"Abrir")}</button>
        <button ref={saveRef} className="primary" onClick={()=>onChoose("save")}><Save size={14}/> {closing?"Salvar e fechar":"Salvar e abrir"}</button>
      </footer>
    </div>
  </div>;
}
