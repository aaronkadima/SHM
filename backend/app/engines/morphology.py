from __future__ import annotations

import cv2
import numpy as np
from PIL import Image

from ..imaging import image_to_b64, overlay_detections
from ..schemas import Detection, EngineResult
from .base import Engine, Probe


class MorphologyEngine(Engine):
    def probe(self) -> Probe:
        return Probe("ready", "Deterministic OpenCV baseline", pathology_ready=True)

    def _predict(self, image: Image.Image, threshold: float) -> EngineResult:
        rgb = np.asarray(image.convert("RGB"))
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(gray)

        k = max(5, int(round(min(gray.shape) / 110)))
        if k % 2 == 0:
            k += 1
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
        blackhat = cv2.morphologyEx(enhanced, cv2.MORPH_BLACKHAT, kernel)

        _, otsu = cv2.threshold(blackhat, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        local = cv2.adaptiveThreshold(
            blackhat,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            max(11, k * 2 + 1),
            -2,
        )
        mask = cv2.bitwise_and(otsu, local)
        mask = cv2.morphologyEx(
            mask,
            cv2.MORPH_OPEN,
            cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2)),
        )

        min_area = max(6, int(gray.size * 0.000002))
        max_area = int(gray.size * 0.08)
        n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)

        cleaned = np.zeros_like(mask)
        detections: list[Detection] = []
        for idx in range(1, n):
            x, y, w, h, area = stats[idx]
            if area < min_area or area > max_area:
                continue
            elongation = max(w, h) / max(1, min(w, h))
            fill = area / max(1, w * h)
            if elongation < 1.4 and fill > 0.55:
                continue
            component = labels == idx
            contrast = float(blackhat[component].mean()) / 255.0
            score = max(0.05, min(0.99, 0.35 + 0.45 * contrast + 0.20 * min(elongation / 10.0, 1.0)))
            if score < threshold:
                continue
            cleaned[component] = 255
            detections.append(
                Detection(
                    label="crack",
                    raw_label="morphological crack candidate",
                    confidence=score,
                    bbox=[float(x), float(y), float(x + w), float(y + h)],
                    area_px=float(area),
                )
            )

        affected = float(np.count_nonzero(cleaned)) / float(cleaned.size) * 100.0
        overlay = overlay_detections(image, detections, cleaned)
        return EngineResult(
            engine_id=self.spec["id"],
            state="ok",
            detections=detections,
            affected_area_percent=affected,
            overlay_base64=image_to_b64(overlay),
            note="Confidence is a deterministic morphology heuristic, not a calibrated probability.",
        )
