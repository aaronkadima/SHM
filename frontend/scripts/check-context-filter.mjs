// Filtro de contexto IA do CDM: grupos ADE20K, exclusão por classe, abstenção e descarte de
// componentes (pós-morfologia). Usa um "modelo" falso com a mesma interface do ONNX Runtime.
import assert from "node:assert/strict";
import {contextOptionsFrom,contextGroups,exclusionFromClasses,gateMask,gateMasks,runContextModel} from "../src/contextFilter.js";
import {__cdmTest} from "../src/cdmBrowser.js";

const labels={0:"wall",1:"building",2:"sky",3:"floor",4:"tree",12:"person",20:"car",42:"column",43:"signboard",61:"bridge",93:"pole",34:"rock",27:"mirror"};
const {group}=contextGroups(labels);
assert.equal(group[0],1);assert.equal(group[61],1);assert.equal(group[42],1);
assert.equal(group[2],2);assert.equal(group[4],2);assert.equal(group[43],2);assert.equal(group[93],2);
assert.equal(group[27],0,"classe não listada é neutra");

// Mapa 8×4: metade esquerda parede (0), direita céu (2), um pixel neutro (27).
const mw=8,mh=4,cls=new Uint8Array(mw*mh),conf=new Float32Array(mw*mh).fill(.9);
for(let y=0;y<mh;y++)for(let x=0;x<mw;x++)cls[y*mw+x]=x<4?0:2;
cls[0]=27;
const cons=exclusionFromClasses({cls,conf,w:mw,h:mh},labels,"conservative");
assert.equal(cons.excluded_ratio,.5);assert.equal(cons.abstained,false);
const strict=exclusionFromClasses({cls,conf,w:mw,h:mh},labels,"strict");
assert.ok(strict.excluded_ratio>cons.excluded_ratio,"estrito também exclui classes neutras");
const lowConf=exclusionFromClasses({cls,conf:new Float32Array(mw*mh).fill(.2),w:mw,h:mh},labels,"conservative");
assert.equal(lowConf.excluded_ratio,0,"pixels de baixa confiança não excluem");
const allSky=exclusionFromClasses({cls:new Uint8Array(mw*mh).fill(2),conf,w:mw,h:mh},labels,"conservative");
assert.equal(allSky.abstained,true,"cena inteira irrelevante → abstenção");

// Máscara 80×40 com dois componentes: um na metade parede (mantido), outro na metade céu (removido).
const w=80,h=40,m=new Uint8Array(w*h);
for(let x=5;x<30;x++)m[20*w+x]=1;
for(let x=50;x<75;x++)m[10*w+x]=1;
const g=gateMask(m,w,h,cons);
assert.equal(g.removed,1);assert.equal(g.kept,1);
assert.equal(g.mask[20*w+10],1);assert.equal(g.mask[10*w+60],0);
// Componente que cruza a divisa (metade em cada lado) fica: fração 50% < 60%.
const cross=new Uint8Array(w*h);for(let x=20;x<60;x++)cross[30*w+x]=1;
assert.equal(gateMask(cross,w,h,cons).removed,0);
assert.equal(gateMask(cross,w,h,cons,{share:.4}).removed,1);
// Abstenção não altera nada.
assert.deepEqual(gateMask(m,w,h,allSky).mask,m);
const gm=gateMasks({cracks:m,spalling_dark:cross},w,h,cons);
assert.equal(gm.removed_total,1);assert.equal(gm.removed.cracks,1);assert.equal(gm.removed.spalling_dark,0);

// Núcleo CDM com exclusão: a corrosão "pintada" sobre o céu some, a da parede permanece.
const W=240,H=120,data=new Uint8ClampedArray(W*H*4);
let seed=3;const rnd=()=>((seed=Math.imul(seed,1103515245)+12345>>>0)/4294967296);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4,v=150+Math.round((rnd()-.5)*20);data[i]=v;data[i+1]=v;data[i+2]=v;data[i+3]=255}
const rust=(cx,cy)=>{for(let y=cy-12;y<cy+12;y++)for(let x=cx-16;x<cx+16;x++){const i=(y*W+x)*4;data[i]=165;data[i+1]=82;data[i+2]=40}};
rust(50,60);rust(190,60);
const img={width:W,height:H,data};
const base=__cdmTest.computeCdmCore({...img,data:new Uint8ClampedArray(data)},null,{threshold:35,kernel:15,minArea:30,minAspect:2});
const count=r=>r.records.filter(x=>x.class==="corrosion_rust").length;
assert.equal(count(base),2,"sem filtro: duas manchas de corrosão");
const filtered=__cdmTest.computeCdmCore({...img,data:new Uint8ClampedArray(data)},null,{threshold:35,kernel:15,minArea:30,minAspect:2,context:{mask:cons.mask,w:mw,h:mh,abstained:false},contextShare:.6});
assert.equal(count(filtered),1,"com filtro: só a mancha sobre a estrutura");
assert.ok(filtered.records.find(x=>x.class==="corrosion_rust").bbox[0]<W/2);
assert.equal(filtered.context_filter.applied,true);assert.equal(filtered.context_filter.removed.corrosion_rust,1);
// Achados mantidos e descartados recebem o nome da cena sob eles.
const keptRust=filtered.records.find(x=>x.class==="corrosion_rust");
const consFull=exclusionFromClasses({cls,conf,w:mw,h:mh},labels,"conservative");
const filtered2=__cdmTest.computeCdmCore({...img,data:new Uint8ClampedArray(data)},null,{threshold:35,kernel:15,minArea:30,minAspect:2,context:{mask:consFull.mask,cls:consFull.cls,names:consFull.names,w:mw,h:mh,abstained:false},contextShare:.6});
const k2=filtered2.records.find(x=>x.class==="corrosion_rust");
assert.equal(k2.scene.label,"wall");assert.equal(k2.scene.label_pt,"parede");
assert.equal(filtered2.context_discarded.length,1);
const disc=filtered2.context_discarded[0];
assert.equal(disc.code,"IA1");assert.equal(disc.class,"corrosion_rust");assert.equal(disc.scene.label_pt,"céu");assert.ok(disc.scene.irrelevant_share>=.6);
assert.ok(keptRust);

// Interface de inferência: modelo falso (logits) → mapa de classes com stride 4.
const fake={ort:{Tensor:class{constructor(t,d,dims){this.type=t;this.data=d;this.dims=dims}}},manifest:{inputs:[{name:"pixel_values"}],outputs:[{name:"logits"}],preprocess:{}},
  session:{inputNames:["pixel_values"],outputNames:["logits"],async run(feed){
    const[,,th,tw]=feed.pixel_values.dims,oh=th/4,ow=tw/4,C=3,out=new Float32Array(C*oh*ow);
    for(let y=0;y<oh;y++)for(let x=0;x<ow;x++)out[(x<ow/2?0:2)*oh*ow+y*ow+x]=5;
    return{logits:{data:out,dims:[1,C,oh,ow]}};
  }}};
const map=await runContextModel(fake,img,{inputSide:256});
assert.equal(map.input[0]%32,0);assert.equal(map.input[1]%32,0);
assert.equal(map.w,map.input[0]/4);assert.equal(map.cls[0],0);assert.equal(map.cls[map.w-1],2);
assert.ok(map.conf[0]>.9);

// Opções configuráveis: listas próprias, confiança mínima e abstenção desligável.
const co=contextOptionsFrom({cdm_context_exclude:["wall"],cdm_context_min_confidence:.8,cdm_context_abstain:false,cdm_context_input:999,cdm_context_live_every:0});
assert.deepEqual(co.exclude,["wall"]);assert.equal(co.minConfidence,.8);assert.equal(co.abstain,false);assert.equal(co.inputSide,512);assert.equal(co.liveEvery,1);
const custom=exclusionFromClasses({cls,conf,w:mw,h:mh},labels,"conservative",.35,{exclude:["wall"],structure:["bridge"]});
assert.ok(custom.mask[1]===1&&custom.mask[5]===0,"lista própria: parede vira irrelevante, céu não");
const noAbstain=exclusionFromClasses({cls:new Uint8Array(mw*mh).fill(2),conf,w:mw,h:mh},labels,"conservative",.35,{abstain:false});
assert.equal(noAbstain.abstained,false);
const strictConf=exclusionFromClasses({cls,conf,w:mw,h:mh},labels,"conservative",.95);
assert.equal(strictConf.excluded_ratio,0,"confiança 0,9 < 0,95 → nada excluído");
// Recorte por pixel: duas manchas ligadas por uma ponte sobre região irrelevante viram dois componentes.
{
  const W2=240,H2=40,m=new Uint8Array(W2*H2);
  for(let y=5;y<35;y++)for(let x=10;x<70;x++)m[y*W2+x]=1;
  for(let y=5;y<35;y++)for(let x=170;x<230;x++)m[y*W2+x]=1;
  for(let y=18;y<22;y++)for(let x=70;x<170;x++)m[y*W2+x]=1;// ponte
  const ex=new Uint8Array(24*4);for(let y=0;y<4;y++)for(let x=8;x<16;x++)ex[y*24+x]=1;// faixa irrelevante x≈80–160
  const ctx={mask:ex,w:24,h:4};
  const recs=m2=>__cdmTest.recordsFromMask(m2,W2,H2,"spalling_dark","t1",{minArea:4,minAspect:2});
  assert.equal(recs(m).length,1,"sem recorte: um componente");
  const cl=__cdmTest.clipMasksByContext({spalling_dark:m,cracks:new Uint8Array(W2*H2)},W2,H2,ctx,false);
  assert.equal(recs(cl.masks.spalling_dark).length,2,"com recorte: dois componentes");
  assert.ok(cl.clipped.spalling_dark>0&&!(cl.clipped.cracks>0));
  // a erosão da exclusão preserva a borda das manchas (nenhum pixel das manchas é cortado)
  let kept=0;for(let y=5;y<35;y++)for(let x=10;x<70;x++)kept+=cl.masks.spalling_dark[y*W2+x];assert.ok(kept>=60*30*.97);
}
// Contorno real (não convexo): um "L" tem polígono com área bem menor que a do fecho convexo.
{
  const W2=40,H2=40,m=new Uint8Array(W2*H2);
  for(let y=5;y<35;y++)for(let x=5;x<12;x++)m[y*W2+x]=1;for(let y=28;y<35;y++)for(let x=5;x<35;x++)m[y*W2+x]=1;
  const r=__cdmTest.recordsFromMask(m,W2,H2,"spalling_dark","t1",{minArea:4,minAspect:2})[0];
  let a=0;for(let i=0,j=r.points.length-1;i<r.points.length;j=i++)a+=(r.points[j][0]+r.points[i][0])*(r.points[j][1]-r.points[i][1]);a=Math.abs(a/2);
  assert.ok(a<1.3*r.area_px2,"polígono acompanha o L ("+a.toFixed(0)+" vs "+r.area_px2+" px²)");
}
console.log("Context filter passed: pixel clipping by context, concave contours, options (lists, confidence, abstain), ADE20K groups, conservative/strict/abstain, post-morphology component gating and CDM core integration.");
