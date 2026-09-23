import asyncio,io,os,time
from fastapi import FastAPI,File,Form,HTTPException,Request,UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image
from .registry import REGISTRY
from .schemas import EngineInfo
from . import cdm_v285

app=FastAPI(title="SHM Standalone Engine API",version="1.0.0")
_origins=[x.strip().rstrip("/") for x in os.getenv(
    "STANDALONE_CORS_ORIGINS",
    "https://aaronkadima.github.io,http://localhost:5173,http://127.0.0.1:5173"
).split(",") if x.strip()]
app.add_middleware(CORSMiddleware,allow_origins=_origins,allow_credentials=False,allow_methods=["GET","POST","OPTIONS"],allow_headers=["*"])

@app.middleware("http")
async def private_network_header(request:Request,call_next):
    response=await call_next(request)
    if request.method=="OPTIONS" or request.headers.get("access-control-request-private-network")=="true":
        response.headers["Access-Control-Allow-Private-Network"]="true"
    return response

LOCKED_ENGINE=os.getenv("SHM_ENGINE_ID","").strip()
MAX_UPLOAD_MB=float(os.getenv("SHM_MAX_UPLOAD_MB","20"))
MAX_SIDE=int(os.getenv("SHM_MAX_IMAGE_SIDE","1600"))

def _info(e):
    ready,reason=e.availability()
    return EngineInfo(
        id=e.meta.id,name=e.meta.name,family=e.meta.family,task=e.meta.task,
        description=e.meta.description,ready=ready,reason=reason,
        requires_weights=e.meta.requires_weights,recommended=e.meta.recommended,
        domain_mode=e.meta.domain_mode,source_url=e.meta.source_url,license=e.meta.license
    )

@app.get("/")
def root():
    return {"name":"SHM Standalone Engine API","role":"standalone","locked_engine":LOCKED_ENGINE or None,"docs":"/docs"}

@app.get("/health")
def health():
    if LOCKED_ENGINE:
        e=REGISTRY.get(LOCKED_ENGINE)
        if not e:
            return JSONResponse(status_code=503,content={"status":"error","role":"standalone","reason":"SHM_ENGINE_ID desconhecido"})
        ready,reason=e.availability()
        return {"status":"ok" if ready else "degraded","role":"standalone","engine_id":LOCKED_ENGINE,"ready":ready,"reason":reason}
    return {"status":"ok","role":"standalone","engine_count":len(REGISTRY)}

@app.get("/engines",response_model=list[EngineInfo])
def engines():
    if LOCKED_ENGINE:
        e=REGISTRY.get(LOCKED_ENGINE)
        return [_info(e)] if e else []
    return [_info(e) for e in REGISTRY.values()]

@app.post("/infer")
async def infer(file:UploadFile=File(...),engine_id:str=Form(...),
                cdm_threshold:int=Form(35),cdm_kernel_size:int=Form(15),
                cdm_min_area:float=Form(30),cdm_min_aspect_ratio:float=Form(2.0)):
    if LOCKED_ENGINE and engine_id!=LOCKED_ENGINE:
        raise HTTPException(403,f"Este backend está bloqueado no motor {LOCKED_ENGINE}.")
    e=REGISTRY.get(engine_id)
    if not e:
        raise HTTPException(404,"Motor não encontrado.")
    ready,reason=e.availability()
    if not ready:
        raise HTTPException(409,reason or "Motor indisponível neste ambiente.")
    raw=await file.read()
    if len(raw)>MAX_UPLOAD_MB*1024*1024:
        raise HTTPException(413,f"Arquivo excede {MAX_UPLOAD_MB:g} MB")
    try:
        image=Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:
        raise HTTPException(400,"Imagem inválida: "+str(exc))
    if max(image.size)>MAX_SIDE:
        image.thumbnail((MAX_SIDE,MAX_SIDE),Image.Resampling.LANCZOS)
    if engine_id=="cdm_1":
        if not (1<=cdm_threshold<=255 and 3<=cdm_kernel_size<=99 and 1<=cdm_min_area<=1_000_000 and 1<=cdm_min_aspect_ratio<=50):
            raise HTTPException(422,"Parâmetros CDM-1 fora das faixas permitidas.")
        cfg=cdm_v285.DetectorConfig(threshold=cdm_threshold,kernel_size=cdm_kernel_size,
                                    min_area=cdm_min_area,min_aspect_ratio=cdm_min_aspect_ratio)
        started=time.perf_counter()
        result=await asyncio.to_thread(e.predict_configured,image.copy(),cfg)
        result.latency_ms=(time.perf_counter()-started)*1000
        from .taxonomy import apply_taxonomy
        result=apply_taxonomy(result)
    else:
        result=await asyncio.to_thread(e.run,image.copy())
    return {"role":"standalone","image_width":image.width,"image_height":image.height,"result":result.model_dump()}
