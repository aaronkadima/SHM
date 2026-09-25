import{browserEngineSupported,runBrowserEngine}from"../src/browserEngines.js";

const status=document.getElementById("status");
function fail(message){status.textContent="BROWSER_YOLO_SMOKE_FAIL "+message;document.documentElement.dataset.smoke="fail"}
function pass(message){status.textContent="BROWSER_YOLO_SMOKE_PASS "+message;document.documentElement.dataset.smoke="pass"}

async function syntheticFile(){
  const canvas=document.createElement("canvas");canvas.width=128;canvas.height=96;
  const ctx=canvas.getContext("2d");
  ctx.fillStyle="rgb(176,174,169)";ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle="rgb(38,37,35)";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(10,80);ctx.bezierCurveTo(36,62,54,58,76,35);ctx.bezierCurveTo(90,22,103,18,118,9);ctx.stroke();
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(v=>v?resolve(v):reject(new Error("synthetic PNG failed")),"image/png"));
  return new File([blob],"yolov8n-browser-smoke.png",{type:"image/png"});
}

try{
  if(!browserEngineSupported("yolov8n_public_crack_seg"))throw new Error("dispatcher does not expose YOLOv8n candidate runtime");
  const progress=[];
  const result=await runBrowserEngine("yolov8n_public_crack_seg",await syntheticFile(),{},null,{channel:"development",onProgress:p=>progress.push(p)});
  const row=result?.results?.[0],metrics=row?.metrics||{};
  if(row?.status!=="ok")throw new Error("result status is not ok");
  if(row?.engine_id!=="yolov8n_public_crack_seg")throw new Error("unexpected engine id");
  if(metrics.runtime!=="onnxruntime-web-wasm")throw new Error("unexpected runtime");
  if(!/^[0-9a-f]{64}$/i.test(String(metrics.model_sha256||"")))throw new Error("missing verified SHA-256");
  if(Number(metrics.model_bytes)!==13288162)throw new Error("unexpected ONNX byte size");
  if(result.image_width!==128||result.image_height!==96)throw new Error("output geometry changed");
  if(!row.overlay_png_base64||row.overlay_png_base64.length<100)throw new Error("overlay not produced");
  if(!progress.some(p=>p?.stage==="checksum")||!progress.some(p=>p?.stage==="inference")||!progress.some(p=>p?.stage==="done"))throw new Error("progress stages incomplete");
  pass("YOLOv8n ONNX/WASM · "+Math.round(row.latency_ms)+" ms · "+metrics.model_sha256.slice(0,12)+" · detections "+(row.detections?.length||0));
}catch(error){console.error(error);fail(error?.stack||error?.message||String(error))}
