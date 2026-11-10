// Contrato do modo Live: motores clássicos rodam sem DOM (Web Worker) e detectam
// uma fissura sintética; a lista de motores Live coincide com o catálogo.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {LIVE_ENGINE_IDS,liveInputSpec,runLiveEngine} from "../src/liveEngines.js";

const catalog=JSON.parse(readFileSync(new URL("../src/engines.json",import.meta.url),"utf8"));
const liveCatalog=catalog.engines.filter(e=>e.live_ready).map(e=>e.id).sort();
assert.deepEqual([...LIVE_ENGINE_IDS].sort(),liveCatalog,"liveEngines.js e engines.json divergem");

// Concreto com gradiente de iluminação (faixa dinâmica realista), textura leve e fissura diagonal de 3 px.
// Obs.: superfícies de contraste muito baixo saturam o stretch p2–p98 do CDM-1 (ver relatório de vistoria).
const w=480,h=270,data=new Uint8ClampedArray(w*h*4);
let seed=7;const rnd=()=>((seed=Math.imul(seed,1103515245)+12345>>>0)/4294967296);
for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=(y*w+x)*4,base=Math.round(95+120*(x/w)*.6+60*(y/h)*.6+(rnd()-.5)*16);
  const onCrack=Math.abs((y-30)-(x-40)*.45)<1.6&&x>40&&x<440;
  const v=onCrack?Math.max(10,base-90):base;data[i]=v;data[i+1]=v;data[i+2]=v;data[i+3]=255;
}
const frame={width:w,height:h,data};

const cv=await runLiveEngine("opencv_crack",frame);
assert.equal(cv.layers.length,1);assert.equal(cv.layers[0].mask.length,w*h);
assert.ok(cv.counts["Fissura (candidato)"]>=1,"OpenCV Live deveria achar a fissura sintética");
for(const b of cv.boxes)for(const v of [b.x1,b.y1,b.x2,b.y2])assert.ok(v>=0&&v<=1,"caixa fora de [0,1]");

const cdm=await runLiveEngine("cdm_1",frame,{opts:{sourceMaxSide:1920}});
assert.equal(cdm.layers.length,5);
assert.ok(cdm.counts["Fissuras"]>=1&&cdm.counts["Fissuras"]<=4,"CDM-1 Live deveria achar a fissura sintética: "+JSON.stringify(cdm.counts));
assert.ok(cdm.metrics.cdm_live_cfg.kernel<15&&cdm.metrics.cdm_live_cfg.kernel%2===1,"kernel CDM deve ser escalado e ímpar");
const same=await runLiveEngine("cdm_1",frame,{opts:{sourceMaxSide:480}});
assert.equal(same.metrics.cdm_live_cfg.kernel,15,"sem redução de escala o kernel deve ser o configurado");

assert.deepEqual(liveInputSpec("yolov8n_public_crack_seg",{preprocess:{letterbox:{width:640,height:640}}}),{mode:"letterbox",width:640,height:640});
assert.deepEqual(liveInputSpec("segformer_public_crack",{preprocess:{resize:{height:512,width:512}}}),{mode:"resize",width:512,height:512});
assert.equal(liveInputSpec("cdm_1").mode,"maxSide");
await assert.rejects(()=>runLiveEngine("segformer_public_crack",frame,{}),/Sessão ONNX/);

console.log("LIVE_ENGINES_PASS",{opencv:cv.counts,cdm:cdm.counts,cdm_cfg:cdm.metrics.cdm_live_cfg});
