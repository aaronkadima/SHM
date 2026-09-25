import{browserEngineSupported,runBrowserEngine}from"../src/browserEngines.js";

const status=document.getElementById("status");
function fail(message){status.textContent="BROWSER_ONNX_SMOKE_FAIL "+message;document.documentElement.dataset.smoke="fail"}
function pass(message){status.textContent="BROWSER_ONNX_SMOKE_PASS "+message;document.documentElement.dataset.smoke="pass"}

async function syntheticFile(){
  const canvas=document.createElement("canvas");canvas.width=96;canvas.height=64;
  const ctx=canvas.getContext("2d");
  ctx.fillStyle="rgb(178,178,174)";ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle="rgb(45,43,42)";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(8,50);ctx.bezierCurveTo(28,38,55,30,88,12);ctx.stroke();
  ctx.fillStyle="rgb(155,151,147)";ctx.fillRect(60,42,14,8);
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(v=>v?resolve(v):reject(new Error("synthetic PNG failed")),"image/png"));
  return new File([blob],"segformer-browser-smoke.png",{type:"image/png"});
}

try{
    if(!browserEngineSupported("segformer_public_crack"))throw new Error("dispatcher does not support SegFormer");
    const progress=[];
    const result=await runBrowserEngine("segformer_public_crack",await syntheticFile(),{},null,{
      channel:"development",
      onProgress:p=>progress.push(p)
    });
    const row=result?.results?.[0],metrics=row?.metrics||{};
    if(row?.status!=="ok")throw new Error("result status is not ok");
    if(row?.engine_id!=="segformer_public_crack")throw new Error("unexpected engine id");
    if(metrics.runtime!=="onnxruntime-web-wasm")throw new Error("unexpected runtime");
    if(!/^[0-9a-f]{64}$/i.test(String(metrics.model_sha256||"")))throw new Error("missing verified SHA-256");
    if(Number(metrics.model_bytes)!==15116021)throw new Error("unexpected ONNX byte size");
    if(result.image_width!==96||result.image_height!==64)throw new Error("output geometry changed");
    if(!row.overlay_png_base64||row.overlay_png_base64.length<100)throw new Error("overlay not produced");
    if(!progress.some(p=>p?.stage==="checksum")||!progress.some(p=>p?.stage==="inference")||!progress.some(p=>p?.stage==="done"))throw new Error("progress stages incomplete");
    pass("SegFormer ONNX/WASM · "+Math.round(row.latency_ms)+" ms · "+metrics.model_sha256.slice(0,12));
}catch(error){console.error(error);fail(error?.stack||error?.message||String(error))}
