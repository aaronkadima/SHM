import assert from "node:assert/strict";
import {parseSpatialAsset,parseLasFile,parseXyzFile,parseIfcFile,spatialExtension} from "../src/spatialAsset.js";
import {runCdm3SpatialBrowser} from "../src/cdm3SpatialBrowser.js";

function textFile(name,text,type="text/plain"){
  return {name,size:Buffer.byteLength(text),type,text:async()=>text};
}
function binaryFile(name,buffer,type="application/octet-stream"){
  return {name,size:buffer.byteLength,type,arrayBuffer:async()=>buffer};
}

const xyz=textFile("bridge.xyz","100 200 10 255 20 10\n101 201 11 20 255 30\n102,202,12,30,40,255\n# comment\n");
assert.equal(spatialExtension(xyz),"xyz");
const xyzParsed=await parseXyzFile(xyz,{maxPoints:100});
assert.equal(xyzParsed.metadata.total_valid_points,3);
assert.equal(xyzParsed.sampled_points,3);
assert.deepEqual(xyzParsed.bounds.min,[100,200,10]);
assert.deepEqual(xyzParsed.bounds.max,[102,202,12]);
assert.equal(xyzParsed.metadata.has_rgb,true);
assert.equal(xyzParsed.colors.length,9);
assert.ok(xyzParsed.colors[0]>.99);

const ifcText=`ISO-10303-21;
HEADER;
FILE_SCHEMA(('IFC4X3_ADD2'));
ENDSEC;
DATA;
#1=IFCBRIDGE('g1',$,'Bridge',$,$,$,$,$,$);
#2=IFCSLAB('g2',$,'Deck',$,$,$,$,$,$);
#3=IFCCARTESIANPOINT((0.,0.,0.));
#4=IFCCARTESIANPOINT((10.,0.,0.));
#5=IFCCARTESIANPOINT((10.,5.,1.));
ENDSEC;
END-ISO-10303-21;`;
const ifc=textFile("bridge.ifc",ifcText,"application/x-step");
assert.equal(spatialExtension(ifc),"ifc");
const ifcParsed=await parseIfcFile(ifc,{maxPoints:100});
assert.equal(ifcParsed.metadata.schema,"IFC4X3_ADD2");
assert.equal(ifcParsed.metadata.structural_entity_counts.IFCBRIDGE,1);
assert.equal(ifcParsed.metadata.structural_entity_counts.IFCSLAB,1);
assert.equal(ifcParsed.sampled_points,3);

const recordLength=34,pointOffset=227,count=3;
const buffer=new ArrayBuffer(pointOffset+recordLength*count);
const view=new DataView(buffer);
for(const [i,ch] of [..."LASF"].entries())view.setUint8(i,ch.charCodeAt(0));
view.setUint8(24,1);view.setUint8(25,2);
view.setUint16(94,227,true);
view.setUint32(96,pointOffset,true);
view.setUint8(104,3);
view.setUint16(105,recordLength,true);
view.setUint32(107,count,true);
view.setFloat64(131,.01,true);view.setFloat64(139,.01,true);view.setFloat64(147,.01,true);
view.setFloat64(155,1000,true);view.setFloat64(163,2000,true);view.setFloat64(171,30,true);
const pts=[[0,0,0,2],[100,200,300,17],[-100,50,25,9]];
pts.forEach((p,index)=>{
  const o=pointOffset+index*recordLength;
  view.setInt32(o,p[0],true);view.setInt32(o+4,p[1],true);view.setInt32(o+8,p[2],true);
  view.setUint16(o+12,1000+index*500,true);view.setUint8(o+15,p[3]);
  view.setUint16(o+28,index===0?65535:12000,true);
  view.setUint16(o+30,index===1?65535:16000,true);
  view.setUint16(o+32,index===2?65535:20000,true);
});
const las=binaryFile("bridge.las",buffer);
assert.equal(spatialExtension(las),"las");
const lasParsed=await parseLasFile(las,{maxPoints:100});
assert.equal(lasParsed.metadata.declared_point_count,3);
assert.equal(lasParsed.metadata.point_format,3);
assert.equal(lasParsed.sampled_points,3);
assert.equal(lasParsed.metadata.sampled_classification_counts["17"],1);
assert.equal(lasParsed.metadata.has_rgb,true);
assert.equal(lasParsed.metadata.has_intensity,true);
assert.equal(lasParsed.metadata.has_classification,true);
assert.equal(lasParsed.colors.length,9);
assert.equal(lasParsed.intensities.length,3);
assert.equal(lasParsed.classifications.length,3);

const generic=await parseSpatialAsset(xyz);
assert.equal(generic.metadata.format,"xyz");
const progress=[];
const result=await runCdm3SpatialBrowser(xyz,{onProgress:p=>progress.push(p)});
assert.equal(result.results[0].engine_id,"cdm_3");
assert.equal(result.results[0].status,"ok");
assert.equal(result.results[0].metrics.runtime_mode,"spatial_browser_ingestion");
assert.equal(result.results[0].metrics.source_format,"xyz");
assert.equal(result.results[0].metrics.spatial_asset.has_rgb,true);
assert.equal(result.results[0].metrics.capabilities.rgb_point_rendering,true);
assert.equal(result.metadata.engine_ids[0],"cdm_3");
assert.equal(progress.at(-1)?.completed,100);

console.log("CDM3_SPATIAL_PASS",{
  xyz:xyzParsed.sampled_points,
  xyz_rgb:xyzParsed.metadata.has_rgb,
  ifc_schema:ifcParsed.metadata.schema,
  ifc_points:ifcParsed.sampled_points,
  las_points:lasParsed.sampled_points,
  las_rgb:lasParsed.metadata.has_rgb,
  las_version:lasParsed.metadata.las_version
});
