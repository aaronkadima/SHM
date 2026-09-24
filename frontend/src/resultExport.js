function csvCell(value){
  const text=value==null?"":String(value);
  return '"'+text.replaceAll('"','""')+'"';
}

export function buildComparisonCsv(res){
  const analysisElapsedMs=Number(res?.metadata?.client_elapsed_ms);
  const measured=Number.isFinite(analysisElapsedMs)?analysisElapsedMs:"";
  const rows=[["engine","status","latency_ms","analysis_elapsed_ms","detections","label","canonical_label","score","x1","y1","x2","y2","area_px"]];
  for(const result of res?.results||[]){
    if(!result.detections?.length){
      rows.push([result.name,result.status,result.latency_ms,measured,0,"","","","","","","",""]);
      continue;
    }
    for(const detection of result.detections){
      const box=detection.box||[];
      rows.push([
        result.name,result.status,result.latency_ms,measured,result.detections.length,
        detection.label,detection.canonical_label||"",detection.score,
        box[0],box[1],box[2],box[3],detection.area_px
      ]);
    }
  }
  return "\uFEFF"+rows.map(row=>row.map(csvCell).join(",")).join("\n");
}
