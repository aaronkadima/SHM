// Worker persistente do modo Live: mantém sessões ONNX e executa um quadro por vez,
// para que o vídeo e a gravação na thread principal não travem durante a inferência.
import{getSession}from"./onnxBrowser.js";
import{LIVE_ENGINES,liveInputSpec,runLiveEngine}from"./liveEngines.js";

import{CONTEXT_ENGINE_ID,CONTEXT_MODES,exclusionFromClasses,runContextModel}from"./contextFilter.js";

const sessions=new Map();
// Filtro de contexto IA no Live: o mapa de cena muda devagar, então é recalculado a cada N quadros.
const CONTEXT_EVERY=6;
const ctxState={loaded:null,pending:null,failed:null,excl:null,frame:0,mode:null};
async function contextFor(frame,mode,control){
  if(ctxState.failed)return{excl:null,status:"unavailable",error:ctxState.failed};
  if(!ctxState.loaded){
    if(!ctxState.pending)ctxState.pending=getSession(CONTEXT_ENGINE_ID,control).then(l=>ctxState.loaded=l).catch(e=>{ctxState.failed=String(e?.message||e)});
    await ctxState.pending;if(!ctxState.loaded)return{excl:null,status:"unavailable",error:ctxState.failed};
  }
  if(!ctxState.excl||ctxState.mode!==mode||ctxState.frame++%CONTEXT_EVERY===0){
    const map=await runContextModel(ctxState.loaded,frame,{inputSide:256});
    ctxState.excl=exclusionFromClasses(map,ctxState.loaded.manifest.labels,mode);ctxState.mode=mode;
  }
  return{excl:ctxState.excl,status:ctxState.excl.abstained?"abstained":"ok"};
}

async function ensureEngine(engineId,control,onProgress){
  const spec=LIVE_ENGINES[engineId];
  if(!spec)throw new Error("Motor sem suporte ao modo Live: "+engineId);
  if(spec.kind!=="onnx")return{loaded:null,manifest:null};
  if(!sessions.has(engineId)){
    const pending=getSession(engineId,{...control,assetStem:spec.assetStem,onProgress}).catch(error=>{sessions.delete(engineId);throw error});
    sessions.set(engineId,pending);
  }
  const loaded=await sessions.get(engineId);
  return{loaded,manifest:loaded.manifest};
}

self.onmessage=async e=>{
  const msg=e.data||{};
  if(msg.type==="init"){
    try{
      const{manifest}=await ensureEngine(msg.engineId,msg.control||{},p=>self.postMessage({type:"progress",engineId:msg.engineId,progress:p}));
      self.postMessage({type:"ready",engineId:msg.engineId,spec:liveInputSpec(msg.engineId,manifest,msg.opts||{}),manifest:manifest?{threshold:manifest.threshold??null,source_repo:manifest.source_repo||null,sha256:manifest.sha256||null}:null});
    }catch(error){self.postMessage({type:"error",engineId:msg.engineId,stage:"init",error:String(error?.message||error)})}
    return;
  }
  if(msg.type==="frame"){
    const started=performance.now();
    try{
      const{loaded}=await ensureEngine(msg.engineId,msg.control||{},null);
      const frame={width:msg.width,height:msg.height,data:new Uint8ClampedArray(msg.buffer)};
      const opts=msg.opts||{},mode=CONTEXT_MODES[opts.cdm_context_filter]&&opts.cdm_context_filter!=="off"?opts.cdm_context_filter:null;
      const context=mode&&msg.engineId==="cdm_1"?await contextFor(frame,mode,msg.control||{}):null;
      const result=await runLiveEngine(msg.engineId,frame,{loaded,letterbox:msg.letterbox,opts:{...opts,contextExclusion:context?.excl||null}});
      if(context)result.metrics={...(result.metrics||{}),context_filter:{status:context.status,mode,excluded_ratio:context.excl?.excluded_ratio??null,error:context.error||null}};
      const transfer=result.layers.map(l=>l.mask.buffer);
      self.postMessage({type:"result",seq:msg.seq,engineId:msg.engineId,latency_ms:performance.now()-started,...result},transfer);
    }catch(error){self.postMessage({type:"error",seq:msg.seq,engineId:msg.engineId,stage:"frame",error:String(error?.message||error)})}
  }
};
