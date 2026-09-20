from __future__ import annotations

import importlib.util
import os
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from ..imaging import image_to_b64, overlay_detections
from ..schemas import Detection, EngineResult
from ..taxonomy import TAXONOMY
from .base import Engine, Probe


class Detectron2Engine(Engine):
    def __init__(self, spec: dict):
        super().__init__(spec)
        self._predictor = None

    def _paths(self):
        return os.getenv(self.spec["config_env"]), os.getenv(self.spec["weights_env"])

    def probe(self) -> Probe:
        if importlib.util.find_spec("detectron2") is None:
            return Probe("missing_dependency", "Install Detectron2 compatible with your PyTorch/CUDA.", False)
        config, weights = self._paths()
        if not config or not weights or not Path(config).exists() or not Path(weights).exists():
            return Probe("requires_weights", "Configure Detectron2 config and pathology checkpoint.", False)
        return Probe("ready", None, True)

    def _load(self):
        if self._predictor is not None:
            return self._predictor
        from detectron2.config import get_cfg
        from detectron2.engine import DefaultPredictor

        config, weights = self._paths()
        cfg = get_cfg()
        cfg.merge_from_file(config)
        cfg.MODEL.WEIGHTS = weights
        cfg.MODEL.ROI_HEADS.SCORE_THRESH_TEST = 0.0
        self._predictor = DefaultPredictor(cfg)
        return self._predictor

    def _predict(self, image: Image.Image, threshold: float) -> EngineResult:
        predictor = self._load()
        bgr = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)
        instances = predictor(bgr)["instances"].to("cpu")
        detections: list[Detection] = []
        union = np.zeros((image.height, image.width), dtype=np.uint8)
        classes = instances.pred_classes.numpy() if instances.has("pred_classes") else np.array([])
        scores = instances.scores.numpy() if instances.has("scores") else np.ones(len(classes))
        boxes = instances.pred_boxes.tensor.numpy() if instances.has("pred_boxes") else np.zeros((len(classes), 4))
        masks = instances.pred_masks.numpy() if instances.has("pred_masks") else None

        for i, (cls_id, score, box) in enumerate(zip(classes, scores, boxes)):
            if float(score) < threshold:
                continue
            label = TAXONOMY[int(cls_id)] if int(cls_id) < len(TAXONOMY) else "other"
            area = None
            if masks is not None:
                union[masks[i]] = 255
                area = float(np.count_nonzero(masks[i]))
            detections.append(
                Detection(
                    label=label,
                    raw_label=str(int(cls_id)),
                    confidence=float(score),
                    bbox=[float(v) for v in box.tolist()],
                    area_px=area,
                )
            )

        affected = float(np.count_nonzero(union)) / float(union.size) * 100.0 if np.any(union) else None
        overlay = overlay_detections(image, detections, union if np.any(union) else None)
        return EngineResult(
            engine_id=self.spec["id"],
            state="ok",
            detections=detections,
            affected_area_percent=affected,
            overlay_base64=image_to_b64(overlay),
        )


class MMSegEngine(Engine):
    def __init__(self, spec: dict):
        super().__init__(spec)
        self._model = None

    def _paths(self):
        return os.getenv(self.spec["config_env"]), os.getenv(self.spec["weights_env"])

    def probe(self) -> Probe:
        if importlib.util.find_spec("mmseg") is None:
            return Probe("missing_dependency", "Install mmengine/mmcv/mmsegmentation.", False)
        config, weights = self._paths()
        if not config or not weights or not Path(config).exists() or not Path(weights).exists():
            return Probe("requires_weights", "Configure MMSeg config and pathology checkpoint.", False)
        return Probe("ready", None, True)

    def _load(self):
        if self._model is not None:
            return self._model
        from mmseg.apis import init_model

        config, weights = self._paths()
        self._model = init_model(config, weights, device=os.getenv("MMSEG_DEVICE", "cpu"))
        return self._model

    def _predict(self, image: Image.Image, threshold: float) -> EngineResult:
        from mmseg.apis import inference_model

        model = self._load()
        bgr = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)
        result = inference_model(model, bgr)
        pred = result.pred_sem_seg.data.squeeze().detach().cpu().numpy()
        detections: list[Detection] = []
        union = np.zeros_like(pred, dtype=np.uint8)

        for cls_id in np.unique(pred):
            m = pred == cls_id
            if not np.any(m):
                continue
            ys, xs = np.where(m)
            union[m] = 255
            label = TAXONOMY[int(cls_id)] if int(cls_id) < len(TAXONOMY) else "other"
            detections.append(
                Detection(
                    label=label,
                    raw_label=str(int(cls_id)),
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
            note="MMSeg hard-label output; confidence depends on the configured decode head.",
        )


class ONNXEngine(Engine):
    def __init__(self, spec: dict):
        super().__init__(spec)
        self._session = None

    def _weights(self):
        return os.getenv(self.spec["weights_env"])

    def probe(self) -> Probe:
        if importlib.util.find_spec("onnxruntime") is None:
            return Probe("missing_dependency", "Install onnxruntime or onnxruntime-gpu.", False)
        weights = self._weights()
        if not weights or not Path(weights).exists():
            return Probe("requires_weights", f"Configure {self.spec['weights_env']}.", False)
        return Probe("ready", None, True)

    def _load(self):
        if self._session is None:
            import onnxruntime as ort
            self._session = ort.InferenceSession(self._weights(), providers=ort.get_available_providers())
        return self._session

    def _predict(self, image: Image.Image, threshold: float) -> EngineResult:
        session = self._load()
        inp = session.get_inputs()[0]
        shape = inp.shape
        h = int(shape[2]) if isinstance(shape[2], int) else image.height
        w = int(shape[3]) if isinstance(shape[3], int) else image.width
        resized = image.resize((w, h))
        arr = np.asarray(resized, dtype=np.float32) / 255.0
        x = arr.transpose(2, 0, 1)[None, ...]
        logits = session.run(None, {inp.name: x})[0]
        if logits.ndim != 4:
            raise RuntimeError(f"Expected NCHW logits, got shape {logits.shape}")
        logits = logits[0]
        logits = cv2.resize(logits.transpose(1, 2, 0), (image.width, image.height), interpolation=cv2.INTER_LINEAR)
        if logits.ndim == 2:
            logits = logits[..., None]
        exp = np.exp(logits - logits.max(axis=-1, keepdims=True))
        probs = exp / np.maximum(exp.sum(axis=-1, keepdims=True), 1e-8)
        cls = probs.argmax(axis=-1)
        conf = probs.max(axis=-1)

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
                    raw_label=str(int(cls_id)),
                    confidence=float(conf[m].mean()),
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
        )
