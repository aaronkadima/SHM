import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app import cdm_v285 as cdm  # noqa: E402


WIDTH = 96
HEIGHT = 72


def synthetic_image(version: int) -> np.ndarray:
    y, x = np.mgrid[0:HEIGHT, 0:WIDTH]
    base = 176 + ((x * 13 + y * 17 + (x * y) % 11) % 9 - 4)
    rgb = np.repeat(base[:, :, None], 3, axis=2).astype(np.uint8)

    # Efflorescence: bright, low-saturation patch.
    rgb[7:18, 68:88] = np.array([238, 239, 236], dtype=np.uint8)

    # Apparent corrosion: red/orange chromatic patch.
    rgb[42:57, 8:23] = np.array([176, 92, 46], dtype=np.uint8)

    # Spalling/dark region; t1 is deliberately larger than t0.
    if version == 0:
        rgb[35:57, 43:68] = np.array([74, 94, 104], dtype=np.uint8)
    else:
        rgb[32:60, 40:73] = np.array([72, 92, 102], dtype=np.uint8)

    # Exposed reinforcement candidate inside the spalling context.
    if version == 0:
        rgb[44:48, 49:63] = np.array([48, 49, 50], dtype=np.uint8)
    else:
        rgb[43:48, 47:68] = np.array([46, 47, 48], dtype=np.uint8)

    # Crack-like dark elongated residual; t1 extends it.
    x0, x1 = (17, 58) if version == 0 else (13, 72)
    for xx in range(x0, x1):
        yy = 25 + ((xx // 9) % 2)
        rgb[yy:yy + 2, xx] = np.array([50, 50, 50], dtype=np.uint8)

    # A second small crack in t1 to exercise recurrence/count behavior.
    if version == 1:
        rgb[12:14, 27:45] = np.array([58, 58, 58], dtype=np.uint8)

    return rgb


def shift_image_edge(rgb: np.ndarray, shift_x: int, shift_y: int) -> np.ndarray:
    h, w = rgb.shape[:2]
    ys = np.clip(np.arange(h) - shift_y, 0, h - 1)
    xs = np.clip(np.arange(w) - shift_x, 0, w - 1)
    return rgb[ys[:, None], xs[None, :]].copy()


def mask_indices(mask: np.ndarray):
    return np.flatnonzero(mask.reshape(-1)).astype(int).tolist()


def record_digest(records):
    out = {}
    for cls in cdm.PATHOLOGY_FAMILY_ORDER:
        rows = [r for r in records if r.damage_class == cls and r.time_label == "t1_current"]
        out[cls] = {
            "count": len(rows),
            "area_sum": float(sum(r.area_px2 for r in rows)),
            "perimeter_sum": float(sum(r.perimeter_px for r in rows)),
            "length_sum": float(sum(r.length_px for r in rows)),
            "width_sum": float(sum(r.width_px for r in rows)),
            "bboxes": [list(r.bbox) for r in rows],
        }
    return out


def main(output_path: str):
    cfg = cdm.DetectorConfig(
        threshold=35,
        kernel_size=15,
        min_area=12,
        min_aspect_ratio=2.0,
        calibration_mode="manual_mm_per_px",
        mm_per_px=0.25,
        element_family="lajes_vigas_secundarias_apoios",
        structural_relevance_fr=4.0,
        alignment_method="translation_auto",
    )
    t0 = synthetic_image(0)
    t1 = synthetic_image(1)

    t1_records, t1_info = cdm.detect_records(t1, cfg, "t1_current")
    t0_records, t0_info = cdm.detect_records(t0, cfg, "t0_previous")
    t0_aligned, temporal_alignment = cdm.align_previous_rgb(t1, t0, cfg.alignment_method)
    _, t0_aligned_info = cdm.detect_records(t0_aligned, cfg, "t0_previous_aligned")
    change_records, temporal_stats = cdm.temporal_records(
        t1_info["masks"], t0_aligned_info["masks"], cfg
    )

    registration_current = synthetic_image(1)
    registration_previous = shift_image_edge(registration_current, 6, -4)
    registration_aligned, registration_metrics = cdm.align_previous_rgb(
        registration_current, registration_previous, "translation_auto"
    )
    registration_error_before = float(
        np.mean(np.abs(registration_current.astype(np.float32) - registration_previous.astype(np.float32)))
    )
    registration_error_after = float(
        np.mean(np.abs(registration_current.astype(np.float32) - registration_aligned.astype(np.float32)))
    )
    summary = cdm.summarize_records(t1_records, cfg.scale_info(), cfg, WIDTH * HEIGHT)
    rating = summary["condition_rating"]

    fixture = {
        "width": WIDTH,
        "height": HEIGHT,
        "config": {
            "threshold": cfg.threshold,
            "kernel": cfg.normalized_kernel_size,
            "minArea": cfg.min_area,
            "minAspect": cfg.min_aspect_ratio,
            "mmPerPx": cfg.mm_per_px,
            "elementFamily": cfg.element_family,
            "alignmentMethod": cfg.alignment_method,
        },
        "t0_rgb": t0.reshape(-1).astype(int).tolist(),
        "t1_rgb": t1.reshape(-1).astype(int).tolist(),
        "expected": {
            "t0_masks": {k: mask_indices(v) for k, v in t0_info["masks"].items()},
            "t1_masks": {k: mask_indices(v) for k, v in t1_info["masks"].items()},
            "records": record_digest(t1_records),
            "summary": {
                "total_objects": int(summary["total_objects"]),
                "spalling_area_px2": float(summary["spalling_area_px2"]),
                "rebar_area_px2": float(summary["rebar_area_px2"]),
                "crack_count": int(summary["crack_count"]),
                "crack_length_total_px": float(summary["crack_length_total_px"]),
                "crack_width_mean_px": float(summary["crack_width_mean_px"]),
            },
            "rating": {
                "NT_img": int(rating["NT_img"]),
                "EC_DNIT_img": int(rating["EC_DNIT_img"]),
                "GDE_img": float(rating["GDE_img"]),
                "affected_area_ratio": float(rating["affected_area_ratio"]),
            },
            "temporal_alignment": temporal_alignment,
            "temporal_stats": temporal_stats,
            "temporal_counts": {
                "growth": sum(r.damage_class == "growth" for r in change_records),
                "reduction": sum(r.damage_class == "reduction" for r in change_records),
            },
            "temporal_by_source": {
                cls: {
                    "growth": sum(r.time_label == f"growth_{cls}" for r in change_records),
                    "reduction": sum(r.time_label == f"reduction_{cls}" for r in change_records),
                }
                for cls in cdm.PATHOLOGY_FAMILY_ORDER
            },
        },
        "registration_case": {
            "current_rgb": registration_current.reshape(-1).astype(int).tolist(),
            "previous_rgb": registration_previous.reshape(-1).astype(int).tolist(),
            "known_camera_shift": {"x": 6, "y": -4},
            "expected": {
                "alignment": registration_metrics,
                "mean_abs_error_before": registration_error_before,
                "mean_abs_error_after": registration_error_after,
            },
        },
    }
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(fixture, ensure_ascii=False), encoding="utf-8")
    print(f"CDM Python parity fixture written to {path}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: generate_cdm_parity_fixture.py OUTPUT.json")
    main(sys.argv[1])
