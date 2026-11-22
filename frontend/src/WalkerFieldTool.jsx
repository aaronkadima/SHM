import React,{useCallback,useEffect,useRef,useState}from"react";
import{Download,RotateCcw,X}from"lucide-react";
import{__cdm4Test,cdm4Config,cdm4StageData}from"./cdm4Core.js";
import{analyzeWalkerField}from"./cdm4FieldAnalysis.js";
import{FIELD_FIGURE_SIZE,figureArrows,figureDispersion,figurePanel,figureRose,figureTable}from"./cdm4FieldFigures.js";
import{tr,getLang}from"./i18n.js";

// Ferramenta "Campo do walker" (CDM-4): o usuário arrasta um quadrado 1:1 sobre a imagem; o walker é
// refeito em resolução cheia dentro dele e quatro figuras do mesmo tamanho são geradas:
// malha de setas −∇u, rosa do desvio angular, dispersão local e tabela de coerência.
async function decodeProcessed(file,W,H){
  const bmp=await createImageBitmap(file,{imageOrientation:"from-image"});
  const c=document.createElement("canvas");c.width=W;c.height=H;const ctx=c.getContext("2d",{willReadFrequently:true});ctx.drawImage(bmp,0,0,W,H);bmp.close?.();
  return ctx.getImageData(0,0,W,H);
}
const toUrl=c=>new Promise(res=>c.toBlob(b=>res(b?URL.createObjectURL(b):c.toDataURL("image/png")),"image/png"));

export default function WalkerFieldTool({active,onClose,result,file,options,canvasElement}){
  const[phase,setPhase]=useState("select"),[drag,setDrag]=useState(null),[figs,setFigs]=useState(null),[err,setErr]=useState(""),[info,setInfo]=useState(null);
  const start=useRef(null),urls=useRef([]);
  const release=()=>{for(const u of urls.current)if(u.startsWith("blob:"))URL.revokeObjectURL(u);urls.current=[]};
  useEffect(()=>{if(active){setPhase("select");setDrag(null);setFigs(null);setErr("")}else release()},[active]);
  useEffect(()=>()=>release(),[]);
  useEffect(()=>{if(!active)return;const k=e=>{if(e.key==="Escape"){e.stopPropagation();onClose?.()}};window.addEventListener("keydown",k,true);return()=>window.removeEventListener("keydown",k,true)},[active,onClose]);

  const imageRect=()=>{
    const imgs=[...(canvasElement?.current?.querySelectorAll("img")||[])].filter(i=>i.offsetParent!==null);
    let best=null,area=0;for(const i of imgs){const r=i.getBoundingClientRect();if(r.width*r.height>area){area=r.width*r.height;best=r}}
    return best;
  };
  const W=result?.metrics?.processed_width||0,H=result?.metrics?.processed_height||0;

  const run=useCallback(async roi=>{
    setPhase("running");setErr("");
    try{
      const img=await decodeProcessed(file,W,H);
      let d=cdm4StageData(result);
      if(!d?.random_walker?.prob){
        const cfg=cdm4Config({...(options||{}),cdm_context_filter:"off",cdm4_flow:result?.metrics?.protocol?.flow||options?.cdm4_flow});cfg.returnStages=true;
        d={...__cdm4Test.computeCdm4Core(img,null,cfg).stages};
      }
      const rw=d.random_walker;if(!rw?.prob)throw new Error(tr("O random walker não gerou potencial nesta imagem."));
      await new Promise(r=>setTimeout(r,20));
      const F=analyzeWalkerField(img.data,W,H,rw,roi);
      const list=[figureArrows(F),figureRose(F),figureDispersion(F),figureTable(F)];
      release();
      const u=await Promise.all([...list,figurePanel(list)].map(toUrl));urls.current=u;
      setFigs({items:u.slice(0,4),panel:u[4]});setInfo({roi:F.roi,R:F.R,regions:F.regions.length,ms:F.ms,lang:getLang()});setPhase("done");
    }catch(e){setErr(String(e?.message||e));setPhase("select")}
  },[file,result,options,W,H]);

  if(!active)return null;
  const onDown=e=>{if(e.button!==0)return;const r=imageRect();if(!r)return;e.currentTarget.setPointerCapture?.(e.pointerId);start.current={x:e.clientX,y:e.clientY,r};setDrag({x:e.clientX,y:e.clientY,s:0})};
  const onMove=e=>{const s=start.current;if(!s)return;const dx=e.clientX-s.x,dy=e.clientY-s.y,side=Math.max(Math.abs(dx),Math.abs(dy));setDrag({x:dx<0?s.x-side:s.x,y:dy<0?s.y-side:s.y,s:side})};
  const onUp=()=>{
    const s=start.current;start.current=null;if(!s||!drag||drag.s<8){setDrag(null);return}
    const k=W/s.r.width,x=(drag.x-s.r.left)*k,y=(drag.y-s.r.top)*k,size=Math.round(drag.s*k);
    run({x,y,size:Math.max(24,size)});
  };
  const name=(i)=>["campo-setas","desvio-angular","dispersao-local","coerencia"][i]+"-"+(info?.lang||"pt")+".png";
  return <>
    {phase!=="done"&&<div className="fieldToolSelect" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={()=>{start.current=null;setDrag(null)}}>
      <div className="fieldToolHint">{phase==="running"?tr("Resolvendo o walker em resolução cheia…"):tr("Campo do walker: arraste um quadrado 1:1 sobre a imagem · Esc cancela")}{err&&<em> · {err}</em>}</div>
      {drag&&drag.s>0&&<div className="fieldToolSquare" style={{left:drag.x,top:drag.y,width:drag.s,height:drag.s}}/>}
    </div>}
    {phase==="done"&&figs&&<div className="fieldToolPanel" role="dialog" aria-modal="true" aria-label={tr("Campo do walker")}>
      <section>
        <header>
          <div><b>{tr("Campo do walker")}</b><span>{info?.roi?.size} × {info?.roi?.size} px · R {info?.R?.toFixed(2)} · {info?.regions} {tr("região(ões)")} · {FIELD_FIGURE_SIZE} × {FIELD_FIGURE_SIZE} px</span></div>
          <button type="button" onClick={()=>{setPhase("select");setFigs(null)}}><RotateCcw size={15}/> {tr("Nova seleção")}</button>
          <a className="fieldToolBtn" href={figs.panel} download={"campo-walker-painel-"+(info?.lang||"pt")+".png"}><Download size={15}/> {tr("Painel 2×2")}</a>
          <button type="button" aria-label={tr("Fechar")} onClick={onClose}><X size={17}/></button>
        </header>
        <div className="fieldToolGrid">
          {figs.items.map((u,i)=><figure key={i}><img src={u} alt=""/><a href={u} download={name(i)} title={tr("Baixar figura")}><Download size={14}/></a></figure>)}
        </div>
      </section>
    </div>}
  </>;
}
