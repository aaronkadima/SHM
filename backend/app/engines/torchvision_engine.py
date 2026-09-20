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


class TorchvisionEngine(Engine):
    """Adapter for canonical torchvision detectors and semantic segmenters.

    Detection checkpoints use class 0 as background and classes 1..N for TAXONOMY.
    Semantic segmentation checkpoints use classes 0..N-1 directly for TAXONOMY.
    """

    def __init__(self, spec: dict):
        super().__init__(spec)
        self._model = None

    def _weights(self) -> str | None:
        env = self.spec.get("weights_env")
        return os.getenv(env) if env else None

    def probe(self) -> Probe:
        if importlib.util.find_spec("torch") is None or importlib.util.find_spec("torchvision") is None:
            return Probe("missing_dependency", "Install torch and torchvision.", False)
        weights = self._weights()
        if not weights or not Path(weights).exists():
            return Probe(
                "requires_weights",
                f"Configure {self.spec.get('weights_env')} with a pathology checkpoint.",
                False,
            )
        return Probe("ready", None, True)

    def _build(self):
        import torchvision.models.detection as detection
        import torchvision.models.segmentation as segmentation

        name = self.spec["torchvision_builder"]
        detection_builders = {
            "fasterrcnn_resnet50_fpn": lambda: detection.fasterrcnn_resnet50_fpn(
                weights=None,
                weights_backbone=None,
                num_classes=len(TAXONOMY) + 1,
            ),
            "retinanet_resnet50_fpn": lambda: detection.retinanet_resnet50_fpn(
                weights=None,
                weights_backbone=None,
                num_classes=len(TAXONOMY) + 1,
            ),
            "ssd300_vgg16": lambda: detection.ssd300_vgg16(
                weights=None,
                weights_backbone=None,
                num_classes=len(TAXONOMY) + 1,
            ),
        }
        segmentation_builders = {
            "fcn_resnet50": lambda: segmentation.fcn_resnet50(
                weights=None,
                weights_backbone=None,
                num_classes=len(TAXONOMY),
                aux_loss=False,
            ),
            "deeplabv3_resnet50": lambda: segmentation.deeplabv3_resnet50(
                weights=None,
                weights_backbone=None,
                num_classes=len(TAXONOMY),
                aux_loss=False,
            ),
        }
        if name in detection_builders:
            return detection_builders[name]()
        if name in segmentation_builders:
            return segmentation_builders[name]()
        raise RuntimeError(f"Unsupported torchvision builder: {name}")

    def _load(self):
        if self._model is not None:
            return self._model
        import torch

        model = self._build()
        state = torch.load(self._weights(), map_location="cpu", weights_only=False)
        if isinstance(state, dict):
            for key in ("state_dict", "model_state_dict", "model"):
                if key in state and isinstance(state[key], dict):
                    state = state[key]
                    break
        if isinstance(state, dict):
            state = {k.removeprefix("module."): v for k, v in state.items()}
        model.load_state_dict(state, strict=True)
        model.eval()
        self._model = model
        return model

    @staticmethod
    def _tensor(image: Image.Image):
        import torch

        array = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
        return torch.from_numpy(array.transpose(2, 0, 1))

    def _predict(self, image: Image.Image, threshold: float) -> EngineResult:
        if self.spec["task"] == "object detection":
            return self._predict_detection(image, threshold)
        return self._predict_semantic(image, threshold)

    def _predict_detection(self, image: Image.Image, threshold: float) -> EngineResult:
        import torch

        model = self._load()
        x = self._tensor(image)
        with torch.inference_mode():
            output = model([x])[0]

        boxes = output.get("boxes", torch.empty((0, 4))).detach().cpu().numpy()
        scores = output.get("scores", torch.empty((0,))).detach().cpu().numpy()
        labels = output.get("labels", torch.empty((0,), dtype=torch.long)).detach().cpu().numpy()
        masks = output.get("masks")
        masks_np = masks.detach().cpu().numpy() if masks is not None else None

        detections: list[Detection] = []
        union = np.zeros((image.height, image.width), dtype=np.uint8)
        for idx, (box, score, cls_id) in enumerate(zip(boxes, scores, labels)):
            if float(score) < threshold:
                continue
            taxonomy_idx = int(cls_id) - 1
            label = TAXONOMY[taxonomy_idx] if 0 <= taxonomy_idx < len(TAXONOMY) else "other"
            area_px = None
            if masks_np is not None and idx < len(masks_np):
                mask = masks_np[idx, 0] >= 0.5
                union[mask] = 255
                area_px = float(np.count_nonzero(mask))
            detections.append(
                Detection(
                    label=label,
                    raw_label=str(int(cls_id)),
                    confidence=float(score),
                    bbox=[float(value) for value in box.tolist()],
                    area_px=area_px,
                )
            )

        affected = (
            float(np.count_nonzero(union)) / float(union.size) * 100.0
            if np.any(union)
            else None
        )
        overlay = overlay_detections(image, detections, union if np.any(union) else None)
        return EngineResult(
            engine_id=self.spec["id"],
            state="ok",
            detections=detections,
            affected_area_percent=affected,
            overlay_base64=image_to_b64(overlay),
        )

    def _predict_semantic(self, image: Image.Image, threshold: float) -> EngineResult:
        import torch

        model = self._load()
        x = self._tensor(image).unsqueeze(0)
        with torch.inference_mode():
            logits = model(x)["out"][0]
        probabilities = torch.softmax(logits, dim=0)
        confidence_map, class_map = probabilities.max(dim=0)
        confidence_np = confidence_map.cpu().numpy()
        class_np = class_map.cpu().numpy()

        detections: list[Detection] = []
        union = np.zeros((image.height, image.width), dtype=np.uint8)
        for cls_id in np.unique(class_np):
            mask = (class_np == cls_id) & (confidence_np >= threshold)
            if not np.any(mask):
                continue
            ys, xs = np.where(mask)
            union[mask] = 255
            cls_int = int(cls_id)
            label = TAXONOMY[cls_int] if cls_int < len(TAXONOMY) else "other"
            detections.append(
                Detection(
                    label=label,
                    raw_label=str(cls_int),
                    confidence=float(confidence_np[mask].mean()),
                    bbox=[float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max())],
                    area_px=float(np.count_nonzero(mask)),
                )
            )

        overlay = overlay_detections(image, detections, union)
        return EngineResult(
            engine_id=self.spec["id"],
            state="ok",
            detections=detections,
            affected_area_percent=float(np.count_nonzero(union)) / float(union.size) * 100.0,
            overlay_base64=image_to_b64(overlay),
        )
