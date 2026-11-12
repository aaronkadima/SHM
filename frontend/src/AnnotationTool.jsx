import React,{useCallback,useEffect,useMemo,useRef,useState} from "react";
import {Orbit,Spline,Waypoints,Move,Brush,Check,Download,Gauge,MousePointer2,PenTool,Pentagon,Sparkles,Trash2,Undo2,X,ZoomIn} from "lucide-react";
import {GT_BY_ID,GT_CLASSES,GT_LEVELS,classMask,cropLabels,flattenBSpline,flattenBezier,labelMap,levelForZoom,rasterize,rebuildCurve,segMetrics,spiralPoints,suggestionsFromCdm,tileWindows,toCoco,usable,zipStore} from "./annotationCore.js";
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
const isArea=cls=>GT_BY_ID[cls]?.level!=="detalhe";
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
export function AnnotationLayer({gt,state,setState,width,height,zoom}){
  const svg=useRef(null);
  const[draft,setDraftState]=useState(null);
  const draftRef=useRef(null);
  // ref síncrona: Enter/duplo clique logo após o último clique já veem o rascunho atual
  const setDraft=useCallback(v=>{const next=typeof v==="function"?v(draftRef.current):v;draftRef.current=next;setDraftState(next)},[]);
  const[hover,setHover]=useState(null);
  const[edit,setEdit]=useState(null);// {id,item,drag:{part,index}}
  const drag=useRef(null);// arraste: pincel, alça Bézier em criação, espiral, nó em edição
  const cls=GT_BY_ID[state.cls]||GT_CLASSES[0];
  const toImg=e=>{const r=svg.current.getBoundingClientRect();return[(e.clientX-r.left)*width/r.width,(e.clientY-r.top)*height/r.height]};
  const pxPerScreen=()=>{const r=svg.current?.getBoundingClientRect();return r?width/r.width:1};
  const tol=()=>8*pxPerScreen();
  const make=(fields)=>({id:uid(),cls:state.cls,level:state.level,zoom:+zoom.toFixed(2),status:"manual",source:"user",created_at:new Date().toISOString(),...fields});
  const finish=useCallback((forceClose=false)=>{
    const d=draftRef.current;if(!d){return}
    let item=null;
    if(d.shape==="curve"){
      const closed=forceClose||isArea(state.cls);
      const curve=d.kind==="bezier"?{kind:"bezier",closed,nodes:d.nodes.filter((n,i,a)=>!i||dist(n.p,a[i-1].p)>.25)}:{kind:"bspline",closed,ctrl:d.ctrl.filter((p,i,a)=>!i||dist(p,a[i-1])>.25)};
      const count=curve.nodes?.length??curve.ctrl.length;
      if(count>=(closed?3:2))item=rebuildCurve(make({shape:closed?"polygon":"crack",width:closed?undefined:+state.crackWidth.toFixed(2),curve}));
    }else{
      const pts=d.points.filter((p,i,a)=>!i||dist(p,a[i-1])>.25);
      const ok=d.shape==="polygon"?pts.length>=3:pts.length>=(d.shape==="crack"?2:1);
      if(ok)item=make({shape:d.shape,points:pts.map(p=>p.map(v=>+v.toFixed(2))),width:d.shape==="polygon"?undefined:+d.width.toFixed(2)});
    }
    if(item)gt.commit(list=>[...list,item]);
    setDraft(null);
  },[gt,state.cls,state.level,state.crackWidth,zoom,setDraft]);
  useEffect(()=>{
    const key=e=>{
      if(e.target?.closest?.("input,textarea,select,[contenteditable=true]"))return;
      const draft=draftRef.current;
      if(e.key==="Enter"&&draft){e.preventDefault();finish()}
      else if(e.key==="Escape"&&draft){e.preventDefault();e.stopPropagation();setDraft(null)}
      else if(e.key==="Backspace"&&draft){e.preventDefault();setDraft(d=>{if(!d)return null;if(d.nodes)return d.nodes.length>1?{...d,nodes:d.nodes.slice(0,-1)}:null;if(d.ctrl)return d.ctrl.length>1?{...d,ctrl:d.ctrl.slice(0,-1)}:null;return d.points.length>1?{...d,points:d.points.slice(0,-1)}:null})}
      else if((e.key==="Delete"||e.key==="Backspace")&&state.selected){e.preventDefault();gt.commit(l=>l.filter(a=>a.id!==state.selected));setState(s=>({...s,selected:null}))}
      else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();gt.undo()}
    };
    window.addEventListener("keydown",key,true);return()=>window.removeEventListener("keydown",key,true);
  },[finish,gt,state.selected,setState,setDraft]);
  useEffect(()=>{setDraft(null);setEdit(null)},[state.tool,setDraft]);
  const brushImg=()=>Math.max(.75,state.brush*pxPerScreen());
  function down(e){
    if(e.button!==0)return;// botão do meio continua deslocando o canvas
    e.stopPropagation();e.preventDefault();try{svg.current.setPointerCapture?.(e.pointerId)}catch{}
    const p=toImg(e),t=e.target;
    // edição de nós do item selecionado
    if(t?.dataset?.node!=null&&state.selected){
      const item=gt.items.find(a=>a.id===state.selected);if(!item)return;
      drag.current={type:"node",part:t.dataset.part,index:+t.dataset.node,start:p,orig:structuredClone(item),alt:e.altKey};
      setEdit({id:item.id,item});return;
    }
    if(state.tool==="select"){setState(s=>({...s,selected:t?.dataset?.gt||null}));return}
    if(state.tool==="brush"){drag.current={type:"brush"};setDraft({shape:"stroke",points:[p],width:brushImg()});return}
    if(state.tool==="spiral"){drag.current={type:"spiral",center:p};setDraft({shape:"spiral",center:p,radius:0,arg:0});return}
    if(state.tool==="polygon"){
      const d=draftRef.current;
      if(d?.shape==="polygon"&&d.points.length>=3&&dist(d.points[0],p)<tol()){finish();return}
      setDraft(d?.shape==="polygon"?{...d,points:[...d.points,p]}:{shape:"polygon",points:[p]});
      if(e.detail>=2)finish();return;
    }
    if(state.tool==="crack"){
      const d=draftRef.current;setDraft(d?.shape==="crack"?{...d,points:[...d.points,p]}:{shape:"crack",points:[p],width:state.crackWidth});
      if(e.detail>=2)finish();return;
    }
    if(state.tool==="bezier"){
      const d=draftRef.current;
      if(d?.kind==="bezier"&&d.nodes.length>=2&&dist(d.nodes[0].p,p)<tol()){finish(true);return}
      const node={p,hin:p,hout:p};
      setDraft(d?.kind==="bezier"?{...d,nodes:[...d.nodes,node]}:{shape:"curve",kind:"bezier",nodes:[node]});
      drag.current={type:"handle"};// arrastar após o clique puxa as alças (nó suave)
      if(e.detail>=2)finish();return;
    }
    if(state.tool==="bspline"){
      const d=draftRef.current;
      if(d?.kind==="bspline"&&d.ctrl.length>=3&&dist(d.ctrl[0],p)<tol()){finish(true);return}
      setDraft(d?.kind==="bspline"?{...d,ctrl:[...d.ctrl,p]}:{shape:"curve",kind:"bspline",ctrl:[p]});
      if(e.detail>=2)finish();
    }
  }
  function move(e){
    const p=toImg(e);setHover(p);const g=drag.current;if(!g)return;
    e.stopPropagation();
    if(g.type==="brush")setDraft(d=>{if(!d)return d;const l=d.points[d.points.length-1];return dist(l,p)>=Math.max(.5,d.width/4)?{...d,points:[...d.points,p]}:d});
    else if(g.type==="spiral")setDraft(d=>d&&{...d,radius:dist(g.center,p),arg:Math.atan2(p[1]-g.center[1],p[0]-g.center[0])});
    else if(g.type==="handle")setDraft(d=>{if(!d?.nodes)return d;const n=d.nodes.length-1,a=d.nodes[n].p,hout=p,hin=[2*a[0]-p[0],2*a[1]-p[1]];return{...d,nodes:d.nodes.map((x,i)=>i===n?{...x,hin,hout}:x)}});
    else if(g.type==="node")setEdit(ed=>ed&&{...ed,item:rebuildCurve(editNode(g.orig,g.part,g.index,p,g.start,g.alt))});
  }
  function up(e){
    const g=drag.current;drag.current=null;if(!g)return;e.stopPropagation();
    if(g.type==="brush")finish();
    else if(g.type==="spiral"){
      const d=draftRef.current;
      if(d&&d.radius>2*pxPerScreen()){const curve={kind:"spiral",center:d.center,radius:d.radius,arg:d.arg,turns:state.spiralTurns,exp:state.spiralExp,t0:0};gt.commit(l=>[...l,rebuildCurve(make({shape:"crack",width:+state.crackWidth.toFixed(2),curve}))])}
      setDraft(null);
    }else if(g.type==="node"){setEdit(ed=>{if(ed)gt.commit(l=>l.map(a=>a.id===ed.id?{...ed.item,status:a.status==="suggested"?"accepted":a.status}:a));return null})}
  }
  const vis=a=>state.show[a.level]!==false;
  const pathOf=pts=>pts.map((p,i)=>(i?"L":"M")+p[0].toFixed(1)+" "+p[1].toFixed(1)).join(" ");
  const items=edit?gt.items.map(a=>a.id===edit.id?edit.item:a):gt.items;
  const sel=items.find(a=>a.id===state.selected);
  const R=4*pxPerScreen();
  // pré-visualização do rascunho
  let draftPath=null;
  if(draft){
    if(draft.kind==="bezier")draftPath=flattenBezier(hover&&!drag.current?[...draft.nodes,{p:hover,hin:hover,hout:hover}]:draft.nodes,false);
    else if(draft.kind==="bspline")draftPath=flattenBSpline(hover?[...draft.ctrl,hover]:draft.ctrl,false);
    else if(draft.shape==="spiral")draftPath=draft.radius>0?spiralPoints({center:draft.center,radius:draft.radius,arg:draft.arg,turns:state.spiralTurns,exp:state.spiralExp}):null;
    else draftPath=(draft.shape==="crack"||draft.shape==="polygon")&&hover?[...draft.points,hover]:draft.points;
  }
  const draftClosed=draft?.shape==="polygon";
  const draftWidth=draft?.shape==="stroke"?draft.width:(draft?.shape==="polygon"||(draft?.shape==="curve"&&isArea(state.cls)))?null:state.crackWidth;
  return <svg ref={svg} className={"gtLayer tool-"+state.tool} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={()=>setHover(null)} onContextMenu={e=>{if(draftRef.current){e.preventDefault();e.stopPropagation();finish()}}}>
    {items.filter(vis).map(a=>{const c=GT_BY_ID[a.cls]||GT_CLASSES[0],isSel=state.selected===a.id,sug=a.status==="suggested";
      const common={key:a.id,"data-gt":a.id,className:"gtShape"+(isSel?" selected":"")+(sug?" suggested":"")+(a.status==="rejected"?" rejected":""),style:{"--gt":c.color}};
      return a.shape==="polygon"?<path {...common} d={pathOf(a.points)+" Z"} fill={c.color} fillOpacity={sug?.12:.28} stroke={c.color} vectorEffect="non-scaling-stroke"/>
        :<path {...common} d={pathOf(a.points)} fill="none" stroke={c.color} strokeOpacity={sug?.55:.8} strokeWidth={a.width||2} strokeLinecap="round" strokeLinejoin="round"/>;
    })}
    {sel&&state.tool==="select"&&<NodeHandles item={sel} r={R}/>}
    {draftPath&&<path className="gtDraft" d={pathOf(draftPath)+(draftClosed?" Z":"")} fill={draftWidth==null?cls.color:"none"} fillOpacity=".15" stroke={cls.color} strokeOpacity=".8" strokeWidth={draftWidth??undefined} vectorEffect={draftWidth==null?"non-scaling-stroke":undefined} strokeLinecap="round" strokeLinejoin="round"/>}
    {draft?.nodes&&draft.nodes.map((n,i)=><g key={i} className="gtDraft">{(n.hin[0]!==n.p[0]||n.hin[1]!==n.p[1])&&<><line x1={n.hin[0]} y1={n.hin[1]} x2={n.hout[0]} y2={n.hout[1]} stroke="#6f7f87" vectorEffect="non-scaling-stroke"/><circle cx={n.hin[0]} cy={n.hin[1]} r={R*.7} fill="#6f7f87"/><circle cx={n.hout[0]} cy={n.hout[1]} r={R*.7} fill="#6f7f87"/></>}<rect x={n.p[0]-R} y={n.p[1]-R} width={2*R} height={2*R} fill="#fff" stroke={cls.color} vectorEffect="non-scaling-stroke"/></g>)}
    {(draft?.ctrl||(draft?.points&&draft.shape!=="stroke"?draft.points:null))?.map((p,i)=><circle key={"c"+i} className="gtDraft" cx={p[0]} cy={p[1]} r={R*.8} fill="#fff" stroke={cls.color} vectorEffect="non-scaling-stroke"/>)}
    {draft?.ctrl&&<path className="gtDraft" d={pathOf(draft.ctrl)} fill="none" stroke="#6f7f87" strokeDasharray="3 3" vectorEffect="non-scaling-stroke"/>}
    {hover&&state.tool==="brush"&&!draft&&<circle className="gtCursor" cx={hover[0]} cy={hover[1]} r={brushImg()/2} fill="none" stroke={cls.color} vectorEffect="non-scaling-stroke"/>}
  </svg>;
}
// Alças de edição (ferramenta Selecionar): nós/alças Bézier, pontos de controle B-spline, vértices, centro/raio da espiral.
function NodeHandles({item,r}){
  const c=item.curve,h=[];
  const sq=(p,key,attrs)=><rect key={key} className="gtNode" x={p[0]-r} y={p[1]-r} width={2*r} height={2*r} {...attrs}/>;
  const dot=(p,key,attrs)=><circle key={key} className="gtNode handle" cx={p[0]} cy={p[1]} r={r*.8} {...attrs}/>;
  if(c?.kind==="bezier")c.nodes.forEach((n,i)=>{h.push(<line key={"l"+i} className="gtHandleLine" x1={n.hin[0]} y1={n.hin[1]} x2={n.hout[0]} y2={n.hout[1]}/>);h.push(dot(n.hin,"hi"+i,{"data-node":i,"data-part":"hin"}));h.push(dot(n.hout,"ho"+i,{"data-node":i,"data-part":"hout"}));h.push(sq(n.p,"p"+i,{"data-node":i,"data-part":"p"}))});
  else if(c?.kind==="bspline"){h.push(<path key="poly" className="gtHandleLine" d={c.ctrl.map((p,i)=>(i?"L":"M")+p[0]+" "+p[1]).join(" ")+(c.closed?" Z":"")}/>);c.ctrl.forEach((p,i)=>h.push(dot(p,"c"+i,{"data-node":i,"data-part":"ctrl"})))}
  else if(c?.kind==="spiral"){const o=[c.center[0]+c.radius*Math.cos(c.arg),c.center[1]+c.radius*Math.sin(c.arg)];h.push(sq(c.center,"ctr",{"data-node":0,"data-part":"center"}));h.push(dot(o,"out",{"data-node":0,"data-part":"outer"}))}
  else item.points.forEach((p,i)=>{if(item.points.length<=160||i%Math.ceil(item.points.length/160)===0)h.push(dot(p,"v"+i,{"data-node":i,"data-part":"point"}))});
  return <g className="gtHandles">{h}</g>;
}
// Aplica o arraste de um nó/alça (Alt: alça independente = nó angular, como no Inkscape).
function editNode(orig,part,index,p,start,alt){
  const a=structuredClone(orig),c=a.curve,dx=p[0]-start[0],dy=p[1]-start[1];
  if(c?.kind==="bezier"){
    const n=c.nodes[index];
    if(part==="p"){n.p=[n.p[0]+dx,n.p[1]+dy];n.hin=[n.hin[0]+dx,n.hin[1]+dy];n.hout=[n.hout[0]+dx,n.hout[1]+dy]}
    else{n[part]=[p[0],p[1]];if(!alt){const o=part==="hin"?"hout":"hin",len=dist(n[o],n.p),d=dist(n[part],n.p)||1;n[o]=[n.p[0]-(n[part][0]-n.p[0])*len/d,n.p[1]-(n[part][1]-n.p[1])*len/d]}}
  }else if(c?.kind==="bspline")c.ctrl[index]=[p[0],p[1]];
  else if(c?.kind==="spiral"){if(part==="center")c.center=[c.center[0]+dx,c.center[1]+dy];else{c.radius=dist(c.center,p);c.arg=Math.atan2(p[1]-c.center[1],p[0]-c.center[0])}}
  else a.points[index]=[+p[0].toFixed(2),+p[1].toFixed(2)];
  return a;
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
  bezier:{icon:Spline,label:"Bézier",hint:"Como a Caneta do Inkscape: clique = nó de canto; clique e arraste = nó suave com alças. Clique no 1º nó para fechar; Enter/duplo clique termina."},
  bspline:{icon:Waypoints,label:"B-spline",hint:"Clique os pontos de controle; a curva suave passa perto deles (B-spline cúbica). Clique no 1º ponto para fechar; Enter termina."},
  spiral:{icon:Orbit,label:"Espiral",hint:"Clique no centro e arraste até o raio; voltas e divergência no painel."},
  select:{icon:MousePointer2,label:"Selecionar",hint:"Clique numa anotação para ver e arrastar nós e alças (Alt = alça independente); Delete apaga."}};

export function AnnotationPanel({gt,state,setState,zoom,setZoom,file,previewSize,cdmResult,mmPerPx,onNotice,onClose}){
  const[evalResult,setEvalResult]=useState(null),[busy,setBusy]=useState("");
  // painel móvel: arraste pelo cabeçalho; posição lembrada entre sessões
  const panel=useRef(null);
  const[pos,setPos]=useState(()=>{try{return JSON.parse(localStorage.getItem("shmGtPanelPos")||"null")}catch{return null}});
  useEffect(()=>{try{pos?localStorage.setItem("shmGtPanelPos",JSON.stringify(pos)):localStorage.removeItem("shmGtPanelPos")}catch{}},[pos]);
  const clampPos=(x,y)=>{const el=panel.current,par=el?.offsetParent;if(!el||!par)return{x,y};return{x:Math.max(4,Math.min(par.clientWidth-el.offsetWidth-4,x)),y:Math.max(4,Math.min(par.clientHeight-48,y))}};
  function dragStart(e){
    if(e.button!==0||e.target.closest("button"))return;
    const el=panel.current;if(!el)return;e.preventDefault();
    const sx=e.clientX,sy=e.clientY,ox=el.offsetLeft,oy=el.offsetTop;
    const mv=ev=>setPos(clampPos(ox+ev.clientX-sx,oy+ev.clientY-sy));
    const end=()=>{window.removeEventListener("pointermove",mv);window.removeEventListener("pointerup",end)};
    window.addEventListener("pointermove",mv);window.addEventListener("pointerup",end);
  }
  const nudge=e=>{const st=e.shiftKey?40:10,el=panel.current;if(!el)return;const d={ArrowLeft:[-st,0],ArrowRight:[st,0],ArrowUp:[0,-st],ArrowDown:[0,st]}[e.key];if(e.key==="Home"){e.preventDefault();setPos(null);return}if(d){e.preventDefault();setPos(clampPos(el.offsetLeft+d[0],el.offsetTop+d[1]))}};
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
  return <div ref={panel} className={"gtPanel"+(pos?" moved":"")} role="dialog" aria-label="Anotação Ground Truth" style={pos?{left:pos.x+"px",top:pos.y+"px",right:"auto"}:undefined}>
    <div className="gtHead" onPointerDown={dragStart} onDoubleClick={e=>{if(!e.target.closest("button"))setPos(null)}} title="Arraste para mover · duplo clique restaura"><b tabIndex="0" onKeyDown={nudge} aria-label="Mover painel de anotação (setas; Home restaura)"><Move size={13} className="gtGrip"/><PenTool size={14}/> Anotação · Ground Truth</b><button type="button" onClick={onClose} aria-label="Fechar anotação"><X size={15}/></button></div>
    <div className="gtLevels" role="tablist" aria-label="Nível de escala">{GT_LEVELS.map(l=><button key={l.id} type="button" role="tab" aria-selected={state.level===l.id} onClick={()=>pickLevel(l.id)}><span>{l.label}</span><small>{l.id==="cena"?"1×":l.id==="regiao"?"2–4×":"≥ 8×"}</small></button>)}</div>
    <p className="gtHint">{level.hint}</p>
    {mismatch&&<button type="button" className="gtZoomHint" onClick={()=>setZoom(level.zoom)}><ZoomIn size={13}/> Zoom atual {zoom.toFixed(1)}× · ir para {level.zoom}× ({level.label.toLowerCase()})</button>}
    <div className="gtTools">{[...level.tools,"select"].map(t=>{const I=TOOL_INFO[t].icon;return <button key={t} type="button" className={state.tool===t?"active":""} onClick={()=>setState(s=>({...s,tool:t}))} title={TOOL_INFO[t].hint}><I size={14}/>{TOOL_INFO[t].label}</button>})}</div>
    <div className="gtClasses">{classes.map(c=>{const n=counts[c.id];return <button key={c.id} type="button" className={state.cls===c.id?"active":""} style={{"--gt":c.color}} onClick={()=>setState(s=>({...s,cls:c.id,tool:c.id==="cracks"&&s.tool==="polygon"?"crack":c.id!=="cracks"&&s.tool==="crack"?"polygon":s.tool}))}><i/>{c.label}{n&&<small>{n.ok}{n.sug?" +"+n.sug+"?":""}</small>}</button>})}</div>
    {state.tool==="brush"&&<label className="gtRange">Pincel <input type="range" min="2" max="60" value={state.brush} onChange={e=>setState(s=>({...s,brush:+e.target.value}))}/><span>{state.brush} px na tela</span></label>}
    {state.tool==="spiral"&&<><label className="gtRange">Voltas <input type="range" min="0.5" max="10" step="0.5" value={state.spiralTurns} onChange={e=>setState(s=>({...s,spiralTurns:+e.target.value}))}/><span>{state.spiralTurns}</span></label><label className="gtRange">Divergência <input type="range" min="0.2" max="4" step="0.1" value={state.spiralExp} onChange={e=>setState(s=>({...s,spiralExp:+e.target.value}))}/><span>{state.spiralExp.toFixed(1)}</span></label></>}
    {(state.tool==="bezier"||state.tool==="bspline")&&<p className="gtHint">{GT_BY_ID[state.cls]?.level==="detalhe"?"Fissura: caminho aberto com a largura abaixo.":"Classe de área: o caminho é fechado e preenchido."}</p>}
    {(state.tool==="crack"||state.tool==="spiral"||((state.tool==="bezier"||state.tool==="bspline")&&GT_BY_ID[state.cls]?.level==="detalhe"))&&<label className="gtRange">Largura <input type="range" min="0.5" max="20" step="0.5" value={state.crackWidth} onChange={e=>setState(s=>({...s,crackWidth:+e.target.value}))}/><span>{state.crackWidth} px{mmPerPx>0?" ≈ "+(state.crackWidth*mmPerPx).toFixed(2)+" mm":""}</span></label>}
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
export const DEFAULT_GT_STATE={level:"cena",tool:"polygon",cls:"structure",brush:14,crackWidth:2,spiralTurns:3,spiralExp:1,selected:null,show:{}};
