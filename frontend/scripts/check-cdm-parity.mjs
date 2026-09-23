import fs from "node:fs";
import process from "node:process";
import {__cdmTest} from "../src/cdmBrowser.js";
import {buildCdmSvg,buildCdmCsv,buildCdmDxf,buildCdmBimJson,buildCdmIfc,buildCdmHtml} from "../src/cdmExports.js";

const fixturePath=process.argv[2];
if(!fixturePath)throw new Error("usage: node scripts/check-cdm-parity.mjs FIXTURE.json");
const fixture=JSON.parse(fs.readFileSync(fixturePath,"utf8"));
const {width:w,height:h,config:cfg,expected}=fixture;

function imageData(rgb){
  const data=new Uint8ClampedArray(w*h*4);
  for(let i=0,j=0,k=0;i<w*h;i++,j+=3,k+=4){
    data[k]=rgb[j];data[k+1]=rgb[j+1];data[k+2]=rgb[j+2];data[k+3]=255;
  }
  return {width:w,height:h,data};
}
function expectedMask(indices){
  const out=new Uint8Array(w*h);
  for(const i of indices)out[i]=1;
  return out;
}
function maskMetrics(actual,expectedIndices){
  const target=expectedMask(expectedIndices);let a=0,b=0,inter=0,union=0;
  for(let i=0;i<actual.length;i++){
    if(actual[i])a++;if(target[i])b++;
    if(actual[i]&&target[i])inter++;
    if(actual[i]||target[i])union++;
  }
  return {actual:a,expected:b,iou:union?inter/union:1,delta:a-b};
}
function near(a,b,abs=1e-6,rel=1e-3){
  return Math.abs(a-b)<=Math.max(abs,Math.abs(b)*rel);
}
const failures=[];
function check(cond,msg){if(!cond)failures.push(msg)}

const t1Data=imageData(fixture.t1_rgb),t0Data=imageData(fixture.t0_rgb);
const t1Masks=__cdmTest.detectMasks(t1Data,cfg);
const t0Masks=__cdmTest.detectMasks(t0Data,cfg);

for(const cls of __cdmTest.ORDER){
  const m1=maskMetrics(t1Masks[cls],expected.t1_masks[cls]);
  const m0=maskMetrics(t0Masks[cls],expected.t0_masks[cls]);
  console.log(`mask ${cls}: t1 IoU=${m1.iou.toFixed(6)} px=${m1.actual}/${m1.expected}; t0 IoU=${m0.iou.toFixed(6)} px=${m0.actual}/${m0.expected}`);
  check(m1.iou>=0.995,`${cls} t1 mask IoU ${m1.iou} < 0.995`);
  check(m0.iou>=0.995,`${cls} t0 mask IoU ${m0.iou} < 0.995`);
}

const records=[];
for(const cls of __cdmTest.ORDER)records.push(...__cdmTest.recordsFromMask(t1Masks[cls],w,h,cls,"t1_current",cfg));
for(const cls of Object.keys(expected.records)){
  const rows=records.filter(r=>r.class===cls),exp=expected.records[cls];
  const area=rows.reduce((s,r)=>s+r.area_px2,0),perim=rows.reduce((s,r)=>s+r.perimeter_px,0),length=rows.reduce((s,r)=>s+r.length_px,0),width=rows.reduce((s,r)=>s+r.width_px,0);
  console.log(`records ${cls}: n=${rows.length}/${exp.count} area=${area.toFixed(3)}/${exp.area_sum.toFixed(3)} length=${length.toFixed(3)}/${exp.length_sum.toFixed(3)}`);
  check(rows.length===exp.count,`${cls} record count ${rows.length} != ${exp.count}`);
  check(near(area,exp.area_sum,1,.01),`${cls} area sum ${area} != ${exp.area_sum}`);
  check(near(perim,exp.perimeter_sum,2,.02),`${cls} perimeter sum ${perim} != ${exp.perimeter_sum}`);
  check(near(length,exp.length_sum,1,.02),`${cls} length sum ${length} != ${exp.length_sum}`);
  check(near(width,exp.width_sum,1,.03),`${cls} width sum ${width} != ${exp.width_sum}`);
}

const summary=__cdmTest.summary(records,cfg,w*h),expSummary=expected.summary;
console.log("summary",JSON.stringify({
  total_objects:[summary.total_objects,expSummary.total_objects],
  spalling_area_px2:[summary.spalling_area_px2,expSummary.spalling_area_px2],
  rebar_area_px2:[summary.rebar_area_px2,expSummary.rebar_area_px2],
  crack_count:[summary.crack_count,expSummary.crack_count],
  crack_length_total_px:[summary.crack_length_total_px,expSummary.crack_length_total_px],
}));
check(summary.total_objects===expSummary.total_objects,"summary total_objects mismatch");
check(summary.crack_count===expSummary.crack_count,"summary crack_count mismatch");
check(near(summary.spalling_area_px2,expSummary.spalling_area_px2,1,.01),"summary spalling area mismatch");
check(near(summary.rebar_area_px2,expSummary.rebar_area_px2,1,.01),"summary rebar area mismatch");
check(near(summary.crack_length_total_px,expSummary.crack_length_total_px,1,.02),"summary crack length mismatch");
check(near(summary.crack_width_mean_px,expSummary.crack_width_mean_px,.25,.03),"summary crack width mismatch");

const rating=summary.condition_rating,expRating=expected.rating;
console.log("rating",JSON.stringify({NT:[rating.NT_img,expRating.NT_img],EC:[rating.EC_DNIT_img,expRating.EC_DNIT_img],GDE:[rating.GDE_img,expRating.GDE_img]}));
check(rating.NT_img===expRating.NT_img,`NT mismatch ${rating.NT_img} != ${expRating.NT_img}`);
check(rating.EC_DNIT_img===expRating.EC_DNIT_img,`EC mismatch ${rating.EC_DNIT_img} != ${expRating.EC_DNIT_img}`);
check(near(rating.GDE_img,expRating.GDE_img,.5,.02),`GDE mismatch ${rating.GDE_img} != ${expRating.GDE_img}`);
check(near(rating.affected_area_ratio,expRating.affected_area_ratio,.001,.02),"affected area ratio mismatch");

const mainRegistration=__cdmTest.registerPrevious(t1Data,t0Data,cfg.alignmentMethod||"translation_auto");
const t0AlignedMasks=__cdmTest.detectMasks(mainRegistration.image,cfg);
const temporal=__cdmTest.temporalCompare(t1Masks,t0AlignedMasks,w,h,cfg);
const expAlignment=expected.temporal_alignment||{};
const mainQuality=__cdmTest.temporalQualityAssessment(t1Data,mainRegistration.image,mainRegistration.metrics);
const expQuality=expected.temporal_quality||{};
console.log("alignment main",JSON.stringify({got:mainRegistration.metrics,expected:expAlignment}));
console.log("quality main",JSON.stringify({got:mainQuality,expected:expQuality}));
check(mainRegistration.metrics.method_applied===expAlignment.method_applied,`main alignment method ${mainRegistration.metrics.method_applied} != ${expAlignment.method_applied}`);
check(mainRegistration.metrics.dx_px===expAlignment.dx_px,`main alignment dx ${mainRegistration.metrics.dx_px} != ${expAlignment.dx_px}`);
check(mainRegistration.metrics.dy_px===expAlignment.dy_px,`main alignment dy ${mainRegistration.metrics.dy_px} != ${expAlignment.dy_px}`);
check(mainQuality.status===expQuality.status,`main quality status ${mainQuality.status} != ${expQuality.status}`);
check(mainQuality.validated_for_change_quantification===expQuality.validated_for_change_quantification,"main temporal validation mismatch");
check(near(mainQuality.metrics.illumination_delta,expQuality.metrics?.illumination_delta??0,.002,.03),"main illumination quality mismatch");
check(near(mainQuality.metrics.sharpness_ratio,expQuality.metrics?.sharpness_ratio??0,.02,.04),"main sharpness quality mismatch");
check(near(mainQuality.metrics.edge_similarity,expQuality.metrics?.edge_similarity??0,.02,.05),"main edge similarity mismatch");
for(const [cls,exp] of Object.entries(expected.temporal_stats)){
  const got=temporal.stats[cls];
  console.log(`temporal ${cls}: IoU=${got.iou.toFixed(6)}/${Number(exp.iou).toFixed(6)} growth=${got.growth_area_px2}/${exp.growth_area_px2} reduction=${got.reduction_area_px2}/${exp.reduction_area_px2}`);
  check(near(got.iou,exp.iou,.005,.01),`${cls} temporal IoU mismatch`);
  for(const key of ["previous_area_px2","current_area_px2","growth_area_px2","reduction_area_px2","net_area_change_px2"]){
    check(near(got[key],exp[key],2,.01),`${cls} ${key} mismatch`);
  }
  for(const key of ["growth_rate_vs_t0_pct","reduction_rate_vs_t0_pct","net_area_change_vs_t0_pct"]){
    if(exp[key]==null)check(got[key]==null,`${cls} ${key} should be null`);
    else check(near(got[key],exp[key],.05,.01),`${cls} ${key} mismatch`);
  }
  for(const key of ["previous_area_mm2","current_area_mm2","growth_area_mm2","reduction_area_mm2","net_area_change_mm2"]){
    if(exp[key]==null)check(got[key]==null,`${cls} ${key} should be null`);
    else check(near(got[key],exp[key],.05,.01),`${cls} ${key} mismatch`);
  }
}
for(const cls of ["growth","reduction"]){
  const count=temporal.records.filter(r=>r.class===cls).length;
  check(count===expected.temporal_counts[cls],`${cls} temporal record count ${count} != ${expected.temporal_counts[cls]}`);
}
for(const [sourceClass,counts] of Object.entries(expected.temporal_by_source||{})){
  for(const changeClass of ["growth","reduction"]){
    const got=temporal.records.filter(r=>r.class===changeClass&&r.source_class===sourceClass).length;
    check(got===counts[changeClass],`${changeClass} ${sourceClass} count ${got} != ${counts[changeClass]}`);
  }
}
check(temporal.records.every(r=>typeof r.source_class==="string"&&r.source_class.length>0),"temporal records must expose source_class");

const staged=[];
const core=__cdmTest.computeCdmCore(imageData(fixture.t1_rgb),imageData(fixture.t0_rgb),cfg,p=>staged.push(p));
check(core.records.length===records.length,`core record count ${core.records.length} != ${records.length}`);
check(core.summary.total_objects===expected.summary.total_objects,"core summary total mismatch");
check(core.temporal.enabled===true,"core temporal comparison should be enabled");
check(staged.length>=8,`expected staged progress events, got ${staged.length}`);
for(let i=1;i<staged.length;i++)check(staged[i].completed>=staged[i-1].completed,`progress regressed at event ${i}`);
check(staged.at(-1)?.completed===96,`core progress should finish at 96, got ${staged.at(-1)?.completed}`);
check(staged.some(p=>p.stage==="segment_t1"),"missing segment_t1 progress stage");
check(staged.some(p=>p.stage==="vectorize_t1"),"missing vectorize_t1 progress stage");
check(staged.some(p=>p.stage==="temporal_alignment"),"missing temporal_alignment progress stage");
check(staged.some(p=>p.stage==="segment_t0"),"missing segment_t0 progress stage");
check(staged.some(p=>p.stage==="temporal_compare"),"missing temporal_compare progress stage");
check(staged.some(p=>p.stage==="condition_rating"),"missing condition_rating progress stage");
console.log("progress",staged.map(p=>p.completed+":"+p.stage).join(" -> "));

const currentLayers=__cdmTest.ORDER.map(id=>({id,name:__cdmTest.LABELS[id],color:"#666666",count:records.filter(r=>r.class===id).length}));
const temporalLayers=[];
for(const changeClass of ["growth","reduction"]){
  for(const sourceClass of __cdmTest.ORDER){
    const count=temporal.records.filter(r=>r.class===changeClass&&r.source_class===sourceClass).length;
    if(count)temporalLayers.push({id:changeClass+":"+sourceClass,change_class:changeClass,source_class:sourceClass,name:changeClass+" "+sourceClass,color:"#777777",count});
  }
}
const exportResult={
  width:w,height:h,
  metrics:{
    records,
    layers:currentLayers,
    temporal:{enabled:true,alignment_method:mainRegistration.metrics.method_applied,alignment:mainRegistration.metrics,quality:mainQuality,stats:temporal.stats,records:temporal.records,layers:temporalLayers},
    mm_per_px:cfg.mmPerPx,
    runtime:"test-runtime",
    implementation:"CDM parity test",
    performance_ms:{decode:1,core:2,render:3,total:6},
    summary
  }
};
const csv=buildCdmCsv(exportResult);
const svg=buildCdmSvg(exportResult);
const dxf=buildCdmDxf(exportResult);
const bim=buildCdmBimJson(exportResult,{oae_id:"OAE-TEST",element_id:"E-1",source_id:"CAM-1"});
const ifc=buildCdmIfc(exportResult,{oae_id:"OAE-TEST",element_id:"E-1"});
const html=buildCdmHtml(exportResult,"fixture.png",{oae_id:"OAE-TEST",element_id:"E-1"});
check(csv.includes('"source_class"'),"CSV must expose source_class");
check(csv.includes('"temporal_alignment"'),"CSV must expose temporal alignment provenance");
check(csv.includes('"temporal_quality"'),"CSV must expose temporal quality gate");
check(svg.includes('data-source-class='),"SVG must expose data-source-class");
check(svg.includes('cdm-temporal-alignment'),"SVG must embed temporal alignment metadata");
check(svg.includes('layer-growth:cracks')||!expected.temporal_by_source?.cracks?.growth,"SVG must preserve growth-by-cracks layer");
check(dxf.includes("SHM_TEMPORAL_GROWTH_CRACKS")||!expected.temporal_by_source?.cracks?.growth,"DXF must split temporal layer by source pathology");
check(dxf.includes("CDM_TEMPORAL_ALIGNMENT"),"DXF must embed temporal alignment provenance");
check(dxf.includes("quality="+mainQuality.status),"DXF must embed temporal quality status");
check(bim.features.some(f=>f.damage_class==="growth"&&f.source_class),"BIM JSON temporal feature must expose source_class");
check(bim.temporal?.alignment!=null,"BIM JSON must expose temporal alignment provenance");
check(bim.temporal?.quality?.status===mainQuality.status,"BIM JSON must expose temporal quality gate");
check(ifc.includes("SourcePathology"),"IFC property set must expose SourcePathology");
check(ifc.includes("TemporalAlignmentDxPx"),"IFC property set must expose temporal alignment displacement");
check(ifc.includes("TemporalQualityStatus"),"IFC property set must expose temporal quality status");
check(ifc.includes("TemporalChangeValidated"),"IFC property set must expose temporal validation flag");
check(html.includes("Qualidade temporal"),"HTML report must expose temporal quality gate");
console.log("exports traceability: SVG/CSV/DXF/BIM/IFC checked");

const registrationCase=fixture.registration_case;
const shiftedRegistration=__cdmTest.registerPrevious(
  imageData(registrationCase.current_rgb),
  imageData(registrationCase.previous_rgb),
  "translation_auto"
);
const expShift=registrationCase.expected.alignment;
console.log("alignment shifted",JSON.stringify({got:shiftedRegistration.metrics,expected:expShift}));
check(shiftedRegistration.metrics.accepted===true,"known camera shift must be accepted");
check(shiftedRegistration.metrics.dx_px===expShift.dx_px,`shifted alignment dx ${shiftedRegistration.metrics.dx_px} != ${expShift.dx_px}`);
check(shiftedRegistration.metrics.dy_px===expShift.dy_px,`shifted alignment dy ${shiftedRegistration.metrics.dy_px} != ${expShift.dy_px}`);
check(shiftedRegistration.metrics.dx_px===-registrationCase.known_camera_shift.x,"registration must undo known x camera shift");
check(shiftedRegistration.metrics.dy_px===-registrationCase.known_camera_shift.y,"registration must undo known y camera shift");
check(near(shiftedRegistration.metrics.improvement,expShift.improvement,.02,.04),"registration improvement mismatch");
function meanRgbError(a,b){
  let sum=0,count=0;
  for(let i=0;i<a.data.length;i+=4){sum+=Math.abs(a.data[i]-b.data[i])+Math.abs(a.data[i+1]-b.data[i+1])+Math.abs(a.data[i+2]-b.data[i+2]);count+=3}
  return sum/count;
}
const alignedError=meanRgbError(imageData(registrationCase.current_rgb),shiftedRegistration.image);
check(alignedError<registrationCase.expected.mean_abs_error_before*.35,`registration should strongly reduce image error; got ${alignedError}`);
console.log(`registration known shift corrected: dx=${shiftedRegistration.metrics.dx_px}, dy=${shiftedRegistration.metrics.dy_px}, error=${alignedError.toFixed(4)}`);

const farCase=fixture.registration_out_of_range_case;
const farRegistration=__cdmTest.registerPrevious(
  imageData(farCase.current_rgb),
  imageData(farCase.previous_rgb),
  "translation_auto"
);
console.log("alignment out-of-range",JSON.stringify({got:farRegistration.metrics,expected:farCase.expected.alignment}));
check(farRegistration.metrics.accepted===false,"out-of-range camera shift must be rejected");
check(farRegistration.metrics.reason==="search_boundary_hit","out-of-range camera shift must report search_boundary_hit");
check(farRegistration.metrics.dx_px===0&&farRegistration.metrics.dy_px===0,"rejected registration must apply zero translation");
check(farRegistration.metrics.boundary_hit===true,"out-of-range registration must mark boundary_hit");

const resizeOnly=__cdmTest.registerPrevious(
  imageData(registrationCase.current_rgb),
  imageData(registrationCase.previous_rgb),
  "resize"
);
check(resizeOnly.metrics.accepted===false,"resize mode must not apply translation");
check(resizeOnly.metrics.dx_px===0&&resizeOnly.metrics.dy_px===0,"resize mode must keep zero translation");
check(resizeOnly.metrics.reason==="translation_registration_disabled","resize mode must report disabled translation registration");
const resizeQuality=__cdmTest.temporalQualityAssessment(imageData(registrationCase.current_rgb),resizeOnly.image,resizeOnly.metrics);
const expResizeQuality=registrationCase.expected.resize_quality;
console.log("quality resize-only shifted",JSON.stringify({got:resizeQuality,expected:expResizeQuality}));
check(resizeQuality.status===expResizeQuality.status,"resize-only shifted quality status mismatch");
check(resizeQuality.validated_for_change_quantification===false,"resize-only shifted pair must not be validated");
check(resizeQuality.issues.includes("geometric_mismatch"),"resize-only shifted pair must include geometric_mismatch");
check(near(resizeQuality.metrics.edge_similarity,expResizeQuality.metrics.edge_similarity,.02,.05),"resize-only edge similarity mismatch");

function checkQualityCase(name,testCase,expectedIssue){
  const current=imageData(testCase.current_rgb),previous=imageData(testCase.previous_rgb);
  const registration=__cdmTest.registerPrevious(current,previous,"translation_auto");
  const quality=__cdmTest.temporalQualityAssessment(current,registration.image,registration.metrics);
  const exp=testCase.expected.quality;
  console.log("quality "+name,JSON.stringify({got:quality,expected:exp}));
  check(quality.status===exp.status,`${name} quality status ${quality.status} != ${exp.status}`);
  check(quality.validated_for_change_quantification===exp.validated_for_change_quantification,`${name} validation mismatch`);
  check(quality.issues.includes(expectedIssue),`${name} should include ${expectedIssue}`);
  check(near(quality.metrics.illumination_delta,exp.metrics.illumination_delta,.005,.04),`${name} illumination metric mismatch`);
  check(near(quality.metrics.sharpness_ratio,exp.metrics.sharpness_ratio,.025,.05),`${name} sharpness metric mismatch`);
}
checkQualityCase("illumination",fixture.quality_illumination_case,"illumination_mismatch");
checkQualityCase("blur",fixture.quality_blur_case,"sharpness_mismatch");

const farQuality=__cdmTest.temporalQualityAssessment(
  imageData(farCase.current_rgb),
  farRegistration.image,
  farRegistration.metrics
);
check(farQuality.status==="fail","out-of-range registration must fail temporal quality");
check(farQuality.issues.includes("registration_unreliable"),"out-of-range quality must include registration_unreliable");

if(failures.length){
  console.error("\nCDM parity failures:");
  for(const f of failures)console.error(" - "+f);
  process.exit(1);
}
console.log("\nCDM Python ↔ browser parity passed.");
