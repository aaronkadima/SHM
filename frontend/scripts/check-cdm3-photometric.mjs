import assert from "node:assert/strict";
import{imagePhotometricStats,canonicalPhotometricTarget,normalizePhotometricRgb,photometricViewWeight}from"../src/cdm3PhotometricFusion.js";

const dark={width:4,height:1,data:new Uint8ClampedArray([
  20,20,20,255, 30,28,25,255, 40,38,35,255, 50,48,45,255
])};
const bright={width:4,height:1,data:new Uint8ClampedArray([
  180,175,170,255, 195,190,185,255, 210,205,200,255, 225,220,215,255
])};
const ds=imagePhotometricStats(dark),bs=imagePhotometricStats(bright);
assert.ok(ds.luminanceMean<bs.luminanceMean);
assert.ok(ds.shadowRatio>0);
const target=canonicalPhotometricTarget([ds,bs]);
assert.ok(target.luminanceMean>ds.luminanceMean&&target.luminanceMean<bs.luminanceMean);
const normalized=normalizePhotometricRgb([30/255,28/255,25/255],ds,target);
const normalizedLum=.2126*normalized[0]+.7152*normalized[1]+.0722*normalized[2];
assert.ok(normalizedLum>ds.luminanceMean,"dark view should be lifted toward multiview target");
const good={registration:{reprojection_rmse_px:1.2,inlier_count:18,correspondence_count:20}};
const poor={registration:{reprojection_rmse_px:9,inlier_count:7,correspondence_count:20}};
assert.ok(photometricViewWeight(ds,good)>photometricViewWeight(ds,poor));
for(const v of normalized)assert.ok(v>=0&&v<=1);
console.log("CDM3_PHOTOMETRIC_PASS",{dark:ds.luminanceMean,bright:bs.luminanceMean,target:target.luminanceMean,good:photometricViewWeight(ds,good),poor:photometricViewWeight(ds,poor)});
