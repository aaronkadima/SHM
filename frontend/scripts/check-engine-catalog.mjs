import fs from "node:fs";
import {browserEngineSupported} from "../src/browserEngines.js";
import {sortEngines,engineMatchesFilter,engineMatchesQuery} from "../src/engineCatalog.js";

const catalog=JSON.parse(fs.readFileSync(new URL("../src/engines.json",import.meta.url),"utf8"));
const repositoryCatalog=JSON.parse(fs.readFileSync(new URL("../../engines/catalog.json",import.meta.url),"utf8"));
const engines=Array.isArray(catalog.engines)?catalog.engines:[];
const cdm=engines.find(e=>e.id==="cdm_1");
const segformer=engines.find(e=>e.id==="segformer_public_crack");
const yoloBrowser=engines.find(e=>e.id==="yolov8n_public_crack_seg");
const unetBrowser=engines.find(e=>e.id==="unet_public_crack");
const failures=[];
const check=(ok,msg)=>{if(!ok)failures.push(msg)};

check(repositoryCatalog.version===catalog.version,"repository and frontend catalog versions must match");
check(JSON.stringify(repositoryCatalog)===JSON.stringify(catalog),"engines/catalog.json and frontend/src/engines.json must be identical");

check(!!cdm,"cdm_1 must exist in engines.json");
if(cdm){
  check(cdm.name==="CDM-1","cdm_1 display name must be CDM-1");
  check(cdm.browser_ready===true,"CDM-1 must be browser_ready");
  check(cdm.recommended===true,"CDM-1 must remain visible in recommended lists");
  check(cdm.catalog_visibility==="always","CDM-1 must declare catalog_visibility=always");
  check(cdm.catalog_owned===true,"CDM-1 must be marked as an owned engine");
  check(cdm.browser_runtime==="browser-js-cdm-v285","CDM-1 browser runtime mismatch");
}
check(browserEngineSupported("cdm_1")===true,"browserEngines must support cdm_1");
check(!!segformer,"segformer_public_crack must exist in engines.json");
if(segformer){
  check(segformer.browser_ready===true,"SegFormer public crack must be browser_ready");
  check(segformer.browser_runtime==="onnxruntime-web-wasm-1.30.0","SegFormer browser runtime mismatch");
  check(segformer.browser_stage==="browser-ready","SegFormer browser stage must be browser-ready");
  check(segformer.browser_release_asset==="segformer_public_crack.onnx","SegFormer ONNX asset name mismatch");
  check(segformer.browser_manifest_asset==="segformer_public_crack.json","SegFormer manifest asset name mismatch");
  check(engineMatchesFilter(segformer,"browser"),"Browser filter must include SegFormer");
}
check(browserEngineSupported("segformer_public_crack")===true,"browserEngines must support SegFormer");
check(!!yoloBrowser,"yolov8n_public_crack_seg must exist in engines.json");
if(yoloBrowser){
  check(yoloBrowser.browser_ready===true,"YOLOv8n crack segmentation must be browser_ready after parity validation");
  check(yoloBrowser.browser_candidate===false,"YOLOv8n must no longer be marked as browser candidate");
  check(yoloBrowser.browser_stage==="browser-ready","YOLOv8n browser stage mismatch");
  check(yoloBrowser.browser_runtime==="onnxruntime-web-wasm-1.30.0","YOLOv8n browser runtime mismatch");
  check(engineMatchesFilter(yoloBrowser,"browser"),"Browser filter must include YOLOv8n");
}
check(browserEngineSupported("yolov8n_public_crack_seg")===true,"browserEngines must expose YOLOv8n candidate runtime for smoke/parity tests");

check(!!unetBrowser,"unet_public_crack must exist in engines.json");
if(unetBrowser){
  check(unetBrowser.browser_ready===false,"U-Net must remain browser_ready=false while quality gate is blocked");
  check(unetBrowser.browser_candidate===true,"U-Net must remain a browser candidate");
  check(unetBrowser.browser_stage==="browser-runtime-validated-quality-gate-blocked","U-Net browser stage mismatch");
  check(unetBrowser.browser_runtime_candidate==="onnxruntime-web-wasm-1.30.0","U-Net candidate runtime mismatch");
  check(unetBrowser.browser_release_asset==="unet_public_crack.int8.onnx","U-Net optimized asset mismatch");
  check(unetBrowser.browser_manifest_asset==="unet_public_crack.int8.json","U-Net optimized manifest mismatch");
  check(unetBrowser.browser_precision==="int8","U-Net optimized precision mismatch");
  check(unetBrowser.browser_quality_gate==="external-real-image-saturation","U-Net quality-gate reason mismatch");
  check(unetBrowser.recommended===false,"Quality-blocked U-Net must not be recommended");
  check(!engineMatchesFilter(unetBrowser,"browser"),"Browser filter must exclude quality-blocked U-Net");
}
check(browserEngineSupported("unet_public_crack")===true,"browserEngines must expose U-Net candidate runtime for smoke/parity tests");


check(new Set(engines.map(e=>e.id)).size===engines.length,"engine ids must be unique");
const sorted=sortEngines(engines);
check(sorted[0]?.id==="cdm_1","CDM-1 must be first in sorted engine catalog");
const owned=sorted.filter(e=>engineMatchesFilter(e,"owned"));
check(owned.some(e=>e.id==="cdm_1"),"Owned filter must include CDM-1");
check(engineMatchesFilter(cdm,"recommended"),"Recommended filter must include CDM-1");
check(engineMatchesFilter(cdm,"browser"),"Browser filter must include CDM-1");
check(engineMatchesQuery(cdm,"concrete damage morphology"),"Catalog search must find CDM-1 by family");
check(engineMatchesQuery(cdm,"cdm-1"),"Catalog search must find CDM-1 by name");

if(failures.length){
  console.error("Engine catalog failures:");
  failures.forEach(x=>console.error(" - "+x));
  process.exit(1);
}
console.log("Engine catalog passed:",{count:engines.length,version:catalog.version,cdm:{id:cdm.id,browser_ready:cdm.browser_ready},segformer:{id:segformer.id,browser_ready:segformer.browser_ready,browser_runtime:segformer.browser_runtime},yoloBrowser:{id:yoloBrowser.id,browser_ready:yoloBrowser.browser_ready,browser_stage:yoloBrowser.browser_stage},unetBrowser:{id:unetBrowser.id,browser_ready:unetBrowser.browser_ready,browser_stage:unetBrowser.browser_stage}});
