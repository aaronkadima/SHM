// Diagnóstico de qualidade e correção de imagem: detecta imagens que geram falsos positivos
// e verifica que a correção é determinística e melhora o diagnóstico.
import assert from "node:assert/strict";
import {analyzeImageData,assessImageQuality} from "../src/imageQuality.js";
import {applyCorrection,isNeutralCorrection,toneCurve,NEUTRAL_CORRECTION} from "../src/imageCorrection.js";

let seed=11;const rnd=()=>((seed=Math.imul(seed,1103515245)+12345>>>0)/4294967296);
function make(w,h,fn){const data=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const[r,g,b]=fn(x,y),i=(y*w+x)*4;data[i]=r;data[i+1]=g;data[i+2]=b;data[i+3]=255}return{width:w,height:h,data}}
// Boa: gradiente de iluminação, textura nítida e uma fissura.
const good=make(1024,768,(x,y)=>{const t=60+130*(x/1024)+40*(y/768)+(((x>>2)+(y>>2))%2?10:-10);const v=Math.abs((y-200)-(x-100)*.4)<2?t-80:t;return[v,v,v]});
// Ruim: superfície lisa de baixo contraste, escura, com ruído e dominante quente.
const bad=make(640,400,()=>{const v=40+(rnd()-.5)*44;return[v*1.4,v,v*.8]});

const qg=assessImageQuality(analyzeImageData(good));
const qb=assessImageQuality(analyzeImageData(bad));
assert.notEqual(qg.verdict,"bad","imagem boa não pode ser inadequada: "+JSON.stringify(qg.checks.filter(c=>c.status!=="ok")));
assert.equal(qb.verdict,"bad");
for(const id of ["dynamic_range","noise","color_cast","exposure"])assert.notEqual(qb.checks.find(c=>c.id===id).status,"ok",id+" deveria falhar");
assert.ok(qb.autoFix.whiteBalance&&qb.autoFix.exposure>0&&qb.autoFix.denoise>0,"correção automática incompleta");
assert.equal(qb.recapture,true,"ruído + baixo contraste deve recomendar refazer a foto");
assert.ok(!("contrast" in qb.autoFix)&&!("sCurve" in qb.autoFix),"com ruído a correção automática não pode aumentar contraste");

const fixed=applyCorrection(bad,qb.autoFix),sf=analyzeImageData(fixed),sb=analyzeImageData(bad);
assert.ok(Math.abs(sf.castRG-1)<Math.abs(sb.castRG-1),"balanço de branco não reduziu a dominante");
assert.ok(sf.mean>sb.mean+20,"exposição não subiu");
assert.ok(sf.noise<sb.noise*1.6,"ruído não pode explodir após correção");
assert.ok(assessImageQuality(sf).score>qb.score,"correção automática deve melhorar a nota");

assert.ok(isNeutralCorrection(NEUTRAL_CORRECTION));
const id=applyCorrection(good,NEUTRAL_CORRECTION);assert.deepEqual(id.data,good.data,"correção neutra deve ser identidade");
const r=applyCorrection(make(4,2,(x,y)=>[x*60,y*100,0]),{rotate:90});assert.equal(r.width,2);assert.equal(r.height,4);
const s=toneCurve({sCurve:60});assert.ok(s(.25)<.25&&s(.75)>.75&&Math.abs(s(.5)-.5)<1e-6,"curva S deve escurecer sombras e clarear realces");

console.log("IMAGE_QUALITY_PASS",{good:[qg.verdict,qg.score],bad:[qb.verdict,qb.score],afterFix:assessImageQuality(sf).score});
