"""Casos de referência (Python) para o relatório de paridade CDM Python ⇄ navegador.

Gera um lote de cenas sintéticas determinísticas e, para cada uma, exporta as etapas
intermediárias de cdm_v285.detect_masks (cinza, resposta, candidata, abertura, máscara
final), o esqueleto podado das fissuras e os registros vetorizados. O script
frontend/scripts/build-cdm-parity-report.mjs roda o motor JavaScript nas mesmas cenas
e calcula os indicadores (PMR, IoU cruzado, L∞, ΔCC, esqueleto, medidas físicas).

Uso: python backend/tests/generate_cdm_parity_report_cases.py SAIDA.json
"""
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app import cdm_v285 as cdm  # noqa: E402
from generate_cdm_parity_fixture import synthetic_image  # noqa: E402

STAGES = ("raw_mask", "open_mask", "clean_mask")


def scene(seed: int, width: int, height: int) -> np.ndarray:
    """Concreto sintético: textura, fissuras poligonais, desplacamento, corrosão e eflorescência."""
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:height, 0:width]
    base = 168 + rng.normal(0, 6, (height, width)) + 6 * np.sin(x / (7 + seed % 5)) * np.cos(y / (9 + seed % 3))
    rgb = np.repeat(base[:, :, None], 3, axis=2)
    rgb[:, :, 2] -= 6
    # fissuras: polilinhas escuras com largura 1–3 px
    for _ in range(int(rng.integers(1, 4))):
        pts = [(int(rng.integers(5, width - 5)), int(rng.integers(5, height - 5)))]
        for _ in range(int(rng.integers(3, 7))):
            px, py = pts[-1]
            pts.append((int(np.clip(px + rng.integers(-28, 29), 2, width - 3)), int(np.clip(py + rng.integers(-20, 21), 2, height - 3))))
        thick = int(rng.integers(1, 4))
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            steps = max(abs(x1 - x0), abs(y1 - y0), 1)
            for t in np.linspace(0, 1, steps + 1):
                cx, cy = int(round(x0 + (x1 - x0) * t)), int(round(y0 + (y1 - y0) * t))
                rgb[max(0, cy - thick // 2):cy + (thick + 1) // 2, max(0, cx - thick // 2):cx + (thick + 1) // 2] = 52 + rng.integers(0, 10)
    # desplacamento escuro (elipse) com armadura exposta interna em algumas cenas
    if seed % 4 != 3:
        cx, cy = rng.integers(width // 4, 3 * width // 4), rng.integers(height // 4, 3 * height // 4)
        rx, ry = rng.integers(10, width // 5), rng.integers(8, height // 5)
        blob = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1
        rgb[blob] = np.array([78, 90, 98]) + rng.normal(0, 4, (int(blob.sum()), 1))
        if seed % 2 == 0:
            bar = blob & (np.abs(y - cy) <= 1) & (np.abs(x - cx) <= rx * 0.7)
            rgb[bar] = 44
    # corrosão aparente
    if seed % 3 != 2:
        x0, y0 = int(rng.integers(0, width - 20)), int(rng.integers(0, height - 16))
        rgb[y0:y0 + int(rng.integers(8, 16)), x0:x0 + int(rng.integers(10, 20))] = np.array([178, 94, 48])
    # eflorescência
    if seed % 3 != 1:
        x0, y0 = int(rng.integers(0, width - 24)), int(rng.integers(0, height - 14))
        rgb[y0:y0 + int(rng.integers(6, 14)), x0:x0 + int(rng.integers(12, 24))] = np.array([236, 238, 234])
    return np.clip(rgb, 0, 255).astype(np.uint8)


def indices(mask: np.ndarray):
    return np.flatnonzero(mask.reshape(-1)).astype(int).tolist()


def quant(values: np.ndarray, digits: int = 3):
    return np.round(values.astype(np.float64).reshape(-1), digits).tolist()


def case_payload(name: str, rgb: np.ndarray, cfg) -> dict:
    h, w = rgb.shape[:2]
    masks, pipeline = cdm.detect_masks(rgb, cfg)
    classes = {}
    for cls in cdm.PATHOLOGY_FAMILY_ORDER:
        stage = pipeline[cls]
        classes[cls] = {
            "response": quant(stage["response"]),
            **{key: indices(stage[key]) for key in STAGES},
        }
        records = cdm.records_from_mask(masks[cls], cls, "t1_current", cfg)
        classes[cls]["records"] = [
            {"bbox": list(r.bbox), "area": float(r.area_px2), "length": float(r.length_px), "width": float(r.width_px)}
            for r in records
        ]
    fragments = cdm.crack_fragments(masks["cracks"].astype(bool), max(1.0, float(cfg.min_area)))
    bridged = cdm.close_bool(fragments, cdm.CRACK_BRIDGE_KERNEL) | fragments
    skeleton = cdm.prune_spurs(cdm.zhang_suen(bridged))
    return {
        "name": name,
        "width": w,
        "height": h,
        "rgb": rgb.reshape(-1).astype(int).tolist(),
        "python": {"gray": quant(pipeline["gray"]), "classes": classes, "crack_skeleton": indices(skeleton)},
    }


def main(output_path: str) -> None:
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
    cases = [case_payload("fixture_t1", synthetic_image(1), cfg), case_payload("fixture_t0", synthetic_image(0), cfg)]
    sizes = [(160, 120), (160, 120), (200, 150), (200, 150), (240, 160), (240, 160), (180, 180), (220, 140)]
    for seed, (w, h) in enumerate(sizes, start=1):
        cases.append(case_payload(f"cena_{seed:02d}", scene(seed, w, h), cfg))
    payload = {
        "schema": "cdm_parity_cases_v1",
        "python": {"numpy": np.__version__, "module": "backend/app/cdm_v285.py"},
        "config": {
            "threshold": cfg.threshold,
            "kernel": cfg.normalized_kernel_size,
            "minArea": cfg.min_area,
            "minAspect": cfg.min_aspect_ratio,
            "mmPerPx": cfg.mm_per_px,
            "elementFamily": cfg.element_family,
        },
        "classes": list(cdm.PATHOLOGY_FAMILY_ORDER),
        "cases": cases,
    }
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"CDM parity cases written to {path} ({len(cases)} cases)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: generate_cdm_parity_report_cases.py OUTPUT.json")
    main(sys.argv[1])
