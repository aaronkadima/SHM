import{projectSpatialPoints}from"./cdm3RegisteredProjection.js";

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const median=values=>{
  const a=values.filter(Number.isFinite).sort((x,y)=>x-y);
  if(!a.length)return 0;
  const m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
};
function luminance(r,g,b){return .2126*r+.7152*g+.0722*b}
function fallbackColors(parsed){
  if(parsed?.colors?.length)return new Float32Array(parsed.colors);
  const positions=parsed?.positions||[],count=Math.floor(positions.length/3),out=new Float32Array(count*3);
  let min=Infinity,max=-Infinity;
  for(let i=2;i<positions.length;i+=3){const z=Number(positions[i]);if(z<min)min=z;if(z>max)max=z}
  const span=Math.max(1e-9,max-min);
  for(let i=0;i<count;i++){
    const t=clamp((Number(positions[i*3+2])-min)/span,0,1);
    out[i*3]=.18+.55*t;out[i*3+1]=.28+.45*(1-Math.abs(t-.5)*1.5);out[i*3+2]=.66-.35*t;
  }
  return out;
}
export async function decodePhotometricImage(file,{maxDimension=2048}={}){
  if(!file)throw new Error("Imagem fotométrica ausente.");
  let source,sourceWidth,sourceHeight,close=()=>{};
  if(typeof createImageBitmap==="function"){
    const original=await createImageBitmap(file);
    sourceWidth=original.width;sourceHeight=original.height;
    const scale=Math.min(1,maxDimension/Math.max(sourceWidth,sourceHeight));
    if(scale<1){
      const width=Math.max(1,Math.round(sourceWidth*scale)),height=Math.max(1,Math.round(sourceHeight*scale));
      source=await createImageBitmap(file,{resizeWidth:width,resizeHeight:height,resizeQuality:"high"});
      original.close?.();
    }else source=original;
    close=()=>source.close?.();
  }else{
    const url=URL.createObjectURL(file);
    source=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error("Falha ao decodificar imagem fotométrica."));img.src=url});
    sourceWidth=source.naturalWidth;sourceHeight=source.naturalHeight;
    close=()=>URL.revokeObjectURL(url);
  }
  try{
    const scale=Math.min(1,maxDimension/Math.max(sourceWidth,sourceHeight));
    const width=Math.max(1,Math.round(sourceWidth*scale)),height=Math.max(1,Math.round(sourceHeight*scale));
    const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext("2d",{willReadFrequently:true});if(!ctx)throw new Error("Canvas 2D indisponível.");
    ctx.drawImage(source,0,0,width,height);
    return {width,height,originalWidth:sourceWidth,originalHeight:sourceHeight,scaleX:width/sourceWidth,scaleY:height/sourceHeight,data:ctx.getImageData(0,0,width,height).data};
  }finally{close()}
}
export function imagePhotometricStats(pixels){
  const data=pixels?.data||[],n=Math.floor(data.length/4);
  if(!n)return {mean:[0,0,0],luminanceMean:0,luminanceStd:0,shadowRatio:1,highlightRatio:0,sharpness:0};
  const step=Math.max(1,Math.floor(Math.sqrt(n/180000)));
  let sr=0,sg=0,sb=0,sl=0,sl2=0,samples=0,shadow=0,highlight=0,grad=0,gradN=0;
  const w=Math.max(1,Number(pixels.width)||1),h=Math.max(1,Number(pixels.height)||1);
  for(let y=0;y<h;y+=step)for(let x=0;x<w;x+=step){
    const p=(y*w+x)*4,r=data[p]/255,g=data[p+1]/255,b=data[p+2]/255,l=luminance(r,g,b);
    sr+=r;sg+=g;sb+=b;sl+=l;sl2+=l*l;samples++;if(l<.08)shadow++;if(l>.94)highlight++;
    if(x+step<w&&y+step<h){
      const pr=(y*w+x+step)*4,pd=((y+step)*w+x)*4;
      const lr=luminance(data[pr]/255,data[pr+1]/255,data[pr+2]/255),ld=luminance(data[pd]/255,data[pd+1]/255,data[pd+2]/255);
      grad+=Math.abs(lr-l)+Math.abs(ld-l);gradN+=2;
    }
  }
  const meanL=sl/Math.max(1,samples),variance=Math.max(0,sl2/Math.max(1,samples)-meanL*meanL);
  return {
    mean:[sr/samples,sg/samples,sb/samples],
    luminanceMean:meanL,luminanceStd:Math.sqrt(variance),
    shadowRatio:shadow/samples,highlightRatio:highlight/samples,
    sharpness:grad/Math.max(1,gradN)
  };
}
export function canonicalPhotometricTarget(statsList){
  const valid=(statsList||[]).filter(Boolean);
  return {
    mean:[0,1,2].map(i=>median(valid.map(s=>Number(s.mean?.[i])))),
    luminanceMean:median(valid.map(s=>Number(s.luminanceMean))),
    luminanceStd:median(valid.map(s=>Number(s.luminanceStd)))
  };
}
export function normalizePhotometricRgb(rgb,stats,target={mean:[.5,.5,.5],luminanceMean:.5,luminanceStd:.22}){
  const srcMean=stats?.mean||[.5,.5,.5],gains=[0,1,2].map(i=>clamp((target.mean?.[i]||.5)/Math.max(.03,srcMean[i]||.5),.65,1.6));
  let r=clamp(rgb[0]*gains[0],0,1),g=clamp(rgb[1]*gains[1],0,1),b=clamp(rgb[2]*gains[2],0,1);
  const y=luminance(r,g,b),sourceStd=Math.max(.035,Number(stats?.luminanceStd)||.18),contrast=clamp((Number(target.luminanceStd)||.22)/sourceStd,.72,1.45);
  let yn=clamp((Number(target.luminanceMean)||.5)+(y-(Number(stats?.luminanceMean)||.5))*contrast,0,1);
  yn=Math.pow(yn,.96);
  const scale=y>.015?clamp(yn/y,.45,2.2):1;
  return [clamp(r*scale,0,1),clamp(g*scale,0,1),clamp(b*scale,0,1)];
}
export function photometricViewWeight(stats,registration){
  const pose=registration?.registration||registration||{};
  const rmse=Math.max(0,Number(pose.reprojection_rmse_px||0));
  const inliers=Math.max(0,Number(pose.inlier_count||0)),corr=Math.max(inliers,Number(pose.correspondence_count||pose.total_correspondences||inliers||1));
  const inlierRatio=clamp(inliers/Math.max(1,corr),.15,1);
  const registrationQuality=inlierRatio/(1+rmse/4);
  const exposure=clamp(1-(Number(stats?.shadowRatio)||0)*.7-(Number(stats?.highlightRatio)||0)*.8,.2,1);
  const sharp=clamp((Number(stats?.sharpness)||0)/.08,.25,1.25);
  return clamp(registrationQuality*exposure*sharp,.03,1.4);
}
function scaledRegistration(registration,sx,sy){
  const outer=registration?.registration?{...registration,registration:{...registration.registration}}:{registration:{...(registration||{})}};
  const pose=outer.registration,k=pose.camera_matrix;
  if(Array.isArray(k)&&k.length>=3){
    pose.camera_matrix=[
      [Number(k[0][0])*sx,Number(k[0][1]||0),Number(k[0][2])*sx],
      [Number(k[1][0]||0),Number(k[1][1])*sy,Number(k[1][2])*sy],
      [Number(k[2][0]||0),Number(k[2][1]||0),Number(k[2][2]||1)]
    ];
  }
  return outer;
}
export async function fusePhotometricViews(parsed,views,{maxViews=8,maxDimension=2048}={}){
  const eligible=(views||[]).filter(v=>v?.file&&v?.registration?.registration).slice(0,maxViews);
  if(!eligible.length)return null;
  const decoded=[];
  for(const view of eligible){
    const pixels=await decodePhotometricImage(view.file,{maxDimension});
    decoded.push({view,pixels,stats:imagePhotometricStats(pixels)});
  }
  const target=canonicalPhotometricTarget(decoded.map(x=>x.stats)),count=Math.floor((parsed?.positions?.length||0)/3);
  const sumR=new Float64Array(count),sumG=new Float64Array(count),sumB=new Float64Array(count),sumW=new Float64Array(count),coverage=new Uint8Array(count);
  const perView=[];
  for(const row of decoded){
    const reg=scaledRegistration(row.view.registration,row.pixels.scaleX,row.pixels.scaleY);
    const projection=projectSpatialPoints(parsed,reg,row.pixels.width,row.pixels.height);
    if(!projection)continue;
    const globalWeight=photometricViewWeight(row.stats,row.view.registration);let contributed=0;
    for(let i=0;i<count;i++){
      if(!projection.visible[i])continue;
      const u=Math.round(projection.uv[i*2]),v=Math.round(projection.uv[i*2+1]);
      if(u<0||v<0||u>=row.pixels.width||v>=row.pixels.height)continue;
      const p=(v*row.pixels.width+u)*4;
      const rgb=normalizePhotometricRgb([row.pixels.data[p]/255,row.pixels.data[p+1]/255,row.pixels.data[p+2]/255],row.stats,target);
      const w=globalWeight;sumR[i]+=rgb[0]*w;sumG[i]+=rgb[1]*w;sumB[i]+=rgb[2]*w;sumW[i]+=w;coverage[i]=Math.min(255,coverage[i]+1);contributed++;
    }
    perView.push({id:row.view.id||row.view.file.name,name:row.view.file.name,weight:globalWeight,contributed_points:contributed,stats:row.stats});
  }
  const fallback=fallbackColors(parsed),colors=new Float32Array(count*3),confidenceColors=new Float32Array(count*3);
  let colored=0,totalCoverage=0,maxWeight=0;for(const w of sumW)if(w>maxWeight)maxWeight=w;
  for(let i=0;i<count;i++){
    if(sumW[i]>0){colors[i*3]=sumR[i]/sumW[i];colors[i*3+1]=sumG[i]/sumW[i];colors[i*3+2]=sumB[i]/sumW[i];colored++;totalCoverage+=coverage[i]}
    else{colors[i*3]=fallback[i*3]*.55;colors[i*3+1]=fallback[i*3+1]*.55;colors[i*3+2]=fallback[i*3+2]*.55}
    const c=maxWeight>0?clamp(sumW[i]/maxWeight,0,1):0;
    confidenceColors[i*3]=.12+.18*c;confidenceColors[i*3+1]=.18+.72*c;confidenceColors[i*3+2]=.30+.58*(1-c);
  }
  const coverageRatio=colored/Math.max(1,count),meanViews=colored?totalCoverage/colored:0,meanWeight=colored?Array.from(sumW).reduce((a,b)=>a+b,0)/colored:0;
  return {colors,confidenceColors,coverage,summary:{registered_views:perView.length,colored_points:colored,total_points:count,coverage_ratio:coverageRatio,mean_views_per_colored_point:meanViews,mean_confidence_weight:meanWeight,target,views:perView}};
}
export async function createPhotometricDetectionFile(file){
  const pixels=await decodePhotometricImage(file,{maxDimension:2048}),stats=imagePhotometricStats(pixels),target={mean:[.5,.5,.5],luminanceMean:.5,luminanceStd:.22};
  const canvas=document.createElement("canvas");canvas.width=pixels.width;canvas.height=pixels.height;
  const ctx=canvas.getContext("2d");if(!ctx)throw new Error("Canvas fotométrico indisponível.");
  const image=ctx.createImageData(pixels.width,pixels.height);
  for(let p=0;p<pixels.data.length;p+=4){
    const rgb=normalizePhotometricRgb([pixels.data[p]/255,pixels.data[p+1]/255,pixels.data[p+2]/255],stats,target);
    image.data[p]=Math.round(rgb[0]*255);image.data[p+1]=Math.round(rgb[1]*255);image.data[p+2]=Math.round(rgb[2]*255);image.data[p+3]=255;
  }
  ctx.putImageData(image,0,0);
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("Falha ao gerar imagem fotométrica.")),"image/png"));
  return {file:new File([blob],file.name.replace(/\.[^.]+$/,"")+"-photometric.png",{type:"image/png",lastModified:Date.now()}),stats,target,width:pixels.width,height:pixels.height};
}
