// Núcleo da anotação few-shot (Ground Truth) do SHM Studio — sem DOM, testável no Node.
// Vetores em pixels da imagem de pré-visualização; rasterização, COCO, métricas e ZIP.

export const GT_CLASSES=[
  {id:"structure",label:"Estrutura",level:"cena",color:"#0d966e",index:1},
  {id:"irrelevant",label:"Irrelevante",level:"cena",color:"#e62828",index:2},
  {id:"spalling_dark",label:"Desplacamento",level:"regiao",color:"#ff9900",index:3},
  {id:"exposed_rebar",label:"Armadura exposta",level:"regiao",color:"#8c8c8c",index:4},
  {id:"corrosion_rust",label:"Corrosão",level:"regiao",color:"#8b3f00",index:5},
  {id:"efflorescence_white",label:"Eflorescência",level:"regiao",color:"#0066cc",index:6},
  {id:"cracks",label:"Fissura",level:"detalhe",color:"#e60000",index:7}
];
export const GT_BY_ID=Object.fromEntries(GT_CLASSES.map(c=>[c.id,c]));
// Três níveis de escala: cada um tem zoom recomendado e ferramentas próprias.
export const GT_LEVELS=[
  {id:"cena",label:"Cena",zoom:1,tools:["polygon","bezier","bspline","brush"],hint:"Foto inteira: marque estrutura e regiões irrelevantes (céu, vegetação, veículos, placas)."},
  {id:"regiao",label:"Região",zoom:3,tools:["polygon","bezier","bspline","spiral","brush"],hint:"Zoom 2–4×: contorne desplacamento, armadura, corrosão e eflorescência."},
  {id:"detalhe",label:"Detalhe",zoom:10,tools:["crack","bezier","bspline","spiral","brush"],hint:"Zoom ≥ 8×: trace a linha central das fissuras clique a clique; a largura é a do traço."}
];
export function levelForZoom(z){return z>=6?"detalhe":z>=1.8?"regiao":"cena"}
// Ordem de pintura do mapa de rótulos: cena embaixo, fissura por cima (classes finas vencem).
const PAINT_ORDER=["structure","irrelevant","spalling_dark","efflorescence_white","corrosion_rust","exposed_rebar","cracks"];

// ---------- rasterização pura ----------
export function fillPolygon(mask,w,h,pts,val=1){
  if(!pts||pts.length<3)return mask;
  let minY=Infinity,maxY=-Infinity;for(const p of pts){if(p[1]<minY)minY=p[1];if(p[1]>maxY)maxY=p[1]}
  const y0=Math.max(0,Math.floor(minY)),y1=Math.min(h-1,Math.ceil(maxY)),xs=[];
  for(let y=y0;y<=y1;y++){
    const yc=y+.5;xs.length=0;
    for(let i=0,j=pts.length-1;i<pts.length;j=i++){
      const[xi,yi]=pts[i],[xj,yj]=pts[j];
      if((yi<=yc&&yj>yc)||(yj<=yc&&yi>yc))xs.push(xi+(yc-yi)*(xj-xi)/(yj-yi));
    }
    xs.sort((a,b)=>a-b);
    for(let k=0;k+1<xs.length;k+=2){
      const a=Math.max(0,Math.ceil(xs[k]-.5)),b=Math.min(w-1,Math.floor(xs[k+1]-.5));
      for(let x=a;x<=b;x++)mask[y*w+x]=val;
    }
  }
  return mask;
}
function stampDisk(mask,w,h,cx,cy,r,val){
  const r2=r*r,x0=Math.max(0,Math.floor(cx-r)),x1=Math.min(w-1,Math.ceil(cx+r)),y0=Math.max(0,Math.floor(cy-r)),y1=Math.min(h-1,Math.ceil(cy+r));
  for(let y=y0;y<=y1;y++){const dy=y+.5-cy;for(let x=x0;x<=x1;x++){const dx=x+.5-cx;if(dx*dx+dy*dy<=r2)mask[y*w+x]=val}}
}
export function strokePolyline(mask,w,h,pts,width,val=1){
  if(!pts?.length)return mask;
  const r=Math.max(.5,width/2),step=Math.max(.35,r/2);
  if(pts.length===1){stampDisk(mask,w,h,pts[0][0],pts[0][1],r,val);return mask}
  for(let i=1;i<pts.length;i++){
    const[ax,ay]=pts[i-1],[bx,by]=pts[i],len=Math.hypot(bx-ax,by-ay),n=Math.max(1,Math.ceil(len/step));
    for(let k=0;k<=n;k++){const t=k/n;stampDisk(mask,w,h,ax+(bx-ax)*t,ay+(by-ay)*t,r,val)}
  }
  return mask;
}
// Anotação → máscara w×h; scale converte coordenadas da pré-visualização para a grade de saída.
export function rasterize(a,w,h,scale=1,mask=new Uint8Array(w*h),val=1){
  const pts=(a.points||[]).map(([x,y])=>[x*scale,y*scale]);
  if(a.shape==="polygon")fillPolygon(mask,w,h,pts,val);
  else strokePolyline(mask,w,h,pts,Math.max(1,(a.width||2)*scale),val);
  return mask;
}
export const usable=a=>a&&a.status!=="suggested"&&a.status!=="rejected";
export function labelMap(annotations,w,h,scale=1){
  const out=new Uint8Array(w*h);
  for(const id of PAINT_ORDER){const c=GT_BY_ID[id];for(const a of annotations)if(usable(a)&&a.cls===id)rasterize(a,w,h,scale,out,c.index)}
  return out;
}
export function classMask(annotations,cls,w,h,scale=1){
  const m=new Uint8Array(w*h);for(const a of annotations)if(usable(a)&&a.cls===cls)rasterize(a,w,h,scale,m,1);return m;
}

// ---------- métricas de segmentação ----------
export function segMetrics(gt,pred,skeleton=null){
  let tp=0,fp=0,fn=0;
  for(let i=0;i<gt.length;i++){const g=gt[i]?1:0,p=pred[i]?1:0;if(g&&p)tp++;else if(p)fp++;else if(g)fn++}
  const iou=tp+fp+fn?tp/(tp+fp+fn):null,dice=tp+fp+fn?2*tp/(2*tp+fp+fn):null;
  const precision=tp+fp?tp/(tp+fp):null,recall=tp+fn?tp/(tp+fn):null;
  let cldice=null;
  if(skeleton){
    // clDice (Shit et al., 2021): concordância de topologia de estruturas finas pelos esqueletos.
    const sp=skeleton(pred),sg=skeleton(gt);let a=0,na=0,b=0,nb=0;
    for(let i=0;i<gt.length;i++){if(sp[i]){na++;if(gt[i])a++}if(sg[i]){nb++;if(pred[i])b++}}
    const tprec=na?a/na:0,tsens=nb?b/nb:0;cldice=tprec+tsens?2*tprec*tsens/(tprec+tsens):0;
  }
  return{tp,fp,fn,iou,dice,precision,recall,cldice,gt_px:tp+fn,pred_px:tp+fp};
}

// Resultado CDM (records em pixels processados) → anotações sugeridas em pixels da pré-visualização.
export function suggestionsFromCdm(records,scale=1){
  const out=[];let n=0;
  for(const r of records||[]){
    if(!GT_BY_ID[r.class]||!r.points?.length)continue;
    const pts=r.points.map(([x,y])=>[+(x*scale).toFixed(2),+(y*scale).toFixed(2)]);
    const crack=r.class==="cracks"||!r.closed;
    out.push({id:"cdm-"+(++n)+"-"+Date.now().toString(36),cls:r.class,level:GT_BY_ID[r.class].level,shape:crack?"crack":"polygon",points:pts,
      width:crack?Math.max(1,+((r.width_px||2)*scale).toFixed(2)):undefined,status:"suggested",source:"cdm",zoom:null,created_at:new Date().toISOString()});
  }
  return out;
}

// ---------- COCO ----------
function bboxOf(pts,pad=0){
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const[x,y]of pts){if(x<x0)x0=x;if(y<y0)y0=y;if(x>x1)x1=x;if(y>y1)y1=y}
  return[x0-pad,y0-pad,x1-x0+2*pad,y1-y0+2*pad];
}
// RLE não comprimido no padrão COCO (ordem por colunas).
export function rleEncode(mask,w,h){
  const counts=[];let last=0,run=0;
  for(let x=0;x<w;x++)for(let y=0;y<h;y++){const v=mask[y*w+x]?1:0;if(v!==last){counts.push(run);run=0;last=v}run++}
  counts.push(run);return{size:[h,w],counts};
}
export function toCoco(annotations,{fileName,width,height,scale=1,meta={}}={}){
  const cats=GT_CLASSES.map(c=>({id:c.index,name:c.id,supercategory:c.level,display_name:c.label}));
  const anns=[];let id=0;
  for(const a of annotations){
    if(!usable(a)||!GT_BY_ID[a.cls])continue;
    const pts=a.points.map(([x,y])=>[x*scale,y*scale]),m=rasterize(a,width,height,scale);
    let area=0;for(const v of m)area+=v;if(!area)continue;
    const half=a.shape==="polygon"?0:Math.max(1,(a.width||2)*scale)/2;
    anns.push({id:++id,image_id:1,category_id:GT_BY_ID[a.cls].index,iscrowd:0,area,bbox:bboxOf(pts,half).map(v=>+v.toFixed(2)),
      segmentation:a.shape==="polygon"?[pts.flat().map(v=>+v.toFixed(2))]:rleEncode(m,width,height),
      shm:{shape:a.shape,curve:a.curve||null,level:a.level,width_px:a.shape==="polygon"?null:+((a.width||2)*scale).toFixed(2),annotated_zoom:a.zoom??null,source:a.source||"user",status:a.status||"manual",polyline:a.shape==="polygon"?null:pts.map(p=>p.map(v=>+v.toFixed(2)))}});
  }
  return{info:{description:"SHM Studio · Ground Truth few-shot multiescala",version:"1.0",date_created:new Date().toISOString(),...meta},
    licenses:[],images:[{id:1,file_name:fileName,width,height}],categories:cats,annotations:anns};
}

// Janelas multiescala: s=1 (imagem inteira), s=2 (2×2), s=4 (4×4); cada uma vira um tile de lado máx. `side`.
export function tileWindows(w,h,{scales=[1,2,4],side=512}={}){
  const out=[];
  for(const s of scales){
    const tw=Math.ceil(w/s),th=Math.ceil(h/s);
    for(let j=0;j<s;j++)for(let i=0;i<s;i++){
      const x=i*tw,y=j*th,ww=Math.min(tw,w-x),hh=Math.min(th,h-y);if(ww<=0||hh<=0)continue;
      const k=Math.min(1,side/Math.max(ww,hh));
      out.push({scale:s,i,j,x,y,w:ww,h:hh,out_w:Math.max(1,Math.round(ww*k)),out_h:Math.max(1,Math.round(hh*k)),px_per_out:+(1/k).toFixed(4)});
    }
  }
  return out;
}
// Recorte do mapa de rótulos por vizinho mais próximo (rótulos não podem ser interpolados).
export function cropLabels(labels,w,win){
  const out=new Uint8Array(win.out_w*win.out_h);
  for(let y=0;y<win.out_h;y++){const sy=win.y+Math.min(win.h-1,Math.floor((y+.5)*win.h/win.out_h));
    for(let x=0;x<win.out_w;x++){const sx=win.x+Math.min(win.w-1,Math.floor((x+.5)*win.w/win.out_w));out[y*win.out_w+x]=labels[sy*w+sx]}}
  return out;
}

// ---------- ZIP (armazenado, sem compressão) ----------
const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
export function crc32(bytes){let c=0xffffffff;for(let i=0;i<bytes.length;i++)c=CRC[(c^bytes[i])&255]^(c>>>8);return(c^0xffffffff)>>>0}
export function zipStore(files){
  const enc=new TextEncoder(),parts=[],central=[];let offset=0;
  const d=new Date(),dosTime=(d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1),dosDate=((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate();
  for(const f of files){
    const name=enc.encode(f.name),data=typeof f.data==="string"?enc.encode(f.data):f.data,crc=crc32(data);
    const lh=new DataView(new ArrayBuffer(30));
    lh.setUint32(0,0x04034b50,true);lh.setUint16(4,20,true);lh.setUint16(6,0x0800,true);lh.setUint16(8,0,true);
    lh.setUint16(10,dosTime,true);lh.setUint16(12,dosDate,true);lh.setUint32(14,crc,true);lh.setUint32(18,data.length,true);lh.setUint32(22,data.length,true);
    lh.setUint16(26,name.length,true);lh.setUint16(28,0,true);
    parts.push(new Uint8Array(lh.buffer),name,data);
    const ch=new DataView(new ArrayBuffer(46));
    ch.setUint32(0,0x02014b50,true);ch.setUint16(4,20,true);ch.setUint16(6,20,true);ch.setUint16(8,0x0800,true);ch.setUint16(10,0,true);
    ch.setUint16(12,dosTime,true);ch.setUint16(14,dosDate,true);ch.setUint32(16,crc,true);ch.setUint32(20,data.length,true);ch.setUint32(24,data.length,true);
    ch.setUint16(28,name.length,true);ch.setUint32(42,offset,true);
    central.push(new Uint8Array(ch.buffer),name);
    offset+=30+name.length+data.length;
  }
  const csize=central.reduce((a,p)=>a+p.length,0),end=new DataView(new ArrayBuffer(22));
  end.setUint32(0,0x06054b50,true);end.setUint16(8,files.length,true);end.setUint16(10,files.length,true);end.setUint32(12,csize,true);end.setUint32(16,offset,true);
  return new Blob([...parts,...central,new Uint8Array(end.buffer)],{type:"application/zip"});
}

// ---------- curvas (estilo Inkscape): Bézier cúbica, B-spline cúbica uniforme e espiral ----------
// Bézier: nós {p,hin,hout}; segmento i→i+1 usa p_i, hout_i, hin_{i+1}, p_{i+1}. Achatamento adaptativo.
function cubic(a,b,c,d,t){const u=1-t;return[u*u*u*a[0]+3*u*u*t*b[0]+3*u*t*t*c[0]+t*t*t*d[0],u*u*u*a[1]+3*u*u*t*b[1]+3*u*t*t*c[1]+t*t*t*d[1]]}
export function flattenBezier(nodes,closed=false,tol=.35){
  if(!nodes?.length)return[];
  const out=[nodes[0].p.slice()],segs=closed?nodes.length:nodes.length-1;
  for(let i=0;i<segs;i++){
    const A=nodes[i],B=nodes[(i+1)%nodes.length],a=A.p,b=A.hout||A.p,c=B.hin||B.p,d=B.p;
    const len=Math.hypot(b[0]-a[0],b[1]-a[1])+Math.hypot(c[0]-b[0],c[1]-b[1])+Math.hypot(d[0]-c[0],d[1]-c[1]);
    const n=Math.max(1,Math.min(400,Math.ceil(len/Math.max(.5,tol*4))));
    for(let k=1;k<=n;k++)out.push(cubic(a,b,c,d,k/n));
  }
  if(closed)out.pop();
  return out;
}
// B-spline cúbica uniforme: fechada = periódica; aberta = extremos repetidos (a curva toca o 1º e o último ponto).
export function flattenBSpline(ctrl,closed=false,perSeg=16){
  if(!ctrl?.length)return[];
  if(ctrl.length<3)return ctrl.map(p=>p.slice());
  const P=closed?ctrl:[ctrl[0],ctrl[0],...ctrl,ctrl[ctrl.length-1],ctrl[ctrl.length-1]];
  const n=closed?P.length:P.length-3,out=[];
  for(let i=0;i<n;i++){
    const p0=P[i%P.length],p1=P[(i+1)%P.length],p2=P[(i+2)%P.length],p3=P[(i+3)%P.length];
    for(let k=0;k<perSeg;k++){
      const t=k/perSeg,t2=t*t,t3=t2*t;
      const b0=(1-3*t+3*t2-t3)/6,b1=(4-6*t2+3*t3)/6,b2=(1+3*t+3*t2-3*t3)/6,b3=t3/6;
      out.push([b0*p0[0]+b1*p1[0]+b2*p2[0]+b3*p3[0],b0*p0[1]+b1*p1[1]+b2*p2[1]+b3*p3[1]]);
    }
  }
  if(!closed)out.push(ctrl[ctrl.length-1].slice());
  return out;
}
// Espiral de Inkscape: r(t)=R·t^exp, θ(t)=arg + 2π·voltas·t (de dentro para fora), t ∈ [t0,1].
export function spiralPoints({center,radius,arg=0,turns=3,exp=1,t0=0}){
  const n=Math.max(24,Math.ceil(turns*72)),out=[];
  for(let k=0;k<=n;k++){
    const t=t0+(1-t0)*k/n,r=radius*Math.pow(t,exp),th=arg-2*Math.PI*turns*(1-t);
    out.push([center[0]+r*Math.cos(th),center[1]+r*Math.sin(th)]);
  }
  return out;
}
// Recalcula a polilinha de raster a partir da curva (após criar ou editar nós).
export function rebuildCurve(a){
  const c=a.curve;if(!c)return a;
  let pts=a.points;
  if(c.kind==="bezier")pts=flattenBezier(c.nodes,c.closed);
  else if(c.kind==="bspline")pts=flattenBSpline(c.ctrl,c.closed);
  else if(c.kind==="spiral")pts=spiralPoints(c);
  return{...a,points:pts.map(p=>[+p[0].toFixed(2),+p[1].toFixed(2)])};
}
