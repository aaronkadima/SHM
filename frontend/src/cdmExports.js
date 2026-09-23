// Browser-side exports for the vector records produced by CDM-1 / CDM 2.8.5.
const escapeXml=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&apos;"})[c]);
const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
const stepText=value=>"'" + String(value??"").replaceAll("'","''") + "'";
const number=value=>Number.isFinite(Number(value))?Number(value):0;
const csvCell=value=>'"'+String(value??"").replaceAll('"','""')+'"';
const currentRecords=result=>result.metrics?.records||[];
const temporalRecords=result=>result.metrics?.temporal?.records||[];
const allRecords=result=>[...currentRecords(result),...temporalRecords(result)];
const allLayers=result=>[...(result.metrics?.layers||[]),...(result.metrics?.temporal?.layers||[])];

export function buildCdmSvg(result){
  const records=allRecords(result),layers=allLayers(result);
  const width=number(result.width),height=number(result.height);
  const content=layers.map(layer=>{
    const color=escapeXml(layer.color||"#666");
    const paths=records.filter(r=>{
      if(!r.points?.length||r.points.length<2)return false;
      if(layer.change_class)return r.class===layer.change_class&&r.source_class===layer.source_class;
      return r.class===layer.id;
    }).map(r=>{
      const d=r.points.map((point,index)=>(index?"L":"M")+number(point[0])+","+number(point[1])).join(" ")+(r.closed?" Z":"");
      const style=r.closed
        ?'fill="'+color+'" fill-opacity="0.27" stroke="'+color+'" stroke-width="1"'
        :'fill="none" stroke="'+color+'" stroke-width="'+Math.max(1,number(r.width_px))+'" stroke-linecap="round"';
      return '<path id="'+escapeXml(r.id)+'" data-time="'+escapeXml(r.time_label||"t1_current")+'" data-source-class="'+escapeXml(r.source_class||r.class||"")+'" d="'+d+'" '+style+'/>';
    }).join("");
    return '<g id="layer-'+escapeXml(layer.id)+'" inkscape:groupmode="layer" inkscape:label="'+escapeXml(layer.name)+'">'+paths+'</g>';
  }).join("");
  return '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'">'+content+'</svg>';
}

export function buildCdmCsv(result){
  const columns=["record_id","time_label","damage_class","source_class","area_px2","perimeter_px","length_px","width_px","bbox_x","bbox_y","bbox_w","bbox_h","aspect_ratio","confidence_note"];
  const rows=[columns,...allRecords(result).map(r=>[r.id,r.time_label||"t1_current",r.class,r.source_class||r.class,r.area_px2,r.perimeter_px,r.length_px,r.width_px,...(r.bbox||[]),r.aspect_ratio,r.confidence_note])];
  const temporal=result.metrics?.temporal;
  if(temporal?.enabled){
    const alignment=temporal.alignment||{};
    rows.push([],["temporal_alignment","value","note"],
      ["method",temporal.alignment_method||alignment.method_applied||"resize",alignment.reason||""],
      ["dx_px",alignment.dx_px??0,"translation applied to t0"],
      ["dy_px",alignment.dy_px??0,"translation applied to t0"],
      ["improvement",alignment.improvement??0,"relative edge-match gain"]);
    rows.push([],["temporal_class","iou","growth_area_px2","reduction_area_px2"]);
    for(const [cls,st] of Object.entries(temporal.stats||{}))rows.push([cls,st.iou,st.growth_area_px2,st.reduction_area_px2]);
  }
  const rating=result.metrics?.summary?.condition_rating;
  if(rating?.enabled)rows.push([],["classification_summary","value","label_or_note"],["NT_img_preliminar",rating.NT_img,rating.NT_label_img],["EC_DNIT_img",rating.EC_DNIT_img,rating.EC_DNIT_label_img],["GDE_img_diagnostico",rating.GDE_img,rating.GDE_level],["Familia",rating.family,rating.family_label],["Fr",rating.Fr,"Fator de relevância estrutural"]);
  const perf=result.metrics?.performance_ms;
  if(perf)rows.push([],["runtime_performance","milliseconds","runtime"],["decode_ms",perf.decode,result.metrics?.runtime||""],["core_ms",perf.core,result.metrics?.runtime||""],["render_ms",perf.render,result.metrics?.runtime||""],["total_ms",perf.total,result.metrics?.runtime||""]);
  return "\uFEFF"+rows.map(row=>row.map(csvCell).join(";")).join("\n");
}

const categories=[["cracks","crack"],["spalling_dark","spalling"],["exposed_rebar","exposed_rebar"],["corrosion_rust","corrosion"],["efflorescence_white","efflorescence"]];
function linePolygon(points,width){
  if(points.length<2)return points;
  const [a,b]=[points[0],points.at(-1)],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),half=Math.max(1,number(width)/2);
  if(length<1e-6)return [[a[0]-half,a[1]-half],[a[0]+half,a[1]-half],[a[0]+half,a[1]+half],[a[0]-half,a[1]+half]];
  const nx=-dy/length*half,ny=dx/length*half;
  return [[a[0]+nx,a[1]+ny],[b[0]+nx,b[1]+ny],[b[0]-nx,b[1]-ny],[a[0]-nx,a[1]-ny]];
}
export function buildCdmCoco(result,fileName="inspecao.png"){
  const records=currentRecords(result);
  return {
    info:{description:"Concrete Damage Morphology annotations",version:"2.8.5",software:"SHM CDM-1"},licenses:[],
    images:[{id:1,file_name:fileName,width:result.width,height:result.height}],
    categories:categories.map(([_,name],i)=>({id:i+1,name,supercategory:"concrete_damage"})),
    annotations:records.map((r,i)=>({
      id:i+1,image_id:1,category_id:Math.max(1,categories.findIndex(([id])=>id===r.class)+1),
      segmentation:[(r.closed?r.points:linePolygon(r.points||[],r.width_px)).flat().map(number)],
      area:number(r.area_px2),bbox:(r.bbox||[]).map(number),iscrowd:0,
      attributes:{record_id:r.id,time_label:r.time_label||"t1_current",damage_class:r.class,perimeter_px:r.perimeter_px,length_px:r.length_px,width_px:r.width_px,aspect_ratio:r.aspect_ratio,note:r.confidence_note},
    })),
  };
}

const dxfLayers={
  cracks:"SHM_CRACKS",spalling_dark:"SHM_SPALLING",exposed_rebar:"SHM_EXPOSED_REBAR",
  corrosion_rust:"SHM_CORROSION",efflorescence_white:"SHM_EFFLORESCENCE"
};
const dxfSafe=value=>String(value||"DAMAGE").toUpperCase().replace(/[^A-Z0-9_]/g,"_").slice(0,80);
function dxfLayerForRecord(record){
  if(record.class==="growth"||record.class==="reduction"){
    return "SHM_TEMPORAL_"+dxfSafe(record.class)+"_"+dxfSafe(record.source_class||"UNKNOWN");
  }
  return dxfLayers[record.class]||"SHM_DAMAGE";
}
export function buildCdmDxf(result){
  const scale=number(result.metrics?.mm_per_px)>0?number(result.metrics.mm_per_px):1;
  const calibrated=number(result.metrics?.mm_per_px)>0;
  const records=allRecords(result).filter(r=>r.points?.length>=2);
  const layers=[...new Set(records.map(dxfLayerForRecord))].sort();
  const out=[];const add=(...items)=>items.forEach(v=>out.push(String(v)));
  add(0,"SECTION",2,"HEADER",9,"$INSUNITS",70,calibrated?4:0,0,"ENDSEC");
  add(0,"SECTION",2,"TABLES",0,"TABLE",2,"LAYER",70,layers.length);
  layers.forEach(layer=>add(0,"LAYER",2,layer,70,0,62,7,6,"CONTINUOUS"));
  add(0,"ENDTAB",0,"ENDSEC",0,"SECTION",2,"ENTITIES");
  for(const r of records){
    const pts=r.points.map(([x,y])=>[number(x)*scale,-number(y)*scale]);
    add(0,"LWPOLYLINE",8,dxfLayerForRecord(r),90,pts.length,70,r.closed?1:0);
    pts.forEach(([x,y])=>add(10,x.toFixed(4),20,y.toFixed(4)));
  }
  add(0,"ENDSEC",0,"EOF");
  return out.join("\n")+"\n";
}

export function buildCdmBimJson(result,inspection={}){
  const mm=number(result.metrics?.mm_per_px)>0?number(result.metrics.mm_per_px):null;
  const factor=mm||1;
  const features=allRecords(result).map(r=>({
    id:r.id,time_label:r.time_label||"t1_current",damage_class:r.class,source_class:r.source_class||r.class,
    geometry_type:r.closed?"polygon":"polyline",
    coordinate_system:"image_local",
    coordinates:(r.points||[]).map(([x,y])=>[number(x)*factor,-number(y)*factor]),
    units:mm?"mm":"px",
    target_ifc_element_guid:inspection.element_id||"",
    source_id:inspection.source_id||"",
    metrics:{area_px2:r.area_px2,perimeter_px:r.perimeter_px,length_px:r.length_px,width_px:r.width_px,aspect_ratio:r.aspect_ratio,bbox_px:r.bbox}
  }));
  return {
    schema:"cdm_bim_overlay_v285",software:"SHM CDM-1",oae_id:inspection.oae_id||"",
    inspection_label:inspection.inspection_label||"",calibration:{mm_per_px:mm},
    temporal:{enabled:!!result.metrics?.temporal?.enabled,alignment_method:result.metrics?.temporal?.alignment_method||null,alignment:result.metrics?.temporal?.alignment||null,stats:result.metrics?.temporal?.stats||{}},
    provenance:{runtime:result.metrics?.runtime||null,performance_ms:result.metrics?.performance_ms||null,implementation:result.metrics?.implementation||null},
    features
  };
}

const IFC_CHARS="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
function ifcGuid(){
  const bytes=new Uint8Array(17);
  if(globalThis.crypto?.getRandomValues)globalThis.crypto.getRandomValues(bytes);
  else for(let i=0;i<bytes.length;i++)bytes[i]=(Math.random()*256)|0;
  let out="";
  for(let i=0;i<22;i++)out+=IFC_CHARS[bytes[i%bytes.length]&63];
  return out;
}
export function buildCdmIfc(result,inspection={}){
  const mmPerPx=number(result.metrics?.mm_per_px);
  if(!(mmPerPx>0))throw new Error("A exportação IFC exige calibração CDM-1 em mm/px.");
  const records=allRecords(result).filter(r=>r.points?.length>=2);
  const entities=[];const add=entity=>{entities.push("#"+(entities.length+1)+"="+entity+";");return entities.length};
  const owner=add("IFCPERSON($,$,'ConcreteDamageMorphology',$,$,$,$,$)");
  const org=add("IFCORGANIZATION($,'SHM Studio',$,$,$)");
  const pao=add("IFCPERSONANDORGANIZATION(#"+owner+",#"+org+",$)");
  const app=add("IFCAPPLICATION(#"+org+",'2.8.5','SHM CDM-1','CDM-1')");
  const hist=add("IFCOWNERHISTORY(#"+pao+",#"+app+",$,.ADDED.,$,$,$,0)");
  const origin=add("IFCCARTESIANPOINT((0.,0.,0.))");
  const axis=add("IFCAXIS2PLACEMENT3D(#"+origin+",$,$)");
  const ctx=add("IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#"+axis+",$)");
  const unit=add("IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)");
  const units=add("IFCUNITASSIGNMENT((#"+unit+"))");
  add("IFCPROJECT("+stepText(ifcGuid())+",#"+hist+","+stepText(inspection.oae_id||"CDM damage annotation project")+",$,$,$,$,(#"+ctx+"),#"+units+")");
  for(const r of records){
    const ptIds=(r.points||[]).map(([x,y])=>add("IFCCARTESIANPOINT(("+((number(x)*mmPerPx).toFixed(6))+","+((-number(y)*mmPerPx).toFixed(6))+",0.))"));
    if(r.closed&&ptIds.length>2)ptIds.push(ptIds[0]);
    const poly=add("IFCPOLYLINE(("+ptIds.map(id=>"#"+id).join(",")+"))");
    const gset=add("IFCGEOMETRICCURVESET((#"+poly+"))");
    const rep=add("IFCSHAPEREPRESENTATION(#"+ctx+",'Annotation','GeometricCurveSet',(#"+gset+"))");
    const shape=add("IFCPRODUCTDEFINITIONSHAPE($,$,(#"+rep+"))");
    const place=add("IFCLOCALPLACEMENT($,#"+axis+")");
    const ann=add("IFCANNOTATION("+stepText(ifcGuid())+",#"+hist+","+stepText(r.id)+","+stepText(r.class)+",$,#"+place+",#"+shape+",$)");
    const props=[
      add("IFCPROPERTYSINGLEVALUE('DamageClass',$,IFCTEXT("+stepText(r.class)+"),$)"),
      add("IFCPROPERTYSINGLEVALUE('SourcePathology',$,IFCTEXT("+stepText(r.source_class||r.class||"")+"),$)"),
      add("IFCPROPERTYSINGLEVALUE('TimeLabel',$,IFCTEXT("+stepText(r.time_label||"t1_current")+"),$)"),
      add("IFCPROPERTYSINGLEVALUE('AreaPx2',$,IFCREAL("+number(r.area_px2).toFixed(6)+"),$)"),
      add("IFCPROPERTYSINGLEVALUE('LengthPx',$,IFCREAL("+number(r.length_px).toFixed(6)+"),$)"),
      add("IFCPROPERTYSINGLEVALUE('WidthPx',$,IFCREAL("+number(r.width_px).toFixed(6)+"),$)"),
      add("IFCPROPERTYSINGLEVALUE('TargetElement',$,IFCTEXT("+stepText(inspection.element_id||"")+"),$)")
    ];
    const pset=add("IFCPROPERTYSET("+stepText(ifcGuid())+",#"+hist+",'Pset_ConcreteDamageAssessment',$,("+props.map(id=>"#"+id).join(",")+"))");
    add("IFCRELDEFINESBYPROPERTIES("+stepText(ifcGuid())+",#"+hist+",$,$,(#"+ann+"),#"+pset+")");
  }
  const now=new Date().toISOString();
  return "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');\nFILE_NAME('cdm-1.ifc','"+now+"',('SHM Studio'),('OpenAI'),'SHM CDM-1','SHM Studio','');\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n"+entities.join("\n")+"\nENDSEC;\nEND-ISO-10303-21;\n";
}

export function buildCdmHtml(result,fileName="inspecao.png",inspection={}){
  const summary=result.metrics?.summary||{},rating=summary.condition_rating||{},layers=result.metrics?.layers||[];
  const temporal=result.metrics?.temporal||{};
  const familyRows=(rating.family_rows||[]).filter(r=>number(r.n)>0);
  const temporalRows=Object.entries(temporal.stats||{}).map(([cls,st])=>"<tr><td>"+escapeHtml(cls)+"</td><td>"+number(st.iou).toFixed(3)+"</td><td>"+number(st.growth_area_px2).toFixed(1)+"</td><td>"+number(st.reduction_area_px2).toFixed(1)+"</td></tr>").join("")||"<tr><td colspan='4'>Sem comparação temporal.</td></tr>";
  const alignment=temporal.alignment||{};
  const alignmentText=temporal.enabled
    ?(alignment.accepted?"registro automático Δx="+number(alignment.dx_px).toFixed(0)+" px, Δy="+number(alignment.dy_px).toFixed(0)+" px; ganho "+(number(alignment.improvement)*100).toFixed(1)+"%":"sem translação aplicada; "+escapeHtml(alignment.reason||temporal.alignment_method||"resize"))
    :"não aplicado";
  const layerRows=layers.map(l=>'<tr><td><span class="sw" style="background:'+escapeHtml(l.color)+'"></span>'+escapeHtml(l.name)+"</td><td>"+number(l.count)+"</td></tr>").join("");
  const familyTable=familyRows.map(r=>"<tr><td>"+escapeHtml(r.class_label||r.class)+"</td><td>"+number(r.n)+"</td><td>"+number(r.s_max).toFixed(3)+"</td><td>EC"+escapeHtml(r.EC_DNIT_family_img)+"</td><td>"+escapeHtml(r.governing_record_id||"")+"</td></tr>").join("")||"<tr><td colspan='5'>Sem famílias classificadas.</td></tr>";
  const calibration=number(result.metrics?.mm_per_px)>0?number(result.metrics.mm_per_px).toFixed(6)+" mm/px":"não calibrada";
  const perf=result.metrics?.performance_ms||{};
  const performanceText=perf.total!=null
    ?("Decodificação "+(number(perf.decode)/1000).toFixed(2)+" s · núcleo "+(number(perf.core)/1000).toFixed(2)+" s · renderização "+(number(perf.render)/1000).toFixed(2)+" s · total "+(number(perf.total)/1000).toFixed(2)+" s")
    :"não registrado";
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Relatório CDM-1</title><style>'+
  'body{font-family:Inter,Arial,sans-serif;margin:0;background:#f6f8f8;color:#1c2b31}main{max-width:1080px;margin:auto;padding:32px}h1{margin:0 0 6px;font-size:28px}.muted{color:#687b84}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}.card{background:#fff;border:1px solid #dce6e9;border-radius:12px;padding:18px;margin:16px 0}.metric b{display:block;font-size:28px;color:#0d766e}.metric span{font-size:12px;color:#657982}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px;border-bottom:1px solid #e7edef;font-size:13px}th{color:#647781;font-size:11px;text-transform:uppercase}.sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:8px}.note{border-left:3px solid #0d766e;padding-left:12px}.mono{font-family:ui-monospace,Consolas,monospace}</style></head><body><main>'+
  "<h1>Relatório de inspeção — CDM-1</h1><p class='muted'>Concrete Damage Morphology v2.8.5 · "+escapeHtml(fileName)+" · "+escapeHtml(inspection.inspection_label||"inspeção sem rótulo")+"</p>"+
  '<section class="grid"><div class="card metric"><b>'+number(summary.total_objects)+'</b><span>achados atuais</span></div><div class="card metric"><b>'+number(summary.crack_count)+'</b><span>fissuras</span></div><div class="card metric"><b>'+number(summary.spalling_area_px2).toFixed(0)+'</b><span>px² de desplacamento</span></div><div class="card metric"><b>'+escapeHtml(calibration)+'</b><span>escala geométrica</span></div></section>'+
  '<section class="card"><h2>Camadas atuais</h2><table><thead><tr><th>Patologia</th><th>Objetos</th></tr></thead><tbody>'+layerRows+'</tbody></table></section>'+
  '<section class="card"><h2>Classificação preliminar por imagem</h2><p class="note">NT <b>'+escapeHtml(rating.NT_img??"—")+'</b> · EC <b>'+escapeHtml(rating.EC_DNIT_img??"—")+'</b> · GDE <b>'+number(rating.GDE_img).toFixed(2)+'</b>. Resultado assistido por imagem; exige validação técnica.</p><table><thead><tr><th>Família</th><th>n</th><th>s_max</th><th>EC</th><th>Governante</th></tr></thead><tbody>'+familyTable+'</tbody></table></section>'+
  '<section class="card"><h2>Comparação temporal t0→t1</h2><p class="muted">Alinhamento: '+alignmentText+'.</p><table><thead><tr><th>Classe</th><th>IoU</th><th>Crescimento px²</th><th>Redução px²</th></tr></thead><tbody>'+temporalRows+'</tbody></table></section>'+
  '<section class="card"><h2>Rastreabilidade</h2><p>OAE: <span class="mono">'+escapeHtml(inspection.oae_id||"—")+'</span> · Elemento: <span class="mono">'+escapeHtml(inspection.element_id||"—")+'</span> · Fonte: <span class="mono">'+escapeHtml(inspection.source_id||"—")+'</span></p><p>Runtime: <span class="mono">'+escapeHtml(result.metrics?.runtime||"—")+'</span> · '+escapeHtml(performanceText)+'</p><p class="muted">Pipeline determinístico: imagem base → resposta específica por família → máscara candidata → abertura/fechamento → componentes conectados. As pontuações de confiança morfológicas permanecem não calibradas.</p></section>'+
  '</main></body></html>';
}
