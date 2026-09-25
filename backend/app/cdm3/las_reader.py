"""CDM-3 LAS ingestion and environmental priors from ASPRS classifications."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import numpy as np

ASPRS_CLASS_NAMES = {
    0: "created_never_classified", 1: "unclassified", 2: "ground",
    3: "low_vegetation", 4: "medium_vegetation", 5: "high_vegetation",
    6: "building", 7: "low_point_noise", 9: "water", 10: "rail",
    11: "road_surface", 13: "wire_guard", 17: "bridge_deck",
}
VEGETATION_FRACTION_TAG_THRESHOLD = 0.15
WATER_FRACTION_FLAG_THRESHOLD = 0.02


@dataclass
class LasSummary:
    path: str
    point_count: int
    point_format: int
    has_crs: bool
    extent_min: tuple[float, float, float]
    extent_max: tuple[float, float, float]
    has_rgb: bool
    has_intensity_signal: bool
    classification_counts: dict[str, int]
    classification_fractions: dict[str, float]

    def as_dict(self):
        return {
            "path": self.path,
            "point_count": self.point_count,
            "point_format": self.point_format,
            "has_crs": self.has_crs,
            "extent_min": list(self.extent_min),
            "extent_max": list(self.extent_max),
            "has_rgb": self.has_rgb,
            "has_intensity_signal": self.has_intensity_signal,
            "classification_counts": self.classification_counts,
            "classification_fractions": self.classification_fractions,
        }


def load_las(path: str | Path):
    import laspy
    return laspy.read(str(path))


def classification_summary(las, path_label: str = "") -> LasSummary:
    codes, counts = np.unique(las.classification, return_counts=True)
    total = int(las.header.point_count)
    named_counts = {
        ASPRS_CLASS_NAMES.get(int(c), f"code_{int(c)}"): int(n)
        for c, n in zip(codes, counts)
    }
    named_fractions = {k: v / max(total, 1) for k, v in named_counts.items()}
    dims = set(las.point_format.dimension_names)
    try:
        has_crs = las.header.parse_crs() is not None
    except Exception:
        has_crs = False
    return LasSummary(
        path=path_label,
        point_count=total,
        point_format=las.header.point_format.id,
        has_crs=has_crs,
        extent_min=tuple(float(v) for v in las.header.mins),
        extent_max=tuple(float(v) for v in las.header.maxs),
        has_rgb={"red", "green", "blue"}.issubset(dims),
        has_intensity_signal=("intensity" in dims and bool(np.any(las.intensity))),
        classification_counts=named_counts,
        classification_fractions=named_fractions,
    )


def environment_tags_from_classification(summary: LasSummary) -> dict:
    frac = summary.classification_fractions
    tags = []
    vegetation = sum(frac.get(k, 0.0) for k in (
        "low_vegetation", "medium_vegetation", "high_vegetation"
    ))
    if vegetation >= VEGETATION_FRACTION_TAG_THRESHOLD:
        tags.append("vegetation_high" if vegetation >= 0.4 else "vegetation_low")
    water = frac.get("water", 0.0)
    if water > 0:
        tags.append("water_proximity")
    if frac.get("building", 0.0) > 0.05:
        tags.append("built_environment_nearby")
    return {
        "environment_tags": tags,
        "flood_risk_flag": water >= WATER_FRACTION_FLAG_THRESHOLD,
        "vegetation_fraction": round(vegetation, 4),
        "water_fraction": round(water, 4),
        "source": "las_classification",
    }


class PointCloudIndex:
    def __init__(self, las):
        from scipy.spatial import cKDTree
        self.xyz = np.column_stack([las.x, las.y, las.z])
        self.classification = np.asarray(las.classification)
        dims = set(las.point_format.dimension_names)
        self.rgb = (
            np.column_stack([las.red, las.green, las.blue])
            if {"red", "green", "blue"}.issubset(dims) else None
        )
        self.tree = cKDTree(self.xyz)

    def nearest(self, query_xyz):
        distance, index = self.tree.query(query_xyz, k=1)
        out = {
            "distance": float(distance),
            "point_xyz": self.xyz[index].tolist(),
            "classification": ASPRS_CLASS_NAMES.get(
                int(self.classification[index]), f"code_{int(self.classification[index])}"
            ),
        }
        if self.rgb is not None:
            out["rgb_16bit"] = self.rgb[index].tolist()
        return out
