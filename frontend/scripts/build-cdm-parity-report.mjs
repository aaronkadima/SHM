// Relatório de paridade CDM Python ⇄ navegador (indicadores + dados para os gráficos do Studio).
// Entrada: casos gerados por backend/tests/generate_cdm_parity_report_cases.py (etapas do Python).
// Saída: JSON compacto lido pelo painel "Paridade CDM" (src/ParityPanel.jsx).
// Uso: node scripts/build-cdm-parity-report.mjs CASOS.json SAIDA.json
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {execSync} from "node:child_process";
import {__cdmTest} from "../src/cdmBrowser.js";

const [casesPath,outPath]=process.argv.slice(2);
if(!casesPath||!outPath)throw new Error("usage: node scripts/build-cdm-parity-report.mjs CASES.json OUT.json");
const input=JSON.parse(fs.readFileSync(casesPath,"utf8"));
const cfg=input.config,CLASSES=input.classes;
const MASK_STAGES=[["raw_mask","raw","Máscara candidata"],["open_mask","open","Abertura / reconstrução"],["clean_mask","clean","Abertura + fechamento"]];

// Tolerâncias (tabela do CI). Valores determinísticos: máscaras, reconstrução e esqueleto devem coincidir.
const TOL={gray_linf:1,response_linf:1,raw_pmr:.0001,open_pmr:0,clean_iou:.9999,skeleton_nodes:0,dcc:0,measure_rel:.01};

function fromIndices(list,n){const m=new Uint8Array(n);for(const i of list)m[i]=1;return m}
function maskCompare(js,py){
  let a=0,b=0,inter=0,union=0,diff=0;
  for(let i=0;i<js.length;i++){const x=js[i]?1:0,y=py[i]?1:0;a+=x;b+=y;if(x&&y)inter++;if(x||y)union++;if(x!==y)diff++}
  return{js:a,py:b,iou:union?inter/union:1,pmr:diff/js.length};
}
function fieldCompare(js,py){
  let linf=0,sum=0;for(let i=0;i<js.length;i++){const d=Math.abs(js[i]-py[i]);if(d>linf)linf=d;sum+=d}
  return{linf,mae:sum/js.length};
}
function components(mask,w,h){
  const seen=new Uint8Array(mask.length),q=new Int32Array(mask.length);let count=0;
  for(let s=0;s<mask.length;s++){
    if(!mask[s]||seen[s])continue;count++;let head=0,tail=0;q[tail++]=s;seen[s]=1;
    while(head<tail){const p=q[head++],y=(p/w)|0,x=p-y*w;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy;if((dx||dy)&&nx>=0&&ny>=0&&nx<w&&ny<h){const r=ny*w+nx;if(mask[r]&&!seen[r]){seen[r]=1;q[tail++]=r}}}}
  }
  return count;
}
function skeletonNodes(skel,w,h){
  let ends=0,branches=0,len=0;
  for(let i=0;i<skel.length;i++){
    if(!skel[i])continue;len++;const y=(i/w)|0,x=i-y*w;let deg=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy;if((dx||dy)&&nx>=0&&ny>=0&&nx<w&&ny<h&&skel[ny*w+nx])deg++}
    if(deg===1)ends++;else if(deg>=3)branches++;
  }
  return{len,ends,branches};
}
// Máscaras de divergência em RLE: [início, comprimento, início, comprimento, …] sobre o índice linear.
function runs(test,n){const out=[];let start=-1;for(let i=0;i<=n;i++){const on=i<n&&test(i);if(on&&start<0)start=i;else if(!on&&start>=0){out.push(start,i-start);start=-1}}return out}
// Matriz cruzada multirrótulo: um pixel pode ter várias famílias (ex.: corrosão escura também é
// desplacamento). Linha i = pixels que o Python marca como i; coluna j = desses, quantos o JS marca
// como j ("background" = o JS não marca nenhuma família). Linhas podem somar mais de 100%.
function addConfusion(mat,pyM,jsM,n){
  const K=CLASSES.length;
  for(let i=0;i<n;i++){
    let jsAny=false;for(let b=0;b<K;b++)if(jsM[CLASSES[b]][i]){jsAny=true;break}
    let pyAny=false;
    for(let a=0;a<K;a++){if(!pyM[CLASSES[a]][i])continue;pyAny=true;
      for(let b=0;b<K;b++)if(jsM[CLASSES[b]][i])mat[a][b]++;
      if(!jsAny)mat[a][K]++;mat[a][K+1]++}
    if(!pyAny){for(let b=0;b<K;b++)if(jsM[CLASSES[b]][i])mat[K][b]++;if(!jsAny)mat[K][K]++;mat[K][K+1]++}
  }
}
function thumbnail(gray,w,h){
  const s=Math.max(1,Math.ceil(Math.max(w,h)/200)),tw=Math.ceil(w/s),th=Math.ceil(h/s),bytes=new Uint8Array(tw*th);
  for(let y=0;y<th;y++)for(let x=0;x<tw;x++)bytes[y*tw+x]=Math.max(0,Math.min(255,Math.round(gray[Math.min(h-1,y*s)*w+Math.min(w-1,x*s)])));
  return{w:tw,h:th,scale:s,b64:Buffer.from(bytes).toString("base64")};
}
const relErr=(a,b)=>Math.abs(a-b)/Math.max(1e-9,Math.abs(b)||1);
const round=(v,d=6)=>Number.isFinite(v)?Number(v.toFixed(d)):v;

const cases=[],measures=[],confusion=Array.from({length:CLASSES.length+1},()=>new Array(CLASSES.length+2).fill(0));
const cascade=Object.fromEntries(CLASSES.map(c=>[c,{}]));
const agg={gray_linf:0,response_linf:0,raw_pmr:0,open_pmr:0,clean_iou:1,clean_pmr:0,dcc:0,skeleton_nodes:0,skeleton_rel:0,measure_rel:0};
const bump=(cls,stage,key,val,worse)=>{const slot=cascade[cls][stage]||(cascade[cls][stage]={});slot[key]=slot[key]==null?val:worse(slot[key],val)};

for(const c of input.cases){
  const {width:w,height:h}=c,n=w*h,data=new Uint8ClampedArray(n*4);
  for(let i=0,j=0;i<n;i++,j+=3){data[i*4]=c.rgb[j];data[i*4+1]=c.rgb[j+1];data[i*4+2]=c.rgb[j+2];data[i*4+3]=255}
  const trace={},jsMasks=__cdmTest.detectMasks({width:w,height:h,data},cfg,trace),py=c.python;
  const gray=fieldCompare(trace.gray,py.gray);
  agg.gray_linf=Math.max(agg.gray_linf,gray.linf);
  const out={name:c.name,width:w,height:h,gray:{linf:round(gray.linf),mae:round(gray.mae)},classes:{},diff:{}};
  const pyClean={};
  for(const cls of CLASSES){
    const t=trace[cls],p=py.classes[cls],row={stages:{}};
    const resp=fieldCompare(t.response,p.response);row.response={linf:round(resp.linf),mae:round(resp.mae)};
    agg.response_linf=Math.max(agg.response_linf,resp.linf);
    bump(cls,"gray","linf",gray.linf,Math.max);bump(cls,"gray","iou",1,Math.min);bump(cls,"gray","pmr",0,Math.max);
    bump(cls,"response","linf",resp.linf,Math.max);bump(cls,"response","iou",1,Math.min);bump(cls,"response","pmr",0,Math.max);
    for(const[pyKey,jsKey]of MASK_STAGES){
      const m=maskCompare(t[jsKey],fromIndices(p[pyKey],n));
      row.stages[pyKey]={iou:round(m.iou),pmr:round(m.pmr,8),js:m.js,py:m.py};
      bump(cls,pyKey,"iou",m.iou,Math.min);bump(cls,pyKey,"pmr",m.pmr,Math.max);
      if(pyKey==="raw_mask")agg.raw_pmr=Math.max(agg.raw_pmr,m.pmr);
      if(pyKey==="open_mask")agg.open_pmr=Math.max(agg.open_pmr,m.pmr);
      if(pyKey==="clean_mask"){agg.clean_iou=Math.min(agg.clean_iou,m.iou);agg.clean_pmr=Math.max(agg.clean_pmr,m.pmr)}
    }
    // separação das famílias (máscara entregue ao usuário)
    const pm=fromIndices(p.final_mask||p.clean_mask,n);pyClean[cls]=pm;
    {const m=maskCompare(jsMasks[cls],pm);row.stages.final_mask={iou:round(m.iou),pmr:round(m.pmr,8),js:m.js,py:m.py};bump(cls,"final_mask","iou",m.iou,Math.min);bump(cls,"final_mask","pmr",m.pmr,Math.max);agg.clean_iou=Math.min(agg.clean_iou,m.iou);agg.clean_pmr=Math.max(agg.clean_pmr,m.pmr)}
    const cc={js:components(jsMasks[cls],w,h),py:components(pm,w,h)};row.cc=cc;agg.dcc+=Math.abs(cc.js-cc.py);
    // registros vetorizados de cada motor (sobre a sua própria máscara final)
    const jsRec=__cdmTest.recordsFromMask(jsMasks[cls],w,h,cls,"t1_current",cfg),pyRec=p.records;
    row.records={js:jsRec.length,py:pyRec.length};
    const sum=(rows,k)=>rows.reduce((s,r)=>s+(r[k]||0),0);
    const pairs=[["count",jsRec.length,pyRec.length],["area_px2",sum(jsRec,"area_px2"),sum(pyRec,"area")]];
    if(cls==="cracks")pairs.push(["length_px",sum(jsRec,"length_px"),sum(pyRec,"length")],["width_mean_px",jsRec.length?sum(jsRec,"width_px")/jsRec.length:0,pyRec.length?sum(pyRec,"width")/pyRec.length:0]);
    for(const[metric,js,pv]of pairs){measures.push({case:c.name,class:cls,metric,py:round(pv,4),js:round(js,4)});if(pv||js)agg.measure_rel=Math.max(agg.measure_rel,relErr(js,pv))}
    const jm=jsMasks[cls];out.diff[cls]={both:runs(i=>pm[i]&&jm[i],n),py_only:runs(i=>pm[i]&&!jm[i],n),js_only:runs(i=>jm[i]&&!pm[i],n)};
    out.classes[cls]=row;
  }
  // esqueleto podado das fissuras
  const jsSkel=__cdmTest.crackSkeleton(jsMasks.cracks,w,h,cfg).skel,pySkel=fromIndices(py.crack_skeleton,n);
  const sk=maskCompare(jsSkel,pySkel),nj=skeletonNodes(jsSkel,w,h),np=skeletonNodes(pySkel,w,h);
  out.skeleton={iou:round(sk.iou),pmr:round(sk.pmr,8),js:nj,py:np};
  bump("cracks","skeleton","iou",sk.iou,Math.min);bump("cracks","skeleton","pmr",sk.pmr,Math.max);
  agg.skeleton_nodes=Math.max(agg.skeleton_nodes,Math.abs(nj.ends-np.ends)+Math.abs(nj.branches-np.branches));
  if(np.len||nj.len)agg.skeleton_rel=Math.max(agg.skeleton_rel,relErr(nj.len,np.len));
  // matriz de confusão por pixel (classe dominante)
  addConfusion(confusion,pyClean,jsMasks,n);
  out.thumb=thumbnail(trace.gray,w,h);
  cases.push(out);
}

const tolerances=[
  {id:"gray_linf",label:"Conversão para cinza (L∞)",value:agg.gray_linf,limit:TOL.gray_linf,unit:"níveis",rule:"≤",pass:agg.gray_linf<=TOL.gray_linf},
  {id:"response_linf",label:"Resposta morfológica (L∞)",value:agg.response_linf,limit:TOL.response_linf,unit:"níveis",rule:"≤",pass:agg.response_linf<=TOL.response_linf},
  {id:"raw_pmr",label:"Máscara candidata (PMR)",value:agg.raw_pmr,limit:TOL.raw_pmr,unit:"%",rule:"≤",pass:agg.raw_pmr<=TOL.raw_pmr},
  {id:"open_pmr",label:"Abertura / reconstrução (PMR)",value:agg.open_pmr,limit:TOL.open_pmr,unit:"%",rule:"=",pass:agg.open_pmr<=TOL.open_pmr},
  {id:"clean_iou",label:"Máscaras limpa e final (IoU cruzado)",value:agg.clean_iou,limit:TOL.clean_iou,unit:"",rule:"≥",pass:agg.clean_iou>=TOL.clean_iou},
  {id:"dcc",label:"Componentes conectados (Σ|ΔCC|)",value:agg.dcc,limit:TOL.dcc,unit:"",rule:"=",pass:agg.dcc<=TOL.dcc},
  {id:"skeleton_nodes",label:"Esqueleto: extremidades + bifurcações (Δ)",value:agg.skeleton_nodes,limit:TOL.skeleton_nodes,unit:"",rule:"=",pass:agg.skeleton_nodes<=TOL.skeleton_nodes},
  {id:"measure_rel",label:"Medidas físicas (erro relativo máx.)",value:agg.measure_rel,limit:TOL.measure_rel,unit:"%",rule:"≤",pass:agg.measure_rel<=TOL.measure_rel},
];
const failed=tolerances.filter(t=>!t.pass);
const status=!failed.length?"pass":agg.clean_iou>=.995&&agg.measure_rel<=.05?"warn":"fail";
const git=cmd=>{try{return execSync(cmd,{stdio:["ignore","pipe","ignore"]}).toString().trim()}catch{return null}};
const report={
  schema:"cdm_parity_report_v1",
  generated_at:new Date().toISOString(),
  commit:process.env.PARITY_COMMIT||git("git rev-parse HEAD"),
  branch:process.env.PARITY_BRANCH||git("git rev-parse --abbrev-ref HEAD"),
  runtimes:{python:input.python,node:process.version,javascript:"frontend/src/cdmBrowser.js"},
  config:cfg,classes:CLASSES,
  stages:[["gray","Cinza"],["response","Resposta"],["raw_mask","Candidata"],["open_mask","Abertura"],["clean_mask","Limpeza"],["final_mask","Separação"],["skeleton","Esqueleto"]],
  status,tolerances,
  summary:{cases:cases.length,pixels:cases.reduce((s,c)=>s+c.width*c.height,0),...Object.fromEntries(Object.entries(agg).map(([k,v])=>[k,round(v,8)]))},
  cascade:Object.fromEntries(Object.entries(cascade).map(([cls,st])=>[cls,Object.fromEntries(Object.entries(st).map(([k,v])=>[k,{iou:round(v.iou??1,8),pmr:round(v.pmr??0,10),linf:v.linf==null?null:round(v.linf,6)}]))])),
  measures,
  confusion:{mode:"multilabel",labels:[...CLASSES,"background"],matrix:confusion.map(r=>r.slice(0,-1)),row_totals:confusion.map(r=>r.at(-1)),overlaps:Object.fromEntries(CLASSES.map((c,a)=>[c,Object.fromEntries(CLASSES.filter((_,b)=>b!==a&&confusion[a][b]>0).map(d=>[d,confusion[a][CLASSES.indexOf(d)]]))]))},
  cases,
};
fs.mkdirSync(path.dirname(outPath),{recursive:true});
fs.writeFileSync(outPath,JSON.stringify(report));
console.log(`CDM parity report: ${status.toUpperCase()} · ${cases.length} cases · IoU min ${agg.clean_iou.toFixed(6)} · PMR máx ${(agg.clean_pmr*100).toFixed(4)}% · ${(fs.statSync(outPath).size/1024).toFixed(0)} KB → ${outPath}`);
for(const t of tolerances)console.log(`${t.pass?"✓":"✗"} ${t.label}: ${t.value} (${t.rule} ${t.limit})`);
