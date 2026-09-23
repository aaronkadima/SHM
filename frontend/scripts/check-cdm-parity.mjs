import fs from "node:fs";
import process from "node:process";
import {__cdmTest} from "../src/cdmBrowser.js";

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

const t1Masks=__cdmTest.detectMasks(imageData(fixture.t1_rgb),cfg);
const t0Masks=__cdmTest.detectMasks(imageData(fixture.t0_rgb),cfg);

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

const temporal=__cdmTest.temporalCompare(t1Masks,t0Masks,w,h,cfg);
for(const [cls,exp] of Object.entries(expected.temporal_stats)){
  const got=temporal.stats[cls];
  console.log(`temporal ${cls}: IoU=${got.iou.toFixed(6)}/${Number(exp.iou).toFixed(6)} growth=${got.growth_area_px2}/${exp.growth_area_px2} reduction=${got.reduction_area_px2}/${exp.reduction_area_px2}`);
  check(near(got.iou,exp.iou,.005,.01),`${cls} temporal IoU mismatch`);
  check(near(got.growth_area_px2,exp.growth_area_px2,2,.01),`${cls} growth mismatch`);
  check(near(got.reduction_area_px2,exp.reduction_area_px2,2,.01),`${cls} reduction mismatch`);
}
for(const cls of ["growth","reduction"]){
  const count=temporal.records.filter(r=>r.class===cls).length;
  check(count===expected.temporal_counts[cls],`${cls} temporal record count ${count} != ${expected.temporal_counts[cls]}`);
}

if(failures.length){
  console.error("\nCDM parity failures:");
  for(const f of failures)console.error(" - "+f);
  process.exit(1);
}
console.log("\nCDM Python ↔ browser parity passed.");
