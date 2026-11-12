import React,{useCallback,useEffect,useMemo,useRef,useState} from "react";
import {Brush,Check,Download,Gauge,MousePointer2,PenTool,Pentagon,Sparkles,Trash2,Undo2,X,ZoomIn} from "lucide-react";
import {GT_BY_ID,GT_CLASSES,GT_LEVELS,classMask,cropLabels,labelMap,levelForZoom,rasterize,segMetrics,suggestionsFromCdm,tileWindows,toCoco,usable,zipStore} from "./annotationCore.js";
import {__cdmTest} from "./cdmBrowser.js";

// Anotação few-shot multiescala (Ground Truth) sobre o canvas do Studio.
// Vetores guardados em pixels da pré-visualização; exportação na resolução original do arquivo.

const keyOf=file=>file?"shmGT:"+file.name+":"+file.size+":"+(file.lastModified||0):null;
const uid=()=>Math.random().toString(36).slice(2,9)+Date.now().toString(36).slice(-4);

export function useGroundTruth(file){
  const key=keyOf(file);
  const[items,setItems]=useState([]);
  const history=useRef([]);
  useEffect(()=>{history.current=[];try{setItems(key?JSON.parse(localStorage.getItem(key)||"[]"):[])}catch{setItems([])}},[key]);
  useEffect(()=>{if(!key)return;try{if(items.length)localStorage.setItem(key,JSON.stringify(items));else localStorage.removeItem(key)}catch{}},[key,items]);
  const commit=useCallback(fn=>setItems(prev=>{history.current.push(prev);if(history.current.length>80)history.current.shift();return fn(prev)}),[]);
  const undo=useCallback(()=>{const last=history.current.pop();if(last)setItems(last)},[]);
  return{items,commit,undo,canUndo:()=>history.current.length>0};
}

// ---------- camada SVG (dentro do canvas transformado) ----------
export function AnnotationLayer({gt,state,setState,width,height,zoom}){
  const svg=useRef(null);
  const[draft,setDraftState]=useState(null);// {shape,points,width}
  const draftRef=useRef(null);
  // ref síncrona: Enter/duplo clique logo após o último clique já veem o rascunho atual
  const setDraft=useCallback(v=>{const next=typeof v==="function"?v(draftRef.current):v;draftRef.current=next;setDraftState(next)},[]);
  const[hover,setHover]=useState(null);
  const painting=useRef(false);
  const cls=GT_BY_ID[state.cls]||GT_CLASSES[0];
  const toImg=e=>{const r=svg.current.getBoundingClientRect();return[(e.clientX-r.left)*width/r.width,(e.clientY-r.top)*height/r.height]};
  const pxPerScreen=()=>{const r=svg.current?.getBoundingClientRect();return r?width/r.width:1};
  const finish=useCallback(()=>{
    const d=draftRef.current;if(!d)return;
    // pontos repetidos (duplo clique) são removidos
    const pts=d.points.filter((p,i,a)=>!i||Math.hypot(p[0]-a[i-1][0],p[1]-a[i-1][1])>.25);
    const ok=d.shape==="polygon"?pts.length>=3:pts.length>=(d.shape==="crack"?2:1);
    if(ok)gt.commit(list=>[...list,{id:uid(),cls:state.cls,level:state.level,shape:d.shape,points:pts.map(p=>p.map(v=>+v.toFixed(2))),width:d.shape==="polygon"?undefined:+d.width.toFixed(2),zoom:+zoom.toFixed(2),status:"manual",source:"user",created_at:new Date().toISOString()}]);
    setDraft(null);
  },[gt,state.cls,state.level,zoom,setDraft]);
  useEffect(()=>{
    const key=e=>{
      if(e.target?.closest?.("input,textarea,select,[contenteditable=true]"))return;
      const draft=draftRef.current;
      if(e.key==="Enter"&&draft){e.preventDefault();finish()}
      else if(e.key==="Escape"&&draft){e.preventDefault();e.stopPropagation();setDraft(null)}
      else if(e.key==="Backspace"&&draft){e.preventDefault();setDraft(d=>d&&d.points.length>1?{...d,points:d.points.slice(0,-1)}:null)}
      else if((e.key==="Delete"||e.key==="Backspace")&&state.selected){e.preventDefault();gt.commit(l=>l.filter(a=>a.id!==state.selected));setState(s=>({...s,selected:null}))}
      else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();gt.undo()}
    };
    window.addEventListener("keydown",key,true);return()=>window.removeEventListener("keydown",key,true);
  },[finish,gt,state.selected,setState,setDraft]);
  // traço em pixels de imagem a partir do tamanho do pincel na tela: anotar com mais zoom = traço mais fino.
  const brushImg=()=>Math.max(.75,state.brush*pxPerScreen());
  function down(e){
    if(e.button!==0)return;// botão do meio continua deslocando o canvas
    e.stopPropagation();e.preventDefault();try{svg.current.setPointerCapture?.(e.pointerId)}catch{}
    const p=toImg(e);
    if(state.tool==="select"){const id=e.target?.dataset?.gt||null;setState(s=>({...s,selected:id}));return}
    if(state.tool==="brush"){painting.current=true;setDraft({shape:"stroke",points:[p],width:brushImg()});return}
    if(state.tool==="polygon"){
      setDraft(d=>{
        if(d?.shape==="polygon"&&d.points.length>=3){const[fx,fy]=d.points[0];if(Math.hypot(fx-p[0],fy-p[1])<8*pxPerScreen()){queueMicrotask(finish);return d}}
        return d?.shape==="polygon"?{...d,points:[...d.points,p]}:{shape:"polygon",points:[p]};
      });
      if(e.detail>=2)finish();
      return;
    }
    if(state.tool==="crack"){
      setDraft(d=>d?.shape==="crack"?{...d,points:[...d.points,p]}:{shape:"crack",points:[p],width:state.crackWidth});
      if(e.detail>=2)finish();
    }
  }
  function move(e){
    const p=toImg(e);setHover(p);
    if(painting.current){e.stopPropagation();setDraft(d=>{if(!d)return d;const l=d.points[d.points.length-1];return Math.hypot(l[0]-p[0],l[1]-p[1])>=Math.max(.5,d.width/4)?{...d,points:[...d.points,p]}:d})}
  }
  function up(e){if(painting.current){e.stopPropagation();painting.current=false;finish()}}
  const vis=a=>state.show[a.level]!==false;
  const pathOf=pts=>pts.map((p,i)=>(i?"L":"M")+p[0].toFixed(1)+" "+p[1].toFixed(1)).join(" ");
  return <svg ref={svg} className={"gtLayer tool-"+state.tool} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={()=>setHover(null)} onContextMenu={e=>{if(draft){e.preventDefault();e.stopPropagation();finish()}}}>
    {gt.items.filter(vis).map(a=>{const c=GT_BY_ID[a.cls]||GT_CLASSES[0],sel=state.selected===a.id,sug=a.status==="suggested";
      const common={key:a.id,"data-gt":a.id,className:"gtShape"+(sel?" selected":"")+(sug?" suggested":"")+(a.status==="rejected"?" rejected":""),style:{"--gt":c.color}};
      return a.shape==="polygon"?<path {...common} d={pathOf(a.points)+" Z"} fill={c.color} fillOpacity={sug?.12:.28} stroke={c.color} vectorEffect="non-scaling-stroke"/>
        :<path {...common} d={pathOf(a.points)} fill="none" stroke={c.color} strokeOpacity={sug?.55:.8} strokeWidth={a.width||2} strokeLinecap="round" strokeLinejoin="round"/>;
    })}
    {draft&&(draft.shape==="polygon"?<g className="gtDraft"><path d={pathOf(hover?[...draft.points,hover]:draft.points)} fill={cls.color} fillOpacity=".15" stroke={cls.color} vectorEffect="non-scaling-stroke"/>{draft.points.map((p,i)=><circle key={i} cx={p[0]} cy={p[1]} r={3*pxPerScreen()} fill="#fff" stroke={cls.color} vectorEffect="non-scaling-stroke"/>)}</g>
      :<path className="gtDraft" d={pathOf(draft.shape==="crack"&&hover?[...draft.points,hover]:draft.points)} fill="none" stroke={cls.color} strokeOpacity=".75" strokeWidth={draft.width} strokeLinecap="round" strokeLinejoin="round"/>)}
    {hover&&state.tool==="brush"&&!draft&&<circle className="gtCursor" cx={hover[0]} cy={hover[1]} r={brushImg()/2} fill="none" stroke={cls.color} vectorEffect="non-scaling-stroke"/>}
  </svg>;
}

// ---------- exportação ----------
async function canvasBlob(c,type="image/png",q=.92){return new Promise(r=>c.toBlob(b=>r(b),type,q))}
function labelCanvas(labels,w,h,color=false){
  const c=document.createElement("canvas");c.width=w;c.height=h;const ctx=c.getContext("2d"),im=ctx.createImageData(w,h);
  const pal=GT_CLASSES.reduce((m,cl)=>{m[cl.index]=[parseInt(cl.color.slice(1,3),16),parseInt(cl.color.slice(3,5),16),parseInt(cl.color.slice(5,7),16)];return m},{});
  for(let i=0;i<labels.length;i++){const v=labels[i],p=i*4;if(color){const col=pal[v];if(col){im.data[p]=col[0];im.data[p+1]=col[1];im.data[p+2]=col[2];im.data[p+3]=255}}else{im.data[p]=im.data[p+1]=im.data[p+2]=v;im.data[p+3]=255}}
  ctx.putImageData(im,0,0);return c;
}
export async function exportGroundTruthZip({file,items,previewSize,mmPerPx=0,onProgress}){
  const bmp=await createImageBitmap(file,{imageOrientation:"from-image"});
  const W=bmp.width,H=bmp.height,scale=W/Math.max(1,previewSize.width),stem=file.name.replace(/\.[^.]+$/,"")||"imagem";
  onProgress?.("Rasterizando máscaras");
  const labels=labelMap(items,W,H,scale);
  const files=[{name:"images/"+file.name,data:new Uint8Array(await file.arrayBuffer())}];
  files.push({name:"annotations/"+stem+"_coco.json",data:JSON.stringify(toCoco(items,{fileName:file.name,width:W,height:H,scale,meta:{mm_per_px:mmPerPx?mmPerPx/scale:null}}),null,1)});
  files.push({name:"annotations/"+stem+"_shm.json",data:JSON.stringify({schema:"shm-ground-truth-v1",file:file.name,preview_size:previewSize,original_size:[W,H],scale_preview_to_original:scale,mm_per_px_preview:mmPerPx||null,classes:GT_CLASSES,levels:GT_LEVELS,items},null,1)});
  files.push({name:"masks/"+stem+"_label.png",data:new Uint8Array(await (await canvasBlob(labelCanvas(labels,W,H))).arrayBuffer())});
  files.push({name:"masks/"+stem+"_color.png",data:new Uint8Array(await (await canvasBlob(labelCanvas(labels,W,H,true))).arrayBuffer())});
  onProgress?.("Gerando recortes multiescala");
  const index=[];
  for(const win of tileWindows(W,H)){
    const lab=cropLabels(labels,W,win);let any=0;for(const v of lab)if(v){any=1;break}
    if(!any&&win.scale>1)continue;
    const c=document.createElement("canvas");c.width=win.out_w;c.height=win.out_h;const ctx=c.getContext("2d");ctx.imageSmoothingQuality="high";
    ctx.drawImage(bmp,win.x,win.y,win.w,win.h,0,0,win.out_w,win.out_h);
    const base=`tiles/s${win.scale}/${stem}_s${win.scale}_r${win.j}c${win.i}`;
    files.push({name:base+".jpg",data:new Uint8Array(await (await canvasBlob(c,"image/jpeg",.92)).arrayBuffer())});
    files.push({name:base+"_label.png",data:new Uint8Array(await (await canvasBlob(labelCanvas(lab,win.out_w,win.out_h))).arrayBuffer())});
    index.push({...win,image:base+".jpg",label:base+"_label.png"});
  }
  bmp.close?.();
  files.push({name:"tiles/index.json",data:JSON.stringify(index,null,1)});
  files.push({name:"README.txt",data:["SHM Studio · Ground Truth few-shot multiescala","",
    "images/        imagem original","annotations/   COCO (polígonos; traços/fissuras em RLE + polilinha em shm.polyline) e vetores SHM",
    "masks/         _label.png = índice da classe por pixel (0 = fundo); _color.png = visualização",
    "tiles/sK/      recortes de lado máx. 512 px: s1 imagem inteira, s2 grade 2×2, s4 grade 4×4 (só tiles com rótulo)","",
    "Classes:",...GT_CLASSES.map(c=>`  ${c.index} ${c.id} (${c.label}, nível ${c.level})`),"",
    "Somente anotações manuais ou sugestões aceitas entram nas máscaras; sugestões pendentes/rejeitadas ficam só no _shm.json."].join("\n")});
  return zipStore(files);
}

// ---------- avaliação CDM × GT ----------
export function evaluateCdmAgainstGt({items,records,processedSize,previewSize,maxSide=1024}){
  const k=Math.min(1,maxSide/Math.max(previewSize.width,previewSize.height)),w=Math.max(1,Math.round(previewSize.width*k)),h=Math.max(1,Math.round(previewSize.height*k));
  const predScale=w/Math.max(1,processedSize.width),skeleton=m=>__cdmTest.zhangSuen(Uint8Array.from(m),w,h);
  const rows=[];
  for(const c of GT_CLASSES){
    if(c.level==="cena")continue;
    if(!items.some(a=>usable(a)&&a.cls===c.id))continue;
    const gtm=classMask(items,c.id,w,h,k),pred=new Uint8Array(w*h);
    for(const r of records||[])if(r.class===c.id&&r.points?.length)rasterize({shape:r.class==="cracks"||!r.closed?"crack":"polygon",points:r.points,width:r.width_px||2},w,h,predScale,pred,1);
    rows.push({cls:c.id,label:c.label,color:c.color,...segMetrics(gtm,pred,c.id==="cracks"?skeleton:null)});
  }
  return{rows,grid:[w,h]};
}

// ---------- painel ----------
const TOOL_INFO={polygon:{icon:Pentagon,label:"Polígono",hint:"Clique os vértices; duplo clique, Enter ou clique no 1º vértice fecha."},
  brush:{icon:Brush,label:"Pincel",hint:"Arraste para pintar; o pincel tem tamanho fixo na tela, então mais zoom = traço mais fino."},
  crack:{icon:PenTool,label:"Linha de fissura",hint:"Clique ao longo da linha central; duplo clique ou Enter termina."},
  select:{icon:MousePointer2,label:"Selecionar",hint:"Clique numa anotação; Delete apaga; aceite ou rejeite sugestões."}};

export function AnnotationPanel({gt,state,setState,zoom,setZoom,file,previewSize,cdmResult,mmPerPx,onNotice,onClose}){
  const[evalResult,setEvalResult]=useState(null),[busy,setBusy]=useState("");
  const level=GT_LEVELS.find(l=>l.id===state.level)||GT_LEVELS[0];
  const classes=GT_CLASSES.filter(c=>c.level===state.level||(state.level==="regiao"&&c.id==="cracks"));
  const zoomLevel=levelForZoom(zoom),mismatch=zoomLevel!==state.level;
  const counts=useMemo(()=>{const m={};for(const a of gt.items){const k=a.status==="suggested"?"sug":a.status==="rejected"?"rej":"ok";m[a.cls]=m[a.cls]||{ok:0,sug:0,rej:0};m[a.cls][k]++}return m},[gt.items]);
  const pending=gt.items.filter(a=>a.status==="suggested").length,accepted=gt.items.filter(usable).length;
  const selected=gt.items.find(a=>a.id===state.selected);
  const records=cdmResult?.metrics?.records||[];
  const processed={width:Number(cdmResult?.metrics?.processed_width)||previewSize.width,height:Number(cdmResult?.metrics?.processed_height)||previewSize.height};
  const pickLevel=id=>{const l=GT_LEVELS.find(x=>x.id===id);setState(s=>({...s,level:id,tool:l.tools.includes(s.tool)?s.tool:l.tools[0],cls:GT_CLASSES.find(c=>c.level===id)?.id||s.cls}))};
  function suggest(){
    if(!records.length){onNotice?.("Execute o CDM-1 antes para obter sugestões");return}
    const sug=suggestionsFromCdm(records,previewSize.width/processed.width);
    gt.commit(l=>[...l.filter(a=>a.status!=="suggested"),...sug]);onNotice?.(sug.length+" sugestões do CDM adicionadas · aceite ou rejeite");
  }
  const setStatus=(pred,status)=>gt.commit(l=>status==="remove"?l.filter(a=>!pred(a)):l.map(a=>pred(a)?{...a,status}:a));
  async function doExport(){
    if(!accepted){onNotice?.("Nenhuma anotação aceita para exportar");return}
    setBusy("Exportando…");
    try{
      const blob=await exportGroundTruthZip({file,items:gt.items,previewSize,mmPerPx,onProgress:m=>setBusy(m+"…")});
      const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=(file.name.replace(/\.[^.]+$/,"")||"imagem")+"_ground_truth.zip";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),4000);
      onNotice?.("Ground Truth exportado (COCO + máscaras + recortes multiescala)");
    }catch(e){onNotice?.("Falha na exportação: "+(e?.message||e))}
    setBusy("");
  }
  function doEval(){
    if(!records.length){onNotice?.("Execute o CDM-1 antes de avaliar");return}
    setBusy("Avaliando…");
    setTimeout(()=>{try{setEvalResult(evaluateCdmAgainstGt({items:gt.items,records,processedSize:processed,previewSize}))}finally{setBusy("")}},20);
  }
  const fmt=v=>v==null?"—":(100*v).toFixed(1);
  return <div className="gtPanel" role="dialog" aria-label="Anotação Ground Truth">
    <div className="gtHead"><b><PenTool size={14}/> Anotação · Ground Truth</b><button type="button" onClick={onClose} aria-label="Fechar anotação"><X size={15}/></button></div>
    <div className="gtLevels" role="tablist" aria-label="Nível de escala">{GT_LEVELS.map(l=><button key={l.id} type="button" role="tab" aria-selected={state.level===l.id} onClick={()=>pickLevel(l.id)}><span>{l.label}</span><small>{l.id==="cena"?"1×":l.id==="regiao"?"2–4×":"≥ 8×"}</small></button>)}</div>
    <p className="gtHint">{level.hint}</p>
    {mismatch&&<button type="button" className="gtZoomHint" onClick={()=>setZoom(level.zoom)}><ZoomIn size={13}/> Zoom atual {zoom.toFixed(1)}× · ir para {level.zoom}× ({level.label.toLowerCase()})</button>}
    <div className="gtTools">{[...level.tools,"select"].map(t=>{const I=TOOL_INFO[t].icon;return <button key={t} type="button" className={state.tool===t?"active":""} onClick={()=>setState(s=>({...s,tool:t}))} title={TOOL_INFO[t].hint}><I size={14}/>{TOOL_INFO[t].label}</button>})}</div>
    <div className="gtClasses">{classes.map(c=>{const n=counts[c.id];return <button key={c.id} type="button" className={state.cls===c.id?"active":""} style={{"--gt":c.color}} onClick={()=>setState(s=>({...s,cls:c.id,tool:c.id==="cracks"&&s.tool==="polygon"?"crack":c.id!=="cracks"&&s.tool==="crack"?"polygon":s.tool}))}><i/>{c.label}{n&&<small>{n.ok}{n.sug?" +"+n.sug+"?":""}</small>}</button>})}</div>
    {state.tool==="brush"&&<label className="gtRange">Pincel <input type="range" min="2" max="60" value={state.brush} onChange={e=>setState(s=>({...s,brush:+e.target.value}))}/><span>{state.brush} px na tela</span></label>}
    {state.tool==="crack"&&<label className="gtRange">Largura <input type="range" min="0.5" max="20" step="0.5" value={state.crackWidth} onChange={e=>setState(s=>({...s,crackWidth:+e.target.value}))}/><span>{state.crackWidth} px{mmPerPx>0?" ≈ "+(state.crackWidth*mmPerPx).toFixed(2)+" mm":""}</span></label>}
    {selected&&<div className="gtSelected"><span style={{"--gt":GT_BY_ID[selected.cls]?.color}}><i/>{GT_BY_ID[selected.cls]?.label} · {selected.status==="suggested"?"sugestão do CDM":selected.status==="rejected"?"rejeitada":"aceita"}{selected.zoom?" · "+selected.zoom+"×":""}</span>
      {selected.status!=="manual"&&selected.status!=="accepted"&&<button type="button" onClick={()=>setStatus(a=>a.id===selected.id,"accepted")}><Check size={13}/> Aceitar</button>}
      {selected.status==="suggested"&&<button type="button" onClick={()=>setStatus(a=>a.id===selected.id,"rejected")}><X size={13}/> Rejeitar</button>}
      <button type="button" onClick={()=>{setStatus(a=>a.id===selected.id,"remove");setState(s=>({...s,selected:null}))}}><Trash2 size={13}/> Apagar</button></div>}
    <div className="gtActions">
      <button type="button" onClick={suggest} disabled={!records.length} title="Usa os achados do CDM como ponto de partida (few-shot)"><Sparkles size={13}/> Sugerir do CDM</button>
      {pending>0&&<><button type="button" onClick={()=>setStatus(a=>a.status==="suggested","accepted")}><Check size={13}/> Aceitar {pending}</button><button type="button" onClick={()=>setStatus(a=>a.status==="suggested","remove")}><X size={13}/> Descartar {pending}</button></>}
      <button type="button" onClick={gt.undo} title="Desfazer (Ctrl/Cmd+Z)"><Undo2 size={13}/></button>
    </div>
    <div className="gtShow">Exibir:{GT_LEVELS.map(l=><label key={l.id}><input type="checkbox" checked={state.show[l.id]!==false} onChange={e=>setState(s=>({...s,show:{...s.show,[l.id]:e.target.checked}}))}/>{l.label}</label>)}</div>
    <div className="gtFoot">
      <span>{accepted} aceitas{pending?" · "+pending+" pendentes":""}</span>
      <button type="button" onClick={doEval} disabled={!records.length||!accepted||!!busy}><Gauge size={13}/> Avaliar CDM</button>
      <button type="button" className="primary" onClick={doExport} disabled={!accepted||!!busy}><Download size={13}/> {busy||"Exportar ZIP"}</button>
    </div>
    {evalResult&&<div className="gtEval"><table><thead><tr><th>Classe</th><th>IoU</th><th>Dice</th><th>Prec.</th><th>Rev.</th><th>clDice</th></tr></thead><tbody>
      {evalResult.rows.map(r=><tr key={r.cls}><td><i style={{background:r.color}}/>{r.label}</td><td>{fmt(r.iou)}</td><td>{fmt(r.dice)}</td><td>{fmt(r.precision)}</td><td>{fmt(r.recall)}</td><td>{r.cldice==null?"—":fmt(r.cldice)}</td></tr>)}
      </tbody></table><small>CDM atual × Ground Truth aceito, em % (grade {evalResult.grid.join("×")}). clDice mede a continuidade do esqueleto das fissuras.</small></div>}
  </div>;
}
export const DEFAULT_GT_STATE={level:"cena",tool:"polygon",cls:"structure",brush:14,crackWidth:2,selected:null,show:{}};
