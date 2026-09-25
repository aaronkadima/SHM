import{browserEngineSupported,runBrowserEngine}from"../src/browserEngines.js";

const status=document.getElementById("status");
function fail(message){status.textContent="BROWSER_CRACKENPY_SMOKE_FAIL "+message;document.documentElement.dataset.smoke="fail"}
function pass(message){status.textContent="BROWSER_CRACKENPY_SMOKE_PASS "+message;document.documentElement.dataset.smoke="pass"}
async function sha256Hex(blob){
  const digest=await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());
  return[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function assets(){
  const base="/browser-models/";
  const [manifestResponse,refResponse,imgResponse,maskResponse]=await Promise.all([
    fetch(base+"crackenpy_public_crack.int8.json",{cache:"no-store"}),
    fetch(base+"crackenpy_public_crack.int8.parity.json",{cache:"no-store"}),
    fetch(base+"crackenpy_public_crack.int8.parity.png",{cache:"no-store"}),
    fetch(base+"crackenpy_public_crack.int8.parity-mask.png",{cache:"no-store"})
  ]);
  for(const [name,response] of [["manifest",manifestResponse],["parity",refResponse],["image",imgResponse],["mask",maskResponse]]){
    if(!response.ok)throw new Error(name+" asset unavailable · HTTP "+response.status);
  }
  const manifest=await manifestResponse.json(),reference=await refResponse.json(),imageBlob=await imgResponse.blob(),maskBlob=await maskResponse.blob();
  if(await sha256Hex(imageBlob)!==reference.fixture_sha256)throw new Error("fixture SHA-256 mismatch");
  if(await sha256Hex(maskBlob)!==reference.reference_mask_sha256)throw new Error("reference-mask SHA-256 mismatch");
  return{manifest,reference,imageFile:new File([imageBlob],"crackenpy-parity.png",{type:imageBlob.type||"image/png"}),maskBlob};
}
async function binaryMaskFromBlob(blob,w,h,minority=false){
  const bmp=await createImageBitmap(blob);
  try{
    const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.imageSmoothingEnabled=false;ctx.drawImage(bmp,0,0,w,h);
    const data=ctx.getImageData(0,0,w,h).data,mask=new Uint8Array(w*h);let white=0;
    for(let i=0,j=0;i<mask.length;i++,j+=4){const on=((data[j]+data[j+1]+data[j+2])/3)>=128;mask[i]=on?1:0;white+=mask[i]}
    if(minority&&white>mask.length/2)for(let i=0;i<mask.length;i++)mask[i]=mask[i]?0:1;
    return mask;
  }finally{bmp.close?.()}
}
async function binaryMaskFromBase64(base64,w,h){
  const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
  return binaryMaskFromBlob(new Blob([bytes],{type:"image/png"}),w,h,false);
}
function segmentationMetrics(pred,gt){
  if(pred.length!==gt.length)throw new Error("mask geometry mismatch");
  let inter=0,union=0,tp=0,fp=0,fn=0,predArea=0,gtArea=0;
  for(let i=0;i<pred.length;i++){
    const p=!!pred[i],g=!!gt[i];if(p)predArea++;if(g)gtArea++;
    if(p&&g){inter++;tp++}if(p||g)union++;if(p&&!g)fp++;if(!p&&g)fn++;
  }
  return{
    iou:union?inter/union:1,
    dice:(2*tp+fp+fn)?2*tp/(2*tp+fp+fn):1,
    predArea:predArea/pred.length,
    gtArea:gtArea/gt.length
  };
}

try{
  if(!browserEngineSupported("crackenpy_public_crack"))throw new Error("dispatcher does not expose CrackenPy candidate runtime");
  const{manifest,reference,imageFile,maskBlob}=await assets(),progress=[];
  if(manifest.engine_id!=="crackenpy_public_crack")throw new Error("manifest engine mismatch");
  if(manifest.quality?.passed!==true)throw new Error("export quality gate is not passed");
  const result=await runBrowserEngine("crackenpy_public_crack",imageFile,{},null,{channel:"development",onProgress:p=>progress.push(p)});
  const row=result?.results?.[0],metrics=row?.metrics||{};
  if(row?.status!=="ok")throw new Error("result status is not ok");
  if(row?.engine_id!=="crackenpy_public_crack")throw new Error("unexpected engine id");
  if(metrics.runtime!=="onnxruntime-web-wasm")throw new Error("unexpected runtime");
  if(metrics.precision!=="int8")throw new Error("INT8 precision metadata missing");
  if(!String(metrics.quantization||"").includes("qdq"))throw new Error("QDQ metadata missing");
  if(!/^[0-9a-f]{64}$/i.test(String(metrics.model_sha256||"")))throw new Error("verified model SHA-256 missing");
  if(Number(metrics.model_bytes)!==Number(manifest.bytes))throw new Error("model byte count mismatch");
  if(Number(metrics.model_bytes)>=30_000_000)throw new Error("candidate exceeds 30 MB browser budget");
  if(!row.overlay_png_base64||row.overlay_png_base64.length<100)throw new Error("overlay not produced");
  if(!row.model_mask_png_base64||row.model_mask_png_base64.length<100)throw new Error("model-space mask not produced");
  if(!progress.some(p=>p?.stage==="checksum")||!progress.some(p=>p?.stage==="inference")||!progress.some(p=>p?.stage==="done"))throw new Error("progress stages incomplete");

  const w=Number(metrics.model_width),h=Number(metrics.model_height);
  const pred=await binaryMaskFromBase64(row.model_mask_png_base64,w,h),gt=await binaryMaskFromBlob(maskBlob,w,h,true);
  const quality=segmentationMetrics(pred,gt),gates=manifest.quality?.gates||{};
  if(quality.iou<Number(gates.int8_concrete_iou_min??.60))throw new Error("browser concrete IoU gate failed · "+quality.iou.toFixed(5));
  if(quality.dice<Number(gates.int8_concrete_dice_min??.75))throw new Error("browser concrete Dice gate failed · "+quality.dice.toFixed(5));
  const referenceArea=Number(reference.reference?.metrics?.area_ratio??manifest.quality?.int8_concrete?.area_ratio??0);
  const areaDelta=Math.abs(Number(metrics.model_crack_area_ratio||0)-referenceArea);
  if(areaDelta>.005)throw new Error("browser/model reference area parity failed · Δ="+areaDelta.toFixed(6));
  pass("CrackenPy INT8 · "+Math.round(row.latency_ms)+" ms · "+(Number(metrics.model_bytes)/1e6).toFixed(1)+" MB · IoU "+quality.iou.toFixed(4)+" · Dice "+quality.dice.toFixed(4)+" · Δarea "+areaDelta.toFixed(6));
}catch(error){console.error(error);fail(error?.stack||error?.message||String(error))}
