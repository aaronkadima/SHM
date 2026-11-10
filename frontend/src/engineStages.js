// Etapas de processamento de cada motor browser, como imagens para inspeção visual.
// Reexecuta o mesmo pipeline do motor (mesmas funções e parâmetros) e captura os estados
// intermediários; nada aqui altera o resultado oficial da análise.
import{opencvCrackStages}from"./opencvCore.js";
import{__cdmTest}from"./cdmBrowser.js";
import{getSession}from"./onnxBrowser.js";
import{liveInputSpec,runLiveEngine,CDM_LIVE_CLASSES}from"./liveEngines.js";

const STAGE_ENGINES=new Set(["opencv_crack","cdm_1","cdm_3","segformer_public_crack","crackenpy_public_crack","yolov8n_public_crack_seg"]);
export function engineStagesSupported(engineId){return STAGE_ENGINES.has(engineId)}

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function canvas(w,h){const c=document.createElement("canvas");c.width=w;c.height=h;return c}
// As etapas são montadas como canvas e convertidas no fim para blobs (URL de objeto) + miniatura.
function url(c){return c}
async function decode(file,maxSide){
  const bmp=await createImageBitmap(file,{imageOrientation:"from-image"});
  const k=Math.min(1,maxSide/Math.max(bmp.width,bmp.height)),w=Math.max(1,Math.round(bmp.width*k)),h=Math.max(1,Math.round(bmp.height*k));
  const c=canvas(w,h),ctx=c.getContext("2d",{willReadFrequently:true});ctx.drawImage(bmp,0,0,w,h);bmp.close?.();
  return{canvas:c,image:ctx.getImageData(0,0,w,h)};
}
function grayUrl(values,w,h,{normalize=true,invert=false}={}){
  let lo=0,hi=255;
  if(normalize){lo=Infinity;hi=-Infinity;for(const v of values){if(v<lo)lo=v;if(v>hi)hi=v}if(hi-lo<1e-6)hi=lo+1}
  const c=canvas(w,h),ctx=c.getContext("2d"),img=ctx.createImageData(w,h);
  for(let i=0,j=0;i<w*h;i++,j+=4){let v=clamp((values[i]-lo)/(hi-lo)*255,0,255);if(invert)v=255-v;img.data[j]=img.data[j+1]=img.data[j+2]=v;img.data[j+3]=255}
  ctx.putImageData(img,0,0);return url(c);
}
function maskUrl(mask,w,h,color=[255,255,255],bg=[18,32,40]){
  const c=canvas(w,h),ctx=c.getContext("2d"),img=ctx.createImageData(w,h);
  for(let i=0,j=0;i<w*h;i++,j+=4){const on=mask[i];img.data[j]=on?color[0]:bg[0];img.data[j+1]=on?color[1]:bg[1];img.data[j+2]=on?color[2]:bg[2];img.data[j+3]=255}
  ctx.putImageData(img,0,0);return url(c);
}
// Mapa de calor perceptual (azul-petróleo → âmbar → branco) para probabilidades 0..1.
const HEAT=[[13,32,44],[13,118,110],[200,144,79],[255,236,180]];
function heat(v){const t=clamp(v,0,1)*(HEAT.length-1),i=Math.min(HEAT.length-2,Math.floor(t)),f=t-i,a=HEAT[i],b=HEAT[i+1];return[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f,a[2]+(b[2]-a[2])*f]}
function heatUrl(prob,w,h){
  const c=canvas(w,h),ctx=c.getContext("2d"),img=ctx.createImageData(w,h);
  for(let i=0,j=0;i<w*h;i++,j+=4){const[r,g,b]=heat(prob[i]);img.data[j]=r;img.data[j+1]=g;img.data[j+2]=b;img.data[j+3]=255}
  ctx.putImageData(img,0,0);return url(c);
}
function overlayUrl(base,draw){const c=canvas(base.width,base.height),ctx=c.getContext("2d");ctx.drawImage(base,0,0);ctx.fillStyle="rgba(8,16,22,.45)";ctx.fillRect(0,0,c.width,c.height);draw(ctx,c.width,c.height);return url(c)}
function maskOverlay(ctx,mask,mw,mh,W,H,color){
  const m=canvas(mw,mh),mctx=m.getContext("2d"),img=mctx.createImageData(mw,mh);
  for(let i=0,j=0;i<mw*mh;i++,j+=4)if(mask[i]){img.data[j]=color[0];img.data[j+1]=color[1];img.data[j+2]=color[2];img.data[j+3]=220}
  mctx.putImageData(img,0,0);ctx.imageSmoothingEnabled=mw<W;ctx.drawImage(m,0,0,W,H);
}
const stage=(id,label,detail,src,extra={})=>({id,label,detail,url:src,...extra});
const lowres=(w,h)=>Math.max(w,h)<=256?{lowres:true}:{};

async function opencvStages(file){
  const{canvas:base,image}=await decode(file,1280),w=image.width,h=image.height;
  const s=opencvCrackStages(image.data,w,h);
  return[
    stage("input","1 · Entrada","Imagem reduzida a "+w+"×"+h+" px (lado máx. 1280).",url(base)),
    stage("gray","2 · Escala de cinza","Luminância Y = 0,299R + 0,587G + 0,114B.",grayUrl(s.gray,w,h,{normalize:false})),
    stage("blackhat","3 · Black-hat 15×15","Fechamento − cinza: realça estruturas escuras e finas (candidatas a fissura).",grayUrl(s.blackhat,w,h)),
    stage("blur","4 · Suavização 3×3","Filtro gaussiano 3×3 sobre a resposta black-hat.",grayUrl(s.blurred,w,h)),
    stage("otsu","5 · Limiar de Otsu","Limiar automático T = "+s.threshold+" sobre a resposta suavizada.",maskUrl(s.rawMask,w,h)),
    stage("open","6 · Abertura 2×2","Remove pixels isolados; área da máscara "+(100*s.maskArea/(w*h)).toFixed(2)+"%.",maskUrl(s.mask,w,h)),
    stage("components","7 · Componentes","Componentes 8-conexos com área ≥ "+s.minArea+" px: "+s.comps.length+" candidatos.",overlayUrl(base,(ctx,W,H)=>{
      maskOverlay(ctx,s.mask,w,h,W,H,[255,90,40]);ctx.strokeStyle="#ffb36b";ctx.lineWidth=Math.max(1.5,W/500);
      for(const c of s.comps){const[x1,y1,x2,y2]=c.box;ctx.strokeRect(x1,y1,x2-x1,y2-y1)}
    }))
  ];
}

async function cdmStages(file,options={}){
  const t=__cdmTest,{canvas:base,image}=await decode(file,1600),w=image.width,h=image.height;
  const odd=k=>{k=Math.max(3,Math.round(k));return k%2?k:k+1};
  const cfg={threshold:clamp(Number(options.cdm_threshold??35),1,255),kernel:odd(Number(options.cdm_kernel_size??15)),minArea:clamp(Number(options.cdm_min_area??30),1,1e6),minAspect:clamp(Number(options.cdm_min_aspect_ratio??2),1,50)};
  const{gray}=t.grayAndRgb(image);
  const response=t.blackhat(gray,w,h,cfg.kernel),raw=new Uint8Array(w*h);for(let i=0;i<raw.length;i++)raw[i]=response[i]>cfg.threshold?1:0;
  const masks=t.detectMasks(image,cfg);
  const records=[];for(const cls of t.ORDER)records.push(...t.recordsFromMask(masks[cls],w,h,cls,"t1_current",cfg));
  const color=Object.fromEntries(CDM_LIVE_CLASSES.map(c=>[c.id,c.color]));
  const counts=Object.fromEntries(CDM_LIVE_CLASSES.map(c=>[c.id,records.filter(r=>r.class===c.id).length]));
  return[
    stage("input","1 · Entrada","Imagem decodificada a "+w+"×"+h+" px (lado máx. 1600, orientação EXIF aplicada).",url(base)),
    stage("base_image","2 · Imagem base normalizada","Cinza com estiramento p2–p98. Em superfícies de baixo contraste este passo amplifica o ruído.",grayUrl(gray,w,h,{normalize:false})),
    stage("family_response","3 · Resposta black-hat","Kernel "+cfg.kernel+"×"+cfg.kernel+": realça estruturas escuras mais finas que o kernel.",grayUrl(response,w,h)),
    stage("candidate_mask","4 · Máscara candidata","Resposta > limiar "+cfg.threshold+" (fissuras, antes da limpeza).",maskUrl(raw,w,h)),
    stage("open_close_mask","5 · Máscaras por família","Fissura: abertura por reconstrução (mantém a forma da etapa 4) + fechamento 3×3. Demais famílias: abertura/fechamento.",overlayUrl(base,(ctx,W,H)=>{for(const c of CDM_LIVE_CLASSES)maskOverlay(ctx,masks[c.id],w,h,W,H,c.color)})),
    stage("connected_components","6 · Componentes vetorizados",CDM_LIVE_CLASSES.map(c=>c.label+" "+counts[c.id]).join(" · ")+". Fissuras: fragmentos a ≤ 4 px unidos e linha central pelo esqueleto (área ≥ "+cfg.minArea+" px, alongamento L²/A ≥ "+cfg.minAspect+").",overlayUrl(base,(ctx)=>{
      ctx.lineCap="round";ctx.lineJoin="round";
      for(const r of records){
        if(!r.points?.length)continue;const col="rgb("+color[r.class].join(",")+")";
        ctx.beginPath();ctx.moveTo(r.points[0][0],r.points[0][1]);for(let i=1;i<r.points.length;i++)ctx.lineTo(r.points[i][0],r.points[i][1]);
        if(r.closed){ctx.closePath();ctx.fillStyle=col.replace("rgb","rgba").replace(")",",.55)");ctx.fill();ctx.strokeStyle=col;ctx.lineWidth=1.5;ctx.stroke()}
        else{ctx.strokeStyle=col;ctx.lineWidth=Math.max(2,r.width_px);ctx.stroke()}
      }
    }),{counts})
  ];
}

async function onnxStages(engineId,file,control={}){
  const assetStem=engineId==="crackenpy_public_crack"?"crackenpy_public_crack.int8":undefined;
  const loaded=await getSession(engineId,{...control,assetStem});
  const spec=liveInputSpec(engineId,loaded.manifest);
  const{canvas:base}=await decode(file,1600),vw=base.width,vh=base.height;
  const c=canvas(spec.width,spec.height),ctx=c.getContext("2d",{willReadFrequently:true});let letterbox=null;
  if(spec.mode==="letterbox"){
    const r=Math.min(spec.width/vw,spec.height/vh),dw=Math.round(vw*r),dh=Math.round(vh*r),px=(spec.width-dw)/2,py=(spec.height-dh)/2;
    ctx.fillStyle="rgb(114,114,114)";ctx.fillRect(0,0,spec.width,spec.height);ctx.drawImage(base,0,0,vw,vh,px,py,dw,dh);letterbox={padX:px,padY:py,drawW:dw,drawH:dh};
  }else ctx.drawImage(base,0,0,spec.width,spec.height);
  const frame={width:spec.width,height:spec.height,data:ctx.getImageData(0,0,spec.width,spec.height).data};
  const result=await runLiveEngine(engineId,frame,{loaded,letterbox,opts:{withProbability:true,withCandidates:true}});
  const layer=result.layers[0],stages=[stage("input","1 · Tensor de entrada",(spec.mode==="letterbox"?"Letterbox ":"Redimensionamento ")+spec.width+"×"+spec.height+" px"+(spec.mode==="letterbox"?" com preenchimento cinza (114)":"")+", normalização do manifesto.",url(c))];
  if(engineId==="yolov8n_public_crack_seg"){
    const cands=result.candidates||[];
    stages.push(stage("candidates","2 · Candidatos (antes do NMS)",cands.length+" caixas com confiança ≥ "+Math.round(100*result.metrics.confidence_threshold)+"%.",overlayUrl(base,(g,W,H)=>{
      g.lineWidth=Math.max(1,W/700);for(const k of cands){g.strokeStyle="rgba(255,190,110,"+clamp(k.score,.15,.9)+")";g.strokeRect(k.box[0]*W,k.box[1]*H,(k.box[2]-k.box[0])*W,(k.box[3]-k.box[1])*H)}
    })));
    stages.push(stage("nms","3 · Após NMS (IoU 0,45)",result.boxes.length+" instâncias mantidas.",overlayUrl(base,(g,W,H)=>{
      g.lineWidth=Math.max(2,W/450);g.strokeStyle="#ff6a2a";g.font="600 "+Math.max(12,W/70)+"px Inter,sans-serif";g.fillStyle="#fff";
      for(const b of result.boxes){g.strokeRect(b.x1*W,b.y1*H,(b.x2-b.x1)*W,(b.y2-b.y1)*H);g.fillText(Math.round(b.score*100)+"%",b.x1*W+4,b.y1*H+Math.max(14,W/60))}
    })));
    stages.push(stage("mask","4 · Máscaras dos protótipos","Combinação linear dos 32 protótipos + sigmoide ≥ 0,5, recortada em cada caixa ("+layer.w+"×"+layer.h+").",maskUrl(layer.mask,layer.w,layer.h),lowres(layer.w,layer.h)));
  }else{
    stages.push(stage("probability","2 · Mapa de probabilidade","Softmax da classe fissura na saída do modelo ("+layer.w+"×"+layer.h+"); máx. "+(100*result.metrics.max_crack_probability).toFixed(1)+"%.",heatUrl(layer.prob,layer.w,layer.h),lowres(layer.w,layer.h)));
    stages.push(stage("argmax","3 · Classe vencedora","Pixels em que fissura é a classe de maior probabilidade"+(engineId==="segformer_public_crack"?" e ≥ 50%":"")+".",maskUrl(layer.rawMask,layer.w,layer.h),lowres(layer.w,layer.h)));
    stages.push(stage("clean","4 · Componentes filtrados","Remoção de componentes muito pequenos: "+result.boxes.length+" regiões.",maskUrl(layer.mask,layer.w,layer.h),lowres(layer.w,layer.h)));
  }
  return stages;
}

const THUMB_SIDE=220;
function toBlobUrl(c,type="image/jpeg",quality=.9){return new Promise(res=>c.toBlob(b=>res(b?URL.createObjectURL(b):c.toDataURL(type,quality)),type,quality))}
function thumbCanvas(src){const k=Math.min(1,THUMB_SIDE/Math.max(src.width,src.height)),t=canvas(Math.max(1,Math.round(src.width*k)),Math.max(1,Math.round(src.height*k))),ctx=t.getContext("2d");ctx.imageSmoothingQuality="high";ctx.drawImage(src,0,0,t.width,t.height);return t}
async function imageCanvas(dataUrl){const img=new Image();img.src=dataUrl;await img.decode();const c=canvas(img.naturalWidth,img.naturalHeight);c.getContext("2d").drawImage(img,0,0);return c}
async function finalize(stages){
  return Promise.all(stages.map(async s=>{
    const src=typeof s.url==="string"?await imageCanvas(s.url):s.url,png=!!s.transparent;
    const[full,thumb]=await Promise.all([toBlobUrl(src,png?"image/png":"image/jpeg"),toBlobUrl(thumbCanvas(src),png?"image/png":"image/jpeg",.85)]);
    return{...s,url:full,thumb,width:src.width,height:src.height};
  }));
}
export function releaseEngineStages(stages=[]){for(const s of stages)for(const u of [s.url,s.thumb])if(typeof u==="string"&&u.startsWith("blob:"))URL.revokeObjectURL(u)}

// result: resultado oficial do motor (seu overlay vira a última etapa).
export async function computeEngineStages(engineId,file,{options={},control={},result=null}={}){
  let stages;
  if(engineId==="opencv_crack")stages=await opencvStages(file);
  else if(engineId==="cdm_1"||engineId==="cdm_3")stages=await cdmStages(file,options);
  else if(STAGE_ENGINES.has(engineId))stages=await onnxStages(engineId,file,control);
  else return[];
  if(result?.overlay_png_base64)stages.push(stage("result",stages.length+1+" · Resultado do motor","Saída oficial exibida no canvas e usada nas exportações.","data:image/png;base64,"+result.overlay_png_base64,{transparent:result.metrics?.overlay_semantics==="transparent_layers"}));
  return finalize(stages);
}
