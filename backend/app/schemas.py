from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class EngineInfo(BaseModel):
    id: str
    name: str
    family: str
    task: str
    backend: str
    adapter: str
    description: str
    strengths: str
    availability: Literal["ready", "requires_weights", "missing_dependency", "disabled"]
    status_reason: str | None = None
    requires_weights: bool = False
    pathology_ready: bool = False
    open_vocabulary: bool = False


class Detection(BaseModel):
    label: str
    raw_label: str | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    bbox: list[float] | None = None
    polygon: list[list[float]] | None = None
    area_px: float | None = None


class EngineResult(BaseModel):
    engine_id: str
    state: Literal["ok", "skipped", "error"]
    elapsed_ms: float = 0.0
    detections: list[Detection] = Field(default_factory=list)
    affected_area_percent: float | None = None
    overlay_base64: str | None = None
    note: str | None = None
    error: str | None = None


class AnalysisResponse(BaseModel):
    filename: str
    width: int
    height: int
    engines_requested: list[str]
    results: list[EngineResult]
    warnings: list[str] = Field(default_factory=list)
