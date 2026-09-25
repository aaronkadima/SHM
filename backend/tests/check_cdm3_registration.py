#!/usr/bin/env python3
from __future__ import annotations
import math
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.cdm3.registration import solve_camera_pose, project_world_points


def main():
    width, height = 800, 600
    intrinsics = {"fx": 800.0, "fy": 800.0, "cx": 400.0, "cy": 300.0}
    camera_matrix = np.array(
        [[800.0, 0.0, 400.0], [0.0, 800.0, 300.0], [0.0, 0.0, 1.0]],
        dtype=np.float64,
    )
    object_points = np.array(
        [
            [-1.5, -1.0, 0.0],
            [1.5, -1.0, 0.0],
            [1.5, 1.0, 0.0],
            [-1.5, 1.0, 0.0],
            [-1.0, -0.6, 1.0],
            [1.0, -0.6, 1.0],
            [1.0, 0.6, 1.0],
            [-1.0, 0.6, 1.0],
            [0.0, 0.0, 1.8],
            [0.4, -0.2, 0.5],
        ],
        dtype=np.float64,
    )
    true_rvec = np.array([[0.08], [-0.12], [0.04]], dtype=np.float64)
    true_tvec = np.array([[0.25], [-0.15], [8.5]], dtype=np.float64)
    projected, _ = cv2.projectPoints(
        object_points, true_rvec, true_tvec, camera_matrix, np.zeros((5, 1), dtype=np.float64)
    )
    image_points = projected.reshape(-1, 2)

    correspondences = [
        {"xyz": xyz.tolist(), "uv": uv.tolist()}
        for xyz, uv in zip(object_points, image_points)
    ]
    result = solve_camera_pose(
        correspondences,
        image_width=width,
        image_height=height,
        intrinsics=intrinsics,
        distortion=[0, 0, 0, 0, 0],
        reprojection_error_px=1.0,
    )
    assert result.metric_projection_valid is True
    assert result.calibration_source == "provided_intrinsics"
    assert len(result.inlier_indices) >= 8
    assert math.isfinite(result.reprojection_rmse_px)
    assert result.reprojection_rmse_px < 1e-3, result.reprojection_rmse_px

    expected_rotation, _ = cv2.Rodrigues(true_rvec)
    expected_center = -expected_rotation.T @ true_tvec.reshape(3)
    assert np.linalg.norm(result.camera_center_world - expected_center) < 1e-3

    pose = result.as_dict()
    back_projected = project_world_points(object_points.tolist(), pose, width, height)
    assert len(back_projected) == len(object_points)
    assert sum(1 for row in back_projected if row["in_frame"]) == len(object_points)
    reprojection = np.array([row["uv"] for row in back_projected], dtype=float)
    assert np.max(np.linalg.norm(reprojection - image_points, axis=1)) < 1e-3

    approximate = solve_camera_pose(
        correspondences,
        image_width=width,
        image_height=height,
        intrinsics=None,
        distortion=[0, 0, 0, 0, 0],
        reprojection_error_px=2.0,
    )
    assert approximate.metric_projection_valid is False
    assert approximate.calibration_source == "estimated_from_image_dimensions"

    print(
        "CDM3_PNP_REGISTRATION_PASS",
        {
            "inliers": len(result.inlier_indices),
            "rmse_px": round(result.reprojection_rmse_px, 8),
            "camera_center_world": [round(float(v), 6) for v in result.camera_center_world],
            "approximate_metric_valid": approximate.metric_projection_valid,
        },
    )


if __name__ == "__main__":
    main()
