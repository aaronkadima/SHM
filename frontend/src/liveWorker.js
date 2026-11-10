// Worker persistente do modo Live: mantém sessões ONNX e executa um quadro por vez,
// para que o vídeo e a gravação na thread principal não travem durante a inferência.
import{getSession}from"./onnxBrowser.js";
import{LIVE_ENGINES,liveInputSpec,runLiveEngine}from"./liveEngines.js";

const sessions=new Map();

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
      const result=await runLiveEngine(msg.engineId,frame,{loaded,letterbox:msg.letterbox,opts:msg.opts||{}});
      const transfer=result.layers.map(l=>l.mask.buffer);
      self.postMessage({type:"result",seq:msg.seq,engineId:msg.engineId,latency_ms:performance.now()-started,...result},transfer);
    }catch(error){self.postMessage({type:"error",seq:msg.seq,engineId:msg.engineId,stage:"frame",error:String(error?.message||error)})}
  }
};
