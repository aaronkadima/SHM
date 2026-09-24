export const VIEWER_PREFS_KEY="shm.viewer.preferences.v1";

export const DEFAULT_VIEWER_PREFERENCES={
  opacity:0.75,
  layersOpen:true,
  comparison:"overlay",
  wipePosition:50,
  pathologyOrder:[],
  pathologyOpacity:{},
  pathologyLocked:[]
};

const VALID_COMPARISONS=new Set(["original","overlay","wipe","side"]);

export function normalizeViewerPreferences(value={}){
  const opacity=Number(value?.opacity);
  const wipePosition=Number(value?.wipePosition);
  const rawLayerOpacity=value?.pathologyOpacity&&typeof value.pathologyOpacity==="object"&&!Array.isArray(value.pathologyOpacity)?value.pathologyOpacity:{};
  const pathologyOpacity={};
  for(const [id,raw] of Object.entries(rawLayerOpacity)){
    if(typeof id!=="string"||!id.trim())continue;
    const n=Number(raw);
    if(Number.isFinite(n))pathologyOpacity[id]=Math.min(1,Math.max(0,n));
  }
  return {
    opacity:Number.isFinite(opacity)?Math.min(1,Math.max(0,opacity)):DEFAULT_VIEWER_PREFERENCES.opacity,
    layersOpen:typeof value?.layersOpen==="boolean"?value.layersOpen:DEFAULT_VIEWER_PREFERENCES.layersOpen,
    comparison:VALID_COMPARISONS.has(value?.comparison)?value.comparison:DEFAULT_VIEWER_PREFERENCES.comparison,
    wipePosition:Number.isFinite(wipePosition)?Math.min(95,Math.max(5,wipePosition)):DEFAULT_VIEWER_PREFERENCES.wipePosition,
    pathologyOrder:Array.isArray(value?.pathologyOrder)?[...new Set(value.pathologyOrder.filter(x=>typeof x==="string"&&x.trim()))]:[],
    pathologyOpacity,
    pathologyLocked:Array.isArray(value?.pathologyLocked)?[...new Set(value.pathologyLocked.filter(x=>typeof x==="string"&&x.trim()))]:[]
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


export function clampFloatingPanelPosition(next,geometry={}){
  const margin=Number.isFinite(Number(geometry.margin))?Number(geometry.margin):8;
  const panelLeft=Number(geometry.panelLeft)||0;
  const panelTop=Number(geometry.panelTop)||0;
  const panelWidth=Math.max(0,Number(geometry.panelWidth)||0);
  const panelHeight=Math.max(0,Number(geometry.panelHeight)||0);
  const viewportWidth=Math.max(0,Number(geometry.viewportWidth)||0);
  const viewportHeight=Math.max(0,Number(geometry.viewportHeight)||0);
  const minX=margin-panelLeft;
  const maxX=viewportWidth-margin-panelLeft-panelWidth;
  const minY=margin-panelTop;
  const maxY=viewportHeight-margin-panelTop-panelHeight;
  const clampAxis=(value,min,max)=>max>=min?Math.max(min,Math.min(max,value)):(min+max)/2;
  return{
    x:Math.round(clampAxis(Number(next?.x)||0,minX,maxX)),
    y:Math.round(clampAxis(Number(next?.y)||0,minY,maxY))
  };
}
