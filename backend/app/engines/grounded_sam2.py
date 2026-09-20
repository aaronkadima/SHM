from __future__ import annotations

import importlib.util
import os
from pathlib import Path

import numpy as np
from PIL import Image

from ..imaging import image_to_b64, overlay_detections
from ..schemas import Detection, EngineResult
from ..taxonomy import PROMPT_LABELS, normalize_label
from .base import Engine, Probe


class GroundedSAM2Engine(Engine):
    def __init__(self, spec: dict):
        super().__init__(spec)
        self._gd_processor = None
        self._gd_model = None
        self._sam_predictor = None

    def probe(self) -> Probe:
        if importlib.util.find_spec("transformers") is None:
            return Probe("missing_dependency", "Install transformers.", False)
        if importlib.util.find_spec("sam2") is None:
            return Probe("missing_dependency", "Install the official SAM 2 package.", False)
        config = os.getenv("SAM2_CONFIG")
        checkpoint = os.getenv("SAM2_CHECKPOINT")
        if not config or not checkpoint or not Path(checkpoint).exists():
            return Probe("requires_weights", "Configure SAM2_CONFIG and SAM2_CHECKPOINT.", False)
        return Probe("ready", None, False)

    def _load(self):
        if self._sam_predictor is not None:
            return
        from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor

        ref = os.getenv("GROUNDING_DINO_MODEL", "IDEA-Research/grounding-dino-tiny")
        self._gd_processor = AutoProcessor.from_pretrained(ref)
        self._gd_model = AutoModelForZeroShotObjectDetection.from_pretrained(ref)
        self._gd_model.eval()

        sam = build_sam2(
            os.getenv("SAM2_CONFIG"),
            os.getenv("SAM2_CHECKPOINT"),
            device=os.getenv("SAM2_DEVICE", "cpu"),
        )
        self._sam_predictor = SAM2ImagePredictor(sam)

    def _predict(self, image: Image.Image, threshold: float) -> EngineResult:
        import torch

        self._load()
        prompt = ". ".join(PROMPT_LABELS) + "."
        inputs = self._gd_processor(images=image, text=prompt, return_tensors="pt")
        with torch.inference_mode():
            outputs = self._gd_model(**inputs)
        gd = self._gd_processor.post_process_grounded_object_detection(
            outputs,
            inputs.input_ids,
            box_threshold=threshold,
            text_threshold=max(0.15, threshold * 0.75),
            target_sizes=[(image.height, image.width)],
        )[0]
        labels = gd.get("text_labels") or gd.get("labels") or []
        boxes = gd["boxes"].detach().cpu().numpy() if hasattr(gd["boxes"], "detach") else np.asarray(gd["boxes"])
        scores = gd["scores"].detach().cpu().numpy() if hasattr(gd["scores"], "detach") else np.asarray(gd["scores"])

        self._sam_predictor.set_image(np.asarray(image))
        union = np.zeros((image.height, image.width), dtype=np.uint8)
        detections: list[Detection] = []

        for box, score, raw in zip(boxes, scores, labels):
            masks, _, _ = self._sam_predictor.predict(
                point_coords=None,
                point_labels=None,
                box=box,
                multimask_output=False,
            )
            mask = masks[0].astype(bool)
            union[mask] = 255
            raw_label = str(raw)
            detections.append(
                Detection(
                    label=normalize_label(raw_label),
                    raw_label=raw_label,
                    confidence=float(score),
                    bbox=[float(v) for v in box.tolist()],
                    area_px=float(np.count_nonzero(mask)),
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
            note="Open-vocabulary detections refined by SAM 2; validate and calibrate on the target SHM dataset.",
        )
