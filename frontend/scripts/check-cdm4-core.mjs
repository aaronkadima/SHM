// CDM-4 · núcleo de imagem 2D: contrato, determinismo, CDM-1 intacto e cada etapa nova isolada.
import assert from "node:assert/strict";
import {__cdmTest,cdmConfig} from "../src/cdmBrowser.js";
import {__cdm4Test,cdm4Config} from "../src/cdm4Core.js";
import {neutralizeEnclosedTerrain,neutralizeDominantTerrain,overexposedSky} from "../src/cdm4Scene.js";
import {randomWalkerProbability,randomWalkerSpalling} from "../src/cdm4RandomWalker.js";
import {linearRebar} from "../src/cdm4Rebar.js";
import {pigmentMaps,maskComposition} from "../src/cdm4Pigments.js";

// gerador determinístico
let seed=12345;const rnd=()=>{seed=(seed*1103515245+12345)>>>0;return seed/4294967296};
function concrete(w,h,base=[168,166,160],noise=14){
  const data=new Uint8ClampedArray(w*h*4);
  for(let i=0;i<w*h;i++){const n=(rnd()-.5)*noise;data[4*i]=base[0]+n;data[4*i+1]=base[1]+n;data[4*i+2]=base[2]+n;data[4*i+3]=255}
  return data;
}
const put=(d,w,x,y,c)=>{const i=4*(y*w+x);d[i]=c[0];d[i+1]=c[1];d[i+2]=c[2]};

// ---------- F1 / F4 ----------
{
  const w=10,h=8,names={0:"wall",1:"earth",2:"sky"},cls=new Uint8Array(w*h),mask=new Uint8Array(w*h);
  for(let y=3;y<5;y++)for(let x=3;x<6;x++){cls[y*w+x]=1;mask[y*w+x]=1}     // terreno cercado pela parede
  for(let x=0;x<w;x++){cls[x]=1;mask[x]=1}                                     // terreno na borda
  const r=neutralizeEnclosedTerrain({w,h,cls,names,mask});
  assert.equal(r.mask[4*w+4],0,"terreno cercado pela estrutura vira neutro");
  assert.equal(r.mask[2],1,"terreno ligado à borda continua excluído");
  assert.equal(mask[4*w+4],1,"a máscara original não é alterada");
  const dom=new Uint8Array(w*h).fill(1),domMask=new Uint8Array(w*h).fill(1);for(let i=0;i<20;i++)dom[i]=0;
  const f5=neutralizeDominantTerrain({w,h,cls:dom,names,mask:domMask});
  assert.equal(f5.applied,true,"terreno dominante (close-up) vira neutro");assert.equal(f5.mask[w*h-1],0);
  assert.equal(neutralizeDominantTerrain({w,h,cls,names,mask}).applied,false,"terreno minoritário segue a regra normal");
  const W=20,H=12,img=concrete(W,H);
  for(let y=0;y<3;y++)for(let x=0;x<W;x++)put(img,W,x,y,[252,252,252]);      // céu estourado no topo
  for(let y=7;y<9;y++)for(let x=8;x<11;x++)put(img,W,x,y,[252,252,252]);     // reflexo no meio
  const s=overexposedSky(img,W,H);
  assert.equal(s.mask[W+5],1,"céu superexposto ligado à borda é excluído");
  assert.equal(s.mask[8*W+9],0,"reflexo isolado no meio da peça não é céu");
}

// ---------- random walker ----------
{
  const w=120,h=80,img=concrete(w,h),site=new Uint8Array(w*h),truth=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const dx=(x-60)/30,dy=(y-40)/20;if(dx*dx+dy*dy<1){truth[y*w+x]=1;const v=70+rnd()*30;put(img,w,x,y,[v,v-2,v-6])}}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const dx=(x-60)/15,dy=(y-40)/10;if(dx*dx+dy*dy<1)site[y*w+x]=1}  // núcleo pequeno
  // integrada = candidata morfológica mais larga e com folga (o polo saudável fica fora dela + 10 px)
  const integrated=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const dx=(x-60)/36,dy=(y-40)/26;if(dx*dx+dy*dy<1)integrated[y*w+x]=1}
  const P=randomWalkerProbability(img,w,h,{site,integrated});
  assert.ok(P.converged,"CG converge");
  const r=randomWalkerSpalling(img,w,h,{site,integrated});
  let tp=0,fp=0,fn=0;for(let i=0;i<w*h;i++){if(r.mask[i]&&truth[i])tp++;else if(r.mask[i])fp++;else if(truth[i])fn++}
  assert.ok(tp/(tp+fp+fn)>.8,"random walker expande o núcleo até a borda real (IoU "+(tp/(tp+fp+fn)).toFixed(2)+")");
  const again=randomWalkerSpalling(img,w,h,{site,integrated});
  assert.deepEqual(again.mask,r.mask,"random walker é determinístico");
  assert.equal(randomWalkerSpalling(img,w,h,{site:new Uint8Array(w*h)}).mask,null,"sem núcleo de dano, não há polo");
}

// ---------- armadura linear ----------
{
  const w=200,h=140,gray=new Float32Array(w*h).fill(120),sp=new Uint8Array(w*h);
  for(let y=20;y<120;y++)for(let x=20;x<180;x++){sp[y*w+x]=1;gray[y*w+x]=100+(((x*7+y*13)%17)-8)}
  for(let x=30;x<170;x++)for(let y=68;y<73;y++)gray[y*w+x]=20;                 // barra longa e escura
  for(let y=30;y<44;y++)for(let x=40;x<54;x++)gray[y*w+x]=20;                  // mancha escura compacta
  const bh=__cdm4Test.blackhat(gray,w,h,21);
  const r=linearRebar(gray,bh,w,h,sp,{});
  assert.equal(r.log.bars,1,"uma barra");
  assert.equal(r.mask[70*w+100],1,"barra detectada");
  assert.equal(r.mask[37*w+47],0,"mancha compacta não é barra");
  assert.equal(linearRebar(gray,bh,w,h,new Uint8Array(w*h),{}).log.applied,false,"sem desplacamento, sem armadura");
}

// ---------- pigmentos ----------
{
  const w=60,h=40,img=concrete(w,h,[150,150,150],4),rust=new Uint8Array(w*h),shadow=new Uint8Array(w*h);
  for(let y=5;y<20;y++)for(let x=5;x<25;x++){put(img,w,x,y,[150,85,45]);rust[y*w+x]=1}
  for(let y=5;y<20;y++)for(let x=35;x<55;x++){put(img,w,x,y,[90,90,90]);shadow[y*w+x]=1}
  const any=new Uint8Array(w*h);for(let i=0;i<w*h;i++)any[i]=rust[i]|shadow[i];
  const maps=pigmentMaps(img,w,h,any,{smoothK:1});
  const cr=maskComposition(maps,rust),cs=maskComposition(maps,shadow);
  assert.ok(cr.rust_mean>.5&&cr.rust_fraction>.9,"mancha de óxido de ferro → canal ferrugem");
  assert.ok(Math.abs(cs.rust_mean)<.05&&cs.neutral_mean>.2,"sombra cinza → canal neutro, sem ferrugem");
  assert.deepEqual(maps.I0,[150,150,150],"I₀ = concreto saudável da foto");
}

// ---------- núcleo completo ----------
function scene(){
  seed=777;const w=260,h=200,data=concrete(w,h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const dx=(x-130)/70,dy=(y-100)/45;
    if(dx*dx+dy*dy<1){const v=55+rnd()*45;put(data,w,x,y,[v,v-3,v-8])}       // desplacamento áspero
  }
  for(let x=75;x<185;x++)for(let y=98;y<103;y++)put(data,w,x,y,[22,20,18]);   // barra
  for(let y=20;y<45;y++)for(let x=20;x<55;x++)put(data,w,x,y,[170,90,50]);     // corrosão
  return{width:w,height:h,data};
}
const a=__cdm4Test.computeCdm4Core(scene(),null,cdm4Config({cdm4_return_masks:true}));
const b=__cdm4Test.computeCdm4Core(scene(),null,cdm4Config({cdm4_return_masks:true}));
assert.deepEqual(a.records,b.records,"CDM-4 é determinístico");
assert.equal(a.protocol.version,"cdm_4_v3.0.0");
assert.ok(a.protocol.stages.includes("random_walker")&&a.protocol.stages.includes("linear_rebar"));
for(const k of ["diversity","biodiversity","random_walker","linear_rebar"])assert.ok(a.refinement[k],"etapa registrada: "+k);
assert.ok(a.records.some(r=>r.class==="spalling_dark"),"desplacamento detectado");
assert.ok(a.records.some(r=>r.class==="exposed_rebar"),"armadura detectada pela abertura linear");
assert.ok(a.records.some(r=>r.class==="corrosion_rust"),"corrosão detectada");
const cor=a.records.find(r=>r.class==="corrosion_rust"),spr=a.records.find(r=>r.class==="spalling_dark");
assert.ok(cor.pigments&&spr.pigments&&cor.pigments.rust_mean>spr.pigments.rust_mean,"pigmentos: corrosão tem mais óxido de ferro que o desplacamento");
assert.equal(a.pigments.role,"diagnostic");
assert.ok(!a.masks_final.cracks.some((v,i)=>v&&a.masks_final.corrosion_rust[i]),"corrosão nunca é fissura");

// Etapas: dados intermediários para o módulo de Etapas (potencial do random walker, pigmentos)
{const cfg=cdm4Config({});cfg.returnStages=true;const st=__cdm4Test.computeCdm4Core(scene(),null,cfg).stages;
 assert.ok(st.morphology&&st.integrated&&st.final,"máscaras por etapa");
 assert.ok(st.random_walker?.prob?.length===st.random_walker.W*st.random_walker.H,"potencial do random walker");
 assert.ok(st.pigments?.rust?.length===st.pigments.W*st.pigments.H,"mapas de pigmento");}

// t0 → t1: a imagem anterior passa pelas mesmas etapas; mesma imagem ⇒ sem crescimento
const t=__cdm4Test.computeCdm4Core(scene(),scene(),cdm4Config({}));
assert.equal(t.temporal.enabled,true);
assert.equal(t.temporal.records.filter(r=>r.class==="growth").length,0,"t0 = t1 ⇒ nenhum crescimento");

// Com todas as etapas novas desligadas (e sem contexto), o CDM-4 reproduz exatamente o CDM-1 (núcleo copiado).
const OFF={cdm4_context_f1:false,cdm4_context_sky:false,cdm4_diversity:false,cdm4_biodiversity:false,cdm4_random_walker:false,cdm4_linear_rebar:false,cdm4_pigments:false};
const c3=__cdm4Test.computeCdm4Core(scene(),null,cdm4Config(OFF)),c1=__cdmTest.computeCdmCore(scene(),null,cdmConfig({}));
assert.deepEqual(c3.records,c1.records,"etapas desligadas ⇒ registros idênticos ao CDM-1");
assert.deepEqual(c3.summary,c1.summary,"etapas desligadas ⇒ classificação idêntica ao CDM-1");

console.log("CDM-4 core passed:",{records:a.records.length,classes:[...new Set(a.records.map(r=>r.class))],random_walker:a.refinement.random_walker,linear_rebar:a.refinement.linear_rebar});
