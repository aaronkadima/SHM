"""CDM-1: execute the user's CDM v2.8.5 morphology code without Inkscape UI."""
import numpy as np
from PIL import Image

from .base import AdapterMeta, EngineAdapter, png_b64
from .. import cdm_v285 as cdm
from ..schemas import Detection, EngineResult


class CDM1Adapter(EngineAdapter):
    meta = AdapterMeta(
        "cdm_1", "CDM-1", "Concrete Damage Morphology", "classical",
        "Detecção morfológica CDM 2.8.5: fissuras, desplacamento, armadura exposta, corrosão e eflorescência.",
        recommended=True, domain_mode="classical",
    )

    def predict(self, image: Image.Image):
        return self.predict_configured(image, cdm.DetectorConfig())

    def predict_configured(self, image: Image.Image, cfg: cdm.DetectorConfig):
        rgb, (width, height) = cdm.image_to_array(image.convert("RGB"), cfg.max_processing_dimension)
        masks, pipeline = cdm.detect_masks(rgb, cfg)
        detections = []
        layers = []
        records_all = []
        composite = Image.new("RGBA", (width, height))
        colors = {
            "cracks": (230, 0, 0),
            "spalling_dark": (255, 153, 0),
            "exposed_rebar": (140, 140, 140),
            "corrosion_rust": (139, 63, 0),
            "efflorescence_white": (0, 102, 204),
        }
        for family in cdm.LAYER_ORDER:
            if family not in masks or family not in colors:
                continue
            records = cdm.records_from_mask(masks[family], family, "t1_current", cfg)
            records_all.extend(records)
            # Keep the exact accepted connected components from CDM, rather than
            # painting candidates that its geometry filters rejected.
            layer_arr = np.zeros((height, width, 4), dtype=np.uint8)
            for record in records:
                x, y, w, h = record.bbox
                points = [[float(px), float(py)] for px, py in record.points]
                detections.append(Detection(
                    label=family, score=None, box=[x, y, x + w, y + h], polygon=points,
                    area_px=record.area_px2,
                ))
                # Geometry is rasterized from the record, not the entire raw mask.
                from PIL import ImageDraw
                region = Image.new("L", (width, height))
                draw = ImageDraw.Draw(region)
                if record.is_closed:
                    draw.polygon([tuple(p) for p in record.points], fill=255)
                else:
                    draw.line([tuple(p) for p in record.points], fill=255, width=max(1, round(record.width_px)))
                region_np = np.asarray(region) > 0
                layer_arr[region_np, :3] = colors[family]
                layer_arr[region_np, 3] = 150
            layer_image = Image.fromarray(layer_arr, "RGBA")
            composite.alpha_composite(layer_image)
            layers.append({
                "id": family, "name": cdm.CLASS_LABELS[family],
                "color": "#%02x%02x%02x" % colors[family],
                "count": len(records), "overlay_png_base64": png_b64(layer_image),
            })
        summary = cdm.summarize_records(records_all, cfg.scale_info(), cfg, width * height)
        return EngineResult(
            engine_id=self.meta.id, name=self.meta.name, task=self.meta.task,
            status="ok", detections=detections,
            overlay_png_base64=png_b64(composite),
            metrics={"implementation": "CDM 2.8.5", "runtime": "python-numpy-pillow",
                     "geometry_units": "processed_pixels", "processed_width": width,
                     "processed_height": height, "mm_per_px": cfg.scale_info().mm_per_px,
                     "layers": layers,
                     "summary": summary,
                     "records": [{"id": r.record_id, "class": r.damage_class,
                                  "bbox": list(r.bbox), "points": [list(p) for p in r.points],
                                  "closed": r.is_closed, "area_px2": r.area_px2,
                                  "perimeter_px": r.perimeter_px, "length_px": r.length_px,
                                  "width_px": r.width_px, "aspect_ratio": r.aspect_ratio,
                                  "confidence_note": r.confidence_note} for r in records_all],
                     "protocol": pipeline["protocol"]},
            message="Máscaras morfológicas preliminares; pontuações de confiança não calibradas.",
        )
