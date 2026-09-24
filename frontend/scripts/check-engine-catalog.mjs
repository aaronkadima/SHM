import fs from "node:fs";
import {browserEngineSupported} from "../src/browserEngines.js";

const catalog=JSON.parse(fs.readFileSync(new URL("../src/engines.json",import.meta.url),"utf8"));
const engines=Array.isArray(catalog.engines)?catalog.engines:[];
const cdm=engines.find(e=>e.id==="cdm_1");
const failures=[];
const check=(ok,msg)=>{if(!ok)failures.push(msg)};

check(!!cdm,"cdm_1 must exist in engines.json");
if(cdm){
  check(cdm.name==="CDM-1","cdm_1 display name must be CDM-1");
  check(cdm.browser_ready===true,"CDM-1 must be browser_ready");
  check(cdm.recommended===true,"CDM-1 must remain visible in recommended lists");
  check(cdm.catalog_visibility==="always","CDM-1 must declare catalog_visibility=always");
  check(cdm.browser_runtime==="browser-js-cdm-v285","CDM-1 browser runtime mismatch");
}
check(browserEngineSupported("cdm_1")===true,"browserEngines must support cdm_1");
check(new Set(engines.map(e=>e.id)).size===engines.length,"engine ids must be unique");

if(failures.length){
  console.error("Engine catalog failures:");
  failures.forEach(x=>console.error(" - "+x));
  process.exit(1);
}
console.log("Engine catalog passed:",{count:engines.length,cdm:{id:cdm.id,name:cdm.name,recommended:cdm.recommended,browser_ready:cdm.browser_ready}});
