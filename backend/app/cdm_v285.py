#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Concrete Damage Morphology v2.8.5 - Native Inkscape No OpenCV

Inkscape extension + standalone CLI for preliminary morphological detection of
visual damage indicators in reinforced concrete structures.

This build intentionally avoids cv2/OpenCV because some embedded Inkscape Python
installations cannot install OpenCV wheels. It uses Pillow + NumPy + lxml.

Added in v2.8.5:
- exposed rebar detection constrained inside spalling areas
- exposed rebar layer ordered below the spalling layer
- results popup window with counts, spalling area, crack length and estimated width
- CSV updated with estimated crack width and exposed rebar metrics
- minimalist tabbed Inkscape interface
- optional DXF export with CAD layers by pathology class
- optional BIM/IFC-overlay metadata export as JSON
- scientific pipeline figure export for article/report usage
"""

from __future__ import annotations

import argparse
import base64
import csv
import json
import dataclasses
import math
import os
import sys
import tempfile
import importlib.util
import time
import platform
import tracemalloc
from contextlib import contextmanager
from collections import deque
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple
from urllib.parse import unquote, urlparse

try:
    import tkinter as tk  # type: ignore
    from tkinter import messagebox  # type: ignore
except Exception:
    tk = None  # type: ignore
    messagebox = None  # type: ignore

MISSING_DEPENDENCIES: List[Tuple[str, str, str]] = []

try:
    import numpy as np  # type: ignore
except Exception as exc:
    np = None  # type: ignore
    MISSING_DEPENDENCIES.append(("numpy", "numpy", str(exc)))

try:
    from PIL import Image, ImageOps, ImageFilter, ImageDraw, ImageFont  # type: ignore
except Exception as exc:
    Image = None  # type: ignore
    ImageOps = None  # type: ignore
    ImageFilter = None  # type: ignore
    ImageDraw = None  # type: ignore
    ImageFont = None  # type: ignore
    MISSING_DEPENDENCIES.append(("PIL", "Pillow", str(exc)))

# scipy é opcional: quando presente, a morfologia fica ~60x mais rápida.
# Quando ausente (Python embutido do Inkscape), caímos para Pillow, que usa
# memória limitada e evita o MemoryError do sliding_window_view em imagens grandes.
try:
    from scipy.ndimage import maximum_filter as _scipy_max  # type: ignore
    from scipy.ndimage import minimum_filter as _scipy_min  # type: ignore
    _HAVE_SCIPY = True
except Exception:
    _scipy_max = None  # type: ignore
    _scipy_min = None  # type: ignore
    _HAVE_SCIPY = False

try:
    from lxml import etree  # type: ignore
except Exception as exc:
    etree = None  # type: ignore
    MISSING_DEPENDENCIES.append(("lxml", "lxml", str(exc)))

try:
    import inkex  # type: ignore
except Exception:
    inkex = None  # type: ignore

if MISSING_DEPENDENCIES:
    sys.stderr.write(
        "\nERRO: dependências ausentes no Python usado pelo Inkscape.\n"
        "Esta versão NÃO usa OpenCV/cv2. Instale apenas Pillow, numpy e lxml.\n\n"
        "Comando recomendado no Windows:\n"
        r'"C:\Program Files\Inkscape\bin\python.exe" -m pip install --user --upgrade --prefer-binary --only-binary=:all: Pillow numpy lxml'
        "\n\nDetalhes:\n"
    )
    for mod_name, package_name, err in MISSING_DEPENDENCIES:
        sys.stderr.write(f"- {mod_name} [{package_name}]: {err}\n")
    sys.exit(1)

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"
INKSCAPE_NS = "http://www.inkscape.org/namespaces/inkscape"
SODIPODI_NS = "http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
NSMAP = {None: SVG_NS, "xlink": XLINK_NS, "inkscape": INKSCAPE_NS, "sodipodi": SODIPODI_NS}


def _working_set_bytes() -> Optional[int]:
    """Return the current resident/working-set memory without requiring psutil.

    On Windows, this uses GetProcessMemoryInfo; on Linux, /proc/self/statm is
    preferred. The value is sampled at stage boundaries, therefore it is an
    observed working-set peak, not a continuous OS-level peak.
    """
    try:
        if os.name == "nt":
            import ctypes
            from ctypes import wintypes
            class PROCESS_MEMORY_COUNTERS_EX(ctypes.Structure):
                _fields_ = [
                    ("cb", wintypes.DWORD),
                    ("PageFaultCount", wintypes.DWORD),
                    ("PeakWorkingSetSize", ctypes.c_size_t),
                    ("WorkingSetSize", ctypes.c_size_t),
                    ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                    ("PagefileUsage", ctypes.c_size_t),
                    ("PeakPagefileUsage", ctypes.c_size_t),
                    ("PrivateUsage", ctypes.c_size_t),
                ]
            counters = PROCESS_MEMORY_COUNTERS_EX()
            counters.cb = ctypes.sizeof(counters)
            handle = ctypes.windll.kernel32.GetCurrentProcess()
            ok = ctypes.windll.psapi.GetProcessMemoryInfo(handle, ctypes.byref(counters), counters.cb)
            return int(counters.WorkingSetSize) if ok else None
        statm = Path('/proc/self/statm')
        if statm.exists():
            pages = int(statm.read_text().split()[1])
            return pages * int(os.sysconf('SC_PAGE_SIZE'))
    except Exception:
        return None
    return None


def _morphology_backend_label() -> str:
    if _HAVE_SCIPY:
        return "SciPy ndimage minimum/maximum filters"
    if ImageFilter is not None:
        return "Pillow rank-filter fallback"
    return "NumPy sliding-window fallback"


class PerformanceProfiler:
    """Low-dependency execution profiler for one plugin run.

    The profiler captures wall time, CPU time and sampled working-set memory for
    the actual run. Optional tracemalloc captures Python-managed allocation peak
    only; NumPy/SciPy native allocations may not be fully visible there.
    """
    def __init__(self, enabled: bool = True, trace_python_allocations: bool = False):
        self.enabled = bool(enabled)
        self.trace_python_allocations = bool(trace_python_allocations)
        self.started = time.perf_counter()
        self.cpu_started = time.process_time()
        self.rss_start = _working_set_bytes() if self.enabled else None
        self.rss_peak_sampled = self.rss_start
        self.stages: List[Dict[str, object]] = []
        self._tracing_owner = False
        self._finished = False
        if self.enabled and self.trace_python_allocations:
            try:
                if not tracemalloc.is_tracing():
                    tracemalloc.start()
                    self._tracing_owner = True
            except Exception:
                pass

    @contextmanager
    def stage(self, name: str):
        if not self.enabled:
            yield
            return
        wall0 = time.perf_counter()
        cpu0 = time.process_time()
        try:
            yield
        finally:
            wall = max(0.0, time.perf_counter() - wall0)
            cpu = max(0.0, time.process_time() - cpu0)
            rss = _working_set_bytes()
            if rss is not None:
                self.rss_peak_sampled = max(self.rss_peak_sampled or 0, rss)
            self.stages.append({
                "stage": name,
                "wall_s": wall,
                "cpu_s": cpu,
                "working_set_after_bytes": rss,
            })

    def finish(self, metadata: Optional[Dict[str, object]] = None) -> Dict[str, object]:
        if self._finished:
            return {"enabled": self.enabled, "stages": self.stages}
        self._finished = True
        wall_total = max(0.0, time.perf_counter() - self.started)
        cpu_total = max(0.0, time.process_time() - self.cpu_started)
        rss_end = _working_set_bytes() if self.enabled else None
        if rss_end is not None:
            self.rss_peak_sampled = max(self.rss_peak_sampled or 0, rss_end)
        py_current = py_peak = None
        if self.trace_python_allocations:
            try:
                if tracemalloc.is_tracing():
                    py_current, py_peak = tracemalloc.get_traced_memory()
                if self._tracing_owner and tracemalloc.is_tracing():
                    tracemalloc.stop()
            except Exception:
                pass
        data: Dict[str, object] = {
            "schema": "cdm_computational_profile_v285",
            "enabled": self.enabled,
            "scope": "One actual plugin execution. HTML composition time is excluded to avoid self-reference.",
            "wall_total_s": wall_total,
            "cpu_total_s": cpu_total,
            "cpu_to_wall_pct": (100.0 * cpu_total / wall_total) if wall_total > 1e-9 else 0.0,
            "working_set_start_bytes": self.rss_start,
            "working_set_end_bytes": rss_end,
            "working_set_peak_sampled_bytes": self.rss_peak_sampled,
            "python_allocation_trace_enabled": self.trace_python_allocations,
            "python_traced_current_bytes": py_current,
            "python_traced_peak_bytes": py_peak,
            "stages": self.stages,
            "environment": {
                "platform": platform.platform(),
                "python": sys.version.split()[0],
                "interpreter": sys.executable,
                "logical_cpu_cores": os.cpu_count(),
                "numpy_version": getattr(np, "__version__", "unknown"),
                "pillow_version": getattr(Image, "__version__", "unknown"),
                "scipy_available": bool(_HAVE_SCIPY),
                "morphology_backend": _morphology_backend_label(),
                "inkex_available": inkex is not None,
                "inkex_version": getattr(inkex, "__version__", "not exposed") if inkex is not None else "not available",
            },
        }
        if metadata:
            data.update(metadata)
        return data


def _profile_stage(profiler: Optional[PerformanceProfiler], name: str):
    return profiler.stage(name) if profiler is not None else _null_context()


@contextmanager
def _null_context():
    yield


@dataclasses.dataclass
class ImagePlacement:
    x: float = 0.0
    y: float = 0.0
    width_svg: float = 0.0
    height_svg: float = 0.0
    width_px: int = 0
    height_px: int = 0

    def map_point(self, px: float, py: float) -> Tuple[float, float]:
        sx = self.width_svg / max(1, self.width_px)
        sy = self.height_svg / max(1, self.height_px)
        return self.x + px * sx, self.y + py * sy


@dataclasses.dataclass
class DamageRecord:
    record_id: str
    damage_class: str
    time_label: str
    points: List[Tuple[float, float]]
    is_closed: bool
    area_px2: float
    perimeter_px: float
    bbox: Tuple[int, int, int, int]
    aspect_ratio: float
    length_px: float
    width_px: float
    confidence_note: str


@dataclasses.dataclass
class ScaleInfo:
    calibration_mode: str = "px_only"
    mm_per_px: Optional[float] = None

    def px_to_mm(self, value_px: float) -> Optional[float]:
        return None if self.mm_per_px is None else value_px * self.mm_per_px

    def px2_to_mm2(self, value_px2: float) -> Optional[float]:
        return None if self.mm_per_px is None else value_px2 * (self.mm_per_px ** 2)


@dataclasses.dataclass
class DetectorConfig:
    source_mode: str = "selected_or_external"
    image_path: str = ""
    previous_image_path: str = ""
    detection_scope: str = "all"
    threshold: int = 35
    kernel_size: int = 15
    min_area: float = 30.0
    min_aspect_ratio: float = 2.0
    approx_epsilon: float = 1.5
    stroke_width: float = 1.0
    include_original_image: bool = True
    show_debug_masks: bool = False
    export_csv: bool = False
    csv_output_path: str = ""
    export_dxf: bool = False
    dxf_output_path: str = ""
    export_bim_json: bool = False
    bim_json_output_path: str = ""
    export_coco: bool = False
    coco_output_path: str = ""
    export_ifc: bool = False
    ifc_output_path: str = ""
    export_html: bool = False
    html_output_path: str = ""
    export_pipeline_figures: bool = False
    pipeline_output_dir: str = ""
    profile_performance: bool = True
    profile_python_allocations: bool = False
    export_performance_json: bool = False
    export_performance_csv: bool = False
    output_dir: str = ""
    output_mode: str = "image_folder"
    save_state_after_run: bool = True
    use_saved_state_for_empty_fields: bool = True
    bim_project_id: str = ""
    bim_element_guid: str = ""
    bim_surface_id: str = ""
    bim_coordinate_system: str = "image_local"
    calibration_mode: str = "px_only"
    mm_per_px: float = 0.0
    reference_length_px: float = 0.0
    reference_length_mm: float = 0.0
    compare_previous: bool = False
    alignment_method: str = "translation_auto"
    output_svg: str = ""
    max_processing_dimension: int = 1600
    show_results_popup: bool = True
    clean_previous_outputs: bool = True
    language: str = "pt"
    enable_condition_rating: bool = True
    element_family: str = "lajes_vigas_secundarias_apoios"
    structural_relevance_fr: float = 4.0
    reference_area_mode: str = "image_area"
    reference_area_px2: float = 0.0
    environmental_aggressiveness: str = "moderate"
    allow_auto_emergency_nt0: bool = False
    use_ordinal_normative_method: bool = True
    ordinal_tau1: float = 0.25
    ordinal_tau2: float = 0.50
    ordinal_tau3: float = 0.75
    recurrence_threshold: int = 5
    extension_threshold: float = 0.015
    critical_weight_threshold: float = 4.0
    include_cracks_in_rating: bool = True
    include_spalling_in_rating: bool = True
    include_rebar_in_rating: bool = True
    include_corrosion_in_rating: bool = True
    include_efflorescence_in_rating: bool = True

    @property
    def normalized_kernel_size(self) -> int:
        k = max(3, int(self.kernel_size))
        if k % 2 == 0:
            k += 1
        return k

    def scale_info(self) -> ScaleInfo:
        if self.calibration_mode == "manual_mm_per_px" and self.mm_per_px > 0:
            return ScaleInfo(self.calibration_mode, self.mm_per_px)
        if self.calibration_mode == "reference_length" and self.reference_length_px > 0 and self.reference_length_mm > 0:
            return ScaleInfo(self.calibration_mode, self.reference_length_mm / self.reference_length_px)
        return ScaleInfo("px_only", None)


CLASS_LABELS = {
    "cracks": "Fissuras",
    "spalling_dark": "Desplacamento/região escura",
    "exposed_rebar": "Armadura exposta",
    "corrosion_rust": "Corrosão aparente",
    "efflorescence_white": "Eflorescência/região clara",
    "growth": "Crescimento entre inspeções",
    "reduction": "Redução/ausência na inspeção atual",
}


PATHOLOGY_FAMILY_ORDER = ["cracks", "spalling_dark", "exposed_rebar", "corrosion_rust", "efflorescence_white"]


def family_included_in_rating(damage_class: str, cfg: DetectorConfig) -> bool:
    return {
        "cracks": bool(cfg.include_cracks_in_rating),
        "spalling_dark": bool(cfg.include_spalling_in_rating),
        "exposed_rebar": bool(cfg.include_rebar_in_rating),
        "corrosion_rust": bool(cfg.include_corrosion_in_rating),
        "efflorescence_white": bool(cfg.include_efflorescence_in_rating),
    }.get(damage_class, True)

CLASSIFICATION_EQUATIONS_LATEX = [
    r"s_{img} \in [0,1]",
    r"EC_{rank}=1+\sum_{k=1}^{3}\mathbf{1}[s_{img}\ge\tau_k]",
    r"EC_{DNIT}=5-EC_{rank}",
    r"EC_{fam}=\min(4,\max_i EC_{rank,i}+\delta_{fam})",
    r"EC_{elem}=\min(4,\max_i EC_{rank,i}+\delta)",
    r"NT_{img}=f(EC_{elem},F_r)",
    r"D=0.8F_iF_p\;(F_i\le2);\quad D=(12F_i-28)F_p\;(F_i>2)",
    r"GDE=D_{max}\left[1+\frac{\sum D_i-D_{max}}{\sum D_i}\right]",
]

# Native Inkscape INX labels do not render TeX. These Unicode formulas are used
# in the dialog, SVG panels and CSV to avoid raw underscores such as s_img.
CLASSIFICATION_EQUATIONS_UNICODE = [
    "𝑠ᵢₘg ∈ [0,1]",
    "ECᵣₐₙₖ = 1 + ∑ₖ₌₁³ 𝟙[𝑠ᵢₘg ≥ τₖ]",
    "ECᴰᴺᴵᵀ = 5 − ECᵣₐₙₖ",
    "ECfₐₘ = min(4, maxᵢ ECᵣₐₙₖ,ᵢ + δfₐₘ)",
    "ECₑₗₑₘ = min(4, maxᵢ ECᵣₐₙₖ,ᵢ + δ)",
    "NTᵢₘg = f(ECₑₗₑₘ, Fᵣ)",
    "D = 0,8·Fᵢ·Fₚ se Fᵢ≤2;  D = (12Fᵢ−28)·Fₚ se Fᵢ>2",
    "GDE = Dₘₐₓ · [1 + (∑Dᵢ − Dₘₐₓ)/∑Dᵢ]",
]

CLASS_LABELS_I18N = {
    "pt": CLASS_LABELS,
    "en": {
        "cracks": "Cracks",
        "spalling_dark": "Spalling/dark region",
        "exposed_rebar": "Exposed reinforcement",
        "corrosion_rust": "Apparent corrosion",
        "efflorescence_white": "Efflorescence/light region",
        "growth": "Growth between inspections",
        "reduction": "Reduction/absence in current inspection",
    },
    "fr": {
        "cracks": "Fissures",
        "spalling_dark": "Écaillage/région sombre",
        "exposed_rebar": "Armature exposée",
        "corrosion_rust": "Corrosion apparente",
        "efflorescence_white": "Efflorescence/région claire",
        "growth": "Croissance entre inspections",
        "reduction": "Réduction/absence dans l’inspection actuelle",
    },
}


def normalize_language(language: str) -> str:
    language = (language or "pt").lower().strip()
    return language if language in CLASS_LABELS_I18N else "pt"


def label_for(key: str, language: str = "pt") -> str:
    lang = normalize_language(language)
    return CLASS_LABELS_I18N.get(lang, CLASS_LABELS).get(key, CLASS_LABELS.get(key, key))

CLASS_STYLES = {
    "cracks": {"stroke": "#e60000", "fill": "none", "fill_opacity": "0.00", "stroke_opacity": "0.95"},
    "spalling_dark": {"stroke": "#ff9900", "fill": "#ff9900", "fill_opacity": "0.22", "stroke_opacity": "0.95"},
    "exposed_rebar": {"stroke": "#555555", "fill": "#8c8c8c", "fill_opacity": "0.55", "stroke_opacity": "0.98"},
    "corrosion_rust": {"stroke": "#8b3f00", "fill": "#8b3f00", "fill_opacity": "0.28", "stroke_opacity": "0.95"},
    "efflorescence_white": {"stroke": "#0066cc", "fill": "#ffffff", "fill_opacity": "0.35", "stroke_opacity": "0.95"},
    "growth": {"stroke": "#00aa00", "fill": "#00aa00", "fill_opacity": "0.28", "stroke_opacity": "0.95"},
    "reduction": {"stroke": "#7a00cc", "fill": "#7a00cc", "fill_opacity": "0.22", "stroke_opacity": "0.95"},
}

LAYER_ORDER = ["exposed_rebar", "spalling_dark", "corrosion_rust", "efflorescence_white", "cracks", "growth", "reduction"]


DAMAGE_WEIGHTS_FP = {
    "cracks": 3.0,
    "spalling_dark": 4.0,
    "exposed_rebar": 5.0,
    "corrosion_rust": 5.0,
    "efflorescence_white": 2.0,
}

FAMILY_FR = {
    "barreiras_guarda_corpo_pista": 1.0,
    "juntas_dilatacao": 2.0,
    "transversinas_cortinas_alas": 3.0,
    "lajes_vigas_secundarias_apoios": 4.0,
    "vigas_pilares_principais": 5.0,
}

FAMILY_LABELS = {
    "barreiras_guarda_corpo_pista": "Barreiras/guarda-corpo/pista",
    "juntas_dilatacao": "Juntas de dilatação",
    "transversinas_cortinas_alas": "Transversinas/cortinas/alas",
    "lajes_vigas_secundarias_apoios": "Lajes/vigas secundárias/aparelhos de apoio",
    "vigas_pilares_principais": "Vigas e pilares principais",
}


def log_error(message: str) -> None:
    if inkex is not None:
        try:
            inkex.errormsg(message)
            return
        except Exception:
            pass
    print(message, file=sys.stderr)


def parse_float(value: Optional[str], default: float = 0.0) -> float:
    if value is None:
        return default
    text = str(value).strip().replace("px", "")
    try:
        return float(text)
    except Exception:
        return default


def safe_mean(values: List[float]) -> float:
    return float(sum(values) / len(values)) if values else 0.0


def mm_or_px_label(value_px: float, scale: ScaleInfo) -> str:
    if scale.mm_per_px is None:
        return f"{value_px:.2f} px"
    mm = scale.px_to_mm(value_px)
    return f"{mm:.2f} mm" if mm is not None else f"{value_px:.2f} px"


def area_mm2_or_px_label(value_px2: float, scale: ScaleInfo) -> str:
    if scale.mm_per_px is None:
        return f"{value_px2:.2f} px²"
    mm2 = scale.px2_to_mm2(value_px2)
    return f"{mm2:.2f} mm² ({mm2 / 100.0:.2f} cm²)" if mm2 is not None else f"{value_px2:.2f} px²"


def read_image(path: str) -> Image.Image:
    try:
        img = Image.open(path)
        return ImageOps.exif_transpose(img).convert("RGB")
    except Exception as exc:
        raise ValueError(f"Pillow não conseguiu abrir a imagem: {path}. Detalhe: {exc}")


def image_to_array(img: Image.Image, max_dim: int = 1600) -> Tuple[np.ndarray, Tuple[int, int]]:
    w, h = img.size
    if max(w, h) > max_dim:
        scale = max_dim / float(max(w, h))
        new_size = (max(1, int(w * scale)), max(1, int(h * scale)))
        img = img.resize(new_size, Image.Resampling.BILINEAR)
    arr = np.asarray(img, dtype=np.uint8)
    return arr, img.size


def rgb_to_gray(rgb: np.ndarray) -> np.ndarray:
    arr = rgb.astype(np.float32)
    return (0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]).astype(np.float32)


def contrast_stretch(gray: np.ndarray) -> np.ndarray:
    p2 = float(np.percentile(gray, 2))
    p98 = float(np.percentile(gray, 98))
    if p98 <= p2 + 1e-6:
        return gray.copy()
    out = (gray - p2) * 255.0 / (p98 - p2)
    return np.clip(out, 0, 255).astype(np.float32)


def _registration_edge_map(rgb: np.ndarray, max_side: int = 160) -> Tuple[np.ndarray, int]:
    """Low-cost luminance edge map used for deterministic translation registration."""
    gray = rgb_to_gray(rgb)
    h, w = gray.shape
    step = max(1, int(math.ceil(max(h, w) / float(max_side))))
    small = gray[::step, ::step].astype(np.float32, copy=False)
    edge = np.zeros_like(small, dtype=np.float32)
    if small.shape[0] >= 3 and small.shape[1] >= 3:
        edge[1:-1, 1:-1] = (
            np.abs(small[1:-1, 2:] - small[1:-1, :-2])
            + np.abs(small[2:, 1:-1] - small[:-2, 1:-1])
        )
    return edge, step


def estimate_translation_registration(current_rgb: np.ndarray, previous_rgb: np.ndarray) -> Dict[str, object]:
    """Estimate a conservative integer translation of t0 into t1 coordinates.

    The score compares a fixed central ROI on low-resolution luminance edge maps.
    Keeping the ROI fixed makes every candidate use the same number of samples and
    avoids favoring large shifts merely because they reduce overlap.
    """
    if current_rgb.shape != previous_rgb.shape:
        raise ValueError("Registration requires equal current/previous image shapes.")
    edge_cur, step = _registration_edge_map(current_rgb)
    edge_prev, step_prev = _registration_edge_map(previous_rgb)
    if step_prev != step or edge_prev.shape != edge_cur.shape:
        return {
            "method_requested": "translation_auto",
            "method_applied": "resize",
            "accepted": False,
            "reason": "registration_grid_mismatch",
            "dx_px": 0,
            "dy_px": 0,
            "estimated_dx_px": 0,
            "estimated_dy_px": 0,
            "score_before": 0.0,
            "score_after": 0.0,
            "improvement": 0.0,
            "downsample_step": int(step),
            "search_radius_px": 0,
        }

    hs, ws = edge_cur.shape
    full_h, full_w = current_rgb.shape[:2]
    search_full = min(96, max(6, int(round(min(full_h, full_w) * 0.12))))
    radius = max(1, int(math.ceil(search_full / float(step))))
    radius = min(radius, max(1, (min(hs, ws) - 6) // 2))
    x0, x1 = radius + 1, ws - radius - 1
    y0, y1 = radius + 1, hs - radius - 1
    if x1 <= x0 or y1 <= y0:
        return {
            "method_requested": "translation_auto",
            "method_applied": "resize",
            "accepted": False,
            "reason": "image_too_small",
            "dx_px": 0,
            "dy_px": 0,
            "estimated_dx_px": 0,
            "estimated_dy_px": 0,
            "score_before": 0.0,
            "score_after": 0.0,
            "improvement": 0.0,
            "downsample_step": int(step),
            "search_radius_px": int(radius * step),
        }

    sample_stride = 2 if min(x1 - x0, y1 - y0) >= 48 else 1

    def score(dx: int, dy: int) -> float:
        cur = edge_cur[y0:y1:sample_stride, x0:x1:sample_stride]
        prev = edge_prev[y0 - dy:y1 - dy:sample_stride, x0 - dx:x1 - dx:sample_stride]
        return float(np.mean(np.abs(cur - prev))) if cur.size else float("inf")

    score_zero = score(0, 0)
    best = (score_zero, 0, 0)
    coarse_step = 2 if radius >= 5 else 1
    for dy in range(-radius, radius + 1, coarse_step):
        for dx in range(-radius, radius + 1, coarse_step):
            s = score(dx, dy)
            key = (s, abs(dx) + abs(dy), abs(dy), abs(dx), dy, dx)
            best_key = (best[0], abs(best[1]) + abs(best[2]), abs(best[2]), abs(best[1]), best[2], best[1])
            if key < best_key:
                best = (s, dx, dy)

    _, coarse_dx, coarse_dy = best
    for dy in range(max(-radius, coarse_dy - 2), min(radius, coarse_dy + 2) + 1):
        for dx in range(max(-radius, coarse_dx - 2), min(radius, coarse_dx + 2) + 1):
            s = score(dx, dy)
            key = (s, abs(dx) + abs(dy), abs(dy), abs(dx), dy, dx)
            best_key = (best[0], abs(best[1]) + abs(best[2]), abs(best[2]), abs(best[1]), best[2], best[1])
            if key < best_key:
                best = (s, dx, dy)

    best_score, best_dx_small, best_dy_small = best
    improvement = (score_zero - best_score) / max(score_zero, 1e-6) if math.isfinite(score_zero) else 0.0
    estimated_dx = int(best_dx_small * step)
    estimated_dy = int(best_dy_small * step)
    boundary_hit = abs(best_dx_small) >= radius or abs(best_dy_small) >= radius
    accepted = (best_dx_small != 0 or best_dy_small != 0) and improvement >= 0.035 and not boundary_hit
    applied_dx = estimated_dx if accepted else 0
    applied_dy = estimated_dy if accepted else 0
    return {
        "method_requested": "translation_auto",
        "method_applied": "translation_auto" if accepted else "resize",
        "accepted": bool(accepted),
        "reason": "translation_improved_edge_match" if accepted else ("search_boundary_hit" if boundary_hit else "no_reliable_translation_gain"),
        "dx_px": int(applied_dx),
        "dy_px": int(applied_dy),
        "estimated_dx_px": int(estimated_dx),
        "estimated_dy_px": int(estimated_dy),
        "score_before": float(score_zero),
        "score_after": float(best_score if accepted else score_zero),
        "improvement": float(improvement if accepted else max(0.0, improvement)),
        "boundary_hit": bool(boundary_hit),
        "downsample_step": int(step),
        "search_radius_px": int(radius * step),
    }


def apply_translation_registration(current_rgb: np.ndarray, previous_rgb: np.ndarray, dx: int, dy: int) -> np.ndarray:
    """Translate previous into current coordinates; invalid borders copy t1.

    Copying current pixels into non-overlap avoids generating false temporal
    damage along borders where t0 has no valid observation.
    """
    if current_rgb.shape != previous_rgb.shape:
        raise ValueError("Registration requires equal current/previous image shapes.")
    if dx == 0 and dy == 0:
        return previous_rgb.copy()
    h, w = current_rgb.shape[:2]
    aligned = current_rgb.copy()
    dst_x0, dst_x1 = max(0, dx), min(w, w + dx)
    dst_y0, dst_y1 = max(0, dy), min(h, h + dy)
    if dst_x1 <= dst_x0 or dst_y1 <= dst_y0:
        return aligned
    src_x0, src_x1 = dst_x0 - dx, dst_x1 - dx
    src_y0, src_y1 = dst_y0 - dy, dst_y1 - dy
    aligned[dst_y0:dst_y1, dst_x0:dst_x1] = previous_rgb[src_y0:src_y1, src_x0:src_x1]
    return aligned


def align_previous_rgb(current_rgb: np.ndarray, previous_rgb: np.ndarray, method: str = "translation_auto") -> Tuple[np.ndarray, Dict[str, object]]:
    method = (method or "translation_auto").strip().lower()
    if method != "translation_auto":
        return previous_rgb.copy(), {
            "method_requested": method,
            "method_applied": "resize",
            "accepted": False,
            "reason": "translation_registration_disabled",
            "dx_px": 0,
            "dy_px": 0,
            "estimated_dx_px": 0,
            "estimated_dy_px": 0,
            "score_before": None,
            "score_after": None,
            "improvement": 0.0,
            "downsample_step": 1,
            "search_radius_px": 0,
        }
    metrics = estimate_translation_registration(current_rgb, previous_rgb)
    aligned = apply_translation_registration(
        current_rgb, previous_rgb, int(metrics["dx_px"]), int(metrics["dy_px"])
    )
    return aligned, metrics


def temporal_quality_assessment(
    current_rgb: np.ndarray,
    aligned_previous_rgb: np.ndarray,
    alignment: Optional[Dict[str, object]] = None,
) -> Dict[str, object]:
    """Deterministic gate for whether t0→t1 change quantification is trustworthy.

    This does not decide whether damage exists. It checks acquisition/registration
    compatibility so temporal growth/reduction is not presented without a quality
    flag when illumination, sharpness, overlap or registration are unsuitable.
    """
    if current_rgb.shape != aligned_previous_rgb.shape:
        raise ValueError("Temporal quality requires equal current/previous image shapes.")
    alignment = alignment or {}
    h, w = current_rgb.shape[:2]
    step = max(1, int(math.ceil(max(h, w) / 320.0)))
    cur = rgb_to_gray(current_rgb)[::step, ::step].astype(np.float32, copy=False)
    prev = rgb_to_gray(aligned_previous_rgb)[::step, ::step].astype(np.float32, copy=False)

    mean_cur = float(np.mean(cur)) if cur.size else 0.0
    mean_prev = float(np.mean(prev)) if prev.size else 0.0
    illumination_delta = abs(mean_cur - mean_prev) / 255.0

    def edge_map(gray: np.ndarray) -> np.ndarray:
        if gray.shape[0] < 3 or gray.shape[1] < 3:
            return np.zeros((0, 0), dtype=np.float32)
        return (
            np.abs(gray[1:-1, 2:] - gray[1:-1, :-2])
            + np.abs(gray[2:, 1:-1] - gray[:-2, 1:-1])
        ).astype(np.float32, copy=False)

    def edge_energy(edge: np.ndarray) -> float:
        return float(np.mean(edge)) if edge.size else 0.0

    edge_cur = edge_map(cur)
    edge_prev = edge_map(prev)
    sharp_cur = edge_energy(edge_cur)
    sharp_prev = edge_energy(edge_prev)
    sharp_max = max(sharp_cur, sharp_prev)
    sharpness_ratio = min(sharp_cur, sharp_prev) / sharp_max if sharp_max > 1e-6 else 1.0

    if edge_cur.size and edge_prev.size and edge_cur.shape == edge_prev.shape:
        a = edge_cur.reshape(-1).astype(np.float64, copy=False)
        b = edge_prev.reshape(-1).astype(np.float64, copy=False)
        a_centered = a - float(np.mean(a))
        b_centered = b - float(np.mean(b))
        denom = math.sqrt(float(np.dot(a_centered, a_centered)) * float(np.dot(b_centered, b_centered)))
        if denom > 1e-9:
            edge_similarity = float(np.dot(a_centered, b_centered) / denom)
        else:
            edge_similarity = 1.0 if float(np.mean(np.abs(a - b))) < 1e-6 else 0.0
    else:
        edge_similarity = 0.0
    edge_similarity = max(-1.0, min(1.0, edge_similarity))

    clipped_cur = float(np.mean((cur <= 5.0) | (cur >= 250.0))) if cur.size else 0.0
    clipped_prev = float(np.mean((prev <= 5.0) | (prev >= 250.0))) if prev.size else 0.0
    clipped_max = max(clipped_cur, clipped_prev)

    dx = abs(int(alignment.get("dx_px", 0) or 0))
    dy = abs(int(alignment.get("dy_px", 0) or 0))
    overlap_ratio = max(0.0, float(max(0, w - dx) * max(0, h - dy)) / max(1.0, float(w * h)))

    issues: List[str] = []
    warnings: List[str] = []
    reason = str(alignment.get("reason", "") or "")
    if reason in {"search_boundary_hit", "registration_grid_mismatch", "image_too_small"}:
        issues.append("registration_unreliable")
    if overlap_ratio < 0.85:
        issues.append("insufficient_overlap")
    elif overlap_ratio < 0.92:
        warnings.append("reduced_overlap")
    if illumination_delta > 0.22:
        issues.append("illumination_mismatch")
    elif illumination_delta > 0.12:
        warnings.append("illumination_difference")
    if sharpness_ratio < 0.45:
        issues.append("sharpness_mismatch")
    elif sharpness_ratio < 0.65:
        warnings.append("sharpness_difference")
    if edge_similarity < 0.35:
        issues.append("geometric_mismatch")
    elif edge_similarity < 0.55:
        warnings.append("geometric_consistency_low")
    if clipped_max > 0.35:
        issues.append("exposure_clipping")
    elif clipped_max > 0.20:
        warnings.append("exposure_warning")
    if sharp_max < 3.0:
        warnings.append("low_texture")

    status = "fail" if issues else ("warning" if warnings else "pass")
    return {
        "schema": "cdm_temporal_quality_v1",
        "status": status,
        "validated_for_change_quantification": not bool(issues),
        "issues": issues,
        "warnings": warnings,
        "metrics": {
            "overlap_ratio": float(overlap_ratio),
            "illumination_delta": float(illumination_delta),
            "mean_luminance_t1": mean_cur,
            "mean_luminance_t0_aligned": mean_prev,
            "sharpness_t1": float(sharp_cur),
            "sharpness_t0_aligned": float(sharp_prev),
            "sharpness_ratio": float(sharpness_ratio),
            "edge_similarity": float(edge_similarity),
            "clipped_fraction_t1": float(clipped_cur),
            "clipped_fraction_t0_aligned": float(clipped_prev),
            "sample_step": int(step),
        },
        "thresholds": {
            "min_overlap_fail": 0.85,
            "min_overlap_warning": 0.92,
            "max_illumination_delta_fail": 0.22,
            "max_illumination_delta_warning": 0.12,
            "min_sharpness_ratio_fail": 0.45,
            "min_sharpness_ratio_warning": 0.65,
            "min_edge_similarity_fail": 0.35,
            "min_edge_similarity_warning": 0.55,
            "max_clipped_fraction_fail": 0.35,
            "max_clipped_fraction_warning": 0.20,
        },
    }


def _pad_for_filter(arr: np.ndarray, k: int) -> np.ndarray:
    pad = k // 2
    return np.pad(arr, ((pad, pad), (pad, pad)), mode="edge")


def _odd_kernel(k: int) -> int:
    k = max(3, int(k))
    return k + 1 if k % 2 == 0 else k


def _sliding_min(arr: np.ndarray, k: int) -> np.ndarray:
    from numpy.lib.stride_tricks import sliding_window_view
    windows = sliding_window_view(_pad_for_filter(arr, k), (k, k))
    return windows.min(axis=(-2, -1))


def _sliding_max(arr: np.ndarray, k: int) -> np.ndarray:
    from numpy.lib.stride_tricks import sliding_window_view
    windows = sliding_window_view(_pad_for_filter(arr, k), (k, k))
    return windows.max(axis=(-2, -1))


def min_filter(arr: np.ndarray, k: int) -> np.ndarray:
    # Erosão em tons de cinza. scipy (rápido) -> Pillow (memória limitada) -> janela.
    if _HAVE_SCIPY:
        return _scipy_min(arr.astype(np.float32), size=k, mode="nearest")
    if ImageFilter is not None:
        try:
            ko = _odd_kernel(k)
            im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "L").filter(ImageFilter.MinFilter(ko))
            return np.asarray(im, dtype=np.float32)
        except Exception:
            pass
    return _sliding_min(arr, k)


def max_filter(arr: np.ndarray, k: int) -> np.ndarray:
    # Dilatação em tons de cinza. scipy (rápido) -> Pillow (memória limitada) -> janela.
    if _HAVE_SCIPY:
        return _scipy_max(arr.astype(np.float32), size=k, mode="nearest")
    if ImageFilter is not None:
        try:
            ko = _odd_kernel(k)
            im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "L").filter(ImageFilter.MaxFilter(ko))
            return np.asarray(im, dtype=np.float32)
        except Exception:
            pass
    return _sliding_max(arr, k)


def dilate_bool(mask: np.ndarray, k: int = 3) -> np.ndarray:
    return max_filter(mask.astype(np.uint8), k) > 0


def erode_bool(mask: np.ndarray, k: int = 3) -> np.ndarray:
    return min_filter(mask.astype(np.uint8), k) > 0


def open_bool(mask: np.ndarray, k: int = 3) -> np.ndarray:
    return dilate_bool(erode_bool(mask, k), k)


def close_bool(mask: np.ndarray, k: int = 3) -> np.ndarray:
    return erode_bool(dilate_bool(mask, k), k)


def cleanup_mask_steps(mask: np.ndarray, k: int = 3) -> Tuple[np.ndarray, np.ndarray]:
    """Apply the common cleaning protocol and retain its two stages.

    The implementation uses a morphological opening to suppress isolated
    candidates, followed by a closing to reconnect short gaps and fill local
    discontinuities. Both stages are exported for scientific traceability.
    """
    opened = open_bool(mask, k)
    closed = close_bool(opened, k)
    return opened, closed


def cleanup_mask(mask: np.ndarray, k: int = 3) -> np.ndarray:
    return cleanup_mask_steps(mask, k)[1]


def morphology_blackhat(gray: np.ndarray, k: int) -> np.ndarray:
    closed = min_filter(max_filter(gray, k), k)
    return np.clip(closed - gray, 0, 255)


def rgb_to_hsv_basic(rgb: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    arr = rgb.astype(np.float32) / 255.0
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    cmax = np.maximum.reduce([r, g, b])
    cmin = np.minimum.reduce([r, g, b])
    delta = cmax - cmin
    hue = np.zeros_like(cmax)
    mask = delta > 1e-6
    idx = mask & (cmax == r)
    hue[idx] = ((g[idx] - b[idx]) / delta[idx]) % 6
    idx = mask & (cmax == g)
    hue[idx] = ((b[idx] - r[idx]) / delta[idx]) + 2
    idx = mask & (cmax == b)
    hue[idx] = ((r[idx] - g[idx]) / delta[idx]) + 4
    hue = hue * 60.0
    sat = np.where(cmax <= 1e-6, 0.0, delta / np.maximum(cmax, 1e-6))
    val = cmax
    return hue, sat, val


def connected_components(mask: np.ndarray, min_area: float) -> List[np.ndarray]:
    h, w = mask.shape
    visited = np.zeros_like(mask, dtype=bool)
    components: List[np.ndarray] = []
    yy, xx = np.nonzero(mask)
    for y0, x0 in zip(yy.tolist(), xx.tolist()):
        if visited[y0, x0] or not mask[y0, x0]:
            continue
        q = deque([(y0, x0)])
        visited[y0, x0] = True
        pts: List[Tuple[int, int]] = []
        while q:
            y, x = q.popleft()
            pts.append((x, y))
            for ny in (y - 1, y, y + 1):
                if ny < 0 or ny >= h:
                    continue
                for nx in (x - 1, x, x + 1):
                    if nx < 0 or nx >= w or (ny == y and nx == x):
                        continue
                    if not visited[ny, nx] and mask[ny, nx]:
                        visited[ny, nx] = True
                        q.append((ny, nx))
        if len(pts) >= min_area:
            components.append(np.array(pts, dtype=np.float32))
    return components


def mask_perimeter(points: np.ndarray, shape: Tuple[int, int]) -> float:
    h, w = shape
    mask = np.zeros((h, w), dtype=bool)
    p_int = points.astype(int)
    mask[p_int[:, 1], p_int[:, 0]] = True
    boundary = mask & (~erode_bool(mask, 3))
    by, bx = np.nonzero(boundary)
    if len(bx) == 0:
        return 0.0
    return float(len(bx))


def component_boundary(points: np.ndarray, shape: Tuple[int, int]) -> np.ndarray:
    h, w = shape
    mask = np.zeros((h, w), dtype=bool)
    p_int = points.astype(int)
    mask[p_int[:, 1], p_int[:, 0]] = True
    boundary = mask & (~erode_bool(mask, 3))
    by, bx = np.nonzero(boundary)
    if len(bx) == 0:
        return points
    out = np.column_stack([bx, by]).astype(np.float32)
    if len(out) > 2500:
        step = max(1, len(out) // 2500)
        out = out[::step]
    return out


def convex_hull(points: np.ndarray) -> List[Tuple[float, float]]:
    pts = sorted(set((float(x), float(y)) for x, y in points.tolist()))
    if len(pts) <= 1:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: List[Tuple[float, float]] = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper: List[Tuple[float, float]] = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def pca_centerline(points: np.ndarray) -> Tuple[List[Tuple[float, float]], float]:
    mean = points.mean(axis=0)
    centered = points - mean
    if len(points) < 2:
        p = (float(mean[0]), float(mean[1]))
        return [p, p], 0.0
    cov = np.cov(centered.T)
    vals, vecs = np.linalg.eigh(cov)
    direction = vecs[:, np.argmax(vals)]
    projections = centered @ direction
    p1 = mean + direction * float(projections.min())
    p2 = mean + direction * float(projections.max())
    length = float(np.linalg.norm(p2 - p1))
    return [(float(p1[0]), float(p1[1])), (float(p2[0]), float(p2[1]))], length


def resize_mask(mask: np.ndarray, size_hw: Tuple[int, int]) -> np.ndarray:
    h, w = size_hw
    pil = Image.fromarray((mask.astype(np.uint8) * 255), mode="L")
    pil = pil.resize((w, h), Image.Resampling.NEAREST)
    return np.asarray(pil) > 0


def detect_masks(rgb: np.ndarray, cfg: DetectorConfig, profiler: Optional[PerformanceProfiler] = None, run_tag: str = "t1") -> Tuple[Dict[str, np.ndarray], Dict[str, object]]:
    """Execute the unified five-stage segmentation protocol for every family.

    Every branch keeps the same evidence path: base image, family-specific
    response, candidate mask, opening→closing mask, and connected components.
    The response map remains physically specific to the damage family.
    """
    with _profile_stage(profiler, f"{run_tag} | preprocessing | grayscale + contrast"):
        gray = contrast_stretch(rgb_to_gray(rgb))
    k = cfg.normalized_kernel_size
    masks: Dict[str, np.ndarray] = {}
    pipeline: Dict[str, object] = {
        "gray": gray,
        "protocol": {"stages": ["base_image", "family_response", "candidate_mask", "open_close_mask", "connected_components"], "version": "unified_five_stage_v285"},
    }
    with _profile_stage(profiler, f"{run_tag} | preprocessing | RGB→HSV"):
        hue, sat, val = rgb_to_hsv_basic(rgb)

    if cfg.detection_scope in ("all", "cracks"):
        with _profile_stage(profiler, f"{run_tag} | fissuras | resposta + máscara candidata"):
            response = morphology_blackhat(gray, k)
            candidate = response > float(cfg.threshold)
        with _profile_stage(profiler, f"{run_tag} | fissuras | abertura + fechamento"):
            opened, cleaned = cleanup_mask_steps(candidate, 3)
        masks["cracks"] = cleaned
        pipeline["cracks"] = {"base_kind": "grayscale", "response_label": "Black-hat response BHₖ(I)", "candidate_label": "M_0 = 1[BH_k(I) > T]", "rule": "dark elongated residuals; aspect-ratio filter after connected components", "response": response, "raw_mask": candidate, "open_mask": opened, "clean_mask": cleaned, "threshold": float(cfg.threshold)}

    spalling_mask: Optional[np.ndarray] = None
    if cfg.detection_scope in ("all", "spalling_dark"):
        with _profile_stage(profiler, f"{run_tag} | desplacamento | resposta + máscara candidata"):
            dark_cut = min(120.0, float(np.percentile(gray, 18)) + max(8, cfg.threshold * 0.25))
            texture = morphology_blackhat(gray, max(5, min(k, 21)))
            darkness_response = np.clip(dark_cut - gray, 0.0, 255.0)
            response = np.maximum(darkness_response, texture)
            candidate = (gray < dark_cut) | ((texture > max(10.0, cfg.threshold * 0.55)) & (gray < np.percentile(gray, 45)))
        with _profile_stage(profiler, f"{run_tag} | desplacamento | abertura + fechamento"):
            opened, spalling_mask = cleanup_mask_steps(candidate, 5)
        masks["spalling_dark"] = spalling_mask
        pipeline["spalling_dark"] = {"base_kind": "grayscale", "response_label": "Darkness-texture response Rₛₚ", "candidate_label": "M_0 = dark(I) OR textured-dark(I)", "rule": "darkness threshold combined with black-hat texture response", "response": response, "raw_mask": candidate, "open_mask": opened, "clean_mask": spalling_mask, "dark_cut": float(dark_cut)}

    if cfg.detection_scope in ("all", "corrosion_rust"):
        with _profile_stage(profiler, f"{run_tag} | corrosão | resposta + máscara candidata"):
            r = rgb[:, :, 0].astype(np.float32)
            g = rgb[:, :, 1].astype(np.float32)
            b = rgb[:, :, 2].astype(np.float32)
            red_excess = np.clip(r - np.maximum(g, b), 0.0, 255.0)
            hue_gate = (((hue < 55) | (hue > 330)).astype(np.float32))
            response = np.clip(red_excess * (0.35 + 0.65 * sat) * (0.35 + 0.65 * hue_gate), 0.0, 255.0)
            candidate = (r > g + 12) & (r > b + 18) & (sat > 0.22) & (val > 0.16) & ((hue < 55) | (hue > 330))
        with _profile_stage(profiler, f"{run_tag} | corrosão | abertura + fechamento"):
            opened, cleaned = cleanup_mask_steps(candidate, 5)
        masks["corrosion_rust"] = cleaned
        pipeline["corrosion_rust"] = {"base_kind": "rgb", "response_label": "Chromatic rust response Rᶜᵒʳ", "candidate_label": "M_0 = RGB-HSV rule mask", "rule": "red dominance, saturation, value and red-orange hue interval", "response": response, "raw_mask": candidate, "open_mask": opened, "clean_mask": cleaned}

    if cfg.detection_scope in ("all", "efflorescence_white"):
        with _profile_stage(profiler, f"{run_tag} | eflorescência | resposta + máscara candidata"):
            brightness = val * 255.0
            whiteness = brightness * (1.0 - sat)
            response = np.clip(whiteness, 0.0, 255.0)
            candidate = (val > 0.72) & (sat < 0.28) & (gray > np.percentile(gray, 72))
        with _profile_stage(profiler, f"{run_tag} | eflorescência | abertura + fechamento"):
            opened, cleaned = cleanup_mask_steps(candidate, 5)
        masks["efflorescence_white"] = cleaned
        pipeline["efflorescence_white"] = {"base_kind": "rgb", "response_label": "Bright low-saturation response Rᵉᶠᶠ", "candidate_label": "M_0 = high-value AND low-saturation mask", "rule": "high HSV value, low saturation and locally bright grayscale response", "response": response, "raw_mask": candidate, "open_mask": opened, "clean_mask": cleaned}

    if cfg.detection_scope in ("all", "spalling_dark"):
        with _profile_stage(profiler, f"{run_tag} | armadura exposta | resposta + máscara candidata"):
            if spalling_mask is None:
                spalling_mask = masks.get("spalling_dark", np.zeros(gray.shape, dtype=bool))
            local_thresh = float(np.percentile(gray[spalling_mask], 40)) if np.any(spalling_mask) else float(np.percentile(gray, 12))
            low_sat = sat < 0.20
            medium_dark = val < 0.55
            local_dark = gray < local_thresh
            response = np.where(spalling_mask, np.clip(local_thresh - gray, 0.0, 255.0), 0.0)
            candidate = spalling_mask & (local_dark | (low_sat & medium_dark))
        with _profile_stage(profiler, f"{run_tag} | armadura exposta | abertura + fechamento"):
            opened, cleaned = cleanup_mask_steps(candidate, 3)
        masks["exposed_rebar"] = cleaned
        pipeline["exposed_rebar"] = {"base_kind": "spalling_context", "response_label": "Contextual rebar response Rᵣₑ|ₛₚ", "candidate_label": "M_0 = M_sp AND (dark OR low-saturation-dark)", "rule": "candidate restricted to spalling; elongation filter after connected components", "response": response, "raw_mask": candidate, "open_mask": opened, "clean_mask": cleaned, "spalling_context": spalling_mask, "local_threshold": local_thresh}

    pipeline["masks"] = masks
    return masks, pipeline

CLASS_PIPELINE_COLORS = {
    "cracks": (197, 71, 59),
    "spalling_dark": (217, 122, 52),
    "exposed_rebar": (92, 96, 102),
    "corrosion_rust": (139, 74, 43),
    "efflorescence_white": (63, 124, 173),
}


def _norm_to_u8(arr: np.ndarray) -> np.ndarray:
    if arr.dtype == np.bool_:
        return arr.astype(np.uint8) * 255
    a = arr.astype(np.float32)
    mn = float(np.nanmin(a)) if a.size else 0.0
    mx = float(np.nanmax(a)) if a.size else 1.0
    if mx <= mn + 1e-6:
        return np.clip(a, 0, 255).astype(np.uint8)
    if mn >= 0.0 and mx <= 255.0:
        return np.clip(a, 0, 255).astype(np.uint8)
    return np.clip((a - mn) * 255.0 / (mx - mn), 0, 255).astype(np.uint8)


def _img_gray(arr: np.ndarray) -> Image.Image:
    return Image.fromarray(_norm_to_u8(arr), mode="L").convert("RGB")


def _img_rgb(arr: np.ndarray) -> Image.Image:
    if arr.dtype != np.uint8:
        arr = np.clip(arr, 0, 255).astype(np.uint8)
    return Image.fromarray(arr, mode="RGB")


def _img_mask(mask: np.ndarray) -> Image.Image:
    return Image.fromarray((mask.astype(np.uint8) * 255), mode="L").convert("RGB")


def _overlay_mask(base_rgb: np.ndarray, mask: np.ndarray, color: Tuple[int, int, int], alpha: float = 0.48) -> Image.Image:
    base = base_rgb.astype(np.float32).copy()
    col = np.array(color, dtype=np.float32).reshape(1, 1, 3)
    sel = mask.astype(bool)
    base[sel] = (1.0 - alpha) * base[sel] + alpha * col
    return _img_rgb(base)


def _overlay_components(base_rgb: np.ndarray, mask: np.ndarray, min_area: float) -> Image.Image:
    comps = connected_components(mask, min_area)
    out = base_rgb.astype(np.float32).copy()
    palette = [(197, 71, 59), (63, 124, 173), (217, 122, 52), (90, 154, 90), (122, 93, 168), (36, 156, 160), (161, 111, 36), (199, 69, 132)]
    for idx, pts in enumerate(comps):
        color = np.array(palette[idx % len(palette)], dtype=np.float32)
        xy = pts.astype(int)
        out[xy[:, 1], xy[:, 0], :] = color
    return _img_rgb(out)


def _fit_panel(img: Image.Image, panel_wh: Tuple[int, int], bg=(255, 255, 255)) -> Image.Image:
    pw, ph = panel_wh
    out = Image.new("RGB", (pw, ph), bg)
    scale = min(pw / max(1, img.width), ph / max(1, img.height))
    nw, nh = max(1, int(img.width * scale)), max(1, int(img.height * scale))
    rs = img.resize((nw, nh), Image.Resampling.BILINEAR)
    out.paste(rs, ((pw - nw) // 2, (ph - nh) // 2))
    return out


def _load_font(size: int):
    for name in ["DejaVuSans.ttf", "Arial.ttf", "LiberationSans-Regular.ttf"]:
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()


def build_scientific_montage(title: str, panel_specs: List[Tuple[str, Image.Image]], out_path: str, cols: int = 5, scale: int = 2) -> str:
    margin = 28 * scale
    gap = 14 * scale
    label_h = 34 * scale
    title_h = 48 * scale
    panel_w = 190 * scale
    panel_h = 130 * scale
    rows = max(1, math.ceil(len(panel_specs) / cols))
    width = margin * 2 + cols * panel_w + (cols - 1) * gap
    height = margin * 2 + title_h + rows * (panel_h + label_h) + max(0, rows - 1) * gap
    canvas = Image.new("RGB", (width, height), (255, 255, 255))
    draw = ImageDraw.Draw(canvas)
    font_title = _load_font(20 * scale)
    font_label = _load_font(13 * scale)
    draw.text((margin, margin // 2), title, fill=(20, 24, 28), font=font_title)
    y0 = margin + title_h
    for idx, (label, img) in enumerate(panel_specs):
        r = idx // cols
        c = idx % cols
        x = margin + c * (panel_w + gap)
        y = y0 + r * (panel_h + label_h + gap)
        panel = _fit_panel(img, (panel_w, panel_h))
        canvas.paste(panel, (x, y))
        draw.rectangle([x, y, x + panel_w - 1, y + panel_h - 1], outline=(90, 90, 90), width=1)
        draw.text((x, y + panel_h + 4 * scale), label, fill=(35, 35, 35), font=font_label)
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path, dpi=(300, 300))
    return out_path


def export_segmentation_pipeline_figures(image_path: str, rgb: np.ndarray, pipeline: Dict[str, object], cfg: DetectorConfig) -> Dict[str, str]:
    """Export class-wise scientific figures under the unified five-stage protocol.

    All figures follow the same panel semantics: base image, family response,
    candidate mask, morphologically cleaned mask, and connected components.
    This standardizes the scientific presentation while preserving the
    class-specific response operator used by the actual implementation.
    """
    base_dir = resolve_export_base_dir(image_path, cfg)
    stem = Path(_strip_path_field(image_path)).stem or "inspection_image"
    sub = (cfg.pipeline_output_dir or f"{stem}_pipeline_v285").strip()
    pipeline_dir = Path(sub)
    if not pipeline_dir.is_absolute():
        pipeline_dir = base_dir / pipeline_dir
    pipeline_dir.mkdir(parents=True, exist_ok=True)
    steps_dir = pipeline_dir / "steps"
    steps_dir.mkdir(parents=True, exist_ok=True)
    paths: Dict[str, str] = {"pipeline_dir": str(pipeline_dir)}

    gray = pipeline.get("gray")
    if isinstance(gray, np.ndarray):
        gp = steps_dir / "global_01_grayscale.png"
        _img_gray(gray).save(gp, dpi=(300, 300))
        paths["gray"] = str(gp)

    input_path = pipeline_dir / "Figure_01_input_specimen.png"
    _img_rgb(rgb).save(input_path, dpi=(300, 300))
    paths["input"] = str(input_path)

    # Global overlay: same output geometry used in SVG layers, shown as raster evidence.
    global_img = rgb.astype(np.float32).copy()
    for cls, color in CLASS_PIPELINE_COLORS.items():
        data = pipeline.get(cls)
        if isinstance(data, dict):
            mask = data.get("clean_mask")
            if isinstance(mask, np.ndarray):
                sel = mask.astype(bool)
                col = np.array(color, dtype=np.float32).reshape(1, 1, 3)
                global_img[sel] = 0.55 * global_img[sel] + 0.45 * col
    global_path = pipeline_dir / "Figure_02_global_segmentation_overlay.png"
    _img_rgb(global_img).save(global_path, dpi=(300, 300))
    paths["global_overlay"] = str(global_path)

    figure_specs = [
        ("cracks", "cracks", "Figure_03_crack_channel_pipeline.png", "Crack-channel pipeline"),
        ("spalling_dark", "spalling", "Figure_04_spalling_channel_pipeline.png", "Spalling-channel pipeline"),
        ("exposed_rebar", "rebar", "Figure_05_exposed_rebar_channel_pipeline.png", "Exposed-rebar channel pipeline"),
        ("corrosion_rust", "corrosion", "Figure_06_corrosion_channel_pipeline.png", "Corrosion-channel pipeline"),
        ("efflorescence_white", "efflorescence", "Figure_07_efflorescence_channel_pipeline.png", "Efflorescence-channel pipeline"),
    ]

    protocol_rows = []
    for channel_key, step_prefix, figure_name, title in figure_specs:
        data = pipeline.get(channel_key)
        if not isinstance(data, dict):
            continue
        rsp = data.get("response")
        raw = data.get("raw_mask")
        opened = data.get("open_mask")
        clean = data.get("clean_mask")
        if not (isinstance(rsp, np.ndarray) and isinstance(raw, np.ndarray) and isinstance(opened, np.ndarray) and isinstance(clean, np.ndarray)):
            continue

        base_kind = str(data.get("base_kind", "rgb"))
        if base_kind == "grayscale":
            p1 = _img_gray(gray) if isinstance(gray, np.ndarray) else _img_rgb(rgb)
            base_label = "(a) Base image I"
        elif base_kind == "spalling_context":
            ctx = data.get("spalling_context")
            p1 = _overlay_mask(rgb, ctx, CLASS_PIPELINE_COLORS["spalling_dark"], 0.40) if isinstance(ctx, np.ndarray) else _img_rgb(rgb)
            base_label = "(a) Base/context image I_sp"
        else:
            p1 = _img_rgb(rgb)
            base_label = "(a) Base image RGB"
        p2 = _img_gray(rsp)
        p3 = _img_mask(raw)
        p_open = _img_mask(opened)
        p4 = _img_mask(clean)
        p5 = _overlay_components(rgb, clean, cfg.min_area)
        # The 5-panel article figure uses the final cleanup result in panel (d).
        # The steps folder also preserves the separate opening result for auditability.
        imgs = [p1, p2, p3, p4, p5]
        labels = [
            "(a) Base image",
            "(b) Family response",
            "(c) Candidate mask",
            "(d) Open→Close mask",
            "(e) Connected components",
        ]
        step_exports = [
            ("01_base_image", p1),
            ("02_family_response", p2),
            ("03_candidate_mask", p3),
            ("04_opening_mask", p_open),
            ("05_closing_mask", p4),
            ("06_connected_components", p5),
        ]
        for stage, img in step_exports:
            img.save(steps_dir / f"{step_prefix}_{stage}.png", dpi=(300, 300))
        fig = pipeline_dir / figure_name
        response_title = str(data.get("response_label", ""))
        full_title = f"{title} — {response_title}" if response_title else title
        build_scientific_montage(full_title, list(zip(labels, imgs)), str(fig), cols=5, scale=2)
        paths[channel_key + "_pipeline"] = str(fig)
        protocol_rows.append({
            "class": channel_key,
            "response_label": data.get("response_label", ""),
            "candidate_label": data.get("candidate_label", ""),
            "rule": data.get("rule", ""),
            "standard_stages": ["base_image", "family_response", "candidate_mask", "open_close_mask", "connected_components"],
            "intermediate_step_exports": [stage for stage, _ in step_exports],
            "figure": str(fig),
        })

    protocol_doc = pipeline_dir / "PIPELINE_PROTOCOL_v285.md"
    lines = [
        "# Unified five-stage segmentation protocol", "",
        "All pathology families are exported using the same visual sequence:",
        "1. Base image", "2. Family-specific response map", "3. Candidate mask", "4. Opening-closing cleaned mask", "5. Connected components", "",
        "The response operator remains class-specific to preserve physical interpretability.", "",
    ]
    for row in protocol_rows:
        lines += [f"## {row['class']}", f"- Response: {row['response_label']}", f"- Candidate rule: {row['candidate_label']}", f"- Interpretation: {row['rule']}", f"- Figure: {Path(row['figure']).name}", ""]
    protocol_doc.write_text("\n".join(lines), encoding="utf-8")
    paths["pipeline_protocol"] = str(protocol_doc)

    manifest = pipeline_dir / "pipeline_figure_manifest_v285.json"
    manifest.write_text(json.dumps({"files": paths, "families": protocol_rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    paths["pipeline_manifest"] = str(manifest)
    return paths


def records_from_mask(mask: np.ndarray, damage_class: str, time_label: str, cfg: DetectorConfig) -> List[DamageRecord]:
    comps = connected_components(mask, cfg.min_area)
    records: List[DamageRecord] = []
    for idx, pts in enumerate(comps, start=1):
        xs = pts[:, 0]
        ys = pts[:, 1]
        x, y = int(xs.min()), int(ys.min())
        w, h = int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)
        minor = max(1, min(w, h))
        major = max(w, h)
        aspect = float(major / minor)
        area = float(len(pts))
        if damage_class == "cracks" and aspect < float(cfg.min_aspect_ratio):
            continue
        if damage_class == "exposed_rebar" and aspect < max(2.0, float(cfg.min_aspect_ratio)):
            continue
        perim = mask_perimeter(pts, mask.shape)
        if damage_class == "cracks":
            geom_points, length = pca_centerline(pts)
            width_px = float(area / max(length, 1e-6))
            is_closed = False
            note = "Versão sem OpenCV: fissura por linha central PCA; largura estimada = área/comprimento."
        elif damage_class == "exposed_rebar":
            geom_points = convex_hull(component_boundary(pts, mask.shape))
            length = float(major)
            width_px = float(minor)
            is_closed = True
            note = "Versão sem OpenCV: armadura exposta aproximada por polígono alongado dentro do desplacamento."
        else:
            geom_points = convex_hull(component_boundary(pts, mask.shape))
            length = perim
            width_px = float(minor)
            is_closed = True
            note = "Versão sem OpenCV: região representada por polígono convexo aproximado."
        if len(geom_points) < 2:
            continue
        records.append(DamageRecord(
            record_id=f"{time_label}_{damage_class}_{idx:04d}",
            damage_class=damage_class,
            time_label=time_label,
            points=geom_points,
            is_closed=is_closed,
            area_px2=area,
            perimeter_px=perim,
            bbox=(x, y, w, h),
            aspect_ratio=aspect,
            length_px=length,
            width_px=width_px,
            confidence_note=note,
        ))
    return records


def damage_D_from_fi_fp(fi: float, fp: float) -> float:
    if fi <= 0 or fp <= 0:
        return 0.0
    if fi <= 2.0:
        return 0.8 * fi * fp
    return (12.0 * fi - 28.0) * fp


def classify_gde_value(gde: float) -> Tuple[str, str]:
    if gde <= 15:
        return "Baixo", "Estado aceitável; manutenção preventiva."
    if gde <= 50:
        return "Médio", "Planejar nova inspeção e intervenção em longo prazo."
    if gde <= 80:
        return "Alto", "Planejar inspeção especializada e intervenção em médio prazo."
    if gde <= 100:
        return "Sofrível", "Inspeção especializada rigorosa e intervenção em curto prazo."
    return "Crítico", "Inspeção especializada imediata e medidas emergenciais."


def assign_fi_by_metric(cls: str, rec: DamageRecord, reference_area_px2: float, scale: ScaleInfo) -> float:
    area_ratio = rec.area_px2 / max(reference_area_px2, 1.0)
    if cls == "spalling_dark":
        if area_ratio <= 0.0005: return 1.0
        if area_ratio <= 0.0030: return 2.0
        if area_ratio <= 0.0150: return 3.0
        return 4.0
    if cls == "exposed_rebar":
        if area_ratio <= 0.0002: return 2.0
        if area_ratio <= 0.0015: return 3.0
        return 4.0
    if cls == "corrosion_rust":
        if area_ratio <= 0.0005: return 1.0
        if area_ratio <= 0.0030: return 2.0
        if area_ratio <= 0.0150: return 3.0
        return 4.0
    if cls == "efflorescence_white":
        if area_ratio <= 0.0010: return 1.0
        if area_ratio <= 0.0100: return 2.0
        return 3.0
    if cls == "cracks":
        characteristic_length = math.sqrt(max(reference_area_px2, 1.0))
        density = rec.length_px / max(characteristic_length, 1.0)
        w = rec.width_px
        w_mm = scale.px_to_mm(w)
        if w_mm is not None:
            if w_mm <= 0.20 and density <= 0.05: return 1.0
            if w_mm <= 0.40 and density <= 0.12: return 2.0
            if w_mm <= 1.00 and density <= 0.30: return 3.0
            return 4.0
        if w <= 2.0 and density <= 0.05: return 1.0
        if w <= 4.0 and density <= 0.12: return 2.0
        if w <= 8.0 and density <= 0.30: return 3.0
        return 4.0
    return 0.0

def environmental_multiplier(cfg: DetectorConfig) -> float:
    if cfg.environmental_aggressiveness == "high":
        return 1.10
    if cfg.environmental_aggressiveness == "low":
        return 0.95
    return 1.00


def severity_continuous_img(cls: str, rec: DamageRecord, reference_area_px2: float, scale: ScaleInfo, cfg: DetectorConfig) -> float:
    """Continuous image-assisted severity s_img in [0, 1].

    It converts deterministic image measurements into a normalized severity used
    by the ordinal normative method. The thresholds are engineering start values
    and should be calibrated with inspector-labelled data.
    """
    area_ratio = rec.area_px2 / max(reference_area_px2, 1.0)
    if cls == "cracks":
        characteristic_length = math.sqrt(max(reference_area_px2, 1.0))
        density = rec.length_px / max(characteristic_length, 1.0)
        w_mm = scale.px_to_mm(rec.width_px)
        width_score = min(1.0, (w_mm / 1.0) if w_mm is not None else (rec.width_px / 8.0))
        density_score = min(1.0, density / 0.30)
        s = 0.65 * width_score + 0.35 * density_score
    elif cls == "spalling_dark":
        s = min(1.0, area_ratio / 0.0150)
    elif cls == "exposed_rebar":
        # Exposed reinforcement is already relevant even for small areas.
        s = max(0.35, min(1.0, area_ratio / 0.0015))
    elif cls == "corrosion_rust":
        s = min(1.0, area_ratio / 0.0150)
    elif cls == "efflorescence_white":
        s = min(1.0, area_ratio / 0.0100)
    else:
        s = 0.0
    return float(max(0.0, min(1.0, s * environmental_multiplier(cfg))))


def ec_rank_from_severity(s: float, cfg: DetectorConfig) -> int:
    taus = sorted([cfg.ordinal_tau1, cfg.ordinal_tau2, cfg.ordinal_tau3])
    return int(1 + sum(1 for tau in taus if s >= tau))


def dnit_ec_from_rank(ec_rank: int) -> Tuple[int, str]:
    # The article's ordinal EC rank grows with severity. DNIT Anexo D uses EC4=Bom and EC1=Severo.
    ec_dnit = max(1, min(4, 5 - int(ec_rank)))
    labels = {4: "Bom", 3: "Razoável", 2: "Ruim", 1: "Severo"}
    return ec_dnit, labels[ec_dnit]


def nt_from_structure_rank(structure_rank: int, allow_emergency: bool, extreme_emergency: bool) -> Tuple[int, str]:
    mapping = {1: (4, "Boa"), 2: (3, "Regular"), 3: (2, "Ruim"), 4: (1, "Crítica")}
    nt, label = mapping.get(max(1, min(4, int(structure_rank))), (3, "Regular"))
    if allow_emergency and extreme_emergency:
        return 0, "Emergencial"
    return nt, label


def delta_extension_recurrence(n_damages: int, affected_area_ratio: float, cfg: DetectorConfig) -> int:
    if n_damages >= max(1, int(cfg.recurrence_threshold)) or affected_area_ratio >= max(0.0, float(cfg.extension_threshold)):
        return 1
    return 0


def rank_label(rank: int) -> str:
    return {0: "Sem dano", 1: "Leve", 2: "Moderado", 3: "Grave", 4: "Severo"}.get(int(rank), "-")


def nt_label_from_nt(nt: int) -> str:
    return {5: "Excelente", 4: "Boa", 3: "Regular", 2: "Ruim", 1: "Crítica", 0: "Emergencial"}.get(int(nt), "-")


def compute_family_summaries(damage_rows: List[Dict[str, object]], cfg: DetectorConfig) -> List[Dict[str, object]]:
    family_rows: List[Dict[str, object]] = []
    rows_by_cls: Dict[str, List[Dict[str, object]]] = {}
    for row in damage_rows:
        rows_by_cls.setdefault(str(row.get("class", "")), []).append(row)
    for cls in PATHOLOGY_FAMILY_ORDER:
        rows = rows_by_cls.get(cls, [])
        if not rows:
            family_rows.append({
                "class": cls,
                "class_label": CLASS_LABELS.get(cls, cls),
                "n": 0,
                "area_ratio_sum": 0.0,
                "s_max": 0.0,
                "s_mean": 0.0,
                "EC_rank_family_img": 0,
                "EC_DNIT_family_img": 4,
                "EC_DNIT_family_label": "Bom",
                "governing_record_id": "",
                "delta_family": 0,
                "Fi_max": 0.0,
                "D_sum": 0.0,
                "included_in_rating": family_included_in_rating(cls, cfg),
                "formula_trace": "sem detecção",
            })
            continue
        n = len(rows)
        included = family_included_in_rating(cls, cfg)
        area_sum = sum(float(r.get("area_ratio", 0.0)) for r in rows)
        s_vals = [float(r.get("s_img", 0.0)) for r in rows]
        d_vals = [float(r.get("D", 0.0)) for r in rows]
        fi_vals = [float(r.get("Fi", 0.0)) for r in rows]
        ranks = [int(r.get("EC_rank_img", 0)) for r in rows]
        gov = max(rows, key=lambda r: (int(r.get("EC_rank_img", 0)), float(r.get("s_img", 0.0)), float(r.get("D", 0.0))))
        max_rank = max(ranks) if ranks else 0
        delta = delta_extension_recurrence(n, area_sum, cfg) if max_rank > 0 else 0
        fam_rank = min(4, max_rank + delta) if max_rank > 0 else 0
        fam_ec, fam_ec_label = dnit_ec_from_rank(fam_rank) if fam_rank > 0 else (4, "Bom")
        formula_trace = (
            f"max EC_rank={max_rank}; δ={delta}; "
            f"EC_fam=min(4,{max_rank}+{delta})={fam_rank}; "
            f"EC_DNIT=5-{fam_rank}=EC{fam_ec}; "
            f"participa_NT_GDE={included}"
        )
        family_rows.append({
            "class": cls,
            "class_label": CLASS_LABELS.get(cls, cls),
            "n": n,
            "area_ratio_sum": float(area_sum),
            "s_max": max(s_vals) if s_vals else 0.0,
            "s_mean": safe_mean(s_vals),
            "EC_rank_family_img": int(fam_rank),
            "EC_DNIT_family_img": int(fam_ec),
            "EC_DNIT_family_label": fam_ec_label,
            "governing_record_id": str(gov.get("record_id", "")),
            "delta_family": int(delta),
            "Fi_max": max(fi_vals) if fi_vals else 0.0,
            "D_sum": float(sum(d_vals)),
            "included_in_rating": bool(included),
            "formula_trace": formula_trace,
        })
    return family_rows


def compute_condition_rating(records: List[DamageRecord], scale: ScaleInfo, cfg: DetectorConfig, image_area_px2: float) -> Dict[str, object]:
    if not cfg.enable_condition_rating:
        return {"enabled": False}
    reference_area = image_area_px2
    if cfg.reference_area_mode == "custom_px2" and cfg.reference_area_px2 > 0:
        reference_area = cfg.reference_area_px2

    damage_rows = []
    d_values: List[float] = []
    s_values: List[float] = []
    ec_ranks: List[int] = []
    affected_area_px2 = 0.0
    max_fi = 0.0

    for rec in records:
        if rec.time_label != "t1_current" or rec.damage_class not in DAMAGE_WEIGHTS_FP:
            continue
        fp = DAMAGE_WEIGHTS_FP.get(rec.damage_class, 1.0)
        fi = assign_fi_by_metric(rec.damage_class, rec, reference_area, scale)
        d = damage_D_from_fi_fp(fi, fp)
        s_img = severity_continuous_img(rec.damage_class, rec, reference_area, scale, cfg)
        ec_rank = ec_rank_from_severity(s_img, cfg)
        ec_dnit_damage, ec_dnit_damage_label = dnit_ec_from_rank(ec_rank)
        participates = family_included_in_rating(rec.damage_class, cfg)
        if participates:
            max_fi = max(max_fi, fi)
            if d > 0:
                d_values.append(d)
            s_values.append(s_img)
            ec_ranks.append(ec_rank)
            if rec.damage_class in ("spalling_dark", "exposed_rebar", "corrosion_rust", "efflorescence_white", "cracks"):
                affected_area_px2 += rec.area_px2
        damage_rows.append({
            "record_id": rec.record_id,
            "class": rec.damage_class,
            "class_label": CLASS_LABELS.get(rec.damage_class, rec.damage_class),
            "area_ratio": rec.area_px2 / max(reference_area, 1.0),
            "s_img": s_img,
            "EC_rank_img": ec_rank,
            "EC_DNIT_damage_img": ec_dnit_damage,
            "EC_DNIT_damage_label": ec_dnit_damage_label,
            "Fi": fi,
            "Fp": fp,
            "D": d,
            "included_in_rating": bool(participates),
        })

    family_rows = compute_family_summaries(damage_rows, cfg)

    # Legacy GDE/UnB image-aided diagnostic: kept as a quantitative deterioration index, not as the direct NT.
    if not d_values:
        gde = 0.0
    else:
        dmax = max(d_values)
        sD = sum(d_values)
        gde = dmax * (1.0 + ((sD - dmax) / sD)) if sD > 0 else 0.0
    gde_level, gde_action = classify_gde_value(gde)

    fr = cfg.structural_relevance_fr if cfg.structural_relevance_fr > 0 else FAMILY_FR.get(cfg.element_family, 4.0)
    kde = gde * fr

    affected_area_ratio = affected_area_px2 / max(reference_area, 1.0)
    max_rank = max(ec_ranks) if ec_ranks else 0
    delta = delta_extension_recurrence(len(ec_ranks), affected_area_ratio, cfg) if max_rank > 0 else 0
    element_rank_img = min(4, max_rank + delta) if max_rank > 0 else 0
    ec_dnit_img, ec_dnit_img_label = dnit_ec_from_rank(element_rank_img) if element_rank_img > 0 else (4, "Bom")

    critical_element = fr >= cfg.critical_weight_threshold
    if element_rank_img == 0:
        nt_img, nt_label_img = 5, "Excelente/sem dano detectado"
        structure_rank_img = 0
    else:
        # Full OAE NT is normally governed by critical elements. With a single image/element,
        # non-critical elements are allowed to reduce one level, without hiding a severe condition.
        if critical_element:
            structure_rank_img = element_rank_img
        else:
            structure_rank_img = max(1, element_rank_img - 1) if element_rank_img < 4 else 3
        severe_rebar = any(row["class"] == "exposed_rebar" and row["s_img"] >= 0.90 and row.get("included_in_rating", True) for row in damage_rows)
        extreme_emergency = (max(s_values) >= 0.95 if s_values else False) and severe_rebar and affected_area_ratio >= 0.003
        nt_img, nt_label_img = nt_from_structure_rank(structure_rank_img, cfg.allow_auto_emergency_nt0, extreme_emergency)

    # Compatibility fields preserve old names but now use the ordinal normative method by default.
    return {
        "enabled": True,
        "method": "ordinal_normative_v285",
        "reference_area_px2": reference_area,
        "affected_area_ratio": float(affected_area_ratio),
        "damage_rows": damage_rows,
        "family_rows": family_rows,
        "GDE_img": float(gde),
        "GDE": float(gde),
        "GDE_level": gde_level,
        "GDE_action": gde_action,
        "Fr": float(fr),
        "family": cfg.element_family,
        "family_label": FAMILY_LABELS.get(cfg.element_family, cfg.element_family),
        "K": float(kde),
        "critical_element": bool(critical_element),
        "delta_extension_recurrence": int(delta),
        "EC_rank_element_img": int(element_rank_img),
        "EC_DNIT_img": int(ec_dnit_img),
        "EC_DNIT_label_img": ec_dnit_img_label,
        "NT_img": int(nt_img),
        "NT_label_img": nt_label_img,
        "EC": int(ec_dnit_img),
        "EC_label": ec_dnit_img_label,
        "NT": int(nt_img),
        "NT_label": nt_label_img,
        "max_s_img": float(max(s_values) if s_values else 0.0),
        "max_Fi": float(max_fi),
        "equations_latex": CLASSIFICATION_EQUATIONS_LATEX,
        "equations_unicode": CLASSIFICATION_EQUATIONS_UNICODE,
        "included_families": {
            "cracks": bool(cfg.include_cracks_in_rating),
            "spalling_dark": bool(cfg.include_spalling_in_rating),
            "exposed_rebar": bool(cfg.include_rebar_in_rating),
            "corrosion_rust": bool(cfg.include_corrosion_in_rating),
            "efflorescence_white": bool(cfg.include_efflorescence_in_rating),
        },
    }


def summarize_records(records: List[DamageRecord], scale: ScaleInfo, cfg: Optional[DetectorConfig] = None, image_area_px2: float = 0.0) -> Dict[str, object]:
    counts: Dict[str, int] = {}
    spalling_area = 0.0
    rebar_area = 0.0
    crack_lengths: List[float] = []
    crack_widths: List[float] = []
    for rec in records:
        counts[rec.damage_class] = counts.get(rec.damage_class, 0) + 1
        if rec.damage_class == "spalling_dark":
            spalling_area += rec.area_px2
        elif rec.damage_class == "exposed_rebar":
            rebar_area += rec.area_px2
        elif rec.damage_class == "cracks":
            crack_lengths.append(rec.length_px)
            if rec.width_px > 0:
                crack_widths.append(rec.width_px)
    summary: Dict[str, object] = {
        "counts": counts,
        "total_objects": len(records),
        "spalling_area_px2": spalling_area,
        "rebar_area_px2": rebar_area,
        "crack_count": len(crack_lengths),
        "crack_length_total_px": float(sum(crack_lengths)),
        "crack_length_mean_px": safe_mean(crack_lengths),
        "crack_width_mean_px": safe_mean(crack_widths),
        "crack_width_max_px": max(crack_widths) if crack_widths else 0.0,
        "image_area_px2": float(image_area_px2),
    }
    if cfg is not None:
        summary["condition_rating"] = compute_condition_rating(records, scale, cfg, image_area_px2)
    else:
        summary["condition_rating"] = {"enabled": False}
    return summary



def condition_lines(summary: Dict[str, object], language: str = "pt") -> List[str]:
    rating = summary.get("condition_rating", {})
    if not isinstance(rating, dict) or not rating.get("enabled"):
        return []
    lang = normalize_language(language)
    if lang == "en":
        base = [
            f"NT_img normative screening: NT{rating['NT_img']} - {rating['NT_label_img']}",
            f"EC_DNIT_img: EC{rating['EC_DNIT_img']} - {rating['EC_DNIT_label_img']}",
            f"GDE_img diagnostic index: {rating['GDE_img']:.2f} - {rating['GDE_level']}",
            f"Family: {rating['family_label']} | Fr={rating['Fr']:.1f}",
        ]
    elif lang == "fr":
        base = [
            f"NT_img normatif préliminaire : NT{rating['NT_img']} - {rating['NT_label_img']}",
            f"EC_DNIT_img : EC{rating['EC_DNIT_img']} - {rating['EC_DNIT_label_img']}",
            f"GDE_img diagnostique : {rating['GDE_img']:.2f} - {rating['GDE_level']}",
            f"Famille : {rating['family_label']} | Fr={rating['Fr']:.1f}",
        ]
    else:
        base = [
            f"NT_img preliminar normativa: NT{rating['NT_img']} - {rating['NT_label_img']}",
            f"EC_DNIT_img: EC{rating['EC_DNIT_img']} - {rating['EC_DNIT_label_img']}",
            f"GDE_img diagnóstico: {rating['GDE_img']:.2f} - {rating['GDE_level']}",
            f"Família estrutural: {rating['family_label']} | Fr={rating['Fr']:.1f}",
        ]
    fams = rating.get("family_rows", [])
    if fams:
        base.append("Classificações parciais por família de patologia:")
        for fam in fams:
            if int(fam.get("n", 0)) <= 0:
                continue
            base.append(
                f"- {fam.get('class_label')}: n={fam.get('n')}; "
                f"s_max={float(fam.get('s_max', 0.0)):.2f}; "
                f"EC{fam.get('EC_DNIT_family_img')} {fam.get('EC_DNIT_family_label')}; "
                f"uso_final={'ativo' if fam.get('included_in_rating', True) else 'ignorado'}; "
                f"governa={fam.get('governing_record_id')}"
            )
    return base

def build_result_text(summary: Dict[str, object], scale: ScaleInfo, temporal_stats: Dict[str, Dict[str, float]], language: str = "pt", temporal_quality: Optional[Dict[str, object]] = None) -> str:
    lang = normalize_language(language)
    counts: Dict[str, int] = summary["counts"]  # type: ignore

    def count_for(key: str) -> int:
        return int(counts.get(key, 0))

    if lang == "en":
        lines = [
            "PRELIMINARY RESULTS - Concrete Damage Morphology v2.8.5",
            f"Total detections: {summary['total_objects']}",
            f"Cracks: {count_for('cracks')} | Spalling: {count_for('spalling_dark')} | Exposed reinforcement: {count_for('exposed_rebar')}",
            f"Corrosion: {count_for('corrosion_rust')} | Efflorescence: {count_for('efflorescence_white')}",
            f"Total spalling area: {area_mm2_or_px_label(float(summary['spalling_area_px2']), scale)}",
            f"Total exposed reinforcement area: {area_mm2_or_px_label(float(summary['rebar_area_px2']), scale)}",
        ]
        lines.extend(condition_lines(summary, lang))
        if int(summary["crack_count"]) > 0:
            lines.extend([
                f"Total crack length: {mm_or_px_label(float(summary['crack_length_total_px']), scale)}",
                f"Mean crack length: {mm_or_px_label(float(summary['crack_length_mean_px']), scale)}",
                f"Estimated mean crack width: {mm_or_px_label(float(summary['crack_width_mean_px']), scale)}",
                f"Estimated maximum crack width: {mm_or_px_label(float(summary['crack_width_max_px']), scale)}",
            ])
        if temporal_stats:
            lines.append("Temporal comparison:")
            for cls, st in temporal_stats.items():
                lines.append(f"- {label_for(cls, lang)} | IoU={st['iou']:.3f} | growth={st['growth_area_px2']:.1f}px² | reduction={st['reduction_area_px2']:.1f}px²")
        if temporal_quality:
            qm = temporal_quality.get("metrics", {}) if isinstance(temporal_quality, dict) else {}
            lines.append(f"Temporal quality: {temporal_quality.get('status', 'unknown')} | validated={temporal_quality.get('validated_for_change_quantification', False)} | overlap={100.0*float(qm.get('overlap_ratio',0.0)):.1f}% | illumination Δ={100.0*float(qm.get('illumination_delta',0.0)):.1f}% | sharpness ratio={float(qm.get('sharpness_ratio',0.0)):.2f}")
        lines.append("Note: preliminary result; validate manually in Inkscape.")
        return "\n".join(lines)

    if lang == "fr":
        lines = [
            "RÉSULTATS PRÉLIMINAIRES - Concrete Damage Morphology v2.8.5",
            f"Détections totales : {summary['total_objects']}",
            f"Fissures : {count_for('cracks')} | Écaillages : {count_for('spalling_dark')} | Armatures exposées : {count_for('exposed_rebar')}",
            f"Corrosion : {count_for('corrosion_rust')} | Efflorescence : {count_for('efflorescence_white')}",
            f"Surface totale d’écaillage : {area_mm2_or_px_label(float(summary['spalling_area_px2']), scale)}",
            f"Surface totale d’armature exposée : {area_mm2_or_px_label(float(summary['rebar_area_px2']), scale)}",
        ]
        lines.extend(condition_lines(summary, lang))
        if int(summary["crack_count"]) > 0:
            lines.extend([
                f"Longueur totale des fissures : {mm_or_px_label(float(summary['crack_length_total_px']), scale)}",
                f"Longueur moyenne des fissures : {mm_or_px_label(float(summary['crack_length_mean_px']), scale)}",
                f"Largeur moyenne estimée des fissures : {mm_or_px_label(float(summary['crack_width_mean_px']), scale)}",
                f"Largeur maximale estimée des fissures : {mm_or_px_label(float(summary['crack_width_max_px']), scale)}",
            ])
        if temporal_stats:
            lines.append("Comparaison temporelle :")
            for cls, st in temporal_stats.items():
                lines.append(f"- {label_for(cls, lang)} | IoU={st['iou']:.3f} | croissance={st['growth_area_px2']:.1f}px² | réduction={st['reduction_area_px2']:.1f}px²")
        if temporal_quality:
            qm = temporal_quality.get("metrics", {}) if isinstance(temporal_quality, dict) else {}
            lines.append(f"Qualité temporelle : {temporal_quality.get('status', 'unknown')} | validée={temporal_quality.get('validated_for_change_quantification', False)} | recouvrement={100.0*float(qm.get('overlap_ratio',0.0)):.1f}% | Δ éclairage={100.0*float(qm.get('illumination_delta',0.0)):.1f}% | ratio netteté={float(qm.get('sharpness_ratio',0.0)):.2f}")
        lines.append("Remarque : résultat préliminaire ; valider manuellement dans Inkscape.")
        return "\n".join(lines)

    lines = [
        "RESULTADOS PRELIMINARES - Concrete Damage Morphology v2.8.5",
        f"Detecções totais: {summary['total_objects']}",
        f"Fissuras: {count_for('cracks')} | Desplacamentos: {count_for('spalling_dark')} | Armaduras expostas: {count_for('exposed_rebar')}",
        f"Corrosão: {count_for('corrosion_rust')} | Eflorescência: {count_for('efflorescence_white')}",
        f"Área total de desplacamento: {area_mm2_or_px_label(float(summary['spalling_area_px2']), scale)}",
        f"Área total de armadura exposta: {area_mm2_or_px_label(float(summary['rebar_area_px2']), scale)}",
    ]
    lines.extend(condition_lines(summary, lang))
    if int(summary["crack_count"]) > 0:
        lines.extend([
            f"Comprimento total de fissuras: {mm_or_px_label(float(summary['crack_length_total_px']), scale)}",
            f"Comprimento médio de fissuras: {mm_or_px_label(float(summary['crack_length_mean_px']), scale)}",
            f"Largura média estimada de fissuras: {mm_or_px_label(float(summary['crack_width_mean_px']), scale)}",
            f"Largura máxima estimada de fissuras: {mm_or_px_label(float(summary['crack_width_max_px']), scale)}",
        ])
    if temporal_stats:
        lines.append("Comparação temporal:")
        for cls, st in temporal_stats.items():
            lines.append(f"- {label_for(cls, lang)} | IoU={st['iou']:.3f} | crescimento={st['growth_area_px2']:.1f}px² | redução={st['reduction_area_px2']:.1f}px²")
    if temporal_quality:
        qm = temporal_quality.get("metrics", {}) if isinstance(temporal_quality, dict) else {}
        lines.append(f"Qualidade temporal: {temporal_quality.get('status', 'unknown')} | validada={temporal_quality.get('validated_for_change_quantification', False)} | sobreposição={100.0*float(qm.get('overlap_ratio',0.0)):.1f}% | Δ iluminação={100.0*float(qm.get('illumination_delta',0.0)):.1f}% | razão de nitidez={float(qm.get('sharpness_ratio',0.0)):.2f}")
    lines.append("Observação: resultado preliminar; validar manualmente no Inkscape.")
    return "\n".join(lines)


def show_result_popup(text: str) -> None:
    shown = False
    if tk is not None and messagebox is not None:
        try:
            root = tk.Tk()
            root.withdraw()
            root.attributes("-topmost", True)
            messagebox.showinfo("Concrete Damage Morphology - Resultados", text)
            root.destroy()
            shown = True
        except Exception:
            shown = False
    if not shown:
        log_error(text)


def detect_records(rgb: np.ndarray, cfg: DetectorConfig, time_label: str = "t1_current", profiler: Optional[PerformanceProfiler] = None) -> Tuple[List[DamageRecord], Dict[str, object]]:
    masks, pipeline = detect_masks(rgb, cfg, profiler=profiler, run_tag=time_label)
    records: List[DamageRecord] = []
    for cls, mask in masks.items():
        with _profile_stage(profiler, f"{time_label} | {label_for(cls, cfg.language)} | componentes conectados + geometria"):
            records.extend(records_from_mask(mask, cls, time_label, cfg))
    return records, {"masks": masks, "pipeline": pipeline}


def temporal_records(current_masks: Dict[str, np.ndarray], previous_masks: Dict[str, np.ndarray], cfg: DetectorConfig) -> Tuple[List[DamageRecord], Dict[str, Dict[str, float]]]:
    records: List[DamageRecord] = []
    stats: Dict[str, Dict[str, float]] = {}
    for cls, cur in current_masks.items():
        if cls not in previous_masks:
            continue
        prev = previous_masks[cls]
        if prev.shape != cur.shape:
            prev = resize_mask(prev, cur.shape)
        growth = cur & (~prev)
        reduction = prev & (~cur)
        inter = float(np.logical_and(cur, prev).sum())
        union = float(np.logical_or(cur, prev).sum())
        stats[cls] = {
            "iou": inter / union if union > 0 else 1.0,
            "growth_area_px2": float(growth.sum()),
            "reduction_area_px2": float(reduction.sum()),
        }
        for rec in records_from_mask(growth, "growth", f"growth_{cls}", cfg):
            rec.confidence_note += f" Classe base: {CLASS_LABELS.get(cls, cls)}."
            records.append(rec)
        for rec in records_from_mask(reduction, "reduction", f"reduction_{cls}", cfg):
            rec.confidence_note += f" Classe base: {CLASS_LABELS.get(cls, cls)}."
            records.append(rec)
    return records, stats


def create_svg_root(width: float, height: float):
    root = etree.Element(f"{{{SVG_NS}}}svg", nsmap=NSMAP)
    root.set("width", str(width))
    root.set("height", str(height))
    root.set("viewBox", f"0 0 {width} {height}")
    return root


def safe_id(text: str) -> str:
    return "id_" + "".join(ch if ch.isalnum() else "_" for ch in text)[:80]


def make_layer(label: str):
    layer = etree.Element(f"{{{SVG_NS}}}g")
    layer.set(f"{{{INKSCAPE_NS}}}label", label)
    layer.set(f"{{{INKSCAPE_NS}}}groupmode", "layer")
    layer.set("id", safe_id(label))
    return layer


def image_href(path: str) -> str:
    return Path(path).resolve().as_uri()


def add_image_layer(root, path: str, placement: ImagePlacement, label: str = "Original image") -> None:
    layer = make_layer(label)
    image_element = etree.Element(f"{{{SVG_NS}}}image")
    image_element.set("x", f"{placement.x}")
    image_element.set("y", f"{placement.y}")
    image_element.set("width", f"{placement.width_svg}")
    image_element.set("height", f"{placement.height_svg}")
    uri = image_href(path)
    image_element.set("href", uri)
    image_element.set(f"{{{XLINK_NS}}}href", uri)
    layer.append(image_element)
    root.append(layer)


def is_output_layer(elem) -> bool:
    label = elem.get(f"{{{INKSCAPE_NS}}}label", "") or elem.get("id", "") or ""
    prefixes = (
        "t1_current -", "t0_previous -", "growth_", "reduction_",
        "Damage summary", "Original image - current"
    )
    return any(label.startswith(prefix) for prefix in prefixes)


def cleanup_existing_output_layers(root) -> None:
    # Remove somente camadas geradas por execuções anteriores do plugin.
    # Isso faz a reaplicação com novo kernel substituir o resultado antigo.
    for child in list(root):
        if child.tag.endswith("}g") and is_output_layer(child):
            root.remove(child)


def image_element_info(elem) -> Tuple[Optional[str], Optional[ImagePlacement]]:
    href = elem.get("href") or elem.get(f"{{{XLINK_NS}}}href")
    if not href:
        return None, None
    x = parse_float(elem.get("x"), 0.0)
    y = parse_float(elem.get("y"), 0.0)
    w = parse_float(elem.get("width"), 0.0)
    h = parse_float(elem.get("height"), 0.0)
    if href.startswith("data:image"):
        header, b64data = href.split(",", 1)
        suffix = ".png"
        if "jpeg" in header or "jpg" in header:
            suffix = ".jpg"
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        tmp.write(base64.b64decode(b64data))
        tmp.close()
        path = tmp.name
    else:
        path = resolve_href_to_path(href)
    try:
        img = read_image(path)
        pw, ph = img.size
    except Exception:
        return None, None
    placement = ImagePlacement(x=x, y=y, width_svg=w or pw, height_svg=h or ph, width_px=pw, height_px=ph)
    return path, placement


def document_image_info(root) -> Tuple[Optional[str], Optional[ImagePlacement]]:
    # Quando o usuário reaplica a extensão, o Inkscape às vezes perde a seleção.
    # Neste caso, usamos a maior imagem raster existente no documento.
    candidates = []
    for elem in root.iter(f"{{{SVG_NS}}}image"):
        path, placement = image_element_info(elem)
        if path and placement:
            area = float(placement.width_svg) * float(placement.height_svg)
            candidates.append((area, path, placement))
    if not candidates:
        return None, None
    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0][1], candidates[0][2]


def path_d(points: Sequence[Tuple[float, float]], closed: bool) -> str:
    if not points:
        return ""
    d = [f"M {points[0][0]:.2f},{points[0][1]:.2f}"]
    for x, y in points[1:]:
        d.append(f"L {x:.2f},{y:.2f}")
    if closed:
        d.append("Z")
    return " ".join(d)


def add_records_layers(root, records: List[DamageRecord], placement: ImagePlacement, cfg: DetectorConfig) -> None:
    grouped: Dict[Tuple[str, str], List[DamageRecord]] = {}
    for rec in records:
        grouped.setdefault((rec.time_label, rec.damage_class), []).append(rec)

    time_labels: List[str] = []
    for rec in records:
        if rec.time_label not in time_labels:
            time_labels.append(rec.time_label)

    for time_label in time_labels:
        for cls in LAYER_ORDER:
            recs = grouped.get((time_label, cls), [])
            if not recs:
                continue
            layer = make_layer(f"{time_label} - {CLASS_LABELS.get(cls, cls)}")
            style = CLASS_STYLES.get(cls, CLASS_STYLES["spalling_dark"])
            for rec in recs:
                mapped = [placement.map_point(x, y) for x, y in rec.points]
                path = etree.Element(f"{{{SVG_NS}}}path")
                path.set("id", safe_id(rec.record_id))
                path.set("d", path_d(mapped, rec.is_closed))
                stroke_w = cfg.stroke_width if cls != "cracks" else max(cfg.stroke_width, 1.3)
                path.set(
                    "style",
                    f"fill:{style['fill']};fill-opacity:{style['fill_opacity']};"
                    f"stroke:{style['stroke']};stroke-width:{stroke_w};"
                    f"stroke-opacity:{style['stroke_opacity']};stroke-linecap:round;stroke-linejoin:round;",
                )
                path.set("data-record-id", rec.record_id)
                path.set("data-class", rec.damage_class)
                path.set("data-area-px2", f"{rec.area_px2:.2f}")
                path.set("data-perimeter-px", f"{rec.perimeter_px:.2f}")
                path.set("data-length-px", f"{rec.length_px:.2f}")
                path.set("data-width-px", f"{rec.width_px:.2f}")
                path.set("data-aspect-ratio", f"{rec.aspect_ratio:.2f}")
                layer.append(path)
            root.append(layer)


def add_summary_layer(root, records: List[DamageRecord], temporal_stats: Dict[str, Dict[str, float]], scale: ScaleInfo, language: str = "pt", cfg: Optional[DetectorConfig] = None, image_area_px2: float = 0.0) -> None:
    layer = make_layer("Damage summary")
    summary = summarize_records(records, scale, cfg, image_area_px2)
    report = build_result_text(summary, scale, temporal_stats, language)
    width = parse_float(root.get("width"), 800.0)
    x0 = max(10.0, width - 360.0)
    y0 = 12.0
    rating = summary.get("condition_rating", {})
    # Compact dashboard inspired by structural-inspection cards.
    card = etree.Element(f"{{{SVG_NS}}}rect")
    card.set("x", f"{x0:.1f}")
    card.set("y", f"{y0:.1f}")
    card.set("width", "348")
    card.set("height", "280")
    card.set("rx", "12")
    card.set("style", "fill:#2e2b25;fill-opacity:0.86;stroke:#d19745;stroke-width:1.2;")
    layer.append(card)
    title = etree.Element(f"{{{SVG_NS}}}text")
    title.set("x", f"{x0+14:.1f}")
    title.set("y", f"{y0+24:.1f}")
    title.set("style", "font-size:10px;font-family:Arial;letter-spacing:2px;fill:#b7a88d;")
    title.text = "CLASSIFICAÇÃO PRELIMINAR"
    layer.append(title)
    if isinstance(rating, dict) and rating.get("enabled"):
        main = f"NT{rating.get('NT_img', rating.get('NT', '-')) }"
        sub = f"EC{rating.get('EC_DNIT_img', rating.get('EC', '-')) } · GDE_img {float(rating.get('GDE_img', rating.get('GDE', 0.0))):.1f}"
        level = f"{rating.get('NT_label','')} | {rating.get('GDE_level','')}"
    else:
        main = "NT--"
        sub = "EC-- · GDE--"
        level = "Classificação desativada"
    tmain = etree.Element(f"{{{SVG_NS}}}text")
    tmain.set("x", f"{x0+18:.1f}")
    tmain.set("y", f"{y0+72:.1f}")
    tmain.set("style", "font-size:48px;font-family:Arial;font-weight:bold;fill:#f28c35;")
    tmain.text = main
    layer.append(tmain)
    tsub = etree.Element(f"{{{SVG_NS}}}text")
    tsub.set("x", f"{x0+170:.1f}")
    tsub.set("y", f"{y0+57:.1f}")
    tsub.set("style", "font-size:18px;font-family:Arial;font-weight:bold;fill:#d7c7a6;")
    tsub.text = sub
    layer.append(tsub)
    tlevel = etree.Element(f"{{{SVG_NS}}}text")
    tlevel.set("x", f"{x0+18:.1f}")
    tlevel.set("y", f"{y0+102:.1f}")
    tlevel.set("style", "font-size:13px;font-family:Arial;fill:#f2e8d6;")
    tlevel.text = level
    layer.append(tlevel)
    short_lines = [
        f"Detecções: {summary['total_objects']}  |  Fissuras: {summary['crack_count']}",
        f"Desplac.: {area_mm2_or_px_label(float(summary['spalling_area_px2']), scale)}",
        f"Armadura exp.: {area_mm2_or_px_label(float(summary['rebar_area_px2']), scale)}",
        f"L fissuras: {mm_or_px_label(float(summary['crack_length_total_px']), scale)}",
    ]
    for i, line in enumerate(short_lines):
        txt = etree.Element(f"{{{SVG_NS}}}text")
        txt.set("x", f"{x0+18:.1f}")
        txt.set("y", f"{y0+128+i*15:.1f}")
        txt.set("style", "font-size:11px;font-family:Arial;fill:#dfd2b9;")
        txt.text = line
        layer.append(txt)
    if isinstance(rating, dict) and rating.get("enabled"):
        fam_y = y0 + 198
        hdr = etree.Element(f"{{{SVG_NS}}}text")
        hdr.set("x", f"{x0+18:.1f}")
        hdr.set("y", f"{fam_y:.1f}")
        hdr.set("style", "font-size:10px;font-family:Arial;font-weight:bold;letter-spacing:1px;fill:#b7a88d;")
        hdr.text = "RASTREIO POR FAMÍLIA"
        layer.append(hdr)
        j = 1
        for fam in rating.get("family_rows", []):
            if int(fam.get("n", 0)) <= 0:
                continue
            txt = etree.Element(f"{{{SVG_NS}}}text")
            txt.set("x", f"{x0+18:.1f}")
            txt.set("y", f"{fam_y+j*14:.1f}")
            txt.set("style", "font-size:9.5px;font-family:Arial;fill:#dfd2b9;")
            use_tag = "✓" if fam.get("included_in_rating", True) else "off"
            txt.text = f"{fam.get('class_label')}: EC{fam.get('EC_DNIT_family_img')} · s={float(fam.get('s_max',0.0)):.2f} · n={fam.get('n')} · {use_tag}"
            layer.append(txt)
            j += 1
    # Full result text in a compact hidden-style block below the card area.
    for i, line in enumerate(report.splitlines()):
        text_el = etree.Element(f"{{{SVG_NS}}}text")
        text_el.set("x", f"{x0:.1f}")
        text_el.set("y", str(y0 + 315 + i * 14))
        text_el.set("style", "font-size:9px;font-family:Arial;fill:#000000;")
        text_el.text = line
        layer.append(text_el)
    root.append(layer)


def format_optional(value: Optional[float], digits: int = 4) -> str:
    return "" if value is None else f"{value:.{digits}f}"


def write_csv(records: List[DamageRecord], csv_path: str, scale: ScaleInfo, temporal_stats: Dict[str, Dict[str, float]], condition_rating: Optional[Dict[str, object]] = None, temporal_quality: Optional[Dict[str, object]] = None) -> None:
    path = Path(csv_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f, delimiter=";")
        writer.writerow([
            "record_id", "time_label", "damage_class", "class_label", "area_px2", "area_mm2", "area_cm2",
            "perimeter_px", "perimeter_mm", "length_px", "length_mm", "width_px", "width_mm",
            "bbox_x", "bbox_y", "bbox_w", "bbox_h", "aspect_ratio", "confidence_note",
        ])
        for rec in records:
            area_mm2 = scale.px2_to_mm2(rec.area_px2)
            perim_mm = scale.px_to_mm(rec.perimeter_px)
            length_mm = scale.px_to_mm(rec.length_px)
            width_mm = scale.px_to_mm(rec.width_px)
            writer.writerow([
                rec.record_id,
                rec.time_label,
                rec.damage_class,
                CLASS_LABELS.get(rec.damage_class, rec.damage_class),
                f"{rec.area_px2:.2f}",
                format_optional(area_mm2, 4),
                format_optional(None if area_mm2 is None else area_mm2 / 100.0, 4),
                f"{rec.perimeter_px:.2f}",
                format_optional(perim_mm, 4),
                f"{rec.length_px:.2f}",
                format_optional(length_mm, 4),
                f"{rec.width_px:.2f}",
                format_optional(width_mm, 4),
                *rec.bbox,
                f"{rec.aspect_ratio:.3f}",
                rec.confidence_note,
            ])
        if temporal_stats:
            writer.writerow([])
            writer.writerow(["temporal_class", "iou", "growth_area_px2", "reduction_area_px2"])
            for cls, st in temporal_stats.items():
                writer.writerow([cls, f"{st['iou']:.6f}", f"{st['growth_area_px2']:.2f}", f"{st['reduction_area_px2']:.2f}"])
        if temporal_quality:
            qm = temporal_quality.get("metrics", {}) if isinstance(temporal_quality, dict) else {}
            writer.writerow([])
            writer.writerow(["temporal_quality", "value", "note"])
            writer.writerow(["status", temporal_quality.get("status"), "validated" if temporal_quality.get("validated_for_change_quantification") else "not_validated"])
            writer.writerow(["overlap_ratio", qm.get("overlap_ratio"), ""])
            writer.writerow(["illumination_delta", qm.get("illumination_delta"), ""])
            writer.writerow(["sharpness_ratio", qm.get("sharpness_ratio"), ""])
            writer.writerow(["issues", "|".join(temporal_quality.get("issues", []) or []), ""])
            writer.writerow(["warnings", "|".join(temporal_quality.get("warnings", []) or []), ""])
        if condition_rating and condition_rating.get("enabled"):
            writer.writerow([])
            writer.writerow(["classification_summary", "value", "label_or_note"])
            writer.writerow(["Metodo", condition_rating.get("method"), "ordinal normativo + GDE diagnóstico"])
            writer.writerow(["NT_img_preliminar", condition_rating.get("NT_img"), condition_rating.get("NT_label_img")])
            writer.writerow(["EC_DNIT_img", condition_rating.get("EC_DNIT_img"), condition_rating.get("EC_DNIT_label_img")])
            writer.writerow(["EC_rank_element_img", condition_rating.get("EC_rank_element_img"), "escala interna: 1=leve, 4=grave"])
            writer.writerow(["GDE_img_diagnostico", f"{float(condition_rating.get('GDE_img', 0.0)):.4f}", condition_rating.get("GDE_level")])
            writer.writerow(["GDE_action", "", condition_rating.get("GDE_action")])
            writer.writerow(["Area_afetada_relativa", f"{float(condition_rating.get('affected_area_ratio', 0.0)):.8f}", "usada no agravamento por extensão"])
            writer.writerow(["Delta_extensao_recorrencia", condition_rating.get("delta_extension_recurrence"), "incremento ordinal 0 ou 1"])
            writer.writerow(["Familia", condition_rating.get("family"), condition_rating.get("family_label")])
            writer.writerow(["Fr", condition_rating.get("Fr"), "Fator de relevância estrutural"])
            writer.writerow(["Elemento_critico", condition_rating.get("critical_element"), "Fr >= limiar crítico"])
            writer.writerow(["K_GDE_x_Fr", condition_rating.get("K"), "Produto usado apenas para priorização"])
            writer.writerow([])
            writer.writerow(["family_rating", "class", "included_in_final_NT_GDE", "n", "area_ratio_sum", "s_max", "s_mean", "EC_rank_family_img", "EC_DNIT_family_img", "delta_family", "governing_record_id", "trace_formula"])
            for fam in condition_rating.get("family_rows", []):
                writer.writerow(["family", fam.get("class_label"), fam.get("included_in_rating", True), fam.get("n"), f"{float(fam.get('area_ratio_sum', 0.0)):.8f}", f"{float(fam.get('s_max', 0.0)):.4f}", f"{float(fam.get('s_mean', 0.0)):.4f}", fam.get("EC_rank_family_img"), fam.get("EC_DNIT_family_img"), fam.get("delta_family"), fam.get("governing_record_id"), fam.get("formula_trace")])
            writer.writerow([])
            writer.writerow(["math_equations_unicode", "equation"])
            for eq in condition_rating.get("equations_unicode", []):
                writer.writerow(["unicode_math", eq])
            writer.writerow(["latex_source_equations", "equation"])
            for eq in condition_rating.get("equations_latex", []):
                writer.writerow(["latex_source", eq])
            writer.writerow([])
            writer.writerow(["damage_rating", "record_id", "class", "included_in_final_NT_GDE", "area_ratio", "s_img", "EC_rank_img", "EC_DNIT_damage_img", "Fi", "Fp", "D"])
            for row in condition_rating.get("damage_rows", []):
                writer.writerow(["damage", row.get("record_id"), row.get("class_label"), row.get("included_in_rating", True), f"{float(row.get('area_ratio', 0.0)):.8f}", f"{float(row.get('s_img', 0.0)):.4f}", row.get("EC_rank_img"), row.get("EC_DNIT_damage_img"), row.get("Fi"), row.get("Fp"), f"{float(row.get('D', 0.0)):.4f}"])



def plugin_state_dir() -> Path:
    base = Path(os.environ.get("APPDATA", str(Path.home())))
    path = base / "inkscape_shm_morphology"
    path.mkdir(parents=True, exist_ok=True)
    return path


def plugin_state_path() -> Path:
    return plugin_state_dir() / "last_state_v285_native.json"


def plugin_history_path() -> Path:
    return plugin_state_dir() / "results_history_v285_native.jsonl"


def cfg_to_state(cfg: DetectorConfig, image_path: str) -> Dict[str, object]:
    return {
        "version": "2.3.0-native",
        "image_path": image_path,
        "source_mode": cfg.source_mode,
        "previous_image_path": cfg.previous_image_path,
        "detection_scope": cfg.detection_scope,
        "threshold": cfg.threshold,
        "kernel_size": cfg.kernel_size,
        "min_area": cfg.min_area,
        "min_aspect_ratio": cfg.min_aspect_ratio,
        "stroke_width": cfg.stroke_width,
        "calibration_mode": cfg.calibration_mode,
        "mm_per_px": cfg.mm_per_px,
        "reference_length_px": cfg.reference_length_px,
        "reference_length_mm": cfg.reference_length_mm,
        "compare_previous": cfg.compare_previous,
        "alignment_method": cfg.alignment_method,
        "export_csv": cfg.export_csv,
        "export_dxf": cfg.export_dxf,
        "export_bim_json": cfg.export_bim_json,
        "export_coco": cfg.export_coco,
        "export_ifc": cfg.export_ifc,
        "export_html": cfg.export_html,
        "output_dir": cfg.output_dir,
        "output_mode": cfg.output_mode,
        "bim_project_id": cfg.bim_project_id,
        "bim_element_guid": cfg.bim_element_guid,
        "bim_surface_id": cfg.bim_surface_id,
        "bim_coordinate_system": cfg.bim_coordinate_system,
        "language": cfg.language,
        "enable_condition_rating": cfg.enable_condition_rating,
        "element_family": cfg.element_family,
        "structural_relevance_fr": cfg.structural_relevance_fr,
        "reference_area_mode": cfg.reference_area_mode,
        "reference_area_px2": cfg.reference_area_px2,
        "environmental_aggressiveness": cfg.environmental_aggressiveness,
        "allow_auto_emergency_nt0": cfg.allow_auto_emergency_nt0,
        "use_ordinal_normative_method": cfg.use_ordinal_normative_method,
        "ordinal_tau1": cfg.ordinal_tau1,
        "ordinal_tau2": cfg.ordinal_tau2,
        "ordinal_tau3": cfg.ordinal_tau3,
        "recurrence_threshold": cfg.recurrence_threshold,
        "extension_threshold": cfg.extension_threshold,
        "critical_weight_threshold": cfg.critical_weight_threshold,
        "include_cracks_in_rating": cfg.include_cracks_in_rating,
        "include_spalling_in_rating": cfg.include_spalling_in_rating,
        "include_rebar_in_rating": cfg.include_rebar_in_rating,
        "include_corrosion_in_rating": cfg.include_corrosion_in_rating,
        "include_efflorescence_in_rating": cfg.include_efflorescence_in_rating,
    }


def save_plugin_state(cfg: DetectorConfig, image_path: str, report: str) -> None:
    data = cfg_to_state(cfg, image_path)
    data["last_report"] = report
    plugin_state_path().write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    with plugin_history_path().open("a", encoding="utf-8") as f:
        f.write(json.dumps(data, ensure_ascii=False) + "\n")


def load_plugin_state() -> Dict[str, object]:
    path = plugin_state_path()
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def apply_saved_state_to_empty_fields(cfg: DetectorConfig) -> DetectorConfig:
    state = load_plugin_state()
    if not state:
        return cfg
    # Native Inkscape dialogs usually remember values, but this fallback recovers
    # key paths when fields are blank after reopening the module.
    for key in ["image_path", "previous_image_path", "output_dir", "bim_project_id", "bim_element_guid", "bim_surface_id"]:
        if hasattr(cfg, key) and not str(getattr(cfg, key) or "").strip() and state.get(key):
            setattr(cfg, key, str(state.get(key)))
    return cfg


def _strip_path_field(value: str) -> str:
    text = (value or "").strip().strip('"').strip("'").strip()
    # Inkscape/GTK can return file URIs for path widgets. Convert them to OS paths.
    if text.startswith("file://"):
        return resolve_href_to_path(text)
    # Some Windows file selectors return /C:/Users/... . Normalize to C:/Users/...
    if os.name == "nt" and len(text) > 3 and text[0] in ("/", "\\") and text[2] == ":":
        text = text[1:]
    return text


def _looks_like_directory(path: Path, raw_text: str, suffix: str) -> bool:
    text = _strip_path_field(raw_text)
    if not text:
        return False
    if path.exists() and path.is_dir():
        return True
    if text.endswith(("/", "\\")):
        return True
    # If the user wrote a custom output field without extension, interpret it as a folder.
    # Example: C:\Users\DeLL\Documents\TESTE_PLUGINS\TESTE_1
    if path.suffix == "":
        return True
    return False


def _default_user_export_dir() -> Path:
    docs = Path.home() / "Documents"
    if not docs.exists():
        docs = Path.home()
    return docs / "SHM_Concrete_exports"


def _is_probably_temp_path(path: Path) -> bool:
    try:
        tmp = Path(tempfile.gettempdir()).resolve()
        return tmp in path.resolve().parents or path.resolve() == tmp
    except Exception:
        return False


def _ensure_writable_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    test_file = path / ".cdm_write_test.tmp"
    try:
        test_file.write_text("ok", encoding="utf-8")
        try:
            test_file.unlink()
        except Exception:
            pass
        return path
    except Exception as exc:
        fallback = _default_user_export_dir()
        fallback.mkdir(parents=True, exist_ok=True)
        log_error(
            "Aviso: a pasta de saída não permitiu escrita: "
            f"{path}. Detalhe: {exc}. Usando pasta alternativa: {fallback}"
        )
        return fallback


def resolve_export_base_dir(image_path: str, cfg: DetectorConfig) -> Path:
    """Resolve the single base directory used by all exports.

    v2.8.5: HTML, CSV, DXF, COCO, BIM JSON and IFC share this same base
    directory whenever their individual optional name/path fields are empty. This
    avoids the HTML being written beside a temporary embedded image while the
    other exports go to the configured folder.
    """
    img = Path(_strip_path_field(image_path))
    if cfg.output_mode == "custom_folder" and cfg.output_dir.strip():
        out_dir = Path(_strip_path_field(cfg.output_dir))
    else:
        out_dir = img.parent
        if _is_probably_temp_path(out_dir):
            out_dir = _default_user_export_dir()
    return _ensure_writable_dir(out_dir)


def resolve_output_path(image_path: str, cfg: DetectorConfig, explicit_path: str, suffix: str) -> str:
    """Resolve export path safely.

    Accepts empty field, folder path, file path, filename only, or file:// URI.
    Empty fields always use the common export folder resolved by
    resolve_export_base_dir(...).
    """
    img = Path(_strip_path_field(image_path))
    stem = img.stem or "inspection_image"
    explicit = _strip_path_field(explicit_path)
    base_dir = resolve_export_base_dir(image_path, cfg)

    if explicit:
        p = Path(explicit)
        # A folder typed in any optional field stores the auto-named file inside it.
        if _looks_like_directory(p, explicit, suffix):
            out_dir = _ensure_writable_dir(p)
            return str(out_dir / f"{stem}{suffix}")
        # Filename only: force it into the common export folder.
        if not p.is_absolute() and p.parent == Path('.'):
            if p.suffix == "":
                p = p.with_suffix(Path(suffix).suffix)
            return str(base_dir / p.name)
        # Full file path: use exactly its parent and name.
        if p.suffix == "":
            p = p.with_suffix(Path(suffix).suffix)
        out_dir = _ensure_writable_dir(p.parent)
        return str(out_dir / p.name)

    return str(base_dir / f"{stem}{suffix}")


def write_export_manifest(paths: Dict[str, str], out_dir: str, report: str) -> None:
    if not paths:
        return
    manifest_path = Path(out_dir) / "concrete_damage_export_manifest_v285.json"
    manifest = {
        "software": "Concrete Damage Morphology v2.8.5 - Native",
        "exported_files": paths,
        "report": report,
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")



def _bytes_to_mb(value: Optional[object]) -> Optional[float]:
    try:
        return float(value) / (1024.0 * 1024.0) if value is not None else None
    except Exception:
        return None


def write_performance_json(data: Dict[str, object], path: str) -> None:
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def write_performance_csv(data: Dict[str, object], path: str) -> None:
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    rows: List[Tuple[str, str, str, str, str]] = []
    rows.append(("run", "wall_total", f"{float(data.get('wall_total_s', 0.0)):.6f}", "s", "Actual plugin run; HTML composition excluded."))
    rows.append(("run", "cpu_total", f"{float(data.get('cpu_total_s', 0.0)):.6f}", "s", "Process CPU time."))
    rows.append(("run", "cpu_to_wall", f"{float(data.get('cpu_to_wall_pct', 0.0)):.2f}", "%", "CPU time / wall time."))
    for key, label in [("working_set_start_bytes", "working_set_start"), ("working_set_end_bytes", "working_set_end"), ("working_set_peak_sampled_bytes", "working_set_peak_sampled"), ("python_traced_peak_bytes", "python_traced_peak")]:
        mb = _bytes_to_mb(data.get(key))
        if mb is not None:
            rows.append(("memory", label, f"{mb:.3f}", "MiB", "Working set is sampled at stage boundaries; Python trace captures Python-managed allocations."))
    for stage in data.get("stages", []) if isinstance(data.get("stages"), list) else []:
        if isinstance(stage, dict):
            rows.append(("stage", str(stage.get("stage", "")), f"{float(stage.get('wall_s', 0.0)):.6f}", "s", f"CPU {float(stage.get('cpu_s', 0.0)):.6f} s"))
    env = data.get("environment", {})
    if isinstance(env, dict):
        for key, val in env.items():
            rows.append(("environment", str(key), str(val), "", "Runtime metadata"))
    model = data.get("model", {})
    if isinstance(model, dict):
        for key, val in model.items():
            rows.append(("model", str(key), str(val), "", "Processing configuration"))
    inputs = data.get("input", {})
    if isinstance(inputs, dict):
        for key, val in inputs.items():
            rows.append(("input", str(key), str(val), "", "Image and processing geometry"))
    detection = data.get("detection", {})
    if isinstance(detection, dict):
        for key, val in detection.items():
            if not isinstance(val, (dict, list)):
                rows.append(("detection", str(key), str(val), "", "Observed detection output"))
    with out.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["group", "indicator", "value", "unit", "note"])
        writer.writerows(rows)


def write_basic_html_report(summary: Dict[str, object], html_path: str, scale: ScaleInfo, cfg: DetectorConfig, temporal_stats=None, image_name: str = "", performance_data: Optional[Dict[str, object]] = None) -> str:
    """Fallback HTML writer with local charts, equations and documentation.

    v2.8.5: mesmo se o módulo cdm_html_report.py não for encontrado, o HTML
    continua completo o suficiente para auditoria: classificação por família,
    gráfico local por CSS, equações e documentação determinística.
    """
    def esc(v):
        import html as _html
        return _html.escape("" if v is None else str(v))
    rating = summary.get("condition_rating", {}) if isinstance(summary, dict) else {}
    if not isinstance(rating, dict):
        rating = {}
    nt = rating.get("NT_img", rating.get("NT", "5"))
    ec = rating.get("EC_DNIT_img", rating.get("EC", "4"))
    gde = float(rating.get("GDE_img", rating.get("GDE", 0.0)) or 0.0)
    fam_rows = rating.get("family_rows", []) or []
    damage_rows = rating.get("damage_rows", []) or []
    nt_color = {5:'#2E7D5B',4:'#6FA85B',3:'#C9A227',2:'#D97A34',1:'#C0473B',0:'#7A1E1E'}.get(int(float(nt)) if str(nt).replace('.','',1).isdigit() else 5, '#6B6F76')
    labels = {"cracks":"Fissuras","spalling_dark":"Desplacamento","exposed_rebar":"Armadura exposta","corrosion_rust":"Corrosão","efflorescence_white":"Eflorescência"}
    colors = {"cracks":"#C0473B","spalling_dark":"#D97A34","exposed_rebar":"#5C6066","corrosion_rust":"#8B4A2B","efflorescence_white":"#3F7CAD"}
    rows = ""
    bars = ""
    for fr in fam_rows:
        if not isinstance(fr, dict) or int(fr.get('n', 0) or 0) <= 0:
            continue
        cls = str(fr.get('class',''))
        smax = float(fr.get('s_max', 0.0) or 0.0)
        width = max(1.0, min(100.0, 100.0*smax))
        rows += ("<tr>" +
            f"<td>{esc(fr.get('class_label') or labels.get(cls, cls))}</td>" +
            f"<td>{fr.get('n','')}</td><td>{smax:.2f}</td>" +
            f"<td>EC{fr.get('EC_DNIT_family_img','')}</td>" +
            f"<td>{esc(fr.get('governing_record_id',''))}</td>" +
            f"<td>{'sim' if fr.get('included_in_rating', True) else 'não'}</td></tr>")
        bars += f"<div class='bar'><span>{esc(fr.get('class_label') or labels.get(cls, cls))}</span><b><i style='width:{width:.1f}%;background:{colors.get(cls,'#666')}'></i></b><em>{smax:.2f}</em></div>"
    if not rows:
        rows = "<tr><td colspan='6'>Sem famílias classificadas.</td></tr>"
        bars = "<p class='muted'>Sem dados para gráfico.</p>"
    dmg_rows = ""
    for dr in damage_rows[:150]:
        if not isinstance(dr, dict):
            continue
        dmg_rows += ("<tr>" +
            f"<td><code>{esc(dr.get('record_id'))}</code></td>" +
            f"<td>{esc(dr.get('class_label'))}</td>" +
            f"<td>{float(dr.get('s_img',0) or 0):.2f}</td>" +
            f"<td>EC{dr.get('EC_DNIT_damage_img','')}</td>" +
            f"<td>{float(dr.get('D',0) or 0):.2f}</td></tr>")
    if not dmg_rows:
        dmg_rows = "<tr><td colspan='5'>Sem detecções individuais classificadas.</td></tr>"
    eq_html = "".join(f"<li><span class='math'>{esc(eq)}</span></li>" for eq in CLASSIFICATION_EQUATIONS_UNICODE)
    html_doc = f"""<!doctype html><html lang='pt-BR'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>
<title>Relatório CDM v2.8.5</title><style>
body{{font-family:Arial,Helvetica,sans-serif;margin:0;background:#f7f5ef;color:#15181c;line-height:1.55}}.wrap{{max-width:1100px;margin:auto;padding:32px}}h1{{font-size:32px;margin:0 0 8px}}.card{{background:white;border:1px solid #ded9cd;border-radius:14px;padding:20px;margin:18px 0}}.badge{{border-left:8px solid {nt_color}}}.nt{{font-size:64px;font-weight:800;color:{nt_color};line-height:1}}table{{border-collapse:collapse;width:100%}}th,td{{border-bottom:1px solid #eee;padding:8px;text-align:left}}th{{font-size:12px;text-transform:uppercase;color:#656b73}}code{{font-family:Consolas,monospace}}.bar{{display:grid;grid-template-columns:160px 1fr 60px;gap:10px;align-items:center;margin:9px 0}}.bar b{{height:14px;background:#eee;border-radius:99px;overflow:hidden}}.bar i{{display:block;height:100%;border-radius:99px}}.bar em{{font-family:Consolas,monospace;font-style:normal;text-align:right}}.math{{font-family:Georgia,'Times New Roman',serif;font-size:20px}}.muted{{color:#656b73}}
</style></head><body><div class='wrap'>
<h1>Relatório de Inspeção — Concrete Damage Morphology v2.8.5</h1><p class='muted'>Imagem: <b>{esc(image_name)}</b> · relatório local de fallback completo.</p>
<div class='card badge'><div class='nt'>NT{nt}</div><h2>EC{ec} · GDE_img {gde:.1f}</h2><p>Resultado preliminar assistido por imagem. Validar com engenheiro/inspetor.</p></div>
<div class='card'><h2>Gráfico local — severidade por família</h2>{bars}</div>
<div class='card'><h2>Classificação por família</h2><table><thead><tr><th>Família</th><th>n</th><th>s_max</th><th>EC</th><th>Governante</th><th>Incluída</th></tr></thead><tbody>{rows}</tbody></table></div>
<div class='card'><h2>Detecções individuais</h2><table><thead><tr><th>ID</th><th>Família</th><th>s_img</th><th>EC</th><th>D</th></tr></thead><tbody>{dmg_rows}</tbody></table></div>
<div class='card'><h2>Equações</h2><ol>{eq_html}</ol></div>
<div class='card'><h2>Documentação determinística</h2><p><b>Fissuras:</b> RGB→cinza, black-hat, limiar, morfologia e filtro alongado; largura estimada w≈A/L.</p><p><b>Desplacamento:</b> regiões escuras/texturizadas; severidade por área relativa A/Aref.</p><p><b>Armadura exposta:</b> componente alongado e escuro dentro do desplacamento.</p><p><b>Corrosão:</b> assinatura RGB/HSV vermelho-marrom.</p><p><b>Eflorescência:</b> alto brilho e baixa saturação.</p></div>
</div></body></html>"""
    p = Path(html_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(html_doc, encoding="utf-8")
    return str(p)

def default_csv_path(image_path: str) -> str:
    p = Path(image_path)
    return str(p.with_name(p.stem + "_damage_morphology_v285.csv"))


def default_dxf_path(image_path: str) -> str:
    p = Path(image_path)
    return str(p.with_name(p.stem + "_damage_morphology_v285.dxf"))


def default_bim_json_path(image_path: str) -> str:
    p = Path(image_path)
    return str(p.with_name(p.stem + "_damage_bim_metadata_v285.json"))


def default_coco_path(image_path: str) -> str:
    p = Path(image_path)
    return str(p.with_name(p.stem + "_damage_annotations_coco_v285.json"))


def default_ifc_path(image_path: str) -> str:
    p = Path(image_path)
    return str(p.with_name(p.stem + "_damage_annotations_v285.ifc"))


def dxf_layer_name(damage_class: str) -> str:
    return {
        "cracks": "SHM_CRACKS",
        "spalling_dark": "SHM_SPALLING",
        "exposed_rebar": "SHM_EXPOSED_REBAR",
        "corrosion_rust": "SHM_CORROSION",
        "efflorescence_white": "SHM_EFFLORESCENCE",
        "growth": "SHM_TEMPORAL_GROWTH",
        "reduction": "SHM_TEMPORAL_REDUCTION",
    }.get(damage_class, "SHM_DAMAGE")


def record_points_for_export(rec: DamageRecord, scale: ScaleInfo) -> List[Tuple[float, float]]:
    factor = scale.mm_per_px if scale.mm_per_px is not None else 1.0
    # CAD/BIM convention: invert Y so exported geometry is not upside down.
    return [(float(x) * factor, -float(y) * factor) for x, y in rec.points]


def write_dxf(records: List[DamageRecord], dxf_path: str, scale: ScaleInfo) -> None:
    """Write a lightweight ASCII DXF with one LWPOLYLINE per detected object."""
    path = Path(dxf_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    unit_code = 4 if scale.mm_per_px is not None else 0  # 4 = millimeters; 0 = unitless
    layers = sorted({dxf_layer_name(rec.damage_class) for rec in records})
    lines: List[str] = []
    def add(*items):
        lines.extend(str(i) for i in items)
    add(0, "SECTION", 2, "HEADER", 9, "$INSUNITS", 70, unit_code, 0, "ENDSEC")
    add(0, "SECTION", 2, "TABLES", 0, "TABLE", 2, "LAYER", 70, len(layers))
    for layer in layers:
        add(0, "LAYER", 2, layer, 70, 0, 62, 7, 6, "CONTINUOUS")
    add(0, "ENDTAB", 0, "ENDSEC")
    add(0, "SECTION", 2, "ENTITIES")
    for rec in records:
        pts = record_points_for_export(rec, scale)
        if len(pts) < 2:
            continue
        flags = 1 if rec.is_closed else 0
        add(0, "LWPOLYLINE", 8, dxf_layer_name(rec.damage_class), 90, len(pts), 70, flags)
        for x, y in pts:
            add(10, f"{x:.4f}", 20, f"{y:.4f}")
    add(0, "ENDSEC", 0, "EOF")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def record_to_bim_feature(rec: DamageRecord, scale: ScaleInfo, cfg: DetectorConfig) -> Dict[str, object]:
    area_mm2 = scale.px2_to_mm2(rec.area_px2)
    return {
        "id": rec.record_id,
        "time_label": rec.time_label,
        "damage_class": rec.damage_class,
        "class_label": CLASS_LABELS.get(rec.damage_class, rec.damage_class),
        "target_ifc_element_guid": cfg.bim_element_guid,
        "surface_id": cfg.bim_surface_id,
        "geometry_type": "polygon" if rec.is_closed else "polyline",
        "coordinate_system": cfg.bim_coordinate_system,
        "coordinates": record_points_for_export(rec, scale),
        "units": "mm" if scale.mm_per_px is not None else "px",
        "metrics": {
            "area_px2": rec.area_px2,
            "area_mm2": area_mm2,
            "area_cm2": None if area_mm2 is None else area_mm2 / 100.0,
            "perimeter_px": rec.perimeter_px,
            "perimeter_mm": scale.px_to_mm(rec.perimeter_px),
            "length_px": rec.length_px,
            "length_mm": scale.px_to_mm(rec.length_px),
            "width_px": rec.width_px,
            "width_mm": scale.px_to_mm(rec.width_px),
            "aspect_ratio": rec.aspect_ratio,
            "bbox_px": rec.bbox,
        },
        "ifc_mapping_recommendation": {
            "ifc_entity": "IfcAnnotation or IfcBuildingElementProxy",
            "property_set": "Pset_ConcreteDamageAssessment",
            "relationship": "RelAssignsToProduct / external reference to inspected IFC element",
        },
        "note": rec.confidence_note,
    }


def write_bim_json(records: List[DamageRecord], json_path: str, scale: ScaleInfo, cfg: DetectorConfig, temporal_stats: Dict[str, Dict[str, float]], temporal_quality: Optional[Dict[str, object]] = None, alignment_info: Optional[Dict[str, object]] = None) -> None:
    path = Path(json_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "schema": "ConcreteDamageMorphology-BIM-Metadata",
        "version": "1.7.0",
        "project_id": cfg.bim_project_id,
        "target_ifc_element_guid": cfg.bim_element_guid,
        "surface_id": cfg.bim_surface_id,
        "coordinate_system": cfg.bim_coordinate_system,
        "units": "mm" if scale.mm_per_px is not None else "px",
        "mm_per_px": scale.mm_per_px,
        "temporal_stats": temporal_stats,
        "temporal_alignment": alignment_info or {},
        "temporal_quality": temporal_quality or {},
        "features": [record_to_bim_feature(rec, scale, cfg) for rec in records],
        "integration_notes": [
            "This JSON is an IFC-overlay metadata file; it does not modify the IFC model directly.",
            "For direct IFC writing, map each feature to IfcAnnotation or IfcBuildingElementProxy using IfcOpenShell.",
            "Use target_ifc_element_guid to bind the pathology to the inspected BIM element.",
        ],
    }
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")



COCO_CATEGORIES = [
    {"id": 1, "name": "crack", "supercategory": "concrete_damage"},
    {"id": 2, "name": "spalling", "supercategory": "concrete_damage"},
    {"id": 3, "name": "exposed_rebar", "supercategory": "concrete_damage"},
    {"id": 4, "name": "corrosion", "supercategory": "concrete_damage"},
    {"id": 5, "name": "efflorescence", "supercategory": "concrete_damage"},
    {"id": 6, "name": "temporal_growth", "supercategory": "concrete_damage"},
    {"id": 7, "name": "temporal_reduction", "supercategory": "concrete_damage"},
]
COCO_CATEGORY_ID = {
    "cracks": 1,
    "spalling_dark": 2,
    "exposed_rebar": 3,
    "corrosion_rust": 4,
    "efflorescence_white": 5,
    "growth": 6,
    "reduction": 7,
}


def polygon_area(points: List[Tuple[float, float]]) -> float:
    if len(points) < 3:
        return 0.0
    area = 0.0
    for i, (x1, y1) in enumerate(points):
        x2, y2 = points[(i + 1) % len(points)]
        area += x1 * y2 - x2 * y1
    return abs(area) / 2.0


def line_to_thin_polygon(points: List[Tuple[float, float]], width: float) -> List[Tuple[float, float]]:
    if len(points) < 2:
        return points
    (x1, y1), (x2, y2) = points[0], points[-1]
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy)
    if length <= 1e-6:
        half = max(1.0, width / 2.0)
        return [(x1-half, y1-half), (x1+half, y1-half), (x1+half, y1+half), (x1-half, y1+half)]
    nx, ny = -dy / length, dx / length
    half = max(1.0, width / 2.0)
    return [(x1 + nx*half, y1 + ny*half), (x2 + nx*half, y2 + ny*half), (x2 - nx*half, y2 - ny*half), (x1 - nx*half, y1 - ny*half)]


def record_to_coco_annotation(rec: DamageRecord, ann_id: int, image_id: int) -> Dict[str, object]:
    pts = rec.points if rec.is_closed else line_to_thin_polygon(rec.points, max(rec.width_px, 2.0))
    flat = [float(v) for xy in pts for v in xy]
    x, y, w, h = rec.bbox
    area = rec.area_px2 if rec.area_px2 > 0 else polygon_area(pts)
    return {
        "id": ann_id,
        "image_id": image_id,
        "category_id": COCO_CATEGORY_ID.get(rec.damage_class, 1),
        "segmentation": [flat],
        "area": float(area),
        "bbox": [float(x), float(y), float(w), float(h)],
        "iscrowd": 0,
        "attributes": {
            "record_id": rec.record_id,
            "damage_class": rec.damage_class,
            "time_label": rec.time_label,
            "perimeter_px": rec.perimeter_px,
            "length_px": rec.length_px,
            "width_px": rec.width_px,
            "aspect_ratio": rec.aspect_ratio,
            "note": rec.confidence_note,
        },
    }


def write_coco_json(records: List[DamageRecord], coco_path: str, image_path: str, image_width: int, image_height: int, cfg: DetectorConfig) -> None:
    path = Path(coco_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    image_id = 1
    data = {
        "info": {
            "description": "Concrete damage annotations generated by Concrete Damage Morphology",
            "version": "2.3.0-native",
            "software": "Inkscape SHM Concrete Damage Morphology",
        },
        "licenses": [],
        "images": [{
            "id": image_id,
            "file_name": Path(image_path).name,
            "path": str(Path(image_path).resolve()),
            "width": int(image_width),
            "height": int(image_height),
        }],
        "categories": COCO_CATEGORIES,
        "annotations": [record_to_coco_annotation(rec, idx, image_id) for idx, rec in enumerate(records, start=1)],
    }
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


_IFC_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$"

def ifc_guid() -> str:
    import uuid
    n = uuid.uuid4().int
    chars = []
    for _ in range(22):
        chars.append(_IFC_CHARS[n & 0x3F])
        n >>= 6
    return "".join(reversed(chars))


def ifc_text(value: object) -> str:
    s = "" if value is None else str(value)
    return "'" + s.replace("'", "''") + "'"


def write_ifc_annotations(records: List[DamageRecord], ifc_path: str, scale: ScaleInfo, cfg: DetectorConfig) -> None:
    """Write a compact IFC4 file containing each pathology as IfcAnnotation.
    The geometry is stored as IfcPolyline/IfcGeometricCurveSet, with a custom
    Pset_ConcreteDamageAssessment for each annotation.
    """
    path = Path(ifc_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    lines: List[str] = []
    eid = 1
    def new_id():
        nonlocal eid
        v = eid
        eid += 1
        return v
    def add(ent: str) -> int:
        i = new_id()
        lines.append(f"#{i}={ent};")
        return i

    owner = add("IFCPERSON($,$,'ConcreteDamageMorphology',$,$,$,$,$)")
    org = add("IFCORGANIZATION($,'SHM Concrete',$,$,$)")
    pao = add(f"IFCPERSONANDORGANIZATION(#{owner},#{org},$)")
    app_org = add("IFCORGANIZATION($,'OpenAI/ChatGPT generated plugin',$,$,$)")
    app = add(f"IFCAPPLICATION(#{app_org},'2.1.1','Concrete Damage Morphology','CDM')")
    hist = add(f"IFCOWNERHISTORY(#{pao},#{app},$,.ADDED.,$,$,$,0)")
    unit = add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)")
    units = add(f"IFCUNITASSIGNMENT((#{unit}))")
    ctx = add("IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#9999,$)")
    axis = add("IFCAXIS2PLACEMENT3D(#10000,$,$)")
    # referenced by context/object placement; put points after is acceptable in STEP references.
    project = add(f"IFCPROJECT({ifc_text(ifc_guid())},#{hist},{ifc_text(cfg.bim_project_id or 'Concrete damage annotation project')},$,$,$,$,(#{ctx}),#{units})")
    origin = 10000
    lines.append(f"#9999=IFCAXIS2PLACEMENT3D(#{origin},$,$);")
    lines.append(f"#{origin}=IFCCARTESIANPOINT((0.,0.,0.));")
    rel_objects = []
    for rec in records:
        pts = record_points_for_export(rec, scale)
        if len(pts) < 2:
            continue
        pt_ids = []
        for x, y in pts:
            pt_ids.append(add(f"IFCCARTESIANPOINT(({x:.6f},{y:.6f},0.))"))
        if rec.is_closed and pt_ids[0] != pt_ids[-1]:
            pt_ids.append(pt_ids[0])
        poly = add("IFCPOLYLINE((" + ",".join(f"#{i}" for i in pt_ids) + "))")
        gset = add(f"IFCGEOMETRICCURVESET((#{poly}))")
        shape_rep = add(f"IFCSHAPEREPRESENTATION(#{ctx},'Annotation','GeometricCurveSet',(#{gset}))")
        prod_shape = add(f"IFCPRODUCTDEFINITIONSHAPE($,$,(#{shape_rep}))")
        place = add("IFCLOCALPLACEMENT($,#9999)")
        ann = add(f"IFCANNOTATION({ifc_text(ifc_guid())},#{hist},{ifc_text(rec.record_id)},{ifc_text(label_for(rec.damage_class, cfg.language))},$,#{place},#{prod_shape},$)")
        rel_objects.append(ann)
        props = []
        for name, val in [
            ("DamageClass", rec.damage_class), ("RecordId", rec.record_id), ("AreaPx2", rec.area_px2),
            ("AreaMm2", scale.px2_to_mm2(rec.area_px2)), ("LengthPx", rec.length_px),
            ("LengthMm", scale.px_to_mm(rec.length_px)), ("WidthPx", rec.width_px),
            ("WidthMm", scale.px_to_mm(rec.width_px)), ("TargetElementGlobalId", cfg.bim_element_guid),
            ("SurfaceId", cfg.bim_surface_id), ("ValidationStatus", "Preliminary")]:
            if isinstance(val, (int, float)) and val is not None:
                nominal = f"IFCREAL({float(val):.6f})"
            else:
                nominal = f"IFCTEXT({ifc_text('' if val is None else val)})"
            props.append(add(f"IFCPROPERTYSINGLEVALUE({ifc_text(name)},$, {nominal}, $)"))
        pset = add(f"IFCPROPERTYSET({ifc_text(ifc_guid())},#{hist},'Pset_ConcreteDamageAssessment',$,(" + ",".join(f"#{i}" for i in props) + "))")
        add(f"IFCRELDEFINESBYPROPERTIES({ifc_text(ifc_guid())},#{hist},$,$,(#{ann}),#{pset})")
    if rel_objects:
        add(f"IFCRELAGGREGATES({ifc_text(ifc_guid())},#{hist},$,$,#{project},(" + ",".join(f"#{i}" for i in rel_objects) + "))")
    header = "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');\nFILE_NAME('concrete_damage_annotations.ifc','2026-06-18T00:00:00',('Concrete Damage Morphology'),('SHM Concrete'),'CDM','CDM','');\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n"
    footer = "\nENDSEC;\nEND-ISO-10303-21;\n"
    path.write_text(header + "\n".join(lines) + footer, encoding="utf-8")

def run_processing(current_path: str, cfg: DetectorConfig, existing_root=None, selected_placement: Optional[ImagePlacement] = None):
    profiler = PerformanceProfiler(cfg.profile_performance, cfg.profile_python_allocations)
    with profiler.stage("Input | image decoding"):
        img = read_image(current_path)
        original_w, original_h = img.size
        image_file_size_bytes = Path(current_path).stat().st_size if Path(current_path).exists() else None
    with profiler.stage("Input | resize + RGB array conversion"):
        arr, processed_size = image_to_array(img, cfg.max_processing_dimension)
        proc_w, proc_h = processed_size

    placement = selected_placement or ImagePlacement(0, 0, float(original_w), float(original_h), proc_w, proc_h)
    if selected_placement is not None:
        placement.width_px = proc_w
        placement.height_px = proc_h
    else:
        placement.width_svg = float(original_w)
        placement.height_svg = float(original_h)

    records, current_masks_info = detect_records(arr, cfg, "t1_current", profiler=profiler)
    current_masks = current_masks_info.get("masks", {}) if isinstance(current_masks_info, dict) else {}
    pipeline_info = current_masks_info.get("pipeline", {}) if isinstance(current_masks_info, dict) else {}
    temporal_stats: Dict[str, Dict[str, float]] = {}
    alignment_info: Dict[str, object] = {
        "method_requested": cfg.alignment_method,
        "method_applied": "not_run",
        "accepted": False,
        "dx_px": 0,
        "dy_px": 0,
    }
    temporal_quality: Dict[str, object] = {
        "schema": "cdm_temporal_quality_v1",
        "status": "not_run",
        "validated_for_change_quantification": False,
        "issues": [],
        "warnings": [],
        "metrics": {},
        "thresholds": {},
    }

    if cfg.compare_previous and cfg.previous_image_path and Path(cfg.previous_image_path).exists():
        with profiler.stage("t0 | image decoding + resize"):
            prev_img = read_image(cfg.previous_image_path).resize((proc_w, proc_h), Image.Resampling.BILINEAR)
            prev_arr = np.asarray(prev_img, dtype=np.uint8)
        with profiler.stage("Temporal | t0→t1 registration"):
            prev_arr, alignment_info = align_previous_rgb(arr, prev_arr, cfg.alignment_method)
            temporal_quality = temporal_quality_assessment(arr, prev_arr, alignment_info)
        prev_records, prev_masks_info = detect_records(prev_arr, cfg, "t0_previous", profiler=profiler)
        prev_masks = prev_masks_info.get("masks", {}) if isinstance(prev_masks_info, dict) else {}
        records = prev_records + records
        with profiler.stage("Temporal | mask comparison + change records"):
            temp_records, temporal_stats = temporal_records(current_masks, prev_masks, cfg)
            records.extend(temp_records)
    elif cfg.compare_previous:
        log_error("Aviso: comparação temporal ativada, mas a imagem anterior não foi encontrada. O plugin processou somente a imagem atual.")

    with profiler.stage("SVG | root preparation + old layer cleanup"):
        root = existing_root if existing_root is not None else create_svg_root(max(placement.width_svg, original_w), max(placement.height_svg, original_h))
        if existing_root is not None and cfg.clean_previous_outputs:
            cleanup_existing_output_layers(root)
    if cfg.include_original_image:
        with profiler.stage("SVG | original image layer"):
            add_image_layer(root, current_path, placement, "Original image - current")
    with profiler.stage("SVG | vector layers from damage records"):
        add_records_layers(root, records, placement, cfg)
    image_area_px2 = float(proc_w * proc_h)
    with profiler.stage("Classification | EC/NT/GDE summary layer"):
        add_summary_layer(root, records, temporal_stats, cfg.scale_info(), cfg.language, cfg, image_area_px2)

    exported_paths: Dict[str, str] = {}
    condition_rating = summarize_records(records, cfg.scale_info(), cfg, image_area_px2).get("condition_rating", {})

    if cfg.export_csv:
        with profiler.stage("Export | technical CSV"):
            csv_path = resolve_output_path(current_path, cfg, cfg.csv_output_path, "_damage_morphology_v285.csv")
            write_csv(records, csv_path, cfg.scale_info(), temporal_stats, condition_rating if isinstance(condition_rating, dict) else None, temporal_quality)
            exported_paths["csv"] = csv_path
            log_error(f"CSV técnico gerado em: {csv_path}")

    if cfg.export_dxf:
        with profiler.stage("Export | DXF"):
            dxf_path = resolve_output_path(current_path, cfg, cfg.dxf_output_path, "_damage_morphology_v285.dxf")
            write_dxf(records, dxf_path, cfg.scale_info())
            exported_paths["dxf"] = dxf_path
            log_error(f"DXF técnico gerado em: {dxf_path}")

    if cfg.export_bim_json:
        with profiler.stage("Export | BIM/IFC-overlay JSON"):
            bim_path = resolve_output_path(current_path, cfg, cfg.bim_json_output_path, "_damage_bim_metadata_v285.json")
            write_bim_json(records, bim_path, cfg.scale_info(), cfg, temporal_stats, temporal_quality, alignment_info)
            exported_paths["bim_json"] = bim_path
            log_error(f"Metadata BIM/IFC-overlay gerado em: {bim_path}")

    if cfg.export_coco:
        with profiler.stage("Export | COCO JSON"):
            coco_path = resolve_output_path(current_path, cfg, cfg.coco_output_path, "_damage_annotations_coco_v285.json")
            write_coco_json(records, coco_path, current_path, proc_w, proc_h, cfg)
            exported_paths["coco"] = coco_path
            log_error(f"Anotações COCO geradas em: {coco_path}")

    if cfg.export_ifc:
        with profiler.stage("Export | IFC IfcAnnotation"):
            ifc_path = resolve_output_path(current_path, cfg, cfg.ifc_output_path, "_damage_annotations_v285.ifc")
            write_ifc_annotations(records, ifc_path, cfg.scale_info(), cfg)
            exported_paths["ifc"] = ifc_path
            log_error(f"IFC com IfcAnnotation gerado em: {ifc_path}")

    if cfg.export_pipeline_figures:
        try:
            with profiler.stage("Export | scientific pipeline figures"):
                pipeline_paths = export_segmentation_pipeline_figures(current_path, arr, pipeline_info, cfg)
            for k, v in pipeline_paths.items():
                exported_paths[f"pipeline_{k}"] = v
            log_error(f"Figuras do pipeline científico geradas em: {pipeline_paths.get('pipeline_dir', '')}")
        except Exception as exc:
            log_error(f"Aviso: falha ao exportar figuras do pipeline científico: {exc}")

    mask_stats: Dict[str, Dict[str, object]] = {}
    for cls, mask in current_masks.items() if isinstance(current_masks, dict) else []:
        if isinstance(mask, np.ndarray):
            pixels = int(mask.sum())
            mask_stats[cls] = {
                "mask_pixels": pixels,
                "mask_coverage_pct": 100.0 * pixels / max(1.0, image_area_px2),
                "records": sum(1 for rec in records if rec.damage_class == cls and rec.time_label == "t1_current"),
            }
    records_by_class = {cls: sum(1 for rec in records if rec.damage_class == cls) for cls in CLASS_LABELS}
    vector_vertices = int(sum(len(rec.points) for rec in records))
    performance_metadata = {
        "input": {
            "file_name": Path(current_path).name,
            "file_size_bytes": image_file_size_bytes,
            "original_width_px": original_w,
            "original_height_px": original_h,
            "original_pixels": int(original_w * original_h),
            "processed_width_px": proc_w,
            "processed_height_px": proc_h,
            "processed_pixels": int(proc_w * proc_h),
            "linear_downscale_ratio": float(proc_w / max(1, original_w)),
            "array_rgb_bytes": int(proc_w * proc_h * 3),
        },
        "model": {
            "threshold_T": cfg.threshold,
            "kernel_B": cfg.normalized_kernel_size,
            "min_area_px2": cfg.min_area,
            "min_aspect_ratio": cfg.min_aspect_ratio,
            "max_processing_dimension": cfg.max_processing_dimension,
            "detection_scope": cfg.detection_scope,
            "temporal_comparison": cfg.compare_previous,
            "temporal_alignment": alignment_info,
            "temporal_quality": temporal_quality,
            "pipeline_protocol": "unified_five_stage_v285",
        },
        "detection": {
            "records_total": len(records),
            "records_by_class": records_by_class,
            "mask_stats": mask_stats,
            "vector_vertices_total": vector_vertices,
            "svg_elements_total": int(sum(1 for _ in root.iter())),
            "active_rating_families": [cls for cls in PATHOLOGY_FAMILY_ORDER if family_included_in_rating(cls, cfg)],
        },
    }
    performance_data = profiler.finish(performance_metadata)

    if cfg.export_performance_json:
        perf_json_path = resolve_output_path(current_path, cfg, "", "_computational_performance_v285.json")
        write_performance_json(performance_data, perf_json_path)
        exported_paths["performance_json"] = perf_json_path
        log_error(f"Perfil computacional JSON gerado em: {perf_json_path}")
    if cfg.export_performance_csv:
        perf_csv_path = resolve_output_path(current_path, cfg, "", "_computational_performance_v285.csv")
        write_performance_csv(performance_data, perf_csv_path)
        exported_paths["performance_csv"] = perf_csv_path
        log_error(f"Perfil computacional CSV gerado em: {perf_csv_path}")

    html_summary = summarize_records(records, cfg.scale_info(), cfg, image_area_px2)
    html_summary["computational_performance"] = performance_data
    if cfg.export_html:
        html_path = resolve_output_path(current_path, cfg, cfg.html_output_path, "_relatorio_v285.html")
        try:
            module_path = Path(__file__).resolve().with_name("cdm_html_report.py")
            if not module_path.exists():
                raise FileNotFoundError(f"Módulo HTML não encontrado: {module_path}")
            spec = importlib.util.spec_from_file_location("cdm_html_report", str(module_path))
            if spec is None or spec.loader is None:
                raise ImportError(f"Não foi possível carregar o módulo HTML: {module_path}")
            html_module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(html_module)
            write_html_report = html_module.write_html_report
            write_html_report(html_summary, html_path, cfg.scale_info(), cfg, temporal_stats=temporal_stats, image_name=Path(current_path).name, performance_data=performance_data)
            exported_paths["html"] = html_path
            log_error(f"Relatório HTML interativo gerado em: {html_path}")
        except Exception as exc:
            try:
                write_basic_html_report(html_summary, html_path, cfg.scale_info(), cfg, temporal_stats, Path(current_path).name, performance_data=performance_data)
                exported_paths["html"] = html_path
                log_error("Relatório HTML básico gerado na pasta configurada: " + f"{html_path}. O relatório interativo falhou. Detalhe: {exc}")
            except Exception as exc2:
                log_error("Aviso: não foi possível gerar nem o HTML interativo nem o HTML básico. " + f"Caminho tentado: {html_path}. Detalhe principal: {exc}. Detalhe fallback: {exc2}")

    report = build_result_text(html_summary, cfg.scale_info(), temporal_stats, cfg.language, temporal_quality)
    if cfg.profile_performance:
        report += f"\n\nPerfil computacional: {float(performance_data.get('wall_total_s', 0.0)):.3f} s | backend: {performance_data.get('environment', {}).get('morphology_backend', 'n/a') if isinstance(performance_data.get('environment'), dict) else 'n/a'}"
    if exported_paths:
        first_dir = str(Path(next(iter(exported_paths.values()))).parent)
        write_export_manifest(exported_paths, first_dir, report)
        report += "\n\nArquivos exportados:\n" + "\n".join(f"- {k}: {v}" for k, v in exported_paths.items())
    else:
        report += "\n\nNenhum arquivo externo foi exportado. Marque pelo menos uma saída: HTML, CSV, DXF, COCO, JSON BIM, IFC ou perfil computacional."
    if cfg.save_state_after_run:
        save_plugin_state(cfg, current_path, report)
    if cfg.show_results_popup:
        show_result_popup(report)
    return root, records, temporal_stats

def resolve_href_to_path(href: str) -> str:
    if href.startswith("file://"):
        parsed = urlparse(href)
        path = unquote(parsed.path)
        if os.name == "nt" and path.startswith("/") and len(path) > 2 and path[2] == ":":
            path = path[1:]
        return path
    return unquote(href)


def selected_image_info(svg, selected) -> Tuple[Optional[str], Optional[ImagePlacement]]:
    for elem in selected.values():
        path, placement = image_element_info(elem)
        if path and placement:
            return path, placement
    return None, None


if inkex is not None:
    class ConcreteDamageMorphologyNoOpenCV(inkex.EffectExtension):  # type: ignore
        def add_arguments(self, pars):
            pars.add_argument("--interface_tabs", type=str, default="tab_detection")
            pars.add_argument("--language", type=str, default="pt")
            pars.add_argument("--enable_condition_rating", type=inkex.Boolean, default=True)
            pars.add_argument("--element_family", type=str, default="lajes_vigas_secundarias_apoios")
            pars.add_argument("--structural_relevance_fr", type=float, default=4.0)
            pars.add_argument("--reference_area_mode", type=str, default="image_area")
            pars.add_argument("--reference_area_px2", type=float, default=0.0)
            pars.add_argument("--environmental_aggressiveness", type=str, default="moderate")
            pars.add_argument("--allow_auto_emergency_nt0", type=inkex.Boolean, default=False)
            pars.add_argument("--use_ordinal_normative_method", type=inkex.Boolean, default=True)
            pars.add_argument("--ordinal_tau1", type=float, default=0.25)
            pars.add_argument("--ordinal_tau2", type=float, default=0.50)
            pars.add_argument("--ordinal_tau3", type=float, default=0.75)
            pars.add_argument("--recurrence_threshold", type=int, default=5)
            pars.add_argument("--extension_threshold", type=float, default=0.015)
            pars.add_argument("--critical_weight_threshold", type=float, default=4.0)
            pars.add_argument("--include_cracks_in_rating", type=inkex.Boolean, default=True)
            pars.add_argument("--include_spalling_in_rating", type=inkex.Boolean, default=True)
            pars.add_argument("--include_rebar_in_rating", type=inkex.Boolean, default=True)
            pars.add_argument("--include_corrosion_in_rating", type=inkex.Boolean, default=True)
            pars.add_argument("--include_efflorescence_in_rating", type=inkex.Boolean, default=True)
            pars.add_argument("--source_mode", type=str, default="selected_or_external")
            pars.add_argument("--image_path", type=str, default="")
            pars.add_argument("--previous_image_path", type=str, default="")
            pars.add_argument("--detection_scope", type=str, default="all")
            pars.add_argument("--threshold", type=int, default=35)
            pars.add_argument("--kernel_size", type=int, default=15)
            pars.add_argument("--min_area", type=float, default=30.0)
            pars.add_argument("--min_aspect_ratio", type=float, default=2.0)
            pars.add_argument("--approx_epsilon", type=float, default=1.5)
            pars.add_argument("--stroke_width", type=float, default=1.0)
            pars.add_argument("--include_original_image", type=inkex.Boolean, default=True)
            pars.add_argument("--show_debug_masks", type=inkex.Boolean, default=False)
            pars.add_argument("--export_csv", type=inkex.Boolean, default=False)
            pars.add_argument("--csv_output_path", type=str, default="")
            pars.add_argument("--export_dxf", type=inkex.Boolean, default=False)
            pars.add_argument("--dxf_output_path", type=str, default="")
            pars.add_argument("--export_bim_json", type=inkex.Boolean, default=False)
            pars.add_argument("--bim_json_output_path", type=str, default="")
            pars.add_argument("--export_coco", type=inkex.Boolean, default=False)
            pars.add_argument("--coco_output_path", type=str, default="")
            pars.add_argument("--export_ifc", type=inkex.Boolean, default=False)
            pars.add_argument("--ifc_output_path", type=str, default="")
            pars.add_argument("--export_html", type=inkex.Boolean, default=False)
            pars.add_argument("--html_output_path", type=str, default="")
            pars.add_argument("--export_pipeline_figures", type=inkex.Boolean, default=False)
            pars.add_argument("--pipeline_output_dir", type=str, default="")
            pars.add_argument("--profile_performance", type=inkex.Boolean, default=True)
            pars.add_argument("--profile_python_allocations", type=inkex.Boolean, default=False)
            pars.add_argument("--export_performance_json", type=inkex.Boolean, default=False)
            pars.add_argument("--export_performance_csv", type=inkex.Boolean, default=False)
            pars.add_argument("--output_dir", type=str, default="")
            pars.add_argument("--output_mode", type=str, default="image_folder")
            pars.add_argument("--save_state_after_run", type=inkex.Boolean, default=True)
            pars.add_argument("--use_saved_state_for_empty_fields", type=inkex.Boolean, default=True)
            pars.add_argument("--bim_project_id", type=str, default="")
            pars.add_argument("--bim_element_guid", type=str, default="")
            pars.add_argument("--bim_surface_id", type=str, default="")
            pars.add_argument("--bim_coordinate_system", type=str, default="image_local")
            pars.add_argument("--calibration_mode", type=str, default="px_only")
            pars.add_argument("--mm_per_px", type=float, default=0.0)
            pars.add_argument("--reference_length_px", type=float, default=0.0)
            pars.add_argument("--reference_length_mm", type=float, default=0.0)
            pars.add_argument("--compare_previous", type=inkex.Boolean, default=False)
            pars.add_argument("--alignment_method", type=str, default="translation_auto")
            pars.add_argument("--max_processing_dimension", type=int, default=1600)
            pars.add_argument("--show_results_popup", type=inkex.Boolean, default=True)
            pars.add_argument("--clean_previous_outputs", type=inkex.Boolean, default=True)

        def effect(self):
            cfg = DetectorConfig(
                source_mode=self.options.source_mode,
                image_path=(self.options.image_path or "").strip().strip('"'),
                previous_image_path=(self.options.previous_image_path or "").strip().strip('"'),
                detection_scope=self.options.detection_scope,
                threshold=self.options.threshold,
                kernel_size=self.options.kernel_size,
                min_area=self.options.min_area,
                min_aspect_ratio=self.options.min_aspect_ratio,
                approx_epsilon=self.options.approx_epsilon,
                stroke_width=self.options.stroke_width,
                include_original_image=bool(self.options.include_original_image),
                show_debug_masks=bool(self.options.show_debug_masks),
                export_csv=bool(self.options.export_csv),
                csv_output_path=(self.options.csv_output_path or "").strip().strip('"'),
                export_dxf=bool(self.options.export_dxf),
                dxf_output_path=(self.options.dxf_output_path or "").strip().strip('"'),
                export_bim_json=bool(self.options.export_bim_json),
                bim_json_output_path=(self.options.bim_json_output_path or "").strip().strip('"'),
                export_coco=bool(self.options.export_coco),
                coco_output_path=(self.options.coco_output_path or "").strip().strip('"'),
                export_ifc=bool(self.options.export_ifc),
                ifc_output_path=(self.options.ifc_output_path or "").strip().strip('"'),
                export_html=bool(self.options.export_html),
                html_output_path=(self.options.html_output_path or "").strip().strip('"'),
                export_pipeline_figures=bool(self.options.export_pipeline_figures),
                pipeline_output_dir=(self.options.pipeline_output_dir or "").strip().strip('"'),
                profile_performance=bool(self.options.profile_performance),
                profile_python_allocations=bool(self.options.profile_python_allocations),
                export_performance_json=bool(self.options.export_performance_json),
                export_performance_csv=bool(self.options.export_performance_csv),
                output_dir=(self.options.output_dir or "").strip().strip('"'),
                output_mode=(self.options.output_mode or "image_folder").strip(),
                save_state_after_run=bool(self.options.save_state_after_run),
                use_saved_state_for_empty_fields=bool(self.options.use_saved_state_for_empty_fields),
                bim_project_id=(self.options.bim_project_id or "").strip(),
                bim_element_guid=(self.options.bim_element_guid or "").strip(),
                bim_surface_id=(self.options.bim_surface_id or "").strip(),
                bim_coordinate_system=(self.options.bim_coordinate_system or "image_local").strip(),
                calibration_mode=self.options.calibration_mode,
                mm_per_px=self.options.mm_per_px,
                reference_length_px=self.options.reference_length_px,
                reference_length_mm=self.options.reference_length_mm,
                compare_previous=bool(self.options.compare_previous),
                alignment_method=self.options.alignment_method,
                max_processing_dimension=self.options.max_processing_dimension,
                show_results_popup=bool(self.options.show_results_popup),
                clean_previous_outputs=bool(self.options.clean_previous_outputs),
                language=(self.options.language or "pt").strip(),
                enable_condition_rating=bool(self.options.enable_condition_rating),
                element_family=self.options.element_family,
                structural_relevance_fr=self.options.structural_relevance_fr,
                reference_area_mode=self.options.reference_area_mode,
                reference_area_px2=self.options.reference_area_px2,
                environmental_aggressiveness=self.options.environmental_aggressiveness,
                allow_auto_emergency_nt0=bool(self.options.allow_auto_emergency_nt0),
                use_ordinal_normative_method=bool(self.options.use_ordinal_normative_method),
                ordinal_tau1=self.options.ordinal_tau1,
                ordinal_tau2=self.options.ordinal_tau2,
                ordinal_tau3=self.options.ordinal_tau3,
                recurrence_threshold=self.options.recurrence_threshold,
                extension_threshold=self.options.extension_threshold,
                critical_weight_threshold=self.options.critical_weight_threshold,
                include_cracks_in_rating=bool(self.options.include_cracks_in_rating),
                include_spalling_in_rating=bool(self.options.include_spalling_in_rating),
                include_rebar_in_rating=bool(self.options.include_rebar_in_rating),
                include_corrosion_in_rating=bool(self.options.include_corrosion_in_rating),
                include_efflorescence_in_rating=bool(self.options.include_efflorescence_in_rating),
            )
            if cfg.use_saved_state_for_empty_fields:
                cfg = apply_saved_state_to_empty_fields(cfg)
            image_path: Optional[str] = None
            placement: Optional[ImagePlacement] = None
            if cfg.source_mode in ("selected", "selected_or_external"):
                image_path, placement = selected_image_info(self.svg, self.svg.selected)
            if not image_path and cfg.source_mode in ("selected", "selected_or_external"):
                image_path, placement = document_image_info(self.document.getroot())
            if not image_path and cfg.source_mode in ("external", "selected_or_external"):
                image_path = cfg.image_path
                placement = None
            if not image_path:
                raise inkex.AbortExtension("Nenhuma imagem raster foi encontrada. Selecione a imagem, use Fonte = caminho externo, ou mantenha a imagem original no documento.")
            if not Path(image_path).exists():
                raise inkex.AbortExtension(f"Imagem não encontrada: {image_path}")
            root = self.document.getroot()
            run_processing(image_path, cfg, existing_root=root, selected_placement=placement)


def parse_cli_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Concrete Damage Morphology v2.8.5 No-OpenCV")
    p.add_argument("--cli", action="store_true", help="Executar fora do Inkscape")
    p.add_argument("--interface_tabs", default="tab_detection")
    p.add_argument("--language", default="pt")
    p.add_argument("--enable_condition_rating", action="store_true")
    p.add_argument("--element_family", default="lajes_vigas_secundarias_apoios")
    p.add_argument("--structural_relevance_fr", type=float, default=4.0)
    p.add_argument("--reference_area_mode", default="image_area")
    p.add_argument("--reference_area_px2", type=float, default=0.0)
    p.add_argument("--environmental_aggressiveness", default="moderate")
    p.add_argument("--allow_auto_emergency_nt0", action="store_true")
    p.add_argument("--use_ordinal_normative_method", action="store_true", default=True)
    p.add_argument("--ordinal_tau1", type=float, default=0.25)
    p.add_argument("--ordinal_tau2", type=float, default=0.50)
    p.add_argument("--ordinal_tau3", type=float, default=0.75)
    p.add_argument("--recurrence_threshold", type=int, default=5)
    p.add_argument("--extension_threshold", type=float, default=0.015)
    p.add_argument("--critical_weight_threshold", type=float, default=4.0)
    p.add_argument("--include_cracks_in_rating", action="store_true", default=True)
    p.add_argument("--include_spalling_in_rating", action="store_true", default=True)
    p.add_argument("--include_rebar_in_rating", action="store_true", default=True)
    p.add_argument("--include_corrosion_in_rating", action="store_true", default=True)
    p.add_argument("--include_efflorescence_in_rating", action="store_true", default=True)
    p.add_argument("--image_path", required=False, default="")
    p.add_argument("--previous_image_path", default="")
    p.add_argument("--output_svg", default="output_damage_morphology_v285.svg")
    p.add_argument("--csv_output_path", default="")
    p.add_argument("--export_dxf", action="store_true")
    p.add_argument("--dxf_output_path", default="")
    p.add_argument("--export_bim_json", action="store_true")
    p.add_argument("--bim_json_output_path", default="")
    p.add_argument("--export_coco", action="store_true")
    p.add_argument("--coco_output_path", default="")
    p.add_argument("--export_ifc", action="store_true")
    p.add_argument("--ifc_output_path", default="")
    p.add_argument("--export_html", action="store_true")
    p.add_argument("--html_output_path", default="")
    p.add_argument("--export_pipeline_figures", action="store_true")
    p.add_argument("--pipeline_output_dir", default="")
    p.add_argument("--no_profile_performance", action="store_false", dest="profile_performance", default=True)
    p.add_argument("--profile_python_allocations", action="store_true")
    p.add_argument("--export_performance_json", action="store_true")
    p.add_argument("--export_performance_csv", action="store_true")
    p.add_argument("--output_dir", default="")
    p.add_argument("--output_mode", default="image_folder")
    p.add_argument("--bim_project_id", default="")
    p.add_argument("--bim_element_guid", default="")
    p.add_argument("--bim_surface_id", default="")
    p.add_argument("--bim_coordinate_system", default="image_local")
    p.add_argument("--detection_scope", default="all")
    p.add_argument("--threshold", type=int, default=35)
    p.add_argument("--kernel_size", type=int, default=15)
    p.add_argument("--min_area", type=float, default=30.0)
    p.add_argument("--min_aspect_ratio", type=float, default=2.0)
    p.add_argument("--approx_epsilon", type=float, default=1.5)
    p.add_argument("--stroke_width", type=float, default=1.0)
    p.add_argument("--export_csv", action="store_true")
    p.add_argument("--compare_previous", action="store_true")
    p.add_argument("--alignment_method", choices=["translation_auto","resize"], default="translation_auto")
    p.add_argument("--calibration_mode", default="px_only")
    p.add_argument("--mm_per_px", type=float, default=0.0)
    p.add_argument("--reference_length_px", type=float, default=0.0)
    p.add_argument("--reference_length_mm", type=float, default=0.0)
    p.add_argument("--max_processing_dimension", type=int, default=1600)
    p.add_argument("--show_results_popup", action="store_true")
    return p.parse_args(argv)


def cli_main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_cli_args(argv)
    if not args.image_path:
        print("ERRO: informe --image_path", file=sys.stderr)
        return 2
    cfg = DetectorConfig(
        image_path=args.image_path,
        previous_image_path=args.previous_image_path,
        output_svg=args.output_svg,
        csv_output_path=args.csv_output_path,
        export_dxf=args.export_dxf,
        dxf_output_path=args.dxf_output_path,
        export_bim_json=args.export_bim_json,
        bim_json_output_path=args.bim_json_output_path,
        export_coco=args.export_coco,
        coco_output_path=args.coco_output_path,
        export_ifc=args.export_ifc,
        ifc_output_path=args.ifc_output_path,
        export_html=args.export_html,
        html_output_path=args.html_output_path,
        export_pipeline_figures=args.export_pipeline_figures,
        pipeline_output_dir=args.pipeline_output_dir,
        profile_performance=args.profile_performance,
        profile_python_allocations=args.profile_python_allocations,
        export_performance_json=args.export_performance_json,
        export_performance_csv=args.export_performance_csv,
        output_dir=args.output_dir,
        output_mode=args.output_mode,
        bim_project_id=args.bim_project_id,
        bim_element_guid=args.bim_element_guid,
        bim_surface_id=args.bim_surface_id,
        bim_coordinate_system=args.bim_coordinate_system,
        detection_scope=args.detection_scope,
        threshold=args.threshold,
        kernel_size=args.kernel_size,
        min_area=args.min_area,
        min_aspect_ratio=args.min_aspect_ratio,
        approx_epsilon=args.approx_epsilon,
        stroke_width=args.stroke_width,
        export_csv=args.export_csv,
        compare_previous=args.compare_previous,
        alignment_method=args.alignment_method,
        calibration_mode=args.calibration_mode,
        mm_per_px=args.mm_per_px,
        reference_length_px=args.reference_length_px,
        reference_length_mm=args.reference_length_mm,
        max_processing_dimension=args.max_processing_dimension,
        show_results_popup=args.show_results_popup,
        language=args.language,
        enable_condition_rating=args.enable_condition_rating,
        element_family=args.element_family,
        structural_relevance_fr=args.structural_relevance_fr,
        reference_area_mode=args.reference_area_mode,
        reference_area_px2=args.reference_area_px2,
        environmental_aggressiveness=args.environmental_aggressiveness,
        allow_auto_emergency_nt0=args.allow_auto_emergency_nt0,
        use_ordinal_normative_method=args.use_ordinal_normative_method,
        ordinal_tau1=args.ordinal_tau1,
        ordinal_tau2=args.ordinal_tau2,
        ordinal_tau3=args.ordinal_tau3,
        recurrence_threshold=args.recurrence_threshold,
        extension_threshold=args.extension_threshold,
        critical_weight_threshold=args.critical_weight_threshold,
        include_cracks_in_rating=args.include_cracks_in_rating,
        include_spalling_in_rating=args.include_spalling_in_rating,
        include_rebar_in_rating=args.include_rebar_in_rating,
        include_corrosion_in_rating=args.include_corrosion_in_rating,
        include_efflorescence_in_rating=args.include_efflorescence_in_rating,
    )
    root, _, _ = run_processing(args.image_path, cfg)
    Path(args.output_svg).parent.mkdir(parents=True, exist_ok=True)
    etree.ElementTree(root).write(args.output_svg, pretty_print=True, xml_declaration=True, encoding="UTF-8")
    print(f"SVG gerado: {args.output_svg}")
    return 0


if __name__ == "__main__":
    if "--cli" in sys.argv or inkex is None:
        raise SystemExit(cli_main())
    ConcreteDamageMorphologyNoOpenCV().run()
