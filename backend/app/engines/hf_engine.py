from __future__ import annotations

import importlib.util
import os

import numpy as np
from PIL import Image

from ..config import settings
from ..imaging import image_to_b64, overlay_detections
from ..schemas import Detection, EngineResult
from ..taxonomy import PROMPT_LABELS, normalize_label
from .base import Engine, Probe


class HuggingFaceEngine(Engine):
    def __init__(self, spec: dict):
        super().__init__(spec)
        self._processor = None
        self._model = None

    def _model_ref(self) -> str | None:
        env = self.spec.get("model_env")
        if env and os.getenv(env):
            return os.getenv(env)
        return self.spec.get("model_ref")

    def probe(self) -> Probe:
        if importlib.util.find_spec("transformers") is None:
            return Probe("missing_dependency", "Install transformers and torch.", False)
        ref = self._model_ref()
        if not ref:
            return Probe(
                "requires_weights",
                f"Configure {self.spec.get('model_env')}.",
                False,
            )
        if self.spec.get("adapter") == "grounding-dino":
            if not settings.hf_allow_download and not os.path.exists(ref):
                return Probe("requires_weights", "HF download disabled and local model not found.", False)
            return Probe("ready", None, False)
        return Probe("ready", None, True)

    def _load(self):
        if self._model is not None:
            return self._processor, self._model
        from transformers import AutoImageProcessor, AutoProcessor

        ref = self._model_ref()
        if self.spec["adapter"] == "grounding-dino":
            from transformers import AutoModelForZeroShotObjectDetection
            self._processor = AutoProcessor.from_pretrained(ref)
            self._model = AutoModelForZeroShotObjectDetection.from_pretrained(ref)
        elif self.spec["id"] == "mask2former":
            from transformers import Mask2FormerForUniversalSegmentation
            self._processor = AutoImageProcessor.from_pretrained(ref)
            self._model = Mask2FormerForUniversalSegmentation.from_pretrained(ref)
        else:
            from transformers import AutoModelForSemanticSegmentation
            self._processor = AutoImageProcessor.from_pretrained(ref)
            self._model = AutoModelForSemanticSegmentation.from_pretrained(ref)
        self._model.eval()
        return self._processor, self._model

    def _predict(self, image: Image.Image, threshold: float) -> EngineResult:
        if self.spec["adapter"] == "grounding-dino":
            return self._predict_grounding_dino(image, threshold)
        if self.spec["id"] == "mask2former":
            return self._predict_mask2former(image, threshold)
        return self._predict_segmentation(image, threshold)

    def _predict_grounding_dino(self, image: Image.Image, threshold: float) -> EngineResult:
        import torch

        processor, model = self._load()
        text = ". ".join(PROMPT_LABELS) + "."
        inputs = processor(images=image, text=text, return_tensors="pt")
        with torch.inference_mode():
            outputs = model(**inputs)

        processed = processor.post_process_grounded_object_detection(
            outputs,
            inputs.input_ids,
            box_threshold=threshold,
            text_threshold=max(0.15, threshold * 0.75),
            target_sizes=[(image.height, image.width)],
        )[0]

        detections: list[Detection] = []
        labels = processed.get("text_labels") or processed.get("labels") or []
        for box, score, raw in zip(processed["boxes"], processed["scores"], labels):
            raw_label = str(raw)
            detections.append(
                Detection(
                    label=normalize_label(raw_label),
                    raw_label=raw_label,
                    confidence=float(score),
                    bbox=[float(v) for v in box.tolist()],
                )
            )
        overlay = overlay_detections(image, detections)
        return EngineResult(
            engine_id=self.spec["id"],
            state="ok",
            detections=detections,
            overlay_base64=image_to_b64(overlay),
            note="Zero-shot/open-vocabulary output; confidence is not SHM-calibrated.",
        )

    def _predict_mask2former(self, image: Image.Image, threshold: float) -> EngineResult:
        import torch

        processor, model = self._load()
        inputs = processor(images=image, return_tensors="pt")
        with torch.inference_mode():
            outputs = model(**inputs)
        maps = processor.post_process_semantic_segmentation(
            outputs, target_sizes=[(image.height, image.width)]
        )
        class_map = maps[0].detach().cpu().numpy()
        id2label = getattr(model.config, "id2label", {}) or {}

        detections: list[Detection] = []
        union = np.zeros_like(class_map, dtype=np.uint8)
        for cls_id in np.unique(class_map):
            m = class_map == cls_id
            if not np.any(m):
                continue
            raw = str(id2label.get(int(cls_id), cls_id))
            ys, xs = np.where(m)
            union[m] = 255
            detections.append(
                Detection(
                    label=normalize_label(raw),
                    raw_label=raw,
                    confidence=1.0,
                    bbox=[float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max())],
                    area_px=float(np.count_nonzero(m)),
                )
            )

        overlay = overlay_detections(image, detections, union)
        return EngineResult(
            engine_id=self.spec["id"],
            state="ok",
            detections=detections,
            affected_area_percent=float(np.count_nonzero(union)) / float(union.size) * 100.0,
            overlay_base64=image_to_b64(overlay),
            note="Mask2Former semantic map; per-mask confidence is not exposed by this normalized path.",
        )

    def _predict_segmentation(self, image: Image.Image, threshold: float) -> EngineResult:
        import torch

        processor, model = self._load()
        inputs = processor(images=image, return_tensors="pt")
        with torch.inference_mode():
            outputs = model(**inputs)

        if not hasattr(outputs, "logits"):
            raise RuntimeError("Model does not expose semantic segmentation logits.")
        logits = torch.nn.functional.interpolate(
            outputs.logits,
            size=(image.height, image.width),
            mode="bilinear",
            align_corners=False,
        )
        probs = logits.softmax(dim=1)[0]
        confidence_map, class_map = probs.max(dim=0)
        class_map = class_map.cpu().numpy()
        confidence_map = confidence_map.cpu().numpy()

        id2label = getattr(model.config, "id2label", {}) or {}
        detections: list[Detection] = []
        union_mask = np.zeros_like(class_map, dtype=np.uint8)

        for cls_id in np.unique(class_map):
            m = (class_map == cls_id) & (confidence_map >= threshold)
            if not np.any(m):
                continue
            raw = str(id2label.get(int(cls_id), cls_id))
            label = normalize_label(raw)
            ys, xs = np.where(m)
            union_mask[m] = 255
            detections.append(
                Detection(
                    label=label,
                    raw_label=raw,
                    confidence=float(confidence_map[m].mean()),
                    bbox=[float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max())],
                    area_px=float(np.count_nonzero(m)),
                )
            )

        affected = float(np.count_nonzero(union_mask)) / float(union_mask.size) * 100.0
        overlay = overlay_detections(image, detections, union_mask)
        return EngineResult(
            engine_id=self.spec["id"],
            state="ok",
            detections=detections,
            affected_area_percent=affected,
            overlay_base64=image_to_b64(overlay),
        )
