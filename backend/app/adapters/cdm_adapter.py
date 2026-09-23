"""CDM-1: execute the user's CDM v2.8.5 morphology code without Inkscape UI."""
import numpy as np
from PIL import Image,ImageDraw

from .base import AdapterMeta, EngineAdapter, png_b64
from .. import cdm_v285 as cdm
from ..schemas import Detection, EngineResult


CURRENT_COLORS = {
    "cracks": (230, 0, 0),
    "spalling_dark": (255, 153, 0),
    "exposed_rebar": (140, 140, 140),
    "corrosion_rust": (139, 63, 0),
    "efflorescence_white": (0, 102, 204),
}
TEMPORAL_COLORS = {
    "growth": (0, 145, 90),
    "reduction": (112, 78, 170),
}
TEMPORAL_LABELS = {
    "growth": "Crescimento t0→t1",
    "reduction": "Redução t0→t1",
}


def _source_class(record):
    if record.damage_class in ("growth", "reduction"):
        prefix = record.damage_class + "_"
        if record.time_label.startswith(prefix):
            return record.time_label[len(prefix):]
    return record.damage_class


def _record_payload(record):
    return {
        "id": record.record_id,
        "time_label": record.time_label,
        "class": record.damage_class,
        "source_class": _source_class(record),
        "bbox": list(record.bbox),
        "points": [list(p) for p in record.points],
        "closed": record.is_closed,
        "area_px2": record.area_px2,
        "perimeter_px": record.perimeter_px,
        "length_px": record.length_px,
        "width_px": record.width_px,
        "aspect_ratio": record.aspect_ratio,
        "confidence_note": record.confidence_note,
    }


def _paint_records(size, records, color):
    layer_image = Image.new("RGBA", size)
    draw = ImageDraw.Draw(layer_image)
    for record in records:
        points = [tuple(p) for p in record.points]
        if len(points) < 2:
            continue
        if record.is_closed:
            draw.polygon(points, fill=(*color, 150))
        else:
            draw.line(points, fill=(*color, 180), width=max(1, round(record.width_px)))
    return layer_image


class CDM1Adapter(EngineAdapter):
    meta = AdapterMeta(
        "cdm_1", "CDM-1", "Concrete Damage Morphology", "classical",
        "Detecção morfológica CDM 2.8.5: fissuras, desplacamento, armadura exposta, corrosão e eflorescência.",
        recommended=True, domain_mode="classical",
    )

    def predict(self, image: Image.Image):
        return self.predict_configured(image, cdm.DetectorConfig())

    def predict_configured(self, image: Image.Image, cfg: cdm.DetectorConfig,
                           previous_image: Image.Image | None = None):
        rgb, (width, height) = cdm.image_to_array(image.convert("RGB"), cfg.max_processing_dimension)
        masks, pipeline = cdm.detect_masks(rgb, cfg, run_tag="t1")
        detections = []
        layers = []
        records_all = []
        composite = Image.new("RGBA", (width, height))

        for family in cdm.LAYER_ORDER:
            if family not in masks or family not in CURRENT_COLORS:
                continue
            records = cdm.records_from_mask(masks[family], family, "t1_current", cfg)
            records_all.extend(records)
            layer_image = _paint_records((width, height), records, CURRENT_COLORS[family])
            for record in records:
                x, y, w, h = record.bbox
                detections.append(Detection(
                    label=family, score=None, box=[x, y, x + w, y + h],
                    polygon=[[float(px), float(py)] for px, py in record.points],
                    area_px=record.area_px2,
                ))
            composite.alpha_composite(layer_image)
            layers.append({
                "id": family,
                "name": cdm.CLASS_LABELS[family],
                "color": "#%02x%02x%02x" % CURRENT_COLORS[family],
                "count": len(records),
                "overlay_png_base64": png_b64(layer_image),
            })

        temporal = {"enabled": False, "stats": {}, "records": [], "layers": []}
        if previous_image is not None:
            previous_resized = previous_image.convert("RGB").resize(
                (width, height), Image.Resampling.BILINEAR
            )
            previous_rgb = np.asarray(previous_resized, dtype=np.uint8)
            previous_rgb, alignment_info = cdm.align_previous_rgb(
                rgb, previous_rgb, cfg.alignment_method
            )
            aligned_previous_image = Image.fromarray(previous_rgb, mode="RGB")
            previous_masks, previous_pipeline = cdm.detect_masks(
                previous_rgb, cfg, run_tag="t0"
            )
            change_records, temporal_stats = cdm.temporal_records(masks, previous_masks, cfg)
            temporal_layers = []
            for change_class in ("growth", "reduction"):
                for source_class in cdm.PATHOLOGY_FAMILY_ORDER:
                    class_records = [
                        r for r in change_records
                        if r.damage_class == change_class
                        and _source_class(r) == source_class
                    ]
                    if not class_records:
                        continue
                    layer_image = _paint_records(
                        (width, height), class_records, TEMPORAL_COLORS[change_class]
                    )
                    temporal_layers.append({
                        "id": f"{change_class}:{source_class}",
                        "change_class": change_class,
                        "source_class": source_class,
                        "name": f"{TEMPORAL_LABELS[change_class]} · {cdm.CLASS_LABELS[source_class]}",
                        "color": "#%02x%02x%02x" % TEMPORAL_COLORS[change_class],
                        "count": len(class_records),
                        "overlay_png_base64": png_b64(layer_image),
                    })
            temporal = {
                "enabled": True,
                "alignment_method": alignment_info.get("method_applied", "resize"),
                "alignment": alignment_info,
                "aligned_reference_png_base64": (
                    png_b64(aligned_previous_image) if alignment_info.get("accepted") else None
                ),
                "stats": temporal_stats,
                "records": [_record_payload(r) for r in change_records],
                "layers": temporal_layers,
                "previous_protocol": previous_pipeline.get("protocol"),
            }

        summary = cdm.summarize_records(records_all, cfg.scale_info(), cfg, width * height)
        return EngineResult(
            engine_id=self.meta.id,
            name=self.meta.name,
            task=self.meta.task,
            status="ok",
            detections=detections,
            overlay_png_base64=png_b64(composite),
            metrics={
                "implementation": "CDM 2.8.5",
                "runtime": "python-numpy-pillow",
                "geometry_units": "processed_pixels",
                "processed_width": width,
                "processed_height": height,
                "mm_per_px": cfg.scale_info().mm_per_px,
                "layers": layers,
                "summary": summary,
                "records": [_record_payload(r) for r in records_all],
                "temporal": temporal,
                "protocol": pipeline["protocol"],
            },
            message=(
                "Máscaras morfológicas preliminares; pontuações de confiança não calibradas. "
                + ("Comparação t0/t1 calculada por máscaras alinhadas por redimensionamento."
                   if temporal["enabled"] else "")
            ).strip(),
        )
