from __future__ import annotations

import importlib.util
import os
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from ..imaging import image_to_b64, overlay_detections
from ..schemas import Detection, EngineResult
from ..taxonomy import PROMPT_LABELS, normalize_label
from .base import Engine, Probe


class UltralyticsEngine(Engine):
    def __init__(self, spec: dict):
        super().__init__(spec)
        self._model = None

    def _weights(self) -> str | None:
        env = self.spec.get("weights_env")
        if env and os.getenv(env):
            return os.getenv(env)
        if self.spec.get("requires_weights"):
            return None
        return self.spec.get("model_ref")

    def probe(self) -> Probe:
        if importlib.util.find_spec("ultralytics") is None:
            return Probe("missing_dependency", "Install ultralytics.", False)
        weights = self._weights()
        if not weights:
            return Probe(
                "requires_weights",
                f"Configure {self.spec.get('weights_env')}.",
                False,
            )
        if self.spec.get("requires_weights") and not Path(weights).exists():
            return Probe("requires_weights", f"Checkpoint not found: {weights}", False)
        pathology_ready = bool(self.spec.get("requires_weights"))
        return Probe("ready", None, pathology_ready)

    def _load(self):
        if self._model is not None:
            return self._model
        from ultralytics import FastSAM, RTDETR, YOLO, YOLOWorld

        adapter = self.spec["adapter"]
        weights = self._weights()
        if adapter == "ultralytics-rtdetr":
            self._model = RTDETR(weights)
        elif adapter == "ultralytics-world":
            self._model = YOLOWorld(weights)
            self._model.set_classes(PROMPT_LABELS)
        elif adapter == "ultralytics-fastsam":
            self._model = FastSAM(weights)
        else:
            self._model = YOLO(weights)
        return self._model

    def _predict(self, image: Image.Image, threshold: float) -> EngineResult:
        model = self._load()
        results = model.predict(source=np.asarray(image), conf=threshold, verbose=False)
        if not results:
            return EngineResult(engine_id=self.spec["id"], state="ok")
        result = results[0]
        detections: list[Detection] = []
        union_mask = np.zeros((image.height, image.width), dtype=np.uint8)

        names = getattr(result, "names", {}) or {}
        boxes = getattr(result, "boxes", None)
        masks = getattr(result, "masks", None)

        mask_arrays = None
        if masks is not None and getattr(masks, "data", None) is not None:
            mask_arrays = masks.data.detach().cpu().numpy()

        if boxes is not None:
            xyxy = boxes.xyxy.detach().cpu().numpy()
            confs = boxes.conf.detach().cpu().numpy()
            classes = boxes.cls.detach().cpu().numpy().astype(int)
            for i, (coords, score, cls_id) in enumerate(zip(xyxy, confs, classes)):
                raw = str(names.get(int(cls_id), cls_id))
                label = normalize_label(raw)
                area_px = None
                if mask_arrays is not None and i < len(mask_arrays):
                    m = cv2.resize(
                        mask_arrays[i],
                        (image.width, image.height),
                        interpolation=cv2.INTER_NEAREST,
                    ) > 0.5
                    union_mask[m] = 255
                    area_px = float(np.count_nonzero(m))
                detections.append(
                    Detection(
                        label=label,
                        raw_label=raw,
                        confidence=float(score),
                        bbox=[float(x) for x in coords.tolist()],
                        area_px=area_px,
                    )
                )

        if boxes is None and mask_arrays is not None:
            for i, m0 in enumerate(mask_arrays):
                m = cv2.resize(m0, (image.width, image.height), interpolation=cv2.INTER_NEAREST) > 0.5
                union_mask[m] = 255
                ys, xs = np.where(m)
                if len(xs):
                    detections.append(
                        Detection(
                            label="other",
                            raw_label=f"segment_{i + 1}",
                            confidence=1.0,
                            bbox=[float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max())],
                            area_px=float(np.count_nonzero(m)),
                        )
                    )

        affected = (
            float(np.count_nonzero(union_mask)) / float(union_mask.size) * 100.0
            if np.any(union_mask)
            else None
        )
        overlay = overlay_detections(
            image,
            detections,
            union_mask if np.any(union_mask) else None,
        )
        note = None
        if not self.spec.get("requires_weights"):
            note = "General/open-vocabulary foundation weights; validate on SHM data before quantitative use."
        return EngineResult(
            engine_id=self.spec["id"],
            state="ok",
            detections=detections,
            affected_area_percent=affected,
            overlay_base64=image_to_b64(overlay),
            note=note,
        )
