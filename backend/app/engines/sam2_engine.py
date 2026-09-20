from __future__ import annotations

import importlib.util
import os
from pathlib import Path

import numpy as np
from PIL import Image

from ..imaging import image_to_b64, overlay_detections
from ..schemas import Detection, EngineResult
from .base import Engine, Probe


class SAM2Engine(Engine):
    def __init__(self, spec: dict):
        super().__init__(spec)
        self._generator = None

    def _paths(self):
        return os.getenv(self.spec["config_env"]), os.getenv(self.spec["weights_env"])

    def probe(self) -> Probe:
        if importlib.util.find_spec("sam2") is None:
            return Probe("missing_dependency", "Install the official SAM 2 package.", False)
        config, checkpoint = self._paths()
        if not config or not checkpoint or not Path(checkpoint).exists():
            return Probe("requires_weights", "Configure SAM2_CONFIG and SAM2_CHECKPOINT.", False)
        return Probe("ready", None, False)

    def _load(self):
        if self._generator is not None:
            return self._generator
        from sam2.automatic_mask_generator import SAM2AutomaticMaskGenerator
        from sam2.build_sam import build_sam2

        config, checkpoint = self._paths()
        model = build_sam2(config, checkpoint, device=os.getenv("SAM2_DEVICE", "cpu"))
        self._generator = SAM2AutomaticMaskGenerator(model)
        return self._generator

    def _predict(self, image: Image.Image, threshold: float) -> EngineResult:
        generator = self._load()
        masks = generator.generate(np.asarray(image))
        union = np.zeros((image.height, image.width), dtype=np.uint8)
        detections: list[Detection] = []

        for idx, item in enumerate(masks):
            score = float(item.get("predicted_iou", item.get("stability_score", 1.0)))
            if score < threshold:
                continue
            seg = item["segmentation"].astype(bool)
            union[seg] = 255
            x, y, w, h = item.get("bbox", (0, 0, image.width, image.height))
            detections.append(
                Detection(
                    label="other",
                    raw_label=f"sam2_segment_{idx + 1}",
                    confidence=max(0.0, min(1.0, score)),
                    bbox=[float(x), float(y), float(x + w), float(y + h)],
                    area_px=float(np.count_nonzero(seg)),
                )
            )

        overlay = overlay_detections(image, detections, union if np.any(union) else None)
        return EngineResult(
            engine_id=self.spec["id"],
            state="ok",
            detections=detections,
            affected_area_percent=(
                float(np.count_nonzero(union)) / float(union.size) * 100.0 if np.any(union) else 0.0
            ),
            overlay_base64=image_to_b64(overlay),
            note="SAM 2 masks are class-agnostic and must not be interpreted as pathology labels by themselves.",
        )
