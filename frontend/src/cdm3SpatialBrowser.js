import{parseSpatialAsset,spatialExtension}from"./spatialAsset.js";

function progress(cb,value,label,stage){
  cb?.({state:value>=100?"done":"running",completed:value,total:100,current_engine:label,stage});
}

export async function runCdm3SpatialBrowser(file,control={}){
  const started=performance.now(),signal=control?.signal,onProgress=control?.onProgress,rgbReferenceFile=control?.rgbReferenceFile||null;
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
      visual_channels:parsed.metadata?.visual_channels||["elevation"],
      has_rgb:!!parsed.colors,
      has_intensity:!!parsed.intensities,
      has_classification:!!parsed.classifications,
      ...parsed.metadata
    },
    image_registration:{
      state:rgbReferenceFile?"rgb_source_attached_pose_required":"not_attached",
      source:rgbReferenceFile?{name:rgbReferenceFile.name,size_bytes:rgbReferenceFile.size,type:rgbReferenceFile.type||null}:null,
      method:"2d_3d_correspondences_pnp_ransac",
      minimum_correspondences:6,
      calibrated_intrinsics_required_for_metric_projection:true,
      endpoints:{
        solve_pose:"/cdm3/registration/pnp",
        project_world_points:"/cdm3/registration/project"
      }
    },
    capabilities:{
      browser_preview:true,
      point_cloud_ingestion:ext==="las"||ext==="xyz",
      rgb_point_rendering:!!parsed.colors,
      geometry_only_segmentation:!parsed.colors&&(ext==="las"||ext==="xyz"),
      ifc_preview:ext==="ifc",
      external_rgb_source:!!rgbReferenceFile,
      image_spatial_registration:!!rgbReferenceFile,
      pathology_projection_ready:false,
      note:parsed.colors
        ?"A nuvem contém RGB por ponto. O CDM-3 pode combinar cor, geometria, intensidade e classes na preparação da segmentação."
        :rgbReferenceFile
          ?"Imagem RGB externa anexada. A projeção patológica aguarda registro 2D→3D por correspondências e PnP/RANSAC."
          :"A nuvem não contém RGB. O CDM-3 deve limitar o browser a geometria/intensidade/classificação; fissuras, corrosão e manchas exigem imagem registrada ou nuvem colorizada."
    },
    spatial_backend:{
      status:"optional_for_ingestion_required_for_deep_pipeline",
      las_summary:"/cdm3/las/summary",
      ifc_resolve:"/cdm3/ifc/resolve",
      ifc_export:"/cdm3/ifc/export",
      image_register:"/cdm3/registration/pnp",
      world_to_image:"/cdm3/registration/project"
    }
  };
  progress(onProgress,100,"CDM-3 · ativo espacial carregado","done");
  const result={
    engine_id:"cdm_3",name:"CDM-3",task:"semantic_segmentation",status:"ok",
    latency_ms:performance.now()-started,detections:[],overlay_png_base64:null,metrics,
    message:ext==="ifc"
      ?"CDM-3 DEV: IFC carregado no canvas e indexado para o pipeline espacial; a prévia browser usa coordenadas IFC, enquanto a resolução semântica final usa IfcOpenShell."
      :parsed.colors
        ?"CDM-3 DEV: "+ext.toUpperCase()+" carregado com RGB por ponto e preparado para fusão cor + geometria."
        :rgbReferenceFile
          ?"CDM-3 DEV: "+ext.toUpperCase()+" sem RGB interno; imagem externa "+rgbReferenceFile.name+" anexada e aguardando registro 2D→3D."
          :"CDM-3 DEV: "+ext.toUpperCase()+" carregado sem RGB; visualização por intensidade/classificação/elevação disponível, mas patologia visual requer textura/imagem registrada."
  };
  return {
    image_width:1,image_height:1,results:[result],consensus:{},spatial_consensus:[],
    consensus_overlay_png_base64:null,
    metadata:{analysis_id:"browser-cdm3-spatial-"+crypto.randomUUID(),api_version:"browser-cdm3-spatial-1",generated_at:new Date().toISOString(),mode:"individual",engine_ids:["cdm_3"],source_format:ext}
  };
}
