// Sólidos de nível salvos no navegador (IndexedDB), separados do histórico de inspeções.
// Cada registro guarda o necessário para reabrir sem refazer a análise: sólido em camadas, relevo, moldura da face,
// mapeamento foto ↔ face, potencial do walker (para consultar pontos), foto reduzida, IFC importado (quando houver)
// e uma miniatura da vista 3D.
const DB_NAME="shm-level-solids",DB_VERSION=1,STORE="solids",MAX_RECORDS=40;

function openDb(){
  return new Promise((resolve,reject)=>{
    if(!("indexedDB" in globalThis)){reject(new Error("IndexedDB não está disponível neste navegador."));return}
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onerror=()=>reject(req.error||new Error("Falha ao abrir o banco local."));
    req.onsuccess=()=>resolve(req.result);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE)){const st=db.createObjectStore(STORE,{keyPath:"id"});st.createIndex("created_at","created_at",{unique:false})}};
  });
}
const done=tx=>new Promise((res,rej)=>{tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error)});
const result=req=>new Promise((res,rej)=>{req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error)});

export async function saveLevelSolid(record){
  const db=await openDb();
  try{
    const id=record.id||("solid-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,7));
    const rec={...record,id,created_at:record.created_at||new Date().toISOString()};
    const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put(rec);await done(tx);
    // mantém os MAX_RECORDS mais recentes
    const all=await listLevelSolids(1000);if(all.length>MAX_RECORDS){const t2=db.transaction(STORE,"readwrite");for(const r of all.slice(MAX_RECORDS))t2.objectStore(STORE).delete(r.id);await done(t2)}
    return rec;
  }finally{db.close()}
}
// resumo (sem as geometrias) para a lista
export async function listLevelSolids(limit=40){
  const db=await openDb();
  try{
    const tx=db.transaction(STORE,"readonly"),all=await result(tx.objectStore(STORE).getAll());
    return all.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,limit)
      .map(r=>({id:r.id,name:r.name,created_at:r.created_at,mode:r.mode,style:r.params?.style,direction:r.params?.direction,schema:r.schema||r.ifc?.schema||null,
        image:r.image,thumbnail:r.thumbnail||null,regions:r.solid?.regions?.length||0,ifcName:r.ifc?.name||null}));
  }finally{db.close()}
}
export async function getLevelSolid(id){const db=await openDb();try{return await result(db.transaction(STORE,"readonly").objectStore(STORE).get(id))||null}finally{db.close()}}
export async function deleteLevelSolid(id){const db=await openDb();try{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).delete(id);await done(tx)}finally{db.close()}}
