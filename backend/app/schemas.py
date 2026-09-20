from pydantic import BaseModel, Field
from typing import Literal

Task=Literal["detection","instance_segmentation","semantic_segmentation","open_vocabulary","anomaly","classical"]

class Detection(BaseModel):
    label:str
    canonical_label:str|None=None
    score:float=1.0
    box:list[float]|None=None
    polygon:list[list[float]]|None=None
    area_px:float|None=None

class EngineInfo(BaseModel):
    id:str
    name:str
    family:str
    task:Task
    description:str
    ready:bool
    reason:str|None=None
    requires_weights:bool=False
    recommended:bool=False
    domain_mode:str="generic"
    source_url:str|None=None
    license:str|None=None

class EngineResult(BaseModel):
    engine_id:str
    name:str
    task:Task
    status:Literal["ok","missing_dependency","missing_weights","error","skipped"]
    latency_ms:float=0.0
    detections:list[Detection]=Field(default_factory=list)
    overlay_png_base64:str|None=None
    metrics:dict=Field(default_factory=dict)
    message:str|None=None

class CompareResponse(BaseModel):
    image_width:int
    image_height:int
    results:list[EngineResult]
    consensus:dict=Field(default_factory=dict)
    spatial_consensus:list[dict]=Field(default_factory=list)
    consensus_overlay_png_base64:str|None=None
    metadata:dict=Field(default_factory=dict)
