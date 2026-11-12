// Modo Live: inferência quadro a quadro dos motores browser-ready.
// Módulo sem DOM: roda dentro do liveWorker.js (Web Worker), recebe RGBA já
// redimensionado pela thread principal e devolve máscaras compactas (Uint8Array)
// em coordenadas normalizadas do quadro — nada de PNG/base64 por quadro.
import{opencvCrackCore}from"./opencvCore.js";
import{__cdmTest}from"./cdmBrowser.js";
import{gateMasks,sceneOf}from"./contextFilter.js";

export const LIVE_ENGINES={
  cdm_1:{name:"CDM-1",kind:"classical",note:"5 famílias de patologia (fissura, desplacamento, armadura, corrosão, eflorescência)"},
  opencv_crack:{name:"OpenCV Crack Baseline",kind:"classical",note:"Candidatos a fissura por black-hat + Otsu"},
  yolov8n_public_crack_seg:{name:"YOLOv8n Crack Seg",kind:"onnx",note:"Instâncias de fissura com caixas e máscaras"},
  segformer_public_crack:{name:"SegFormer-B0 Crack",kind:"onnx",note:"Segmentação semântica de fissura"},
  crackenpy_public_crack:{name:"CrackenPy FPN",kind:"onnx",assetStem:"crackenpy_public_crack.int8",note:"Segmentação de fissura (INT8, mais pesado)"}
};
export const LIVE_ENGINE_IDS=Object.keys(LIVE_ENGINES);
export function liveEngineSupported(id){return Object.prototype.hasOwnProperty.call(LIVE_ENGINES,id)}

export const CDM_LIVE_CLASSES=[
  {id:"exposed_rebar",label:"Armadura exposta",color:[140,140,140]},
  {id:"spalling_dark",label:"Desplacamento",color:[255,153,0]},
  {id:"corrosion_rust",label:"Corrosão",color:[139,63,0]},
  {id:"efflorescence_white",label:"Eflorescência",color:[0,102,204]},
  {id:"cracks",label:"Fissuras",color:[230,0,0]}
];
const CRACK_COLOR=[255,72,30];
const CDM_REFERENCE_SIDE=1600;

// Especificação de entrada que a thread principal deve preparar a partir do vídeo.
export function liveInputSpec(engineId,manifest=null,opts={}){
  if(engineId==="opencv_crack")return{mode:"maxSide",maxSide:Number(opts.maxSide||640)};
  if(engineId==="cdm_1")return{mode:"maxSide",maxSide:Number(opts.maxSide||512)};
  if(engineId==="yolov8n_public_crack_seg"){
    const lb=manifest?.preprocess?.letterbox||{};
    return{mode:"letterbox",width:Number(lb.width||640),height:Number(lb.height||640)};
  }
  const r=manifest?.preprocess?.resize||{};
  const height=Number(r.height||r.shortest_edge||r.shortestEdge||512),width=Number(r.width||r.shortest_edge||r.shortestEdge||512);
  return{mode:"resize",width:Math.max(16,Math.round(width)),height:Math.max(16,Math.round(height))};
}

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const sigmoid=v=>v>=0?1/(1+Math.exp(-v)):Math.exp(v)/(1+Math.exp(v));

// Rotulagem 8-conexa com filtros CDM (área mínima, alongamento) → máscara filtrada + caixas.
function filteredComponents(mask,w,h,{minArea=1,minAspect=0,maxItems=400}={}){
  const out=new Uint8Array(mask.length),seen=new Uint8Array(mask.length),queue=new Int32Array(mask.length),boxes=[];
  let count=0,area=0;
  for(let s=0;s<mask.length;s++){
    if(!mask[s]||seen[s])continue;
    let head=0,tail=0;queue[tail++]=s;seen[s]=1;let minX=w,minY=h,maxX=0,maxY=0;
    while(head<tail){
      const p=queue[head++],y=(p/w)|0,x=p-y*w;
      if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
      for(let ny=Math.max(0,y-1);ny<=Math.min(h-1,y+1);ny++)for(let nx=Math.max(0,x-1);nx<=Math.min(w-1,x+1);nx++){
        const q=ny*w+nx;if(mask[q]&&!seen[q]){seen[q]=1;queue[tail++]=q}
      }
    }
    if(tail<minArea)continue;
    const bw=maxX-minX+1,bh=maxY-minY+1,aspect=Math.max(bw,bh)/Math.max(1,Math.min(bw,bh));
    if(aspect<minAspect)continue;
    for(let q=0;q<tail;q++)out[queue[q]]=1;
    count++;area+=tail;
    if(boxes.length<maxItems)boxes.push({x1:minX/w,y1:minY/h,x2:(maxX+1)/w,y2:(maxY+1)/h,area_px:tail});
  }
  return{mask:out,count,area,boxes};
}

function runOpenCVLive(frame){
  const{width:w,height:h,data}=frame;
  const{mask,comps,threshold,maskArea}=opencvCrackCore(data,w,h,{maxItems:60});
  return{
    layers:[{id:"crack",label:"Fissura (candidato)",color:CRACK_COLOR,mask,w,h}],
    boxes:comps.map(c=>({x1:c.box[0]/w,y1:c.box[1]/h,x2:c.box[2]/w,y2:c.box[3]/h,label:"Fissura",score:null,color:CRACK_COLOR})),
    counts:{"Fissura (candidato)":comps.length},
    metrics:{otsu_threshold:threshold,mask_area_ratio:maskArea/(w*h),processed:[w,h]}
  };
}

function runCdmLive(frame,opts={}){
  // A análise completa processa a imagem com lado máximo min(1600, original) e aplica os parâmetros
  // nessa escala; o Live usa ≈512 px, então kernel e área mínima são escalados pela razão entre as duas.
  const{width:w,height:h}=frame,sourceSide=Math.min(CDM_REFERENCE_SIDE,Number(opts.sourceMaxSide||CDM_REFERENCE_SIDE));
  const scale=Math.min(1,Math.max(w,h)/Math.max(1,sourceSide));
  const kernel=Math.max(5,Math.round(Number(opts.cdm_kernel_size??15)*scale)|1);
  const cfg={
    threshold:clamp(Number(opts.cdm_threshold??35),1,255),kernel,
    minArea:Math.max(4,Math.round(Number(opts.cdm_min_area??30)*scale*scale)),
    minAspect:clamp(Number(opts.cdm_min_aspect_ratio??2),1,50)
  };
  let masks=__cdmTest.detectMasks(frame,cfg),contextRemoved=0;const layers=[],boxes=[],counts={};let total=0;
  let removedMasks=null;const ex=opts.contextExclusion;
  if(ex&&!ex.abstained){const g=gateMasks(masks,w,h,ex,{share:Number(opts.cdm_context_share??.6)});masks={...masks,...g.masks};removedMasks=g.removedMasks;contextRemoved=g.removed_total}
  for(const cls of CDM_LIVE_CLASSES){
    const minAspect=cls.id==="cracks"?cfg.minAspect:cls.id==="exposed_rebar"?Math.max(2,cfg.minAspect):0;
    const comp=filteredComponents(masks[cls.id],w,h,{minArea:cfg.minArea,minAspect,maxItems:40});
    layers.push({id:cls.id,label:cls.label,color:cls.color,mask:comp.mask,w,h});
    counts[cls.label]=comp.count;total+=comp.count;
    for(const b of comp.boxes)boxes.push({...b,label:cls.label,score:null,color:cls.color});
  }
  // Achados descartados pelo filtro de contexto: caixa cinza com o nome da patologia e da cena.
  let discarded=0;
  if(removedMasks)for(const cls of CDM_LIVE_CLASSES){
    const m=removedMasks[cls.id];if(!m)continue;
    const comp=filteredComponents(m,w,h,{minArea:cfg.minArea,maxItems:12});
    for(const b of comp.boxes){
      const sc=sceneOf(m,w,h,[b.x1*w,b.y1*h,(b.x2-b.x1)*w,(b.y2-b.y1)*h],ex);
      boxes.push({...b,label:"Descartado · "+cls.label+(sc?" em "+sc.label_pt:""),score:null,color:[150,160,166],discarded:true});discarded++;
    }
  }
  if(discarded)counts["Descartados pela IA"]=discarded;
  return{layers,boxes,counts,metrics:{cdm_live_cfg:cfg,total_records:total,processed:[w,h],context_removed:contextRemoved}};
}

function softmaxMask(out,crackId,threshold,requireArgmax=true,withProb=false){
  const classes=Number(out.dims[1]),oh=Number(out.dims[2]),ow=Number(out.dims[3]),plane=oh*ow,data=out.data;
  const mask=new Uint8Array(plane),prob=withProb?new Float32Array(plane):null;let area=0,sum=0,maxProb=0;
  for(let i=0;i<plane;i++){
    let maxLog=-Infinity,best=0;
    for(let c=0;c<classes;c++){const v=data[c*plane+i];if(v>maxLog){maxLog=v;best=c}}
    let denom=0;for(let c=0;c<classes;c++)denom+=Math.exp(data[c*plane+i]-maxLog);
    const p=Math.exp(data[crackId*plane+i]-maxLog)/Math.max(denom,1e-12);
    if(p>maxProb)maxProb=p;if(prob)prob[i]=p;
    if((!requireArgmax||best===crackId)&&p>=threshold){mask[i]=1;area++;sum+=p}
  }
  return{mask,prob,w:ow,h:oh,area,meanProb:area?sum/area:0,maxProb};
}
function rgbTensorData(frame,manifest,normalize){
  const{width:w,height:h,data}=frame,n=w*h,out=new Float32Array(3*n);
  const factor=Number(manifest.preprocess?.rescale_factor??(1/255));
  const mean=normalize?(manifest.preprocess?.image_mean||[.485,.456,.406]):[0,0,0],std=normalize?(manifest.preprocess?.image_std||[.229,.224,.225]):[1,1,1];
  for(let i=0,j=0;i<n;i++,j+=4){
    out[i]=(data[j]*factor-mean[0])/std[0];
    out[n+i]=(data[j+1]*factor-mean[1])/std[1];
    out[2*n+i]=(data[j+2]*factor-mean[2])/std[2];
  }
  return out;
}

async function runSemanticOnnx(engineId,loaded,frame,opts){
  const{ort,session,manifest}=loaded;
  const tensor=new ort.Tensor("float32",rgbTensorData(frame,manifest,true),[1,3,frame.height,frame.width]);
  const inputName=manifest.inputs?.[0]?.name||session.inputNames?.[0];
  const outputs=await session.run({[inputName]:tensor});
  const outName=manifest.outputs?.[0]?.name||session.outputNames?.[0],out=outputs[outName]||outputs[Object.keys(outputs)[0]];
  if(!out?.data||out.dims?.length!==4)throw new Error("Saída ONNX inesperada para "+engineId);
  const classes=Number(out.dims[1]);
  const crackId=clamp(Number(manifest.crack_id??(engineId==="crackenpy_public_crack"?2:1)),0,classes-1);
  const threshold=engineId==="crackenpy_public_crack"?0:Number(opts.threshold??manifest.threshold??.5);
  const m=softmaxMask(out,crackId,threshold,true,!!opts.withProbability);
  const comp=filteredComponents(m.mask,m.w,m.h,{minArea:Math.max(3,Math.round(m.w*m.h*.00005)),maxItems:40});
  return{
    layers:[{id:"crack",label:"Fissura",color:CRACK_COLOR,mask:comp.mask,w:m.w,h:m.h,...(m.prob?{prob:m.prob,rawMask:m.mask}:{})}],
    boxes:comp.boxes.map(b=>({...b,label:"Fissura",score:null,color:CRACK_COLOR})),
    counts:{"Fissura":comp.count},
    metrics:{crack_area_ratio:comp.area/(m.w*m.h),mean_crack_probability:m.meanProb,max_crack_probability:m.maxProb,model_output:[m.w,m.h]}
  };
}

function iou(a,b){
  const x1=Math.max(a[0],b[0]),y1=Math.max(a[1],b[1]),x2=Math.min(a[2],b[2]),y2=Math.min(a[3],b[3]);
  const inter=Math.max(0,x2-x1)*Math.max(0,y2-y1);
  return inter/Math.max((a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-inter,1e-9);
}
async function runYoloLive(loaded,frame,letterbox,opts){
  const{ort,session,manifest}=loaded;
  const tensor=new ort.Tensor("float32",rgbTensorData(frame,manifest,false),[1,3,frame.height,frame.width]);
  const inputName=manifest.inputs?.[0]?.name||session.inputNames?.[0]||"images";
  const outputs=await session.run({[inputName]:tensor});
  const names=manifest.outputs?.map(x=>x.name)||session.outputNames||Object.keys(outputs);
  const det=outputs[names[0]]||outputs.output0,proto=outputs[names[1]]||outputs.output1;
  if(!det?.data||!proto?.data||det.dims?.length!==3||proto.dims?.length!==4)throw new Error("Saída YOLOv8-Seg ONNX inesperada.");
  const channels=Number(det.dims[1]),cand=Number(det.dims[2]),mc=Number(proto.dims[1]),ph=Number(proto.dims[2]),pw=Number(proto.dims[3]);
  const classCount=channels-4-mc,threshold=Number(opts.confidence??manifest.threshold??.25),raw=[];
  for(let i=0;i<cand;i++){
    let score=-Infinity,cls=0;
    for(let c=0;c<classCount;c++){const v=det.data[(4+c)*cand+i];if(v>score){score=v;cls=c}}
    if(score<threshold)continue;
    const cx=det.data[i],cy=det.data[cand+i],bw=det.data[2*cand+i],bh=det.data[3*cand+i];
    raw.push({score,cls,i,box:[cx-bw/2,cy-bh/2,cx+bw/2,cy+bh/2]});
  }
  raw.sort((a,b)=>b.score-a.score);
  const kept=[];for(const r of raw){if(kept.every(k=>iou(k.box,r.box)<=.45))kept.push(r);if(kept.length>=25)break}
  const{padX,padY,drawW,drawH}=letterbox,inW=frame.width,inH=frame.height;
  // Máscara de saída cobre só a região útil (sem padding), na resolução do protótipo.
  const mw=Math.max(1,Math.round(drawW/inW*pw)),mh=Math.max(1,Math.round(drawH/inH*ph)),ox=padX/inW*pw,oy=padY/inH*ph;
  const mask=new Uint8Array(mw*mh),plane=pw*ph,coeffs=new Float32Array(mc),boxes=[];
  for(const k of kept){
    for(let c=0;c<mc;c++)coeffs[c]=det.data[(4+classCount+c)*cand+k.i];
    const bx1=Math.floor(clamp(k.box[0]/inW*pw-ox,0,mw)),by1=Math.floor(clamp(k.box[1]/inH*ph-oy,0,mh));
    const bx2=Math.ceil(clamp(k.box[2]/inW*pw-ox,0,mw)),by2=Math.ceil(clamp(k.box[3]/inH*ph-oy,0,mh));
    for(let y=by1;y<by2;y++){
      const py=Math.min(ph-1,Math.max(0,Math.floor(y+oy)));
      for(let x=bx1;x<bx2;x++){
        const px=Math.min(pw-1,Math.max(0,Math.floor(x+ox))),p=py*pw+px;
        let s=0;for(let c=0;c<mc;c++)s+=coeffs[c]*proto.data[c*plane+p];
        if(sigmoid(s)>=.5)mask[y*mw+x]=1;
      }
    }
    const nx1=clamp((k.box[0]-padX)/drawW,0,1),ny1=clamp((k.box[1]-padY)/drawH,0,1),nx2=clamp((k.box[2]-padX)/drawW,0,1),ny2=clamp((k.box[3]-padY)/drawH,0,1);
    if(nx2>nx1&&ny2>ny1)boxes.push({x1:nx1,y1:ny1,x2:nx2,y2:ny2,label:"Fissura",score:k.score,color:CRACK_COLOR});
  }
  let area=0;for(const v of mask)area+=v;
  return{
    layers:[{id:"crack",label:"Fissura",color:CRACK_COLOR,mask,w:mw,h:mh}],
    boxes,counts:{"Fissura":boxes.length},
    metrics:{detections:boxes.length,confidence_threshold:threshold,crack_area_ratio:area/(mw*mh),candidates_above_threshold:raw.length},
    ...(opts.withCandidates?{candidates:raw.map(r=>({score:r.score,box:[clamp((r.box[0]-padX)/drawW,0,1),clamp((r.box[1]-padY)/drawH,0,1),clamp((r.box[2]-padX)/drawW,0,1),clamp((r.box[3]-padY)/drawH,0,1)]}))}:{})
  };
}

export async function runLiveEngine(engineId,frame,{loaded=null,letterbox=null,opts={}}={}){
  if(engineId==="opencv_crack")return runOpenCVLive(frame);
  if(engineId==="cdm_1")return runCdmLive(frame,opts);
  if(!loaded)throw new Error("Sessão ONNX não carregada para "+engineId);
  if(engineId==="yolov8n_public_crack_seg")return runYoloLive(loaded,frame,letterbox,opts);
  if(engineId==="segformer_public_crack"||engineId==="crackenpy_public_crack")return runSemanticOnnx(engineId,loaded,frame,opts);
  throw new Error("Motor sem suporte ao modo Live: "+engineId);
}
