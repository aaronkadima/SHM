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
from app.cdm3.auto_registration import propagate_camera_pose


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


    rng=np.random.default_rng(42)
    texture=rng.integers(0,256,size=(height,width),dtype=np.uint8)
    texture=cv2.GaussianBlur(texture,(3,3),0)
    for yy in range(60,height-40,45):
        for xx in range(60,width-40,45):
            cv2.circle(texture,(xx,yy),5,int((xx*13+yy*7)%220+20),-1)
            cv2.line(texture,(xx-7,yy),(xx+7,yy),255,1)
            cv2.line(texture,(xx,yy-7),(xx,yy+7),0,1)
    anchor_image=cv2.cvtColor(texture,cv2.COLOR_GRAY2BGR)
    plane_points=[[float(xx),float(yy),0.0] for yy in np.linspace(-2.0,2.0,31) for xx in np.linspace(-3.0,3.0,41)]
    anchor_rvec=np.zeros((3,1),dtype=np.float64);anchor_tvec=np.array([[0.0],[0.0],[8.0]],dtype=np.float64)
    anchor_rot,_=cv2.Rodrigues(anchor_rvec)
    anchor_pose={"rotation_matrix":anchor_rot.tolist(),"translation_vector":anchor_tvec.reshape(3).tolist(),"camera_matrix":camera_matrix.tolist(),"distortion":[0,0,0,0,0],"metric_projection_valid":True}
    target_rvec=np.array([[0.025],[-0.055],[0.018]],dtype=np.float64);target_tvec=np.array([[0.22],[-0.08],[8.25]],dtype=np.float64)
    corners=np.array([[-3,-2,0],[3,-2,0],[3,2,0],[-3,2,0]],dtype=np.float64)
    auv,_=cv2.projectPoints(corners,anchor_rvec,anchor_tvec,camera_matrix,np.zeros((5,1)))
    tuv,_=cv2.projectPoints(corners,target_rvec,target_tvec,camera_matrix,np.zeros((5,1)))
    H=cv2.getPerspectiveTransform(auv.reshape(4,2).astype(np.float32),tuv.reshape(4,2).astype(np.float32))
    target_image=cv2.warpPerspective(anchor_image,H,(width,height),flags=cv2.INTER_LINEAR)
    auto=propagate_camera_pose(anchor_image,target_image,anchor_pose,plane_points,target_intrinsics=intrinsics,target_distortion=[0,0,0,0,0],association_radius_px=12.0,reprojection_error_px=6.0)
    assert auto.correspondence_count>=8
    assert len(auto.pose.inlier_indices)>=6
    assert auto.pnp_inlier_ratio>=0.35
    assert auto.pose.reprojection_rmse_px<8.0
    assert auto.pose.metric_projection_valid is True
    assert auto.pose.calibration_source=="auto_propagated_from_calibrated_anchor"

    print(
        "CDM3_PNP_REGISTRATION_PASS",
        {
            "inliers": len(result.inlier_indices),
            "rmse_px": round(result.reprojection_rmse_px, 8),
            "camera_center_world": [round(float(v), 6) for v in result.camera_center_world],
            "approximate_metric_valid": approximate.metric_projection_valid,
            "auto_correspondences": auto.correspondence_count,
            "auto_inliers": len(auto.pose.inlier_indices),
            "auto_rmse_px": round(auto.pose.reprojection_rmse_px, 4),
        },
    )


if __name__ == "__main__":
    main()
