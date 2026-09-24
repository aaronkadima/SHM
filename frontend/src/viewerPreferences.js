export const VIEWER_PREFS_KEY="shm.viewer.preferences.v1";

export const DEFAULT_VIEWER_PREFERENCES={
  opacity:0.75,
  layersOpen:true,
  comparison:"overlay",
  pathologyOrder:[]
};

const VALID_COMPARISONS=new Set(["original","overlay","side"]);

export function normalizeViewerPreferences(value={}){
  const opacity=Number(value?.opacity);
  return {
    opacity:Number.isFinite(opacity)?Math.min(1,Math.max(0,opacity)):DEFAULT_VIEWER_PREFERENCES.opacity,
    layersOpen:typeof value?.layersOpen==="boolean"?value.layersOpen:DEFAULT_VIEWER_PREFERENCES.layersOpen,
    comparison:VALID_COMPARISONS.has(value?.comparison)?value.comparison:DEFAULT_VIEWER_PREFERENCES.comparison,
    pathologyOrder:Array.isArray(value?.pathologyOrder)?[...new Set(value.pathologyOrder.filter(x=>typeof x==="string"&&x.trim()))]:[]
  };
}

export function loadViewerPreferences(storage=globalThis?.localStorage){
  try{
    if(!storage)return {...DEFAULT_VIEWER_PREFERENCES};
    const raw=storage.getItem(VIEWER_PREFS_KEY);
    return raw?normalizeViewerPreferences(JSON.parse(raw)):{...DEFAULT_VIEWER_PREFERENCES};
  }catch{
    return {...DEFAULT_VIEWER_PREFERENCES};
  }
}

export function saveViewerPreferences(value,storage=globalThis?.localStorage){
  try{
    if(!storage)return false;
    storage.setItem(VIEWER_PREFS_KEY,JSON.stringify(normalizeViewerPreferences(value)));
    return true;
  }catch{
    return false;
  }
}
