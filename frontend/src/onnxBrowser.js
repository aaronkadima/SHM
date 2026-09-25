const ORT_VERSION="1.30.0";
const ORT_BASE="https://cdn.jsdelivr.net/npm/onnxruntime-web@"+ORT_VERSION+"/dist/";
const ORT_SCRIPT=ORT_BASE+"ort.min.js";
let ortPromise=null;
const sessionCache=new Map();

function abortError(){return new DOMException("Execução cancelada.","AbortError")}
function ensureActive(signal){if(signal?.aborted)throw abortError()}
function progress(onProgress,completed,current_engine,stage){onProgress?.({state:"running",completed,total:100,current_engine,stage})}

function activeReleaseTag(channel){
  if(channel==="development")return"browser-models-dev";
  if(channel==="production")return"browser-models-stable";
  const base=String(import.meta.env.BASE_URL||"/");
  return base.includes("/dev/")?"browser-models-dev":"browser-models-stable";
}
function modelBaseUrl(control={}){
  if(control.modelBaseUrl)return String(control.modelBaseUrl).replace(/\/?$/,"/");
  const base=String(import.meta.env.BASE_URL||"/").replace(/\/?$/,"/");
  return new URL(base+"browser-models/",globalThis.location?.origin||"http://localhost").href;
}
function assetUrl(base,name){return base+encodeURIComponent(name)}

async function loadOrt(){
  if(globalThis.ort?.InferenceSession)return globalThis.ort;
  if(ortPromise)return ortPromise;
  ortPromise=new Promise((resolve,reject)=>{
    if(typeof document==="undefined"){reject(new Error("ONNX Runtime Web exige um navegador."));return}
    const existing=document.querySelector('script[data-shm-ort="'+ORT_VERSION+'"]');
    const finish=()=>{
      if(!globalThis.ort?.InferenceSession){reject(new Error("ONNX Runtime Web não ficou disponível após o carregamento."));return}
      globalThis.ort.env.wasm.wasmPaths=ORT_BASE;
      globalThis.ort.env.wasm.numThreads=globalThis.crossOriginIsolated?Math.max(1,Math.min(4,navigator.hardwareConcurrency||2)):1;
      resolve(globalThis.ort);
    };
    if(existing){existing.addEventListener("load",finish,{once:true});existing.addEventListener("error",()=>reject(new Error("Falha ao carregar ONNX Runtime Web.")),{once:true});return}
    const script=document.createElement("script");
    script.src=ORT_SCRIPT;script.async=true;script.crossOrigin="anonymous";script.dataset.shmOrt=ORT_VERSION;
    script.onload=finish;script.onerror=()=>reject(new Error("Falha ao carregar ONNX Runtime Web do CDN."));
    document.head.appendChild(script);
  }).catch(error=>{ortPromise=null;throw error});
  return ortPromise;
}

async function fetchJson(url,signal){
  const response=await fetch(url,{cache:"no-store",signal,headers:{Accept:"application/json","Cache-Control":"no-cache"}});
  if(!response.ok)throw new Error("Manifesto browser indisponível · HTTP "+response.status);
  return response.json();
}
async function fetchBytes(url,signal,onProgress,label,start=8,end=38){
  const response=await fetch(url,{cache:"force-cache",signal});
  if(!response.ok)throw new Error("Artefato ONNX indisponível · HTTP "+response.status);
  const total=Number(response.headers.get("content-length")||0);
  if(!response.body){
    const bytes=new Uint8Array(await response.arrayBuffer());
    progress(onProgress,end,label,"model_downloaded");
    return bytes;
  }
  const reader=response.body.getReader(),chunks=[];let received=0;
  for(;;){
    ensureActive(signal);
    const{done,value}=await reader.read();
    if(done)break;
    chunks.push(value);received+=value.byteLength;
    const fraction=total>0?Math.min(1,received/total):0;
    progress(onProgress,Math.round(start+(end-start)*fraction),label,"model_download");
  }
  const bytes=new Uint8Array(received);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
  progress(onProgress,end,label,"model_downloaded");
  return bytes;
}
async function sha256Hex(bytes){
  if(!globalThis.crypto?.subtle)throw new Error("Web Crypto indisponível para validar o modelo.");
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function getSession(engineId,control={}){
  const signal=control.signal,onProgress=control.onProgress,channel=control.channel;
  const tag=control.releaseTag||activeReleaseTag(channel),base=modelBaseUrl(control),key=base+":"+engineId;
  if(sessionCache.has(key))return sessionCache.get(key);
  const label=engineId+" · ONNX";
  ensureActive(signal);progress(onProgress,3,label,"manifest");
  const manifest=await fetchJson(assetUrl(base,engineId+".json"),signal);
  if(manifest.engine_id!==engineId)throw new Error("Manifesto ONNX pertence a outro motor.");
  progress(onProgress,6,label,"runtime");
  const ort=await loadOrt();ensureActive(signal);
  const bytes=await fetchBytes(assetUrl(base,engineId+".onnx"),signal,onProgress,label,8,38);
  ensureActive(signal);progress(onProgress,40,label,"checksum");
  const digest=await sha256Hex(bytes);
  if(String(manifest.sha256||"").toLowerCase()!==digest)throw new Error("Checksum SHA-256 do modelo ONNX não confere.");
  if(Number(manifest.bytes||0)!==bytes.byteLength)throw new Error("Tamanho do modelo ONNX difere do manifesto.");
  progress(onProgress,45,label,"session");
  const session=await ort.InferenceSession.create(bytes,{executionProviders:["wasm"],graphOptimizationLevel:"all"});
  ensureActive(signal);progress(onProgress,50,label,"session_ready");
  const loaded={ort,session,manifest,tag,base,digest};
  sessionCache.set(key,loaded);
  return loaded;
}

function resizeShape(preprocess,defaultSize=512){
  const resize=preprocess?.resize||{};
  const height=Number(resize.height||resize.shortest_edge||resize.shortestEdge||defaultSize);
  const width=Number(resize.width||resize.shortest_edge||resize.shortestEdge||defaultSize);
  return{width:Math.max(16,Math.round(width)),height:Math.max(16,Math.round(height))};
}
async function prepareRgbTensor(file,manifest,signal){
  ensureActive(signal);
  const bmp=await createImageBitmap(file);
  try{
    const maxSide=1600,scale=Math.min(1,maxSide/Math.max(1,bmp.width,bmp.height));
    const displayWidth=Math.max(1,Math.round(bmp.width*scale)),displayHeight=Math.max(1,Math.round(bmp.height*scale));
    const source=document.createElement("canvas");source.width=displayWidth;source.height=displayHeight;
    const sourceCtx=source.getContext("2d",{willReadFrequently:true});sourceCtx.drawImage(bmp,0,0,displayWidth,displayHeight);
    const target=resizeShape(manifest.preprocess,512);
    const resized=document.createElement("canvas");resized.width=target.width;resized.height=target.height;
    const ctx=resized.getContext("2d",{willReadFrequently:true});ctx.drawImage(source,0,0,target.width,target.height);
    const rgba=ctx.getImageData(0,0,target.width,target.height).data,n=target.width*target.height;
    const data=new Float32Array(n*3),mean=manifest.preprocess?.image_mean||[.485,.456,.406],std=manifest.preprocess?.image_std||[.229,.224,.225];
    const factor=Number(manifest.preprocess?.rescale_factor??(1/255));
    for(let i=0,j=0;i<n;i++,j+=4){
      data[i]=(rgba[j]*factor-Number(mean[0]??0))/Number(std[0]??1);
      data[n+i]=(rgba[j+1]*factor-Number(mean[1]??0))/Number(std[1]??1);
      data[2*n+i]=(rgba[j+2]*factor-Number(mean[2]??0))/Number(std[2]??1);
    }
    return{source,width:displayWidth,height:displayHeight,inputWidth:target.width,inputHeight:target.height,data,processedScale:scale};
  }finally{bmp.close?.()}
}
function bilinear(data,base,w,h,x,y){
  const fx=Math.max(0,Math.min(w-1,x)),fy=Math.max(0,Math.min(h-1,y));
  const x0=Math.floor(fx),y0=Math.floor(fy),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),tx=fx-x0,ty=fy-y0;
  const a=data[base+y0*w+x0]*(1-tx)+data[base+y0*w+x1]*tx;
  const b=data[base+y1*w+x0]*(1-tx)+data[base+y1*w+x1]*tx;
  return a*(1-ty)+b*ty;
}
function canvasBase64(canvas){return canvas.toDataURL("image/png").split(",")[1]}

export async function runSegformerBrowser(file,control={}){
  const started=performance.now(),signal=control.signal,onProgress=control.onProgress;
  ensureActive(signal);progress(onProgress,1,"SegFormer · preparando","start");
  const loaded=await getSession("segformer_public_crack",control);
  const{ort,session,manifest}=loaded;
  progress(onProgress,53,"SegFormer · preparando imagem","preprocess");
  const prepared=await prepareRgbTensor(file,manifest,signal);
  ensureActive(signal);
  const inputName=manifest.inputs?.[0]?.name||session.inputNames?.[0]||"pixel_values";
  const tensor=new ort.Tensor("float32",prepared.data,[1,3,prepared.inputHeight,prepared.inputWidth]);
  progress(onProgress,60,"SegFormer · inferência ONNX/WASM","inference");
  const outputs=await session.run({[inputName]:tensor});
  ensureActive(signal);progress(onProgress,78,"SegFormer · pós-processamento","postprocess");
  const outputName=manifest.outputs?.[0]?.name||session.outputNames?.[0],out=outputs[outputName]||outputs[Object.keys(outputs)[0]];
  if(!out?.data||!Array.isArray(out.dims)||out.dims.length!==4)throw new Error("Saída SegFormer ONNX inesperada.");
  const classes=Number(out.dims[1]),oh=Number(out.dims[2]),ow=Number(out.dims[3]),plane=oh*ow;
  const crackId=Math.max(0,Math.min(classes-1,Number(manifest.crack_id??1))),threshold=Number(manifest.threshold??.5);
  const canvas=prepared.source,ctx=canvas.getContext("2d",{willReadFrequently:true}),img=ctx.getImageData(0,0,prepared.width,prepared.height);
  let area=0,sumMask=0,sumAll=0,maxProb=0;
  for(let y=0;y<prepared.height;y++){
    const sy=(y+.5)*oh/prepared.height-.5;
    for(let x=0;x<prepared.width;x++){
      const sx=(x+.5)*ow/prepared.width-.5;
      let maxLog=-Infinity,best=0,crackLog=0;
      const logits=new Float32Array(classes);
      for(let cls=0;cls<classes;cls++){
        const v=bilinear(out.data,cls*plane,ow,oh,sx,sy);logits[cls]=v;
        if(v>maxLog){maxLog=v;best=cls}
        if(cls===crackId)crackLog=v;
      }
      let denom=0;for(let cls=0;cls<classes;cls++)denom+=Math.exp(logits[cls]-maxLog);
      const crackProb=Math.exp(crackLog-maxLog)/Math.max(denom,1e-12);
      sumAll+=crackProb;if(crackProb>maxProb)maxProb=crackProb;
      if(best===crackId&&crackProb>=threshold){
        area++;sumMask+=crackProb;
        const p=(y*prepared.width+x)*4;
        img.data[p]=Math.round(.58*img.data[p]+.42*255);
        img.data[p+1]=Math.round(.58*img.data[p+1]+.42*45);
        img.data[p+2]=Math.round(.58*img.data[p+2]+.42*35);
      }
    }
  }
  ctx.putImageData(img,0,0);
  const pixels=prepared.width*prepared.height,score=area?sumMask/area:maxProb;
  const detection=area?[{label:"crack",canonical_label:"crack",score,area_px:area}]:[];
  progress(onProgress,100,"SegFormer · concluído","done");
  return{
    image_width:prepared.width,image_height:prepared.height,
    results:[{
      engine_id:"segformer_public_crack",name:"SegFormer-B0 Crack Segmentation · navegador",task:"semantic_segmentation",status:"ok",
      latency_ms:performance.now()-started,detections:detection,overlay_png_base64:canvasBase64(canvas),
      metrics:{
        crack_area_ratio:Number((area/Math.max(1,pixels)).toFixed(6)),
        mean_crack_probability:Number((sumAll/Math.max(1,pixels)).toFixed(6)),
        max_crack_probability:Number(maxProb.toFixed(6)),
        threshold,source_repo:manifest.source_repo,runtime:"onnxruntime-web-wasm",
        runtime_version:ORT_VERSION,model_sha256:loaded.digest,model_bytes:Number(manifest.bytes||0),
        processed_scale:Number(prepared.processedScale.toFixed(4))
      },
      message:"SegFormer executado integralmente no navegador com artefato ONNX verificado por SHA-256."
    }],
    consensus:{},spatial_consensus:[],consensus_overlay_png_base64:null,
    metadata:{
      analysis_id:"browser-"+crypto.randomUUID(),api_version:"browser-onnx-1.0",generated_at:new Date().toISOString(),
      mode:"browser",engine_ids:["segformer_public_crack"],implementation:"segformer-onnxruntime-web-v1",model_release:loaded.tag
    }
  };
}


function sigmoid(value){
  if(value>=0){const z=Math.exp(-value);return 1/(1+z)}
  const z=Math.exp(value);return z/(1+z);
}
async function prepareLetterboxTensor(file,manifest,signal){
  ensureActive(signal);
  const bmp=await createImageBitmap(file);
  try{
    const maxSide=1600,displayScale=Math.min(1,maxSide/Math.max(1,bmp.width,bmp.height));
    const width=Math.max(1,Math.round(bmp.width*displayScale)),height=Math.max(1,Math.round(bmp.height*displayScale));
    const source=document.createElement("canvas");source.width=width;source.height=height;
    const sourceCtx=source.getContext("2d",{willReadFrequently:true});sourceCtx.drawImage(bmp,0,0,width,height);
    const letterbox=manifest.preprocess?.letterbox||{},inputWidth=Number(letterbox.width||640),inputHeight=Number(letterbox.height||640);
    const ratio=Math.min(inputWidth/width,inputHeight/height),drawWidth=Math.max(1,Math.round(width*ratio)),drawHeight=Math.max(1,Math.round(height*ratio));
    const padX=(inputWidth-drawWidth)/2,padY=(inputHeight-drawHeight)/2;
    const resized=document.createElement("canvas");resized.width=inputWidth;resized.height=inputHeight;
    const ctx=resized.getContext("2d",{willReadFrequently:true});ctx.fillStyle="rgb(114,114,114)";ctx.fillRect(0,0,inputWidth,inputHeight);
    ctx.drawImage(source,0,0,width,height,padX,padY,drawWidth,drawHeight);
    const rgba=ctx.getImageData(0,0,inputWidth,inputHeight).data,n=inputWidth*inputHeight,factor=Number(manifest.preprocess?.rescale_factor??(1/255)),data=new Float32Array(n*3);
    for(let i=0,j=0;i<n;i++,j+=4){data[i]=rgba[j]*factor;data[n+i]=rgba[j+1]*factor;data[2*n+i]=rgba[j+2]*factor}
    return{source,width,height,inputWidth,inputHeight,data,ratio,padX,padY,processedScale:displayScale};
  }finally{bmp.close?.()}
}
function clamp(value,min,max){return Math.max(min,Math.min(max,value))}
function iou(a,b){
  const x1=Math.max(a[0],b[0]),y1=Math.max(a[1],b[1]),x2=Math.min(a[2],b[2]),y2=Math.min(a[3],b[3]);
  const inter=Math.max(0,x2-x1)*Math.max(0,y2-y1),aa=Math.max(0,a[2]-a[0])*Math.max(0,a[3]-a[1]),bb=Math.max(0,b[2]-b[0])*Math.max(0,b[3]-b[1]);
  return inter/Math.max(aa+bb-inter,1e-9);
}
function nms(items,iouThreshold=.45,maxDet=40){
  const ordered=[...items].sort((a,b)=>b.score-a.score),kept=[];
  for(const item of ordered){
    let reject=false;for(const prev of kept){if(iou(item.boxInput,prev.boxInput)>iouThreshold){reject=true;break}}
    if(!reject){kept.push(item);if(kept.length>=maxDet)break}
  }
  return kept;
}
function reconstructMask(proto,coeffs,channels,w,h){
  const plane=w*h,out=new Float32Array(plane);
  for(let p=0;p<plane;p++){
    let sum=0;for(let k=0;k<channels;k++)sum+=coeffs[k]*proto[k*plane+p];
    out[p]=sigmoid(sum);
  }
  return out;
}
function sampleMask(mask,w,h,x,y){return bilinear(mask,0,w,h,x,y)}

export async function runYolov8nCrackSegBrowser(file,control={}){
  const started=performance.now(),signal=control.signal,onProgress=control.onProgress;
  ensureActive(signal);progress(onProgress,1,"YOLOv8n Crack Seg · preparando","start");
  const loaded=await getSession("yolov8n_public_crack_seg",control);
  const{ort,session,manifest}=loaded;
  progress(onProgress,53,"YOLOv8n · letterbox","preprocess");
  const prepared=await prepareLetterboxTensor(file,manifest,signal);ensureActive(signal);
  const inputName=manifest.inputs?.[0]?.name||session.inputNames?.[0]||"images";
  const tensor=new ort.Tensor("float32",prepared.data,[1,3,prepared.inputHeight,prepared.inputWidth]);
  progress(onProgress,60,"YOLOv8n · inferência ONNX/WASM","inference");
  const outputs=await session.run({[inputName]:tensor});ensureActive(signal);
  progress(onProgress,76,"YOLOv8n · NMS e máscaras","postprocess");
  const names=manifest.outputs?.map(x=>x.name)||session.outputNames||Object.keys(outputs),det=outputs[names[0]]||outputs.output0,proto=outputs[names[1]]||outputs.output1;
  if(!det?.data||!proto?.data||det.dims?.length!==3||proto.dims?.length!==4)throw new Error("Saída YOLOv8-Seg ONNX inesperada.");
  const channels=Number(det.dims[1]),candidates=Number(det.dims[2]),maskChannels=Number(proto.dims[1]),protoH=Number(proto.dims[2]),protoW=Number(proto.dims[3]);
  if(channels<5+maskChannels)throw new Error("Dimensões YOLOv8-Seg incompatíveis com coeficientes de máscara.");
  const classCount=channels-4-maskChannels,threshold=Number(manifest.threshold??.25),raw=[];
  for(let i=0;i<candidates;i++){
    let score=-Infinity,classId=0;
    for(let cls=0;cls<classCount;cls++){const value=Number(det.data[(4+cls)*candidates+i]);if(value>score){score=value;classId=cls}}
    if(score<threshold)continue;
    const cx=Number(det.data[i]),cy=Number(det.data[candidates+i]),bw=Number(det.data[2*candidates+i]),bh=Number(det.data[3*candidates+i]);
    const boxInput=[cx-bw/2,cy-bh/2,cx+bw/2,cy+bh/2],coeffs=new Float32Array(maskChannels);
    for(let k=0;k<maskChannels;k++)coeffs[k]=Number(det.data[(4+classCount+k)*candidates+i]);
    raw.push({score,classId,boxInput,coeffs});
  }
  const kept=nms(raw,.45,30),canvas=prepared.source,ctx=canvas.getContext("2d",{willReadFrequently:true}),img=ctx.getImageData(0,0,prepared.width,prepared.height),union=new Uint8Array(prepared.width*prepared.height),detections=[];
  const protoData=proto.data;
  for(const item of kept){
    ensureActive(signal);
    const[x1i,y1i,x2i,y2i]=item.boxInput;
    const x1=clamp((x1i-prepared.padX)/prepared.ratio,0,prepared.width),y1=clamp((y1i-prepared.padY)/prepared.ratio,0,prepared.height),x2=clamp((x2i-prepared.padX)/prepared.ratio,0,prepared.width),y2=clamp((y2i-prepared.padY)/prepared.ratio,0,prepared.height);
    if(x2<=x1||y2<=y1)continue;
    const mask=reconstructMask(protoData,item.coeffs,maskChannels,protoW,protoH);
    let area=0;
    const ix1=Math.max(0,Math.floor(x1)),iy1=Math.max(0,Math.floor(y1)),ix2=Math.min(prepared.width,Math.ceil(x2)),iy2=Math.min(prepared.height,Math.ceil(y2));
    for(let y=iy1;y<iy2;y++)for(let x=ix1;x<ix2;x++){
      const inputX=x*prepared.ratio+prepared.padX,inputY=y*prepared.ratio+prepared.padY,px=(inputX/prepared.inputWidth)*protoW-.5,py=(inputY/prepared.inputHeight)*protoH-.5;
      if(sampleMask(mask,protoW,protoH,px,py)<.5)continue;
      area++;union[y*prepared.width+x]=1;
      const p=(y*prepared.width+x)*4;img.data[p]=Math.round(.55*img.data[p]+.45*255);img.data[p+1]=Math.round(.55*img.data[p+1]+.45*92);img.data[p+2]=Math.round(.55*img.data[p+2]+.45*35);
    }
    detections.push({label:"crack",canonical_label:"crack",score:item.score,box:[x1,y1,x2,y2],area_px:area,class_id:item.classId});
  }
  ctx.putImageData(img,0,0);ctx.strokeStyle="rgb(255,92,35)";ctx.lineWidth=2;
  for(const d of detections){const[x1,y1,x2,y2]=d.box;ctx.strokeRect(x1,y1,x2-x1,y2-y1)}
  let maskArea=0;for(const v of union)maskArea+=v;
  progress(onProgress,100,"YOLOv8n · concluído","done");
  return{
    image_width:prepared.width,image_height:prepared.height,
    results:[{
      engine_id:"yolov8n_public_crack_seg",name:"YOLOv8n Crack Segmentation · navegador",task:"instance_segmentation",status:"ok",
      latency_ms:performance.now()-started,detections,overlay_png_base64:canvasBase64(canvas),
      metrics:{detections:detections.length,crack_area_ratio:Number((maskArea/Math.max(1,union.length)).toFixed(6)),confidence_threshold:threshold,nms_iou:.45,source_repo:manifest.source_repo,runtime:"onnxruntime-web-wasm",runtime_version:ORT_VERSION,model_sha256:loaded.digest,model_bytes:Number(manifest.bytes||0),processed_scale:Number(prepared.processedScale.toFixed(4))},
      message:"YOLOv8n-Seg executado no navegador com artefato ONNX verificado por SHA-256; runtime ainda em validação de paridade antes da promoção browser_ready."
    }],
    consensus:{},spatial_consensus:[],consensus_overlay_png_base64:null,
    metadata:{analysis_id:"browser-"+crypto.randomUUID(),api_version:"browser-onnx-1.0",generated_at:new Date().toISOString(),mode:"browser",engine_ids:["yolov8n_public_crack_seg"],implementation:"yolov8n-seg-onnxruntime-web-v1",model_release:loaded.tag}
  };
}

export function clearOnnxSessionCache(){sessionCache.clear()}
