import{parseSpatialAsset,spatialExtension}from"./spatialAsset.js";

function progress(cb,value,label,stage){
  cb?.({state:value>=100?"done":"running",completed:value,total:100,current_engine:label,stage});
}

export async function runCdm3SpatialBrowser(file,control={}){
  const started=performance.now(),signal=control?.signal,onProgress=control?.onProgress;
  if(signal?.aborted)throw new DOMException("Análise cancelada.","AbortError");
  const ext=spatialExtension(file);
  if(!ext)throw new Error("CDM-3 espacial aceita .las, .xyz e .ifc.");
  progress(onProgress,5,"CDM-3 · lendo "+ext.toUpperCase(),"spatial_decode");
  const parsed=await parseSpatialAsset(file,{maxPoints:250000});
  if(signal?.aborted)throw new DOMException("Análise cancelada.","AbortError");
  progress(onProgress,80,"CDM-3 · estruturando ativo espacial","spatial_index");
  const metrics={
    implementation:"CDM-3 3.0.0-dev",
    runtime_mode:"spatial_browser_ingestion",
    experimental:true,
    stage_c_ai_ready:false,
    source_format:ext,
    source_file:{name:file.name,size_bytes:file.size,type:file.type||null},
    spatial_asset:{
      sampled_points:parsed.sampled_points,
      bounds:parsed.bounds,
      ...parsed.metadata
    },
    capabilities:{
      browser_preview:true,
      point_cloud_ingestion:ext==="las"||ext==="xyz",
      ifc_preview:ext==="ifc",
      pathology_projection_ready:false,
      note:"A importação espacial está ativa no DEV. Segmentação patológica 3D e vínculo final IfcElement usam o backend CDM-3 quando o pipeline espacial completo estiver configurado."
    },
    spatial_backend:{
      status:"optional_for_ingestion_required_for_deep_pipeline",
      las_summary:"/cdm3/las/summary",
      ifc_resolve:"/cdm3/ifc/resolve",
      ifc_export:"/cdm3/ifc/export"
    }
  };
  progress(onProgress,100,"CDM-3 · ativo espacial carregado","done");
  const result={
    engine_id:"cdm_3",name:"CDM-3",task:"semantic_segmentation",status:"ok",
    latency_ms:performance.now()-started,detections:[],overlay_png_base64:null,metrics,
    message:ext==="ifc"
      ?"CDM-3 DEV: IFC carregado no canvas e indexado para o pipeline espacial; a prévia browser usa coordenadas IFC, enquanto a resolução semântica final usa IfcOpenShell."
      :"CDM-3 DEV: "+ext.toUpperCase()+" carregado no canvas como nuvem de pontos e preparado para o pipeline espacial."
  };
  return {
    image_width:1,image_height:1,results:[result],consensus:{},spatial_consensus:[],
    consensus_overlay_png_base64:null,
    metadata:{analysis_id:"browser-cdm3-spatial-"+crypto.randomUUID(),api_version:"browser-cdm3-spatial-1",generated_at:new Date().toISOString(),mode:"individual",engine_ids:["cdm_3"],source_format:ext}
  };
}
