"""Automatic multiview pose propagation for CDM-3."""
from __future__ import annotations
from dataclasses import dataclass
import math
import cv2
import numpy as np
from .registration import CameraPoseResult, project_world_points, solve_camera_pose

@dataclass
class AutoRegistrationResult:
    pose: CameraPoseResult
    anchor_keypoints: int
    target_keypoints: int
    ratio_match_count: int
    geometry_match_count: int
    correspondence_count: int
    pnp_inlier_ratio: float
    association_radius_px: float
    intrinsics_source: str
    anchor_metric_projection_valid: bool

    def as_dict(self):
        return {
            "registration": self.pose.as_dict(),
            "method": "orb_anchor_projection_pnp",
            "matching": {
                "anchor_keypoints": int(self.anchor_keypoints),
                "target_keypoints": int(self.target_keypoints),
                "ratio_match_count": int(self.ratio_match_count),
                "geometry_match_count": int(self.geometry_match_count),
                "correspondence_count": int(self.correspondence_count),
                "pnp_inlier_ratio": float(self.pnp_inlier_ratio),
                "association_radius_px": float(self.association_radius_px),
                "intrinsics_source": self.intrinsics_source,
                "anchor_metric_projection_valid": bool(self.anchor_metric_projection_valid),
            },
        }

def decode_image_bytes(raw: bytes) -> np.ndarray:
    if not raw:
        raise ValueError("Image payload is empty.")
    image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None or image.ndim != 3:
        raise ValueError("OpenCV could not decode the image.")
    return image

def _gray_for_features(image: np.ndarray, max_side: int = 1800):
    if image is None or image.size == 0:
        raise ValueError("Feature image is empty.")
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    h, w = gray.shape[:2]
    scale = min(1.0, float(max_side) / max(w, h))
    small = cv2.resize(gray, (max(2, int(round(w*scale))), max(2, int(round(h*scale)))), interpolation=cv2.INTER_AREA) if scale < 1 else gray
    return small, w/float(small.shape[1]), h/float(small.shape[0])

def _match_orb(anchor: np.ndarray, target: np.ndarray, max_features: int = 6000, ratio: float = 0.76):
    a, asx, asy = _gray_for_features(anchor)
    b, bsx, bsy = _gray_for_features(target)
    orb = cv2.ORB_create(nfeatures=max(1200,int(max_features)),scaleFactor=1.2,nlevels=8,edgeThreshold=19,fastThreshold=7)
    key_a, des_a = orb.detectAndCompute(a, None)
    key_b, des_b = orb.detectAndCompute(b, None)
    if des_a is None or des_b is None or len(key_a)<12 or len(key_b)<12:
        raise RuntimeError("Insufficient ORB features for automatic registration.")
    pairs=cv2.BFMatcher(cv2.NORM_HAMMING,crossCheck=False).knnMatch(des_a,des_b,k=2)
    ratio_matches=[m for pair in pairs if len(pair)>=2 for m,n in [pair[:2]] if m.distance<ratio*n.distance]
    if len(ratio_matches)<10:
        raise RuntimeError("Insufficient visual matches after ORB ratio filtering.")
    pts_a=np.float32([key_a[m.queryIdx].pt for m in ratio_matches])
    pts_b=np.float32([key_b[m.trainIdx].pt for m in ratio_matches])
    kept=ratio_matches
    if len(ratio_matches)>=12:
        _,mask=cv2.findFundamentalMat(pts_a,pts_b,cv2.FM_RANSAC,2.0,0.995)
        if mask is not None:
            candidate=[m for m,ok in zip(ratio_matches,np.asarray(mask).reshape(-1).astype(bool)) if ok]
            if len(candidate)>=8: kept=candidate
    rows=[]
    for match in kept:
        ua,va=key_a[match.queryIdx].pt;ub,vb=key_b[match.trainIdx].pt
        rows.append({"anchor_uv":[float(ua*asx),float(va*asy)],"target_uv":[float(ub*bsx),float(vb*bsy)],"distance":float(match.distance)})
    return rows,len(key_a),len(key_b),len(ratio_matches)

def _projection_index(world_points,anchor_pose,width,height,cell_px):
    grid={}
    for index,row in enumerate(project_world_points(world_points,anchor_pose,width,height)):
        if not row.get("in_frame"): continue
        u,v=row["uv"];depth=float(row.get("depth",math.inf))
        if not (math.isfinite(u) and math.isfinite(v) and math.isfinite(depth) and depth>0): continue
        key=(int(math.floor(u/cell_px)),int(math.floor(v/cell_px)))
        grid.setdefault(key,[]).append({"index":index,"uv":[float(u),float(v)],"depth":depth,"xyz":world_points[index]})
    return grid

def _nearest_projected(grid,uv,radius_px,cell_px):
    u,v=float(uv[0]),float(uv[1]);gx,gy=int(math.floor(u/cell_px)),int(math.floor(v/cell_px))
    rings=max(1,int(math.ceil(radius_px/cell_px)));best=None;best_d2=radius_px*radius_px
    for yy in range(gy-rings,gy+rings+1):
        for xx in range(gx-rings,gx+rings+1):
            for row in grid.get((xx,yy),[]):
                du=row["uv"][0]-u;dv=row["uv"][1]-v;d2=du*du+dv*dv
                if d2<best_d2 or (best is not None and abs(d2-best_d2)<1e-9 and row["depth"]<best["depth"]):
                    best=row;best_d2=d2
    return None if best is None else {**best,"pixel_distance":math.sqrt(best_d2)}

def associate_visual_matches_to_world(matches,world_points,anchor_pose,anchor_width,anchor_height,association_radius_px=10.0,max_correspondences=600):
    if len(world_points)<6: raise ValueError("At least 6 spatial points are required.")
    cell=max(3.0,float(association_radius_px))
    grid=_projection_index(world_points,anchor_pose,anchor_width,anchor_height,cell)
    candidates=[]
    for row in matches:
        hit=_nearest_projected(grid,row["anchor_uv"],association_radius_px,cell)
        if hit is None: continue
        candidates.append({
            "world_index":int(hit["index"]),"xyz":[float(v) for v in hit["xyz"]],"uv":[float(v) for v in row["target_uv"]],
            "anchor_uv":[float(v) for v in row["anchor_uv"]],"association_distance_px":float(hit["pixel_distance"]),
            "score":float(row.get("distance",128.0))+hit["pixel_distance"]*4.0,
        })
    candidates.sort(key=lambda row:row["score"]);used_world=set();used_target=set();out=[]
    for row in candidates:
        target_key=(int(row["uv"][0]//12),int(row["uv"][1]//12))
        if row["world_index"] in used_world or target_key in used_target: continue
        used_world.add(row["world_index"]);used_target.add(target_key);out.append(row)
        if len(out)>=max(6,int(max_correspondences)): break
    return out

def _inherited_intrinsics(anchor_pose,anchor_size,target_size):
    k=np.asarray(anchor_pose["camera_matrix"],dtype=np.float64).reshape(3,3)
    aw,ah=float(anchor_size[0]),float(anchor_size[1]);tw,th=float(target_size[0]),float(target_size[1])
    sx,sy=tw/max(1.0,aw),th/max(1.0,ah)
    return {"fx":float(k[0,0]*sx),"fy":float(k[1,1]*sy),"cx":float(k[0,2]*sx),"cy":float(k[1,2]*sy)}

def propagate_camera_pose(anchor_image,target_image,anchor_pose,world_points,target_intrinsics=None,target_distortion=None,association_radius_px=10.0,reprojection_error_px=5.0):
    if not isinstance(anchor_pose,dict) or "camera_matrix" not in anchor_pose: raise ValueError("A valid anchor pose is required.")
    if len(world_points)>50000: raise ValueError("Automatic propagation accepts at most 50000 spatial points.")
    ah,aw=anchor_image.shape[:2];th,tw=target_image.shape[:2]
    matches,anchor_kp,target_kp,ratio_count=_match_orb(anchor_image,target_image)
    correspondences=associate_visual_matches_to_world(matches,world_points,anchor_pose,aw,ah,association_radius_px)
    if len(correspondences)<8:
        raise RuntimeError(f"Only {len(correspondences)} reliable 2D-3D correspondences were recovered; at least 8 are required.")
    if target_intrinsics is None:
        intrinsics=_inherited_intrinsics(anchor_pose,(aw,ah),(tw,th));intrinsics_source="anchor_camera_matrix_scaled"
    else:
        intrinsics=target_intrinsics;intrinsics_source="provided_target_intrinsics"
    distortion=target_distortion if target_distortion is not None else list(anchor_pose.get("distortion",[0,0,0,0,0]))
    pose=solve_camera_pose(correspondences,tw,th,intrinsics,distortion,reprojection_error_px,0.999,500)
    inlier_ratio=len(pose.inlier_indices)/max(1,len(correspondences))
    if len(pose.inlier_indices)<6 or inlier_ratio<0.35:
        raise RuntimeError(f"Automatic pose rejected: {len(pose.inlier_indices)} PnP inliers ({inlier_ratio:.1%}).")
    if not math.isfinite(pose.reprojection_rmse_px) or pose.reprojection_rmse_px>max(8.0,reprojection_error_px*1.8):
        raise RuntimeError(f"Automatic pose rejected: reprojection RMSE {pose.reprojection_rmse_px:.2f} px.")
    anchor_metric=bool(anchor_pose.get("metric_projection_valid",False))
    pose.metric_projection_valid=anchor_metric
    pose.calibration_source="auto_propagated_from_calibrated_anchor" if anchor_metric else "auto_propagated_from_uncalibrated_anchor"
    return AutoRegistrationResult(pose,anchor_kp,target_kp,ratio_count,len(matches),len(correspondences),inlier_ratio,association_radius_px,intrinsics_source,anchor_metric)
