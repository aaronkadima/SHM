import{runCdmBrowser}from"./cdmBrowser.js";
import{runCdm3SpatialBrowser}from"./cdm3SpatialBrowser.js";
import{spatialExtension}from"./spatialAsset.js";
import{opencvCrackCore}from"./opencvCore.js";
import{runCrackenPyBrowser,runSegformerBrowser,runUnetCrackBrowser,runYolov8nCrackSegBrowser}from"./onnxBrowser.js";
function canvasB64(canvas){return canvas.toDataURL("image/png").split(",")[1]}

async function runOpenCVBaseline(file){
  const started=performance.now(),bmp=await createImageBitmap(file),maxSide=1280;
  const scale=Math.min(1,maxSide/Math.max(bmp.width,bmp.height));
  const w=Math.max(1,Math.round(bmp.width*scale)),h=Math.max(1,Math.round(bmp.height*scale));
  const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.drawImage(bmp,0,0,w,h);bmp.close?.();
  const img=ctx.getImageData(0,0,w,h),n=w*h;
  const{comps,threshold,maskArea}=opencvCrackCore(img.data,w,h);
  const detections=comps.map(c=>({label:"crack_candidate",canonical_label:"crack",score:1,box:c.box,area_px:c.area}));

  ctx.lineWidth=2;ctx.strokeStyle="rgb(255,80,30)";
  for(const c of comps){const[x1,y1,x2,y2]=c.box;ctx.strokeRect(x1,y1,x2-x1,y2-y1)}
  return {
    image_width:w,image_height:h,
    results:[{
      engine_id:"opencv_crack",name:"OpenCV Crack Morphology · navegador",task:"classical",status:"ok",
      latency_ms:performance.now()-started,detections,overlay_png_base64:canvasB64(canvas),
      metrics:{candidate_count:detections.length,mask_area_ratio:Number((maskArea/n).toFixed(6)),otsu_threshold:threshold,kernel:"15x15",open_kernel:"2x2",implementation:"blackhat-15x15-otsu-open2-v1",runtime:"browser-js",processed_scale:Number(scale.toFixed(4))},
      message:"Baseline morfológico executado integralmente no navegador; nenhum dado foi enviado ao Railway."
    }],
    consensus:{},spatial_consensus:[],consensus_overlay_png_base64:null,
    metadata:{analysis_id:"browser-"+crypto.randomUUID(),api_version:"browser-1.1",generated_at:new Date().toISOString(),mode:"browser",engine_ids:["opencv_crack"],implementation:"blackhat-15x15-otsu-open2-v1"}
  };
}

export function browserEngineSupported(engineId){return engineId==="opencv_crack"||engineId==="cdm_1"||engineId==="cdm_3"||engineId==="segformer_public_crack"||engineId==="yolov8n_public_crack_seg"||engineId==="unet_public_crack"||engineId==="crackenpy_public_crack"}
export async function runBrowserEngine(engineId,file,options={},previousFile=null,control={}){
  if(engineId==="opencv_crack")return runOpenCVBaseline(file);
  if(engineId==="cdm_1")return runCdmBrowser(file,options,previousFile,control);
  if(engineId==="cdm_3"){
    if(spatialExtension(file))return runCdm3SpatialBrowser(file,{...control,rgbReferenceFile:options?.rgbReferenceFile||null});
    const payload=await runCdmBrowser(file,options,null,control);
    const result=payload.results?.[0];
    if(result){
      result.engine_id="cdm_3";
      result.name="CDM-3";
      result.task="semantic_segmentation";
      result.metrics={...(result.metrics||{}),implementation:"CDM-3 3.0.0-dev",runtime_mode:"morphology_bootstrap",experimental:true,stage_c_ai_ready:false,spatial_backend_required_for:["LAS/LAZ","IFC resolve","IFC export"]};
      result.message="CDM-3 DEV no navegador: bootstrap morfológico CDM-1 ativo; checkpoint Stage-C IA ainda não foi promovido. Nenhum resultado de IA é simulado.";
    }
    payload.metadata={...(payload.metadata||{}),engine_ids:["cdm_3"],implementation:"cdm-3-dev-browser-bootstrap"};
    return payload;
  }
  if(engineId==="segformer_public_crack")return runSegformerBrowser(file,control);
  if(engineId==="yolov8n_public_crack_seg")return runYolov8nCrackSegBrowser(file,control);
  if(engineId==="unet_public_crack")return runUnetCrackBrowser(file,control);
  if(engineId==="crackenpy_public_crack")return runCrackenPyBrowser(file,control);
  throw new Error("Motor ainda não possui artefato browser publicado: "+engineId);
}
