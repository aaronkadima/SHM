import {
  DEFAULT_VIEWER_PREFERENCES,
  VIEWER_PREFS_KEY,
  clampFloatingPanelPosition,
  loadViewerPreferences,
  normalizeViewerPreferences,
  saveViewerPreferences
} from "../src/viewerPreferences.js";

const failures=[];
const check=(ok,msg)=>{if(!ok)failures.push(msg)};

const clampDesktopGeometry={viewportWidth:386,viewportHeight:680,panelLeft:8,panelTop:82,panelWidth:360,panelHeight:510,margin:8};
const desktopTopLeft=clampFloatingPanelPosition({x:-1e6,y:-1e6},clampDesktopGeometry);
const desktopBottomRight=clampFloatingPanelPosition({x:1e6,y:1e6},clampDesktopGeometry);
check(desktopTopLeft.x===0&&desktopTopLeft.y===-74,"floating panel desktop top-left clamp must respect 8px margins");
check(desktopBottomRight.x===10&&desktopBottomRight.y===80,"floating panel desktop bottom-right clamp must respect viewport bounds");

const clampMobileGeometry={viewportWidth:356,viewportHeight:680,panelLeft:8,panelTop:82,panelWidth:340,panelHeight:510,margin:8};
const mobileTopLeft=clampFloatingPanelPosition({x:-999,y:-999},clampMobileGeometry);
const mobileBottomRight=clampFloatingPanelPosition({x:999,y:999},clampMobileGeometry);
check(mobileTopLeft.x===0&&mobileTopLeft.y===-74,"floating panel mobile top-left clamp must retain full panel width");
check(mobileBottomRight.x===0&&mobileBottomRight.y===80,"floating panel mobile bottom-right clamp must keep the 340px panel inside 356px viewport");

const oversized=clampFloatingPanelPosition({x:999,y:999},{viewportWidth:300,viewportHeight:300,panelLeft:0,panelTop:0,panelWidth:320,panelHeight:340,margin:8});
check(Number.isFinite(oversized.x)&&Number.isFinite(oversized.y),"floating panel clamp must stay finite even when the panel is larger than the viewport");

const beforeResizeGeometry={viewportWidth:600,viewportHeight:600,panelLeft:222,panelTop:82,panelWidth:360,panelHeight:300,margin:8};
const beforeResize=clampFloatingPanelPosition({x:0,y:999},beforeResizeGeometry);
check(beforeResize.x===0&&beforeResize.y===210,"floating panel clamp must allow the panel to reach the bottom margin before resize");
const afterResize=clampFloatingPanelPosition(beforeResize,{...beforeResizeGeometry,panelHeight:500});
check(afterResize.x===0&&afterResize.y===10,"floating panel clamp must pull a resized panel back inside the bottom margin");

const normalized=normalizeViewerPreferences({opacity:1.5,layersOpen:false,comparison:"temporal",wipePosition:140,pathologyOrder:["cracks","corrosion_rust","cracks",42,""],pathologyOpacity:{cracks:1.4,corrosion_rust:.45,bad:"x","":.3},pathologyLocked:["cracks","cracks",42,""]});
check(normalized.opacity===1,"opacity must clamp to 1");
check(normalized.layersOpen===false,"layersOpen false must persist");
check(normalized.layersWidth===360,"missing Layers width must use 360px default");
check(normalizeViewerPreferences({layersWidth:120}).layersWidth===340,"Layers width must clamp to 340px minimum");
check(normalizeViewerPreferences({layersWidth:900}).layersWidth===600,"Layers width must clamp to 600px maximum");
check(normalized.comparison==="overlay","temporal mode must not persist as global preference");
check(normalized.wipePosition===95,"wipe position must clamp to 95");
check(normalized.pathologyOrder.join(",")==="cracks,corrosion_rust","pathology order must keep unique non-empty string ids");
check(normalized.pathologyOpacity.cracks===1,"pathology opacity must clamp to 1");
check(normalized.pathologyOpacity.corrosion_rust===0.45,"pathology opacity must keep valid values");
check(!("bad" in normalized.pathologyOpacity)&&!("" in normalized.pathologyOpacity),"invalid pathology opacity entries must be removed");
check(normalized.pathologyLocked.join(",")==="cracks","locked layers must keep unique non-empty string ids");
check(normalized.resultPanelPosition.x===0&&normalized.resultPanelPosition.y===0,"missing Results panel position must use defaults");
check(normalized.resultPanelSize.width===360&&normalized.resultPanelSize.height===null,"missing Results panel size must use defaults");
check(normalized.resultPanelOpen===true,"missing Results panel visibility must default to open");
check(normalizeViewerPreferences({resultPanelOpen:false}).resultPanelOpen===false,"collapsed Results preference must remain false");
const panelNormalized=normalizeViewerPreferences({resultPanelPosition:{x:9000,y:-9000},resultPanelSize:{width:1200,height:42}});
check(panelNormalized.resultPanelPosition.x===5000&&panelNormalized.resultPanelPosition.y===-5000,"Results panel position must be bounded before viewport clamping");
check(panelNormalized.resultPanelSize.width===900&&panelNormalized.resultPanelSize.height===null,"Results panel size must bound width and reject undersized height");

const low=normalizeViewerPreferences({opacity:-1,layersOpen:"yes",comparison:"wipe",wipePosition:1});
check(low.opacity===0,"opacity must clamp to 0");
check(low.layersOpen===DEFAULT_VIEWER_PREFERENCES.layersOpen,"invalid layersOpen must fall back");
check(low.comparison==="wipe","wipe mode must remain valid");
check(low.wipePosition===5,"wipe position must clamp to 5");

const storage={
  value:null,
  getItem(key){return key===VIEWER_PREFS_KEY?this.value:null},
  setItem(key,value){if(key===VIEWER_PREFS_KEY)this.value=value}
};

check(saveViewerPreferences({opacity:0.55,layersOpen:false,layersWidth:468,comparison:"wipe",wipePosition:62,pathologyOrder:["corrosion_rust","cracks"],pathologyOpacity:{corrosion_rust:.35,cracks:.8},pathologyLocked:["cracks"],resultPanelOpen:false,resultPanelPosition:{x:-48,y:73},resultPanelSize:{width:512,height:420}},storage)===true,"saveViewerPreferences must succeed with valid storage");
const loaded=loadViewerPreferences(storage);
check(loaded.opacity===0.55,"saved opacity must reload");
check(loaded.layersOpen===false,"saved layers state must reload");
check(loaded.layersWidth===468,"saved Layers width must reload");
check(loaded.comparison==="wipe","saved comparison mode must reload");
check(loaded.wipePosition===62,"saved wipe position must reload");
check(loaded.pathologyOrder.join(",")==="corrosion_rust,cracks","saved pathology order must reload");
check(loaded.pathologyOpacity.corrosion_rust===0.35&&loaded.pathologyOpacity.cracks===0.8,"saved per-pathology opacity must reload");
check(loaded.pathologyLocked.join(",")==="cracks","saved locked pathology layers must reload");
check(loaded.resultPanelPosition.x===-48&&loaded.resultPanelPosition.y===73,"saved Results panel position must reload");
check(loaded.resultPanelSize.width===512&&loaded.resultPanelSize.height===420,"saved Results panel size must reload");
check(loaded.resultPanelOpen===false,"saved collapsed Results state must reload");

storage.value="{bad json";
const fallback=loadViewerPreferences(storage);
check(fallback.comparison===DEFAULT_VIEWER_PREFERENCES.comparison,"invalid JSON must fall back safely");

if(failures.length){
  console.error("Viewer preference failures:");
  failures.forEach(x=>console.error(" - "+x));
  process.exit(1);
}
console.log("Viewer preferences passed.");
