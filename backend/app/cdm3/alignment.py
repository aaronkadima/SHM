"""Rigid LAS<->IFC alignment utilities for CDM-3."""
from __future__ import annotations
from dataclasses import dataclass
import numpy as np


@dataclass
class IcpResult:
    rotation: np.ndarray
    translation: np.ndarray
    rmse_history: list[float]
    iterations: int
    converged: bool
    source_frame: str = "point_cloud_world"
    target_frame: str = "ifc_model_local"

    @property
    def rmse(self) -> float | None:
        return float(self.rmse_history[-1]) if self.rmse_history else None

    @property
    def frame_compatible(self) -> bool:
        return bool(self.converged and self.rmse is not None and np.isfinite(self.rmse))

    def apply(self, points: np.ndarray) -> np.ndarray:
        return points @ self.rotation.T + self.translation

    def as_matrix4(self) -> np.ndarray:
        m = np.eye(4)
        m[:3, :3] = self.rotation
        m[:3, 3] = self.translation
        return m

    def as_dict(self) -> dict:
        return {
            "schema": "CDM3-SpatialTransform/1.0",
            "method": "rigid_icp_kabsch",
            "source_frame": self.source_frame,
            "target_frame": self.target_frame,
            "matrix4": self.as_matrix4().tolist(),
            "rmse": self.rmse,
            "rmse_history": [float(v) for v in self.rmse_history],
            "iterations": int(self.iterations),
            "converged": bool(self.converged),
            "frame_compatible": self.frame_compatible,
        }


def _kabsch(source: np.ndarray, target: np.ndarray):
    sc = source.mean(axis=0)
    tc = target.mean(axis=0)
    a = source - sc
    b = target - tc
    u, _, vt = np.linalg.svd(a.T @ b)
    d = np.sign(np.linalg.det(vt.T @ u.T))
    rotation = vt.T @ np.diag([1.0, 1.0, d]) @ u.T
    translation = tc - rotation @ sc
    return rotation, translation



def align_corresponding_points(
    source_points: np.ndarray,
    target_points: np.ndarray,
    source_frame: str = "point_cloud_world",
    target_frame: str = "ifc_model_local",
) -> IcpResult:
    source = np.asarray(source_points, dtype=float)
    target = np.asarray(target_points, dtype=float)
    if source.ndim != 2 or target.ndim != 2 or source.shape[1:] != (3,) or target.shape[1:] != (3,):
        raise ValueError("source_points and target_points must be N x 3 arrays.")
    if len(source) != len(target) or len(source) < 3:
        raise ValueError("Rigid alignment requires at least 3 paired source and target points.")
    if not np.isfinite(source).all() or not np.isfinite(target).all():
        raise ValueError("Alignment points must be finite.")
    if np.linalg.matrix_rank(source - source.mean(axis=0)) < 2:
        raise ValueError("Source control points are degenerate.")
    if np.linalg.matrix_rank(target - target.mean(axis=0)) < 2:
        raise ValueError("Target control points are degenerate.")
    rotation, translation = _kabsch(source, target)
    transformed = source @ rotation.T + translation
    rmse = float(np.sqrt(np.mean(np.sum((transformed - target) ** 2, axis=1))))
    return IcpResult(
        rotation=rotation,
        translation=translation,
        rmse_history=[rmse],
        iterations=1,
        converged=True,
        source_frame=source_frame,
        target_frame=target_frame,
    )

def icp_align(
    source_points: np.ndarray,
    target_points: np.ndarray,
    max_iterations: int = 50,
    tolerance: float = 1e-6,
    max_correspondence_distance: float | None = None,
) -> IcpResult:
    from scipy.spatial import cKDTree
    if len(source_points) < 3 or len(target_points) < 3:
        raise ValueError("ICP requires at least 3 source and target points.")
    target_tree = cKDTree(target_points)
    current = np.asarray(source_points, dtype=float).copy()
    target_points = np.asarray(target_points, dtype=float)
    rotation_total = np.eye(3)
    translation_total = np.zeros(3)
    history = []
    converged = False
    iteration = 0
    for iteration in range(1, max_iterations + 1):
        distances, indices = target_tree.query(current)
        mask = np.ones(len(current), dtype=bool)
        if max_correspondence_distance is not None:
            mask = distances <= max_correspondence_distance
        if int(mask.sum()) < 3:
            raise RuntimeError("ICP has fewer than 3 valid correspondences.")
        src = current[mask]
        dst = target_points[indices[mask]]
        r, t = _kabsch(src, dst)
        current = current @ r.T + t
        rotation_total = r @ rotation_total
        translation_total = r @ translation_total + t
        rmse = float(np.sqrt(np.mean(np.sum((src @ r.T + t - dst) ** 2, axis=1))))
        history.append(rmse)
        if len(history) > 1 and abs(history[-2] - history[-1]) < tolerance:
            converged = True
            break
    return IcpResult(rotation_total, translation_total, history, iteration, converged)
