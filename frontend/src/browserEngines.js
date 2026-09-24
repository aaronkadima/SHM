import revisions from "./browser-engine-revisions.json";

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


function meanGrayInBox(gray,w,box){
  const[x1,y1,x2,y2]=box;let sum=0,count=0;
  for(let y=Math.max(0,y1);y<Math.min(y2,Math.floor(gray.length/w));y++)for(let x=Math.max(0,x1);x<Math.min(x2,w);x++){sum+=gray[y*w+x];count++}
  return count?sum/count:255;
}
function layerOverlay(w,h,detections,label){
  const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext("2d");ctx.clearRect(0,0,w,h);ctx.lineWidth=3;
  const palette={crack:"rgba(214,52,52,.95)",spalling:"rgba(224,145,33,.95)",corrosion:"rgba(151,83,34,.95)",exposed_rebar:"rgba(53,103,162,.95)"};
  const color=palette[label]||"rgba(13,118,110,.95)";
  ctx.strokeStyle=color;ctx.fillStyle=color.replace(".95)",".14)");
  for(const d of detections.filter(x=>x.canonical_label===label)){const[x1,y1,x2,y2]=d.box;ctx.fillRect(x1,y1,x2-x1,y2-y1);ctx.strokeRect(x1,y1,x2-x1,y2-y1)}
  return canvasB64(canvas);
}
async function runCDM1(file){
  const started=performance.now(),bmp=await createImageBitmap(file),maxSide=1280;
  const scale=Math.min(1,maxSide/Math.max(bmp.width,bmp.height));
  const w=Math.max(1,Math.round(bmp.width*scale)),h=Math.max(1,Math.round(bmp.height*scale));
  const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.drawImage(bmp,0,0,w,h);bmp.close?.();
  const img=ctx.getImageData(0,0,w,h),n=w*h,gray=new Uint8Array(n);
  for(let i=0,j=0;i<n;i++,j+=4)gray[i]=Math.round(.299*img.data[j]+.587*img.data[j+1]+.114*img.data[j+2]);

  const radius=7,dilated=maxFilterVertical(maxFilterHorizontal(gray,w,h,radius),w,h,radius);
  const closing=minFilterVertical(minFilterHorizontal(dilated,w,h,radius),w,h,radius);
  const blackhat=new Uint8Array(n);for(let i=0;i<n;i++)blackhat[i]=Math.max(0,closing[i]-gray[i]);
  const blurred=gaussian3(blackhat,w,h),threshold=otsu(blurred);
  const rawMask=new Uint8Array(n);for(let i=0;i<n;i++)rawMask[i]=blurred[i]>threshold?1:0;
  const morphMask=binaryOpen2(rawMask,w,h),minArea=Math.max(10,Math.floor(n*.00002));
  const morph=components(morphMask,w,h,minArea,180);
  const detections=[];

  for(const comp of morph){
    const[x1,y1,x2,y2]=comp.box,bw=Math.max(1,x2-x1),bh=Math.max(1,y2-y1),boxArea=bw*bh;
    const aspect=Math.max(bw/bh,bh/bw),fill=comp.area/boxArea,mean=meanGrayInBox(gray,w,comp.box);
    let canonical="spalling",label="spalling_candidate";
    if(aspect>=4.5&&mean<125&&fill>.06){canonical="exposed_rebar";label="exposed_rebar_candidate"}
    else if(aspect>=2.6||fill<.2){canonical="crack";label="crack_candidate"}
    detections.push({label,canonical_label:canonical,score:1,box:comp.box,area_px:comp.area});
  }

  const corrosionRaw=new Uint8Array(n);
  for(let i=0,j=0;i<n;i++,j+=4){
    const r=img.data[j],g=img.data[j+1],b=img.data[j+2];
    corrosionRaw[i]=(r>85&&g>40&&r>g*1.08&&g>b*1.05&&r-b>35&&b<150)?1:0;
  }
  const corrosionMask=binaryOpen2(corrosionRaw,w,h);
  for(const comp of components(corrosionMask,w,h,Math.max(18,Math.floor(n*.000035)),80)){
    detections.push({label:"corrosion_candidate",canonical_label:"corrosion",score:1,box:comp.box,area_px:comp.area});
  }

  ctx.putImageData(img,0,0);ctx.lineWidth=2;
  const colors={crack:"#d63434",spalling:"#e09121",corrosion:"#975322",exposed_rebar:"#3567a2"};
  for(const d of detections){ctx.strokeStyle=colors[d.canonical_label]||"#0d766e";const[x1,y1,x2,y2]=d.box;ctx.strokeRect(x1,y1,x2-x1,y2-y1)}

  const layerDefs=[
    ["crack","Fissuras"],
    ["spalling","Desplacamento"],
    ["corrosion","Corrosão"],
    ["exposed_rebar","Armadura exposta"]
  ];
  const pathology_layers=layerDefs.map(([id,name])=>({
    id,name,
    detection_count:detections.filter(d=>d.canonical_label===id).length,
    overlay_png_base64:layerOverlay(w,h,detections,id)
  }));
  const counts=Object.fromEntries(layerDefs.map(([id])=>[id,detections.filter(d=>d.canonical_label===id).length]));
  return {
    image_width:w,image_height:h,
    results:[{
      engine_id:"cdm_1",name:"CDM-1 · Concrete Damage Morphology",task:"multi_pathology_morphology",status:"ok",
      latency_ms:performance.now()-started,detections,overlay_png_base64:canvasB64(canvas),pathology_layers,
      metrics:{...counts,otsu_threshold:threshold,kernel:"15x15",open_kernel:"2x2",implementation:revisions.cdm_1,runtime:"browser-js",processed_scale:Number(scale.toFixed(4))},
      message:"CDM-1 executado localmente no navegador com pipeline morfológico determinístico e camadas por família de manifestação patológica."
    }],
    consensus:{},spatial_consensus:[],consensus_overlay_png_base64:null,
    metadata:{analysis_id:"browser-"+crypto.randomUUID(),api_version:"browser-1.2",generated_at:new Date().toISOString(),mode:"browser",engine_ids:["cdm_1"],implementation:revisions.cdm_1}
  };
}

export function browserEngineRevision(engineId){return revisions[engineId]||null}
export function browserEngineSupported(engineId){return engineId==="opencv_crack"||engineId==="cdm_1"}
export async function runBrowserEngine(engineId,file){
  if(engineId==="opencv_crack")return runOpenCVBaseline(file);
  if(engineId==="cdm_1")return runCDM1(file);
  throw new Error("Motor ainda não possui artefato browser publicado: "+engineId);
}
