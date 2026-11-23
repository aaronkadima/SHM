import React,{useCallback,useEffect,useRef,useState}from"react";
import{ChevronLeft,ChevronRight,Download,FileCode2,FileSpreadsheet,Pencil,Play,Trash2,Undo2,X}from"lucide-react";
import{svgUrl}from"./svgCanvas.js";
import{__cdm4Test,cdm4Config,cdm4StageData}from"./cdm4Core.js";
import{cutBase,profile,measureRows,measuresCsv}from"./cdm4CutAnalysis.js";
import{CUT_FIG_W,CUT_FIG_H,cutLabel,crackLabel,distLabel,crackCsv,distancesCsv,figureCrack,figureCurves,figureDistances,figureMaps,figureMeasures,figureProfile,figureScale,figureSheet}from"./cdm4CutFigures.js";
import{crackWidth,grayOf,applyCrackMetric}from"./cdm4CrackWidth.js";
import{makeMetric,pickComponent,minDistance,quadOk}from"./measureGeometry.js";
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
function downloadUrl(url,name){const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000)}
export const SNAP_DEG=15;
// Ctrl (ou ⌘): ângulo em múltiplos de 15° e comprimento em passos fixos, como no Inkscape; Shift: horizontal/vertical
export function snapCut(s,p,{ctrl=false,shift=false,step=20,W=Infinity,H=Infinity}={}){
  let dx=p.x-s.x,dy=p.y-s.y;
  if(ctrl){const a=Math.round(Math.atan2(dy,dx)/(SNAP_DEG*Math.PI/180))*(SNAP_DEG*Math.PI/180),st=Math.max(1,step);let L=Math.max(st,Math.round(Math.hypot(dx,dy)/st)*st);
    const inside=L=>{const x=s.x+L*Math.cos(a),y=s.y+L*Math.sin(a);return x>=0&&y>=0&&x<=W-1&&y<=H-1};
    while(L>st&&!inside(L))L-=st;dx=L*Math.cos(a);dy=L*Math.sin(a)}
  else if(shift){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0}
  return{x:s.x+dx,y:s.y+dy};
}
const toUrl=c=>new Promise(res=>c.toBlob(b=>res(b?URL.createObjectURL(b):c.toDataURL("image/png")),"image/png"));
export function parseLevels(text){
  const v=String(text||"").split(/[;\s]+/).map(t=>parseFloat(t.replace(",","."))).filter(x=>isFinite(x)&&x>0&&x<1);
  return[...new Set(v.map(x=>+x.toFixed(3)))].sort((a,b)=>a-b).slice(0,5);
}

export default function CutLevelTool({active,onClose,result,file,options,canvasElement,gtItems,gtSize}){
  const[phase,setPhase]=useState("draw"),[cuts,setCuts]=useState([]),[drag,setDrag]=useState(null),[levels,setLevels]=useState("0,3; 0,5"),[mode,setMode]=useState("cut"),[cracks,setCracks]=useState([]),[crackR,setCrackR]=useState(20),[dists,setDists]=useState([]),[pendingDist,setPendingDist]=useState(null),[quad,setQuad]=useState([]),[scaleW,setScaleW]=useState(1000),[scaleH,setScaleH]=useState(1000),[step,setStep]=useState(20),[cursor,setCursor]=useState(null);
  const[figs,setFigs]=useState(null),[err,setErr]=useState(""),[zoom,setZoom]=useState(null),[,setTick]=useState(0);
  const start=useRef(null),urls=useRef([]),cache=useRef(null),built=useRef(null);
  const release=()=>{for(const u of urls.current)if(u.startsWith("blob:"))URL.revokeObjectURL(u);urls.current=[]};
  const W=result?.metrics?.processed_width||0,H=result?.metrics?.processed_height||0;
  useEffect(()=>{if(active){setPhase("draw");setFigs(null);setErr("");setZoom(null)}else release()},[active]);
  useEffect(()=>{cache.current=null;setCuts([]);setCracks([]);setDists([]);setPendingDist(null)},[result,file]);
  // escala por 4 pontos guardada por foto (nome + tamanho)
  const scaleKey=file?"shmScale:"+file.name+":"+file.size:null;
  useEffect(()=>{if(!scaleKey)return;try{const v=JSON.parse(localStorage.getItem(scaleKey)||"null");if(v?.quad?.length===4){setQuad(v.quad);setScaleW(v.wmm);setScaleH(v.hmm)}else setQuad([])}catch{setQuad([])}},[scaleKey]);
  useEffect(()=>{if(!scaleKey)return;try{if(quad.length===4)localStorage.setItem(scaleKey,JSON.stringify({quad,wmm:scaleW,hmm:scaleH}));else if(!quad.length)localStorage.removeItem(scaleKey)}catch{}},[scaleKey,quad,scaleW,scaleH]);
  useEffect(()=>()=>release(),[]);
  useEffect(()=>{if(!active)return;const r=()=>setTick(t=>t+1);window.addEventListener("resize",r);return()=>window.removeEventListener("resize",r)},[active]);
  const nFig=figs?.items.length||0;
  useEffect(()=>{if(!active)return;const k=e=>{
    if(e.target?.tagName==="INPUT")return;
    if(zoom!=null){if(e.key==="Escape"){e.stopPropagation();setZoom(null)}else if(e.key==="ArrowRight"){e.stopPropagation();setZoom(z=>(z+1)%nFig)}else if(e.key==="ArrowLeft"){e.stopPropagation();setZoom(z=>(z+nFig-1)%nFig)}return}
    if(e.key==="Escape"){e.stopPropagation();onClose?.()}
    else if(phase==="draw"&&(e.key==="Backspace"||(e.key==="z"&&(e.ctrlKey||e.metaKey)))){e.preventDefault();e.stopPropagation();(mode==="crack"?setCracks:mode==="dist"?setDists:mode==="scale"?setQuad:setCuts)(c=>c.slice(0,-1))}
  };window.addEventListener("keydown",k,true);return()=>window.removeEventListener("keydown",k,true)},[active,onClose,zoom,nFig,phase,mode]);

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
        C=cache.current={img,rw:d?.random_walker?.prob?d.random_walker:null,gray:grayOf(img.data,W,H),masks:d?.final||null};
      }
      if(!C.rw&&(cuts.length||(!cracks.length&&!dists.length&&quad.length!==4)))throw new Error(tr("O random walker não gerou potencial nesta imagem."));
      const lv=parseLevels(levels);
      const mmPerPx=Number(result?.metrics?.mm_per_px||options?.cdm_mm_per_px||0);
      const metric=quad.length===4&&quadOk(quad)&&scaleW>0&&scaleH>0?makeMetric({kind:"homography",quad,wmm:+scaleW,hmm:+scaleH}):mmPerPx>0?makeMetric({kind:"mmpx",mmPerPx}):null;
      const scaleLabel=!metric?"":metric.kind==="homography"?`homografia 4 pontos ${scaleW}x${scaleH} mm`:`${mmPerPx} mm/px`;
      const K=cracks.map(a=>applyCrackMetric(crackWidth(C.gray,W,H,a,{R:crackR}),metric));
      if(dists.length&&!C.masks)throw new Error(tr("Sem máscaras do motor para localizar os contornos."));
      const D=dists.map(p=>{const A=pickComponent(C.masks,W,H,p.a[0],p.a[1]),Bc=pickComponent(C.masks,W,H,p.b[0],p.b[1]);return{...p,A,B:Bc,res:A&&Bc?minDistance(A,Bc,W,H,metric):null}});
      const B=C.rw?cutBase(C.img.data,W,H,C.rw,{gt:gtMask(gtItems,gtSize,W,H),levels:lv.length?lv:[.3,.5],metric}):null;
      const P=B?cuts.map(c=>profile(B,c)):[],cs=[...cuts];
      // construtores: os mesmos desenham o PNG (canvas) e, sob demanda, o SVG com texto editável
      const hasH=metric?.kind==="homography";
      const builders=[...(hasH?[()=>figureScale(metric,C.img)]:[]),...(B?[()=>figureMaps(B,C.img,cs),...P.map((p,i)=>()=>figureProfile(B,p,i,C.img)),...(P.length?[()=>figureMeasures(B,P)]:[])]:[]),...K.map((k,i)=>()=>figureCrack(k,i,C.img,metric)),...(D.length?[()=>figureDistances(D,C.img,metric)]:[]),...(B?[()=>figureCurves(B)]:[])];
      const csv=measuresCsv(measureRows(P,cutLabel),scaleLabel);
      built.current={builders,sheet:()=>figureSheet(builders.map(f=>f()))};
      const list=builders.map(f=>f());
      const names=[...(hasH?["escala"]:[]),...(B?["mapas",...P.map((_,i)=>"perfil-"+cutLabel(i)),...(P.length?["medidas"]:[])]:[]),...K.map((_,i)=>"fissura-"+crackLabel(i)),...(D.length?["distancias"]:[]),...(B?["curva-de-corte"]:[])];
      const titles=[...(hasH?[tr("Escala e perspectiva")]:[]),...(B?[tr("Mapas"),...P.map((_,i)=>tr("Perfil de corte")+" "+cutLabel(i)),...(P.length?[tr("Medidas")]:[])]:[]),...K.map((_,i)=>tr("Largura de fissura")+" "+crackLabel(i)),...(D.length?[tr("Distâncias")]:[]),...(B?[tr("Curva de corte")]:[])];
      const crackCsvText=K.length?crackCsv(K,scaleLabel):null,distCsvText=D.length?distancesCsv(D,scaleLabel):null;
      release();
      const u=await Promise.all([...list,figureSheet(list)].map(toUrl));urls.current=u;
      setFigs({items:u.slice(0,list.length),sheet:u[list.length],names,titles,lang:getLang(),csv:P.length?csv:null,crackCsv:crackCsvText,distCsv:distCsvText,iou:B?.gt?[B.global.bin.iou,B.global.walker.iou]:null,agreement:B?B.global.agreement:null});
      setZoom(null);setPhase("done");
    }catch(e){setErr(String(e?.message||e));setPhase("draw")}
  },[file,result,options,W,H,gtItems,gtSize,cuts,levels,cracks,crackR,dists,quad,scaleW,scaleH]);

  if(!active)return null;
  const r=imageRect(),k=r&&W?r.width/W:1;
  const toImg=(cx,cy)=>({x:Math.min(W-1,Math.max(0,(cx-r.left)/k)),y:Math.min(H-1,Math.max(0,(cy-r.top)/k))});
  const onDown=e=>{if(e.button!==0||!r)return;
    if(mode==="dist"||mode==="scale"){const p=toImg(e.clientX,e.clientY),pt=[Math.round(p.x*10)/10,Math.round(p.y*10)/10];
      if(mode==="dist"){if(!pendingDist)setPendingDist(pt);else{setDists(d=>[...d,{a:pendingDist,b:pt}]);setPendingDist(null)}}
      else setQuad(q=>q.length>=4?[pt]:[...q,pt]);return}e.currentTarget.setPointerCapture?.(e.pointerId);const p=toImg(e.clientX,e.clientY);start.current=p;setDrag({x1:p.x,y1:p.y,x2:p.x,y2:p.y})};
  const onMove=e=>{const s=start.current;if(!s||!r){setCursor(null);return}
    const p=snapCut(s,toImg(e.clientX,e.clientY),{ctrl:e.ctrlKey||e.metaKey,shift:e.shiftKey,step:+step||20,W,H});
    setDrag({x1:s.x,y1:s.y,x2:p.x,y2:p.y});setCursor({x:e.clientX,y:e.clientY,snap:e.ctrlKey||e.metaKey})};
  const onUp=()=>{const d=drag;start.current=null;setDrag(null);setCursor(null);if(d&&Math.hypot(d.x2-d.x1,d.y2-d.y1)*k>=12)(mode==="crack"?setCracks:setCuts)(c=>[...c,{x1:Math.round(d.x1),y1:Math.round(d.y1),x2:Math.round(d.x2),y2:Math.round(d.y2)}])};
  const stop=e=>e.stopPropagation();
  const listOf=m=>m==="crack"?cracks:m==="dist"?dists:m==="scale"?quad:cuts,setterOf=m=>m==="crack"?setCracks:m==="dist"?setDists:m==="scale"?setQuad:setCuts;
  const pct=v=>v==null?"—":(v*100).toFixed(1)+" %";
  return <>
    {phase!=="done"&&<div className="fieldToolSelect cutToolSelect" onContextMenu={e=>e.preventDefault()} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={()=>{start.current=null;setDrag(null)}}>
      {r&&<svg className="cutToolLines" width="100%" height="100%">
        {[...cuts.map((c,i)=>({c,lab:cutLabel(i),col:"#f2c200"})),...cracks.map((c,i)=>({c,lab:crackLabel(i),col:"#b06cff"})),...(drag?[{c:drag,lab:"",col:mode==="crack"?"#b06cff":"#f2c200"}]:[])].map(({c,lab,col},i)=>{const a=[r.left+c.x1*k,r.top+c.y1*k],b=[r.left+c.x2*k,r.top+c.y2*k];return <g key={i}>
          <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="rgba(0,0,0,.55)" strokeWidth="4"/>
          <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={col} strokeWidth="2" strokeDasharray="7 5"/>
          {lab&&<text x={a[0]+5} y={a[1]-7} fill={col} stroke="rgba(0,0,0,.75)" strokeWidth="3" paintOrder="stroke" fontSize="15" fontWeight="800">{lab}</text>}
        </g>})}
        {quad.length>0&&<g>
          <polygon points={quad.map(p=>(r.left+p[0]*k)+","+(r.top+p[1]*k)).join(" ")} fill={quad.length===4?"rgba(0,224,255,.12)":"none"} stroke="#00e0ff" strokeWidth="2" strokeDasharray={quad.length===4?"":"5 4"}/>
          {quad.map((p,i)=><g key={i}><circle cx={r.left+p[0]*k} cy={r.top+p[1]*k} r="5" fill="#00e0ff" stroke="#0b1a22" strokeWidth="1.5"/><text x={r.left+p[0]*k+7} y={r.top+p[1]*k-7} fill="#fff" stroke="rgba(0,0,0,.75)" strokeWidth="3" paintOrder="stroke" fontSize="13" fontWeight="800">{i+1}</text></g>)}
        </g>}
        {dists.map((d,i)=>{const a=[r.left+d.a[0]*k,r.top+d.a[1]*k],b=[r.left+d.b[0]*k,r.top+d.b[1]*k];return <g key={"d"+i}>
          <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="rgba(255,255,255,.7)" strokeWidth="1.5" strokeDasharray="3 4"/>
          <circle cx={a[0]} cy={a[1]} r="6" fill="#4fe08a" stroke="#0b1a22" strokeWidth="1.5"/><circle cx={b[0]} cy={b[1]} r="6" fill="#ff5fd2" stroke="#0b1a22" strokeWidth="1.5"/>
          <text x={(a[0]+b[0])/2+6} y={(a[1]+b[1])/2-6} fill="#f2c200" stroke="rgba(0,0,0,.75)" strokeWidth="3" paintOrder="stroke" fontSize="14" fontWeight="800">{distLabel(i)}</text></g>})}
        {pendingDist&&<circle cx={r.left+pendingDist[0]*k} cy={r.top+pendingDist[1]*k} r="7" fill="#4fe08a" stroke="#fff" strokeWidth="2"/>}
      </svg>}
      {drag&&cursor&&(()=>{const L=Math.hypot(drag.x2-drag.x1,drag.y2-drag.y1),a=-Math.atan2(drag.y2-drag.y1,drag.x2-drag.x1)*180/Math.PI;
        return <div className={"cutToolReadout"+(cursor.snap?" snap":"")} style={{left:cursor.x+16,top:cursor.y+16}}>{Math.round(L)} px · {Math.round(a)}°{cursor.snap?" · "+tr("passo")+" "+step+" px":""}</div>})()}
      <div className="cutToolBar" onPointerDown={stop} onPointerUp={stop}>
        <span className="cutToolHintText">{phase==="running"?tr("Gerando o estudo comparativo…"):(mode==="dist"?(pendingDist?tr("Distância: agora clique no segundo contorno"):tr("Distância: clique no primeiro contorno")):mode==="scale"?tr("Escala: clique os 4 cantos do retângulo de referência, em sentido horário a partir do superior esquerdo"):mode==="crack"?tr("Fissura: trace o eixo ao longo da fissura · Ctrl = passos de 15° e de comprimento"):tr("Corte de nível: arraste linhas de corte · Ctrl = passos de 15° e de comprimento · Shift = horizontal/vertical"))}{err&&<em> · {err}</em>}</span>
        <span className="cutToolMode" role="radiogroup" aria-label={tr("O que traçar")}>
          <button type="button" role="radio" aria-checked={mode==="cut"} className={mode==="cut"?"on":""} onClick={()=>setMode("cut")} title={tr("Linhas de corte: perfis binarização × potencial e largura do desplacamento")}>{tr("Corte")} · {cuts.length}</button>
          <button type="button" role="radio" aria-checked={mode==="crack"} className={"crack"+(mode==="crack"?" on":"")} onClick={()=>setMode("crack")} title={tr("Trace o eixo ao longo da fissura: largura pelo perfil perpendicular")}>{tr("Fissura")} · {cracks.length}</button>
          <button type="button" role="radio" aria-checked={mode==="dist"} className={"dist"+(mode==="dist"?" on":"")} onClick={()=>setMode("dist")} title={tr("Clique em dois contornos: menor distância entre eles")}>{tr("Distância")} · {dists.length}</button>
          <button type="button" role="radio" aria-checked={mode==="scale"} className={"scale"+(mode==="scale"?" on":"")} onClick={()=>setMode("scale")} title={tr("Clique os 4 cantos de um retângulo conhecido no plano da superfície (sentido horário, a partir do canto superior esquerdo)")}>{tr("Escala")} · {quad.length}/4</button>
        </span>
        <label className="cutToolLevels" title={tr("Com Ctrl pressionado, o comprimento do corte avança neste passo")}>{tr("Passo (Ctrl)")}<input className="short" type="number" min="1" max="500" value={step} onChange={e=>setStep(Math.max(1,Math.min(500,Math.round(+e.target.value||1))))} aria-label={tr("Passo (Ctrl)")}/>px</label>
        {mode==="scale"&&<label className="cutToolLevels" title={tr("Dimensões reais do retângulo de referência")}>{tr("Largura")}<input className="short" type="number" min="1" value={scaleW} onChange={e=>setScaleW(Math.max(1,+e.target.value||1))} aria-label={tr("Largura (mm)")}/>×<input className="short" type="number" min="1" value={scaleH} onChange={e=>setScaleH(Math.max(1,+e.target.value||1))} aria-label={tr("Altura (mm)")}/>mm</label>}
        {mode==="crack"&&<label className="cutToolLevels" title={tr("Meia largura de cada perfil perpendicular ao eixo")}>{tr("Perfil ±")}<input className="short" type="number" min="6" max="80" value={crackR} onChange={e=>setCrackR(Math.max(6,Math.min(80,Math.round(+e.target.value||20))))} aria-label={tr("Perfil ±")}/>px</label>}
        {mode==="cut"&&<label className="cutToolLevels">{tr("Níveis do walker")}<input value={levels} onChange={e=>setLevels(e.target.value)} placeholder="0,3; 0,5" aria-label={tr("Níveis do walker")}/></label>}
        <button type="button" disabled={!listOf(mode).length||phase==="running"} onClick={()=>{setPendingDist(null);setterOf(mode)(c=>c.slice(0,-1))}} title={tr("Desfazer último corte")}><Undo2 size={15}/></button>
        <button type="button" disabled={!listOf(mode).length||phase==="running"} onClick={()=>{setPendingDist(null);setterOf(mode)([])}} title={tr("Limpar cortes")}><Trash2 size={15}/></button>
        <button type="button" className="primary" disabled={phase==="running"} onClick={run}><Play size={14}/> {tr("Analisar")}</button>
        <button type="button" aria-label={tr("Fechar")} onClick={onClose}><X size={16}/></button>
      </div>
    </div>}
    {phase==="done"&&figs&&<div className="fieldToolPanel" role="dialog" aria-modal="true" aria-label={tr("Corte de nível")}>
      <section className="cutToolPanel">
        <header>
          <div><b>{tr("Corte de nível · binarização × potencial do walker")}</b><span>{cuts.length} {tr("corte(s)")} · {cracks.length} {tr("fissura(s)")} · {dists.length} {tr("distância(s)")} · {figs.items.length} {tr("figuras")} · {CUT_FIG_W} × {CUT_FIG_H} px · {figs.iou?`IoU ${tr("binarização")} ${pct(figs.iou[0])} · ${tr("walker")} ${pct(figs.iou[1])}`:figs.agreement!=null?`${tr("sem GT")} · ${tr("concordância")} ${pct(figs.agreement)}`:""}</span></div>
          <button type="button" onClick={()=>{setPhase("draw");setFigs(null)}}><Pencil size={15}/> {tr("Editar cortes")}</button>
          <a className="fieldToolBtn" href={figs.sheet} download={"corte-de-nivel-folha-"+figs.lang+".png"}><Download size={15}/> {tr("Folha com todas")}</a>
          {figs.distCsv&&<button type="button" title={tr("Menores distâncias entre contornos em CSV")} onClick={()=>downloadUrl(URL.createObjectURL(new Blob(["\ufeff"+figs.distCsv],{type:"text/csv"})),"corte-de-nivel-distancias.csv")}><FileSpreadsheet size={15}/> {tr("CSV distâncias")}</button>}
          {figs.crackCsv&&<button type="button" title={tr("Largura de cada perfil das fissuras em CSV")} onClick={()=>downloadUrl(URL.createObjectURL(new Blob(["\ufeff"+figs.crackCsv],{type:"text/csv"})),"corte-de-nivel-fissuras.csv")}><FileSpreadsheet size={15}/> {tr("CSV fissuras")}</button>}
          {figs.csv&&<button type="button" title={tr("Medidas de largura em CSV (separador ponto e vírgula)")} onClick={()=>downloadUrl(URL.createObjectURL(new Blob(["\ufeff"+figs.csv],{type:"text/csv"})),"corte-de-nivel-medidas.csv")}><FileSpreadsheet size={15}/> CSV</button>}
          <button type="button" title={tr("Folha com todas em SVG (texto editável)")} onClick={()=>downloadUrl(svgUrl(built.current.sheet,tr("Corte de nível")),"corte-de-nivel-folha-"+figs.lang+".svg")}><FileCode2 size={15}/> SVG</button>
          <button type="button" aria-label={tr("Fechar")} onClick={onClose}><X size={17}/></button>
        </header>
        <div className="cutToolGrid">
          {figs.items.map((u,i)=><figure key={i}><button type="button" className="fieldToolThumb" title={tr("Ampliar")} onClick={()=>setZoom(i)}><img src={u} alt={figs.titles[i]}/></button>
            <figcaption>{figs.titles[i]}</figcaption><span className="figActions"><a href={u} download={"corte-de-nivel-"+figs.names[i]+"-"+figs.lang+".png"} title={tr("Baixar figura")+" (PNG)"}><Download size={14}/></a><button type="button" title={tr("Baixar figura")+" (SVG, "+tr("texto editável")+")"} onClick={()=>downloadUrl(svgUrl(built.current.builders[i],figs.titles[i]),"corte-de-nivel-"+figs.names[i]+"-"+figs.lang+".svg")}><FileCode2 size={14}/></button></span></figure>)}
        </div>
        {zoom!=null&&<div className="fieldToolZoom" onClick={()=>setZoom(null)}>
          <button type="button" className="fieldToolNav prev" aria-label={tr("Anterior")} onClick={e=>{e.stopPropagation();setZoom((zoom+nFig-1)%nFig)}}><ChevronLeft size={26}/></button>
          <img className="cutToolZoomImg" src={figs.items[zoom]} alt="" onClick={e=>e.stopPropagation()}/>
          <button type="button" className="fieldToolNav next" aria-label={tr("Próxima")} onClick={e=>{e.stopPropagation();setZoom((zoom+1)%nFig)}}><ChevronRight size={26}/></button>
          <div className="fieldToolZoomBar" onClick={e=>e.stopPropagation()}><span>{figs.titles[zoom]} · {zoom+1} / {nFig}</span><a href={figs.items[zoom]} download={"corte-de-nivel-"+figs.names[zoom]+"-"+figs.lang+".png"}><Download size={14}/> PNG</a><button type="button" onClick={()=>downloadUrl(svgUrl(built.current.builders[zoom],figs.titles[zoom]),"corte-de-nivel-"+figs.names[zoom]+"-"+figs.lang+".svg")}><FileCode2 size={14}/> SVG</button><button type="button" onClick={()=>setZoom(null)}><X size={15}/> {tr("Fechar")}</button></div>
        </div>}
      </section>
    </div>}
  </>;
}
