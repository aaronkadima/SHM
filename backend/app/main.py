import asyncio,io,os
from fastapi import FastAPI,File,Form,HTTPException,UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from .registry import REGISTRY
from .schemas import CompareResponse,EngineInfo

app=FastAPI(title="SHM Vision Lab API",version="0.4.0")
_default_origins="http://localhost:5173,https://aaronkadima.github.io"
_origins=[x.strip().rstrip("/") for x in os.getenv("CORS_ORIGINS",_default_origins).split(",") if x.strip()]
app.add_middleware(CORSMiddleware,allow_origins=_origins,allow_credentials=False,allow_methods=["GET","POST","OPTIONS"],allow_headers=["*"])
MAX_UPLOAD_MB=float(os.getenv("SHM_MAX_UPLOAD_MB","20")); MAX_SIDE=int(os.getenv("SHM_MAX_IMAGE_SIDE","1600"))
MAX_PARALLEL=max(1,int(os.getenv("SHM_MAX_PARALLEL_ENGINES","1"))); _engine_sem=asyncio.Semaphore(MAX_PARALLEL)

@app.get("/")
def root(): return {"name":"SHM Vision Lab API","status":"online","docs":"/docs","version":"0.4.0"}
@app.get("/health")
def health():
    ready=sum(1 for e in REGISTRY.values() if e.availability()[0])
    return {"status":"ok","engines":len(REGISTRY),"ready":ready,"max_parallel_engines":MAX_PARALLEL}
@app.get("/status")
def status():
    rows=[]
    for e in REGISTRY.values():
        ready,reason=e.availability(); rows.append({"id":e.meta.id,"ready":ready,"reason":reason,"recommended":e.meta.recommended,"domain_mode":e.meta.domain_mode})
    return {"engines":rows,"max_upload_mb":MAX_UPLOAD_MB,"max_image_side":MAX_SIDE,"max_parallel_engines":MAX_PARALLEL}
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
    if len(raw)>MAX_UPLOAD_MB*1024*1024: raise HTTPException(413,f"Arquivo excede {MAX_UPLOAD_MB:g} MB")
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
    return CompareResponse(image_width=image.width,image_height=image.height,results=await asyncio.gather(*(one(i) for i in ids)))
