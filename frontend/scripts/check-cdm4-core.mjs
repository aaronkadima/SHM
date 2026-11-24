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

// Live · filtros CDM-4: partida grossa → fina converge ao mesmo potencial da partida do zero
{
  const {solveWalker,RW_DEFAULTS}=await import("../src/cdm4RandomWalker.js");
  const {runCdm4FilterLive,liveWalker,LIVE_FILTERS}=await import("../src/cdm4Live.js");
  const w=160,h=120,img=new Uint8ClampedArray(w*h*4);let s=7;const rnd=()=>{s=(s*1103515245+12345)%2147483648;return s/2147483648};
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const inD=Math.hypot(x-60,y-60)<28,i=4*(y*w+x);const v=inD?70+120*rnd():150+8*rnd();img.set([v,inD?v*.9:v,inD?v*.8:v,255],i)}
  const st={},R={};for(const f of LIVE_FILTERS){R[f.id]=runCdm4FilterLive({width:w,height:h,data:img},{filter:f.id,threshold:.5,warm:true},st);assert.equal(R[f.id].rgba.length,R[f.id].w*R[f.id].h*4)}
  assert.ok(R.poles.metrics.damage_seed_px>0&&R.poles.metrics.healthy_seed_px>0,"polos no quadro sintético");
  assert.equal(R.final.metrics.regions,1,"um desplacamento no contorno ao vivo");
  assert.ok(R.final.metrics.area_frac>.10&&R.final.metrics.area_frac<.20,"área do disco real 12,8 %: "+R.final.metrics.area_frac);
  // mesma solução com e sem ponto de partida
  const X=[new Float32Array(w*h).map((_,i)=>(Math.hypot(i%w-60,((i/w)|0)-60)<28?80:160)+3*rnd()),new Float32Array(w*h),new Float32Array(w*h),new Float32Array(w*h)];
  const lab=new Int8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const r=Math.hypot(x-60,y-60);lab[y*w+x]=r<10?2:r>45?1:0}
  const a=solveWalker(X,w,h,lab,{...RW_DEFAULTS,tol:1e-6}),b=liveWalker({W:w,H:h,L:X[0],o1:X[1],o2:X[2],Hs:X[3]},lab,{opts:{tol:1e-6}});
  assert.ok(a.converged&&b.converged,"as duas soluções convergem");let dmax=0;for(let i=0;i<w*h;i++)dmax=Math.max(dmax,Math.abs(a.prob[i]-b.prob[i]));assert.ok(dmax<1e-3,"grossa→fina = solução direta (dif. "+dmax+")");
}
console.log("live filters ok");

// Largura de fissura por perfil perpendicular: fissuras sintéticas (faixa borrada por PSF σ = 1 px, inclinada 20°)
{
  const {crackWidth}=await import("../src/cdm4CrackWidth.js");
  const erf=z=>{const t=1/(1+.3275911*Math.abs(z)),y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-z*z);return z>=0?y:-y};
  const synth=Wd=>{const w=200,h=200,g=new Float32Array(w*h),a=20*Math.PI/180,nx=-Math.sin(a),ny=Math.cos(a);let s=3;const rnd=()=>{s=(s*1103515245+12345)%2147483648;return s/2147483648-.5};
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const d=(x-100)*nx+(y-100)*ny,frac=.5*(erf((d+Wd/2)/Math.SQRT2)-erf((d-Wd/2)/Math.SQRT2));g[y*w+x]=170-110*frac+4*rnd()}
    return{g,ax:{x1:100-60*Math.cos(a),y1:100-60*Math.sin(a),x2:100+60*Math.cos(a),y2:100+60*Math.sin(a)}}};
  for(const Wd of [5,8,12]){const S=synth(Wd),r=crackWidth(S.g,200,200,S.ax);assert.ok(Math.abs(r.summary.median-Wd)<.5,"fissura de "+Wd+" px medida "+r.summary.median);assert.equal(r.summary.belowResolution,false)}
  const thin=crackWidth(synth(1).g,200,200,synth(1).ax);assert.equal(thin.summary.belowResolution,true,"fissura de 1 px sinalizada abaixo da resolução");
  assert.ok(thin.summary.median>1,"FWHM de fissura não resolvida é um teto");
  const flat=crackWidth(new Float32Array(200*200).fill(150),200,200,{x1:20,y1:20,x2:180,y2:20});assert.equal(flat.summary.valid,0,"sem vale, sem medida");
}
// Larguras ao longo de um corte: disco de raio 30 → corte pelo centro mede ≈ 60 px, faixa contém o valor
{
  const {cutBase,profile,measureRows}=await import("../src/cdm4CutAnalysis.js");
  const w=160,h=120,img=new Uint8ClampedArray(w*h*4),prob=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const r=Math.hypot(x-80,y-60);img.set(r<30?[70,70,70,255]:[170,170,170,255],4*(y*w+x));prob[y*w+x]=1/(1+Math.exp((r-30)/1.5))}
  const B=cutBase(img,w,h,{prob,W:w,H:h,threshold:.5},{levels:[.3,.5,.7],mmPerPx:.5});
  const P=profile(B,{x1:0,y1:60,x2:159,y2:60}),R=P.notes.regions;
  assert.equal(R.length,1);assert.ok(Math.abs(R[0].width-60)<1.5,"largura do disco "+R[0].width);assert.ok(R[0].wMin<=R[0].width&&R[0].width<=R[0].wMax);
  const rows=measureRows([P]);assert.ok(Math.abs(rows[0].width_mm-R[0].width*.5)<1e-9);
}
console.log("crack width + cut widths ok");

// Escala por 4 pontos (homografia) e menor distância entre contornos
{
  const G=await import("../src/measureGeometry.js");
  const H0=[0.62,0.08,120,-0.05,0.55,90,0.00018,0.00025,1],toImg=(u,v)=>G.applyH(H0,u,v);
  const quad=[[0,0],[1000,0],[1000,600],[0,600]].map(([u,v])=>toImg(u,v)),M=G.makeMetric({kind:"homography",quad,wmm:1000,hmm:600});
  assert.ok(M&&M.kind==="homography");let s=11;const rnd=()=>{s=(s*1103515245+12345)%2147483648;return s/2147483648};
  for(let k=0;k<50;k++){const a=[rnd()*1000,rnd()*600],b=[rnd()*1000,rnd()*600];assert.ok(Math.abs(M.len(toImg(...a),toImg(...b))-Math.hypot(b[0]-a[0],b[1]-a[1]))<1e-6,"homografia recupera mm")}
  const sp=G.scaleSpread(M,quad);assert.ok(sp.spread>.3,"perspectiva forte detectada: "+sp.spread);
  assert.equal(G.makeMetric({kind:"homography",quad:[[0,0],[10,0],[10,0],[0,10]],wmm:1,hmm:1}),null,"quadrilátero degenerado recusado");
  const w=240,h=120,m=new Uint8Array(w*h),m2=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){if(Math.hypot(x-60,y-60)<=20)m[y*w+x]=1;if(Math.hypot(x-160,y-60)<=15)m2[y*w+x]=1}
  const masks={spalling_dark:m,cracks:m2},A=G.pickComponent(masks,w,h,60,60),B=G.pickComponent(masks,w,h,175,75);
  assert.equal(A.cls,"spalling_dark");assert.equal(B.cls,"cracks");assert.ok(B.distance>0,"clique perto (não sobre) o contorno");
  const D=G.minDistance(A,B,w,h,G.makeMetric({kind:"mmpx",mmPerPx:.5}));assert.equal(D.d_px,65);assert.equal(D.d_mm,32.5);assert.equal(D.overlap,false);
  const ov=new Uint8Array(w*h);for(let i=0;i<w*h;i++)ov[i]=m[i];const inner=new Uint8Array(w*h);for(let y=55;y<65;y++)for(let x=55;x<65;x++)inner[y*w+x]=1;
  const R=G.pickComponent({exposed_rebar:inner,spalling_dark:ov},w,h,60,60);assert.equal(R.cls,"exposed_rebar","armadura tem prioridade no clique");
  assert.equal(G.minDistance(R,A,w,h).d_px,0,"contornos sobrepostos → 0");
  assert.equal(G.pickComponent(masks,w,h,120,10),null,"clique longe de tudo → nada");
}
console.log("homography + contour distance ok");

// ---------- sólido de camadas de nível → IFC4 / IFC 4.3 ----------
{
  const LS=await import("../src/levelSolid.js"),FW=await import("../src/ifcLevelSolidWriter.js"),FF=await import("../src/ifcFace.js");
  const fsx=await import("node:fs");
  // potencial em anel (coroa) + cone: área de cada nível = células com u ≥ t; o anel tem furo
  const W=120,H=90,P=new Float32Array(W*H);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const r1=Math.hypot(x-35,y-45),r2=Math.hypot(x-90,y-45);P[y*W+x]=Math.max(Math.max(0,1-Math.abs(r1-18)/10),Math.max(0,1-r2/22))}
  const sol=LS.buildLevelSolid({prob:P,W,H,f:1},(x,y)=>[x*2,y*2],{levels:[.2,.5,.8],layerMm:5,minAreaMm2:50});
  assert.equal(sol.regions.length,2,"duas regiões: anel e cone");
  for(const t of sol.levels){let n=0;for(const v of P)if(v>=t)n++;const a=sol.regions.reduce((s,R)=>s+(R.areaByLevel.find(q=>q.level===t)?.area_mm2||0),0);
    assert.ok(Math.abs(a-n*4)/(n*4)<.06,`área do nível ${t}: ${a} vs ${n*4}`)}
  const ring=sol.regions.find(R=>R.bbox[0]<60);assert.ok(ring.layers[0].polys[0].holes.length===1,"anel com furo");
  assert.deepEqual(ring.layers.map(L=>[L.z0,L.z1]),[[0,5],[5,10],[10,15]]);
  // face plana de uma caixa 2 × 1 × 3 m (visualizador, Y para cima): face +Z clicada
  const box=[[0,0,0],[2,0,0],[2,3,0],[0,3,0],[0,0,-1],[2,0,-1],[2,3,-1],[0,3,-1]],quads=[[0,1,2,3],[5,4,7,6],[1,5,6,2],[4,0,3,7],[3,2,6,7],[4,5,1,0]];
  const pos=new Float32Array(box.flat()),idx=quads.flatMap(([a,b,c,d])=>[a,b,c,a,c,d]),I=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  const tris=FF.worldTriangles(pos,idx,I),F=FF.planarFace(tris,0);
  assert.ok(Math.abs(F.width-2)<1e-9&&Math.abs(F.height-3)<1e-9,"face 2 × 3 m");assert.deepEqual(F.n.map(v=>+v.toFixed(6)+0),[0,0,1]);
  assert.deepEqual(F.ex.map(v=>+v.toFixed(6)+0),[1,0,0],"direita de quem olha a face +Z");assert.deepEqual(F.origin.map(v=>+v.toFixed(6)+0),[0,3,0],"canto superior esquerdo");
  assert.ok(Math.abs(FF.planarFace(tris,0,{rot:1}).width-3)<1e-9,"rotação de 90°");
  const Fm=FF.faceToModel(F,[1,0,0,0,0,1,0,0,0,0,1,0,10,20,30,1],.001);assert.deepEqual(Fm.origin.map(v=>Math.round(v)),[-10000,30000,-17000]);assert.deepEqual(Fm.n.map(v=>Math.round(v)+0),[0,-1,0]);
  // gravação nos dois esquemas: entidades, relação, tipo e posição da origem da característica sobre a face
  const a=Math.PI/6,rot=(x,y)=>[x*Math.cos(a)-y*Math.sin(a),x*Math.sin(a)+y*Math.cos(a)],o=rot(600,400);
  const face={origin:[100000+o[0],50000+o[1],7000],ex:[...rot(-1,0),0],n:[...rot(0,1),0]};
  for(const[fx,is43]of[["pier_ifc4.ifc",false],["pier_ifc43.ifc",true]]){
    const txt=fsx.readFileSync(new URL("./fixtures/"+fx,import.meta.url),"utf8"),guid=txt.match(/IFCCOLUMN\('([^']+)'/)[1];
    const r=FW.writeLevelSolid(txt,{hostGuid:guid,face,solid:sol});const M=FW.parseStep(r.text),of=t=>[...M.ents.values()].filter(e=>e.type===t);
    assert.equal(of("IFCSURFACEFEATURE").length,2);assert.equal(of(is43?"IFCRELADHERESTOELEMENT":"IFCRELAGGREGATES").filter(e=>e.raw.includes("CDM-4 danos")).length,1,"relação do esquema");
    const sf=FW.parseArgs(of("IFCSURFACEFEATURE")[0].raw);assert.equal(sf[8].enum,is43?"DEFECT":"USERDEFINED");assert.equal(sf[4],is43?null:"DEFECT");
    assert.equal(of("IFCSHELLBASEDSURFACEMODEL").length,6,"uma casca por camada");assert.equal(of("IFCPROPERTYSET").filter(e=>/CDM_DamageShape/.test(e.raw)).length,2);
    const Mw=FW.placementMatrix(M,sf[5].ref);assert.ok(Math.hypot(Mw[12]-face.origin[0],Mw[13]-face.origin[1],Mw[14]-face.origin[2])<1e-6,"origem sobre a face");
    assert.ok(Math.abs(Mw[8]*face.n[0]+Mw[9]*face.n[1]-1)<1e-9,"eixo z = normal da face");
    assert.ok(r.text.includes("n\\X2\\00ED\\X0\\vel")||r.text.includes("\\X2\\"),"texto acentuado codificado em STEP");
  }
  assert.throws(()=>FW.writeLevelSolid("ISO-10303-21;HEADER;FILE_SCHEMA(('IFC2X3'));ENDSEC;DATA;ENDSEC;END-ISO-10303-21;",{hostGuid:"x",face,solid:sol}),/IFC2X3/);
  console.log("level solid → IFC4/IFC4.3 ok");
}

// ---------- sólido sem importação: IFC de referência, mapeamento foto ↔ face e camada por ponto ----------
{
  const LS=await import("../src/levelSolid.js"),FW=await import("../src/ifcLevelSolidWriter.js"),FF=await import("../src/ifcFace.js"),RH=await import("../src/ifcReferenceHost.js"),MG=await import("../src/measureGeometry.js");
  // inversa do mapeamento em todos os modos (encaixe, escala, homografia, espelho e deslocamento)
  const metric=MG.makeMetric({kind:"homography",quad:[[100,80],[900,120],[880,1500],[60,1450]],wmm:600,hmm:900});
  for(const o of[{fit:"contain"},{fit:"scale",k:.7},{fit:"metric",metric},{fit:"contain",mirror:true,dx:35,dy:-20},{fit:"metric",metric,mirror:true,dx:-5}]){
    const m=FF.imageFaceMapping({W:1000,H:1500,faceWmm:1200,faceHmm:5000,...o});
    for(const[x,y]of[[0,0],[999,0],[500,700],[123,1499]]){const[u,v]=m.toPlane(x,y),[a,b]=m.toImage(u,v);assert.ok(Math.hypot(a-x,b-y)<1e-6,"inversa "+o.fit)}}
  // camada por ponto = níveis abaixo do potencial (fora de uma faixa de borda)
  const W=160,H=120,P=new Float32Array(W*H);for(let y=0;y<H;y++)for(let x=0;x<W;x++)P[y*W+x]=Math.max(0,1-Math.hypot((x-80)/50,(y-60)/35));
  const m=FF.imageFaceMapping({W:320,H:240,faceWmm:640,faceHmm:480,fit:"scale",k:2}),rw={prob:P,W,H,f:2},levels=[.2,.4,.6,.8];
  const sol=LS.buildLevelSolid(rw,m.toPlane,{levels,layerMm:5,minAreaMm2:0});let agree=0,n=0;
  for(let i=0;i<4000;i++){const x=(i*37.3)%320,y=(i*19.7)%240,[u,v]=m.toPlane(x,y),p=FF.potentialAt(rw,2,x,y);if(Math.min(...levels.map(t=>Math.abs(p-t)))<.03)continue;n++;
    const top=LS.layersAtPoint(sol,u,v).at(-1)?.level||0,exp=levels.filter(t=>p>=t).at(-1)||0;if(top===exp)agree++}
  assert.ok(agree/n>.995,`camada no ponto: ${agree}/${n}`);
  assert.deepEqual(FF.faceUV({origin:[0,2,0],ex:[1,0,0],ey:[0,1,0],n:[0,0,1]},[.25,1.5,0]).map(v=>Math.round(v)),[250,500]);
  // IFC de referência + sólido, nos dois esquemas
  for(const schema of["IFC4","IFC4X3"]){
    const h=RH.referenceHostIfc({schema,widthMm:640,heightMm:480});const M0=FW.parseStep(h.text);
    assert.equal(M0.schema,schema==="IFC4"?"IFC4":"IFC4X3_ADD2");assert.equal(FW.lengthUnitMeters(M0),.001);
    const r=FW.writeLevelSolid(h.text,{hostGuid:h.hostGuid,face:h.face,solid:sol}),M=FW.parseStep(r.text),of=t=>[...M.ents.values()].filter(e=>e.type===t);
    assert.equal(of("IFCSURFACEFEATURE").length,sol.regions.length);assert.equal(of("IFCBUILDINGELEMENTPROXY").length,1);
    const sf=FW.parseArgs(of("IFCSURFACEFEATURE")[0].raw),Mw=FW.placementMatrix(M,sf[5].ref);
    assert.deepEqual([Mw[12],Mw[13],Mw[14]].map(v=>Math.round(v)+0),[0,0,480],"origem no canto superior esquerdo da face frontal");
    assert.deepEqual([Mw[8],Mw[9],Mw[10]].map(v=>Math.round(v)+0),[0,-1,0],"normal −Y (para fora da placa)");
  }
  console.log("level solid sem importação + camada por ponto ok");
}

// ---------- relevo contínuo (vales) e sentido para dentro ----------
{
  const LS=await import("../src/levelSolid.js"),FW=await import("../src/ifcLevelSolidWriter.js"),RH=await import("../src/ifcReferenceHost.js");
  // potencial com um vale no meio (anel alto em volta de uma depressão) + um disco pequeno descartado pela área mínima
  const W=140,H=100,P=new Float32Array(W*H);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const r=Math.hypot(x-60,y-50),dome=Math.max(0,1-r/40),valley=.55*Math.exp(-(r*r)/(2*7*7)),s=Math.hypot(x-125,y-15)<4?.9:0;P[y*W+x]=Math.max(0,Math.max(dome-valley,s))}
  const toPlane=(x,y)=>[x*2,y*2],rw={prob:P,W,H,f:1},sol=LS.buildLevelSolid(rw,toPlane,{levels:[.1,.3,.5],layerMm:10,minAreaMm2:400});
  assert.equal(sol.regions.length,1,"disco pequeno descartado");
  const R=LS.buildRelief(rw,toPlane,sol,{stride:1}),M=R.regions[0];assert.equal(R.regions.length,1);
  // casca fechada e orientada: cada aresta aparece uma vez em cada sentido
  const E=new Map();for(let t=0;t<M.indices.length;t+=3)for(let k=0;k<3;k++){const a=M.indices[t+k],b=M.indices[t+(k+1)%3];E.set(a+","+b,(E.get(a+","+b)||0)+1)}
  for(const[k,c]of E){const[a,b]=k.split(",");assert.ok(c===1&&E.get(b+","+a)===1,"aresta aberta "+k)}
  // altura: 0 na curva t0, máxima H = 3 × 10 mm onde u → 1; vale no centro mais baixo que o anel
  let zmax=0;for(let i=2;i<M.positions.length;i+=3)zmax=Math.max(zmax,M.positions[i]);
  const zAt=(u,v)=>{let best=null,bd=1e9;for(let i=0;i<M.positions.length;i+=3){if(M.positions[i+2]===0&&i/3>=M.topCount)continue;const d=Math.hypot(M.positions[i]-u,M.positions[i+1]-v);if(d<bd){bd=d;best=M.positions[i+2]}}return best};
  const zc=zAt(120,100),zr=zAt(120+2*14,100);let uMax=0;for(let y=0;y<H;y++)for(let x=0;x<110;x++)uMax=Math.max(uMax,P[y*W+x]);
  assert.ok(Math.abs(zmax-30*(uMax-.1)/.9)<1e-3,`altura máxima ${zmax}`);assert.ok(zc<zr-2,`vale: centro ${zc.toFixed(1)} mm < anel ${zr.toFixed(1)} mm`);
  // gravação: relevo como IfcTriangulatedFaceSet colorido; para dentro inverte o lado; camadas planas para dentro também
  for(const schema of["IFC4","IFC4X3"]){
    const h=RH.referenceHostIfc({schema,widthMm:280,heightMm:200});
    for(const direction of[1,-1]){
      const r=FW.writeLevelSolid(h.text,{hostGuid:h.hostGuid,face:h.face,solid:sol,relief:R,direction}),T=FW.parseStep(r.text),of=t=>[...T.ents.values()].filter(e=>e.type===t);
      assert.equal(of("IFCTRIANGULATEDFACESET").length,1);assert.equal(of("IFCINDEXEDCOLOURMAP").length,1);assert.equal(of("IFCSHELLBASEDSURFACEMODEL").length,0);
      assert.ok(of("IFCSHAPEREPRESENTATION").some(e=>/'Tessellation'/.test(e.raw)));
      const pl=FW.parseArgs(of("IFCCARTESIANPOINTLIST3D")[0].raw)[0],zs=pl.map(p=>p[2]);
      if(direction>0)assert.ok(Math.min(...zs)>0,"para fora: z > 0 no sistema da face");else assert.ok(Math.max(...zs)<0,"para dentro: z < 0");
      assert.equal(FW.parseArgs(of("IFCCARTESIANPOINTLIST3D")[0].raw).length,schema==="IFC4"?1:2,"TagList só no IFC 4.3");
      assert.ok(r.text.includes(direction>0?"para fora da face":"para dentro da face"));
      const t2=FW.writeLevelSolid(h.text,{hostGuid:h.hostGuid,face:h.face,solid:sol,direction}),T2=FW.parseStep(t2.text);
      const zz=[...T2.ents.values()].filter(e=>e.type==="IFCCARTESIANPOINT").map(e=>FW.parseArgs(e.raw)[0]).filter(c=>c.length===3&&Math.abs(c[2])>.4&&Math.abs(c[2])<40).map(c=>c[2]);
      assert.ok(zz.length&&zz.every(z=>Math.sign(z)===direction),"camadas planas no sentido pedido");
    }
  }
  console.log("relevo com vales + sentido ok");
}

// ---------- projeção côncava: cavidade com recorte (IfcVoidingFeature) sem alterar a geometria do elemento ----------
{
  const LS=await import("../src/levelSolid.js"),FW=await import("../src/ifcLevelSolidWriter.js"),RH=await import("../src/ifcReferenceHost.js"),CV=await import("../src/cavityView.js");
  const fsx=await import("node:fs");
  const W=140,H=100,P=new Float32Array(W*H);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const r=Math.hypot(x-70,y-50),dome=Math.max(0,1-r/40),valley=.5*Math.exp(-(r*r)/(2*7*7));P[y*W+x]=Math.max(0,dome-valley)}
  const toPlane=(x,y)=>[100+x*2,100+y*2],rw={prob:P,W,H,f:1},sol=LS.buildLevelSolid(rw,toPlane,{levels:[.1,.3,.5],layerMm:10,minAreaMm2:400});
  for(const style of["relief","terraces"]){
    const C=LS.buildCavity(rw,toPlane,sol,{style,stride:1});assert.equal(C.regions.length,1);const r=C.regions[0];
    // o recorte cobre o fundo (≥ 99,9 % dos vértices) e os degraus ficam cada vez mais fundos
    let n=0,ok=0;for(let i=0;i<r.lining.positions.length;i+=3){n++;if(LS.cavityDepthAt(r,r.lining.positions[i],r.lining.positions[i+1])>=r.lining.positions[i+2])ok++}
    assert.ok(ok/n>=.999,`${style}: recorte cobre ${ok}/${n}`);
    for(let k=1;k<r.steps.length;k++)assert.ok(r.steps[k].depthMm>=r.steps[k-1].depthMm,"degraus monotônicos");
    assert.ok(r.steps[0].topMm<0,"tampa fora da face");
  }
  const C=LS.buildCavity(rw,toPlane,sol,{style:"relief",stride:1});
  for(const schema of["IFC4","IFC4X3"]){
    const h=RH.referenceHostIfc({schema,widthMm:500,heightMm:400,thicknessMm:120});
    const r=FW.writeLevelSolid(h.text,{hostGuid:h.hostGuid,face:h.face,solid:sol,cavity:C}),M=FW.parseStep(r.text),of=t=>[...M.ents.values()].filter(e=>e.type===t);
    assert.equal(r.voids,1);assert.equal(of("IFCVOIDINGFEATURE").length,1);assert.equal(of("IFCRELVOIDSELEMENT").length,1);
    const vf=of("IFCVOIDINGFEATURE")[0],rv=FW.parseArgs(of("IFCRELVOIDSELEMENT")[0].raw);assert.equal(rv[5].ref,vf.id);assert.equal(FW.parseArgs(vf.raw)[8].enum,"USERDEFINED");
    assert.ok(of("IFCEXTRUDEDAREASOLID").length>=C.regions[0].steps.length,"recorte em degraus extrudados");
    assert.ok(of("IFCTRIANGULATEDFACESET").every(e=>/,\.F\.,/.test(e.raw)),"fundo = superfície aberta");
    // a geometria do elemento hospedeiro não muda: a entidade é idêntica à do arquivo original
    const hostLine=t=>t.split("\n").find(l=>l.includes(h.hostGuid)&&l.includes("IFCBUILDINGELEMENTPROXY"));assert.equal(hostLine(r.text),hostLine(h.text));
    if(schema==="IFC4"){const ag=of("IFCRELAGGREGATES").filter(e=>e.raw.includes("CDM-4 dano'"));assert.equal(ag.length,1);assert.equal(FW.parseArgs(ag[0].raw)[4].ref,vf.id,"IFC4: fundo agregado ao recorte")}
    else assert.equal(of("IFCRELADHERESTOELEMENT").length,1);
    const r2=FW.writeLevelSolid(h.text,{hostGuid:h.hostGuid,face:h.face,solid:sol,cavity:C,voids:false});assert.equal(r2.voids,0);assert.ok(!r2.text.includes("IFCVOIDINGFEATURE"));
  }
  // vista: face recortada (área = face − boca + ilha) e boca fora da face → sem recorte
  const face={origin:[0,1,0],ex:[1,0,0],ey:[0,1,0],n:[0,0,1]},tri=(a,b,c)=>({P:[a,b,c],n:[0,0,1],area:.5}),T=[tri([0,1,0],[0,0,0],[1,0,0]),tri([0,1,0],[1,0,0],[1,1,0])];
  const sq=(x,y,s)=>[[x,y],[x+s,y],[x+s,y+s],[x,y+s],[x,y]];
  const g=CV.cutHostGeometry(face,T,T,{regions:[{steps:[{depthMm:20,polys:[{outer:sq(400,400,200),holes:[sq(470,470,40)]}]}]}]}),Pp=g.attributes.position.array;let area=0;
  for(let i=0;i<Pp.length;i+=9)area+=Math.abs((Pp[i+3]-Pp[i])*(Pp[i+7]-Pp[i+1])-(Pp[i+4]-Pp[i+1])*(Pp[i+6]-Pp[i]))/2;
  assert.ok(Math.abs(area-(1-.04+.0016))<1e-6,"face recortada "+area);
  assert.equal(CV.cutHostGeometry(face,T,T,{regions:[{steps:[{depthMm:20,polys:[{outer:sq(900,400,200),holes:[]}]}]}]}),null);
  console.log("cavidade côncava + recorte IFC ok");
}

// ---------- armadura exposta projetada na cavidade ----------
{
  const RB=await import("../src/rebarCenterlines.js"),LS=await import("../src/levelSolid.js"),FW=await import("../src/ifcLevelSolidWriter.js"),RH=await import("../src/ifcReferenceHost.js");
  // barra longitudinal (8 px) cortada por um estribo (6 px) e uma barra inclinada (6 px) + ruído
  const w=320,h=220,m=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){if(Math.abs(x-80)<4&&y>10&&y<210)m[y*w+x]=1;if(Math.abs(y-110)<3&&x>50&&x<110)m[y*w+x]=1;
    const d=Math.abs((y-110)-.3*(x-220))/Math.hypot(1,.3);if(d<3&&x>140&&x<310)m[y*w+x]=1;if(Math.hypot(x-200,y-20)<2)m[y*w+x]=1}
  const L=RB.rebarCenterlines(m,w,h),long=L.find(b=>b.len>180&&Math.abs(b.pts[0][0]-80)<3),incl=L.find(b=>Math.abs((b.pts.at(-1)[1]-b.pts[0][1])/(b.pts.at(-1)[0]-b.pts[0][0])-.3)<.05);
  assert.ok(long,"longitudinal contínua através do cruzamento com o estribo");assert.ok(Math.abs(long.r-4)<.6,"raio da longitudinal "+long.r);
  assert.ok(incl&&Math.abs(incl.r-3)<.6,"barra inclinada");assert.ok(!L.some(b=>b.len<10),"ruído descartado");
  assert.equal(RB.nearestGauge(11.3),12.5);assert.equal(RB.nearestGauge(6.6),6.3);
  const T=RB.rebarTubes([{pts:[[0,0,10],[100,0,10],[100,50,12]],d:10}]),E=new Map();
  for(let i=0;i<T.indices.length;i+=3)for(let k=0;k<3;k++){const a=T.indices[i+k],b=T.indices[i+(k+1)%3];E.set(a+","+b,(E.get(a+","+b)||0)+1)}
  for(const[k,c]of E){const[a,b]=k.split(",");assert.ok(c===1&&E.get(b+","+a)===1,"tubo fechado")}
  // gravação: tubos no corpo da característica côncava + propriedade "Armadura"; sem IfcReinforcingBar
  const W=140,H=100,P=new Float32Array(W*H);for(let y=0;y<H;y++)for(let x=0;x<W;x++)P[y*W+x]=Math.max(0,1-Math.hypot((x-70)/40,(y-50)/30));
  const toPlane=(x,y)=>[100+x*2,100+y*2],rw={prob:P,W,H,f:1},sol=LS.buildLevelSolid(rw,toPlane,{levels:[.1,.5],layerMm:10,minAreaMm2:400}),C=LS.buildCavity(rw,toPlane,sol,{stride:1});
  const tube=RB.rebarTubes([{pts:[[180,200,15],[300,200,15]],d:10}]),cav={...C,regions:C.regions.map(r=>({...r,rebars:[{...tube,d:10}]})),rebar:{diameter:"auto",mode:"floor"}};
  for(const schema of["IFC4","IFC4X3"]){const hst=RH.referenceHostIfc({schema,widthMm:500,heightMm:400,thicknessMm:120});
    const r=FW.writeLevelSolid(hst.text,{hostGuid:hst.hostGuid,face:hst.face,solid:sol,cavity:cav}),M=FW.parseStep(r.text),of=t=>[...M.ents.values()].filter(e=>e.type===t);
    assert.equal(of("IFCTRIANGULATEDFACESET").length,2,"fundo + 1 barra");assert.ok(of("IFCTRIANGULATEDFACESET").some(e=>/,\.T\.,/.test(e.raw)),"barra fechada");
    assert.ok(r.text.includes("'Armadura'")&&r.text.includes("armadura exposta"),"propriedade Armadura");assert.equal(of("IFCREINFORCINGBAR").length,0)}
  console.log("armadura exposta na cavidade ok");
}
