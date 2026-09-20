import asyncio,io,os
from fastapi import FastAPI,File,Form,HTTPException,UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from .registry import REGISTRY
from .schemas import CompareResponse,EngineInfo
app=FastAPI(title="SHM Vision Lab API",version="0.1.0")
app.add_middleware(CORSMiddleware,allow_origins=[x.strip() for x in os.getenv("CORS_ORIGINS","http://localhost:5173").split(",")],allow_credentials=True,allow_methods=["*"],allow_headers=["*"])
@app.get("/health")
def health(): return {"status":"ok","engines":len(REGISTRY)}
@app.get("/engines",response_model=list[EngineInfo])
def engines():
    out=[]
    for e in REGISTRY.values():
        ready,reason=e.availability(); out.append(EngineInfo(id=e.meta.id,name=e.meta.name,family=e.meta.family,task=e.meta.task,description=e.meta.description,ready=ready,reason=reason,requires_weights=e.meta.requires_weights))
    return out
@app.post("/compare",response_model=CompareResponse)
async def compare(file:UploadFile=File(...),engines:str=Form("all")):
    try: image=Image.open(io.BytesIO(await file.read())).convert("RGB")
    except Exception as e: raise HTTPException(400,"Imagem inválida: "+str(e))
    ids=list(REGISTRY) if engines=="all" else [x.strip() for x in engines.split(",") if x.strip()]
    unknown=[x for x in ids if x not in REGISTRY]
    if unknown: raise HTTPException(400,"Motores desconhecidos: "+str(unknown))
    async def one(i): return await asyncio.to_thread(REGISTRY[i].run,image.copy())
    return CompareResponse(image_width=image.width,image_height=image.height,results=await asyncio.gather(*(one(i) for i in ids)))
