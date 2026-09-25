const SPATIAL_EXTENSIONS=new Set(["las","xyz","ifc"]);

export function spatialExtension(file){
  const name=String(file?.name||"").toLowerCase();
  const m=name.match(/\.([^.]+)$/);
  const ext=m?.[1]||"";
  return SPATIAL_EXTENSIONS.has(ext)?ext:null;
}

function normalizedRgb(values){
  if(!values?.length)return null;
  let max=0,nonZero=0;
  for(const value of values){
    const n=Number(value);
    if(Number.isFinite(n)){if(n>max)max=n;if(n>0)nonZero++}
  }
  if(!nonZero)return null;
  const divisor=max<=1?1:max<=255?255:65535;
  const out=new Float32Array(values.length);
  for(let i=0;i<values.length;i++)out[i]=Math.max(0,Math.min(1,(Number(values[i])||0)/divisor));
  return out;
}

function finishPositions(raw,metadata={},attributes={}){
  if(!raw.length)throw new Error("Nenhuma coordenada espacial válida foi encontrada.");
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for(let i=0;i<raw.length;i+=3){
    const x=raw[i],y=raw[i+1],z=raw[i+2];
    if(x<minX)minX=x;if(y<minY)minY=y;if(z<minZ)minZ=z;
    if(x>maxX)maxX=x;if(y>maxY)maxY=y;if(z>maxZ)maxZ=z;
  }
  const cx=(minX+maxX)/2,cy=(minY+maxY)/2,cz=(minZ+maxZ)/2;
  const centered=new Float32Array(raw.length);
  for(let i=0;i<raw.length;i+=3){
    centered[i]=raw[i]-cx;centered[i+1]=raw[i+1]-cy;centered[i+2]=raw[i+2]-cz;
  }
  return {
    positions:centered,
    colors:attributes.colors||null,
    intensities:attributes.intensities||null,
    classifications:attributes.classifications||null,
    sampled_points:raw.length/3,
    bounds:{min:[minX,minY,minZ],max:[maxX,maxY,maxZ],center:[cx,cy,cz]},
    metadata
  };
}

export async function parseXyzFile(file,{maxPoints=250000}={}){
  const text=await file.text();
  const lines=text.split(/\r?\n/);
  const stride=Math.max(1,Math.ceil(lines.length/maxPoints));
  const raw=[],rgb=[],intensity=[];
  let valid=0,skipped=0,sampled=0,rgbSamples=0,intensitySamples=0;
  for(let i=0;i<lines.length;i++){
    const line=lines[i].trim();
    if(!line||line.startsWith("#")||line.startsWith("//"))continue;
    const parts=line.split(/[\s,;]+/).filter(Boolean);
    if(parts.length<3){skipped++;continue}
    const values=parts.map(Number);
    const x=values[0],y=values[1],z=values[2];
    if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z)){skipped++;continue}
    valid++;
    if(!(valid%stride===0||raw.length===0))continue;
    raw.push(x,y,z);sampled++;
    const hasRgb=values.length>=6&&values.slice(3,6).every(Number.isFinite);
    if(hasRgb){
      rgb.push(values[3],values[4],values[5]);rgbSamples++;
      const candidate=values[6];
      intensity.push(Number.isFinite(candidate)?candidate:0);
      if(Number.isFinite(candidate))intensitySamples++;
    }else{
      rgb.push(0,0,0);
      const candidate=values[3];
      intensity.push(Number.isFinite(candidate)?candidate:0);
      if(Number.isFinite(candidate))intensitySamples++;
    }
  }
  const colors=rgbSamples===sampled?normalizedRgb(rgb):null;
  const intensities=intensitySamples===sampled?Float32Array.from(intensity):null;
  return finishPositions(raw,{
    format:"xyz",
    total_valid_points:valid,
    invalid_or_skipped_lines:skipped,
    source_lines:lines.length,
    sampled:valid>sampled,
    has_rgb:!!colors,
    has_intensity:!!intensities,
    visual_channels:[
      ...(colors?["rgb"]:[]),
      ...(intensities?["intensity"]:[]),
      "elevation"
    ],
    rgb_semantics:colors?"per_point_color":"absent"
  },{colors,intensities});
}

function lasPointCount(view,versionMinor){
  const legacy=view.getUint32(107,true);
  if(versionMinor>=4&&view.byteLength>=255&&typeof view.getBigUint64==="function"){
    const extended=Number(view.getBigUint64(247,true));
    if(Number.isSafeInteger(extended)&&extended>0)return extended;
  }
  return legacy;
}

function lasRgbOffset(pointFormat){
  if(pointFormat===2)return 20;
  if(pointFormat===3||pointFormat===5)return 28;
  if(pointFormat===7||pointFormat===8||pointFormat===10)return 30;
  return null;
}

export async function parseLasFile(file,{maxPoints=250000}={}){
  const buffer=await file.arrayBuffer();
  const view=new DataView(buffer);
  if(view.byteLength<227)throw new Error("Arquivo LAS menor que o cabeçalho mínimo.");
  const signature=String.fromCharCode(...new Uint8Array(buffer,0,4));
  if(signature!=="LASF")throw new Error("Assinatura LASF não encontrada.");
  const versionMajor=view.getUint8(24),versionMinor=view.getUint8(25);
  const pointDataOffset=view.getUint32(96,true);
  const rawPointFormat=view.getUint8(104);
  const compressed=(rawPointFormat&0x80)!==0;
  const pointFormat=rawPointFormat&0x3f;
  if(compressed)throw new Error("LAS comprimido detectado. Use .las não comprimido; .laz será habilitado separadamente.");
  const recordLength=view.getUint16(105,true);
  const declaredCount=lasPointCount(view,versionMinor);
  if(!recordLength||pointDataOffset>=view.byteLength)throw new Error("Cabeçalho LAS inválido: offset/comprimento de registro.");
  const available=Math.floor((view.byteLength-pointDataOffset)/recordLength);
  const count=Math.min(declaredCount||available,available);
  if(count<1)throw new Error("LAS sem registros de pontos.");
  const sx=view.getFloat64(131,true),sy=view.getFloat64(139,true),sz=view.getFloat64(147,true);
  const ox=view.getFloat64(155,true),oy=view.getFloat64(163,true),oz=view.getFloat64(171,true);
  const stride=Math.max(1,Math.ceil(count/maxPoints));
  const raw=[],rgb=[],intensity=[],classification=[];
  const classes={};
  const rgbOffset=lasRgbOffset(pointFormat);
  let rgbSamples=0,intensityNonZero=0;
  for(let index=0;index<count;index+=stride){
    const p=pointDataOffset+index*recordLength;
    if(p+12>view.byteLength)break;
    const x=view.getInt32(p,true)*sx+ox;
    const y=view.getInt32(p+4,true)*sy+oy;
    const z=view.getInt32(p+8,true)*sz+oz;
    if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z))continue;
    raw.push(x,y,z);
    const signal=p+14<=view.byteLength?view.getUint16(p+12,true):0;
    intensity.push(signal);if(signal>0)intensityNonZero++;
    const classOffset=pointFormat<=5?15:16;
    let code=0;
    if(p+classOffset<view.byteLength){
      code=view.getUint8(p+classOffset);
      if(pointFormat<=5)code&=0x1f;
      classes[code]=(classes[code]||0)+1;
    }
    classification.push(code);
    if(rgbOffset!=null&&p+rgbOffset+6<=view.byteLength){
      const r=view.getUint16(p+rgbOffset,true),g=view.getUint16(p+rgbOffset+2,true),b=view.getUint16(p+rgbOffset+4,true);
      rgb.push(r,g,b);
      if(r||g||b)rgbSamples++;
    }else rgb.push(0,0,0);
  }
  const sampledPoints=raw.length/3;
  const colors=rgbOffset!=null&&rgbSamples>0?normalizedRgb(rgb):null;
  const intensities=intensityNonZero>0?Uint16Array.from(intensity):null;
  const classifications=classification.length===sampledPoints?Uint8Array.from(classification):null;
  return finishPositions(raw,{
    format:"las",
    las_version:`${versionMajor}.${versionMinor}`,
    point_format:pointFormat,
    record_length:recordLength,
    declared_point_count:declaredCount,
    readable_point_count:count,
    sampled:stride>1,
    sample_stride:stride,
    scale:[sx,sy,sz],
    offset:[ox,oy,oz],
    sampled_classification_counts:classes,
    has_rgb:!!colors,
    has_intensity:!!intensities,
    has_classification:!!classifications,
    visual_channels:[
      ...(colors?["rgb"]:[]),
      ...(intensities?["intensity"]:[]),
      ...(classifications?["classification"]:[]),
      "elevation"
    ],
    rgb_semantics:colors?"per_point_color":"absent",
    segmentation_guidance:colors
      ?"RGB por ponto disponível: apto para visualização fotométrica e fusão com os descritores geométricos do CDM-3."
      :"RGB ausente no LAS: limitar segmentação browser a geometria/intensidade/classificação; patologias visuais exigem imagem registrada ou nuvem colorizada."
  },{colors,intensities,classifications});
}

function ifcSchema(text){
  const m=text.match(/FILE_SCHEMA\s*\(\s*\(\s*['"]([^'"]+)/i);
  return m?.[1]||null;
}

export async function parseIfcFile(file,{maxPoints=250000}={}){
  const text=await file.text();
  if(!/ISO-10303-21/i.test(text)&&!/IFC/i.test(text.slice(0,4096)))throw new Error("Cabeçalho IFC/STEP não reconhecido.");
  const entityCounts={};
  let entityTotal=0;
  const entityRe=/#\d+\s*=\s*(IFC[A-Z0-9_]+)/gi;
  let match;
  while((match=entityRe.exec(text))){
    const type=match[1].toUpperCase();
    entityCounts[type]=(entityCounts[type]||0)+1;entityTotal++;
  }
  const raw=[];
  const pointRe=/IFCCARTESIANPOINT\s*\(\s*\(\s*([^\)]{1,256})\)\s*\)/gi;
  let pointCount=0;
  while((match=pointRe.exec(text))){
    const values=match[1].split(",").map(v=>Number(String(v).replace(/[()]/g,"").trim()));
    if(values.length<2||!Number.isFinite(values[0])||!Number.isFinite(values[1]))continue;
    pointCount++;
    if(raw.length/3>=maxPoints)continue;
    raw.push(values[0],values[1],Number.isFinite(values[2])?values[2]:0);
  }
  if(!raw.length){
    const listRe=/IFCCARTESIANPOINTLIST3D\s*\(\s*\((.*?)\)\s*\)/gis;
    const list=listRe.exec(text)?.[1]||"";
    const tripleRe=/\(\s*(-?\d+(?:\.\d+)?(?:[Ee][+-]?\d+)?)\s*,\s*(-?\d+(?:\.\d+)?(?:[Ee][+-]?\d+)?)\s*,\s*(-?\d+(?:\.\d+)?(?:[Ee][+-]?\d+)?)\s*\)/g;
    while((match=tripleRe.exec(list))&&raw.length/3<maxPoints){
      raw.push(Number(match[1]),Number(match[2]),Number(match[3]));pointCount++;
    }
  }
  const topEntities=Object.entries(entityCounts).sort((a,b)=>b[1]-a[1]).slice(0,20);
  const structural={};
  for(const key of ["IFCBRIDGE","IFCBRIDGEPART","IFCSLAB","IFCBEAM","IFCCOLUMN","IFCMEMBER","IFCPLATE","IFCWALL","IFCFOOTING","IFCPILE"]){
    if(entityCounts[key])structural[key]=entityCounts[key];
  }
  return finishPositions(raw,{
    format:"ifc",
    schema:ifcSchema(text),
    entity_count:entityTotal,
    cartesian_point_count:pointCount,
    top_entity_counts:Object.fromEntries(topEntities),
    structural_entity_counts:structural,
    has_rgb:false,
    visual_channels:["elevation"],
    preview_note:"Prévia browser baseada em pontos cartesianos IFC; resolução semântica/geometria final ocorre no pipeline CDM-3/IfcOpenShell."
  });
}

export async function parseSpatialAsset(file,options={}){
  const ext=spatialExtension(file);
  if(ext==="las")return parseLasFile(file,options);
  if(ext==="xyz")return parseXyzFile(file,options);
  if(ext==="ifc")return parseIfcFile(file,options);
  throw new Error("Formato espacial CDM-3 não reconhecido.");
}
