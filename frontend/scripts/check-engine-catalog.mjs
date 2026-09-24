import fs from "node:fs";
import {browserEngineSupported} from "../src/browserEngines.js";
import {sortEngines,engineMatchesFilter,engineMatchesQuery} from "../src/engineCatalog.js";

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
  check(cdm.catalog_owned===true,"CDM-1 must be marked as an owned engine");
  check(cdm.browser_runtime==="browser-js-cdm-v285","CDM-1 browser runtime mismatch");
}
check(browserEngineSupported("cdm_1")===true,"browserEngines must support cdm_1");
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
console.log("Engine catalog passed:",{count:engines.length,cdm:{id:cdm.id,name:cdm.name,recommended:cdm.recommended,browser_ready:cdm.browser_ready}});
