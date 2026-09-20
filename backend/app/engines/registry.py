from __future__ import annotations

from functools import lru_cache

from .base import Engine
from .catalog import CATALOG
from .grounded_sam2 import GroundedSAM2Engine
from .hf_engine import HuggingFaceEngine
from .morphology import MorphologyEngine
from .research_engine import Detectron2Engine, MMSegEngine, ONNXEngine
from .sam2_engine import SAM2Engine
from .smp_engine import SMPEngine
from .torchvision_engine import TorchvisionEngine
from .ultralytics_engine import UltralyticsEngine


class EngineRegistry:
    def __init__(self):
        self.specs = {spec["id"]: spec for spec in CATALOG}
        self._instances: dict[str, Engine] = {}

    def ids(self) -> list[str]:
        return list(self.specs)

    def get(self, engine_id: str) -> Engine:
        if engine_id not in self.specs:
            raise KeyError(engine_id)
        if engine_id in self._instances:
            return self._instances[engine_id]
        spec = self.specs[engine_id]
        adapter = spec["adapter"]
        if adapter == "morphology":
            engine = MorphologyEngine(spec)
        elif adapter.startswith("ultralytics-"):
            engine = UltralyticsEngine(spec)
        elif adapter in {"grounding-dino", "hf-segmentation"}:
            engine = HuggingFaceEngine(spec)
        elif adapter == "smp":
            engine = SMPEngine(spec)
        elif adapter == "torchvision":
            engine = TorchvisionEngine(spec)
        elif adapter == "detectron2":
            engine = Detectron2Engine(spec)
        elif adapter == "mmseg":
            engine = MMSegEngine(spec)
        elif adapter == "onnx":
            engine = ONNXEngine(spec)
        elif adapter == "sam2":
            engine = SAM2Engine(spec)
        elif adapter == "grounded-sam2":
            engine = GroundedSAM2Engine(spec)
        else:
            raise RuntimeError(f"Unsupported adapter: {adapter}")
        self._instances[engine_id] = engine
        return engine

    def infos(self):
        return [self.get(engine_id).info() for engine_id in self.ids()]


@lru_cache(maxsize=1)
def get_registry() -> EngineRegistry:
    return EngineRegistry()
