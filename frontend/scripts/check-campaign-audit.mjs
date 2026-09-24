import {campaignChainAudit} from "../src/campaignAudit.js";

const failures=[];
const check=(ok,message)=>{if(!ok)failures.push(message)};
const row=(id,day,opts={})=>{
  const ref=opts.reference_inspection_id||opts.reference_origin_inspection_id||null;
  return {
    id,
    created_at:`2026-09-${String(day).padStart(2,"0")}T12:00:00Z`,
    reference_inspection_id:opts.reference_inspection_id||null,
    reference_origin_inspection_id:opts.reference_origin_inspection_id||null,
    summary:{
      temporal_comparison:!!opts.temporal,
      has_reference_image:!!opts.has_reference_image,
      reference_inspection_id:opts.reference_inspection_id||null,
      reference_origin_inspection_id:opts.reference_origin_inspection_id||null,
      reference_storage:opts.reference_storage||null,
      image_sha256:opts.image_sha256===undefined?"hash-"+id:opts.image_sha256,
      reference_image_sha256:opts.reference_image_sha256===undefined?(ref?"hash-"+ref:null):opts.reference_image_sha256,
      temporal_quality:opts.temporal?{status:"pass",validated:true}:null
    }
  };
};
const audit=items=>campaignChainAudit({items});

const continuous=audit([
  row("a",1),
  row("b",2,{temporal:true,reference_inspection_id:"a"}),
  row("c",3,{temporal:true,reference_inspection_id:"b"})
]);
check(continuous.status==="pass","continuous chain must pass");
check(continuous.counts.continuous===2,"continuous chain must contain 2 continuous edges");
check(continuous.edges[2].expected_previous_id==="b","expected predecessor for c must be b");
check(continuous.edges[2].content_integrity==="verified","continuous linked content hash must verify");

const hashMismatch=audit([
  row("a",1,{image_sha256:"hash-a"}),
  row("b",2,{temporal:true,reference_inspection_id:"a",reference_image_sha256:"tampered-hash"})
]);
check(hashMismatch.status==="fail","linked hash mismatch must fail");
check(hashMismatch.counts.hash_mismatch===1,"hash mismatch count must be 1");
check(hashMismatch.edges[1].content_integrity==="mismatch","hash mismatch edge must be marked mismatch");

const hashUnknown=audit([
  row("a",1,{image_sha256:null}),
  row("b",2,{temporal:true,reference_inspection_id:"a",reference_image_sha256:null})
]);
check(hashUnknown.status==="warning","legacy linked pair without hashes must warn");
check(hashUnknown.counts.hash_unknown===1,"hash unknown count must be 1");

const branch=audit([
  row("a",1),
  row("b",2,{temporal:true,reference_inspection_id:"a"}),
  row("c",3,{temporal:true,reference_inspection_id:"a"})
]);
check(branch.status==="warning","branch must warn");
check(branch.counts.branch===1,"branch count must be 1");

const external=audit([
  row("a",1),
  row("b",2,{temporal:true,has_reference_image:true})
]);
check(external.status==="warning","external reference must warn");
check(external.counts.external_reference===1,"external reference count must be 1");

const materialized=audit([
  row("b",2,{temporal:true,reference_origin_inspection_id:"deleted-a",reference_storage:"materialized_history"})
]);
check(materialized.status==="warning","materialized deleted origin must warn, not fail");
check(materialized.counts.materialized_origin===1,"materialized origin count must be 1");

const missing=audit([
  row("a",1),
  row("b",2,{temporal:true,reference_origin_inspection_id:"missing-a",reference_storage:"linked_inspection"})
]);
check(missing.status==="fail","missing linked origin must fail");
check(missing.counts.missing_origin===1,"missing origin count must be 1");

const invalidOrder=audit([
  row("a",1,{temporal:true,reference_inspection_id:"b"}),
  row("b",2)
]);
check(invalidOrder.status==="fail","future/self reference must fail");
check(invalidOrder.counts.invalid_order===1,"invalid order count must be 1");

const legacy=audit([
  row("a",1),
  row("b",2,{temporal:true})
]);
check(legacy.status==="warning","legacy unlinked temporal comparison must warn");
check(legacy.counts.legacy_unlinked===1,"legacy unlinked count must be 1");

const snapshot=audit([row("a",1),row("b",2)]);
check(snapshot.status==="pass","non-temporal snapshots must not fail chain audit");
check(snapshot.counts.baseline===1&&snapshot.counts.snapshot===1,"baseline/snapshot classification mismatch");

if(failures.length){
  console.error("Campaign chain audit failures:");
  for(const failure of failures)console.error(" - "+failure);
  process.exit(1);
}
console.log("Campaign chain audit passed.");
console.log(JSON.stringify({
  continuous:continuous.counts,
  branch:branch.counts,
  external:external.counts,
  materialized:materialized.counts,
  missing:missing.counts,
  invalidOrder:invalidOrder.counts,
  legacy:legacy.counts,
  hashMismatch:hashMismatch.counts,
  hashUnknown:hashUnknown.counts
},null,2));
