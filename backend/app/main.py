from __future__ import annotations

import asyncio
import json

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .engines.registry import get_registry
from .imaging import decode_image
from .schemas import AnalysisResponse, EngineInfo, EngineResult

app = FastAPI(
    title="SHM Multi-Engine Lab API",
    version="0.1.0",
    description="Unified visual pathology inference API for multi-engine SHM comparison.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "shm-multi-engine-lab"}


@app.get("/api/engines", response_model=list[EngineInfo])
def engines():
    return get_registry().infos()


@app.post("/api/analyze", response_model=AnalysisResponse)
async def analyze(
    file: UploadFile = File(...),
    engine_ids: str | None = Form(None),
    confidence: float = Form(0.25),
):
    if not 0.0 <= confidence <= 1.0:
        raise HTTPException(status_code=422, detail="confidence must be between 0 and 1")

    raw = await file.read()
    if len(raw) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File exceeds {settings.max_upload_mb} MB")

    try:
        image = decode_image(raw)
    except Exception as exc:
        raise HTTPException(status_code=415, detail=f"Invalid image: {exc}") from exc

    registry = get_registry()
    if engine_ids:
        try:
            requested = json.loads(engine_ids)
            if not isinstance(requested, list):
                raise ValueError
            requested = [str(x) for x in requested]
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="engine_ids must be a JSON array") from exc
    else:
        requested = [
            info.id
            for info in registry.infos()
            if info.availability == "ready"
        ]

    unknown = sorted(set(requested) - set(registry.ids()))
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown engines: {', '.join(unknown)}")

    semaphore = asyncio.Semaphore(settings.engine_concurrency)

    async def run(engine_id: str) -> EngineResult:
        async with semaphore:
            engine = registry.get(engine_id)
            return await asyncio.to_thread(engine.predict, image.copy(), confidence)

    results = await asyncio.gather(*(run(engine_id) for engine_id in requested))

    warnings = [
        "Visual side-by-side output is not an accuracy ranking.",
        "Only models trained/fine-tuned and validated on the target pathology taxonomy should be used for quantitative SHM decisions.",
    ]
    return AnalysisResponse(
        filename=file.filename or "image",
        width=image.width,
        height=image.height,
        engines_requested=requested,
        results=list(results),
        warnings=warnings,
    )
