// CDM-4 · núcleo de imagem 2D: contrato, determinismo, CDM-1 intacto e cada etapa nova isolada.
import assert from "node:assert/strict";
import {__cdmTest,cdmConfig} from "../src/cdmBrowser.js";
import {__cdm4Test,cdm4Config} from "../src/cdm4Core.js";
import {neutralizeEnclosedTerrain,neutralizeDominantTerrain,overexposedSky} from "../src/cdm4Scene.js";
import {randomWalkerProbability,randomWalkerSpalling} from "../src/cdm4RandomWalker.js";
import {linearRebar} from "../src/cdm4Rebar.js";
import {pigmentMaps,maskComposition} from "../src/cdm4Pigments.js";
import {refineContourThresholds,symmetricBoundaryDistance} from "../src/cdm4Contour.js";
import {analyzeWalkerField,fieldIoU,refineWalkerFullRes} from "../src/cdm4FieldAnalysis.js";
import {cutBase,profile,otsu,interpretMaps,interpretProfile,interpretCurves} from "../src/cdm4CutAnalysis.js";

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

// ---------- afinamento do contorno ----------
{
  const W=80,H=60,prob=new Float32Array(W*H),L=new Float32Array(W*H),R=new Float32Array(W*H);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const d=Math.hypot((x-40)/20,(y-30)/14),i=y*W+x;prob[i]=Math.max(0,Math.min(1,1.4-d));const inside=d<1;L[i]=inside?-2:0;R[i]=inside?4:0}
  const a=new Uint8Array(W*H),b=new Uint8Array(W*H);for(let i=0;i<W*H;i++){a[i]=prob[i]>.3?1:0;b[i]=prob[i]>.3?1:0}
  assert.equal(symmetricBoundaryDistance(a,b,W,H),0,"fronteiras iguais ⇒ distância 0");
  const r1=refineContourThresholds(prob,W,H,[L,R],.2,{criterion:"fisher",maxDelta:.3}),r2=refineContourThresholds(prob,W,H,[L,R],.2,{criterion:"fisher",maxDelta:.3});
  assert.deepEqual(r1.log,r2.log,"loop de afinamento determinístico");
  // halo: limiar inicial 0,2 inclui concreto saudável; o loop sobe o limiar para perto da borda real (p = 0,4)
  assert.ok(r1.log[0].threshold>.3&&r1.log[0].threshold<.5,"limiar afinado perto da borda real: "+r1.log[0].threshold);
}

// ---------- ferramenta Campo do walker ----------
{
  const w=160,h=160,img=concrete(w,h),W=80,H=80,prob=new Float32Array(W*H);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){if(Math.hypot(x-80,y-80)<30){const v=70+((x*7+y*3)%20);put(img,w,x,y,[v,v-2,v-6])}}
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const d=Math.hypot(x-40,y-40);prob[y*W+x]=d<10?1:d>22?0:Math.max(0,Math.min(1,(22-d)/12))}
  const F=analyzeWalkerField(img,w,h,{prob,W,H,threshold:.5},{x:20,y:20,size:120});
  assert.equal(F.n,120);assert.ok(F.R>.7,"setas saem do polo de dano de forma ordenada (R = "+F.R.toFixed(2)+")");
  assert.equal(F.regions.length,1,"uma região dentro da seleção");
  assert.ok(Math.abs(F.regions[0].area_local_px-Math.PI*30*30)/(Math.PI*30*30)<.35,"walker em resolução cheia acompanha a borda real");
  const F2=analyzeWalkerField(img,w,h,{prob,W,H,threshold:.5},{x:20,y:20,size:120});
  assert.deepEqual(F2.regions,F.regions,"análise determinística");
  assert.equal(F.hist.length,36);
  // IoU: sem GT → concordância motor × cheia; com GT (disco real r = 30) → cheia não pior que o motor
  const A=fieldIoU(F);assert.equal(A.mode,"agreement");assert.ok(A.agreement>.5&&A.agreement<=1);
  const gt=new Uint8Array(F.n*F.n);for(let y=0;y<F.n;y++)for(let x=0;x<F.n;x++)if(Math.hypot(x+20-80,y+20-80)<30)gt[y*F.n+x]=1;
  const G=fieldIoU(F,gt);assert.equal(G.mode,"gt");assert.ok(G.full.iou>=G.engine.iou-.02,"resolução cheia acompanha o GT: "+G.full.iou.toFixed(3)+" vs "+G.engine.iou.toFixed(3));
  // opção do motor: walker em resolução cheia por região
  const m=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(Math.hypot(x-80,y-80)<36)m[y*w+x]=1;
  const R1=refineWalkerFullRes(img,w,h,{prob,W,H,threshold:.5},m),R2=refineWalkerFullRes(img,w,h,{prob,W,H,threshold:.5},m);
  assert.equal(R1.log.regions,1);assert.deepEqual(R1.mask,R2.mask,"resolução cheia determinística");
  let a=0;for(const v of R1.mask)a+=v;assert.ok(Math.abs(a-Math.PI*900)/(Math.PI*900)<.35,"máscara cheia segue a borda real ("+a+" px)");
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
assert.equal(a.protocol.version,"cdm4_image_v4.0.0");
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

// Fluxo por evidência (experimental): sem morfologia como base do desplacamento
{const cfg=cdm4Config({cdm4_flow:"evidence"});cfg.returnStages=true;
 const e1=__cdm4Test.computeCdm4Core(scene(),null,cfg),e2=__cdm4Test.computeCdm4Core(scene(),null,cdm4Config({cdm4_flow:"evidence"}));
 assert.deepEqual(e1.records,e2.records,"fluxo por evidência é determinístico");
 assert.equal(e1.protocol.flow,"evidence");assert.ok(e1.protocol.stages.includes("poles"));
 assert.ok(e1.records.some(r=>r.class==="spalling_dark"),"desplacamento pelo fluxo por evidência");
 assert.ok(e1.stages.evidence&&e1.stages.random_walker?.prob,"etapas do fluxo por evidência");}

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

// Corte de nível: disco escuro com polo (dano real) + mancha escura sem polo; potencial = disco suavizado
{
  const w=200,h=120,img=new Uint8ClampedArray(w*h*4),prob=new Float32Array(w*h),gt=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,r=Math.hypot(x-60,y-60),stain=Math.hypot(x-150,y-60)<15;
    const v=r<30||stain?60:170;img.set([v,v,v,255],4*i);prob[i]=1/(1+Math.exp((r-30)/1.5));gt[i]=r<30?1:0}
  const B=cutBase(img,w,h,{prob,W:w,H:h,threshold:.5},{gt,levels:[.3,.5]});
  assert.ok(B.otsu>.2&&B.otsu<.8,"otsu separa escuro/claro: "+B.otsu);
  assert.ok(B.global.walker.iou>.9,"walker segue o disco: "+B.global.walker.iou);
  assert.ok(B.global.bin.iou<B.global.walker.iou-.15,"binarização inclui a mancha sem polo");
  const P=profile(B,{x1:0,y1:60,x2:199,y2:60});
  assert.equal(P.notes.uCross,2);assert.equal(P.notes.poleless.length,1,"uma mancha sem polo na linha");
  assert.ok(P.notes.shiftMean>0&&P.notes.shiftMean<3,"borda íngreme entre os níveis: "+P.notes.shiftMean);
  const f=(v,n)=>v.toFixed(n),all=[...interpretMaps(B,f),...interpretProfile(P,f),...interpretCurves(B,f)];
  for(const[t,v]of all)for(const k of t.match(/\{(\w+)\}/g)||[])assert.ok(k.slice(1,-1) in v,"variável ausente "+k+" em: "+t);
  assert.ok(Math.abs(otsu(Float32Array.from([.1,.1,.1,.9,.9,.9]))-.5)<.45);
}
console.log("cut-level analysis ok");

// SVG com texto editável (mesma API do canvas) e encaixe Ctrl dos cortes
{
  const {withSvg,surface,SvgCanvas}=await import("../src/svgCanvas.js");
  const c=withSvg(()=>{const s=surface(200,100),x=s.getContext("2d");x.fillStyle="rgba(255,0,0,.5)";x.fillRect(0,0,10,10);
    x.save();x.translate(20,30);x.rotate(Math.PI/2);x.font="600 14px Inter,sans-serif";x.textAlign="center";x.textBaseline="middle";x.fillText("Área & <eixo>",0,0);x.restore();
    x.beginPath();x.rect(0,0,50,50);x.clip();x.setLineDash([3,4]);x.beginPath();x.arc(25,25,10,0,2*Math.PI);x.stroke();
    const g=x.createLinearGradient(0,0,100,0);g.addColorStop(0,"#000");g.addColorStop(1,"rgb(255,255,255)");x.fillStyle=g;x.fillRect(0,90,100,10);
    const inner=surface(10,10);inner.getContext("2d").fillText("dentro",1,8);x.drawImage(inner,100,0,20,20);return s});
  assert.ok(c instanceof SvgCanvas);const svg=c.toSVG("t");
  assert.match(svg,/<text [^>]*font-weight="600"[^>]*text-anchor="middle"[^>]*>Área &amp; &lt;eixo&gt;<\/text>/,"texto editável com escape");
  assert.match(svg,/fill="rgb\(255,0,0\)" fill-opacity="0.5"/);assert.match(svg,/<clipPath id="c\d+">/);assert.match(svg,/<linearGradient/);
  assert.match(svg,/stroke-dasharray="3 4"/);assert.match(svg,/>dentro<\/text>/);
  assert.equal((svg.match(/<g /g)||[]).length,(svg.match(/<\/g>/g)||[]).length,"grupos balanceados");
  assert.ok(!svg.includes("NaN"));
}
{
  // encaixe: 15° e passos de comprimento (lógica pura replicada do CutLevelTool)
  const snap=(s,p,step)=>{const a=Math.round(Math.atan2(p.y-s.y,p.x-s.x)/(Math.PI/12))*(Math.PI/12),L=Math.max(step,Math.round(Math.hypot(p.x-s.x,p.y-s.y)/step)*step);return{x:s.x+L*Math.cos(a),y:s.y+L*Math.sin(a),L,deg:a*180/Math.PI}};
  const r=snap({x:0,y:0},{x:97,y:-52},20);assert.equal(r.L,120);assert.equal(Math.round(r.deg),-30);
}
console.log("svg + snap ok");
