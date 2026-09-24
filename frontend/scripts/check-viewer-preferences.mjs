import {
  DEFAULT_VIEWER_PREFERENCES,
  VIEWER_PREFS_KEY,
  loadViewerPreferences,
  normalizeViewerPreferences,
  saveViewerPreferences
} from "../src/viewerPreferences.js";

const failures=[];
const check=(ok,msg)=>{if(!ok)failures.push(msg)};

const normalized=normalizeViewerPreferences({opacity:1.5,layersOpen:false,comparison:"temporal",pathologyOrder:["cracks","corrosion_rust","cracks",42,""]});
check(normalized.opacity===1,"opacity must clamp to 1");
check(normalized.layersOpen===false,"layersOpen false must persist");
check(normalized.comparison==="overlay","temporal mode must not persist as global preference");
check(normalized.pathologyOrder.join(",")==="cracks,corrosion_rust","pathology order must keep unique non-empty string ids");

const low=normalizeViewerPreferences({opacity:-1,layersOpen:"yes",comparison:"side"});
check(low.opacity===0,"opacity must clamp to 0");
check(low.layersOpen===DEFAULT_VIEWER_PREFERENCES.layersOpen,"invalid layersOpen must fall back");
check(low.comparison==="side","side mode must remain valid");

const storage={
  value:null,
  getItem(key){return key===VIEWER_PREFS_KEY?this.value:null},
  setItem(key,value){if(key===VIEWER_PREFS_KEY)this.value=value}
};

check(saveViewerPreferences({opacity:0.55,layersOpen:false,comparison:"original",pathologyOrder:["corrosion_rust","cracks"]},storage)===true,"saveViewerPreferences must succeed with valid storage");
const loaded=loadViewerPreferences(storage);
check(loaded.opacity===0.55,"saved opacity must reload");
check(loaded.layersOpen===false,"saved layers state must reload");
check(loaded.comparison==="original","saved comparison mode must reload");
check(loaded.pathologyOrder.join(",")==="corrosion_rust,cracks","saved pathology order must reload");

storage.value="{bad json";
const fallback=loadViewerPreferences(storage);
check(fallback.comparison===DEFAULT_VIEWER_PREFERENCES.comparison,"invalid JSON must fall back safely");

if(failures.length){
  console.error("Viewer preference failures:");
  failures.forEach(x=>console.error(" - "+x));
  process.exit(1);
}
console.log("Viewer preferences passed.");
