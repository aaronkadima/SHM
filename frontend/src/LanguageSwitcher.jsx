import React,{useEffect,useRef,useState}from"react";
import{LANGS,getLang,langInfo,onLangChange,setLang}from"./i18n.js";

// Seletor de idioma da barra inferior (PT · EN · ES · FR). O código atual fica sempre visível
// e sinaliza o idioma da interface e das figuras exportadas.
export function useLang(){
  const[lang,setL]=useState(getLang());
  useEffect(()=>onLangChange(setL),[]);
  return lang;
}
export default function LanguageSwitcher(){
  const lang=useLang(),[open,setOpen]=useState(false),[pos,setPos]=useState(null),ref=useRef(null),btn=useRef(null);
  // a barra de status corta o que transborda: o menu é posicionado em coordenadas da janela
  const toggle=()=>{const r=btn.current?.getBoundingClientRect();if(r)setPos({right:Math.max(8,window.innerWidth-r.right),bottom:window.innerHeight-r.top+8});setOpen(v=>!v)};
  useEffect(()=>{
    if(!open)return;
    const close=e=>{if(!ref.current?.contains(e.target))setOpen(false)};
    const key=e=>{if(e.key==="Escape")setOpen(false)};
    document.addEventListener("pointerdown",close);document.addEventListener("keydown",key);
    return()=>{document.removeEventListener("pointerdown",close);document.removeEventListener("keydown",key)};
  },[open]);
  return <span className="langSwitch" ref={ref} data-no-i18n>
    <button ref={btn} type="button" className="langSwitchCurrent" aria-haspopup="listbox" aria-expanded={open} title={langInfo(lang).name} onClick={toggle}>{langInfo(lang).code}</button>
    {open&&<span className="langSwitchMenu" role="listbox" aria-label="Idioma" style={pos?{position:"fixed",right:pos.right,bottom:pos.bottom}:undefined}>
      {LANGS.map(l=><button type="button" role="option" aria-selected={l.id===lang} key={l.id} className={l.id===lang?"active":""} onClick={()=>{setLang(l.id);setOpen(false)}}><b>{l.code}</b><span>{l.name}</span></button>)}
    </span>}
  </span>;
}
