function imageFromFile(file){
  return createImageBitmap(file);
}

function maxFilterHorizontal(src,w,h,r){
  const out=new Uint8Array(src.length);
  for(let y=0;y<h;y++){
    const row=y*w;
    for(let x=0;x<w;x++){
      let m=0;
      const a=Math.max(0,x-r),b=Math.min(w-1,x+r);
      for(let xx=a;xx<=b;xx++){const v=src[row+xx];if(v>m)m=v}
      out[row+x]=m;
    }
  }
  return out;
}
function maxFilterVertical(src,w,h,r){
  const out=new Uint8Array(src.length);
  for(let y=0;y<h;y++){
    const a=Math.max(0,y-r),b=Math.min(h-1,y+r);
    for(let x=0;x<w;x++){
      let m=0;
      for(let yy=a;yy<=b;yy++){const v=src[yy*w+x];if(v>m)m=v}
      out[y*w+x]=m;
    }
  }
  return out;
}
function components(mask,strength,w,h,minArea,maxItems=80){
  const seen=new Uint8Array(mask.length);
  const queue=new Uint32Array(mask.length);
  const found=[];
  const dirs=[-1,1,-w,w,-w-1,-w+1,w-1,w+1];
  for(let i=0;i<mask.length;i++){
    if(!mask[i]||seen[i])continue;
    let head=0,tail=0;queue[tail++]=i;seen[i]=1;
    let area=0,minX=w,minY=h,maxX=0,maxY=0,sum=0;
    while(head<tail){
      const p=queue[head++],y=Math.floor(p/w),x=p-y*w;
      area++;sum+=strength[p];
      if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
      for(const d of dirs){
        const q=p+d;if(q<0||q>=mask.length||seen[q]||!mask[q])continue;
        const qy=Math.floor(q/w),qx=q-qy*w;
        if(Math.abs(qx-x)>1||Math.abs(qy-y)>1)continue;
        seen[q]=1;queue[tail++]=q;
      }
    }
    if(area>=minArea){
      found.push({area,box:[minX,minY,maxX+1,maxY+1],score:Math.min(1,(sum/area)/60)});
    }
  }
  return found.sort((a,b)=>b.area-a.area).slice(0,maxItems);
}
function canvasB64(canvas){
  return canvas.toDataURL("image/png").split(",")[1];
}

async function runOpenCVBaseline(file){
  const started=performance.now();
  const bmp=await imageFromFile(file);
  const maxSide=1280;
  const scale=Math.min(1,maxSide/Math.max(bmp.width,bmp.height));
  const w=Math.max(1,Math.round(bmp.width*scale)),h=Math.max(1,Math.round(bmp.height*scale));
  const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.drawImage(bmp,0,0,w,h);bmp.close?.();
  const img=ctx.getImageData(0,0,w,h),n=w*h;
  const gray=new Uint8Array(n);
  for(let i=0,j=0;i<n;i++,j+=4)gray[i]=Math.round(.299*img.data[j]+.587*img.data[j+1]+.114*img.data[j+2]);
  const radius=3;
  const dilated=maxFilterVertical(maxFilterHorizontal(gray,w,h,radius),w,h,radius);
  const blackhat=new Uint8Array(n);
  let sum=0,sum2=0;
  for(let i=0;i<n;i++){const v=Math.max(0,dilated[i]-gray[i]);blackhat[i]=v;sum+=v;sum2+=v*v}
  const mean=sum/n,sd=Math.sqrt(Math.max(0,sum2/n-mean*mean));
  const threshold=Math.max(10,Math.min(48,mean+1.7*sd));
  const mask=new Uint8Array(n);let candidatePixels=0;
  for(let i=0;i<n;i++){if(blackhat[i]>=threshold){mask[i]=1;candidatePixels++}}
  const minArea=Math.max(7,Math.round(n*0.000004));
  const comps=components(mask,blackhat,w,h,minArea);
  for(let i=0,j=0;i<n;i++,j+=4){
    if(mask[i]){
      img.data[j]=Math.min(255,Math.round(img.data[j]*.45+255*.55));
      img.data[j+1]=Math.round(img.data[j+1]*.45);
      img.data[j+2]=Math.round(img.data[j+2]*.45);
    }
  }
  ctx.putImageData(img,0,0);
  ctx.lineWidth=2;ctx.strokeStyle="rgba(255,215,0,.95)";ctx.font="11px system-ui";ctx.fillStyle="rgba(255,215,0,.95)";
  comps.slice(0,30).forEach((c,k)=>{const[x1,y1,x2,y2]=c.box;ctx.strokeRect(x1,y1,x2-x1,y2-y1);if(k<12)ctx.fillText("fissura?",x1+2,Math.max(11,y1-2))});
  const detections=comps.map(c=>({label:"crack_candidate",canonical_label:"crack",score:c.score,box:c.box,area_px:c.area}));
  return {
    image_width:w,image_height:h,
    results:[{
      engine_id:"opencv_crack",name:"OpenCV Crack Baseline · navegador",task:"classical",status:"ok",
      latency_ms:performance.now()-started,detections,overlay_png_base64:canvasB64(canvas),
      metrics:{components:detections.length,candidate_pixels:candidatePixels,candidate_ratio:Number((candidatePixels/n).toFixed(6)),threshold:Number(threshold.toFixed(2)),kernel_radius:radius,runtime:"browser-js"},
      message:"Baseline morfológico executado integralmente no navegador; não usa Railway."
    }],
    consensus:{},spatial_consensus:[],consensus_overlay_png_base64:null,
    metadata:{analysis_id:"browser-"+crypto.randomUUID(),api_version:"browser-1.0",generated_at:new Date().toISOString(),mode:"browser",engine_ids:["opencv_crack"]}
  };
}

export function browserEngineSupported(engineId){
  return engineId==="opencv_crack";
}
export async function runBrowserEngine(engineId,file){
  if(engineId==="opencv_crack")return runOpenCVBaseline(file);
  throw new Error("Motor ainda não possui artefato browser publicado: "+engineId);
}
