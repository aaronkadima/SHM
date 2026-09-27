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
  const visible=new Uint8Array(count),nearest=new Map(),imageStride=Math.max(1,Math.floor(imageWidth));
  for(let i=0;i<count;i++){
    if(!inFrame[i])continue;
    const u=Math.max(0,Math.min(imageWidth-1,Math.round(uv[i*2])));
    const v=Math.max(0,Math.min(imageHeight-1,Math.round(uv[i*2+1])));
    const p=v*imageStride+u,front=nearest.get(p);
    if(front==null||depth[i]<front)nearest.set(p,depth[i]);
  }
  for(let i=0;i<count;i++){
    if(!inFrame[i])continue;
    const u=Math.max(0,Math.min(imageWidth-1,Math.round(uv[i*2])));
    const v=Math.max(0,Math.min(imageHeight-1,Math.round(uv[i*2+1])));
    const p=v*imageStride+u,front=nearest.get(p);
    const tolerance=Math.max(0.005,Math.abs(front)*0.015);
    if(depth[i]<=front+tolerance)visible[i]=1;
  }
  return {uv,depth,inFrame,visible,total:count};
}

export function registeredPointColors(parsed,registration,pixels){
  const projection=projectSpatialPoints(parsed,registration,pixels?.width,pixels?.height);
  if(!projection)return null;
  const fallback=elevationColors(parsed.positions),out=new Float32Array(projection.total*3);
  let colored=0;
  for(let i=0;i<projection.total;i++){
    let rr=fallback[i*3]*.45,gg=fallback[i*3+1]*.45,bb=fallback[i*3+2]*.45;
    if(projection.visible[i]){
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
    if(projection.visible[i]){
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
    colors,pointClasses,counts,matched_points:matched,visible_points:inFrame,in_frame_points:Array.from(projection.inFrame).reduce((a,b)=>a+b,0),total_points:projection.total,
    labels:PATHOLOGY_PRIORITY.slice(),
    source_analysis_size:[analysisWidth,analysisHeight],
    source_image_size:[sourceImageWidth,sourceImageHeight],
    projection
  };
}

export const CDM3_PATHOLOGY_COLORS=PATHOLOGY_COLORS;
export const CDM3_PATHOLOGY_PRIORITY=PATHOLOGY_PRIORITY;

function sampledPathPoints(points,maxPoints=64){
  if(!Array.isArray(points)||points.length<=maxPoints)return Array.isArray(points)?points:[];
  const out=[];
  for(let i=0;i<maxPoints;i++){
    const index=Math.min(points.length-1,Math.round(i*(points.length-1)/(maxPoints-1)));
    out.push(points[index]);
  }
  return out;
}

function absolutePoint(parsed,index){
  const center=parsed.bounds?.center||[0,0,0];
  return [
    Number(parsed.positions[index*3])+Number(center[0]||0),
    Number(parsed.positions[index*3+1])+Number(center[1]||0),
    Number(parsed.positions[index*3+2])+Number(center[2]||0)
  ];
}

function projectionGrid(projection,analysisWidth,analysisHeight,sourceWidth,sourceHeight,bucketSize=12){
  const grid=new Map(),sx=analysisWidth/Math.max(1,sourceWidth),sy=analysisHeight/Math.max(1,sourceHeight);
  for(let i=0;i<projection.total;i++){
    if(!projection.visible[i])continue;
    const x=projection.uv[i*2]*sx,y=projection.uv[i*2+1]*sy;
    if(!Number.isFinite(x)||!Number.isFinite(y))continue;
    const gx=Math.floor(x/bucketSize),gy=Math.floor(y/bucketSize),key=gx+","+gy;
    const row=grid.get(key)||[];row.push({index:i,x,y});grid.set(key,row);
  }
  return {grid,sx,sy,bucketSize};
}

function nearestProjectedPoint(index,target,maxDistancePx=36){
  const x=Number(target?.[0]),y=Number(target?.[1]);
  if(!Number.isFinite(x)||!Number.isFinite(y))return null;
  const {grid,bucketSize}=index,gx=Math.floor(x/bucketSize),gy=Math.floor(y/bucketSize);
  const rings=Math.max(1,Math.ceil(maxDistancePx/bucketSize));let best=null,bestD2=maxDistancePx*maxDistancePx;
  for(let ring=0;ring<=rings;ring++){
    for(let yy=gy-ring;yy<=gy+ring;yy++)for(let xx=gx-ring;xx<=gx+ring;xx++){
      if(ring>0&&xx>gx-ring&&xx<gx+ring&&yy>gy-ring&&yy<gy+ring)continue;
      for(const candidate of grid.get(xx+","+yy)||[]){
        const dx=candidate.x-x,dy=candidate.y-y,d2=dx*dx+dy*dy;
        if(d2<bestD2){bestD2=d2;best=candidate}
      }
    }
  }
  return best?{...best,distance_px:Math.sqrt(bestD2)}:null;
}

export function buildSpatialPathologyRecords(
  parsed,registration,analysis,sourceImageWidth,sourceImageHeight,
  {sourceImageName="",maxVertexReprojectionPx=36,engineVersion="CDM-3 3.0.0-dev"}={}
){
  const engine=analysis?.results?.[0]||analysis?.result||analysis;
  const imageRecords=engine?.metrics?.records||[];
  const analysisWidth=Number(analysis?.image_width||engine?.metrics?.processed_width||0);
  const analysisHeight=Number(analysis?.image_height||engine?.metrics?.processed_height||0);
  if(!imageRecords.length||!(analysisWidth>0)||!(analysisHeight>0))return [];
  const projection=projectSpatialPoints(parsed,registration,sourceImageWidth,sourceImageHeight);
  if(!projection)return [];
  const index=projectionGrid(projection,analysisWidth,analysisHeight,sourceImageWidth,sourceImageHeight);
  const metricValid=registration?.registration?.metric_projection_valid===true;
  const out=[];
  imageRecords.forEach((record,recordIndex)=>{
    const cls=String(record?.class||record?.damage_class||"");
    if(!PATHOLOGY_PRIORITY.includes(cls))return;
    const sourcePoints=sampledPathPoints(record?.points||record?.polygon||[],record?.closed?64:32);
    const matches=[],seen=new Set();
    for(const sourcePoint of sourcePoints){
      const match=nearestProjectedPoint(index,sourcePoint,maxVertexReprojectionPx);
      if(!match||seen.has(match.index))continue;
      seen.add(match.index);matches.push(match);
    }
    if(matches.length<2)return;
    const vertices=matches.map(match=>absolutePoint(parsed,match.index));
    if(record?.closed&&vertices.length>=3){
      const first=vertices[0],last=vertices.at(-1);
      if(Math.hypot(first[0]-last[0],first[1]-last[1],first[2]-last[2])>1e-9)vertices.push([...first]);
    }
    const reprojectionRmse=Math.sqrt(matches.reduce((sum,row)=>sum+row.distance_px*row.distance_px,0)/matches.length);
    out.push({
      id:String(record?.id||("cdm3-"+cls+"-"+(recordIndex+1))),
      damage_class:cls,
      source_class:cls,
      engine_version:engineVersion,
      geometry:{
        vertices_3d:vertices,
        coord_frame:"point_cloud_world",
        reprojection_error_px:reprojectionRmse,
        source_record_closed:!!record?.closed,
        source_bbox_px:record?.bbox||null,
        source_width_px:Number(record?.width_px||0),
        source_area_px2:Number(record?.area_px2||0),
        registration_metric_valid:metricValid,
        vertex_match_count:matches.length
      },
      provenance:{
        source_image:sourceImageName,
        detector:"CDM morphology bootstrap",
        detector_confidence_calibrated:false,
        registration_method:"2d_3d_correspondences_pnp_ransac",
        registration_metric_valid:metricValid
      },
      inspection:{campaign_id:analysis?.campaign_id||engine?.campaign_id||null,observed_at:analysis?.observed_at||analysis?.inspection_date||engine?.observed_at||null,source_image:sourceImageName,severity:record?.severity??null,severity_method:record?.severity_method||null},
      temporal:{track_id:record?.track_id||null,previous_observation_id:record?.previous_observation_id||null,change_status:record?.change_status||"not_compared"}
    });
  });
  return out;
}



export function toBrimDamageRecord(record){
  if(!record)return null;
  const brim=record.brim||{},bound=brim.status==="bound",inspection=record.inspection||{};
  return {
    id:record.id,
    schema:"CDM3-BrIM-Damage/1.1",
    damage_class:record.damage_class,
    host:bound?{
      express_id:brim.express_id,
      global_id:brim.global_id||null,
      name:brim.name||null,
      ifc_type:brim.type||null,
      object_type:brim.object_type||null
    }:null,
    geometry:record.geometry||null,
    association:{
      status:brim.status||"not_evaluated",
      method:brim.method||null,
      distance:Number.isFinite(brim.distance)?brim.distance:null,
      max_distance:Number.isFinite(brim.max_distance)?brim.max_distance:null
    },
    provenance:record.provenance||null
  };
}

export function buildBrimDamageDataset(records,{assetName="",ifcEngine="web-ifc"}={}){
  const items=(records||[]).map(toBrimDamageRecord).filter(Boolean);
  return {
    schema:"CDM3-BrIM-Dataset/1.1",
    asset_name:assetName,
    ifc_engine:ifcEngine,
    generated_by:"CDM-3",
    total:items.length,
    bound:items.filter(item=>item.association.status==="bound").length,
    unbound:items.filter(item=>item.association.status!=="bound").length,
    damages:items
  };
}

export function buildTemporalDamageTracks(records=[]){
  const tracks=new Map();
  for(const record of records){const key=record?.temporal?.track_id;if(!key)continue;const row=tracks.get(key)||[];row.push(record);tracks.set(key,row)}
  return Array.from(tracks,([track_id,observations])=>({track_id,observations:observations.slice().sort((a,b)=>String(a?.inspection?.observed_at||"").localeCompare(String(b?.inspection?.observed_at||""))),observation_count:observations.length}));
}

function damageCentroid(record){
  const vertices=record?.geometry?.vertices_3d;if(!Array.isArray(vertices)||!vertices.length)return null;
  const valid=vertices.filter(p=>Array.isArray(p)&&p.length>=3&&p.slice(0,3).every(v=>Number.isFinite(Number(v))));if(!valid.length)return null;
  return valid.reduce((a,p)=>[a[0]+Number(p[0]),a[1]+Number(p[1]),a[2]+Number(p[2])],[0,0,0]).map(v=>v/valid.length);
}
function comparableDamageMetric(record){
  const closed=record?.geometry?.source_record_closed,area=Number(record?.geometry?.source_area_px2),width=Number(record?.geometry?.source_width_px);
  if(closed&&area>0)return {kind:"source_area_px2",value:area};
  if(!closed&&width>0)return {kind:"source_width_px",value:width};
  return null;
}
export function matchTemporalDamageCampaigns(previousRecords=[],currentRecords=[],{maxCentroidDistance=0.5,stableTolerance=0.05}={}){
  const used=new Set(),matched=[];
  for(const current of currentRecords){
    const c=damageCentroid(current);if(!c){matched.push({...current,temporal:{...(current.temporal||{}),change_status:"not_comparable"}});continue}
    const candidates=previousRecords.map((previous,index)=>{
      if(used.has(index)||previous?.damage_class!==current?.damage_class)return null;
      const previousHost=previous?.brim?.global_id||previous?.brim?.express_id,currentHost=current?.brim?.global_id||current?.brim?.express_id;
      if(previousHost!=null&&currentHost!=null&&String(previousHost)!==String(currentHost))return null;
      const p=damageCentroid(previous);if(!p)return null;return {previous,index,distance:Math.hypot(c[0]-p[0],c[1]-p[1],c[2]-p[2])}
    }).filter(Boolean).filter(item=>item.distance<=maxCentroidDistance).sort((a,b)=>a.distance-b.distance);
    const best=candidates[0];if(!best){matched.push({...current,temporal:{...(current.temporal||{}),change_status:"unmatched"}});continue}
    used.add(best.index);
    const priorMetric=comparableDamageMetric(best.previous),metric=comparableDamageMetric(current);let change_status="not_comparable",change_ratio=null;
    if(priorMetric&&metric&&priorMetric.kind===metric.kind&&priorMetric.value>0){change_ratio=(metric.value-priorMetric.value)/priorMetric.value;change_status=Math.abs(change_ratio)<=stableTolerance?"stable":change_ratio>0?"grown":"reduced"}
    const track_id=best.previous?.temporal?.track_id||("cdm3-track-"+String(best.previous?.id||best.index));
    matched.push({...current,temporal:{...(current.temporal||{}),track_id,previous_observation_id:best.previous?.id||null,change_status,change_ratio,match_distance_3d:best.distance,match_method:"class_host_centroid_nearest"}});
  }
  return matched;
}
