const PATHOLOGY_COLORS={
  cracks:[230/255,0,0],
  spalling_dark:[1,153/255,0],
  exposed_rebar:[140/255,140/255,140/255],
  corrosion_rust:[139/255,63/255,0],
  efflorescence_white:[0,102/255,204/255]
};
const PATHOLOGY_PRIORITY=["exposed_rebar","corrosion_rust","cracks","spalling_dark","efflorescence_white"];

function elevationColors(positions){
  const count=(positions?.length||0)/3;if(!count)return null;
  let min=Infinity,max=-Infinity;
  for(let i=2;i<positions.length;i+=3){const z=positions[i];if(z<min)min=z;if(z>max)max=z}
  const span=Math.max(max-min,1e-9),out=new Float32Array(count*3);
  for(let i=0;i<count;i++){
    const t=Math.max(0,Math.min(1,(positions[i*3+2]-min)/span));
    out[i*3]=.12+.78*t;
    out[i*3+1]=.35+.48*(1-Math.abs(t-.5)*2);
    out[i*3+2]=.82-.62*t;
  }
  return out;
}

function poseParts(registration){
  const pose=registration?.registration||registration;
  if(!pose?.camera_matrix||!pose?.rotation_matrix||!pose?.translation_vector)return null;
  const k=pose.camera_matrix,r=pose.rotation_matrix,t=pose.translation_vector,d=pose.distortion||[];
  const fx=Number(k[0][0]),fy=Number(k[1][1]),cx=Number(k[0][2]),cy=Number(k[1][2]);
  if(![fx,fy,cx,cy].every(Number.isFinite))return null;
  return {
    r,t,fx,fy,cx,cy,
    k1:Number(d[0]||0),k2:Number(d[1]||0),p1:Number(d[2]||0),p2:Number(d[3]||0),k3:Number(d[4]||0)
  };
}

export function projectSpatialPoints(parsed,registration,imageWidth,imageHeight){
  const pose=poseParts(registration);
  if(!pose||!parsed?.positions?.length)return null;
  const center=parsed.bounds?.center||[0,0,0],count=parsed.positions.length/3;
  const uv=new Float32Array(count*2),depth=new Float32Array(count),inFrame=new Uint8Array(count);
  for(let i=0;i<count;i++){
    const X=parsed.positions[i*3]+Number(center[0]||0);
    const Y=parsed.positions[i*3+1]+Number(center[1]||0);
    const Z=parsed.positions[i*3+2]+Number(center[2]||0);
    const xc=Number(pose.r[0][0])*X+Number(pose.r[0][1])*Y+Number(pose.r[0][2])*Z+Number(pose.t[0]);
    const yc=Number(pose.r[1][0])*X+Number(pose.r[1][1])*Y+Number(pose.r[1][2])*Z+Number(pose.t[1]);
    const zc=Number(pose.r[2][0])*X+Number(pose.r[2][1])*Y+Number(pose.r[2][2])*Z+Number(pose.t[2]);
    depth[i]=zc;
    let u=NaN,v=NaN;
    if(zc>1e-9){
      const x=xc/zc,y=yc/zc,r2=x*x+y*y;
      const radial=1+pose.k1*r2+pose.k2*r2*r2+pose.k3*r2*r2*r2;
      const xd=x*radial+2*pose.p1*x*y+pose.p2*(r2+2*x*x);
      const yd=y*radial+pose.p1*(r2+2*y*y)+2*pose.p2*x*y;
      u=pose.fx*xd+pose.cx;v=pose.fy*yd+pose.cy;
      if(u>=0&&u<imageWidth&&v>=0&&v<imageHeight)inFrame[i]=1;
    }
    uv[i*2]=u;uv[i*2+1]=v;
  }
  return {uv,depth,inFrame,total:count};
}

export function registeredPointColors(parsed,registration,pixels){
  const projection=projectSpatialPoints(parsed,registration,pixels?.width,pixels?.height);
  if(!projection)return null;
  const fallback=elevationColors(parsed.positions),out=new Float32Array(projection.total*3);
  let colored=0;
  for(let i=0;i<projection.total;i++){
    let rr=fallback[i*3]*.45,gg=fallback[i*3+1]*.45,bb=fallback[i*3+2]*.45;
    if(projection.inFrame[i]){
      const u=Math.round(projection.uv[i*2]),v=Math.round(projection.uv[i*2+1]);
      if(u>=0&&u<pixels.width&&v>=0&&v<pixels.height){
        const p=(v*pixels.width+u)*4;
        rr=pixels.data[p]/255;gg=pixels.data[p+1]/255;bb=pixels.data[p+2]/255;colored++;
      }
    }
    out[i*3]=rr;out[i*3+1]=gg;out[i*3+2]=bb;
  }
  return {colors:out,colored,total:projection.total,projection};
}

function pointInPolygon(x,y,points){
  if(!Array.isArray(points)||points.length<3)return false;
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const xi=Number(points[i]?.[0]),yi=Number(points[i]?.[1]);
    const xj=Number(points[j]?.[0]),yj=Number(points[j]?.[1]);
    if(![xi,yi,xj,yj].every(Number.isFinite))continue;
    const crosses=((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi||1e-12)+xi);
    if(crosses)inside=!inside;
  }
  return inside;
}

function segmentDistance(px,py,a,b){
  const ax=Number(a?.[0]),ay=Number(a?.[1]),bx=Number(b?.[0]),by=Number(b?.[1]);
  if(![ax,ay,bx,by].every(Number.isFinite))return Infinity;
  const dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy;
  if(l2<=1e-12)return Math.hypot(px-ax,py-ay);
  const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/l2));
  return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
}

function pointNearPolyline(x,y,points,width){
  if(!Array.isArray(points)||points.length<2)return false;
  const threshold=Math.max(1.5,Number(width||1)/2+1);
  for(let i=1;i<points.length;i++)if(segmentDistance(x,y,points[i-1],points[i])<=threshold)return true;
  return false;
}

function recordContains(record,x,y){
  const points=record?.points||record?.polygon||[];
  return record?.closed?pointInPolygon(x,y,points):pointNearPolyline(x,y,points,record?.width_px);
}

export function projectPathologyToPoints(parsed,registration,analysis,sourceImageWidth,sourceImageHeight){
  const engine=analysis?.results?.[0]||analysis?.result||analysis;
  const records=engine?.metrics?.records||[];
  const analysisWidth=Number(analysis?.image_width||engine?.metrics?.processed_width||0);
  const analysisHeight=Number(analysis?.image_height||engine?.metrics?.processed_height||0);
  if(!records.length||!(analysisWidth>0)||!(analysisHeight>0))return null;
  const projection=projectSpatialPoints(parsed,registration,sourceImageWidth,sourceImageHeight);
  if(!projection)return null;

  const grouped={};
  for(const record of records){
    const cls=String(record?.class||record?.damage_class||"");
    if(!PATHOLOGY_PRIORITY.includes(cls))continue;
    (grouped[cls]||(grouped[cls]=[])).push(record);
  }
  const fallback=elevationColors(parsed.positions),colors=new Float32Array(projection.total*3);
  const pointClasses=new Int8Array(projection.total);pointClasses.fill(-1);
  const counts=Object.fromEntries(PATHOLOGY_PRIORITY.map(cls=>[cls,0]));
  let matched=0,inFrame=0;
  const sx=analysisWidth/Math.max(1,sourceImageWidth),sy=analysisHeight/Math.max(1,sourceImageHeight);
  for(let i=0;i<projection.total;i++){
    let color=[fallback[i*3]*.22,fallback[i*3+1]*.22,fallback[i*3+2]*.22];
    if(projection.inFrame[i]){
      inFrame++;
      const x=projection.uv[i*2]*sx,y=projection.uv[i*2+1]*sy;
      for(let ci=0;ci<PATHOLOGY_PRIORITY.length;ci++){
        const cls=PATHOLOGY_PRIORITY[ci],recordsForClass=grouped[cls]||[];
        if(recordsForClass.some(record=>recordContains(record,x,y))){
          pointClasses[i]=ci;counts[cls]++;matched++;color=PATHOLOGY_COLORS[cls];break;
        }
      }
    }
    colors[i*3]=color[0];colors[i*3+1]=color[1];colors[i*3+2]=color[2];
  }
  return {
    colors,pointClasses,counts,matched_points:matched,in_frame_points:inFrame,total_points:projection.total,
    labels:PATHOLOGY_PRIORITY.slice(),
    source_analysis_size:[analysisWidth,analysisHeight],
    source_image_size:[sourceImageWidth,sourceImageHeight],
    projection
  };
}

export const CDM3_PATHOLOGY_COLORS=PATHOLOGY_COLORS;
export const CDM3_PATHOLOGY_PRIORITY=PATHOLOGY_PRIORITY;
