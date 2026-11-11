import React,{useEffect,useLayoutEffect,useRef,useState}from"react";
import{Check}from"lucide-react";

// Menu de contexto do Studio (botão direito). sections: [{title, items:[{label, hint, onSelect, disabled, checked}]}]
export default function ContextMenu({x,y,sections,onClose}){
  const ref=useRef(null),[pos,setPos]=useState({left:x,top:y});
  useLayoutEffect(()=>{
    const el=ref.current;if(!el)return;
    const r=el.getBoundingClientRect(),m=8;
    setPos({left:Math.max(m,Math.min(x,window.innerWidth-r.width-m)),top:Math.max(m,Math.min(y,window.innerHeight-r.height-m))});
    el.querySelector("button:not(:disabled)")?.focus({preventScroll:true});
  },[x,y,sections]);
  useEffect(()=>{
    const down=e=>{if(!ref.current?.contains(e.target))onClose()};
    const key=e=>{
      if(e.key==="Escape"){e.preventDefault();e.stopPropagation();onClose();return}
      if(e.key!=="ArrowDown"&&e.key!=="ArrowUp"&&e.key!=="Home"&&e.key!=="End")return;
      const items=[...(ref.current?.querySelectorAll("button:not(:disabled)")||[])];if(!items.length)return;
      e.preventDefault();const i=items.indexOf(document.activeElement);
      const next=e.key==="Home"?0:e.key==="End"?items.length-1:e.key==="ArrowDown"?(i+1)%items.length:(i-1+items.length)%items.length;
      items[next].focus();
    };
    const close=()=>onClose();
    window.addEventListener("pointerdown",down,true);window.addEventListener("keydown",key,true);
    window.addEventListener("resize",close);window.addEventListener("blur",close);window.addEventListener("wheel",close,{passive:true,capture:true});
    return()=>{window.removeEventListener("pointerdown",down,true);window.removeEventListener("keydown",key,true);window.removeEventListener("resize",close);window.removeEventListener("blur",close);window.removeEventListener("wheel",close,{capture:true})};
  },[onClose]);
  const visible=sections.filter(s=>s&&s.items?.some(Boolean));
  return <div ref={ref} className="studioContextMenu" role="menu" aria-label="Menu de contexto" style={{left:pos.left,top:pos.top}} onContextMenu={e=>e.preventDefault()}>
    {visible.map((section,si)=><div className="studioContextSection" key={section.title||si} role="group" aria-label={section.title}>
      {section.title&&<b className="studioContextTitle">{section.title}</b>}
      {section.items.filter(Boolean).map(item=><button key={item.label} type="button" role={item.checked===undefined?"menuitem":"menuitemcheckbox"} aria-checked={item.checked===undefined?undefined:!!item.checked} disabled={!!item.disabled} title={item.title} onClick={()=>{onClose();item.onSelect?.()}}>
        <i aria-hidden="true">{item.checked?<Check size={13}/>:null}</i><span>{item.label}</span>{item.hint&&<small>{item.hint}</small>}
      </button>)}
    </div>)}
  </div>;
}
