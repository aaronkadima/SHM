"""FastAPI endpoints for the CDM-3 dev-only spatial pipeline."""
from __future__ import annotations
import importlib.util
import json
import os
from pathlib import Path
import tempfile

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile

from . import CDM3_VERSION

router = APIRouter(prefix="/cdm3", tags=["CDM-3"])


def _missing(*modules):
    return [name for name in modules if importlib.util.find_spec(name) is None]


def _require(*modules):
    missing = _missing(*modules)
    if missing:
        raise HTTPException(
            503,
            "CDM-3 optional dependencies missing: " + ", ".join(missing)
            + ". Install backend/requirements-cdm3.txt.",
        )


@router.get("/status")
def status():
    checkpoint = os.getenv("SHM_CDM3_CHECKPOINT", "").strip()
    deps = {
        "las": _missing("laspy", "scipy"),
        "ifc": _missing("ifcopenshell", "trimesh", "svgwrite"),
    }
    return {
        "engine_id": "cdm_3",
        "version": CDM3_VERSION,
        "stage": "dev",
        "ai_checkpoint_configured": bool(checkpoint),
        "ai_checkpoint_exists": bool(checkpoint and Path(checkpoint).exists()),
        "optional_dependencies": deps,
        "capabilities": [
            "image_pathology_segmentation",
            "las_environment_prior",
            "las_ifc_alignment",
            "ifc_component_resolution",
            "svg_ifc_pathology_export",
            "image_to_spatial_pnp_registration",
            "world_to_image_projection",
        ],
    }


@router.post("/las/summary")
async def las_summary(file: UploadFile = File(...)):
    _require("laspy", "scipy")
    from .las_reader import load_las, classification_summary, environment_tags_from_classification
    suffix = Path(file.filename or "cloud.las").suffix or ".las"
    if suffix.lower() not in {".las", ".laz"}:
        raise HTTPException(400, "Expected LAS/LAZ file.")
    raw = await file.read()
    with tempfile.TemporaryDirectory(prefix="shm-cdm3-las-") as td:
        path = Path(td) / ("input" + suffix)
        path.write_bytes(raw)
        try:
            las = load_las(path)
            summary = classification_summary(las, file.filename or "")
            environment = environment_tags_from_classification(summary)
        except Exception as exc:
            raise HTTPException(400, f"LAS read failed: {type(exc).__name__}: {exc}") from exc
    return {"summary": summary.as_dict(), "environment": environment}


@router.post("/registration/pnp")
async def register_image_to_spatial(
    image_width: int = Form(...),
    image_height: int = Form(...),
    correspondences_json: str = Form(...),
    intrinsics_json: str | None = Form(None),
    distortion_json: str | None = Form(None),
    reprojection_error_px: float = Form(4.0),
):
    """Solve camera pose from 2D pixel <-> 3D world correspondences.

    Intrinsics are optional only for preview. If omitted, the response marks
    metric_projection_valid=false so approximate registration cannot be
    mistaken for a calibrated metric result.
    """
    from .registration import solve_camera_pose
    try:
        correspondences = json.loads(correspondences_json)
        if isinstance(correspondences, dict):
            correspondences = correspondences.get("correspondences", [])
        if not isinstance(correspondences, list):
            raise ValueError("correspondences must be a list")
        intrinsics = json.loads(intrinsics_json) if intrinsics_json else None
        distortion = json.loads(distortion_json) if distortion_json else None
        if intrinsics is not None and not isinstance(intrinsics, dict):
            raise ValueError("intrinsics_json must be an object")
        if distortion is not None and not isinstance(distortion, list):
            raise ValueError("distortion_json must be an array")
        result = solve_camera_pose(
            correspondences=correspondences,
            image_width=image_width,
            image_height=image_height,
            intrinsics=intrinsics,
            distortion=distortion,
            reprojection_error_px=reprojection_error_px,
        )
    except ValueError as exc:
        raise HTTPException(400, f"Invalid registration input: {exc}") from exc
    except Exception as exc:
        raise HTTPException(422, f"Camera registration failed: {type(exc).__name__}: {exc}") from exc
    return {
        "engine_id": "cdm_3",
        "registration": result.as_dict(),
        "correspondence_count": len(correspondences),
        "ready_for_metric_pathology_projection": bool(result.metric_projection_valid),
    }


@router.post("/registration/project")
async def project_world_to_image(
    image_width: int = Form(...),
    image_height: int = Form(...),
    points_json: str = Form(...),
    pose_json: str = Form(...),
):
    """Project 3D points into a registered image using an already solved pose."""
    from .registration import project_world_points
    try:
        points = json.loads(points_json)
        if isinstance(points, dict):
            points = points.get("points", [])
        pose = json.loads(pose_json)
        if not isinstance(points, list):
            raise ValueError("points_json must be a list")
        if not isinstance(pose, dict):
            raise ValueError("pose_json must be an object")
        if len(points) > 250000:
            raise ValueError("At most 250000 points can be projected per request.")
        projected = project_world_points(points, pose, image_width, image_height)
    except ValueError as exc:
        raise HTTPException(400, f"Invalid projection input: {exc}") from exc
    except Exception as exc:
        raise HTTPException(422, f"World-to-image projection failed: {type(exc).__name__}: {exc}") from exc
    visible = sum(1 for row in projected if row["in_frame"])
    return {
        "engine_id": "cdm_3",
        "point_count": len(projected),
        "in_frame_count": visible,
        "projected": projected,
    }


@router.post("/ifc/resolve")
async def resolve_components(
    ifc: UploadFile = File(...),
    records_json: str = Form(...),
    max_distance_m: float = Form(0.5),
):
    _require("ifcopenshell", "trimesh")
    import ifcopenshell
    from .components import IfcGeometryIndex, enrich_records_with_host_element
    try:
        payload = json.loads(records_json)
        records = payload.get("records", []) if isinstance(payload, dict) else payload
        if not isinstance(records, list):
            raise ValueError("records must be a list")
    except Exception as exc:
        raise HTTPException(400, f"Invalid records_json: {exc}") from exc
    with tempfile.TemporaryDirectory(prefix="shm-cdm3-ifc-") as td:
        path = Path(td) / "model.ifc"
        path.write_bytes(await ifc.read())
        try:
            model = ifcopenshell.open(str(path))
            index = IfcGeometryIndex(model)
            records, stats = enrich_records_with_host_element(records, index, max_distance_m)
        except Exception as exc:
            raise HTTPException(400, f"IFC resolve failed: {type(exc).__name__}: {exc}") from exc
    return {"records": records, "stats": stats, "indexed_elements": len(index)}


@router.post("/ifc/export")
async def export_ifc(
    ifc: UploadFile = File(...),
    records_json: str = Form(...),
):
    _require("ifcopenshell", "trimesh", "svgwrite")
    from .ifc_export import export_records
    try:
        payload = json.loads(records_json)
        records = payload.get("records", []) if isinstance(payload, dict) else payload
        if not isinstance(records, list):
            raise ValueError("records must be a list")
    except Exception as exc:
        raise HTTPException(400, f"Invalid records_json: {exc}") from exc
    with tempfile.TemporaryDirectory(prefix="shm-cdm3-export-") as td:
        root = Path(td)
        src, out = root / "input.ifc", root / "cdm3-output.ifc"
        src.write_bytes(await ifc.read())
        try:
            stats = export_records(src, records, root / "svg", out)
            data = out.read_bytes()
        except Exception as exc:
            raise HTTPException(400, f"IFC export failed: {type(exc).__name__}: {exc}") from exc
    headers = {
        "Content-Disposition": 'attachment; filename="shm-cdm3-pathologies.ifc"',
        "X-CDM3-Exported": str(stats.exported),
        "X-CDM3-Skipped": str(stats.skipped_missing_host + stats.skipped_bad_geometry),
    }
    return Response(content=data, media_type="application/x-step", headers=headers)
