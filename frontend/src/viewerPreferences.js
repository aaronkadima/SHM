export const VIEWER_PREFS_KEY="shm.viewer.preferences.v1";

export const DEFAULT_VIEWER_PREFERENCES={
  opacity:0.75,
  layersOpen:true,
  layersWidth:360,
  comparison:"overlay",
  wipePosition:50,
  pathologyOrder:[],
  pathologyOpacity:{},
  pathologyLocked:[],
  resultPanelOpen:true,
  resultPanelPosition:{x:0,y:0},
  resultPanelSize:{width:360,height:null}
};

const VALID_COMPARISONS=new Set(["original","overlay","wipe","side"]);

export function normalizeViewerPreferences(value={}){
  const opacity=Number(value?.opacity);
  const wipePosition=Number(value?.wipePosition);
  const layersWidth=Number(value?.layersWidth);
  const rawLayerOpacity=value?.pathologyOpacity&&typeof value.pathologyOpacity==="object"&&!Array.isArray(value.pathologyOpacity)?value.pathologyOpacity:{};
  const rawPanelPosition=value?.resultPanelPosition&&typeof value.resultPanelPosition==="object"?value.resultPanelPosition:{};
  const rawPanelSize=value?.resultPanelSize&&typeof value.resultPanelSize==="object"?value.resultPanelSize:{};
  const panelX=Number(rawPanelPosition.x),panelY=Number(rawPanelPosition.y),panelWidth=Number(rawPanelSize.width),panelHeight=Number(rawPanelSize.height);
  const pathologyOpacity={};
  for(const [id,raw] of Object.entries(rawLayerOpacity)){
    if(typeof id!=="string"||!id.trim())continue;
    const n=Number(raw);
    if(Number.isFinite(n))pathologyOpacity[id]=Math.min(1,Math.max(0,n));
  }
  return {
    opacity:Number.isFinite(opacity)?Math.min(1,Math.max(0,opacity)):DEFAULT_VIEWER_PREFERENCES.opacity,
    layersOpen:typeof value?.layersOpen==="boolean"?value.layersOpen:DEFAULT_VIEWER_PREFERENCES.layersOpen,
    layersWidth:clampLayersPanelWidth(layersWidth),
    comparison:VALID_COMPARISONS.has(value?.comparison)?value.comparison:DEFAULT_VIEWER_PREFERENCES.comparison,
    wipePosition:Number.isFinite(wipePosition)?Math.min(95,Math.max(5,wipePosition)):DEFAULT_VIEWER_PREFERENCES.wipePosition,
    pathologyOrder:Array.isArray(value?.pathologyOrder)?[...new Set(value.pathologyOrder.filter(x=>typeof x==="string"&&x.trim()))]:[],
    pathologyOpacity,
    pathologyLocked:Array.isArray(value?.pathologyLocked)?[...new Set(value.pathologyLocked.filter(x=>typeof x==="string"&&x.trim()))]:[],
    resultPanelOpen:typeof value?.resultPanelOpen==="boolean"?value.resultPanelOpen:DEFAULT_VIEWER_PREFERENCES.resultPanelOpen,
    resultPanelPosition:{
      x:Number.isFinite(panelX)?Math.min(5000,Math.max(-5000,panelX)):DEFAULT_VIEWER_PREFERENCES.resultPanelPosition.x,
      y:Number.isFinite(panelY)?Math.min(5000,Math.max(-5000,panelY)):DEFAULT_VIEWER_PREFERENCES.resultPanelPosition.y
    },
    resultPanelSize:{
      width:Number.isFinite(panelWidth)?Math.min(900,Math.max(340,panelWidth)):DEFAULT_VIEWER_PREFERENCES.resultPanelSize.width,
      height:Number.isFinite(panelHeight)&&panelHeight>=65?Math.min(900,panelHeight):DEFAULT_VIEWER_PREFERENCES.resultPanelSize.height
    }
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


export function clampLayersPanelWidth(value){
  const width=Number(value);
  return Number.isFinite(width)?Math.min(600,Math.max(340,Math.round(width))):DEFAULT_VIEWER_PREFERENCES.layersWidth;
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
