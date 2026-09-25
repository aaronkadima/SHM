import assert from "node:assert/strict";
import {registeredPointColors} from "../src/ModelViewport.jsx";

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

console.log("CDM3_REGISTERED_RGB_PROJECTION_PASS",{
  center_color:Array.from(projected.colors).map(v=>Number(v.toFixed(4))),
  colored:projected.colored,
  out_of_frame_colored:fallback.colored
});
