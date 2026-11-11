import React,{useEffect,useMemo,useRef,useState}from"react";
import{CheckCircle2,AlertTriangle,XCircle,X,Download,RefreshCw}from"lucide-react";

// Painel flutuante "Paridade CDM": indicadores Python ⇄ navegador e gráficos em SVG nativo
// (sem biblioteca de gráficos). O relatório é gerado no CI (cdm-parity-report.json) e só é
// baixado quando o painel abre. Exporta SVG, PNG (3×), CSV e o JSON completo.

const CLASS_NAMES={cracks:"Fissuras",spalling_dark:"Desplacamento",exposed_rebar:"Armadura exposta",corrosion_rust:"Corrosão",efflorescence_white:"Eflorescência",background:"Fundo"};
// Paleta categórica validada (skill dataviz, slots 1–5, ordem fixa por classe).
const CLASS_COLORS={cracks:"#2a78d6",spalling_dark:"#eb6834",exposed_rebar:"#1baf7a",corrosion_rust:"#eda100",efflorescence_white:"#e87ba4"};
const METRICS=[["area_px2","Área total (px²)"],["length_px","Comprimento de fissuras (px)"],["width_mean_px","Largura média de fissuras (px)"],["count","Nº de objetos"]];
const TABS=[["summary","Resumo"],["cascade","Cascata por etapa"],["bland","Bland-Altman"],["scatter","Dispersão y = x"],["confusion","Matriz cruzada"],["diff","Mapa de divergência"]];
const INK="#263e4b",MUTED="#6f8590",GRID="#e3eaed",FONT="system-ui,-apple-system,Segoe UI,sans-serif";

const fmt=(v,d=4)=>v==null||!Number.isFinite(v)?"—":Math.abs(v)>=1000?v.toLocaleString("pt-BR",{maximumFractionDigits:0}):v.toLocaleString("pt-BR",{maximumFractionDigits:d});
const pct=(v,d=4)=>v==null?"—":(v*100).toLocaleString("pt-BR",{maximumFractionDigits:d})+"%";
function scale(d0,d1,r0,r1){const k=d1===d0?0:(r1-r0)/(d1-d0);return v=>r0+(v-d0)*k}
function ticks(min,max,count=5){
  if(!(max>min)){const d=Math.abs(min)||1;return[min-d,min,min+d]}
  const step0=(max-min)/count,mag=10**Math.floor(Math.log10(step0)),step=[1,2,2.5,5,10].map(m=>m*mag).find(s=>s>=step0)||step0;
  const out=[];for(let v=Math.ceil(min/step)*step;v<=max+step*1e-9;v+=step)out.push(Number(v.toPrecision(12)));return out;
}
function download(name,blob){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000)}
function csvBlob(rows){return new Blob(["﻿"+rows.map(r=>r.map(c=>{const s=String(c??"");return/[;"\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}).join(";")).join("\n")],{type:"text/csv;charset=utf-8"})}
function svgText(svg){const clone=svg.cloneNode(true);clone.setAttribute("xmlns","http://www.w3.org/2000/svg");return'<?xml version="1.0" encoding="UTF-8"?>\n'+clone.outerHTML}
async function svgToPng(svg,scaleFactor=3){
  const vb=svg.viewBox.baseVal,w=vb.width||svg.clientWidth,h=vb.height||svg.clientHeight;
  const img=new Image(),url=URL.createObjectURL(new Blob([svgText(svg)],{type:"image/svg+xml"}));
  await new Promise((ok,err)=>{img.onload=ok;img.onerror=err;img.src=url});
  const c=document.createElement("canvas");c.width=Math.round(w*scaleFactor);c.height=Math.round(h*scaleFactor);
  const ctx=c.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(url);
  return new Promise(ok=>c.toBlob(ok,"image/png"));
}
function decodeThumb(t){const bin=atob(t.b64),out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}

// ---------- Gráficos ----------
function Axes({x,y,w,h,m,xTicks,yTicks,xFmt=fmt,yFmt=fmt,xLabel,yLabel}){
  return <g fontFamily={FONT} fontSize="10" fill={MUTED}>
    {yTicks.map(t=><g key={"y"+t}><line x1={m.l} x2={w-m.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth="1"/><text x={m.l-6} y={y(t)+3} textAnchor="end">{yFmt(t)}</text></g>)}
    {xTicks&&xTicks.map(t=><text key={"x"+t} x={x(t)} y={h-m.b+14} textAnchor="middle">{xFmt(t)}</text>)}
    <line x1={m.l} x2={w-m.r} y1={h-m.b} y2={h-m.b} stroke="#b9c7cd"/>
    {xLabel&&<text x={(m.l+w-m.r)/2} y={h-4} textAnchor="middle" fill={INK} fontWeight="600">{xLabel}</text>}
    {yLabel&&<text transform={`translate(12 ${(m.t+h-m.b)/2}) rotate(-90)`} textAnchor="middle" fill={INK} fontWeight="600">{yLabel}</text>}
  </g>;
}
function Legend({items,x,y}){
  return <g fontFamily={FONT} fontSize="10" fill={INK}>{items.map((it,i)=><g key={it.id} transform={`translate(${x+(i%3)*150} ${y+Math.floor(i/3)*14})`}><rect width="12" height="3" y="-4" rx="1.5" fill={it.color}/><text x="17" y="0">{it.label}</text></g>)}</g>;
}
function CascadeChart({report,metric,svgRef}){
  const W=640,H=330,m={l:62,r:24,t:18,b:58},stages=report.stages,classes=report.classes;
  const vals=classes.flatMap(c=>stages.map(([s])=>report.cascade[c]?.[s]?.[metric]).filter(v=>v!=null));
  const lo=metric==="iou"?Math.min(.999,...vals.map(v=>v-.0005)):0,hi=metric==="iou"?1:Math.max(1e-6,...vals)*1.15;
  const x=scale(0,stages.length-1,m.l,W-m.r),y=scale(lo,hi,H-m.b,m.t),yt=ticks(lo,hi,4);
  return <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cascata por etapa: IoU cruzado ou PMR por família ao longo do pipeline">
    <rect width={W} height={H} fill="#fff"/>
    <Axes x={x} y={y} w={W} h={H} m={m} yTicks={yt} yFmt={v=>metric==="iou"?v.toFixed(4).replace(".",","):pct(v,3)} yLabel={metric==="iou"?"IoU cruzado (mín.)":"PMR (máx.)"}/>
    {stages.map(([id,label],i)=><text key={id} x={x(i)} y={H-m.b+14} textAnchor="middle" fontFamily={FONT} fontSize="10" fill={MUTED}>{label}</text>)}
    {metric==="iou"&&<g><line x1={m.l} x2={W-m.r} y1={y(.9999)} y2={y(.9999)} stroke="#c2413b" strokeDasharray="4 3" strokeWidth="1"/><text x={W-m.r} y={y(.9999)+12} textAnchor="end" fontFamily={FONT} fontSize="9.5" fill="#a3312b">tolerância IoU ≥ 0,9999</text></g>}
    {classes.map((c,ci)=>{
      const pts=stages.map(([s],i)=>{const v=report.cascade[c]?.[s]?.[metric];return v==null?null:[x(i),y(v),v,s]}).filter(Boolean);
      const off=(ci-2)*1.6; // separa linhas sobrepostas (paridade perfeita) sem alterar a leitura
      return <g key={c}>
        <polyline points={pts.map(p=>p[0]+","+(p[1]+off)).join(" ")} fill="none" stroke={CLASS_COLORS[c]} strokeWidth="2" strokeLinejoin="round"/>
        {pts.map(p=><circle key={p[3]} cx={p[0]} cy={p[1]+off} r="4" fill={CLASS_COLORS[c]} stroke="#fff" strokeWidth="2"><title>{CLASS_NAMES[c]} · {p[3]}: {metric==="iou"?p[2].toFixed(6):pct(p[2],5)}</title></circle>)}
      </g>;
    })}
    <Legend x={m.l} y={H-22} items={classes.map(c=>({id:c,label:CLASS_NAMES[c],color:CLASS_COLORS[c]}))}/>
  </svg>;
}
function blandData(report,metric){
  return report.measures.filter(r=>r.metric===metric).map(r=>({...r,mean:(r.py+r.js)/2,diff:r.py-r.js}));
}
function BlandAltmanChart({report,metric,svgRef}){
  const W=640,H=330,m={l:62,r:118,t:18,b:42},pts=blandData(report,metric);
  const mean=pts.length?pts.reduce((s,p)=>s+p.diff,0)/pts.length:0,sd=pts.length>1?Math.sqrt(pts.reduce((s,p)=>s+(p.diff-mean)**2,0)/(pts.length-1)):0;
  const lim=[mean-1.96*sd,mean+1.96*sd],maxAbs=Math.max(1,...pts.map(p=>Math.abs(p.diff)),Math.abs(lim[0]),Math.abs(lim[1]))*1.2;
  const xs=pts.map(p=>p.mean),x0=Math.min(0,...xs),x1=Math.max(1,...xs)*1.05;
  const x=scale(x0,x1,m.l,W-m.r),y=scale(-maxAbs,maxAbs,H-m.b,m.t);
  return <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bland-Altman: diferença Python − JavaScript versus média das duas medidas">
    <rect width={W} height={H} fill="#fff"/>
    <Axes x={x} y={y} w={W} h={H} m={m} xTicks={ticks(x0,x1,5)} yTicks={ticks(-maxAbs,maxAbs,4)} xLabel="Média (Python + JS) / 2" yLabel="Python − JS"/>
    <line x1={m.l} x2={W-m.r} y1={y(0)} y2={y(0)} stroke={INK} strokeWidth="1.5"/>
    {(sd>0?[["Média",mean,"#0d766e",""],["+1,96 DP",lim[1],"#9a6216","5 4"],["−1,96 DP",lim[0],"#9a6216","5 4"]]:[["Média; DP = 0 →",mean,"#0d766e",""]]).map(([label,v,color,dash])=><g key={label}><line x1={m.l} x2={W-m.r} y1={y(v)} y2={y(v)} stroke={color} strokeDasharray={dash} strokeWidth="1.5"/><text x={W-m.r+6} y={y(v)+3} fontFamily={FONT} fontSize="10" fill={INK}>{label} {fmt(v,3)}</text></g>)}
    {pts.map((p,i)=><circle key={i} cx={x(p.mean)} cy={y(p.diff)} r="5" fill={CLASS_COLORS[p.class]} fillOpacity=".85" stroke="#fff" strokeWidth="2"><title>{p.case} · {CLASS_NAMES[p.class]}{"\n"}Python {fmt(p.py)} · JS {fmt(p.js)} · Δ {fmt(p.diff)}</title></circle>)}
  </svg>;
}
function ScatterChart({report,metric,svgRef}){
  const W=640,H=330,m={l:62,r:24,t:18,b:42},pts=report.measures.filter(r=>r.metric===metric);
  const hi=Math.max(1,...pts.flatMap(p=>[p.py,p.js]))*1.05,x=scale(0,hi,m.l,W-m.r),y=scale(0,hi,H-m.b,m.t),t=ticks(0,hi,5);
  return <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Dispersão identidade: valor JavaScript versus valor Python, diagonal y = x">
    <rect width={W} height={H} fill="#fff"/>
    <Axes x={x} y={y} w={W} h={H} m={m} xTicks={t} yTicks={t} xLabel="Python (cdm_v285.py)" yLabel="JavaScript (cdmBrowser.js)"/>
    <line x1={x(0)} y1={y(0)} x2={x(hi)} y2={y(hi)} stroke={INK} strokeDasharray="4 4" strokeWidth="1.2"/>
    <text x={x(hi)-4} y={y(hi)+14} textAnchor="end" fontFamily={FONT} fontSize="10" fill={MUTED}>y = x</text>
    {pts.map((p,i)=><circle key={i} cx={x(p.py)} cy={y(p.js)} r="5" fill={CLASS_COLORS[p.class]} fillOpacity=".85" stroke="#fff" strokeWidth="2"><title>{p.case} · {CLASS_NAMES[p.class]}{"\n"}Python {fmt(p.py)} · JS {fmt(p.js)}</title></circle>)}
  </svg>;
}
function ConfusionChart({report,svgRef}){
  const labels=report.confusion.labels,mat=report.confusion.matrix,n=labels.length,cell=44,m={l:112,t:66},W=m.l+cell*n+16,H=m.t+cell*n+28;
  const rowSum=report.confusion.row_totals||mat.map(r=>r.reduce((a,b)=>a+b,0)),multi=report.confusion.mode==="multilabel";
  return <svg ref={svgRef} className="parityMatrix" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Matriz de confusão cruzada por pixel: classe no Python (linhas) versus classe no JavaScript (colunas)">
    <rect width={W} height={H} fill="#fff"/>
    <g fontFamily={FONT} fontSize="10" fill={INK}>
      <text x={m.l+cell*n/2} y={14} textAnchor="middle" fontWeight="700">JavaScript →</text>
      <text transform={`translate(12 ${m.t+cell*n/2}) rotate(-90)`} textAnchor="middle" fontWeight="700">Python →</text>
      {labels.map((l,i)=><text key={"c"+l} transform={`translate(${m.l+i*cell+cell/2} ${m.t-8}) rotate(-35)`} fontSize="9.5">{CLASS_NAMES[l]||l}</text>)}
      {labels.map((l,i)=><text key={"r"+l} x={m.l-8} y={m.t+i*cell+cell/2+3} textAnchor="end" fontSize="9.5">{CLASS_NAMES[l]||l}</text>)}
      {mat.map((row,i)=>row.map((v,j)=>{const share=rowSum[i]?v/rowSum[i]:0,dark=share>.55;
        return <g key={i+"-"+j}><rect x={m.l+j*cell+1} y={m.t+i*cell+1} width={cell-2} height={cell-2} rx="4" fill={v?`rgba(13,118,110,${(.08+.92*Math.sqrt(share)).toFixed(3)})`:"#f4f7f8"} stroke={i===j||(multi&&i<n-1&&j<n-1)?"none":v?"#c2413b":"none"} strokeWidth="1.5"><title>Python {CLASS_NAMES[labels[i]]} → JS {CLASS_NAMES[labels[j]]}: {v.toLocaleString("pt-BR")} px ({pct(share,3)} da linha)</title></rect>
          <text x={m.l+j*cell+cell/2} y={m.t+i*cell+cell/2+4} textAnchor="middle" fontSize="10" fontWeight="700" fill={dark?"#fff":v?INK:"#b4c2c8"}>{v?pct(share,share<1&&share>.999?3:1):rowSum[i]?"0":"—"}</text></g>}))}
    </g>
  </svg>;
}
function DiffMap({report,caseIndex,cls,canvasRef}){
  const c=report.cases[caseIndex];
  useEffect(()=>{
    const cv=canvasRef.current;if(!cv||!c)return;
    const{width:w,height:h,thumb}=c;cv.width=w;cv.height=h;
    const ctx=cv.getContext("2d"),img=ctx.createImageData(w,h),g=decodeThumb(thumb);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const v=g[Math.min(thumb.h-1,Math.floor(y/thumb.scale))*thumb.w+Math.min(thumb.w-1,Math.floor(x/thumb.scale))],k=(y*w+x)*4,d=Math.round(20+v*.32);img.data[k]=d;img.data[k+1]=d;img.data[k+2]=d;img.data[k+3]=255}
    const paint=(rle,rgb)=>{for(let i=0;i<rle.length;i+=2)for(let p=rle[i];p<rle[i]+rle[i+1];p++){const k=p*4;img.data[k]=rgb[0];img.data[k+1]=rgb[1];img.data[k+2]=rgb[2]}};
    for(const k of cls==="all"?report.classes:[cls]){const d=c.diff[k];paint(d.both,[236,240,242]);paint(d.py_only,[227,73,72]);paint(d.js_only,[42,120,214])}
    ctx.putImageData(img,0,0);
  },[c,cls,canvasRef,report.classes]);
  if(!c)return null;
  const count=key=>(cls==="all"?report.classes:[cls]).reduce((s,k)=>{const r=c.diff[k][key];let t=0;for(let i=1;i<r.length;i+=2)t+=r[i];return s+t},0);
  return <div className="parityDiff">
    <canvas ref={canvasRef} className="parityDiffCanvas" style={{aspectRatio:c.width+"/"+c.height}} role="img" aria-label="Mapa de divergência espacial"/>
    <div className="parityDiffLegend"><span><i style={{background:"#eceff2"}}/>Iguais nos dois motores <b>{count("both").toLocaleString("pt-BR")} px</b></span><span><i style={{background:"#e34948"}}/>Só Python <b>{count("py_only").toLocaleString("pt-BR")} px</b></span><span><i style={{background:"#2a78d6"}}/>Só JavaScript <b>{count("js_only").toLocaleString("pt-BR")} px</b></span></div>
  </div>;
}

// ---------- Painel ----------
export default function ParityPanel({onClose,boundsRef}){
  const[report,setReport]=useState(null),[error,setError]=useState(""),[tab,setTab]=useState("summary"),[metric,setMetric]=useState("area_px2"),[cascadeMetric,setCascadeMetric]=useState("iou");
  const[caseIndex,setCaseIndex]=useState(0),[diffClass,setDiffClass]=useState("all"),[pos,setPos]=useState({x:0,y:0}),[reload,setReload]=useState(0);
  const svgRef=useRef(null),canvasRef=useRef(null),panelRef=useRef(null);
  useEffect(()=>{
    let alive=true;setError("");
    fetch(`${import.meta.env.BASE_URL}reports/cdm-parity.json?t=${Date.now()}`,{cache:"no-store"})
      .then(r=>{if(!r.ok)throw new Error(r.status===404?"Relatório ainda não publicado neste build.":"HTTP "+r.status);return r.json()})
      .then(j=>{if(alive){setReport(j);const worst=j.cases.reduce((b,c,i)=>{const s=Object.values(c.classes).reduce((a,r)=>a+r.stages.clean_mask.pmr,0);return s>b.s?{s,i}:b},{s:-1,i:0});setCaseIndex(worst.i)}})
      .catch(e=>{if(alive)setError(e.message||String(e))});
    return()=>{alive=false};
  },[reload]);
  useEffect(()=>{const key=e=>{if(e.key==="Escape"&&!e.defaultPrevented)onClose()};window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key)},[onClose]);
  function beginDrag(e){
    if(e.button!==0||e.target.closest("button,select"))return;
    const start={x:e.clientX,y:e.clientY,px:pos.x,py:pos.y},r0=panelRef.current?.getBoundingClientRect(),b=boundsRef?.current?.getBoundingClientRect();
    const lim=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
    const move=ev=>{let dx=ev.clientX-start.x,dy=ev.clientY-start.y;
      if(r0&&b){dx=lim(dx,b.left-r0.left,Math.max(b.left-r0.left,b.right-r0.right));dy=lim(dy,b.top-r0.top,b.bottom-r0.top-44)}
      setPos({x:start.px+dx,y:start.py+dy})};
    const up=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up)};
    window.addEventListener("pointermove",move);window.addEventListener("pointerup",up);
  }
  const name=`paridade-cdm-${tab}`;
  async function exportPng(){if(tab==="diff"){const src=canvasRef.current;if(!src)return;const k=Math.max(1,Math.ceil(1200/Math.max(src.width,src.height))),c=document.createElement("canvas");c.width=src.width*k;c.height=src.height*k;const ctx=c.getContext("2d");ctx.imageSmoothingEnabled=false;ctx.drawImage(src,0,0,c.width,c.height);c.toBlob(b=>b&&download(name+".png",b),"image/png");return}if(svgRef.current)download(name+".png",await svgToPng(svgRef.current))}
  function exportSvg(){if(svgRef.current)download(name+".svg",new Blob([svgText(svgRef.current)],{type:"image/svg+xml"}))}
  function exportCsv(){
    if(!report)return;let rows;
    if(tab==="summary")rows=[["indicador","valor","regra","limite","situação"],...report.tolerances.map(t=>[t.label,t.value,t.rule,t.limit,t.pass?"ok":"falha"])];
    else if(tab==="cascade")rows=[["familia","etapa","iou_min","pmr_max","linf"],...report.classes.flatMap(c=>report.stages.map(([s])=>[c,s,report.cascade[c]?.[s]?.iou??"",report.cascade[c]?.[s]?.pmr??"",report.cascade[c]?.[s]?.linf??""]))];
    else if(tab==="bland")rows=[["caso","familia","metrica","python","js","media","diferenca"],...blandData(report,metric).map(p=>[p.case,p.class,p.metric,p.py,p.js,p.mean,p.diff])];
    else if(tab==="scatter")rows=[["caso","familia","metrica","python","js"],...report.measures.filter(r=>r.metric===metric).map(p=>[p.case,p.class,p.metric,p.py,p.js])];
    else if(tab==="confusion")rows=[["python\\js",...report.confusion.labels],...report.confusion.matrix.map((r,i)=>[report.confusion.labels[i],...r])];
    else{const c=report.cases[caseIndex];rows=[["caso","familia","iguais_px","so_python_px","so_js_px","iou","pmr"],...report.classes.map(k=>{const sum=r=>{let t=0;for(let i=1;i<r.length;i+=2)t+=r[i];return t};const d=c.diff[k];return[c.name,k,sum(d.both),sum(d.py_only),sum(d.js_only),c.classes[k].stages.clean_mask.iou,c.classes[k].stages.clean_mask.pmr]})]}
    download(name+".csv",csvBlob(rows));
  }
  const StatusIcon=report?.status==="pass"?CheckCircle2:report?.status==="warn"?AlertTriangle:XCircle;
  const caseRows=useMemo(()=>report?report.cases.map(c=>({name:c.name,size:c.width+"×"+c.height,iou:Math.min(...Object.values(c.classes).map(r=>r.stages.clean_mask.iou)),pmr:Math.max(...Object.values(c.classes).map(r=>r.stages.clean_mask.pmr)),dcc:Object.values(c.classes).reduce((s,r)=>s+Math.abs(r.cc.js-r.cc.py),0),gray:c.gray.linf,skel:c.skeleton})):[],[report]);
  return <section ref={panelRef} className="parityPanel" style={{transform:`translate(${pos.x}px,${pos.y}px)`}} role="dialog" aria-label="Paridade CDM Python ⇄ navegador">
    <header onPointerDown={beginDrag}>
      <div><b>Paridade CDM</b><small>Python (cdm_v285.py) ⇄ navegador (cdmBrowser.js)</small></div>
      {report&&<span className={"parityStatus "+report.status}><StatusIcon size={13}/>{report.status==="pass"?"Paridade":report.status==="warn"?"Ressalvas":"Divergente"}</span>}
      <button type="button" onClick={()=>setReload(v=>v+1)} aria-label="Recarregar relatório" title="Recarregar relatório"><RefreshCw size={14}/></button>
      <button type="button" onClick={onClose} aria-label="Fechar painel de paridade" title="Fechar (Esc)"><X size={15}/></button>
    </header>
    <nav className="parityTabs" role="tablist">{TABS.map(([id,label])=><button key={id} type="button" role="tab" aria-selected={tab===id} className={tab===id?"active":""} onClick={()=>setTab(id)}>{label}</button>)}</nav>
    <div className="parityBody">
      {error?<div className="parityEmpty"><b>Relatório indisponível</b><p>{error}</p><p>O relatório é gerado a cada deploy pelo CI (Python gera as etapas de referência; o Node roda o motor do navegador nas mesmas cenas). Localmente: <code>python backend/tests/generate_cdm_parity_report_cases.py /tmp/c.json</code> e <code>node scripts/build-cdm-parity-report.mjs /tmp/c.json public/reports/cdm-parity.json</code>.</p></div>
      :!report?<div className="parityEmpty"><p>Carregando relatório…</p></div>
      :<>
        {tab==="summary"&&<div className="paritySummary">
          <div className="parityKpis">
            {[["IoU cruzado mín.",report.summary.clean_iou.toFixed(6).replace(".",",")],["PMR máx. (máscara final)",pct(report.summary.clean_pmr,4)],["L∞ cinza",fmt(report.summary.gray_linf,4)+" nív."],["Σ|ΔCC|",fmt(report.summary.dcc,0)],["Δ nós do esqueleto",fmt(report.summary.skeleton_nodes,0)],["Erro máx. das medidas",pct(report.summary.measure_rel,3)]].map(([k,v])=><div key={k} className="parityKpi"><small>{k}</small><b>{v}</b></div>)}
          </div>
          <table className="parityTable"><thead><tr><th>Indicador</th><th>Valor</th><th>Tolerância</th><th/></tr></thead><tbody>
            {report.tolerances.map(t=><tr key={t.id} className={t.pass?"parityOk":"parityBad"}><td>{t.label}</td><td>{t.unit==="%"?pct(t.value,4):fmt(t.value,6)}</td><td>{t.rule} {t.unit==="%"?pct(t.limit,4):fmt(t.limit,6)}</td><td>{t.pass?<CheckCircle2 size={14} aria-label="dentro da tolerância"/>:<XCircle size={14} aria-label="fora da tolerância"/>}</td></tr>)}
          </tbody></table>
          <table className="parityTable compact"><thead><tr><th>Cena</th><th>px</th><th>IoU mín.</th><th>PMR máx.</th><th>ΔCC</th><th>Esqueleto (Py/JS)</th></tr></thead><tbody>
            {caseRows.map(r=><tr key={r.name} className={r.iou<.9999?"parityBad":"parityOk"}><td>{r.name}</td><td>{r.size}</td><td>{r.iou.toFixed(5).replace(".",",")}</td><td>{pct(r.pmr,3)}</td><td>{r.dcc}</td><td>{r.skel.py.len}/{r.skel.js.len} px</td></tr>)}
          </tbody></table>
          <p className="parityMeta">{report.summary.cases} cenas · {report.summary.pixels.toLocaleString("pt-BR")} px · commit {String(report.commit||"").slice(0,8)} ({report.branch}) · {new Date(report.generated_at).toLocaleString("pt-BR")} · Node {report.runtimes.node} · numpy {report.runtimes.python?.numpy}</p>
        </div>}
        {tab==="cascade"&&<><div className="parityControls"><label>Indicador<select value={cascadeMetric} onChange={e=>setCascadeMetric(e.target.value)}><option value="iou">IoU cruzado (mínimo entre cenas)</option><option value="pmr">PMR — taxa de discordância (máximo)</option></select></label><span>Identifica em qual etapa a divergência nasce.</span></div><CascadeChart report={report} metric={cascadeMetric} svgRef={svgRef}/></>}
        {(tab==="bland"||tab==="scatter")&&<><div className="parityControls"><label>Medida<select value={metric} onChange={e=>setMetric(e.target.value)}>{METRICS.map(([id,l])=><option key={id} value={id}>{l}</option>)}</select></label><span>{tab==="bland"?"Viés sistemático: pontos sobre a linha 0 = paridade.":"Cada ponto é uma cena × família; fora da diagonal = divergência."}</span></div>
          {tab==="bland"?<BlandAltmanChart report={report} metric={metric} svgRef={svgRef}/>:<ScatterChart report={report} metric={metric} svgRef={svgRef}/>}
          <div className="parityKey">{report.classes.map(c=><span key={c}><i style={{background:CLASS_COLORS[c]}}/>{CLASS_NAMES[c]}</span>)}</div></>}
        {tab==="confusion"&&<><div className="parityControls"><span>{report.confusion.mode==="multilabel"?"Pixel a pixel, todas as cenas, multirrótulo: cada linha são os pixels que o Python marca naquela família; as colunas, quanto deles o JS marca em cada família (uma linha pode somar mais de 100% quando famílias se sobrepõem). Diagonal = paridade; vermelho = pixel sem família em um dos motores.":"Pixel a pixel, todas as cenas. Diagonal = mesma classe nos dois motores; contorno vermelho = troca de classe."}</span></div><ConfusionChart report={report} svgRef={svgRef}/>
          {report.confusion.overlaps&&Object.entries(report.confusion.overlaps).some(([,o])=>Object.keys(o).length)&&<p className="parityNote">Sobreposições entre famílias no próprio modelo: {Object.entries(report.confusion.overlaps).filter(([,o])=>Object.keys(o).length).map(([c,o])=>CLASS_NAMES[c]+" também marcada como "+Object.entries(o).map(([d,v])=>CLASS_NAMES[d]+" ("+pct(v/((report.confusion.row_totals||[])[report.classes.indexOf(c)]||1),0)+")").join(", ")).join(" · ")}.</p>}</>}
        {tab==="diff"&&<><div className="parityControls"><label>Cena<select value={caseIndex} onChange={e=>setCaseIndex(Number(e.target.value))}>{report.cases.map((c,i)=><option key={c.name} value={i}>{c.name} ({c.width}×{c.height})</option>)}</select></label><label>Família<select value={diffClass} onChange={e=>setDiffClass(e.target.value)}><option value="all">Todas</option>{report.classes.map(c=><option key={c} value={c}>{CLASS_NAMES[c]}</option>)}</select></label></div><DiffMap report={report} caseIndex={caseIndex} cls={diffClass} canvasRef={canvasRef}/></>}
      </>}
    </div>
    {report&&<footer className="parityExport"><span><Download size={13}/> Exportar</span>
      {tab!=="summary"&&tab!=="diff"&&<button type="button" onClick={exportSvg}>SVG</button>}
      {tab!=="summary"&&<button type="button" onClick={exportPng}>PNG</button>}
      <button type="button" onClick={exportCsv}>CSV</button>
      <button type="button" onClick={()=>download("cdm-parity-report.json",new Blob([JSON.stringify(report,null,1)],{type:"application/json"}))}>JSON</button>
    </footer>}
  </section>;
}
