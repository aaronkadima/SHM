from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    max_upload_mb: int = int(os.getenv("MAX_UPLOAD_MB", "25"))
    engine_concurrency: int = max(1, int(os.getenv("ENGINE_CONCURRENCY", "2")))
    model_dir: Path = Path(os.getenv("MODEL_DIR", "models"))
    cors_origins: tuple[str, ...] = tuple(
        x.strip()
        for x in os.getenv(
            "CORS_ORIGINS", "http://localhost:5173,http://localhost:8080"
        ).split(",")
        if x.strip()
    )
    hf_allow_download: bool = _bool("HF_ALLOW_DOWNLOAD", True)


settings = Settings()
