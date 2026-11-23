import React,{useCallback,useEffect,useRef,useState}from"react";
import{ChevronLeft,ChevronRight,Download,Pencil,Play,Trash2,Undo2,X}from"lucide-react";
import{__cdm4Test,cdm4Config,cdm4StageData}from"./cdm4Core.js";
import{cutBase,profile}from"./cdm4CutAnalysis.js";
import{CUT_FIG_W,CUT_FIG_H,cutLabel,figureCurves,figureMaps,figureProfile,figureSheet}from"./cdm4CutFigures.js";
import{classMask,usable}from"./annotationCore.js";
import{tr,getLang}from"./i18n.js";

// Ferramenta "Corte de nível" (CDM-4): estudo comparativo binarização × potencial do walker.
// O usuário traça n linhas de corte sobre a imagem e escolhe os níveis do walker; saem os mapas,
// um perfil de terreno por linha e a curva de corte, todos com 1200 × 800 px e interpretação anotada.
async function decodeProcessed(file,W,H){
  const bmp=await createImageBitmap(file,{imageOrientation:"from-image"});
  const c=document.createElement("canvas");c.width=W;c.height=H;const ctx=c.getContext("2d",{willReadFrequently:true});ctx.drawImage(bmp,0,0,W,H);bmp.close?.();
  return ctx.getImageData(0,0,W,H);
}
function gtMask(items,gtSize,W,H){
  const sp=(items||[]).filter(a=>usable(a)&&a.cls==="spalling_dark");if(!sp.length)return null;
  return classMask(sp,"spalling_dark",W,H,W/Math.max(1,gtSize?.width||W));
}
const toUrl=c=>new Promise(res=>c.toBlob(b=>res(b?URL.createObjectURL(b):c.toDataURL("image/png")),"image/png"));
export function parseLevels(text){
  const v=String(text||"").split(/[;\s]+/).map(t=>parseFloat(t.replace(",","."))).filter(x=>isFinite(x)&&x>0&&x<1);
  return[...new Set(v.map(x=>+x.toFixed(3)))].sort((a,b)=>a-b).slice(0,5);
}

export default function CutLevelTool({active,onClose,result,file,options,canvasElement,gtItems,gtSize}){
  const[phase,setPhase]=useState("draw"),[cuts,setCuts]=useState([]),[drag,setDrag]=useState(null),[levels,setLevels]=useState("0,3; 0,5");
  const[figs,setFigs]=useState(null),[err,setErr]=useState(""),[zoom,setZoom]=useState(null),[,setTick]=useState(0);
  const start=useRef(null),urls=useRef([]),cache=useRef(null);
  const release=()=>{for(const u of urls.current)if(u.startsWith("blob:"))URL.revokeObjectURL(u);urls.current=[]};
  const W=result?.metrics?.processed_width||0,H=result?.metrics?.processed_height||0;
  useEffect(()=>{if(active){setPhase("draw");setFigs(null);setErr("");setZoom(null)}else release()},[active]);
  useEffect(()=>{cache.current=null;setCuts([])},[result,file]);
  useEffect(()=>()=>release(),[]);
  useEffect(()=>{if(!active)return;const r=()=>setTick(t=>t+1);window.addEventListener("resize",r);return()=>window.removeEventListener("resize",r)},[active]);
  const nFig=figs?.items.length||0;
  useEffect(()=>{if(!active)return;const k=e=>{
    if(e.target?.tagName==="INPUT")return;
    if(zoom!=null){if(e.key==="Escape"){e.stopPropagation();setZoom(null)}else if(e.key==="ArrowRight"){e.stopPropagation();setZoom(z=>(z+1)%nFig)}else if(e.key==="ArrowLeft"){e.stopPropagation();setZoom(z=>(z+nFig-1)%nFig)}return}
    if(e.key==="Escape"){e.stopPropagation();onClose?.()}
    else if(phase==="draw"&&(e.key==="Backspace"||(e.key==="z"&&(e.ctrlKey||e.metaKey)))){e.preventDefault();e.stopPropagation();setCuts(c=>c.slice(0,-1))}
  };window.addEventListener("keydown",k,true);return()=>window.removeEventListener("keydown",k,true)},[active,onClose,zoom,nFig,phase]);

  const imageRect=()=>{
    const imgs=[...(canvasElement?.current?.querySelectorAll("img")||[])].filter(i=>i.offsetParent!==null);
    let best=null,area=0;for(const i of imgs){const r=i.getBoundingClientRect();if(r.width*r.height>area){area=r.width*r.height;best=r}}
    return best;
  };

  const run=useCallback(async()=>{
    setPhase("running");setErr("");
    try{
      await new Promise(r=>setTimeout(r,20));
      let C=cache.current;
      if(!C){
        const img=await decodeProcessed(file,W,H);
        let d=cdm4StageData(result);
        if(!d?.random_walker?.prob){
          const cfg=cdm4Config({...(options||{}),cdm_context_filter:"off",cdm4_flow:result?.metrics?.protocol?.flow||options?.cdm4_flow});cfg.returnStages=true;
          d={...__cdm4Test.computeCdm4Core(img,null,cfg).stages};
        }
        if(!d?.random_walker?.prob)throw new Error(tr("O random walker não gerou potencial nesta imagem."));
        C=cache.current={img,rw:d.random_walker};
      }
      const lv=parseLevels(levels);
      const B=cutBase(C.img.data,W,H,C.rw,{gt:gtMask(gtItems,gtSize,W,H),levels:lv.length?lv:[.3,.5]});
      const P=cuts.map(c=>profile(B,c));
      const list=[figureMaps(B,C.img,cuts),...P.map((p,i)=>figureProfile(B,p,i,C.img)),figureCurves(B)];
      const names=["mapas",...P.map((_,i)=>"perfil-"+cutLabel(i)),"curva-de-corte"];
      const titles=[tr("Mapas"),...P.map((_,i)=>tr("Perfil de corte")+" "+cutLabel(i)),tr("Curva de corte")];
      release();
      const u=await Promise.all([...list,figureSheet(list)].map(toUrl));urls.current=u;
      setFigs({items:u.slice(0,list.length),sheet:u[list.length],names,titles,lang:getLang(),iou:B.gt?[B.global.bin.iou,B.global.walker.iou]:null,agreement:B.global.agreement});
      setZoom(null);setPhase("done");
    }catch(e){setErr(String(e?.message||e));setPhase("draw")}
  },[file,result,options,W,H,gtItems,gtSize,cuts,levels]);

  if(!active)return null;
  const r=imageRect(),k=r&&W?r.width/W:1;
  const toImg=(cx,cy)=>({x:Math.min(W-1,Math.max(0,(cx-r.left)/k)),y:Math.min(H-1,Math.max(0,(cy-r.top)/k))});
  const onDown=e=>{if(e.button!==0||!r)return;e.currentTarget.setPointerCapture?.(e.pointerId);const p=toImg(e.clientX,e.clientY);start.current=p;setDrag({x1:p.x,y1:p.y,x2:p.x,y2:p.y})};
  const onMove=e=>{const s=start.current;if(!s||!r)return;let p=toImg(e.clientX,e.clientY);
    if(e.shiftKey){if(Math.abs(p.x-s.x)>=Math.abs(p.y-s.y))p={x:p.x,y:s.y};else p={x:s.x,y:p.y}} // Shift: horizontal/vertical
    setDrag({x1:s.x,y1:s.y,x2:p.x,y2:p.y})};
  const onUp=()=>{const d=drag;start.current=null;setDrag(null);if(d&&Math.hypot(d.x2-d.x1,d.y2-d.y1)*k>=12)setCuts(c=>[...c,{x1:Math.round(d.x1),y1:Math.round(d.y1),x2:Math.round(d.x2),y2:Math.round(d.y2)}])};
  const stop=e=>e.stopPropagation();
  const pct=v=>v==null?"—":(v*100).toFixed(1)+" %";
  return <>
    {phase!=="done"&&<div className="fieldToolSelect cutToolSelect" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={()=>{start.current=null;setDrag(null)}}>
      {r&&<svg className="cutToolLines" width="100%" height="100%">
        {[...cuts,...(drag?[drag]:[])].map((c,i)=>{const a=[r.left+c.x1*k,r.top+c.y1*k],b=[r.left+c.x2*k,r.top+c.y2*k];return <g key={i}>
          <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="rgba(0,0,0,.55)" strokeWidth="4"/>
          <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#f2c200" strokeWidth="2" strokeDasharray="7 5"/>
          {i<cuts.length&&<text x={a[0]+5} y={a[1]-7} fill="#f2c200" stroke="rgba(0,0,0,.75)" strokeWidth="3" paintOrder="stroke" fontSize="15" fontWeight="800">{cutLabel(i)}</text>}
        </g>})}
      </svg>}
      <div className="cutToolBar" onPointerDown={stop} onPointerUp={stop}>
        <span className="cutToolHintText">{phase==="running"?tr("Gerando o estudo comparativo…"):tr("Corte de nível: arraste linhas de corte sobre a imagem (Shift = horizontal/vertical)")}{err&&<em> · {err}</em>}</span>
        <span className="cutToolCount">{cuts.length} {tr("corte(s)")}</span>
        <label className="cutToolLevels">{tr("Níveis do walker")}<input value={levels} onChange={e=>setLevels(e.target.value)} placeholder="0,3; 0,5" aria-label={tr("Níveis do walker")}/></label>
        <button type="button" disabled={!cuts.length||phase==="running"} onClick={()=>setCuts(c=>c.slice(0,-1))} title={tr("Desfazer último corte")}><Undo2 size={15}/></button>
        <button type="button" disabled={!cuts.length||phase==="running"} onClick={()=>setCuts([])} title={tr("Limpar cortes")}><Trash2 size={15}/></button>
        <button type="button" className="primary" disabled={phase==="running"} onClick={run}><Play size={14}/> {tr("Analisar")}</button>
        <button type="button" aria-label={tr("Fechar")} onClick={onClose}><X size={16}/></button>
      </div>
    </div>}
    {phase==="done"&&figs&&<div className="fieldToolPanel" role="dialog" aria-modal="true" aria-label={tr("Corte de nível")}>
      <section className="cutToolPanel">
        <header>
          <div><b>{tr("Corte de nível · binarização × potencial do walker")}</b><span>{cuts.length} {tr("corte(s)")} · {figs.items.length} {tr("figuras")} · {CUT_FIG_W} × {CUT_FIG_H} px · {figs.iou?`IoU ${tr("binarização")} ${pct(figs.iou[0])} · ${tr("walker")} ${pct(figs.iou[1])}`:`${tr("sem GT")} · ${tr("concordância")} ${pct(figs.agreement)}`}</span></div>
          <button type="button" onClick={()=>{setPhase("draw");setFigs(null)}}><Pencil size={15}/> {tr("Editar cortes")}</button>
          <a className="fieldToolBtn" href={figs.sheet} download={"corte-de-nivel-folha-"+figs.lang+".png"}><Download size={15}/> {tr("Folha com todas")}</a>
          <button type="button" aria-label={tr("Fechar")} onClick={onClose}><X size={17}/></button>
        </header>
        <div className="cutToolGrid">
          {figs.items.map((u,i)=><figure key={i}><button type="button" className="fieldToolThumb" title={tr("Ampliar")} onClick={()=>setZoom(i)}><img src={u} alt={figs.titles[i]}/></button>
            <figcaption>{figs.titles[i]}</figcaption><a href={u} download={"corte-de-nivel-"+figs.names[i]+"-"+figs.lang+".png"} title={tr("Baixar figura")}><Download size={14}/></a></figure>)}
        </div>
        {zoom!=null&&<div className="fieldToolZoom" onClick={()=>setZoom(null)}>
          <button type="button" className="fieldToolNav prev" aria-label={tr("Anterior")} onClick={e=>{e.stopPropagation();setZoom((zoom+nFig-1)%nFig)}}><ChevronLeft size={26}/></button>
          <img className="cutToolZoomImg" src={figs.items[zoom]} alt="" onClick={e=>e.stopPropagation()}/>
          <button type="button" className="fieldToolNav next" aria-label={tr("Próxima")} onClick={e=>{e.stopPropagation();setZoom((zoom+1)%nFig)}}><ChevronRight size={26}/></button>
          <div className="fieldToolZoomBar" onClick={e=>e.stopPropagation()}><span>{figs.titles[zoom]} · {zoom+1} / {nFig}</span><a href={figs.items[zoom]} download={"corte-de-nivel-"+figs.names[zoom]+"-"+figs.lang+".png"}><Download size={14}/> {tr("Baixar figura")}</a><button type="button" onClick={()=>setZoom(null)}><X size={15}/> {tr("Fechar")}</button></div>
        </div>}
      </section>
    </div>}
  </>;
}
