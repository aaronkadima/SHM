from __future__ import annotations

import base64
from io import BytesIO

import cv2
import numpy as np
from PIL import Image, ImageDraw

from .schemas import Detection


def image_to_b64(image: Image.Image, quality: int = 88) -> str:
    buffer = BytesIO()
    image.convert("RGB").save(buffer, format="JPEG", quality=quality, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def overlay_detections(
    image: Image.Image,
    detections: list[Detection],
    mask: np.ndarray | None = None,
) -> Image.Image:
    base = image.convert("RGB")
    arr = np.asarray(base).copy()

    if mask is not None:
        binary = mask.astype(bool)
        tint = arr.copy()
        tint[binary] = np.array([220, 45, 45], dtype=np.uint8)
        arr = cv2.addWeighted(arr, 0.72, tint, 0.28, 0)

    result = Image.fromarray(arr)
    draw = ImageDraw.Draw(result)
    width = max(2, round(min(result.size) / 350))

    for det in detections:
        if det.bbox and len(det.bbox) == 4:
            x1, y1, x2, y2 = det.bbox
            draw.rectangle((x1, y1, x2, y2), outline=(255, 90, 40), width=width)
            label = f"{det.label} {det.confidence:.2f}"
            tx, ty = x1 + 3, max(0, y1 - 15)
            draw.text((tx, ty), label, fill=(255, 255, 255), stroke_width=2, stroke_fill=(0, 0, 0))

    return result


def decode_image(data: bytes) -> Image.Image:
    image = Image.open(BytesIO(data))
    image.load()
    return image.convert("RGB")
