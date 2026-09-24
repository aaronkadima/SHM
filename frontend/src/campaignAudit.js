export const CHAIN_STATUS_LABELS={
  continuous:"contínua",
  branch:"ramificação",
  materialized_origin:"t0 materializado",
  external_reference:"t0 externo",
  legacy_unlinked:"vínculo legado",
  missing_origin:"origem ausente",
  invalid_order:"ordem inválida",
  baseline:"linha de base",
  snapshot:"snapshot"
};

export function campaignChainAudit(group){
  const items=[...(group?.items||[])].sort((a,b)=>new Date(a.created_at||0)-new Date(b.created_at||0));
  const byId=new Map(items.map((item,index)=>[item.id,{item,index}]));
  const edges=[];
  const counts={continuous:0,branch:0,materialized_origin:0,external_reference:0,legacy_unlinked:0,missing_origin:0,invalid_order:0,baseline:0,snapshot:0,hash_mismatch:0,hash_unknown:0};

  for(let i=0;i<items.length;i++){
    const item=items[i],temporal=item.summary?.temporal_comparison===true;
    const activeRef=item.reference_inspection_id||item.summary?.reference_inspection_id||null;
    const originRef=item.reference_origin_inspection_id||item.summary?.reference_origin_inspection_id||activeRef||null;
    const storage=item.summary?.reference_storage||null;
    const expectedPreviousId=i>0?items[i-1].id:null;
    let status="snapshot",referenceIndex=null,contentIntegrity="not_applicable",sourceImageSha256=null,referenceImageSha256=item.summary?.reference_image_sha256||null;

    if(!temporal){
      status=i===0?"baseline":"snapshot";
    }else if(originRef){
      const ref=byId.get(originRef);
      if(ref){
        referenceIndex=ref.index;
        sourceImageSha256=ref.item.summary?.image_sha256||null;
        if(sourceImageSha256&&referenceImageSha256){
          contentIntegrity=sourceImageSha256===referenceImageSha256?"verified":"mismatch";
          if(contentIntegrity==="mismatch")counts.hash_mismatch++;
        }else{
          contentIntegrity="unknown";
          counts.hash_unknown++;
        }
        if(ref.index===i-1)status="continuous";
        else if(ref.index<i-1)status="branch";
        else status="invalid_order";
      }else if(storage==="materialized_history"){
        status="materialized_origin";
      }else{
        status="missing_origin";
      }
    }else if(item.summary?.has_reference_image){
      status="external_reference";
    }else{
      status="legacy_unlinked";
    }

    counts[status]=(counts[status]||0)+1;
    edges.push({
      inspection_id:item.id,
      created_at:item.created_at,
      temporal,
      status,
      label:CHAIN_STATUS_LABELS[status]||status,
      expected_previous_id:expectedPreviousId,
      active_reference_id:activeRef,
      origin_reference_id:originRef,
      reference_index:referenceIndex,
      reference_storage:storage,
      content_integrity:contentIntegrity,
      source_image_sha256:sourceImageSha256,
      reference_image_sha256:referenceImageSha256,
      quality_status:item.summary?.temporal_quality?.status||null,
      quality_validated:item.summary?.temporal_quality?.validated===true
    });
  }

  const hard=counts.missing_origin+counts.invalid_order+counts.hash_mismatch;
  const warnings=counts.branch+counts.materialized_origin+counts.external_reference+counts.legacy_unlinked+counts.hash_unknown;
  const status=hard>0?"fail":warnings>0?"warning":"pass";
  return {status,counts,hard_issues:hard,warnings,edges};
}
