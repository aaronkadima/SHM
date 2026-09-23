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
    const result=__cdmTest.computeCdmCore(current,previous,payload.cfg||{});
    self.postMessage({ok:true,result});
  }catch(error){
    self.postMessage({ok:false,error:String(error?.message||error)});
  }
};
