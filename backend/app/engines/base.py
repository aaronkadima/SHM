from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from time import perf_counter

from PIL import Image

from ..schemas import EngineInfo, EngineResult


@dataclass(frozen=True)
class Probe:
    availability: str
    reason: str | None = None
    pathology_ready: bool = False


class Engine(ABC):
    def __init__(self, spec: dict):
        self.spec = spec

    @abstractmethod
    def probe(self) -> Probe:
        raise NotImplementedError

    @abstractmethod
    def _predict(self, image: Image.Image, threshold: float) -> EngineResult:
        raise NotImplementedError

    def info(self) -> EngineInfo:
        probe = self.probe()
        return EngineInfo(
            **{
                k: self.spec[k]
                for k in (
                    "id",
                    "name",
                    "family",
                    "task",
                    "backend",
                    "adapter",
                    "description",
                    "strengths",
                    "requires_weights",
                    "open_vocabulary",
                )
            },
            availability=probe.availability,
            status_reason=probe.reason,
            pathology_ready=probe.pathology_ready,
        )

    def predict(self, image: Image.Image, threshold: float) -> EngineResult:
        probe = self.probe()
        if probe.availability != "ready":
            return EngineResult(
                engine_id=self.spec["id"],
                state="skipped",
                note=probe.reason or probe.availability,
            )
        started = perf_counter()
        try:
            result = self._predict(image, threshold)
            result.elapsed_ms = (perf_counter() - started) * 1000.0
            return result
        except Exception as exc:
            return EngineResult(
                engine_id=self.spec["id"],
                state="error",
                elapsed_ms=(perf_counter() - started) * 1000.0,
                error=f"{type(exc).__name__}: {exc}",
            )
