// Exports the vector records produced by the CDM 2.8.5 Python implementation.
const escapeXml=value=>String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&apos;"})[c]);
const number=value=>Number.isFinite(Number(value))?Number(value):0;
const csvCell=value=>'"'+String(value??"").replaceAll('"','""')+'"';

export function buildCdmSvg(result){
  const layers=result.metrics?.layers||[],records=result.metrics?.records||[];
  const width=number(result.width),height=number(result.height);
  const content=layers.map(layer=>{
    const color=escapeXml(layer.color);
    const paths=records.filter(r=>r.class===layer.id&&r.points?.length>=2).map(r=>{
      const d=r.points.map((point,index)=>(index?"L":"M")+number(point[0])+","+number(point[1])).join(" ")+(r.closed?" Z":"");
      const style=r.closed?`fill="${color}" fill-opacity="0.27" stroke="${color}" stroke-width="1"`:`fill="none" stroke="${color}" stroke-width="${Math.max(1,number(r.width_px))}" stroke-linecap="round"`;
      return `<path id="${escapeXml(r.id)}" d="${d}" ${style}/>`;
    }).join("");
    return `<g id="layer-${escapeXml(layer.id)}" inkscape:groupmode="layer" inkscape:label="${escapeXml(layer.name)}">${paths}</g>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`;
}

export function buildCdmCsv(result){
  const columns=["record_id","damage_class","area_px2","perimeter_px","length_px","width_px","bbox_x","bbox_y","bbox_w","bbox_h","aspect_ratio","confidence_note"];
  const rows=[columns,...(result.metrics?.records||[]).map(r=>[r.id,r.class,r.area_px2,r.perimeter_px,r.length_px,r.width_px,...r.bbox,r.aspect_ratio,r.confidence_note])];
  const rating=result.metrics?.summary?.condition_rating;
  if(rating?.enabled)rows.push([], ["classification_summary","value","label_or_note"],["NT_img_preliminar",rating.NT_img,rating.NT_label_img],["EC_DNIT_img",rating.EC_DNIT_img,rating.EC_DNIT_label_img],["GDE_img_diagnostico",rating.GDE_img,rating.GDE_level]);
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
  const records=result.metrics?.records||[];
  return {
    info:{description:"Concrete Damage Morphology annotations",version:"2.8.5",software:"SHM CDM-1"},licenses:[],
    images:[{id:1,file_name:fileName,width:result.width,height:result.height}],
    categories:categories.map(([_,name],i)=>({id:i+1,name,supercategory:"concrete_damage"})),
    annotations:records.map((r,i)=>({
      id:i+1,image_id:1,category_id:categories.findIndex(([id])=>id===r.class)+1,
      segmentation:[(r.closed?r.points:linePolygon(r.points, r.width_px)).flat().map(number)],
      area:number(r.area_px2),bbox:(r.bbox||[]).map(number),iscrowd:0,
      attributes:{record_id:r.id,damage_class:r.class,perimeter_px:r.perimeter_px,length_px:r.length_px,width_px:r.width_px,aspect_ratio:r.aspect_ratio,note:r.confidence_note},
    })),
  };
}
