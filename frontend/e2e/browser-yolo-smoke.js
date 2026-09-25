import{browserEngineSupported,runBrowserEngine}from"../src/browserEngines.js";

const status=document.getElementById("status");
function fail(message){status.textContent="BROWSER_YOLO_SMOKE_FAIL "+message;document.documentElement.dataset.smoke="fail"}
function pass(message){status.textContent="BROWSER_YOLO_SMOKE_PASS "+message;document.documentElement.dataset.smoke="pass"}
function iou(a,b){
  if(!Array.isArray(a)||!Array.isArray(b)||a.length<4||b.length<4)return 0;
  const x1=Math.max(a[0],b[0]),y1=Math.max(a[1],b[1]),x2=Math.min(a[2],b[2]),y2=Math.min(a[3],b[3]);
  const inter=Math.max(0,x2-x1)*Math.max(0,y2-y1);
  const aa=Math.max(0,a[2]-a[0])*Math.max(0,a[3]-a[1]),bb=Math.max(0,b[2]-b[0])*Math.max(0,b[3]-b[1]);
  return inter/Math.max(aa+bb-inter,1e-9);
}
async function sha256Hex(blob){
  const digest=await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());
  return[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function parityAssets(){
  const [refResponse,imgResponse]=await Promise.all([
    fetch("/browser-models/yolov8n_public_crack_seg.parity.json",{cache:"no-store"}),
    fetch("/browser-models/yolov8n_public_crack_seg.parity.png",{cache:"no-store"})
  ]);
  if(!refResponse.ok)throw new Error("parity reference unavailable · HTTP "+refResponse.status);
  if(!imgResponse.ok)throw new Error("parity fixture unavailable · HTTP "+imgResponse.status);
  const reference=await refResponse.json(),blob=await imgResponse.blob();
  const digest=await sha256Hex(blob);
  if(digest!==reference.fixture_sha256)throw new Error("parity fixture SHA-256 mismatch");
  return{reference,file:new File([blob],"yolov8n-parity.png",{type:blob.type||"image/png"})};
}

try{
  if(!browserEngineSupported("yolov8n_public_crack_seg"))throw new Error("dispatcher does not expose YOLOv8n candidate runtime");
  const{reference,file}=await parityAssets(),progress=[];
  const result=await runBrowserEngine("yolov8n_public_crack_seg",file,{},null,{channel:"development",onProgress:p=>progress.push(p)});
  const row=result?.results?.[0],metrics=row?.metrics||{},browserDet=[...(row?.detections||[])].sort((a,b)=>Number(b.score||0)-Number(a.score||0));
  const backendDet=[...(reference.reference?.detections||[])].sort((a,b)=>Number(b.score||0)-Number(a.score||0));
  const tol=reference.tolerances||{};
  if(row?.status!=="ok")throw new Error("result status is not ok");
  if(row?.engine_id!=="yolov8n_public_crack_seg")throw new Error("unexpected engine id");
  if(metrics.runtime!=="onnxruntime-web-wasm")throw new Error("unexpected runtime");
  if(!/^[0-9a-f]{64}$/i.test(String(metrics.model_sha256||"")))throw new Error("missing verified model SHA-256");
  if(Number(metrics.model_bytes)!==13288162)throw new Error("unexpected ONNX byte size");
  if(result.image_width!==reference.image_width||result.image_height!==reference.image_height)throw new Error("fixture geometry changed");
  if(!row.overlay_png_base64||row.overlay_png_base64.length<100)throw new Error("overlay not produced");
  if(!progress.some(p=>p?.stage==="checksum")||!progress.some(p=>p?.stage==="inference")||!progress.some(p=>p?.stage==="done"))throw new Error("progress stages incomplete");

  const countDelta=Math.abs(browserDet.length-backendDet.length);
  if(countDelta>Number(tol.detection_count_delta??0))throw new Error("detection count parity failed · browser "+browserDet.length+" vs backend "+backendDet.length);
  if(browserDet.length&&backendDet.length){
    const topIou=iou(browserDet[0].box,backendDet[0].box);
    const scoreDelta=Math.abs(Number(browserDet[0].score||0)-Number(backendDet[0].score||0));
    if(topIou<Number(tol.top_box_iou_min??.9))throw new Error("top box IoU parity failed · "+topIou.toFixed(5));
    if(scoreDelta>Number(tol.top_score_abs_max??.03))throw new Error("top score parity failed · Δ="+scoreDelta.toFixed(6));
  }
  const browserArea=Number(metrics.crack_area_ratio||0),backendArea=Number(reference.reference?.metrics?.crack_area_ratio||0),areaDelta=Math.abs(browserArea-backendArea);
  if(areaDelta>Number(tol.crack_area_ratio_abs_max??.035))throw new Error("mask area parity failed · browser "+browserArea+" vs backend "+backendArea+" · Δ="+areaDelta.toFixed(6));

  const topIou=browserDet.length&&backendDet.length?iou(browserDet[0].box,backendDet[0].box):1;
  const topScoreDelta=browserDet.length&&backendDet.length?Math.abs(Number(browserDet[0].score||0)-Number(backendDet[0].score||0)):0;
  pass("YOLOv8n parity · "+Math.round(row.latency_ms)+" ms · detections "+browserDet.length+" · IoU "+topIou.toFixed(4)+" · Δscore "+topScoreDelta.toFixed(5)+" · Δarea "+areaDelta.toFixed(6));
}catch(error){console.error(error);fail(error?.stack||error?.message||String(error))}
