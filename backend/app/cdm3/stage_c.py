"""CDM-3 Stage C: pathology segmentation, vectorization and training data helpers."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
import uuid

import cv2
import numpy as np
from PIL import Image, ImageDraw

IGNORE_INDEX = 255
CDM3_CLASSES = [
    "background",
    "cracks",
    "spalling_dark",
    "exposed_rebar",
    "corrosion_rust",
    "efflorescence_white",
]
CDM3_ID2LABEL = {i: name for i, name in enumerate(CDM3_CLASSES)}
CDM3_LABEL2ID = {name: i for i, name in CDM3_ID2LABEL.items()}
CDM3_COLORS = {
    "cracks": (230, 0, 0),
    "spalling_dark": (255, 153, 0),
    "exposed_rebar": (140, 140, 140),
    "corrosion_rust": (139, 63, 0),
    "efflorescence_white": (0, 102, 204),
}

# DACL10K published class order -> CDM-3 pathology vocabulary.
DACL10K_INDEX_TO_CDM_NAME = {
    0: "cracks", 1: "cracks", 2: None, 3: "efflorescence_white",
    4: "corrosion_rust", 5: None, 6: None, 7: None, 8: "spalling_dark",
    9: None, 10: None, 11: None, 12: "exposed_rebar", 13: None,
    14: None, 15: None, 16: None, 17: None, 18: None,
}


def remap_dacl10k_mask(raw_mask: np.ndarray) -> np.ndarray:
    out = np.full(raw_mask.shape, IGNORE_INDEX, dtype=np.uint8)
    for idx, name in DACL10K_INDEX_TO_CDM_NAME.items():
        if name is not None:
            out[raw_mask == idx] = CDM3_LABEL2ID[name]
    return out


@lru_cache(maxsize=2)
def load_model(checkpoint: str):
    from transformers import AutoImageProcessor, SegformerForSemanticSegmentation
    processor = AutoImageProcessor.from_pretrained(checkpoint)
    model = SegformerForSemanticSegmentation.from_pretrained(checkpoint).eval()
    return processor, model


def predict_class_map(checkpoint: str, image: Image.Image) -> np.ndarray:
    import torch
    import torch.nn.functional as F
    processor, model = load_model(checkpoint)
    inputs = processor(images=image.convert("RGB"), return_tensors="pt")
    with torch.inference_mode():
        logits = model(**inputs).logits
        logits = F.interpolate(
            logits, size=(image.height, image.width), mode="bilinear", align_corners=False
        )
    return logits.argmax(dim=1)[0].cpu().numpy().astype(np.uint8)


def contour_to_svg_path(contour: np.ndarray) -> str:
    pts = contour.reshape(-1, 2)
    if len(pts) == 0:
        return ""
    return " ".join(
        [f"M{pts[0][0]},{pts[0][1]}"]
        + [f"L{x},{y}" for x, y in pts[1:]]
        + ["Z"]
    )


def vectorize_class_mask(mask: np.ndarray, min_area_px: int = 40) -> list[dict]:
    kernel = np.ones((3, 3), np.uint8)
    cleaned = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_OPEN, kernel)
    cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(cleaned, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for contour in contours:
        area = float(cv2.contourArea(contour))
        if area < min_area_px:
            continue
        approx = cv2.approxPolyDP(contour, epsilon=1.0, closed=True)
        pts = approx.reshape(-1, 2)
        if len(pts) < 3:
            continue
        x, y, w, h = cv2.boundingRect(approx)
        out.append({
            "area_px": area,
            "bbox": [int(x), int(y), int(x + w), int(y + h)],
            "points": [[float(px), float(py)] for px, py in pts],
            "svg_path": contour_to_svg_path(approx),
        })
    return out


def build_records(
    class_map: np.ndarray,
    source_image: str = "",
    inspection_date: str = "",
    mm_per_px: float | None = None,
    min_area_px: int = 40,
) -> list[dict]:
    records = []
    for class_id, class_name in CDM3_ID2LABEL.items():
        if class_name == "background":
            continue
        binary = (class_map == class_id).astype(np.uint8)
        for shape in vectorize_class_mask(binary, min_area_px):
            area_mm2 = shape["area_px"] * (mm_per_px ** 2) if mm_per_px else None
            records.append({
                "id": f"cdm3-{uuid.uuid4().hex[:12]}",
                "engine_version": "cdm-3.0-dev",
                "damage_class": class_name,
                "gd_index": None,
                "nbr9452_note": None,
                "geometry": {
                    "svg_path": shape["svg_path"],
                    "points_2d": shape["points"],
                    "bbox": shape["bbox"],
                    "coord_frame": "image_local_px",
                    "mm_per_px": mm_per_px,
                    "area_px": shape["area_px"],
                    "area_mm2": area_mm2,
                    "vertices_3d": None,
                    "projection_method": None,
                    "reprojection_error_px": None,
                },
                "host_element": {
                    "ifc_global_id": None,
                    "ifc_class": None,
                    "bridge_component": None,
                },
                "context": {
                    "environment_tags": [],
                    "flood_risk_flag": None,
                    "source_dataset_tier": "C",
                },
                "provenance": {
                    "source_image": source_image,
                    "inspection_date": inspection_date,
                    "detector_confidence_calibrated": False,
                },
            })
    return records


def render_overlay(size: tuple[int, int], records: list[dict]) -> Image.Image:
    overlay = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for record in records:
        pts = record.get("geometry", {}).get("points_2d") or []
        if len(pts) < 3:
            continue
        color = CDM3_COLORS.get(record.get("damage_class"), (255, 0, 0))
        draw.polygon([tuple(p) for p in pts], fill=(*color, 105), outline=(*color, 220))
    return overlay


class SegmentationFolderDataset:
    """Lazy torch Dataset wrapper used by the CDM-3 training script."""

    def __new__(cls, *args, **kwargs):
        from torch.utils.data import Dataset

        class _Dataset(Dataset):
            def __init__(self, root, processor, remap_fn=None):
                self.root = Path(root)
                self.paths = sorted((self.root / "images").glob("*.png"))
                self.paths += sorted((self.root / "images").glob("*.jpg"))
                if not self.paths:
                    raise FileNotFoundError(f"No images found in {self.root/'images'}")
                self.processor = processor
                self.remap_fn = remap_fn

            def __len__(self):
                return len(self.paths)

            def __getitem__(self, idx):
                import torch
                image_path = self.paths[idx]
                mask_path = self.root / "masks" / f"{image_path.stem}.png"
                image = Image.open(image_path).convert("RGB")
                raw = np.array(Image.open(mask_path))
                mask = self.remap_fn(raw) if self.remap_fn else raw.astype(np.uint8)
                pixel_values = self.processor(images=image, return_tensors="pt")["pixel_values"][0]
                target_size = (pixel_values.shape[-1], pixel_values.shape[-2])
                mask = np.array(Image.fromarray(mask).resize(target_size, Image.NEAREST))
                return {
                    "pixel_values": pixel_values,
                    "labels": torch.as_tensor(mask, dtype=torch.long),
                    "image_path": str(image_path),
                }

        return _Dataset(*args, **kwargs)
