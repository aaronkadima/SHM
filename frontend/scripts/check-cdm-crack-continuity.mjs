// CDM 2.9: a fissura deve manter a forma e a continuidade da máscara candidata (etapa 4):
// um único registro por fissura, polilinha que acompanha a curva (com ramificação) e
// pontilhado isolado descartado. Pipeline completo: detectMasks → recordsFromMask.
import assert from "node:assert/strict";
import {__cdmTest as T} from "../src/cdmBrowser.js";

const w=640,h=480,data=new Uint8ClampedArray(w*h*4);
let seed=9;const rnd=()=>((seed=Math.imul(seed,1103515245)+12345>>>0)/4294967296);
const base=(x,y)=>110+60*(x/w)+30*(y/h)+(rnd()-.5)*10;
for(let y=0;y<h;y++)for(let x=0;x<w;x++){const v=base(x,y),i=(y*w+x)*4;data[i]=data[i+1]=data[i+2]=v;data[i+3]=255}
const dark=(x,y,r)=>{for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const xx=Math.round(x+dx),yy=Math.round(y+dy);if(xx<0||yy<0||xx>=w||yy>=h)continue;const i=(yy*w+xx)*4;data[i]=data[i+1]=data[i+2]=25}};
// fissura principal: senoide vertical, largura 1–3 px, duas lacunas de 3 px
let trueLength=0,prev=null;
for(let y=30;y<450;y+=.5){
  const x=300+40*Math.sin(y/60);
  if((y>150&&y<153)||(y>300&&y<303)){prev=null;continue}
  const r=y%120<40?0:1;dark(x,y,r);
  if(prev)trueLength+=Math.hypot(x-prev[0],y-prev[1]);prev=[x,y];
}
// ramificação a partir de y=220
const by=220,bx=300+40*Math.sin(by/60);for(let t=0;t<90;t+=.5)dark(bx+t*.9,by+t*.6,0);
// pontilhado isolado (deve ser descartado)
for(let k=0;k<60;k++)dark(40+rnd()*560,20+rnd()*440,0);

const cfg={threshold:35,kernel:15,minArea:30,minAspect:2};
const masks=T.detectMasks({width:w,height:h,data},cfg);
const recs=T.recordsFromMask(masks.cracks,w,h,"cracks","t1",cfg);
const main=recs.sort((a,b)=>b.length_px-a.length_px)[0];
assert.ok(main,"nenhuma fissura detectada");
const inMain=recs.filter(r=>r.bbox[0]<400&&r.bbox[0]+r.bbox[2]>200);
assert.equal(inMain.length,1,"a fissura principal deve ser um único registro (fragmentos unidos): "+inMain.length);
assert.ok(main.points.length>=25,"polilinha deve acompanhar a curva: "+main.points.length+" pontos");
const branchLength=90*Math.hypot(.9,.6),expected=trueLength+branchLength;
assert.ok(Math.abs(main.length_px-expected)/expected<.10,"comprimento "+main.length_px.toFixed(0)+" vs real "+expected.toFixed(0)+" (erro > 10%)");
const reachesBranch=main.points.some(([x,y])=>Math.hypot(x-(bx+80),y-(by+53))<12);
assert.ok(reachesBranch,"a polilinha deve percorrer a ramificação");
// a curva: pontos devem seguir a senoide (erro lateral médio pequeno)
const err=main.points.filter(([,y])=>y>30&&y<450&&!(y>205&&y<280)).map(([x,y])=>Math.abs(x-(300+40*Math.sin(y/60))));
assert.ok(err.reduce((a,b)=>a+b,0)/err.length<3,"polilinha afastada da fissura: "+(err.reduce((a,b)=>a+b,0)/err.length).toFixed(2)+" px");
assert.ok(recs.length<=3,"pontilhado isolado não pode virar fissura: "+recs.length+" registros");
console.log("CDM_CRACK_CONTINUITY_PASS",{records:recs.length,points:main.points.length,length:Math.round(main.length_px),true_length:Math.round(expected),width:+main.width_px.toFixed(2)});
