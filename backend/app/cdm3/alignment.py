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

    def apply(self, points: np.ndarray) -> np.ndarray:
        return points @ self.rotation.T + self.translation

    def as_matrix4(self) -> np.ndarray:
        m = np.eye(4)
        m[:3, :3] = self.rotation
        m[:3, 3] = self.translation
        return m


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
