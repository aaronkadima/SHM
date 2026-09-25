import{browserEngineSupported,runBrowserEngine}from"../src/browserEngines.js";

const status=document.getElementById("status");
function fail(message){status.textContent="BROWSER_UNET_SMOKE_FAIL "+message;document.documentElement.dataset.smoke="fail"}
function pass(message){status.textContent="BROWSER_UNET_SMOKE_PASS "+message;document.documentElement.dataset.smoke="pass"}
async function sha256Hex(blob){
  const digest=await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());
  return[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function parityAssets(){
  const [refResponse,imgResponse]=await Promise.all([
    fetch("/browser-models/unet_public_crack.int8.parity.json",{cache:"no-store"}),
    fetch("/browser-models/unet_public_crack.int8.parity.png",{cache:"no-store"})
  ]);
  if(!refResponse.ok)throw new Error("INT8 parity reference unavailable · HTTP "+refResponse.status);
  if(!imgResponse.ok)throw new Error("INT8 parity fixture unavailable · HTTP "+imgResponse.status);
  const reference=await refResponse.json(),blob=await imgResponse.blob();
  const digest=await sha256Hex(blob);
  if(digest!==reference.fixture_sha256)throw new Error("INT8 parity fixture SHA-256 mismatch");
  return{reference,file:new File([blob],"unet-int8-parity.png",{type:blob.type||"image/png"})};
}
try{
  if(!browserEngineSupported("unet_public_crack"))throw new Error("dispatcher does not expose U-Net candidate runtime");
  const{reference,file}=await parityAssets(),progress=[];
  const result=await runBrowserEngine("unet_public_crack",file,{},null,{channel:"development",onProgress:p=>progress.push(p)});
  const row=result?.results?.[0],metrics=row?.metrics||{},backend=reference.reference||{},backendMetrics=backend.metrics||{},tol=reference.tolerances||{};
  if(row?.status!=="ok")throw new Error("result status is not ok");
  if(row?.engine_id!=="unet_public_crack")throw new Error("unexpected engine id");
  if(metrics.runtime!=="onnxruntime-web-wasm")throw new Error("unexpected runtime");
  if(metrics.precision!=="int8")throw new Error("optimized precision metadata missing");
  if(!String(metrics.quantization||"").includes("qdq"))throw new Error("QDQ quantization metadata missing");
  if(!/^[0-9a-f]{64}$/i.test(String(metrics.model_sha256||"")))throw new Error("missing verified model SHA-256");
  if(!(Number(metrics.model_bytes)>0&&Number(metrics.model_bytes)<50_000_000))throw new Error("optimized model is not below 50 MB");
  if(!row.overlay_png_base64||row.overlay_png_base64.length<100)throw new Error("overlay not produced");
  if(!progress.some(p=>p?.stage==="checksum")||!progress.some(p=>p?.stage==="inference")||!progress.some(p=>p?.stage==="done"))throw new Error("progress stages incomplete");

  const browserDet=row.detections||[],backendDet=backend.detections||[];
  const countDelta=Math.abs(browserDet.length-backendDet.length);
  if(countDelta>Number(tol.detection_count_delta??0))throw new Error("detection count parity failed · browser "+browserDet.length+" vs backend "+backendDet.length);

  const scoreBrowser=Number(browserDet[0]?.score??metrics.max_probability??0);
  const scoreBackend=Number(backendDet[0]?.score??backendMetrics.max_probability??0);
  const scoreDelta=Math.abs(scoreBrowser-scoreBackend);
  const areaDelta=Math.abs(Number(metrics.crack_area_ratio||0)-Number(backendMetrics.crack_area_ratio||0));
  const meanDelta=Math.abs(Number(metrics.mean_probability||0)-Number(backendMetrics.mean_probability||0));
  const maxDelta=Math.abs(Number(metrics.max_probability||0)-Number(backendMetrics.max_probability||0));
  if(scoreDelta>Number(tol.score_abs_max??.08))throw new Error("score parity failed · Δ="+scoreDelta.toFixed(6));
  if(areaDelta>Number(tol.crack_area_ratio_abs_max??.03))throw new Error("area parity failed · Δ="+areaDelta.toFixed(6));
  if(meanDelta>Number(tol.mean_probability_abs_max??.04))throw new Error("mean probability parity failed · Δ="+meanDelta.toFixed(6));
  if(maxDelta>Number(tol.max_probability_abs_max??.08))throw new Error("max probability parity failed · Δ="+maxDelta.toFixed(6));

  const qc=reference.quantization_consistency||{};
  if(Number(qc.mean_binary_iou||0)<.95)throw new Error("quantization consistency IoU below gate");
  pass("U-Net INT8 parity · "+Math.round(row.latency_ms)+" ms · "+Math.round(Number(metrics.model_bytes)/1e6)+" MB · Δscore "+scoreDelta.toFixed(5)+" · Δarea "+areaDelta.toFixed(6)+" · Q-IoU "+Number(qc.mean_binary_iou||0).toFixed(5));
}catch(error){console.error(error);fail(error?.stack||error?.message||String(error))}
