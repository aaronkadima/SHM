import assert from "node:assert/strict";
import {registeredPointColors,projectPathologyToPoints} from "../src/cdm3RegisteredProjection.js";

const width=101,height=101;
const data=new Uint8ClampedArray(width*height*4);
const setPixel=(u,v,r,g,b)=>{
  const p=(v*width+u)*4;
  data[p]=r;data[p+1]=g;data[p+2]=b;data[p+3]=255;
};
setPixel(50,50,255,64,32);

const parsed={
  positions:new Float32Array([0,0,0]),
  bounds:{center:[0,0,5]}
};
const registration={
  registration:{
    camera_matrix:[[100,0,50],[0,100,50],[0,0,1]],
    rotation_matrix:[[1,0,0],[0,1,0],[0,0,1]],
    translation_vector:[0,0,0],
    distortion:[0,0,0,0,0]
  }
};
const projected=registeredPointColors(parsed,registration,{width,height,data});
assert.equal(projected.total,1);
assert.equal(projected.colored,1);
assert.ok(projected.colors[0]>.99);
assert.ok(projected.colors[1]>.24&&projected.colors[1]<.27);
assert.ok(projected.colors[2]>.12&&projected.colors[2]<.14);

const outOfFrame={
  positions:new Float32Array([20,0,0]),
  bounds:{center:[0,0,5]}
};
const fallback=registeredPointColors(outOfFrame,registration,{width,height,data});
assert.equal(fallback.colored,0);
assert.equal(fallback.total,1);
assert.ok(Number.isFinite(fallback.colors[0]));

const regionAnalysis={
  image_width:101,image_height:101,
  results:[{metrics:{records:[
    {class:"corrosion_rust",closed:true,points:[[45,45],[55,45],[55,55],[45,55]],width_px:4},
    {class:"cracks",closed:false,points:[[48,50],[52,50]],width_px:2}
  ]}}]
};
const region=projectPathologyToPoints(parsed,registration,regionAnalysis,width,height);
assert.equal(region.matched_points,1);
assert.equal(region.counts.corrosion_rust,1);
assert.equal(region.counts.cracks,0);
assert.equal(region.in_frame_points,1);

const crackAnalysis={
  image_width:202,image_height:202,
  results:[{metrics:{records:[
    {class:"cracks",closed:false,points:[[96,100],[104,100]],width_px:4}
  ]}}]
};
const crack=projectPathologyToPoints(parsed,registration,crackAnalysis,width,height);
assert.equal(crack.matched_points,1);
assert.equal(crack.counts.cracks,1);
assert.deepEqual(crack.source_analysis_size,[202,202]);
assert.deepEqual(crack.source_image_size,[101,101]);

console.log("CDM3_REGISTERED_RGB_PROJECTION_PASS",{
  center_color:Array.from(projected.colors).map(v=>Number(v.toFixed(4))),
  colored:projected.colored,
  out_of_frame_colored:fallback.colored, pathology_region:region.matched_points, pathology_crack:crack.matched_points
});
