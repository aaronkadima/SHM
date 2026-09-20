import asyncio,io,os,shutil,time
from fastapi import FastAPI,File,Form,HTTPException,UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from .registry import REGISTRY
from .schemas import CompareResponse,EngineInfo
from .taxonomy import build_consensus
from .spatial_consensus import build_spatial_consensus,render_spatial_consensus

app=FastAPI(title="SHM Vision Lab API",version="0.8.1")
_default_origins="http://localhost:5173,https://aaronkadima.github.io"
_origins=[x.strip().rstrip("/") for x in os.getenv("CORS_ORIGINS",_default_origins).split(",") if x.strip()]
app.add_middleware(CORSMiddleware,allow_origins=_origins,allow_credentials=False,allow_methods=["GET","POST","OPTIONS"],allow_headers=["*"])
MAX_UPLOAD_MB=float(os.getenv("SHM_MAX_UPLOAD_MB","20"));MAX_SIDE=int(os.getenv("SHM_MAX_IMAGE_SIDE","1600"))
MAX_PARALLEL=max(1,int(os.getenv("SHM_MAX_PARALLEL_ENGINES","1")));_engine_sem=asyncio.Semaphore(MAX_PARALLEL)
WARMUP_STATUS={"state":"disabled","started_at":None,"finished_at":None,"engines":{}}

def _truthy(name,default="0"):
    return os.getenv(name,default).lower() in {"1","true","yes","on"}

async def _warmup_compact_engines():
    global WARMUP_STATUS
    WARMUP_STATUS={"state":"running","started_at":time.time(),"finished_at":None,"engines":{}}
    await asyncio.sleep(float(os.getenv("SHM_PREWARM_DELAY_SECONDS","3")))
    probe=Image.new("RGB",(320,320),(145,145,145))
    candidates=[e for e in REGISTRY.values() if e.meta.domain_mode=="public_shm_checkpoint" and e.availability()[0]]
    for e in candidates:
        started=time.perf_counter()
        try:
            result=await asyncio.to_thread(e.run,probe.copy())
            WARMUP_STATUS["engines"][e.meta.id]={
                "status":result.status,
                "latency_ms":round((time.perf_counter()-started)*1000,1),
                "message":result.message,
            }
            print(f"[warmup] {e.meta.id}: {result.status}",flush=True)
        except Exception as exc:
            WARMUP_STATUS["engines"][e.meta.id]={
                "status":"error","latency_ms":round((time.perf_counter()-started)*1000,1),"message":f"{type(exc).__name__}: {exc}"
            }
            print(f"[warmup] {e.meta.id}: ERROR {type(exc).__name__}: {exc}",flush=True)
    statuses=[x["status"] for x in WARMUP_STATUS["engines"].values()]
    WARMUP_STATUS["state"]="ok" if statuses and all(x=="ok" for x in statuses) else ("partial" if statuses else "empty")
    WARMUP_STATUS["finished_at"]=time.time()
    print(f"[warmup] completed state={WARMUP_STATUS['state']} engines={len(statuses)}",flush=True)

@app.on_event("startup")
async def startup_event():
    if _truthy("SHM_PREWARM_RECOMMENDED","0"):
        asyncio.create_task(_warmup_compact_engines())

@app.get("/")
def root():return {"name":"SHM Vision Lab API","status":"online","docs":"/docs","version":"0.8.1"}
@app.get("/health")
def health():
    ready=sum(1 for e in REGISTRY.values() if e.availability()[0])
    return {"status":"ok","engines":len(REGISTRY),"ready":ready,"max_parallel_engines":MAX_PARALLEL,"warmup":WARMUP_STATUS["state"]}
@app.get("/warmup-status")
def warmup_status():return WARMUP_STATUS
@app.get("/storage")
def storage():
    path=os.getenv("SHM_COMPACT_MODEL_CACHE","/models/compact");base="/models" if os.path.exists("/models") else "/"
    usage=shutil.disk_usage(base)
    return {"path":path,"volume_root":base,"total_mb":round(usage.total/1024/1024,1),
        "used_mb":round(usage.used/1024/1024,1),"free_mb":round(usage.free/1024/1024,1)}
@app.get("/status")
def status():
    rows=[]
    for e in REGISTRY.values():
        ready,reason=e.availability();rows.append({"id":e.meta.id,"ready":ready,"reason":reason,"recommended":e.meta.recommended,"domain_mode":e.meta.domain_mode})
    return {"engines":rows,"max_upload_mb":MAX_UPLOAD_MB,"max_image_side":MAX_SIDE,"max_parallel_engines":MAX_PARALLEL,"warmup":WARMUP_STATUS}
@app.get("/engines",response_model=list[EngineInfo])
def engines():
    out=[]
    for e in REGISTRY.values():
        ready,reason=e.availability()
        out.append(EngineInfo(id=e.meta.id,name=e.meta.name,family=e.meta.family,task=e.meta.task,description=e.meta.description,
            ready=ready,reason=reason,requires_weights=e.meta.requires_weights,recommended=e.meta.recommended,
            domain_mode=e.meta.domain_mode,source_url=e.meta.source_url,license=e.meta.license))
    return out
@app.post("/compare",response_model=CompareResponse)
async def compare(file:UploadFile=File(...),engines:str=Form("recommended")):
    raw=await file.read()
    if len(raw)>MAX_UPLOAD_MB*1024*1024:raise HTTPException(413,f"Arquivo excede {MAX_UPLOAD_MB:g} MB")
    try:image=Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as e:raise HTTPException(400,"Imagem inválida: "+str(e))
    if max(image.size)>MAX_SIDE:image.thumbnail((MAX_SIDE,MAX_SIDE),Image.Resampling.LANCZOS)
    if engines=="all":ids=list(REGISTRY)
    elif engines=="recommended":ids=[k for k,e in REGISTRY.items() if e.meta.recommended and e.availability()[0]]
    else:ids=[x.strip() for x in engines.split(",") if x.strip()]
    unknown=[x for x in ids if x not in REGISTRY]
    if unknown:raise HTTPException(400,"Motores desconhecidos: "+str(unknown))
    async def one(i):
        async with _engine_sem:return await asyncio.to_thread(REGISTRY[i].run,image.copy())
    results=await asyncio.gather(*(one(i) for i in ids))
    spatial=build_spatial_consensus(results,float(os.getenv("SHM_CONSENSUS_IOU","0.25")))
    overlay=render_spatial_consensus(image,spatial) if spatial else None
    return CompareResponse(image_width=image.width,image_height=image.height,results=results,consensus=build_consensus(results),spatial_consensus=spatial,consensus_overlay_png_base64=overlay)
