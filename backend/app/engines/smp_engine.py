from __future__ import annotations

import importlib.util
import os
from pathlib import Path

import numpy as np
from PIL import Image

from ..imaging import image_to_b64, overlay_detections
from ..schemas import Detection, EngineResult
from ..taxonomy import TAXONOMY
from .base import Engine, Probe


class SMPEngine(Engine):
    def __init__(self, spec: dict):
        super().__init__(spec)
        self._model = None

    def _weights(self) -> str | None:
        env = self.spec.get("weights_env")
        return os.getenv(env) if env else None

    def probe(self) -> Probe:
        if importlib.util.find_spec("segmentation_models_pytorch") is None:
            return Probe("missing_dependency", "Install segmentation-models-pytorch.", False)
        weights = self._weights()
        if not weights or not Path(weights).exists():
            return Probe(
                "requires_weights",
                f"Configure {self.spec.get('weights_env')} with a compatible checkpoint.",
                False,
            )
        return Probe("ready", None, True)

    def _load(self):
        if self._model is not None:
            return self._model
        import torch
        import segmentation_models_pytorch as smp

        arch_cls = getattr(smp, self.spec["arch"])
        model = arch_cls(
            encoder_name=os.getenv("SMP_ENCODER", "resnet34"),
            encoder_weights=None,
            in_channels=3,
            classes=len(TAXONOMY),
        )
        state = torch.load(self._weights(), map_location="cpu", weights_only=False)
        if isinstance(state, dict) and "state_dict" in state:
            state = state["state_dict"]
        if isinstance(state, dict):
            state = {k.removeprefix("module."): v for k, v in state.items()}
        model.load_state_dict(state, strict=True)
        model.eval()
        self._model = model
        return model

    def _predict(self, image: Image.Image, threshold: float) -> EngineResult:
        import torch

        model = self._load()
        arr = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
        x = torch.from_numpy(arr.transpose(2, 0, 1)).unsqueeze(0)
        with torch.inference_mode():
            logits = model(x)[0]
            probs = torch.softmax(logits, dim=0)
        conf, cls = probs.max(dim=0)
        cls = cls.cpu().numpy()
        conf = conf.cpu().numpy()

        detections: list[Detection] = []
        union = np.zeros((image.height, image.width), dtype=np.uint8)
        for cls_id in np.unique(cls):
            m = (cls == cls_id) & (conf >= threshold)
            if not np.any(m):
                continue
            ys, xs = np.where(m)
            union[m] = 255
            label = TAXONOMY[int(cls_id)] if int(cls_id) < len(TAXONOMY) else "other"
            detections.append(
                Detection(
                    label=label,
                    raw_label=label,
                    confidence=float(conf[m].mean()),
                    bbox=[float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max())],
                    area_px=float(np.count_nonzero(m)),
                )
            )
        affected = float(np.count_nonzero(union)) / float(union.size) * 100.0
        overlay = overlay_detections(image, detections, union)
        return EngineResult(
            engine_id=self.spec["id"],
            state="ok",
            detections=detections,
            affected_area_percent=affected,
            overlay_base64=image_to_b64(overlay),
        )
