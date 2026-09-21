const DB_NAME="shm-oae-brasil";
const DB_VERSION=1;
const STORE="inspections";
const MAX_RECORDS=75;

function openDb(){
  return new Promise((resolve,reject)=>{
    if(!("indexedDB" in window)){reject(new Error("IndexedDB não está disponível neste navegador."));return}
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onerror=()=>reject(req.error||new Error("Falha ao abrir o banco local."));
    req.onsuccess=()=>resolve(req.result);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(STORE)){
        const store=db.createObjectStore(STORE,{keyPath:"id"});
        store.createIndex("created_at","created_at",{unique:false});
        store.createIndex("oae_id","inspection.oae_id",{unique:false});
        store.createIndex("element_id","inspection.element_id",{unique:false});
      }
    };
  });
}
function txDone(tx){
  return new Promise((resolve,reject)=>{
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error||new Error("Falha na transação local."));
    tx.onabort=()=>reject(tx.error||new Error("Transação local cancelada."));
  });
}
function totalDetections(result){
  return (result?.results||[]).reduce((n,r)=>n+(r.detections?.length||0),0);
}
function toSummary(record){
  return {
    id:record.id,
    created_at:record.created_at,
    updated_at:record.updated_at,
    inspection:record.inspection||{},
    file_meta:record.file_meta||{},
    summary:record.summary||{}
  };
}
async function prune(){
  const db=await openDb();
  const tx=db.transaction(STORE,"readwrite");
  const store=tx.objectStore(STORE);
  const idx=store.index("created_at");
  let seen=0;
  idx.openCursor(null,"prev").onsuccess=e=>{
    const cursor=e.target.result;
    if(!cursor)return;
    seen++;
    if(seen>MAX_RECORDS)store.delete(cursor.primaryKey);
    cursor.continue();
  };
  await txDone(tx);
  db.close();
}
export async function requestPersistentStorage(){
  try{
    if(navigator.storage?.persist)return await navigator.storage.persist();
  }catch{}
  return false;
}
export async function saveInspection({result,file,inspection}){
  if(!result)throw new Error("Resultado ausente.");
  const now=new Date().toISOString();
  const id=String(result.metadata?.analysis_id||("inspection-"+crypto.randomUUID()));
  const created_at=result.metadata?.generated_at||now;
  const record={
    id,
    created_at,
    updated_at:now,
    inspection:{...inspection},
    file_meta:file?{name:file.name,type:file.type,size:file.size,lastModified:file.lastModified}: {},
    image_blob:file||null,
    result,
    summary:{
      mode:result.metadata?.mode||"unknown",
      engine_ids:result.metadata?.engine_ids||[],
      engines_total:(result.results||[]).length,
      engines_ok:(result.results||[]).filter(r=>r.status==="ok").length,
      engines_failed:(result.results||[]).filter(r=>r.status!=="ok").length,
      detections:totalDetections(result),
      image_width:result.image_width||null,
      image_height:result.image_height||null,
      consensus_classes:Object.keys(result.consensus||{}).length
    }
  };
  const db=await openDb();
  const tx=db.transaction(STORE,"readwrite");
  tx.objectStore(STORE).put(record);
  await txDone(tx);
  db.close();
  await prune();
  return toSummary(record);
}
export async function listInspectionSummaries(limit=75){
  const db=await openDb();
  const tx=db.transaction(STORE,"readonly");
  const store=tx.objectStore(STORE);
  const idx=store.index("created_at");
  const out=[];
  await new Promise((resolve,reject)=>{
    const req=idx.openCursor(null,"prev");
    req.onerror=()=>reject(req.error||new Error("Falha ao listar histórico."));
    req.onsuccess=e=>{
      const cursor=e.target.result;
      if(!cursor||out.length>=limit){resolve();return}
      out.push(toSummary(cursor.value));
      cursor.continue();
    };
  });
  await txDone(tx);
  db.close();
  return out;
}
export async function getInspection(id){
  const db=await openDb();
  const tx=db.transaction(STORE,"readonly");
  const req=tx.objectStore(STORE).get(id);
  const record=await new Promise((resolve,reject)=>{
    req.onsuccess=()=>resolve(req.result||null);
    req.onerror=()=>reject(req.error||new Error("Falha ao abrir inspeção."));
  });
  await txDone(tx);
  db.close();
  return record;
}
export async function deleteInspection(id){
  const db=await openDb();
  const tx=db.transaction(STORE,"readwrite");
  tx.objectStore(STORE).delete(id);
  await txDone(tx);
  db.close();
}
export async function clearInspections(){
  const db=await openDb();
  const tx=db.transaction(STORE,"readwrite");
  tx.objectStore(STORE).clear();
  await txDone(tx);
  db.close();
}
