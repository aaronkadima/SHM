"""2D image <-> 3D spatial registration utilities for CDM-3.

The registration is deliberately explicit: pathology masks are projected to the
spatial model only after a camera pose has been solved from 2D/3D
correspondences. Approximate intrinsics are allowed for preview but are marked
as non-metric so they cannot be mistaken for calibrated inspection geometry.
"""
from __future__ import annotations

from dataclasses import dataclass
import numpy as np
import cv2


@dataclass
class CameraPoseResult:
    rotation_matrix: np.ndarray
    rotation_vector: np.ndarray
    translation_vector: np.ndarray
    camera_matrix: np.ndarray
    distortion: np.ndarray
    inlier_indices: list[int]
    reprojection_rmse_px: float
    calibration_source: str
    metric_projection_valid: bool

    @property
    def camera_center_world(self) -> np.ndarray:
        return -self.rotation_matrix.T @ self.translation_vector.reshape(3)

    @property
    def projection_matrix(self) -> np.ndarray:
        extrinsic = np.column_stack([self.rotation_matrix, self.translation_vector.reshape(3, 1)])
        return self.camera_matrix @ extrinsic

    def as_dict(self):
        return {
            "rotation_matrix": self.rotation_matrix.tolist(),
            "rotation_vector": self.rotation_vector.reshape(3).tolist(),
            "translation_vector": self.translation_vector.reshape(3).tolist(),
            "camera_center_world": self.camera_center_world.reshape(3).tolist(),
            "camera_matrix": self.camera_matrix.tolist(),
            "distortion": self.distortion.reshape(-1).tolist(),
            "projection_matrix": self.projection_matrix.tolist(),
            "inlier_indices": self.inlier_indices,
            "inlier_count": len(self.inlier_indices),
            "reprojection_rmse_px": float(self.reprojection_rmse_px),
            "calibration_source": self.calibration_source,
            "metric_projection_valid": bool(self.metric_projection_valid),
        }


def _camera_matrix(image_width: int, image_height: int, intrinsics: dict | None):
    if image_width < 2 or image_height < 2:
        raise ValueError("image_width and image_height must be >= 2.")
    if intrinsics:
        fx = float(intrinsics["fx"])
        fy = float(intrinsics.get("fy", fx))
        cx = float(intrinsics.get("cx", image_width / 2.0))
        cy = float(intrinsics.get("cy", image_height / 2.0))
        if min(fx, fy) <= 0:
            raise ValueError("Camera focal lengths must be positive.")
        return (
            np.array([[fx, 0.0, cx], [0.0, fy, cy], [0.0, 0.0, 1.0]], dtype=np.float64),
            "provided_intrinsics",
            True,
        )
    # Preview-only pinhole assumption. It is useful to initialize registration
    # but must never be interpreted as a calibrated metric camera.
    focal = float(max(image_width, image_height))
    return (
        np.array(
            [[focal, 0.0, image_width / 2.0], [0.0, focal, image_height / 2.0], [0.0, 0.0, 1.0]],
            dtype=np.float64,
        ),
        "estimated_from_image_dimensions",
        False,
    )


def solve_camera_pose(
    correspondences: list[dict],
    image_width: int,
    image_height: int,
    intrinsics: dict | None = None,
    distortion: list[float] | None = None,
    reprojection_error_px: float = 4.0,
    confidence: float = 0.999,
    iterations_count: int = 300,
) -> CameraPoseResult:
    if len(correspondences) < 6:
        raise ValueError("PnP/RANSAC requires at least 6 2D-3D correspondences.")

    object_points = []
    image_points = []
    for index, row in enumerate(correspondences):
        xyz = row.get("xyz") or row.get("world")
        uv = row.get("uv") or row.get("pixel")
        if not isinstance(xyz, (list, tuple)) or len(xyz) != 3:
            raise ValueError(f"Correspondence {index} requires xyz=[X,Y,Z].")
        if not isinstance(uv, (list, tuple)) or len(uv) != 2:
            raise ValueError(f"Correspondence {index} requires uv=[u,v].")
        xyz = [float(v) for v in xyz]
        uv = [float(v) for v in uv]
        if not all(np.isfinite(xyz)) or not all(np.isfinite(uv)):
            raise ValueError(f"Correspondence {index} contains non-finite values.")
        object_points.append(xyz)
        image_points.append(uv)

    object_points = np.asarray(object_points, dtype=np.float64)
    image_points = np.asarray(image_points, dtype=np.float64)
    camera_matrix, calibration_source, metric_valid = _camera_matrix(
        int(image_width), int(image_height), intrinsics
    )
    dist = np.asarray(distortion if distortion is not None else [], dtype=np.float64).reshape(-1, 1)
    if not len(dist):
        dist = np.zeros((5, 1), dtype=np.float64)

    ok, rvec, tvec, inliers = cv2.solvePnPRansac(
        object_points,
        image_points,
        camera_matrix,
        dist,
        iterationsCount=max(20, int(iterations_count)),
        reprojectionError=max(0.25, float(reprojection_error_px)),
        confidence=min(0.999999, max(0.5, float(confidence))),
        flags=cv2.SOLVEPNP_ITERATIVE,
    )
    if not ok or rvec is None or tvec is None:
        raise RuntimeError("PnP/RANSAC could not solve a stable camera pose.")

    inlier_indices = [int(v) for v in np.asarray(inliers if inliers is not None else [], dtype=int).reshape(-1)]
    if len(inlier_indices) < 4:
        raise RuntimeError("PnP/RANSAC returned fewer than 4 inliers.")

    try:
        refine_obj = object_points[inlier_indices]
        refine_img = image_points[inlier_indices]
        rvec, tvec = cv2.solvePnPRefineLM(refine_obj, refine_img, camera_matrix, dist, rvec, tvec)
    except Exception:
        pass

    projected, _ = cv2.projectPoints(object_points[inlier_indices], rvec, tvec, camera_matrix, dist)
    residual = projected.reshape(-1, 2) - image_points[inlier_indices]
    rmse = float(np.sqrt(np.mean(np.sum(residual * residual, axis=1))))
    rotation, _ = cv2.Rodrigues(rvec)

    return CameraPoseResult(
        rotation_matrix=np.asarray(rotation, dtype=np.float64),
        rotation_vector=np.asarray(rvec, dtype=np.float64),
        translation_vector=np.asarray(tvec, dtype=np.float64),
        camera_matrix=camera_matrix,
        distortion=dist,
        inlier_indices=inlier_indices,
        reprojection_rmse_px=rmse,
        calibration_source=calibration_source,
        metric_projection_valid=metric_valid,
    )


def project_world_points(points_xyz, pose: dict, image_width: int, image_height: int):
    points = np.asarray(points_xyz, dtype=np.float64)
    if points.ndim != 2 or points.shape[1] != 3:
        raise ValueError("points_xyz must be an N x 3 array.")

    camera_matrix = np.asarray(pose["camera_matrix"], dtype=np.float64).reshape(3, 3)
    rotation = np.asarray(pose["rotation_matrix"], dtype=np.float64).reshape(3, 3)
    translation = np.asarray(pose["translation_vector"], dtype=np.float64).reshape(3, 1)
    distortion = np.asarray(pose.get("distortion", [0, 0, 0, 0, 0]), dtype=np.float64).reshape(-1, 1)
    rvec, _ = cv2.Rodrigues(rotation)
    projected, _ = cv2.projectPoints(points, rvec, translation, camera_matrix, distortion)
    uv = projected.reshape(-1, 2)

    camera_points = (rotation @ points.T + translation).T
    depth = camera_points[:, 2]
    inside = (
        (depth > 0)
        & (uv[:, 0] >= 0)
        & (uv[:, 0] < image_width)
        & (uv[:, 1] >= 0)
        & (uv[:, 1] < image_height)
    )
    return [
        {
            "xyz": points[i].tolist(),
            "uv": uv[i].tolist(),
            "depth": float(depth[i]),
            "in_frame": bool(inside[i]),
        }
        for i in range(len(points))
    ]
