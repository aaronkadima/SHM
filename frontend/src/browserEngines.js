import{runCdmBrowser}from"./cdmBrowser.js";
import{runCdm3SpatialBrowser}from"./cdm3SpatialBrowser.js";
import{spatialExtension}from"./spatialAsset.js";
import{runCrackenPyBrowser,runSegformerBrowser,runUnetCrackBrowser,runYolov8nCrackSegBrowser}from"./onnxBrowser.js";
function maxFilterHorizontal(src,w,h,r){
  const out=new Uint8Array(src.length);
  for(let y=0;y<h;y++){const row=y*w;for(let x=0;x<w;x++){let m=0;const a=Math.max(0,x-r),b=Math.min(w-1,x+r);for(let xx=a;xx<=b;xx++){const v=src[row+xx];if(v>m)m=v}out[row+x]=m}}
  return out;
}
function maxFilterVertical(src,w,h,r){
  const out=new Uint8Array(src.length);
  for(let y=0;y<h;y++){const a=Math.max(0,y-r),b=Math.min(h-1,y+r);for(let x=0;x<w;x++){let m=0;for(let yy=a;yy<=b;yy++){const v=src[yy*w+x];if(v>m)m=v}out[y*w+x]=m}}
  return out;
}
function minFilterHorizontal(src,w,h,r){
  const out=new Uint8Array(src.length);
  for(let y=0;y<h;y++){const row=y*w;for(let x=0;x<w;x++){let m=255;const a=Math.max(0,x-r),b=Math.min(w-1,x+r);for(let xx=a;xx<=b;xx++){const v=src[row+xx];if(v<m)m=v}out[row+x]=m}}
  return out;
}
function minFilterVertical(src,w,h,r){
  const out=new Uint8Array(src.length);
  for(let y=0;y<h;y++){const a=Math.max(0,y-r),b=Math.min(h-1,y+r);for(let x=0;x<w;x++){let m=255;for(let yy=a;yy<=b;yy++){const v=src[yy*w+x];if(v<m)m=v}out[y*w+x]=m}}
  return out;
}
function gaussian3(src,w,h){
  const out=new Uint8Array(src.length),k=[1,2,1];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let s=0,ws=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const yy=Math.max(0,Math.min(h-1,y+dy)),xx=Math.max(0,Math.min(w-1,x+dx));
      const ww=k[dy+1]*k[dx+1];s+=src[yy*w+xx]*ww;ws+=ww;
    }
    out[y*w+x]=Math.round(s/ws);
  }
  return out;
}
function otsu(src){
  const hist=new Uint32Array(256);for(const v of src)hist[v]++;
  const total=src.length;let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];
  let sumB=0,wB=0,maxVar=-1,threshold=0;
  for(let t=0;t<256;t++){
    wB+=hist[t];if(!wB)continue;const wF=total-wB;if(!wF)break;
    sumB+=t*hist[t];const mB=sumB/wB,mF=(sum-sumB)/wF;
    const between=wB*wF*(mB-mF)*(mB-mF);
    if(between>maxVar){maxVar=between;threshold=t}
  }
  return threshold;
}
function binaryOpen2(mask,w,h){
  const eroded=new Uint8Array(mask.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let ok=1;
    for(let dy=0;dy<=1&&ok;dy++)for(let dx=0;dx<=1;dx++){
      const yy=Math.min(h-1,y+dy),xx=Math.min(w-1,x+dx);
      if(!mask[yy*w+xx]){ok=0;break}
    }
    eroded[y*w+x]=ok;
  }
  const out=new Uint8Array(mask.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let on=0;
    for(let dy=-1;dy<=0&&!on;dy++)for(let dx=-1;dx<=0;dx++){
      const yy=Math.max(0,y+dy),xx=Math.max(0,x+dx);
      if(eroded[yy*w+xx]){on=1;break}
    }
    out[y*w+x]=on;
  }
  return out;
}
function components(mask,w,h,minArea,maxItems=120){
  const seen=new Uint8Array(mask.length),queue=new Uint32Array(mask.length),found=[];
  const dirs=[-1,1,-w,w,-w-1,-w+1,w-1,w+1];
  for(let i=0;i<mask.length;i++){
    if(!mask[i]||seen[i])continue;
    let head=0,tail=0;queue[tail++]=i;seen[i]=1;let area=0,minX=w,minY=h,maxX=0,maxY=0;
    while(head<tail){
      const p=queue[head++],y=Math.floor(p/w),x=p-y*w;area++;
      if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
      for(const d of dirs){
        const q=p+d;if(q<0||q>=mask.length||seen[q]||!mask[q])continue;
        const qy=Math.floor(q/w),qx=q-qy*w;if(Math.abs(qx-x)>1||Math.abs(qy-y)>1)continue;
        seen[q]=1;queue[tail++]=q;
      }
    }
    if(area>=minArea)found.push({area,box:[minX,minY,maxX+1,maxY+1]});
  }
  return found.sort((a,b)=>b.area-a.area).slice(0,maxItems);
}
function canvasB64(canvas){return canvas.toDataURL("image/png").split(",")[1]}

async function runOpenCVBaseline(file){
  const started=performance.now(),bmp=await createImageBitmap(file),maxSide=1280;
  const scale=Math.min(1,maxSide/Math.max(bmp.width,bmp.height));
  const w=Math.max(1,Math.round(bmp.width*scale)),h=Math.max(1,Math.round(bmp.height*scale));
  const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.drawImage(bmp,0,0,w,h);bmp.close?.();
  const img=ctx.getImageData(0,0,w,h),n=w*h,gray=new Uint8Array(n);
  for(let i=0,j=0;i<n;i++,j+=4)gray[i]=Math.round(.299*img.data[j]+.587*img.data[j+1]+.114*img.data[j+2]);

  // Aproxima cv2.MORPH_BLACKHAT com kernel retangular 15x15: closing(gray) - gray.
  const radius=7;
  const dilated=maxFilterVertical(maxFilterHorizontal(gray,w,h,radius),w,h,radius);
  const closing=minFilterVertical(minFilterHorizontal(dilated,w,h,radius),w,h,radius);
  const blackhat=new Uint8Array(n);for(let i=0;i<n;i++)blackhat[i]=Math.max(0,closing[i]-gray[i]);
  const blurred=gaussian3(blackhat,w,h),threshold=otsu(blurred);
  const rawMask=new Uint8Array(n);for(let i=0;i<n;i++)rawMask[i]=blurred[i]>threshold?1:0;
  const mask=binaryOpen2(rawMask,w,h);
  let maskArea=0;for(const v of mask)maskArea+=v;
  const minArea=Math.max(8,Math.floor(n*.00002)),comps=components(mask,w,h,minArea);
  const detections=comps.map(c=>({label:"crack_candidate",canonical_label:"crack",score:1,box:c.box,area_px:c.area}));

  ctx.putImageData(img,0,0);ctx.lineWidth=2;ctx.strokeStyle="rgb(255,80,30)";
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
    if(spatialExtension(file))return runCdm3SpatialBrowser(file,control);
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
