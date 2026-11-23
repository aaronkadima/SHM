import{CONTEXT_MODES,DEFAULT_CONTEXT_SHARE,contextOptionsFrom,gateMasks,sceneObjects,sceneOf}from"./contextFilter.js";
import{bioFeatures,bioRefineMasks,diversityCandidates,largestComponent}from"./cdm4Biodiversity.js";
import{neutralizeEnclosedTerrain,neutralizeDominantTerrain,overexposedSky}from"./cdm4Scene.js";
import{randomWalkerSpalling,RW_DEFAULTS}from"./cdm4RandomWalker.js";
import{linearRebar,REBAR_DEFAULTS}from"./cdm4Rebar.js";
import{evidenceMaps,evidenceSeeds,upsampleThreshold,EVIDENCE_DEFAULTS}from"./cdm4Evidence.js";
import{walkerFromSeeds}from"./cdm4RandomWalker.js";
import{refineContourThresholds,upsampleWithThresholdMap,CONTOUR_DEFAULTS}from"./cdm4Contour.js";
import{refineWalkerFullRes}from"./cdm4FieldAnalysis.js";
import{pigmentMaps,maskComposition,PIGMENT_VECTORS,PIGMENT_DEFAULTS}from"./cdm4Pigments.js";
// CDM-4 (motor cdm_4). Núcleo próprio, copiado do CDM 2.11 (cdmBrowser.js, que segue intacto
// como motor do CDM-1; o CDM-3 espacial também não muda) e estendido com as etapas validadas nas 20 fotos reais e no GT da foto 24:
//   IA de contexto corrigida (F1 terreno cercado = neutro, erosão de 0,5 célula, F4 céu superexposto),
//   canal de diversidade e refino de borda pelos índices de Ataky (2022), random walker de Grady (2006)
//   para o contorno do desplacamento, detector linear de armadura exposta e deconvolução de pigmentos
//   por Beer–Lambert (diagnóstico). Continua determinístico e sem pesos treinados na segmentação.

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
// Quickselect com partição em três vias: valores repetidos (fundo liso, saturação) não degeneram em O(n²).
function quickselect(a,k,left=0,right=a.length-1){
  while(left<right){
    const pivot=a[(left+right)>>1];let lt=left,i=left,gt=right;
    while(i<=gt){if(a[i]<pivot)swap(a,lt++,i++);else if(a[i]>pivot)swap(a,i,gt--);else i++}
    if(k<lt)right=lt-1;else if(k>gt)left=gt+1;else return a[k];
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
// CDM 2.11: moldura uniforme (borda branca/preta de figura escaneada ou print) fica fora da análise.
// Uma linha/coluna é moldura se max−min do cinza ≤ FRAME_TOL; até 25% por lado; ≥ 3 px para contar.
// Mesma regra em cdm_v285.py (frame_valid_mask).
const STRETCH_MAX_GAIN=2.4,FRAME_TOL=10,FRAME_MAX_FRACTION=.25,FRAME_MIN_PX=3,FRAME_PAD_PX=2;
function frameValidMask(raw,w,h){
  const uniformRow=y=>{let mn=Infinity,mx=-Infinity;for(let x=0;x<w;x++){const v=raw[y*w+x];if(v<mn)mn=v;if(v>mx)mx=v}return mx-mn<=FRAME_TOL};
  const uniformCol=x=>{let mn=Infinity,mx=-Infinity;for(let y=0;y<h;y++){const v=raw[y*w+x];if(v<mn)mn=v;if(v>mx)mx=v}return mx-mn<=FRAME_TOL};
  const lim=(n)=>Math.floor(n*FRAME_MAX_FRACTION);
  let top=0,bottom=0,left=0,right=0;
  while(top<lim(h)&&uniformRow(top))top++;
  while(bottom<lim(h)&&uniformRow(h-1-bottom))bottom++;
  while(left<lim(w)&&uniformCol(left))left++;
  while(right<lim(w)&&uniformCol(w-1-right))right++;
  const t=top>=FRAME_MIN_PX?top+FRAME_PAD_PX:0,b=bottom>=FRAME_MIN_PX?bottom+FRAME_PAD_PX:0,l=left>=FRAME_MIN_PX?left+FRAME_PAD_PX:0,r=right>=FRAME_MIN_PX?right+FRAME_PAD_PX:0;
  if(!t&&!b&&!l&&!r)return null;
  if(t+b>=h-8||l+r>=w-8)return null;
  const valid=new Uint8Array(w*h);
  for(let y=t;y<h-b;y++)for(let x=l;x<w-r;x++)valid[y*w+x]=1;
  valid.rect=[l,t,w-r-1,h-b-1];
  return valid;
}
function grayAndRgb(imageData,withFrame=false,domain=null){
  const w=imageData.width,h=imageData.height,n=w*h,gray=new Float32Array(n),rgb=imageData.data;
  for(let i=0,j=0;i<n;i++,j+=4)gray[i]=.299*rgb[j]+.587*rgb[j+1]+.114*rgb[j+2];
  let valid=withFrame?frameValidMask(gray,w,h):null;
  if(domain){const v=new Uint8Array(n);for(let i=0;i<n;i++)v[i]=domain[i]&&(!valid||valid[i])?1:0;if(valid)v.rect=valid.rect;valid=v}
  const p2=percentileFloat(gray,2,valid),p98=percentileFloat(gray,98,valid),out=new Float32Array(n);
  // ganho do estiramento limitado (CDM 2.11): superfícies de baixo contraste não têm ruído amplificado
  if(p98<=p2+1e-6)out.set(gray);
  else{const factor=Math.min(STRETCH_MAX_GAIN,255/(p98-p2));for(let i=0;i<n;i++)out[i]=clamp((gray[i]-p2)*factor,0,255)}
  // a moldura recebe o pixel de conteúdo mais próximo (extensão da borda): sem degrau artificial
  if(valid&&valid.rect){const[x0,y0,x1,y1]=valid.rect;for(let y=0;y<h;y++){const yy=y<y0?y0:y>y1?y1:y;for(let x=0;x<w;x++){if(valid[y*w+x])continue;const xx=x<x0?x0:x>x1?x1:x;out[y*w+x]=out[yy*w+xx]}}}
  return {gray:out,rgb,valid,lum:gray};
}
function registrationEdgeMap(imageData,maxSide=160){
  const w=imageData.width,h=imageData.height,step=Math.max(1,Math.ceil(Math.max(w,h)/maxSide));
  const sw=Math.ceil(w/step),sh=Math.ceil(h/step),gray=new Float32Array(sw*sh),rgba=imageData.data;
  for(let sy=0;sy<sh;sy++){
    const y=Math.min(h-1,sy*step);
    for(let sx=0;sx<sw;sx++){
      const x=Math.min(w-1,sx*step),i=(y*w+x)*4;
      gray[sy*sw+sx]=.299*rgba[i]+.587*rgba[i+1]+.114*rgba[i+2];
    }
  }
  const edge=new Float32Array(sw*sh);
  if(sw>=3&&sh>=3){
    for(let y=1;y<sh-1;y++)for(let x=1;x<sw-1;x++){
      const i=y*sw+x;
      edge[i]=Math.abs(gray[i+1]-gray[i-1])+Math.abs(gray[i+sw]-gray[i-sw]);
    }
  }
  return {edge,width:sw,height:sh,step};
}
function candidateBetter(score,dx,dy,best){
  if(score<best.score)return true;
  if(score>best.score)return false;
  const a=[Math.abs(dx)+Math.abs(dy),Math.abs(dy),Math.abs(dx),dy,dx];
  const b=[Math.abs(best.dx)+Math.abs(best.dy),Math.abs(best.dy),Math.abs(best.dx),best.dy,best.dx];
  for(let i=0;i<a.length;i++){if(a[i]<b[i])return true;if(a[i]>b[i])return false}
  return false;
}
function estimateTranslationRegistration(current,previous){
  if(current.width!==previous.width||current.height!==previous.height)throw new Error("Registration requires equal image dimensions.");
  const cur=registrationEdgeMap(current),prev=registrationEdgeMap(previous);
  const base={method_requested:"translation_auto",method_applied:"resize",accepted:false,reason:"registration_grid_mismatch",dx_px:0,dy_px:0,estimated_dx_px:0,estimated_dy_px:0,score_before:0,score_after:0,improvement:0,downsample_step:cur.step,search_radius_px:0};
  if(cur.step!==prev.step||cur.width!==prev.width||cur.height!==prev.height)return base;
  const sw=cur.width,sh=cur.height,searchFull=Math.min(96,Math.max(6,Math.round(Math.min(current.width,current.height)*.12)));
  let radius=Math.max(1,Math.ceil(searchFull/cur.step));
  radius=Math.min(radius,Math.max(1,Math.floor((Math.min(sw,sh)-6)/2)));
  const x0=radius+1,x1=sw-radius-1,y0=radius+1,y1=sh-radius-1;
  if(x1<=x0||y1<=y0)return {...base,reason:"image_too_small",search_radius_px:radius*cur.step};
  const sampleStride=Math.min(x1-x0,y1-y0)>=48?2:1;
  const score=(dx,dy)=>{
    let sum=0,count=0;
    for(let y=y0;y<y1;y+=sampleStride)for(let x=x0;x<x1;x+=sampleStride){
      sum+=Math.abs(cur.edge[y*sw+x]-prev.edge[(y-dy)*sw+(x-dx)]);count++;
    }
    return count?sum/count:Infinity;
  };
  const scoreZero=score(0,0);let best={score:scoreZero,dx:0,dy:0};
  const coarseStep=radius>=5?2:1;
  for(let dy=-radius;dy<=radius;dy+=coarseStep)for(let dx=-radius;dx<=radius;dx+=coarseStep){
    const s=score(dx,dy);if(candidateBetter(s,dx,dy,best))best={score:s,dx,dy};
  }
  const coarseDx=best.dx,coarseDy=best.dy;
  for(let dy=Math.max(-radius,coarseDy-2);dy<=Math.min(radius,coarseDy+2);dy++)for(let dx=Math.max(-radius,coarseDx-2);dx<=Math.min(radius,coarseDx+2);dx++){
    const s=score(dx,dy);if(candidateBetter(s,dx,dy,best))best={score:s,dx,dy};
  }
  const improvement=Number.isFinite(scoreZero)?(scoreZero-best.score)/Math.max(scoreZero,1e-6):0;
  const estimatedDx=best.dx*cur.step,estimatedDy=best.dy*cur.step;
  const boundaryHit=Math.abs(best.dx)>=radius||Math.abs(best.dy)>=radius;
  const accepted=(best.dx!==0||best.dy!==0)&&improvement>=.035&&!boundaryHit;
  return {
    method_requested:"translation_auto",method_applied:accepted?"translation_auto":"resize",accepted,
    reason:accepted?"translation_improved_edge_match":(boundaryHit?"search_boundary_hit":"no_reliable_translation_gain"),
    dx_px:accepted?estimatedDx:0,dy_px:accepted?estimatedDy:0,
    estimated_dx_px:estimatedDx,estimated_dy_px:estimatedDy,
    score_before:scoreZero,score_after:accepted?best.score:scoreZero,
    improvement:Math.max(0,improvement),boundary_hit:boundaryHit,downsample_step:cur.step,search_radius_px:radius*cur.step
  };
}
function applyTranslationRegistration(current,previous,dx,dy){
  if(dx===0&&dy===0)return {width:previous.width,height:previous.height,data:new Uint8ClampedArray(previous.data)};
  const w=current.width,h=current.height,out=new Uint8ClampedArray(current.data);
  const dstX0=Math.max(0,dx),dstX1=Math.min(w,w+dx),dstY0=Math.max(0,dy),dstY1=Math.min(h,h+dy);
  for(let y=dstY0;y<dstY1;y++)for(let x=dstX0;x<dstX1;x++){
    const sx=x-dx,sy=y-dy,di=(y*w+x)*4,si=(sy*w+sx)*4;
    out[di]=previous.data[si];out[di+1]=previous.data[si+1];out[di+2]=previous.data[si+2];out[di+3]=previous.data[si+3];
  }
  return {width:w,height:h,data:out};
}
function registerPrevious(current,previous,method="translation_auto"){
  if((method||"translation_auto").toLowerCase()!=="translation_auto"){
    return {image:{width:previous.width,height:previous.height,data:new Uint8ClampedArray(previous.data)},metrics:{method_requested:method||"resize",method_applied:"resize",accepted:false,reason:"translation_registration_disabled",dx_px:0,dy_px:0,estimated_dx_px:0,estimated_dy_px:0,score_before:null,score_after:null,improvement:0,downsample_step:1,search_radius_px:0}};
  }
  const metrics=estimateTranslationRegistration(current,previous);
  return {image:applyTranslationRegistration(current,previous,metrics.dx_px,metrics.dy_px),metrics};
}

function temporalQualityAssessment(current,alignedPrevious,alignment={}){
  if(current.width!==alignedPrevious.width||current.height!==alignedPrevious.height)throw new Error("Temporal quality requires equal image dimensions.");
  const w=current.width,h=current.height,step=Math.max(1,Math.ceil(Math.max(w,h)/320));
  const sampleGray=image=>{
    const sw=Math.ceil(w/step),sh=Math.ceil(h/step),gray=new Float32Array(sw*sh),rgba=image.data;
    for(let sy=0;sy<sh;sy++){const y=Math.min(h-1,sy*step);for(let sx=0;sx<sw;sx++){const x=Math.min(w-1,sx*step),i=(y*w+x)*4;gray[sy*sw+sx]=.299*rgba[i]+.587*rgba[i+1]+.114*rgba[i+2]}}
    return {gray,width:sw,height:sh};
  };
  const cur=sampleGray(current),prev=sampleGray(alignedPrevious);
  const mean=a=>{let s=0;for(let i=0;i<a.length;i++)s+=a[i];return a.length?s/a.length:0};
  const meanCur=mean(cur.gray),meanPrev=mean(prev.gray),illuminationDelta=Math.abs(meanCur-meanPrev)/255;
  const edgeMap=s=>{
    if(s.width<3||s.height<3)return new Float32Array(0);
    const out=new Float32Array((s.width-2)*(s.height-2));let k=0;
    for(let y=1;y<s.height-1;y++)for(let x=1;x<s.width-1;x++){
      const i=y*s.width+x;
      out[k++]=Math.abs(s.gray[i+1]-s.gray[i-1])+Math.abs(s.gray[i+s.width]-s.gray[i-s.width]);
    }
    return out;
  };
  const edgeCur=edgeMap(cur),edgePrev=edgeMap(prev);
  const edgeEnergy=a=>{let sum=0;for(let i=0;i<a.length;i++)sum+=a[i];return a.length?sum/a.length:0};
  const sharpCur=edgeEnergy(edgeCur),sharpPrev=edgeEnergy(edgePrev),sharpMax=Math.max(sharpCur,sharpPrev);
  const sharpnessRatio=sharpMax>1e-6?Math.min(sharpCur,sharpPrev)/sharpMax:1;
  let edgeSimilarity=0;
  if(edgeCur.length&&edgeCur.length===edgePrev.length){
    let meanA=0,meanB=0;for(let i=0;i<edgeCur.length;i++){meanA+=edgeCur[i];meanB+=edgePrev[i]}
    meanA/=edgeCur.length;meanB/=edgePrev.length;
    let dot=0,aa=0,bb=0,mae=0;
    for(let i=0;i<edgeCur.length;i++){
      const da=edgeCur[i]-meanA,db=edgePrev[i]-meanB;
      dot+=da*db;aa+=da*da;bb+=db*db;mae+=Math.abs(edgeCur[i]-edgePrev[i]);
    }
    const denom=Math.sqrt(aa*bb);
    edgeSimilarity=denom>1e-9?dot/denom:(mae/edgeCur.length<1e-6?1:0);
  }
  edgeSimilarity=Math.max(-1,Math.min(1,edgeSimilarity));
  const clippedFraction=s=>{let n=0;for(let i=0;i<s.gray.length;i++)if(s.gray[i]<=5||s.gray[i]>=250)n++;return s.gray.length?n/s.gray.length:0};
  const clippedCur=clippedFraction(cur),clippedPrev=clippedFraction(prev),clippedMax=Math.max(clippedCur,clippedPrev);
  const dx=Math.abs(Number(alignment.dx_px||0)),dy=Math.abs(Number(alignment.dy_px||0));
  const overlapRatio=Math.max(0,Math.max(0,w-dx)*Math.max(0,h-dy)/Math.max(1,w*h));
  const issues=[],warnings=[],reason=String(alignment.reason||"");
  if(["search_boundary_hit","registration_grid_mismatch","image_too_small"].includes(reason))issues.push("registration_unreliable");
  if(overlapRatio<.85)issues.push("insufficient_overlap");else if(overlapRatio<.92)warnings.push("reduced_overlap");
  if(illuminationDelta>.22)issues.push("illumination_mismatch");else if(illuminationDelta>.12)warnings.push("illumination_difference");
  if(sharpnessRatio<.45)issues.push("sharpness_mismatch");else if(sharpnessRatio<.65)warnings.push("sharpness_difference");
  if(edgeSimilarity<.35)issues.push("geometric_mismatch");else if(edgeSimilarity<.55)warnings.push("geometric_consistency_low");
  if(clippedMax>.35)issues.push("exposure_clipping");else if(clippedMax>.20)warnings.push("exposure_warning");
  if(sharpMax<3)warnings.push("low_texture");
  const status=issues.length?"fail":warnings.length?"warning":"pass";
  return {
    schema:"cdm_temporal_quality_v1",status,validated_for_change_quantification:issues.length===0,issues,warnings,
    metrics:{overlap_ratio:overlapRatio,illumination_delta:illuminationDelta,mean_luminance_t1:meanCur,mean_luminance_t0_aligned:meanPrev,sharpness_t1:sharpCur,sharpness_t0_aligned:sharpPrev,sharpness_ratio:sharpnessRatio,edge_similarity:edgeSimilarity,clipped_fraction_t1:clippedCur,clipped_fraction_t0_aligned:clippedPrev,sample_step:step},
    thresholds:{min_overlap_fail:.85,min_overlap_warning:.92,max_illumination_delta_fail:.22,max_illumination_delta_warning:.12,min_sharpness_ratio_fail:.45,min_sharpness_ratio_warning:.65,min_edge_similarity_fail:.35,min_edge_similarity_warning:.55,max_clipped_fraction_fail:.35,max_clipped_fraction_warning:.20}
  };
}

function hsvArrays(rgba,n){
  // Float64 (como numpy float64 em cdm_v285.rgb_to_hsv_basic): sem arredondamento para float32
  // perto dos limiares de saturação/valor.
  const hue=new Float64Array(n),sat=new Float64Array(n),val=new Float64Array(n);
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
// Separação hierárquica das famílias (CDM 2.10). Mesma regra em backend/app/cdm_v285.py
// (separate_families); paridade testada em CI.
//  · Corrosão (regra de cor) nunca é fissura: pixels de corrosão saem da máscara de fissuras.
//  · Componente de desplacamento coberto ≥ 60% por corrosão é a própria mancha de ferrugem: os
//    pixels de corrosão (e a armadura nesse componente) saem; a sobra passa por abertura 5×5.
//  · Nos demais componentes, corrosão e armadura ficam aninhadas no desplacamento real.
const FAMILY_RUST_SHARE=.6;
function separateFamilies(masks,w,h){
  const rust=masks.corrosion_rust,n=w*h;
  if(!rust||!rust.some(v=>v))return;
  // cópias: as máscaras finais não compartilham memória com as etapas rastreadas
  if(masks.cracks){const c=new Uint8Array(masks.cracks);for(let i=0;i<n;i++)if(rust[i])c[i]=0;masks.cracks=c}
  const sp=masks.spalling_dark;if(!sp||!sp.some(v=>v))return;
  const affected=new Uint8Array(n),seen=new Uint8Array(n),queue=new Int32Array(n);let any=false;
  for(let s=0;s<n;s++){
    if(!sp[s]||seen[s])continue;let head=0,tail=0,rustCount=0;queue[tail++]=s;seen[s]=1;
    while(head<tail){const p=queue[head++],y=(p/w)|0,x=p-y*w;if(rust[p])rustCount++;
      for(let ny=Math.max(0,y-1);ny<=Math.min(h-1,y+1);ny++)for(let nx=Math.max(0,x-1);nx<=Math.min(w-1,x+1);nx++){const q=ny*w+nx;if(sp[q]&&!seen[q]){seen[q]=1;queue[tail++]=q}}}
    if(rustCount>=FAMILY_RUST_SHARE*tail){any=true;for(let k=0;k<tail;k++)affected[queue[k]]=1}
  }
  if(!any)return;
  const rem=new Uint8Array(n);for(let i=0;i<n;i++)rem[i]=affected[i]&&!rust[i]?1:0;
  const remOpen=filterMask(filterMask(rem,w,h,5,false),w,h,5,true),out=new Uint8Array(n);
  for(let i=0;i<n;i++)out[i]=(sp[i]&&!affected[i])||remOpen[i]?1:0;
  masks.spalling_dark=out;
  if(masks.exposed_rebar){const r=new Uint8Array(masks.exposed_rebar);for(let i=0;i<n;i++)if(affected[i])r[i]=0;masks.exposed_rebar=r}
}
// trace (opcional, usado só pela paridade): guarda cinza, resposta, candidata, abertura e máscara final
// de cada família — as mesmas etapas de pipeline[...] em cdm_v285.detect_masks.
// Contraste local do desplacamento: média de cinza na coroa (caixa expandida em SPALL_RING_PX, fora de
// qualquer pixel de desplacamento) menos a média dentro do componente. Mesma regra em cdm_v285.py.
const SPALL_CRACK_NEAR_PX=5,SPALL_MAX_CRACK_SHARE=.35,EFF_MIN_CONTRAST=80,EFF_CONTRAST_T=2.2,SPALL_MIN_ROUGHNESS=5,ROUGH_RADIUS=2,SPALL_RING_PX=7,SPALL_MIN_CONTRAST=40,SPALL_CONTRAST_T=1.2,SPALL_CORE_PX=9,SPALL_GROW_PX=3,SPALL_SMOOTH_PX=11;
// Rugosidade local: |Y − média 5×5(Y)| na luminância sem estiramento (agregado exposto é áspero;
// sombra, vinheta e mancha são lisas). Média por imagem integral, só com vizinhos dentro da imagem.
function roughnessMap(lum,w,h,r=ROUGH_RADIUS){
  const W=w+1,S=new Float64Array(W*(h+1)),out=new Float32Array(w*h);
  for(let y=0;y<h;y++){let row=0;for(let x=0;x<w;x++){row+=lum[y*w+x];S[(y+1)*W+x+1]=S[y*W+x+1]+row}}
  for(let y=0;y<h;y++){const y0=Math.max(0,y-r),y1=Math.min(h-1,y+r);for(let x=0;x<w;x++){const x0=Math.max(0,x-r),x1=Math.min(w-1,x+r);
    const sum=S[(y1+1)*W+x1+1]-S[y0*W+x1+1]-S[(y1+1)*W+x0]+S[y0*W+x0],cnt=(y1-y0+1)*(x1-x0+1);out[y*w+x]=Math.abs(lum[y*w+x]-sum/cnt)}}
  return out;
}
function spallingByContrast(mask,gray,w,h,minDelta,log=null,valid=null,sign=-1,rough=null,minRough=0,near=null,maxNear=1){
  const n=w*h,out=new Uint8Array(mask),seen=new Uint8Array(n),queue=new Int32Array(n);
  for(let s=0;s<n;s++){
    if(!mask[s]||seen[s])continue;
    let head=0,tail=0,sum=0,rsum=0,nearN=0,minX=w,minY=h,maxX=0,maxY=0;queue[tail++]=s;seen[s]=1;
    while(head<tail){const p=queue[head++],y=(p/w)|0,x=p-y*w;sum+=gray[p];if(rough)rsum+=rough[p];if(near&&near[p])nearN++;if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
      for(let ny=y>0?y-1:0;ny<=(y<h-1?y+1:y);ny++)for(let nx=x>0?x-1:0;nx<=(x<w-1?x+1:x);nx++){const q=ny*w+nx;if(mask[q]&&!seen[q]){seen[q]=1;queue[tail++]=q}}}
    const x0=Math.max(0,minX-SPALL_RING_PX),x1=Math.min(w-1,maxX+SPALL_RING_PX),y0=Math.max(0,minY-SPALL_RING_PX),y1=Math.min(h-1,maxY+SPALL_RING_PX);
    let rs=0,rn=0;for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const q=y*w+x;if(!mask[q]&&(!valid||valid[q])){rs+=gray[q];rn++}}
    const delta=rn?(sign<0?rs/rn-sum/tail:sum/tail-rs/rn):Infinity;
    const rmean=rough?rsum/tail:Infinity;
    const nearFrac=near?nearN/tail:0;
    if(log)log.push({bbox:[minX,minY,maxX-minX+1,maxY-minY+1],area:tail,delta:+delta.toFixed(2),roughness:rough?+rmean.toFixed(2):null,crack_share:+nearFrac.toFixed(3)});
    if(delta<minDelta||rmean<minRough||nearFrac>maxNear)for(let q=0;q<tail;q++)out[queue[q]]=0;
  }
  return out;
}
// CDM 2.11: região de área pequena (< AREA_BORDER_FRACTION do conteúdo) encostada na borda do conteúdo
// é parcial/vinheta e sai (canto escuro, mancha cortada pela moldura). Mesma regra em cdm_v285.py.
const AREA_BORDER_FRACTION=.01;
function dropSmallBorder(mask,w,h,rect){
  const[x0,y0,x1,y1]=rect,limit=AREA_BORDER_FRACTION*(x1-x0+1)*(y1-y0+1),out=new Uint8Array(mask),seen=new Uint8Array(w*h),queue=new Int32Array(w*h);
  for(let s=0;s<w*h;s++){
    if(!mask[s]||seen[s])continue;let head=0,tail=0,touch=false;queue[tail++]=s;seen[s]=1;
    while(head<tail){const p=queue[head++],y=(p/w)|0,x=p-y*w;if(x<=x0+1||x>=x1-1||y<=y0+1||y>=y1-1)touch=true;
      for(let ny=y>0?y-1:0;ny<=(y<h-1?y+1:y);ny++)for(let nx=x>0?x-1:0;nx<=(x<w-1?x+1:x);nx++){const q=ny*w+nx;if(mask[q]&&!seen[q]){seen[q]=1;queue[tail++]=q}}}
    if(touch&&tail<limit)for(let q=0;q<tail;q++)out[queue[q]]=0;
  }
  return out;
}
function detectMasks(imageData,cfg,trace=null){
  const w=imageData.width,h=imageData.height,n=w*h,{gray,rgb,valid,lum}=grayAndRgb(imageData,true,cfg.domain||null),{hue,sat,val}=hsvArrays(rgb,n);
  if(trace)trace.frame_valid=valid;
  const k=oddKernel(cfg.kernel),masks={};
  const opened=(m,kk)=>filterMask(filterMask(m,w,h,kk,false),w,h,kk,true);
  if(trace)trace.gray=gray;

  const crackResponse=blackhat(gray,w,h,k),crackRaw=new Uint8Array(n);
  for(let i=0;i<n;i++)crackRaw[i]=crackResponse[i]>cfg.threshold&&(!valid||valid[i])?1:0;
  // Fissuras (CDM 2.9): abertura por reconstrução. A abertura 3×3 só escolhe os componentes
  // candidatos que têm núcleo robusto; cada componente escolhido volta com a forma completa da
  // máscara candidata (trechos de 1–2 px preservados). Depois, fechamento 3×3.
  const crackOpen=reconstructByOpening(crackRaw,w,h);
  masks.cracks=filterMask(filterMask(crackOpen,w,h,3,true),w,h,3,false);
  if(trace)trace.cracks={response:crackResponse,raw:crackRaw,open:crackOpen,clean:masks.cracks};

  const p18=percentileFloat(gray,18,valid),p45=percentileFloat(gray,45,valid);
  const darkCut=Math.min(120,p18+Math.max(8,cfg.threshold*.25));
  const texture=blackhat(gray,w,h,Math.max(5,Math.min(k,21))),spRaw=new Uint8Array(n);
  for(let i=0;i<n;i++)spRaw[i]=(!valid||valid[i])&&(gray[i]<darkCut||(texture[i]>Math.max(10,cfg.threshold*.55)&&gray[i]<p45))?1:0;
  // CDM 2.11: núcleo + crescimento condicionado — abertura com SPALL_CORE_PX corta pontes finas e manchas
  // de textura; o núcleo é devolvido à forma original só até SPALL_GROW_PX px (não atravessa pontes longas).
  const spallingBase=cleanup(spRaw,w,h,5),core=cfg.spallCore??SPALL_CORE_PX,grow=cfg.spallGrow??SPALL_GROW_PX;
  let spallingClean=spallingBase;
  if(core>1){const op=filterMask(filterMask(spallingBase,w,h,core,false),w,h,core,true),dl=filterMask(op,w,h,2*grow+1,true);spallingClean=new Uint8Array(n);for(let i=0;i<n;i++)spallingClean[i]=spallingBase[i]&&dl[i]?1:0}
  const contrastLog=[];
  // CDM 2.11: desplacamento precisa ser mais escuro que o entorno imediato (manchas e sombras rasas saem).
  let spalling=spallingByContrast(spallingClean,gray,w,h,cfg.spallContrast??Math.max(SPALL_MIN_CONTRAST,cfg.threshold*SPALL_CONTRAST_T),contrastLog,valid,-1,roughnessMap(lum,w,h),cfg.spallRough??SPALL_MIN_ROUGHNESS);
  // suaviza a borda dos desplacamentos aceitos (agregado claro na borda): fechamento SPALL_SMOOTH_PX
  const smooth=cfg.spallSmooth??SPALL_SMOOTH_PX;
  if(smooth>1)spalling=filterMask(filterMask(spalling,w,h,smooth,true),w,h,smooth,false);
  const contentRect=valid&&valid.rect?valid.rect:[0,0,w-1,h-1];
  spalling=dropSmallBorder(spalling,w,h,contentRect);masks.spalling_dark=spalling;
  if(trace)trace.spalling_contrast=contrastLog;
  if(trace){const response=new Float32Array(n);for(let i=0;i<n;i++)response[i]=Math.max(clamp(darkCut-gray[i],0,255),texture[i]);trace.spalling_dark={response,raw:spRaw,open:opened(spRaw,5),clean:spalling}}

  const corrosionRaw=new Uint8Array(n),effRaw=new Uint8Array(n),p72=percentileFloat(gray,72,valid);
  for(let i=0,j=0;i<n;i++,j+=4){
    const r=rgb[j],g=rgb[j+1],b=rgb[j+2],hv=hue[i],sv=sat[i],vv=val[i];
    const ok=!valid||valid[i];
    corrosionRaw[i]=ok&&(r>g+12&&r>b+18&&sv>.22&&vv>.16&&(hv<55||hv>330))?1:0;
    effRaw[i]=ok&&(vv>.72&&sv<.28&&gray[i]>p72)?1:0;
  }
  masks.corrosion_rust=dropSmallBorder(cleanup(corrosionRaw,w,h,5),w,h,contentRect);
  // CDM 2.11: eflorescência precisa ser mais clara que o entorno imediato (concreto claro e reflexo amplo saem)
  const effLog=[];
  masks.efflorescence_white=dropSmallBorder(spallingByContrast(cleanup(effRaw,w,h,5),gray,w,h,cfg.effContrast??Math.max(EFF_MIN_CONTRAST,cfg.threshold*EFF_CONTRAST_T),effLog,valid,1),w,h,contentRect);
  if(trace)trace.efflorescence_contrast=effLog;
  if(trace){
    const cor=new Float32Array(n),eff=new Float32Array(n);
    for(let i=0,j=0;i<n;i++,j+=4){
      const r=rgb[j],g=rgb[j+1],b=rgb[j+2],gate=(hue[i]<55||hue[i]>330)?1:0;
      cor[i]=clamp(clamp(r-Math.max(g,b),0,255)*(.35+.65*sat[i])*(.35+.65*gate),0,255);
      eff[i]=clamp(val[i]*255*(1-sat[i]),0,255);
    }
    trace.corrosion_rust={response:cor,raw:corrosionRaw,open:opened(corrosionRaw,5),clean:masks.corrosion_rust};
    trace.efflorescence_white={response:eff,raw:effRaw,open:opened(effRaw,5),clean:masks.efflorescence_white};
  }

  const localThresh=spalling.some(v=>v)?percentileFloat(gray,40,spalling):percentileFloat(gray,12,valid);
  const rebarRaw=new Uint8Array(n);
  for(let i=0;i<n;i++)rebarRaw[i]=(spalling[i]&&(gray[i]<localThresh||(sat[i]<.20&&val[i]<.55)))?1:0;
  masks.exposed_rebar=cleanup(rebarRaw,w,h,3);
  if(trace){const response=new Float32Array(n);for(let i=0;i<n;i++)response[i]=spalling[i]?clamp(localThresh-gray[i],0,255):0;trace.exposed_rebar={response,raw:rebarRaw,open:opened(rebarRaw,3),clean:masks.exposed_rebar}}
  separateFamilies(masks,w,h);
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
function reconstructByOpening(candidate,w,h){
  const opened=filterMask(filterMask(candidate,w,h,3,false),w,h,3,true),n=w*h,out=new Uint8Array(n),queue=new Int32Array(n);
  for(let s=0;s<n;s++){
    if(!(opened[s]&&candidate[s])||out[s])continue;
    let head=0,tail=0;queue[tail++]=s;out[s]=1;
    while(head<tail){
      const p=queue[head++],y=(p/w)|0,x=p-y*w;
      for(let ny=Math.max(0,y-1);ny<=Math.min(h-1,y+1);ny++)for(let nx=Math.max(0,x-1);nx<=Math.min(w-1,x+1);nx++){const q=ny*w+nx;if(candidate[q]&&!out[q]){out[q]=1;queue[tail++]=q}}
    }
  }
  return out;
}
// ---------- Fissuras: continuidade e geometria pelo esqueleto (CDM 2.9) ----------
// Mesma implementação em backend/app/cdm_v285.py (crack_records_from_mask); paridade testada em CI.
const CRACK_GAP_PX=4,CRACK_BRIDGE_KERNEL=2*CRACK_GAP_PX+1,CRACK_MIN_FRAGMENT=3,CRACK_SPUR_PX=12,CRACK_COMPACT_FACTOR=4,CRACK_MIN_LENGTH_FRACTION=.04,CRACK_MAX_WIDTH_K=.45;
// Poda de esporões: ramos terminais com ≤ CRACK_SPUR_PX pixels até uma junção (≥ 3 vizinhos) são
// removidos. Decisão tomada sobre o esqueleto original (independe da ordem de varredura).
function pruneSpurs(skel,w,h){
  const n=w*h,deg=new Uint8Array(n),out=new Uint8Array(skel);
  const nbs=i=>{const y=(i/w)|0,x=i-y*w,r=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;if(nx>=0&&ny>=0&&nx<w&&ny<h&&skel[ny*w+nx])r.push(ny*w+nx)}return r};
  for(let i=0;i<n;i++)if(skel[i])deg[i]=nbs(i).length;
  for(let i=0;i<n;i++){
    if(!skel[i]||deg[i]!==1)continue;
    const path=[i];let prev=-1,cur=i,hitJunction=false;
    while(path.length<=CRACK_SPUR_PX){
      const next=nbs(cur).filter(q=>q!==prev&&!path.includes(q));
      if(!next.length)break;
      const q=next[0];if(deg[q]>=3){hitJunction=true;break}
      prev=cur;cur=q;path.push(q);
    }
    if(hitJunction&&path.length<=CRACK_SPUR_PX)for(const p of path)out[p]=0;
  }
  return out;
}
// Afinamento de Zhang-Suen (paralelo por subiteração; vizinhança fora da imagem = 0).
function zhangSuen(src,w,h){
  const img=new Uint8Array(src);let changed=true;
  const at=(x,y)=>x<0||y<0||x>=w||y>=h?0:img[y*w+x];
  let on=[];for(let i=0;i<img.length;i++)if(img[i])on.push(i);
  while(changed){
    changed=false;
    for(let pass=0;pass<2;pass++){
      const del=[];
      for(const i of on){
        if(!img[i])continue;
        const y=(i/w)|0,x=i-y*w;
        const p2=at(x,y-1),p3=at(x+1,y-1),p4=at(x+1,y),p5=at(x+1,y+1),p6=at(x,y+1),p7=at(x-1,y+1),p8=at(x-1,y),p9=at(x-1,y-1);
        const B=p2+p3+p4+p5+p6+p7+p8+p9;if(B<2||B>6)continue;
        const A=(!p2&&p3)+(!p3&&p4)+(!p4&&p5)+(!p5&&p6)+(!p6&&p7)+(!p7&&p8)+(!p8&&p9)+(!p9&&p2);if(A!==1)continue;
        if(pass===0?(p2*p4*p6||p4*p6*p8):(p2*p4*p8||p2*p6*p8))continue;
        del.push(i);
      }
      if(del.length){changed=true;for(const i of del)img[i]=0}
    }
    on=on.filter(i=>img[i]);
  }
  return img;
}
// Comprimento do esqueleto: arestas 4-vizinhas valem 1; diagonais valem √2 só quando não há
// atalho pelos dois pixels de canto (evita contar triângulos duas vezes).
function skeletonLength(skel,w,h,pixels){
  let L=0;
  for(const i of pixels){
    const y=(i/w)|0,x=i-y*w;
    const right=x+1<w&&skel[i+1],down=y+1<h&&skel[i+w];
    if(right)L+=1;if(down)L+=1;
    if(x+1<w&&y+1<h&&skel[i+w+1]&&!right&&!down)L+=Math.SQRT2;
    if(x>0&&y+1<h&&skel[i+w-1]&&!(x>0&&skel[i-1])&&!down)L+=Math.SQRT2;
  }
  return L;
}
// Contorno externo (Moore, 8-vizinhos) de um componente a partir do pixel mais acima/esquerda.
// Substitui o polígono convexo: regiões côncavas ou separadas não "engolem" o fundo entre elas.
const MOORE=[[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
function traceContour(mask,w,h,start,limit){
  const inside=(x,y)=>x>=0&&y>=0&&x<w&&y<h&&mask[y*w+x]!==0;
  const sx=start%w,sy=(start/w)|0,pts=[[sx,sy]];
  let x=sx,y=sy,dir=0,steps=0,firstDir=-1;
  for(;;){
    let moved=false;
    for(let k=0;k<8;k++){const d=(dir+6+k)%8,nx=x+MOORE[d][0],ny=y+MOORE[d][1];if(inside(nx,ny)){
      if(x===sx&&y===sy){if(firstDir<0)firstDir=d;else if(d===firstDir&&steps>0)return pts}
      x=nx;y=ny;dir=d;moved=true;break}}
    if(!moved)return pts;
    if(++steps>limit)return pts;
    if(!(x===sx&&y===sy))pts.push([x,y]);
  }
}
function contourPolygon(mask,w,h,start,count){
  const ring=traceContour(mask,w,h,start,4*count+64);
  if(ring.length<4)return ring;
  const simple=rdp([...ring,ring[0]],.9);simple.pop();
  return simple.length>=3?simple:ring;
}
function rdp(points,eps){
  if(points.length<3)return points;
  const keep=new Uint8Array(points.length);keep[0]=keep[points.length-1]=1;
  const stack=[[0,points.length-1]];
  while(stack.length){
    const[a,b]=stack.pop();let best=-1,idx=-1;
    const[ax,ay]=points[a],[bx,by]=points[b],dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy);
    // segmento degenerado (percurso que volta ao início): usa a distância euclidiana
    for(let i=a+1;i<b;i++){const d=len<1e-9?Math.hypot(points[i][0]-ax,points[i][1]-ay):Math.abs(dy*(points[i][0]-ax)-dx*(points[i][1]-ay))/len;if(d>best){best=d;idx=i}}
    if(best>eps){keep[idx]=1;stack.push([a,idx],[idx,b])}
  }
  return points.filter((_,i)=>keep[i]);
}
// Percorre o esqueleto em profundidade a partir de uma extremidade, voltando pelos ramos:
// uma única polilinha desenha a fissura inteira (com ramificações) em SVG/DXF/IFC/canvas.
function skeletonWalk(skel,w,h,pixels){
  if(!pixels.length)return{points:[],length:0};
  const set=new Set(pixels),nb=i=>{const y=(i/w)|0,x=i-y*w,out=[];for(const[dx,dy]of[[0,-1],[1,0],[0,1],[-1,0],[1,-1],[1,1],[-1,1],[-1,-1]]){const nx=x+dx,ny=y+dy;if(nx>=0&&ny>=0&&nx<w&&ny<h&&set.has(ny*w+nx))out.push(ny*w+nx)}return out};
  const visited=new Set(),walk=[],parts=[];
  for(const seed of pixels){
    if(visited.has(seed))continue;
    // começa numa extremidade (1 vizinho) da parte, se existir
    let start=seed;const comp=[seed],seen=new Set([seed]);
    for(let k=0;k<comp.length;k++)for(const n of nb(comp[k]))if(!seen.has(n)){seen.add(n);comp.push(n)}
    for(const c of comp)if(nb(c).length===1){start=c;break}
    const part=[],stack=[[start,0]];visited.add(start);part.push(start);
    while(stack.length){
      const top=stack[stack.length-1],ns=nb(top[0]);let advanced=false;
      while(top[1]<ns.length){const n=ns[top[1]++];if(!visited.has(n)){visited.add(n);part.push(n);stack.push([n,0]);advanced=true;break}}
      if(!advanced){stack.pop();if(stack.length)part.push(stack[stack.length-1][0])}
    }
    parts.push(part);
  }
  parts.sort((a,b)=>b.length-a.length);
  // Cada aresta da árvore DFS é percorrida duas vezes (ida e volta): comprimento = metade da
  // polilinha já suavizada (Douglas-Peucker), por parte — aproxima a linha central euclidiana.
  let length=0;
  for(const part of parts){
    const simplified=rdp(part.map(i=>{const y=(i/w)|0;return[i-y*w,y]}),.8);
    for(let k=1;k<simplified.length;k++)length+=Math.hypot(simplified[k][0]-simplified[k-1][0],simplified[k][1]-simplified[k-1][1])/2;
    walk.push(...simplified);// partes separadas por < 2·gap são unidas (continuidade)
  }
  return{points:walk,length};
}
// Fragmentos: pontilhado e manchas compactas (poros: caixa com proporção < 2 e área < 4×área mínima)
// não entram no agrupamento; trechos alongados seguem, preservando a forma da etapa 4.
function crackFragments(mask,w,h,minArea){
  const n=w*h,seen=new Uint8Array(n),queue=new Int32Array(n),kept=new Uint8Array(n);
  for(let s=0;s<n;s++){
    if(!mask[s]||seen[s])continue;
    let head=0,tail=0;queue[tail++]=s;seen[s]=1;let minX=w,minY=h,maxX=0,maxY=0;
    while(head<tail){
      const p=queue[head++],y=(p/w)|0,x=p-y*w;
      if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
      for(let ny=Math.max(0,y-1);ny<=Math.min(h-1,y+1);ny++)for(let nx=Math.max(0,x-1);nx<=Math.min(w-1,x+1);nx++){const q=ny*w+nx;if(mask[q]&&!seen[q]){seen[q]=1;queue[tail++]=q}}
    }
    const bw=maxX-minX+1,bh=maxY-minY+1,elong=Math.max(bw,bh)/Math.max(1,Math.min(bw,bh));
    if(tail>=CRACK_MIN_FRAGMENT&&(elong>=2||tail>=CRACK_COMPACT_FACTOR*minArea))for(let k=0;k<tail;k++)kept[queue[k]]=1;
  }
  return kept;
}
// Esqueleto podado das fissuras (fragmentos → ponte de 4 px → Zhang-Suen → poda). Exposto para a paridade.
function crackSkeleton(rawMask,w,h,cfg){
  const mask=crackFragments(rawMask,w,h,Math.max(1,cfg.minArea));
  const n=w*h,bridged=filterMask(filterMask(mask,w,h,CRACK_BRIDGE_KERNEL,true),w,h,CRACK_BRIDGE_KERNEL,false);
  for(let i=0;i<n;i++)bridged[i]=bridged[i]|mask[i];
  return{mask,skel:pruneSpurs(zhangSuen(bridged,w,h),w,h)};
}
function crackRecords(rawMask,w,h,timeLabel,cfg){
  const{mask,skel}=crackSkeleton(rawMask,w,h,cfg),n=w*h,grow=filterMask(mask,w,h,CRACK_BRIDGE_KERNEL,true);
  // grupos: fragmentos a ≤ CRACK_GAP_PX px uns dos outros formam a mesma fissura
  const label=new Int32Array(n).fill(-1),queue=new Int32Array(n),groups=[];
  for(let s=0;s<n;s++){
    if(!mask[s]||label[s]>=0)continue;
    const id=groups.length,g={crack:[],skel:[]};groups.push(g);
    let head=0,tail=0;queue[tail++]=s;label[s]=id;
    while(head<tail){
      const p=queue[head++],y=(p/w)|0,x=p-y*w;
      for(let ny=Math.max(0,y-1);ny<=Math.min(h-1,y+1);ny++)for(let nx=Math.max(0,x-1);nx<=Math.min(w-1,x+1);nx++){
        const q=ny*w+nx;if(grow[q]&&label[q]<0){label[q]=id;queue[tail++]=q}
      }
    }
  }
  for(let i=0;i<n;i++){const id=label[i];if(id<0)continue;if(mask[i])groups[id].crack.push(i);if(skel[i])groups[id].skel.push(i)}
  const records=[],minArea=Math.max(1,cfg.minArea),minAspect=cfg.minAspect;let componentNumber=0;
  for(const g of groups){
    const area=g.crack.length;if(area<minArea)continue;
    let minX=w,minY=h,maxX=0,maxY=0;
    for(const p of g.crack){const y=(p/w)|0,x=p-y*w;if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y}
    componentNumber++;
    const bw=maxX-minX+1,bh=maxY-minY+1;
    // Alongamento pela forma real (comprimento do esqueleto ÷ largura média = L²/A), válido para fissuras curvas.
    const walk=skeletonWalk(skel,w,h,g.skel),points=walk.points,length=Math.max(1,walk.length),aspect=length*length/area;
    // comprimento mínimo de fissura: 3% do maior lado da imagem processada (grão/textura curtos)
    if(aspect<minAspect||length<CRACK_MIN_LENGTH_FRACTION*Math.max(w,h))continue;
    // CDM 2.11: largura média de fissura ≤ 0,45·k (manchas largas de textura não são fissuras)
    if(area/length>CRACK_MAX_WIDTH_K*oddKernel(cfg.kernel))continue;
    let perimeter=0;for(const p of g.crack)if(isBoundary(mask,w,h,p))perimeter++;
    if(points.length<2)continue;
    records.push({
      id:timeLabel+"_cracks_"+String(componentNumber).padStart(4,"0"),
      time_label:timeLabel,class:"cracks",source_class:"cracks",bbox:[minX,minY,bw,bh],points,closed:false,
      area_px2:area,perimeter_px:perimeter,length_px:length,width_px:area/length,aspect_ratio:aspect,
      geometry_method:"skeleton_polyline_v1",
      confidence_note:"Browser CDM 2.9: fissura pela linha central do esqueleto (Zhang-Suen), fragmentos a ≤ "+CRACK_GAP_PX+" px unidos; largura média = área/comprimento."
    });
  }
  return records;
}
// Regiões (desplacamento, corrosão, eflorescência): ignora manchas irrelevantes e não repete caixas
// contidas numa caixa maior da mesma patologia (a área contida é somada à maior).
// Mesma regra em backend/app/cdm_v285.py (consolidate_area_records); paridade testada em CI.
const AREA_CLASSES=new Set(["spalling_dark","corrosion_rust","efflorescence_white"]);
const AREA_REGION_FRACTION=.0005,AREA_LARGEST_FRACTION=.03,AREA_CONTAIN_FRACTION=.8;
// Exclusão na resolução da imagem, erodida em ~1,5 célula do mapa de cena: a borda de baixa resolução
// do modelo não "morde" o contorno das manchas; só o interior da cena irrelevante conta.
function contextCore(ctx,w,h){
  if(ctx.core&&ctx.core.w===w&&ctx.core.h===h)return ctx.core;
  const ew=ctx.w,eh=ctx.h,ex=ctx.mask,mx=new Int32Array(w),exImg=new Uint8Array(w*h);
  for(let x=0;x<w;x++)mx[x]=Math.min(ew-1,Math.floor((x+.5)*ew/w));
  for(let y=0;y<h;y++){const er=Math.min(eh-1,Math.floor((y+.5)*eh/h))*ew,row=y*w;for(let x=0;x<w;x++)exImg[row+x]=ex[er+mx[x]]}
  const r=Math.ceil((ctx.erodeCells??1.5)*Math.max(w/ew,h/eh)),core=r>0?filterMask(exImg,w,h,2*r+1,false):exImg;
  if(ctx.extra&&ctx.extra.length===w*h){const c2=new Uint8Array(core);for(let i=0;i<c2.length;i++)if(ctx.extra[i])c2[i]=1;ctx.core={mask:c2,w,h,abstained:false};return ctx.core}
  ctx.core={mask:core,w,h,abstained:false};return ctx.core;
}
function clipMasksByContext(masks,w,h,ctx,includeCracks){
  const exCore=contextCore(ctx,w,h).mask,out={...masks},clipped={};
  for(const cls of ORDER){
    const m=masks[cls];if(!(m instanceof Uint8Array)||(cls==="cracks"&&!includeCracks))continue;
    let n=0;const c=new Uint8Array(m);
    for(let i=0;i<w*h;i++)if(c[i]&&exCore[i]){c[i]=0;n++}
    // abertura 3×3 retira as lascas de 1 px deixadas pelo recorte
    out[cls]=n&&cls!=="cracks"?filterMask(filterMask(c,w,h,3,false),w,h,3,true):c;clipped[cls]=n;
  }
  return{masks:out,clipped};
}
function pointInPolygon(x,y,pts){
  if(!pts||pts.length<3)return true;let inside=false;
  for(let i=0,j=pts.length-1;i<pts.length;j=i++){const[xi,yi]=pts[i],[xj,yj]=pts[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside}
  return inside;
}
function consolidateAreaRecords(records,w,h,cfg){
  if(!records.length)return records;
  const largest=Math.max(...records.map(r=>r.area_px2),cfg.areaRefLargest?.[records[0].class]||0);
  const minRegion=Math.max(Math.max(1,cfg.minArea),AREA_REGION_FRACTION*w*h,AREA_LARGEST_FRACTION*largest);
  const big=records.filter(r=>r.area_px2>=minRegion).sort((a,b)=>b.area_px2-a.area_px2||(a.id<b.id?-1:1)),kept=[];
  for(const r of big){
    const[x,y,bw,bh]=r.bbox;
    // absorve só caixas repetidas: contidas na caixa maior E com o centro dentro do contorno dela
    const cx=x+bw/2,cy=y+bh/2;
    const host=kept.find(k=>{const[kx,ky,kw,kh]=k.bbox,ix=Math.max(0,Math.min(x+bw,kx+kw)-Math.max(x,kx)),iy=Math.max(0,Math.min(y+bh,ky+kh)-Math.max(y,ky));return ix*iy>=AREA_CONTAIN_FRACTION*bw*bh&&(!k.closed||pointInPolygon(cx,cy,k.points))});
    if(host)host.area_px2+=r.area_px2;else kept.push({...r});
  }
  return kept.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
}
function recordsFromMask(mask,w,h,damageClass,timeLabel,cfg){
  if(damageClass==="cracks")return crackRecords(mask,w,h,timeLabel,cfg);
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
    // CDM 2.11: armadura exposta precisa ter comprimento de barra (≥ 3% do maior lado) e área ≥ 2·A_min
    if(damageClass==="exposed_rebar"&&(aspect<Math.max(3,minAspect)||major<CRACK_MIN_LENGTH_FRACTION*Math.max(w,h)||tail<2*minArea))continue;

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
      // o primeiro pixel encontrado na varredura é o mais acima/esquerda do componente
      points=contourPolygon(mask,w,h,start,tail);
      if(points.length<3){const boundary=[];for(let q=0;q<tail;q++)if(isBoundary(mask,w,h,queue[q])){const p=queue[q],y=Math.floor(p/w),x=p-y*w;boundary.push([x,y])}points=convexHull(boundary)}
      length=damageClass==="exposed_rebar"?major:perimeter;widthPx=minor;closed=true;
      note=damageClass==="exposed_rebar"?"Browser CDM: armadura exposta pelo contorno real no desplacamento.":"Browser CDM: região representada pelo contorno real (Moore + RDP 0,9 px).";
    }
    if(points.length<2)continue;
    records.push({
      id:timeLabel+"_"+damageClass+"_"+String(componentNumber).padStart(4,"0"),
      time_label:timeLabel,class:damageClass,source_class:damageClass,bbox:[minX,minY,bw,bh],points,closed,
      area_px2:tail,perimeter_px:perimeter,length_px:length,width_px:widthPx,aspect_ratio:aspect,confidence_note:note
    });
  }
  return AREA_CLASSES.has(damageClass)?consolidateAreaRecords(records,w,h,cfg):records;
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
  const stats={},records=[],mm2Factor=cfg.mmPerPx>0?cfg.mmPerPx*cfg.mmPerPx:null;
  for(const cls of Object.keys(cur)){
    const a=cur[cls],b=prev[cls];if(!b)continue;
    const growth=new Uint8Array(a.length),reduction=new Uint8Array(a.length);let inter=0,union=0,g=0,r=0,currentArea=0,previousArea=0;
    for(let i=0;i<a.length;i++){
      if(a[i])currentArea++;
      if(b[i])previousArea++;
      if(a[i]&&b[i])inter++;
      if(a[i]||b[i])union++;
      if(a[i]&&!b[i]){growth[i]=1;g++}
      if(b[i]&&!a[i]){reduction[i]=1;r++}
    }
    const net=currentArea-previousArea;
    stats[cls]={
      iou:union?inter/union:1,
      intersection_area_px2:inter,union_area_px2:union,
      previous_area_px2:previousArea,current_area_px2:currentArea,
      growth_area_px2:g,reduction_area_px2:r,net_area_change_px2:net,
      growth_rate_vs_t0_pct:previousArea>0?100*g/previousArea:null,
      reduction_rate_vs_t0_pct:previousArea>0?100*r/previousArea:null,
      net_area_change_vs_t0_pct:previousArea>0?100*net/previousArea:null,
      previous_area_mm2:mm2Factor==null?null:previousArea*mm2Factor,
      current_area_mm2:mm2Factor==null?null:currentArea*mm2Factor,
      growth_area_mm2:mm2Factor==null?null:g*mm2Factor,
      reduction_area_mm2:mm2Factor==null?null:r*mm2Factor,
      net_area_change_mm2:mm2Factor==null?null:net*mm2Factor
    };
    const gr=recordsFromMask(growth,w,h,"growth","growth_"+cls,cfg),rr=recordsFromMask(reduction,w,h,"reduction","reduction_"+cls,cfg);
    gr.forEach(x=>{x.source_class=cls;x.confidence_note+=" Classe base: "+LABELS[cls]+"."});
    rr.forEach(x=>{x.source_class=cls;x.confidence_note+=" Classe base: "+LABELS[cls]+"."});
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
  try{return new DOMException("Análise CDM-4 cancelada.","AbortError")}
  catch{const e=new Error("Análise CDM-4 cancelada.");e.name="AbortError";return e}
}
// ---------- CDM-4: correções de contexto + refino (mesmas etapas em t1 e em t0) ----------
// Ordem validada nas 20 fotos de inspeção e no GT da foto 24:
//   morfologia CDM 2.11 → IA de contexto (F1, F2, F4) → canal de diversidade (Ataky) → refino de
//   borda por biodiversidade → random walker do desplacamento → armadura linear → recorte final
//   pela exclusão → vetorização → camada de pigmentos (diagnóstico).
function prepareContext(current,cfg,log){
  const c=cfg.context;if(!c?.mask||c.abstained)return;
  if(cfg.f1){const r=neutralizeEnclosedTerrain(c);c.mask=r.mask;log.f1_neutralized_cells=r.neutralized_cells}
  if(cfg.f5){const r=neutralizeDominantTerrain(c,cfg.f5Share);c.mask=r.mask;log.f5_terrain_share=r.share;log.f5_applied=r.applied}
  c.erodeCells=cfg.contextErodeCells;
  if(cfg.sky){const s=overexposedSky(current.data,current.width,current.height);c.extra=s.pixels?s.mask:null;log.sky_px=s.pixels}
  delete c.core;
}
function contextExclusionMask(cfg,w,h){return cfg.context?.mask&&!cfg.context.abstained?contextCore(cfg.context,w,h).mask:null}
function gateByContext(masks,w,h,cfg){
  const gated=gateMasks(masks,w,h,contextCore(cfg.context,w,h),{share:cfg.contextShare});
  let out={...masks,...gated.masks},clippedPx=null;
  if(cfg.contextClip!==false){const clipped=clipMasksByContext(out,w,h,cfg.context,cfg.contextClipCracks===true);out=clipped.masks;clippedPx=clipped.clipped}
  return{masks:out,removed:gated.removed,removed_total:gated.removed_total,clipped_px:clippedPx};
}
function refineCdm4(image,masks,cfg,log,stages=null){
  const w=image.width,h=image.height,n=w*h,ex=contextExclusionMask(cfg,w,h);
  masks={...masks};
  if(stages)stages.morphology={...masks};
  const site=masks.spalling_dark?new Uint8Array(masks.spalling_dark):null;
  // 1) canal de diversidade: desplacamento como comunidade anômala (Shannon/Simpson) que a regra de
  //    cinza não pegou; não invade eflorescência (separação de classes preservada)
  if(cfg.diversity){
    const d=diversityCandidates(bioFeatures(image.data,w,h,{win:21}),{exclusion:ex,opts:cfg.divOpts});
    const sp=new Uint8Array(masks.spalling_dark),ef=masks.efflorescence_white;let added=0;
    for(let i=0;i<n;i++)if(d.mask[i]&&!sp[i]&&!(ef&&ef[i])){sp[i]=1;added++}
    masks.spalling_dark=sp;log.diversity={added_px:added,candidates:d.log};
    if(stages)stages.diversity_added=d.mask;
  }
  // 2) refino de borda pela comunidade saudável vizinha; referência de área guardada antes do gate
  let areaRef=null;
  if(cfg.bio){
    areaRef={};for(const k of ["spalling_dark","corrosion_rust","efflorescence_white"])areaRef[k]=largestComponent(masks[k],w,h);
    const r=bioRefineMasks(masks,bioFeatures(image.data,w,h,cfg.bioOpts),{exclusion:ex,opts:cfg.bioOpts});
    masks={...r.masks};log.biodiversity=r.log;
  }
  if(stages)stages.integrated=masks.spalling_dark;
  // 3) random walker: polos = núcleo do desplacamento morfológico (dano) e concreto distante/homogêneo
  if(cfg.randomWalker){
    // parâmetros espaciais calibrados para 1600 px de lado: proporcionais ao tamanho da foto
    const side=Math.max(w,h),k=side/1600,rwo={...cfg.rwOpts};
    // fotos pequenas (< 1000 px): escala 1 e distâncias proporcionais; as demais seguem a calibração validada
    if(cfg.rwScaleAware!==false&&side<1000){rwo.scale=1;const f=1;rwo.healthyFarPx=Math.max(2,Math.round(rwo.healthyFarPx*k*2/f));rwo.siteGuardPx=Math.max(2,Math.round(rwo.siteGuardPx*k*2/f))}
    const r=randomWalkerSpalling(image.data,w,h,{site,integrated:masks.spalling_dark,exclusion:ex,forbid:masks.efflorescence_white,opts:rwo});
    if(r.mask)masks.spalling_dark=r.mask;log.random_walker=r.log;
    if(r.mask&&r.prob&&cfg.walkerFullres){
      // walker refeito em resolução cheia em torno de cada desplacamento (substitui a decisão em meia escala)
      const fr=refineWalkerFullRes(image.data,w,h,{prob:r.prob,W:r.W,H:r.H,f:r.log.scale,threshold:r.log.threshold},r.mask,{forbid:[ex,masks.efflorescence_white]});
      if(stages)stages.fullres={before:r.mask};
      masks.spalling_dark=fr.mask;log.walker_fullres=fr.log;
    }else if(r.mask&&r.prob&&cfg.contour){
      const E=evidenceMaps(image.data,w,h,{scale:r.log.scale}),c=refineContourThresholds(r.prob,r.W,r.H,[E.L,E.rough],r.log.threshold,cfg.contourOpts);
      if(stages)stages.contour={before:r.mask,log:c.log};
      masks.spalling_dark=upsampleWithThresholdMap(r.prob,c.tMap,r.W,r.H,r.log.scale,w,h,[ex,masks.efflorescence_white]);log.contour=c.log;
    }
    if(stages&&r.prob)stages.random_walker={prob:r.prob,W:r.W,H:r.H,threshold:r.log.threshold,site};
  }
  // 4) armadura exposta por abertura linear dentro do desplacamento final
  if(cfg.linearRebar){
    const{gray}=grayAndRgb(image,true),k=cfg.rebarOpts?.k||REBAR_DEFAULTS.k;
    const r=linearRebar(gray,blackhat(gray,w,h,k),w,h,masks.spalling_dark,cfg.rebarOpts);
    masks.exposed_rebar=r.mask;log.linear_rebar=r.log;
  }
  if(stages)stages.final={...masks};
  // 5) o resultado final respeita a exclusão de contexto
  if(ex&&cfg.contextClip!==false)masks=clipMasksByContext(masks,w,h,cfg.context,cfg.contextClipCracks===true).masks;
  return{masks,areaRef};
}

// Fluxo por evidência (cdm4_flow = "evidence"): o desplacamento não parte da morfologia.
//   normalização (referência = concreto claro do domínio) → contexto como domínio → evidências
//   (rugosidade, diversidade de Ataky, escuridão local) → polos → random walker → juiz de
//   biodiversidade por componente → separação de famílias → armadura linear → recorte final.
// Corrosão e eflorescência continuam nas regras de cor; fissuras no black-hat + esqueleto.
function refineEvidence(image,masks,cfg,log,stages=null){
  const w=image.width,h=image.height,n=w*h,ex=contextExclusionMask(cfg,w,h);
  masks={...masks};
  if(stages)stages.morphology={...masks};
  const{valid}=grayAndRgb(image,true),domain=new Uint8Array(n);
  for(let i=0;i<n;i++)domain[i]=(!ex||!ex[i])&&(!valid||valid[i])?1:0;
  const side=Math.max(w,h),f=side>=1000?2:1,eo={...EVIDENCE_DEFAULTS,...(cfg.evidenceOpts||{})};
  const E=evidenceMaps(image.data,w,h,{domain,scale:f,opts:eo}),seeds=evidenceSeeds(E,eo);
  const R=walkerFromSeeds([E.L,E.o1,E.o2,E.Hs],E.W,E.H,seeds.damage,seeds.healthy,cfg.rwOpts);
  let nd=0;for(const v of seeds.damage)nd+=v;
  log.evidence={scale:f,reference_cut_L:+E.refCut.toFixed(1),damage_seed_px:nd,healthy_seed_px:R.seeds.healthy,iterations:R.iterations,converged:R.converged,threshold:eo.threshold};
  let sp=R.prob?upsampleThreshold(R.prob,E.W,E.H,f,w,h,eo.threshold,[ex,masks.efflorescence_white]):new Uint8Array(n);
  if(R.prob&&cfg.walkerFullres){
    const fr=refineWalkerFullRes(image.data,w,h,{prob:R.prob,W:E.W,H:E.H,f,threshold:eo.threshold},sp,{forbid:[ex,masks.efflorescence_white]});
    if(stages)stages.fullres={before:sp};
    sp=fr.mask;log.walker_fullres=fr.log;
  }else if(R.prob&&cfg.contour){
    const c=refineContourThresholds(R.prob,E.W,E.H,[E.L,E.rough],eo.threshold,cfg.contourOpts);
    if(stages)stages.contour={before:sp,log:c.log};
    sp=upsampleWithThresholdMap(R.prob,c.tMap,E.W,E.H,f,w,h,[ex,masks.efflorescence_white]);log.contour=c.log;
  }
  if(stages)stages.evidence={W:E.W,H:E.H,f,rough:E.rough,div:E.div,dark:E.dark,seedsDamage:seeds.damage,seedsHealthy:seeds.healthy};
  if(stages&&R.prob)stages.random_walker={prob:R.prob,W:E.W,H:E.H,threshold:eo.threshold,site:null};
  // A máscara do walker (etapa do potencial) é a verdade de fronteira deste fluxo: a armadura da
  // morfologia, que o juiz anexa ao desplacamento, só vale dentro dela; fora, era falso núcleo.
  let rebarClipped=0;
  if(masks.exposed_rebar){const r=new Uint8Array(masks.exposed_rebar);for(let i=0;i<n;i++)if(r[i]&&!sp[i]){r[i]=0;rebarClipped++}masks.exposed_rebar=r}
  // juiz de biodiversidade: cada componente precisa se distinguir da coroa saudável vizinha
  let areaRef=null;
  if(cfg.bio){
    const cand={...masks,spalling_dark:sp};
    areaRef={};for(const k of ["spalling_dark","corrosion_rust","efflorescence_white"])areaRef[k]=largestComponent(cand[k],w,h);
    const r=bioRefineMasks(cand,bioFeatures(image.data,w,h,cfg.bioOpts),{exclusion:ex,opts:{...cfg.bioOpts,modes:{spalling_dark:"gate",efflorescence_white:"gate"}}});
    masks={...r.masks};log.biodiversity=r.log;
  }else masks.spalling_dark=sp;
  // o juiz só remove: nada fora da máscara do walker entra no desplacamento
  {const m=new Uint8Array(masks.spalling_dark);let out=0;for(let i=0;i<n;i++)if(m[i]&&!sp[i]){m[i]=0;out++}masks.spalling_dark=m;log.walker_bound={rebar_clipped_px:rebarClipped,spalling_clipped_px:out}}
  if(stages)stages.integrated=masks.spalling_dark;
  separateFamilies(masks,w,h);
  if(cfg.linearRebar){
    const{gray}=grayAndRgb(image,true),k=cfg.rebarOpts?.k||REBAR_DEFAULTS.k;
    const r=linearRebar(gray,blackhat(gray,w,h,k),w,h,masks.spalling_dark,cfg.rebarOpts);
    masks.exposed_rebar=r.mask;log.linear_rebar=r.log;
  }
  if(ex&&cfg.contextClip!==false)masks=clipMasksByContext(masks,w,h,cfg.context,cfg.contextClipCracks===true).masks;
  if(stages)stages.final={...masks};
  return{masks,areaRef};
}
// Composição por pigmentos dentro do contorno de um registro de área (varredura por linhas).
function polygonComposition(maps,mask,w,h,r){
  const pts=r.points;if(!r.closed||!pts||pts.length<3)return null;
  const[bx,by,bw,bh]=r.bbox,sel=new Uint8Array(w*h);let any=false;
  for(let y=Math.max(0,by);y<Math.min(h,by+bh+1);y++){
    const yc=y+.5,xs=[];
    for(let i=0,j=pts.length-1;i<pts.length;j=i++){const[xi,yi]=pts[i],[xj,yj]=pts[j];if((yi>yc)!==(yj>yc))xs.push(xi+(yc-yi)*(xj-xi)/(yj-yi))}
    xs.sort((a,b)=>a-b);
    for(let k=0;k+1<xs.length;k+=2){for(let x=Math.max(0,Math.ceil(xs[k]-.5));x<=Math.min(w-1,Math.floor(xs[k+1]-.5));x++){const p=y*w+x;if(mask[p]){sel[p]=1;any=true}}}
  }
  return any?maskComposition(maps,sel):null;
}
function computeCdm4Core(current,previous,cfg,onProgress=null){
  const w=current.width,h=current.height,records=[],refineLog={},contextLog={};
  prepareContext(current,cfg,contextLog);
  emitProgress(onProgress,15,"CDM-4 · segmentando t1","segment_t1");
  let masks=detectMasks(current,cfg),contextFilter=null,discardedMasks=null;
  if(cfg.context?.mask&&!cfg.context.abstained){
    const original=masks,g=gateByContext(masks,w,h,cfg);masks=g.masks;
    discardedMasks={};
    for(const cls of ORDER){const a=original[cls],b=masks[cls];if(!(a instanceof Uint8Array))continue;const d=new Uint8Array(a.length);let any=0;for(let i=0;i<a.length;i++)if(a[i]&&!b[i]){d[i]=1;any=1}if(any)discardedMasks[cls]=d}
    contextFilter={applied:true,removed:g.removed,removed_total:g.removed_total,clipped_px:g.clipped_px,corrections:{f1_enclosed_terrain_neutral:!!cfg.f1,erode_cells:cfg.contextErodeCells,f4_overexposed_sky:!!cfg.sky,...contextLog}};
  }else if(cfg.context)contextFilter={applied:false,abstained:!!cfg.context.abstained};
  emitProgress(onProgress,25,"CDM-4 · biodiversidade e random walker","refine_t1");
  const stageData=cfg.returnStages?{}:null;
  const refined=(cfg.flow==="evidence"?refineEvidence:refineCdm4)(current,masks,cfg,refineLog,stageData);masks=refined.masks;
  if(refined.areaRef)cfg.areaRefLargest=refined.areaRef;
  emitProgress(onProgress,35,"CDM-4 · máscaras t1","masks_t1");
  ORDER.forEach((cls,index)=>{
    records.push(...recordsFromMask(masks[cls],w,h,cls,"t1_current",cfg));
    emitProgress(onProgress,35+Math.round((index+1)/ORDER.length*20),"CDM-4 · vetorizando "+LABELS[cls],"vectorize_t1");
  });
  let contextDiscarded=[];
  if(cfg.context?.cls){
    for(const r of records)r.scene=sceneOf(masks[r.class],w,h,r.bbox,cfg.context);
    if(discardedMasks){
      for(const cls of ORDER){
        if(!discardedMasks[cls])continue;
        for(const r of recordsFromMask(discardedMasks[cls],w,h,cls,"context_discarded",cfg)){r.scene=sceneOf(discardedMasks[cls],w,h,r.bbox,cfg.context);r.discarded_by_context=true;contextDiscarded.push(r)}
      }
      contextDiscarded.sort((a,b)=>(b.area_px2||0)-(a.area_px2||0));
      contextDiscarded.forEach((r,i)=>{r.code="IA"+(i+1)});
      if(contextFilter)contextFilter.discarded_records=contextDiscarded.length;
    }
  }
  // pigmentos (diagnóstico): composição de cada achado de área e da corrosão como um todo
  let pigments=null;
  if(cfg.pigments){
    const any=new Uint8Array(w*h);for(const cls of ORDER){const m=masks[cls];if(m)for(let i=0;i<m.length;i++)if(m[i])any[i]=1}
    const maps=pigmentMaps(current.data,w,h,any,cfg.pigmentOpts);
    for(const r of records){if(r.class==="cracks")continue;const c=polygonComposition(maps,masks[r.class],w,h,r);if(c)r.pigments=c}
    const classes={};for(const cls of ["spalling_dark","exposed_rebar","corrosion_rust","efflorescence_white"]){const c=masks[cls]?maskComposition(maps,masks[cls]):null;if(c)classes[cls]=c}
    let bioPx=0,rustPx=0;for(let i=0;i<w*h;i++){if(maps.biological[i]>maps.opts.bioThreshold)bioPx++;if(maps.rust[i]>maps.opts.rustThreshold)rustPx++}
    if(stageData){
      const W2=Math.max(1,w>>1),H2=Math.max(1,h>>1),half=a=>{const o=new Float32Array(W2*H2);for(let y=0;y<H2;y++)for(let x=0;x<W2;x++){const i=2*y*w+2*x;o[y*W2+x]=(a[i]+a[Math.min(i+1,w*h-1)]+a[Math.min(i+w,w*h-1)]+a[Math.min(i+w+1,w*h-1)])/4}return o};
      stageData.pigments={rust:half(maps.rust),biological:half(maps.biological),W:W2,H:H2,I0:maps.I0,rustThreshold:maps.opts.rustThreshold,bioThreshold:maps.opts.bioThreshold};
    }
    pigments={method:"beer_lambert_deconvolution",reference_I0:maps.I0,vectors:PIGMENT_VECTORS,rust_threshold:maps.opts.rustThreshold,biological_threshold:maps.opts.bioThreshold,classes,image_rust_fraction:+(rustPx/(w*h)).toFixed(4),image_biological_fraction:+(bioPx/(w*h)).toFixed(4),role:"diagnostic"};
  }
  let temporal={enabled:false,alignment_method:null,alignment:null,stats:{},records:[]};
  if(previous){
    emitProgress(onProgress,58,"CDM-4 · alinhando t0→t1","temporal_alignment");
    const registration=registerPrevious(current,previous,cfg.alignmentMethod||"translation_auto");
    const quality=temporalQualityAssessment(current,registration.image,registration.metrics);
    emitProgress(onProgress,65,"CDM-4 · segmentando t0 alinhado","segment_t0");
    let prevMasks=detectMasks(registration.image,cfg);
    if(contextFilter?.applied)prevMasks=gateByContext(prevMasks,w,h,cfg).masks;
    prevMasks=(cfg.flow==="evidence"?refineEvidence:refineCdm4)(registration.image,prevMasks,cfg,{}).masks;
    emitProgress(onProgress,78,"CDM-4 · comparando t0→t1","temporal_compare");
    const change=temporalCompare(masks,prevMasks,w,h,cfg);
    temporal={enabled:true,alignment_method:registration.metrics.method_applied,alignment:registration.metrics,quality,aligned_previous:registration.image,stats:change.stats,records:change.records};
    emitProgress(onProgress,88,"CDM-4 · mudança temporal","temporal_vectors");
  }else emitProgress(onProgress,88,"CDM-4 · consolidando achados","consolidate");
  emitProgress(onProgress,92,"CDM-4 · classificação preliminar","condition_rating");
  const resultSummary=summary(records,cfg,w*h);
  emitProgress(onProgress,96,"CDM-4 · finalizando núcleo","core_complete");
  const out={
    width:w,height:h,records,temporal,summary:resultSummary,context_filter:contextFilter,context_discarded:contextDiscarded,
    refinement:refineLog,pigments,
    protocol:{stages:cfg.flow==="evidence"?["normalization","context_domain","evidence","poles","random_walker","biodiversity_judge","family_separation","linear_rebar","connected_components","pigment_diagnostic"]:["base_image","family_response","candidate_mask","open_close_mask","context_filter","diversity_channel","biodiversity_border","random_walker","linear_rebar","connected_components","pigment_diagnostic"],flow:cfg.flow,version:"cdm4_image_v4.0.0"}
  };
  if(cfg.returnMasks)out.masks_final=masks;
  if(stageData)out.stages=stageData;
  return out;
}
function runCoreWorker(current,previous,cfg,{signal,onProgress}={}){
  if(signal?.aborted)return Promise.reject(abortError());
  if(typeof Worker==="undefined"){
    const result=computeCdm4Core(current,previous,cfg,onProgress);
    if(signal?.aborted)return Promise.reject(abortError());
    return Promise.resolve({...result,execution:"main-thread"});
  }
  const worker=new Worker(new URL("./cdm4Worker.js",import.meta.url),{type:"module"});
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
      const error=new Error(e.data?.error||"Falha no Web Worker do CDM-4.");finish();reject(error);
    };
    worker.onerror=e=>{const error=new Error(e.message||"Falha no Web Worker do CDM-4.");finish();reject(error)};
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
// Mapa do filtro de contexto sobre a imagem: vermelho = irrelevante (descartado), verde = estrutura.
function contextOverlay(img,excl){
  try{
    const W=Math.min(img.width,800),H=Math.max(1,Math.round(img.height*W/img.width));
    const c=document.createElement("canvas");c.width=W;c.height=H;const ctx=c.getContext("2d");
    const src=document.createElement("canvas");src.width=img.width;src.height=img.height;
    src.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(img.data),img.width,img.height),0,0);
    ctx.drawImage(src,0,0,W,H);
    const m=document.createElement("canvas");m.width=excl.w;m.height=excl.h;const mctx=m.getContext("2d"),md=mctx.createImageData(excl.w,excl.h);
    for(let i=0;i<excl.mask.length;i++){const p=i*4;if(excl.mask[i]){md.data[p]=230;md.data[p+1]=40;md.data[p+2]=40;md.data[p+3]=125}else if(excl.structure?.[i]){md.data[p]=13;md.data[p+1]=150;md.data[p+2]=110;md.data[p+3]=70}}
    mctx.putImageData(md,0,0);ctx.imageSmoothingEnabled=false;ctx.drawImage(m,0,0,W,H);
    return c.toDataURL("image/jpeg",.85).split(",")[1];
  }catch{return null}
}
function imageDataToPngB64(imageData){
  const c=document.createElement("canvas");c.width=imageData.width;c.height=imageData.height;
  const ctx=c.getContext("2d");
  const data=imageData.data instanceof Uint8ClampedArray?imageData.data:new Uint8ClampedArray(imageData.data);
  ctx.putImageData(new ImageData(data,imageData.width,imageData.height),0,0);
  return c.toDataURL("image/png").split(",")[1];
}
async function imageDataFromFile(file,maxSide,target=null){
  const bmp=await createImageBitmap(file,{imageOrientation:"from-image"});
  let w,h;if(target){[w,h]=target}else{const s=Math.min(1,maxSide/Math.max(bmp.width,bmp.height));w=Math.max(1,Math.round(bmp.width*s));h=Math.max(1,Math.round(bmp.height*s))}
  const c=document.createElement("canvas");c.width=w;c.height=h;const ctx=c.getContext("2d",{willReadFrequently:true});ctx.drawImage(bmp,0,0,w,h);bmp.close?.();return ctx.getImageData(0,0,w,h);
}
// Configuração do CDM a partir das opções do usuário (mesma usada pela paridade da imagem).
const on=(v,d=true)=>v===undefined||v===null?d:v!==false&&v!=="false"&&v!=="off";
export const CDM4_DEFAULT_BIO_OPTS={decide:"fine",noOpen:true,band:10,classes:["spalling_dark","efflorescence_white"],modes:{spalling_dark:"refine",efflorescence_white:"gate"}};
export function cdm4Config(options={}){
  return{
    threshold:clamp(Number(options.cdm_threshold??35),1,255),
    kernel:oddKernel(Number(options.cdm_kernel_size??15)),
    minArea:clamp(Number(options.cdm_min_area??30),1,1e6),
    minAspect:clamp(Number(options.cdm_min_aspect_ratio??2),1,50),
    mmPerPx:Math.max(0,Number(options.cdm_mm_per_px??0)),
    elementFamily:options.cdm_element_family||"lajes_vigas_secundarias_apoios",
    alignmentMethod:options.cdm_alignment_method||"translation_auto",
    contextMode:CONTEXT_MODES[options.cdm_context_filter]?options.cdm_context_filter:"off",
    contextShare:clamp(Number(options.cdm_context_share??DEFAULT_CONTEXT_SHARE),.2,1),
    contextOptions:contextOptionsFrom(options),
    contextClip:options.cdm_context_clip!==false,
    contextClipCracks:options.cdm_context_clip_cracks===true,
    // CDM-4: cada etapa nova pode ser desligada (cdm4_*: false) para auditoria e ablação
    f1:on(options.cdm4_context_f1),
    sky:on(options.cdm4_context_sky),
    f5:on(options.cdm4_context_f5),
    contour:on(options.cdm4_contour_refine,false),
    walkerFullres:on(options.cdm4_walker_fullres,false),
    contourOpts:{...CONTOUR_DEFAULTS,criterion:"fisher",maxDelta:clamp(Number(options.cdm4_contour_max_delta??.1),.01,.5)},
    flow:options.cdm4_flow==="evidence"?"evidence":"morphology",
    evidenceOpts:{threshold:clamp(Number(options.cdm4_evidence_threshold??.5),.1,.9),seedCore:Math.max(1,Math.round(Number(options.cdm4_evidence_seed_core??9)))},
    f5Share:clamp(Number(options.cdm4_context_f5_share??.5),.2,1),
    contextErodeCells:clamp(Number(options.cdm4_context_erode_cells??.5),0,4),
    diversity:on(options.cdm4_diversity),
    divOpts:{localRef:false},
    bio:on(options.cdm4_biodiversity),
    bioOpts:{...CDM4_DEFAULT_BIO_OPTS},
    randomWalker:on(options.cdm4_random_walker),
    rwOpts:{...RW_DEFAULTS,maxGrowPx:options.cdm4_rw_max_grow_px==null?RW_DEFAULTS.maxGrowPx:Math.max(0,Number(options.cdm4_rw_max_grow_px)),threshold:clamp(Number(options.cdm4_rw_threshold??RW_DEFAULTS.threshold),.05,.95),beta:clamp(Number(options.cdm4_rw_beta??RW_DEFAULTS.beta),1,500)},
    linearRebar:on(options.cdm4_linear_rebar),
    rebarOpts:{...REBAR_DEFAULTS,q:clamp(Number(options.cdm4_rebar_percentile??REBAR_DEFAULTS.q),1,60)},
    pigments:on(options.cdm4_pigments),
    pigmentOpts:{...PIGMENT_DEFAULTS},
    returnMasks:options.cdm4_return_masks===true
  };}
// Dados intermediários (máscaras, potencial do random walker, pigmentos) para o módulo de Etapas.
// Ficam fora do resultado serializado: não vão para o histórico nem para as exportações.
const CDM4_STAGE_CACHE=new WeakMap();
export function cdm4StageData(engineResult){return engineResult?CDM4_STAGE_CACHE.get(engineResult)||null:null}
export async function runCdm4Browser(file,options={},previousFile=null,control={}){
  const started=performance.now(),onProgress=control?.onProgress,signal=control?.signal;
  if(signal?.aborted)throw abortError();
  const cfg=cdm4Config(options);cfg.returnStages=true;

  emitProgress(onProgress,3,"CDM-4 · decodificando t1","decode_t1");
  const decodeStarted=performance.now();
  let current=await imageDataFromFile(file,1600),w=current.width,h=current.height;
  if(signal?.aborted)throw abortError();
  let previous=null;
  if(previousFile){
    emitProgress(onProgress,7,"CDM-4 · decodificando t0","decode_t0");
    previous=await imageDataFromFile(previousFile,1600,[w,h]);
    if(signal?.aborted)throw abortError();
  }
  let decodeMs=performance.now()-decodeStarted,core,coreStarted=performance.now();
  // IA de contexto antes do núcleo (o buffer da imagem é transferido ao worker em seguida).
  let contextInfo=null,contextMs=0;
  if(cfg.contextMode!=="off"&&typeof control?.contextFilter==="function"){
    const t0=performance.now();
    emitProgress(onProgress,9,"IA de contexto · SegFormer ADE20K","context_filter");
    try{
      const excl=await control.contextFilter(current,cfg.contextMode,{signal,onProgress,contextOptions:cfg.contextOptions});
      cfg.context={mask:excl.mask,cls:excl.cls,names:excl.names,w:excl.w,h:excl.h,abstained:excl.abstained};
      contextInfo={status:excl.abstained?"abstained":"ok",mode:cfg.contextMode,share:cfg.contextShare,min_confidence:cfg.contextOptions.minConfidence,input_side:cfg.contextOptions.inputSide,excluded_ratio:excl.excluded_ratio,structure_ratio:excl.structure_ratio,top_classes:excl.top_classes,model:excl.model||null,model_sha256:excl.sha256||null,map_size:[excl.w,excl.h],method:"semantic_segmentation",method_label:"Segmentação semântica por pixel (SegFormer-B0 · ADE20K, 150 classes)",scene_objects:sceneObjects(excl,current.width,current.height),overlay_png_base64:contextOverlay(current,excl)};
    }catch(error){
      if(error?.name==="AbortError"||signal?.aborted)throw abortError();
      contextInfo={status:"unavailable",mode:cfg.contextMode,error:String(error?.message||error)};
    }
    contextMs=performance.now()-t0;coreStarted=performance.now();
  }
  try{
    core=await runCoreWorker(current,previous,cfg,{signal,onProgress});
  }catch(workerError){
    if(workerError?.name==="AbortError"||signal?.aborted)throw abortError();
    const fallbackDecodeStarted=performance.now();
    current=await imageDataFromFile(file,1600);w=current.width;h=current.height;
    previous=previousFile?await imageDataFromFile(previousFile,1600,[w,h]):null;
    decodeMs+=performance.now()-fallbackDecodeStarted;
    if(signal?.aborted)throw abortError();
    core={...computeCdm4Core(current,previous,cfg,onProgress),execution:"main-thread-fallback",worker_error:String(workerError?.message||workerError)};
  }
  const coreMs=performance.now()-coreStarted;
  if(signal?.aborted)throw abortError();
  emitProgress(onProgress,97,"CDM-4 · renderizando camadas","render_layers");
  const renderStarted=performance.now(),records=core.records||[],layers=[];
  for(const cls of ORDER){
    const rec=records.filter(r=>r.class===cls);
    layers.push({id:cls,name:LABELS[cls],color:"#"+COLORS[cls].map(v=>v.toString(16).padStart(2,"0")).join(""),count:rec.length,overlay_png_base64:renderLayer(rec,w,h,COLORS[cls])});
  }
  const temporalCore=core.temporal||{enabled:false,alignment_method:null,stats:{},records:[]};
  const alignedReferenceB64=temporalCore.alignment?.accepted&&temporalCore.aligned_previous?imageDataToPngB64(temporalCore.aligned_previous):null;
  const temporalLayers=[];
  if(temporalCore.enabled){
    for(const changeClass of ["growth","reduction"]){
      for(const sourceClass of ORDER){
        const rec=(temporalCore.records||[]).filter(r=>r.class===changeClass&&r.source_class===sourceClass);
        if(!rec.length)continue;
        temporalLayers.push({
          id:changeClass+":"+sourceClass,change_class:changeClass,source_class:sourceClass,
          name:(changeClass==="growth"?"Crescimento t0→t1":"Redução t0→t1")+" · "+LABELS[sourceClass],
          color:"#"+COLORS[changeClass].map(v=>v.toString(16).padStart(2,"0")).join(""),
          count:rec.length,overlay_png_base64:renderLayer(rec,w,h,COLORS[changeClass])
        });
      }
    }
  }
  const {aligned_previous:_,...temporalSerializable}=temporalCore;
  const temporal={...temporalSerializable,aligned_reference_png_base64:alignedReferenceB64,layers:temporalLayers};
  const detections=records.map(r=>({label:r.class,canonical_label:r.class,score:null,box:[r.bbox[0],r.bbox[1],r.bbox[0]+r.bbox[2],r.bbox[1]+r.bbox[3]],polygon:r.points,area_px:r.area_px2}));
  const composite=document.createElement("canvas");composite.width=w;composite.height=h;const cctx=composite.getContext("2d");
  for(const cls of ORDER){
    const rec=records.filter(r=>r.class===cls),tmp=document.createElement("canvas");tmp.width=w;tmp.height=h;const tctx=tmp.getContext("2d");tctx.lineCap="round";tctx.lineJoin="round";
    for(const r of rec){
      if(!r.points.length)continue;tctx.beginPath();tctx.moveTo(...r.points[0]);for(let i=1;i<r.points.length;i++)tctx.lineTo(...r.points[i]);
      if(r.closed){tctx.closePath();tctx.fillStyle="rgba("+COLORS[cls].join(",")+",.59)";tctx.fill()}
      else{tctx.strokeStyle="rgba("+COLORS[cls].join(",")+",.82)";tctx.lineWidth=Math.max(1,r.width_px);tctx.stroke()}
    }
    cctx.drawImage(tmp,0,0);
  }
  const renderMs=performance.now()-renderStarted,totalMs=performance.now()-started;
  if(signal?.aborted)throw abortError();
  emitProgress(onProgress,100,"CDM-4 · concluído","done");
  const engine={
    engine_id:"cdm_4",name:"CDM-4",task:"classical",status:"ok",latency_ms:totalMs,detections,
    overlay_png_base64:composite.toDataURL("image/png").split(",")[1],
    metrics:{
      implementation:"CDM-4 4.0.0 · imagem 2D (núcleo CDM 2.11 + contexto F1/F2/F4 + biodiversidade + random walker + armadura linear + pigmentos)",engine_version:"4.0.0",runtime:core.execution||"browser-js",worker_error:core.worker_error||null,
      performance_ms:{decode:decodeMs,context:contextMs,core:coreMs,render:renderMs,total:totalMs},
      context_filter:contextInfo?{...contextInfo,...(core.context_filter||{}),discarded:(core.context_discarded||[]).map(r=>({code:r.code,class:r.class,class_label:LABELS[r.class],bbox:r.bbox,area_px2:r.area_px2,length_px:r.length_px??null,width_px:r.width_px??null,scene:r.scene}))}:null,
      overlay_semantics:"transparent_layers",
      geometry_units:"processed_pixels",processed_width:w,processed_height:h,mm_per_px:cfg.mmPerPx||null,
      layers,summary:core.summary,records,temporal,protocol:core.protocol,refinement:core.refinement||null,pigments:core.pigments||null,deterministic:true,trained_weights_in_segmentation:false
    },
    message:"CDM-4 executado integralmente no navegador; nenhum dado foi enviado ao Railway. Núcleo determinístico CDM 2.11 com refino por biodiversidade, random walker e armadura linear; pigmentos só como diagnóstico. Validação ainda baseada em uma foto com ground truth."+(contextInfo?(contextInfo.status==="ok"?" Filtro de contexto IA ("+(contextInfo.mode==="strict"?"estrito":"conservador")+"): "+(core.context_filter?.removed_total||0)+" componentes descartados em regiões irrelevantes.":contextInfo.status==="abstained"?" Filtro de contexto IA: cena não reconhecida, filtro absteve-se.":" Filtro de contexto IA indisponível ("+contextInfo.error+"); resultado só morfológico."):"")
  };
  if(core.stages)CDM4_STAGE_CACHE.set(engine,{...core.stages,width:w,height:h});
  return {image_width:w,image_height:h,results:[engine],consensus:{},spatial_consensus:[],consensus_overlay_png_base64:null,metadata:{analysis_id:"browser-cdm4-"+crypto.randomUUID(),api_version:"browser-1.5",generated_at:new Date().toISOString(),mode:"individual",engine_ids:["cdm_4"],implementation:"cdm-4.0.0-browser-worker"}};
}

// Test hooks: pure functions used by CI parity checks; not part of the UI API.
export const __cdm4Test={crackSkeleton,crackFragments,pruneSpurs,reconstructByOpening,zhangSuen,skeletonLength,crackRecords,grayAndRgb,detectMasks,recordsFromMask,temporalCompare,summary,computeCdm4Core,refineCdm4,registerPrevious,estimateTranslationRegistration,applyTranslationRegistration,temporalQualityAssessment,percentileFloat,blackhat,cleanup,ORDER,LABELS,clipMasksByContext,contextCore,traceContour,contourPolygon};
