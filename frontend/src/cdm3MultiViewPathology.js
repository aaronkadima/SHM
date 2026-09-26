import{projectPathologyToPoints,CDM3_PATHOLOGY_COLORS,CDM3_PATHOLOGY_PRIORITY}from"./cdm3RegisteredProjection.js";
import{photometricViewWeight}from"./cdm3PhotometricFusion.js";

export function fusePathologyVotes(rows,pointCount,{confirmedViews=2}={}){
  const classCount=CDM3_PATHOLOGY_PRIORITY.length,colors=new Float32Array(pointCount*3),pointClasses=new Int8Array(pointCount);pointClasses.fill(-1);
  const supportCounts=new Uint8Array(pointCount),confidence=new Float32Array(pointCount);
  const counts=Object.fromEntries(CDM3_PATHOLOGY_PRIORITY.map(c=>[c,0])),confirmedCounts=Object.fromEntries(CDM3_PATHOLOGY_PRIORITY.map(c=>[c,0]));
  let matched=0,confirmed=0;
  const weights=new Float64Array(classCount),supports=new Uint8Array(classCount);
  for(let i=0;i<pointCount;i++){
    weights.fill(0);supports.fill(0);let totalPositive=0;
    for(const row of rows||[]){
      const ci=Number(row?.pointClasses?.[i]??-1);if(ci<0||ci>=classCount)continue;
      const w=Math.max(.001,Number(row.weight||1));weights[ci]+=w;supports[ci]++;totalPositive+=w;
    }
    let best=-1,bestW=0;
    for(let ci=0;ci<classCount;ci++)if(weights[ci]>bestW){bestW=weights[ci];best=ci}
    if(best<0)continue;
    const cls=CDM3_PATHOLOGY_PRIORITY[best],support=supports[best],isConfirmed=support>=Math.min(Math.max(1,confirmedViews),Math.max(1,rows.length));
    pointClasses[i]=best;supportCounts[i]=support;confidence[i]=totalPositive>0?bestW/totalPositive:0;matched++;counts[cls]++;
    if(isConfirmed){confirmed++;confirmedCounts[cls]++}
    const c=CDM3_PATHOLOGY_COLORS[cls]||[1,0,1],gain=isConfirmed?1:.48;
    colors[i*3]=c[0]*gain;colors[i*3+1]=c[1]*gain;colors[i*3+2]=c[2]*gain;
  }
  return {colors,pointClasses,supportCounts,confidence,counts,confirmed_counts:confirmedCounts,matched_points:matched,confirmed_points:confirmed,multi_view:true,views_used:rows.length,labels:CDM3_PATHOLOGY_PRIORITY.slice()};
}
export function buildMultiViewPathologyProjection(parsed,views,{confirmedViews=2}={}){
  const rows=[];
  for(const view of views||[]){
    const size=view?.source_size||view?.sourceSize;
    if(!view?.registration?.registration||!view?.analysis||!Array.isArray(size)||!(Number(size[0])>0)||!(Number(size[1])>0))continue;
    const projection=projectPathologyToPoints(parsed,view.registration,view.analysis,Number(size[0]),Number(size[1]));
    if(!projection?.pointClasses)continue;
    rows.push({id:view.id,name:view.file?.name||view.name||view.id,pointClasses:projection.pointClasses,weight:photometricViewWeight(view.photometric_stats,view.registration),projection});
  }
  if(!rows.length)return null;
  const fused=fusePathologyVotes(rows,Math.floor((parsed?.positions?.length||0)/3),{confirmedViews});
  return {...fused,source_views:rows.map(r=>({id:r.id,name:r.name,weight:r.weight,matched_points:r.projection.matched_points,visible_points:r.projection.visible_points}))};
}
