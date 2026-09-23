// Browser-native execution of Concrete Damage Morphology (CDM) 2.8.5.
// Mirrors the deterministic Python/Inkscape pipeline closely enough to keep the
// same five pathology families, record geometry contract and t0→t1 semantics.

const LABELS={
  cracks:"Fissuras",
  spalling_dark:"Desplacamento/região escura",
  exposed_rebar:"Armadura exposta",
  corrosion_rust:"Corrosão aparente",
  efflorescence_white:"Eflorescência/região clara",
};
const ORDER=["exposed_rebar","spalling_dark","corrosion_rust","efflorescence_white","cracks"];
const COLORS={
  cracks:[230,0,0],spalling_dark:[255,153,0],exposed_rebar:[140,140,140],
  corrosion_rust:[139,63,0],efflorescence_white:[0,102,204],
  growth:[0,145,90],reduction:[112,78,170],
};
const FP={cracks:3,spalling_dark:4,exposed_rebar:5,corrosion_rust:5,efflorescence_white:2};
const FR={
  barreiras_guarda_corpo_pista:1,juntas_dilatacao:2,transversinas_cortinas_alas:3,
  lajes_vigas_secundarias_apoios:4,vigas_pilares_principais:5
};
const FAMILY_LABELS={
  barreiras_guarda_corpo_pista:"Barreiras/guarda-corpo/pista",
  juntas_dilatacao:"Juntas de dilatação",
  transversinas_cortinas_alas:"Transversinas/cortinas/alas",
  lajes_vigas_secundarias_apoios:"Lajes/vigas secundárias/aparelhos de apoio",
  vigas_pilares_principais:"Vigas e pilares principais"
};

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const oddKernel=k=>{k=Math.max(3,Math.round(k));return k%2?k:k+1};
function swap(a,i,j){const v=a[i];a[i]=a[j];a[j]=v}
function quickselect(a,k,left=0,right=a.length-1){
  while(left<right){
    let pivotIndex=(left+right)>>1,pivot=a[pivotIndex];swap(a,pivotIndex,right);
    let store=left;
    for(let i=left;i<right;i++)if(a[i]<pivot){swap(a,store,i);store++}
    swap(a,right,store);
    if(k===store)return a[k];
    if(k<store)right=store-1;else left=store+1;
  }
  return a[k];
}
function percentileFloat(src,p,mask=null){
  let count=0;
  if(mask){for(let i=0;i<src.length;i++)if(mask[i])count++}else count=src.length;
  if(!count)return 0;
  const values=new Float32Array(count);let j=0;
  for(let i=0;i<src.length;i++)if(!mask||mask[i])values[j++]=src[i];
  const q=clamp(Number(p),0,100)/100*(count-1),lo=Math.floor(q),hi=Math.ceil(q);
  const vlo=quickselect(values,lo);
  if(hi===lo)return vlo;
  const vhi=quickselect(values,hi,lo+1,count-1);
  return vlo+(vhi-vlo)*(q-lo);
}
function grayAndRgb(imageData){
  const n=imageData.width*imageData.height,gray=new Float32Array(n),rgb=imageData.data;
  for(let i=0,j=0;i<n;i++,j+=4)gray[i]=.299*rgb[j]+.587*rgb[j+1]+.114*rgb[j+2];
  const p2=percentileFloat(gray,2),p98=percentileFloat(gray,98),out=new Float32Array(n);
  if(p98<=p2+1e-6){out.set(gray);return {gray:out,rgb}}
  const factor=255/(p98-p2);for(let i=0;i<n;i++)out[i]=clamp((gray[i]-p2)*factor,0,255);
  return {gray:out,rgb};
}
function hsvArrays(rgba,n){
  const hue=new Float32Array(n),sat=new Float32Array(n),val=new Float32Array(n);
  for(let i=0,j=0;i<n;i++,j+=4){
    const r=rgba[j]/255,g=rgba[j+1]/255,b=rgba[j+2]/255;
    const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;let h=0;
    if(d>1e-6){
      if(mx===r)h=((g-b)/d)%6;
      else if(mx===g)h=(b-r)/d+2;
      else h=(r-g)/d+4;
      h*=60;if(h<0)h+=360;
    }
    hue[i]=h;sat[i]=mx<=1e-6?0:d/mx;val[i]=mx;
  }
  return {hue,sat,val};
}
function filterFloat1D(src,w,h,k,isMax,horizontal){
  const r=Math.floor(k/2),out=new Float32Array(src.length),n=horizontal?w:h,lines=horizontal?h:w;
  const extN=n+2*r,dequeIdx=new Int32Array(extN),dequeVal=new Float32Array(extN);
  for(let line=0;line<lines;line++){
    let head=0,tail=0;
    for(let j=0;j<extN;j++){
      const logical=clamp(j-r,0,n-1);
      const pos=horizontal?line*w+logical:logical*w+line;
      const v=src[pos];
      while(tail>head&&(isMax?dequeVal[tail-1]<=v:dequeVal[tail-1]>=v))tail--;
      dequeIdx[tail]=j;dequeVal[tail]=v;tail++;
      const left=j-k+1;while(tail>head&&dequeIdx[head]<left)head++;
      if(j>=k-1){
        const o=j-(k-1),outPos=horizontal?line*w+o:o*w+line;
        out[outPos]=dequeVal[head];
      }
    }
  }
  return out;
}
function filterFloat(src,w,h,k,isMax){
  k=oddKernel(k);
  return filterFloat1D(filterFloat1D(src,w,h,k,isMax,true),w,h,k,isMax,false);
}
function filterMask1D(src,w,h,k,isMax,horizontal){
  const r=Math.floor(k/2),out=new Uint8Array(src.length),n=horizontal?w:h,lines=horizontal?h:w;
  const extN=n+2*r,dequeIdx=new Int32Array(extN),dequeVal=new Uint8Array(extN);
  for(let line=0;line<lines;line++){
    let head=0,tail=0;
    for(let j=0;j<extN;j++){
      const logical=clamp(j-r,0,n-1),pos=horizontal?line*w+logical:logical*w+line,v=src[pos];
      while(tail>head&&(isMax?dequeVal[tail-1]<=v:dequeVal[tail-1]>=v))tail--;
      dequeIdx[tail]=j;dequeVal[tail]=v;tail++;
      const left=j-k+1;while(tail>head&&dequeIdx[head]<left)head++;
      if(j>=k-1){const o=j-(k-1),outPos=horizontal?line*w+o:o*w+line;out[outPos]=dequeVal[head]}
    }
  }
  return out;
}
function filterMask(src,w,h,k,isMax){
  k=oddKernel(k);
  return filterMask1D(filterMask1D(src,w,h,k,isMax,true),w,h,k,isMax,false);
}
function cleanup(mask,w,h,k){
  const eroded=filterMask(mask,w,h,k,false),opened=filterMask(eroded,w,h,k,true);
  const dilated=filterMask(opened,w,h,k,true),closed=filterMask(dilated,w,h,k,false);
  return closed;
}
function blackhat(gray,w,h,k){
  const dilated=filterFloat(gray,w,h,k,true),closed=filterFloat(dilated,w,h,k,false),out=new Float32Array(gray.length);
  for(let i=0;i<out.length;i++)out[i]=clamp(closed[i]-gray[i],0,255);
  return out;
}
function detectMasks(imageData,cfg){
  const w=imageData.width,h=imageData.height,n=w*h,{gray,rgb}=grayAndRgb(imageData),{hue,sat,val}=hsvArrays(rgb,n);
  const k=oddKernel(cfg.kernel),masks={};

  const crackResponse=blackhat(gray,w,h,k),crackRaw=new Uint8Array(n);
  for(let i=0;i<n;i++)crackRaw[i]=crackResponse[i]>cfg.threshold?1:0;
  masks.cracks=cleanup(crackRaw,w,h,3);

  const p18=percentileFloat(gray,18),p45=percentileFloat(gray,45);
  const darkCut=Math.min(120,p18+Math.max(8,cfg.threshold*.25));
  const texture=blackhat(gray,w,h,Math.max(5,Math.min(k,21))),spRaw=new Uint8Array(n);
  for(let i=0;i<n;i++)spRaw[i]=(gray[i]<darkCut||(texture[i]>Math.max(10,cfg.threshold*.55)&&gray[i]<p45))?1:0;
  const spalling=cleanup(spRaw,w,h,5);masks.spalling_dark=spalling;

  const corrosionRaw=new Uint8Array(n),effRaw=new Uint8Array(n),p72=percentileFloat(gray,72);
  for(let i=0,j=0;i<n;i++,j+=4){
    const r=rgb[j],g=rgb[j+1],b=rgb[j+2],hv=hue[i],sv=sat[i],vv=val[i];
    corrosionRaw[i]=(r>g+12&&r>b+18&&sv>.22&&vv>.16&&(hv<55||hv>330))?1:0;
    effRaw[i]=(vv>.72&&sv<.28&&gray[i]>p72)?1:0;
  }
  masks.corrosion_rust=cleanup(corrosionRaw,w,h,5);
  masks.efflorescence_white=cleanup(effRaw,w,h,5);

  const localThresh=spalling.some(v=>v)?percentileFloat(gray,40,spalling):percentileFloat(gray,12);
  const rebarRaw=new Uint8Array(n);
  for(let i=0;i<n;i++)rebarRaw[i]=(spalling[i]&&(gray[i]<localThresh||(sat[i]<.20&&val[i]<.55)))?1:0;
  masks.exposed_rebar=cleanup(rebarRaw,w,h,3);
  return masks;
}
function convexHull(points){
  if(points.length<=1)return points;
  points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lo=[];for(const p of points){while(lo.length>=2&&cross(lo.at(-2),lo.at(-1),p)<=0)lo.pop();lo.push(p)}
  const up=[];for(let i=points.length-1;i>=0;i--){const p=points[i];while(up.length>=2&&cross(up.at(-2),up.at(-1),p)<=0)up.pop();up.push(p)}
  lo.pop();up.pop();return lo.concat(up);
}
function isBoundary(mask,w,h,p){
  const y=Math.floor(p/w),x=p-y*w;
  for(let yy=Math.max(0,y-1);yy<=Math.min(h-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(w-1,x+1);xx++)if(!mask[yy*w+xx])return true;
  return false;
}
function recordsFromMask(mask,w,h,damageClass,timeLabel,cfg){
  const seen=new Uint8Array(mask.length),queue=new Uint32Array(mask.length),records=[],minArea=Math.max(1,cfg.minArea),minAspect=cfg.minAspect;
  let componentNumber=0;
  for(let start=0;start<mask.length;start++){
    if(!mask[start]||seen[start])continue;
    let head=0,tail=0;queue[tail++]=start;seen[start]=1;
    let minX=w,minY=h,maxX=0,maxY=0,sumX=0,sumY=0;
    while(head<tail){
      const p=queue[head++],y=Math.floor(p/w),x=p-y*w;
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);sumX+=x;sumY+=y;
      for(let ny=Math.max(0,y-1);ny<=Math.min(h-1,y+1);ny++)for(let nx=Math.max(0,x-1);nx<=Math.min(w-1,x+1);nx++){
        if(nx===x&&ny===y)continue;const q=ny*w+nx;if(mask[q]&&!seen[q]){seen[q]=1;queue[tail++]=q}
      }
    }
    if(tail<minArea)continue;
    componentNumber++;
    const bw=maxX-minX+1,bh=maxY-minY+1,minor=Math.max(1,Math.min(bw,bh)),major=Math.max(bw,bh),aspect=major/minor;
    if(damageClass==="cracks"&&aspect<minAspect)continue;
    if(damageClass==="exposed_rebar"&&aspect<Math.max(2,minAspect))continue;

    let perimeter=0;for(let q=0;q<tail;q++)if(isBoundary(mask,w,h,queue[q]))perimeter++;
    let points,length,widthPx,closed,note;
    if(damageClass==="cracks"){
      const mx=sumX/tail,my=sumY/tail;let sxx=0,syy=0,sxy=0;
      for(let q=0;q<tail;q++){const p=queue[q],y=Math.floor(p/w),x=p-y*w,dx=x-mx,dy=y-my;sxx+=dx*dx;syy+=dy*dy;sxy+=dx*dy}
      const angle=.5*Math.atan2(2*sxy,sxx-syy),vx=Math.cos(angle),vy=Math.sin(angle);let pmin=Infinity,pmax=-Infinity;
      for(let q=0;q<tail;q++){const p=queue[q],y=Math.floor(p/w),x=p-y*w,proj=(x-mx)*vx+(y-my)*vy;pmin=Math.min(pmin,proj);pmax=Math.max(pmax,proj)}
      points=[[mx+vx*pmin,my+vy*pmin],[mx+vx*pmax,my+vy*pmax]];length=Math.max(0,pmax-pmin);widthPx=tail/Math.max(length,1e-6);closed=false;
      note="Browser CDM: fissura por linha central PCA; largura estimada = área/comprimento.";
    }else{
      const step=Math.max(1,Math.floor(perimeter/2500)),boundary=[];let bi=0;
      for(let q=0;q<tail;q++)if(isBoundary(mask,w,h,queue[q])){if(bi%step===0){const p=queue[q],y=Math.floor(p/w),x=p-y*w;boundary.push([x,y])}bi++}
      points=convexHull(boundary);length=damageClass==="exposed_rebar"?major:perimeter;widthPx=minor;closed=true;
      note=damageClass==="exposed_rebar"?"Browser CDM: armadura exposta por polígono alongado no desplacamento.":"Browser CDM: região representada por polígono convexo aproximado.";
    }
    if(points.length<2)continue;
    records.push({
      id:timeLabel+"_"+damageClass+"_"+String(componentNumber).padStart(4,"0"),
      time_label:timeLabel,class:damageClass,bbox:[minX,minY,bw,bh],points,closed,
      area_px2:tail,perimeter_px:perimeter,length_px:length,width_px:widthPx,aspect_ratio:aspect,confidence_note:note
    });
  }
  return records;
}
function renderLayer(records,w,h,color){
  const c=document.createElement("canvas");c.width=w;c.height=h;const ctx=c.getContext("2d");
  ctx.lineCap="round";ctx.lineJoin="round";
  for(const r of records){
    if(!r.points?.length)continue;ctx.beginPath();ctx.moveTo(r.points[0][0],r.points[0][1]);for(let i=1;i<r.points.length;i++)ctx.lineTo(r.points[i][0],r.points[i][1]);
    if(r.closed){ctx.closePath();ctx.fillStyle="rgba("+color.join(",")+",.59)";ctx.fill();ctx.strokeStyle="rgba("+color.join(",")+",.95)";ctx.lineWidth=1;ctx.stroke()}
    else{ctx.strokeStyle="rgba("+color.join(",")+",.82)";ctx.lineWidth=Math.max(1,r.width_px);ctx.stroke()}
  }
  return c.toDataURL("image/png").split(",")[1];
}
function temporalCompare(cur,prev,w,h,cfg){
  const stats={},records=[];
  for(const cls of Object.keys(cur)){
    const a=cur[cls],b=prev[cls];if(!b)continue;
    const growth=new Uint8Array(a.length),reduction=new Uint8Array(a.length);let inter=0,union=0,g=0,r=0;
    for(let i=0;i<a.length;i++){if(a[i]&&b[i])inter++;if(a[i]||b[i])union++;if(a[i]&&!b[i]){growth[i]=1;g++}if(b[i]&&!a[i]){reduction[i]=1;r++}}
    stats[cls]={iou:union?inter/union:1,growth_area_px2:g,reduction_area_px2:r};
    const gr=recordsFromMask(growth,w,h,"growth","growth_"+cls,cfg),rr=recordsFromMask(reduction,w,h,"reduction","reduction_"+cls,cfg);
    gr.forEach(x=>x.confidence_note+=" Classe base: "+LABELS[cls]+".");rr.forEach(x=>x.confidence_note+=" Classe base: "+LABELS[cls]+".");
    records.push(...gr,...rr);
  }
  return {stats,records};
}
function fiMetric(cls,r,ref,mm){
  const ar=r.area_px2/Math.max(ref,1);
  if(cls==="spalling_dark"||cls==="corrosion_rust"){if(ar<=.0005)return 1;if(ar<=.003)return 2;if(ar<=.015)return 3;return 4}
  if(cls==="exposed_rebar"){if(ar<=.0002)return 2;if(ar<=.0015)return 3;return 4}
  if(cls==="efflorescence_white"){if(ar<=.001)return 1;if(ar<=.01)return 2;return 3}
  if(cls==="cracks"){
    const density=r.length_px/Math.max(Math.sqrt(Math.max(ref,1)),1),wv=mm>0?r.width_px*mm:r.width_px;
    const limits=mm>0?[[.2,.05,1],[.4,.12,2],[1,.3,3]]:[[2,.05,1],[4,.12,2],[8,.3,3]];
    for(const [wl,dl,f] of limits)if(wv<=wl&&density<=dl)return f;return 4;
  }
  return 0;
}
function severity(cls,r,ref,mm){
  const ar=r.area_px2/Math.max(ref,1);
  if(cls==="cracks"){const density=r.length_px/Math.max(Math.sqrt(Math.max(ref,1)),1),wv=mm>0?r.width_px*mm:r.width_px;return clamp(.65*Math.min(1,wv/(mm>0?1:8))+.35*Math.min(1,density/.3),0,1)}
  if(cls==="spalling_dark"||cls==="corrosion_rust")return Math.min(1,ar/.015);
  if(cls==="exposed_rebar")return Math.max(.35,Math.min(1,ar/.0015));
  if(cls==="efflorescence_white")return Math.min(1,ar/.01);
  return 0;
}
const ecFromRank=rank=>{const ec=clamp(5-rank,1,4);return [ec,{4:"Bom",3:"Razoável",2:"Ruim",1:"Severo"}[ec]]};
function gdeClass(v){if(v<=15)return["Baixo","Estado aceitável; manutenção preventiva."];if(v<=50)return["Médio","Planejar nova inspeção e intervenção em longo prazo."];if(v<=80)return["Alto","Planejar inspeção especializada e intervenção em médio prazo."];if(v<=100)return["Sofrível","Inspeção especializada rigorosa e intervenção em curto prazo."];return["Crítico","Inspeção especializada imediata e medidas emergenciais."]}
function conditionRating(records,cfg,imageArea){
  const mm=cfg.mmPerPx>0?cfg.mmPerPx:null,damageRows=[],dValues=[],ranks=[],severities=[];let affected=0,maxFi=0;
  for(const r of records){
    const cls=r.class;if(!(cls in FP))continue;
    const fi=fiMetric(cls,r,imageArea,mm),fp=FP[cls],D=fi<=0?0:fi<=2?.8*fi*fp:(12*fi-28)*fp,s=severity(cls,r,imageArea,mm),rank=1+[.25,.5,.75].filter(t=>s>=t).length,[ec,ecLabel]=ecFromRank(rank);
    maxFi=Math.max(maxFi,fi);if(D>0)dValues.push(D);ranks.push(rank);severities.push(s);affected+=r.area_px2;
    damageRows.push({record_id:r.id,class:cls,class_label:LABELS[cls],area_ratio:r.area_px2/Math.max(imageArea,1),s_img:s,EC_rank_img:rank,EC_DNIT_damage_img:ec,EC_DNIT_damage_label:ecLabel,Fi:fi,Fp:fp,D,included_in_rating:true});
  }
  const familyRows=Object.keys(LABELS).map(cls=>{
    const rows=damageRows.filter(r=>r.class===cls);
    if(!rows.length)return {class:cls,class_label:LABELS[cls],n:0,area_ratio_sum:0,s_max:0,s_mean:0,EC_rank_family_img:0,EC_DNIT_family_img:4,EC_DNIT_family_label:"Bom",governing_record_id:"",delta_family:0,Fi_max:0,D_sum:0,included_in_rating:true,formula_trace:"sem detecção"};
    const area=rows.reduce((s,r)=>s+r.area_ratio,0),maxRank=Math.max(...rows.map(r=>r.EC_rank_img)),delta=(rows.length>=5||area>=.015)?1:0,famRank=Math.min(4,maxRank+delta),[ec,label]=ecFromRank(famRank);
    const gov=rows.slice().sort((a,b)=>b.EC_rank_img-a.EC_rank_img||b.s_img-a.s_img||b.D-a.D)[0];
    return {class:cls,class_label:LABELS[cls],n:rows.length,area_ratio_sum:area,s_max:Math.max(...rows.map(r=>r.s_img)),s_mean:rows.reduce((s,r)=>s+r.s_img,0)/rows.length,EC_rank_family_img:famRank,EC_DNIT_family_img:ec,EC_DNIT_family_label:label,governing_record_id:gov.record_id,delta_family:delta,Fi_max:Math.max(...rows.map(r=>r.Fi)),D_sum:rows.reduce((s,r)=>s+r.D,0),included_in_rating:true,formula_trace:"browser parity: max EC_rank + extensão/recorrência"};
  });
  let gde=0;if(dValues.length){const dmax=Math.max(...dValues),sum=dValues.reduce((a,b)=>a+b,0);gde=dmax*(1+(sum-dmax)/sum)}
  const [gdeLevel,gdeAction]=gdeClass(gde),fr=FR[cfg.elementFamily]||4,areaRatio=affected/Math.max(imageArea,1),maxRank=ranks.length?Math.max(...ranks):0,delta=maxRank&&(ranks.length>=5||areaRatio>=.015)?1:0,elementRank=maxRank?Math.min(4,maxRank+delta):0;
  const [ec,ecLabel]=elementRank?ecFromRank(elementRank):[4,"Bom"];const critical=fr>=4;
  let nt=5,ntLabel="Excelente/sem dano detectado";
  if(elementRank){const sr=critical?elementRank:(elementRank<4?Math.max(1,elementRank-1):3);[nt,ntLabel]=({1:[4,"Boa"],2:[3,"Regular"],3:[2,"Ruim"],4:[1,"Crítica"]}[sr]||[3,"Regular"])}
  return {enabled:true,method:"ordinal_normative_v285_browser",reference_area_px2:imageArea,affected_area_ratio:areaRatio,damage_rows:damageRows,family_rows:familyRows,GDE_img:gde,GDE:gde,GDE_level:gdeLevel,GDE_action:gdeAction,Fr:fr,family:cfg.elementFamily,family_label:FAMILY_LABELS[cfg.elementFamily]||cfg.elementFamily,K:gde*fr,critical_element:critical,delta_extension_recurrence:delta,EC_rank_element_img:elementRank,EC_DNIT_img:ec,EC_DNIT_label_img:ecLabel,NT_img:nt,NT_label_img:ntLabel,EC:ec,EC_label:ecLabel,NT:nt,NT_label:ntLabel,max_s_img:severities.length?Math.max(...severities):0,max_Fi:maxFi};
}
function summary(records,cfg,imageArea){
  const counts={};let sp=0,rebar=0;const lengths=[],widths=[];
  for(const r of records){counts[r.class]=(counts[r.class]||0)+1;if(r.class==="spalling_dark")sp+=r.area_px2;if(r.class==="exposed_rebar")rebar+=r.area_px2;if(r.class==="cracks"){lengths.push(r.length_px);if(r.width_px>0)widths.push(r.width_px)}}
  return {counts,total_objects:records.length,spalling_area_px2:sp,rebar_area_px2:rebar,crack_count:lengths.length,crack_length_total_px:lengths.reduce((a,b)=>a+b,0),crack_length_mean_px:lengths.length?lengths.reduce((a,b)=>a+b,0)/lengths.length:0,crack_width_mean_px:widths.length?widths.reduce((a,b)=>a+b,0)/widths.length:0,crack_width_max_px:widths.length?Math.max(...widths):0,image_area_px2:imageArea,condition_rating:conditionRating(records,cfg,imageArea)};
}
function emitProgress(callback,completed,current_engine,stage){
  callback?.({state:"running",completed,total:100,current_engine,stage});
}
function abortError(){
  try{return new DOMException("Análise CDM-1 cancelada.","AbortError")}
  catch{const e=new Error("Análise CDM-1 cancelada.");e.name="AbortError";return e}
}
function computeCdmCore(current,previous,cfg,onProgress=null){
  const w=current.width,h=current.height,records=[];
  emitProgress(onProgress,15,"CDM-1 · segmentando t1","segment_t1");
  const masks=detectMasks(current,cfg);
  emitProgress(onProgress,35,"CDM-1 · máscaras t1","masks_t1");
  ORDER.forEach((cls,index)=>{
    records.push(...recordsFromMask(masks[cls],w,h,cls,"t1_current",cfg));
    emitProgress(onProgress,35+Math.round((index+1)/ORDER.length*20),"CDM-1 · vetorizando "+LABELS[cls],"vectorize_t1");
  });
  let temporal={enabled:false,alignment_method:null,stats:{},records:[]};
  if(previous){
    emitProgress(onProgress,60,"CDM-1 · segmentando t0","segment_t0");
    const prevMasks=detectMasks(previous,cfg);
    emitProgress(onProgress,76,"CDM-1 · comparando t0→t1","temporal_compare");
    const change=temporalCompare(masks,prevMasks,w,h,cfg);
    temporal={enabled:true,alignment_method:"resize",stats:change.stats,records:change.records};
    emitProgress(onProgress,88,"CDM-1 · mudança temporal","temporal_vectors");
  }else emitProgress(onProgress,88,"CDM-1 · consolidando achados","consolidate");
  emitProgress(onProgress,92,"CDM-1 · classificação preliminar","condition_rating");
  const resultSummary=summary(records,cfg,w*h);
  emitProgress(onProgress,96,"CDM-1 · finalizando núcleo","core_complete");
  return {
    width:w,height:h,records,temporal,summary:resultSummary,
    protocol:{stages:["base_image","family_response","candidate_mask","open_close_mask","connected_components"],version:"unified_five_stage_v285_browser"}
  };
}
function runCoreWorker(current,previous,cfg,{signal,onProgress}={}){
  if(signal?.aborted)return Promise.reject(abortError());
  if(typeof Worker==="undefined"){
    const result=computeCdmCore(current,previous,cfg,onProgress);
    if(signal?.aborted)return Promise.reject(abortError());
    return Promise.resolve({...result,execution:"main-thread"});
  }
  const worker=new Worker(new URL("./cdmWorker.js",import.meta.url),{type:"module"});
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=()=>{
      if(settled)return;
      settled=true;
      signal?.removeEventListener("abort",onAbort);
      worker.terminate();
    };
    const onAbort=()=>{finish();reject(abortError())};
    signal?.addEventListener("abort",onAbort,{once:true});
    worker.onmessage=e=>{
      if(e.data?.type==="progress"){onProgress?.(e.data.progress);return}
      if(e.data?.ok){const result=e.data.result;finish();resolve({...result,execution:"web-worker"});return}
      const error=new Error(e.data?.error||"Falha no Web Worker do CDM-1.");finish();reject(error);
    };
    worker.onerror=e=>{const error=new Error(e.message||"Falha no Web Worker do CDM-1.");finish();reject(error)};
    const payload={
      current:{width:current.width,height:current.height,buffer:current.data.buffer},
      previous:previous?{width:previous.width,height:previous.height,buffer:previous.data.buffer}:null,
      cfg
    };
    const transfer=[current.data.buffer];
    if(previous)transfer.push(previous.data.buffer);
    worker.postMessage(payload,transfer);
  });
}
async function imageDataFromFile(file,maxSide,target=null){
  const bmp=await createImageBitmap(file,{imageOrientation:"from-image"});
  let w,h;if(target){[w,h]=target}else{const s=Math.min(1,maxSide/Math.max(bmp.width,bmp.height));w=Math.max(1,Math.round(bmp.width*s));h=Math.max(1,Math.round(bmp.height*s))}
  const c=document.createElement("canvas");c.width=w;c.height=h;const ctx=c.getContext("2d",{willReadFrequently:true});ctx.drawImage(bmp,0,0,w,h);bmp.close?.();return ctx.getImageData(0,0,w,h);
}
export async function runCdmBrowser(file,options={},previousFile=null,control={}){
  const started=performance.now(),onProgress=control?.onProgress,signal=control?.signal;
  if(signal?.aborted)throw abortError();
  const cfg={
    threshold:clamp(Number(options.cdm_threshold??35),1,255),
    kernel:oddKernel(Number(options.cdm_kernel_size??15)),
    minArea:clamp(Number(options.cdm_min_area??30),1,1e6),
    minAspect:clamp(Number(options.cdm_min_aspect_ratio??2),1,50),
    mmPerPx:Math.max(0,Number(options.cdm_mm_per_px??0)),
    elementFamily:options.cdm_element_family||"lajes_vigas_secundarias_apoios"
  };
  emitProgress(onProgress,3,"CDM-1 · decodificando t1","decode_t1");
  const decodeStarted=performance.now();
  let current=await imageDataFromFile(file,1600),w=current.width,h=current.height;
  if(signal?.aborted)throw abortError();
  let previous=null;
  if(previousFile){
    emitProgress(onProgress,7,"CDM-1 · decodificando t0","decode_t0");
    previous=await imageDataFromFile(previousFile,1600,[w,h]);
    if(signal?.aborted)throw abortError();
  }
  let decodeMs=performance.now()-decodeStarted,core,coreStarted=performance.now();
  try{
    core=await runCoreWorker(current,previous,cfg,{signal,onProgress});
  }catch(workerError){
    if(workerError?.name==="AbortError"||signal?.aborted)throw abortError();
    const fallbackDecodeStarted=performance.now();
    current=await imageDataFromFile(file,1600);w=current.width;h=current.height;
    previous=previousFile?await imageDataFromFile(previousFile,1600,[w,h]):null;
    decodeMs+=performance.now()-fallbackDecodeStarted;
    if(signal?.aborted)throw abortError();
    core={...computeCdmCore(current,previous,cfg,onProgress),execution:"main-thread-fallback",worker_error:String(workerError?.message||workerError)};
  }
  const coreMs=performance.now()-coreStarted;
  if(signal?.aborted)throw abortError();
  emitProgress(onProgress,97,"CDM-1 · renderizando camadas","render_layers");
  const renderStarted=performance.now(),records=core.records||[],layers=[];
  for(const cls of ORDER){
    const rec=records.filter(r=>r.class===cls);
    layers.push({id:cls,name:LABELS[cls],color:"#"+COLORS[cls].map(v=>v.toString(16).padStart(2,"0")).join(""),count:rec.length,overlay_png_base64:renderLayer(rec,w,h,COLORS[cls])});
  }
  const temporalCore=core.temporal||{enabled:false,alignment_method:null,stats:{},records:[]};
  const temporalLayers=temporalCore.enabled?["growth","reduction"].map(cls=>{
    const rec=(temporalCore.records||[]).filter(r=>r.class===cls);
    return {id:cls,name:cls==="growth"?"Crescimento t0→t1":"Redução t0→t1",color:"#"+COLORS[cls].map(v=>v.toString(16).padStart(2,"0")).join(""),count:rec.length,overlay_png_base64:renderLayer(rec,w,h,COLORS[cls])};
  }):[];
  const temporal={...temporalCore,layers:temporalLayers};
  const detections=records.map(r=>({label:r.class,canonical_label:r.class,score:null,box:[r.bbox[0],r.bbox[1],r.bbox[0]+r.bbox[2],r.bbox[1]+r.bbox[3]],polygon:r.points,area_px:r.area_px2}));
  const composite=document.createElement("canvas");composite.width=w;composite.height=h;const cctx=composite.getContext("2d");
  for(const cls of ORDER){
    const rec=records.filter(r=>r.class===cls),tmp=document.createElement("canvas");tmp.width=w;tmp.height=h;const tctx=tmp.getContext("2d");
    for(const r of rec){
      if(!r.points.length)continue;tctx.beginPath();tctx.moveTo(...r.points[0]);for(let i=1;i<r.points.length;i++)tctx.lineTo(...r.points[i]);
      if(r.closed){tctx.closePath();tctx.fillStyle="rgba("+COLORS[cls].join(",")+",.59)";tctx.fill()}
      else{tctx.strokeStyle="rgba("+COLORS[cls].join(",")+",.82)";tctx.lineWidth=Math.max(1,r.width_px);tctx.stroke()}
    }
    cctx.drawImage(tmp,0,0);
  }
  const renderMs=performance.now()-renderStarted,totalMs=performance.now()-started;
  if(signal?.aborted)throw abortError();
  emitProgress(onProgress,100,"CDM-1 · concluído","done");
  const engine={
    engine_id:"cdm_1",name:"CDM-1",task:"classical",status:"ok",latency_ms:totalMs,detections,
    overlay_png_base64:composite.toDataURL("image/png").split(",")[1],
    metrics:{
      implementation:"CDM 2.8.5 browser parity",runtime:core.execution||"browser-js",worker_error:core.worker_error||null,
      performance_ms:{decode:decodeMs,core:coreMs,render:renderMs,total:totalMs},
      geometry_units:"processed_pixels",processed_width:w,processed_height:h,mm_per_px:cfg.mmPerPx||null,
      layers,summary:core.summary,records,temporal,protocol:core.protocol
    },
    message:"CDM-1 executado integralmente no navegador; nenhum dado foi enviado ao Railway. Resultados morfológicos preliminares e confiança não calibrada."
  };
  return {image_width:w,image_height:h,results:[engine],consensus:{},spatial_consensus:[],consensus_overlay_png_base64:null,metadata:{analysis_id:"browser-cdm-"+crypto.randomUUID(),api_version:"browser-1.4",generated_at:new Date().toISOString(),mode:"individual",engine_ids:["cdm_1"],implementation:"cdm-2.8.5-browser-parity-worker"}};
}

// Test hooks: pure functions used by CI parity checks; not part of the UI API.
export const __cdmTest={detectMasks,recordsFromMask,temporalCompare,summary,computeCdmCore,percentileFloat,blackhat,cleanup,ORDER,LABELS};
