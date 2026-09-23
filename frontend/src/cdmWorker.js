import {__cdmTest} from "./cdmBrowser.js";

self.onmessage=e=>{
  try{
    const payload=e.data||{};
    const current={
      width:payload.current.width,
      height:payload.current.height,
      data:new Uint8ClampedArray(payload.current.buffer)
    };
    const previous=payload.previous?{
      width:payload.previous.width,
      height:payload.previous.height,
      data:new Uint8ClampedArray(payload.previous.buffer)
    }:null;
    const onProgress=progress=>self.postMessage({type:"progress",progress});
    const result=__cdmTest.computeCdmCore(current,previous,payload.cfg||{},onProgress);
    self.postMessage({type:"result",ok:true,result});
  }catch(error){
    self.postMessage({type:"result",ok:false,error:String(error?.message||error)});
  }
};
