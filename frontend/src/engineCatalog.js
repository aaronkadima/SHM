export function engineRank(engine){
  if(engine?.id==="cdm_1")return 0;
  if(engine?.catalog_owned===true)return 1;
  if(engine?.catalog_visibility==="always")return 2;
  if(engine?.browser_ready===true)return 3;
  if(engine?.recommended===true)return 4;
  return 5;
}

export function sortEngines(engines=[]){
  return [...engines].sort((a,b)=>engineRank(a)-engineRank(b)||(a.name||a.id||"").localeCompare(b.name||b.id||"","pt-BR"));
}

export function engineMatchesFilter(engine,filter="all"){
  if(filter==="all")return true;
  if(filter==="owned")return engine?.catalog_owned===true;
  if(filter==="recommended")return engine?.recommended===true;
  if(filter==="verified")return engine?.cloud_verified===true;
  if(filter==="browser")return engine?.browser_ready===true;
  if(filter==="public")return engine?.domain_mode==="public_shm_checkpoint";
  if(filter==="optional")return ["optional_runtime","shm_checkpoint","generic_pretrained"].includes(engine?.domain_mode);
  return true;
}

export function engineMatchesQuery(engine,query=""){
  const q=String(query||"").trim().toLowerCase();
  if(!q)return true;
  return [engine?.name,engine?.family,engine?.task,engine?.description,engine?.domain_mode,engine?.catalog_group]
    .filter(Boolean).join(" ").toLowerCase().includes(q);
}
